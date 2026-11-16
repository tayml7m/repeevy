/**
 * YouTube destination adapter: resumable video upload (streamed from disk),
 * thumbnail, and an optional first comment. Shorts are simply 9:16 videos
 * under three minutes; the pipeline already produced the right aspect ratio.
 */
import { stat } from "node:fs/promises";

import type { Connection } from "@prisma/client";

import {
  AdapterError,
  readJson,
  type AdapterCheck,
  type DestinationAdapter,
  type PublishRequest,
  type PublishResult,
} from "@/lib/adapters/types";
import { uploadFileStream } from "@/lib/adapters/upload";
import { getValidAccessToken } from "@/lib/oauth/refresh";

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3";

type YouTubeVideo = { id?: string; snippet?: { title?: string } };

/** YouTube rejects titles longer than 100 characters (and no angle brackets). */
export function youTubeTitle(input: string): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  const sanitized = singleLine.replace(/[<>]/g, "");
  return sanitized.slice(0, 100) || "Repurposed video";
}

export class YouTubeDestination implements DestinationAdapter {
  readonly provider = "YOUTUBE";

  constructor(private readonly connection: Connection) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const { media, destination, contentItem } = request;
    const videoPath = media.videoPath;
    if (!videoPath) {
      throw new AdapterError("YouTube: no rendered video for this destination", "YOUTUBE");
    }

    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new AdapterError("YouTube: rendered video file is missing", "YOUTUBE", videoPath);
    }

    const accessToken = await getValidAccessToken(this.connection.id);
    const title = youTubeTitle(request.title || request.caption.split("\n")[0] || "");
    const description = request.caption.slice(0, 4900);
    const privacyStatus = destination.privacyStatus ?? "PUBLIC";
    const categoryId = destination.categoryId || "22";

    const metadata = {
      snippet: { title, description, categoryId },
      status: { privacyStatus, selfDeclaredMadeForKids: false, embeddable: true },
    };

    // 1. Start a resumable session and stream the file to its Location.
    const initResponse = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(info.size),
        "x-upload-content-type": "video/mp4",
      },
      body: JSON.stringify(metadata),
    });

    if (!initResponse.ok) {
      const detail = await initResponse.text();
      throw new AdapterError(
        `YouTube: upload session rejected (HTTP ${initResponse.status})`,
        "YOUTUBE",
        detail.slice(0, 2000),
      );
    }

    const location = initResponse.headers.get("location");
    if (!location) {
      throw new AdapterError("YouTube: upload session response had no Location header", "YOUTUBE");
    }

    const { response: uploadResponse, bytes } = await uploadFileStream({
      url: location,
      filePath: videoPath,
      provider: "YOUTUBE",
      mimeType: "video/mp4",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    const uploaded = await readJson<YouTubeVideo>("YOUTUBE", uploadResponse, "video upload");
    if (!uploaded.id) {
      throw new AdapterError("YouTube: upload succeeded but no video id was returned", "YOUTUBE");
    }

    const metadataExtra: Record<string, unknown> = {
      privacyStatus,
      categoryId,
      title,
      uploadedBytes: bytes,
    };

    // 2. Thumbnail (nice-to-have; never fail the whole publish for it).
    if (media.thumbnailPath) {
      try {
        const { response: thumbResponse } = await uploadFileStream({
          url: `${API}/thumbnails/set?videoId=${encodeURIComponent(uploaded.id)}&uploadType=media`,
          filePath: media.thumbnailPath,
          provider: "YOUTUBE",
          mimeType: "image/jpeg",
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
        });
        metadataExtra.thumbnail = thumbResponse.ok ? "set" : `failed (${thumbResponse.status})`;
      } catch (error) {
        metadataExtra.thumbnail = error instanceof Error ? error.message : "failed";
      }
    }

    // 3. Repurpose the source first comment when requested.
    if (request.firstComment) {
      try {
        const commentResponse = await fetch(`${API}/commentThreads?part=snippet&fields=id`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            snippet: {
              videoId: uploaded.id,
              topLevelComment: { snippet: { textOriginal: request.firstComment.slice(0, 10000) } },
            },
          }),
        });
        metadataExtra.firstComment = commentResponse.ok
          ? "posted"
          : `failed (${commentResponse.status})`;
      } catch (error) {
        metadataExtra.firstComment = error instanceof Error ? error.message : "failed";
      }
    }

    return {
      remotePostId: uploaded.id,
      remoteUrl: `https://youtube.com/watch?v=${uploaded.id}`,
      metadata: metadataExtra,
    };
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const accessToken = await getValidAccessToken(this.connection.id);
      const response = await fetch(`${API}/channels?part=snippet&mine=true`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJson<{
        items?: Array<{ snippet?: { title?: string } }>;
      }>("YOUTUBE", response, "channel lookup");
      const channel = payload.items?.[0]?.snippet?.title;
      return { ok: true, detail: channel ? `Channel: ${channel}` : "YouTube token accepted" };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "YouTube check failed",
      };
    }
  }
}
