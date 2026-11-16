/**
 * TikTok source adapter (Display API v2).
 *
 * Lists the connected account's videos newest-first. Downloading happens in
 * the pipeline with yt-dlp against `share_url`, which is what yields a
 * watermark-free source file; the API itself only exposes playback URLs that
 * expire quickly.
 */
import type { Connection } from "@prisma/client";

import {
  AdapterError,
  readJson,
  type AdapterCheck,
  type SourceAdapter,
  type SourceListOptions,
  type SourcePost,
} from "@/lib/adapters/types";
import { getValidAccessToken } from "@/lib/oauth/refresh";

const API = "https://open.tiktokapis.com/v2";
const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "duration",
  "cover_image_url",
  "share_url",
  "create_time",
  "height",
  "width",
].join(",");

type TikTokVideo = {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  create_time?: number;
  height?: number;
  width?: number;
};

type TikTokVideoList = {
  data?: { videos?: TikTokVideo[]; cursor?: number; has_more?: boolean };
  error?: { code?: string; message?: string; log_id?: string };
};

type TikTokUserInfo = {
  data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
  error?: { code?: string; message?: string };
};

function extractHashtags(text?: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(matches)];
}

export class TikTokSourceAdapter implements SourceAdapter {
  readonly provider = "TIKTOK";

  constructor(private readonly connection: Connection) {}

  async listRecent(options: SourceListOptions = {}): Promise<SourcePost[]> {
    const accessToken = await getValidAccessToken(this.connection.id);
    const limit = options.limit ?? 25;
    const since = options.since ?? null;

    const posts: SourcePost[] = [];
    let cursor = 0;

    // The API pages newest-first; walk a bounded number of pages so a backlog
    // import can't spin forever on a huge account.
    for (let page = 0; page < 5 && posts.length < limit; page += 1) {
      const url = `${API}/video/list/?fields=${encodeURIComponent(VIDEO_FIELDS)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ max_count: Math.min(20, limit - posts.length), cursor }),
      });

      const payload = await readJson<TikTokVideoList>("TIKTOK", response, "video list");
      if (payload.error?.code && payload.error.code !== "ok") {
        throw new AdapterError(
          `TIKTOK: video list rejected (${payload.error.code})`,
          "TIKTOK",
          payload.error.message,
        );
      }

      const videos = payload.data?.videos ?? [];
      if (videos.length === 0) break;

      let reachedSince = false;
      for (const video of videos) {
        const publishedAt = video.create_time ? new Date(video.create_time * 1000) : undefined;
        if (since && publishedAt && publishedAt < since) {
          reachedSince = true;
          break;
        }

        posts.push({
          id: video.id,
          url: video.share_url,
          mediaType: "short_video",
          title: video.title?.trim() || undefined,
          caption: video.video_description ?? video.title ?? "",
          hashtags: extractHashtags(video.video_description ?? video.title),
          thumbnailUrl: video.cover_image_url,
          durationSec: video.duration ? Math.round(video.duration) : undefined,
          publishedAt,
          media: video.share_url ? [{ url: video.share_url, kind: "video" }] : [],
          raw: {
            id: video.id,
            shareUrl: video.share_url,
            coverImageUrl: video.cover_image_url,
            height: video.height,
            width: video.width,
          },
        });

        if (posts.length >= limit) break;
      }

      if (reachedSince || !payload.data?.has_more) break;
      cursor = payload.data?.cursor ?? 0;
      if (!cursor) break;
    }

    return posts;
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const accessToken = await getValidAccessToken(this.connection.id);
      const response = await fetch(`${API}/user/info/?fields=open_id,display_name,avatar_url`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJson<TikTokUserInfo>("TIKTOK", response, "user info");
      const user = payload.data?.user;
      return {
        ok: true,
        detail: user?.display_name
          ? `Signed in as ${user.display_name}`
          : "TikTok token accepted",
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "TikTok check failed",
      };
    }
  }
}
