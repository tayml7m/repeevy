/**
 * Facebook Page destination adapter.
 *
 * Publishes Reels to a Page the authorizing user administers, using Meta's
 * three-phase Reels API (start → rupload binary → finish) so the rendered MP4
 * streams straight from disk.
 *
 * Facebook only accepts Reels via this API (3–90 s, 9:16). Long-form uploads
 * are intentionally rejected with a clear message instead of silently posting
 * a broken reel.
 */
import { stat } from "node:fs/promises";

import type { Connection } from "@prisma/client";

import {
  META_API_VERSION,
  META_RUPLOAD,
  assertUploadSucceeded,
  fetchMetaPages,
  graphPost,
  pickMetaPage,
  waitForFacebookUpload,
} from "@/lib/adapters/meta";
import {
  AdapterError,
  type AdapterCheck,
  type DestinationAdapter,
  type PublishRequest,
  type PublishResult,
} from "@/lib/adapters/types";
import { uploadFileStream } from "@/lib/adapters/upload";
import { getValidAccessToken } from "@/lib/oauth/refresh";

export const FACEBOOK_DESCRIPTION_LIMIT = 5000;

export function facebookDescription(input: string): string {
  return input.replace(/\r\n/g, "\n").trim().slice(0, FACEBOOK_DESCRIPTION_LIMIT);
}

export class FacebookPageDestination implements DestinationAdapter {
  readonly provider = "FACEBOOK";

  constructor(private readonly connection: Connection) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (request.destination.targetMediaType === "VIDEO") {
      throw new AdapterError(
        "FACEBOOK: this adapter publishes Reels (3–90 s). Set the destination's target media to Short video.",
        "FACEBOOK",
      );
    }

    const videoPath = request.media.videoPath;
    if (!videoPath) {
      throw new AdapterError(
        "FACEBOOK: no rendered video for this destination — Page Reels need a video",
        "FACEBOOK",
      );
    }
    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new AdapterError("FACEBOOK: rendered video file is missing", "FACEBOOK", videoPath);
    }

    const userToken = await getValidAccessToken(this.connection.id);
    const pages = await fetchMetaPages("FACEBOOK", userToken);
    const page = pickMetaPage("FACEBOOK", pages, request.destination.folderPath, {
      requireInstagram: false,
    });
    const token = page.accessToken;

    // 1. Initialize the upload session.
    const started = await graphPost<{ video_id?: string; upload_url?: string }>(
      "FACEBOOK",
      `/${page.id}/video_reels`,
      token,
      { upload_phase: "start" },
    );
    if (!started.video_id) {
      throw new AdapterError("FACEBOOK: Reels upload session returned no video id", "FACEBOOK");
    }

    // 2. Stream the file to Meta's upload host.
    const uploadUrl =
      started.upload_url ?? `${META_RUPLOAD}/video-upload/${META_API_VERSION}/${started.video_id}`;
    const { response: uploadResponse } = await uploadFileStream({
      url: uploadUrl,
      filePath: videoPath,
      provider: "FACEBOOK",
      mimeType: "application/octet-stream",
      method: "POST",
      headers: {
        authorization: `OAuth ${token}`,
        offset: "0",
        file_size: String(info.size),
      },
    });
    await assertUploadSucceeded("FACEBOOK", uploadResponse, "reel");

    // 3. Confirm the transfer completed before finishing the session.
    await waitForFacebookUpload(started.video_id, token);

    // 4. Publish the reel.
    const description = facebookDescription(request.caption || request.title || "");
    const title = request.title.trim().slice(0, 100);
    const finished = await graphPost<{ success?: boolean }>(
      "FACEBOOK",
      `/${page.id}/video_reels`,
      token,
      {
        upload_phase: "finish",
        video_id: started.video_id,
        video_state: "PUBLISHED",
        ...(description ? { description } : {}),
        ...(title ? { title } : {}),
      },
    );
    if (!finished.success) {
      throw new AdapterError("FACEBOOK: the reel could not be published", "FACEBOOK", JSON.stringify(finished));
    }

    return {
      remotePostId: started.video_id,
      remoteUrl: `https://www.facebook.com/reel/${started.video_id}`,
      metadata: {
        pageId: page.id,
        pageName: page.name,
        uploadedBytes: info.size,
      },
    };
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const userToken = await getValidAccessToken(this.connection.id);
      const pages = await fetchMetaPages("FACEBOOK", userToken);
      if (pages.length === 0) {
        return { ok: false, detail: "Token accepted, but no Facebook Page is available to this account." };
      }
      return {
        ok: true,
        detail: `Pages: ${pages.map((page) => `${page.name} (${page.id})`).join(", ")}`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "Facebook check failed",
      };
    }
  }
}
