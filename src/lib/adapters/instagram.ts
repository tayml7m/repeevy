/**
 * Instagram destination adapter.
 *
 * Publishes Reels and Stories from a local rendered file using Meta's
 * resumable upload (the only Instagram publishing path that accepts a local
 * file — the classic `video_url` flow needs a public server).
 *
 * Requires a Business/Creator Instagram account linked to a Facebook Page the
 * authorizing user administers, and the instagram_content_publish scope.
 */
import { stat } from "node:fs/promises";

import type { Connection } from "@prisma/client";

import {
  META_API_VERSION,
  META_RUPLOAD,
  assertUploadSucceeded,
  fetchMetaPages,
  graphGet,
  graphPost,
  pickMetaPage,
  waitForInstagramContainer,
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

/** Instagram truncates captions beyond 2,200 characters. */
export const INSTAGRAM_CAPTION_LIMIT = 2200;

export function instagramCaption(input: string): string {
  return input.replace(/\r\n/g, "\n").trim().slice(0, INSTAGRAM_CAPTION_LIMIT);
}

export class InstagramDestination implements DestinationAdapter {
  readonly provider = "INSTAGRAM";

  constructor(private readonly connection: Connection) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const videoPath = request.media.videoPath;
    if (!videoPath) {
      throw new AdapterError(
        "INSTAGRAM: no rendered video for this destination — Instagram publishing here supports video (Reels/Stories)",
        "INSTAGRAM",
      );
    }
    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new AdapterError("INSTAGRAM: rendered video file is missing", "INSTAGRAM", videoPath);
    }

    const isStory =
      request.destination.targetMediaType === "STORY" || request.contentItem.mediaType === "STORY";

    const userToken = await getValidAccessToken(this.connection.id);
    const pages = await fetchMetaPages("INSTAGRAM", userToken);
    const page = pickMetaPage("INSTAGRAM", pages, request.destination.folderPath, {
      requireInstagram: true,
    });
    const instagram = page.instagram;
    if (!instagram) {
      throw new AdapterError(
        "INSTAGRAM: the selected Facebook Page has no linked Instagram professional account",
        "INSTAGRAM",
        page.name,
      );
    }

    const token = page.accessToken;
    const caption = isStory ? "" : instagramCaption(request.caption || request.title || "");

    // 1. Create a resumable container (no media bytes yet).
    const container = await graphPost<{ id: string; uri?: string }>(
      "INSTAGRAM",
      `/${instagram.id}/media`,
      token,
      {
        media_type: isStory ? "STORIES" : "REELS",
        upload_type: "resumable",
        ...(caption ? { caption } : {}),
        ...(isStory ? {} : { share_to_feed: true }),
      },
    );
    if (!container.id) {
      throw new AdapterError("INSTAGRAM: container creation returned no id", "INSTAGRAM");
    }

    // 2. Stream the local MP4 to Meta's upload host.
    const uploadUrl =
      container.uri ?? `${META_RUPLOAD}/ig-api-upload/${META_API_VERSION}/${container.id}`;
    const { response: uploadResponse } = await uploadFileStream({
      url: uploadUrl,
      filePath: videoPath,
      provider: "INSTAGRAM",
      mimeType: "video/mp4",
      method: "POST",
      headers: {
        authorization: `OAuth ${token}`,
        offset: "0",
        file_size: String(info.size),
      },
    });
    await assertUploadSucceeded("INSTAGRAM", uploadResponse, "video");

    // 3. Instagram processes the upload asynchronously before it can publish.
    await waitForInstagramContainer(container.id, token);

    // 4. Publish the container.
    const published = await graphPost<{ id: string }>(
      "INSTAGRAM",
      `/${instagram.id}/media_publish`,
      token,
      { creation_id: container.id },
    );
    if (!published.id) {
      throw new AdapterError("INSTAGRAM: publish returned no media id", "INSTAGRAM");
    }

    const permalink = await graphGet<{ permalink?: string }>(
      "INSTAGRAM",
      `/${published.id}?fields=permalink`,
      token,
    ).catch(() => ({}) as { permalink?: string });

    return {
      remotePostId: published.id,
      remoteUrl:
        permalink.permalink ??
        (instagram.username ? `https://www.instagram.com/${instagram.username}/` : undefined),
      metadata: {
        pageId: page.id,
        igUserId: instagram.id,
        igUsername: instagram.username ?? null,
        mediaType: isStory ? "STORIES" : "REELS",
        uploadedBytes: info.size,
      },
    };
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const userToken = await getValidAccessToken(this.connection.id);
      const pages = await fetchMetaPages("INSTAGRAM", userToken);
      const withInstagram = pages.filter((page) => page.instagram);
      if (withInstagram.length === 0) {
        return {
          ok: false,
          detail:
            "Token accepted, but no Instagram professional account is linked to a Page you administer.",
        };
      }
      const handles = withInstagram
        .map((page) => `@${page.instagram?.username ?? page.instagram?.id} (${page.name})`)
        .join(", ");
      return { ok: true, detail: `Instagram accounts: ${handles}` };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "Instagram check failed",
      };
    }
  }
}
