/**
 * TikTok public-profile source adapter.
 *
 * For creators who publish to TikTok themselves: no developer app, no OAuth,
 * no audit. The worker lists the profile's newest public videos with yt-dlp
 * (the same tool the pipeline already uses for watermark-free downloads) and
 * the strict per-workflow dedupe key keeps it idempotent.
 *
 * Limits: the profile must be public; TikTok rate-limits/blocks some hosts, in
 * which case YTDLP_COOKIES_FILE can be pointed at a browser cookies export.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Connection } from "@prisma/client";

import {
  AdapterError,
  type AdapterCheck,
  type SourceAdapter,
  type SourceListOptions,
  type SourcePost,
} from "@/lib/adapters/types";
import { env } from "@/lib/env";

const exec = promisify(execFile);
const LIST_TIMEOUT_MS = 3 * 60 * 1000;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{2,24}$/;

export type PublicProfileMeta = {
  mode?: string;
  profileUrl?: string;
  username?: string;
};

/** Accepts `@handle`, `handle`, or any tiktok.com URL and normalizes it. */
export function normalizeTikTokProfile(input: string): { profileUrl: string; username: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AdapterError("TIKTOK: enter your TikTok profile URL or @username", "TIKTOK");
  }

  let username: string | undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AdapterError("TIKTOK: that URL is not valid", "TIKTOK", trimmed);
    }
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
      throw new AdapterError("TIKTOK: expected a tiktok.com profile URL", "TIKTOK", url.hostname);
    }
    username = url.pathname.match(/@([A-Za-z0-9._]+)/)?.[1];
  } else {
    username = trimmed.replace(/^@/, "").split(/[/?#]/)[0];
  }

  if (!username || !USERNAME_PATTERN.test(username)) {
    throw new AdapterError(
      "TIKTOK: could not read a username — use https://www.tiktok.com/@yourhandle",
      "TIKTOK",
      trimmed,
    );
  }

  return { profileUrl: `https://www.tiktok.com/@${username}`, username };
}

export type TikTokListingEntry = {
  id: string;
  caption?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  publishedAt?: Date;
  pageUrl: string;
};

type YtDlpEntry = {
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  description?: string;
  duration?: number;
  timestamp?: number;
  release_timestamp?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
};

function videoIdFrom(data: YtDlpEntry): string | undefined {
  if (typeof data.id === "string" && data.id) return data.id;
  const candidate = data.webpage_url ?? data.url;
  if (typeof candidate !== "string") return undefined;
  return candidate.match(/\/video\/(\d+)/)?.[1] ?? candidate.match(/\/(\d{6,})(?:[/?]|$)/)?.[1];
}

/** Parses yt-dlp's newline-delimited JSON into newest-first entries. */
export function parseTikTokListing(stdout: string, username: string): TikTokListingEntry[] {
  const entries: TikTokListingEntry[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let data: YtDlpEntry;
    try {
      data = JSON.parse(text) as YtDlpEntry;
    } catch {
      continue;
    }

    const id = videoIdFrom(data);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const caption =
      typeof data.description === "string" && data.description.trim()
        ? data.description
        : typeof data.title === "string"
          ? data.title
          : undefined;
    const thumbnails = Array.isArray(data.thumbnails) ? data.thumbnails : [];
    const thumbnailUrl =
      thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1]?.url
        : typeof data.thumbnail === "string"
          ? data.thumbnail
          : undefined;
    const timestamp =
      typeof data.timestamp === "number"
        ? data.timestamp
        : typeof data.release_timestamp === "number"
          ? data.release_timestamp
          : undefined;
    const pageUrl =
      typeof data.webpage_url === "string" && data.webpage_url.startsWith("http")
        ? data.webpage_url
        : `https://www.tiktok.com/@${username}/video/${id}`;

    entries.push({
      id,
      caption,
      thumbnailUrl,
      durationSec: typeof data.duration === "number" ? Math.round(data.duration) : undefined,
      publishedAt: timestamp ? new Date(timestamp * 1000) : undefined,
      pageUrl,
    });
  }

  // yt-dlp usually returns newest-first; sort when timestamps exist.
  entries.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return entries;
}

async function runYtDlp(profileUrl: string, limit: number): Promise<string> {
  const args = [
    ...(env.YTDLP_COOKIES_FILE ? ["--cookies", env.YTDLP_COOKIES_FILE] : []),
    "--no-warnings",
    "--no-progress",
    "--ignore-errors",
    "--socket-timeout",
    "20",
    "--flat-playlist",
    "--dump-json",
    "--playlist-end",
    String(limit),
    profileUrl,
  ];

  try {
    const { stdout } = await exec(env.YTDLP_PATH, args, {
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // --ignore-errors exits non-zero when *some* entries fail; keep usable stdout.
    const withOutput = error as { stdout?: string; stderr?: string };
    if (withOutput.stdout && withOutput.stdout.includes("{")) return withOutput.stdout;
    const detail = withOutput.stderr?.slice(-2000);
    throw new AdapterError(
      "TIKTOK: could not list this public profile with yt-dlp",
      "TIKTOK",
      detail || (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** Validates a profile before a connection row is created. */
export async function probeTikTokProfile(input: string): Promise<{
  ok: boolean;
  detail: string;
  videos: number;
  profileUrl?: string;
  username?: string;
}> {
  try {
    const { profileUrl, username } = normalizeTikTokProfile(input);
    const stdout = await runYtDlp(profileUrl, 3);
    const entries = parseTikTokListing(stdout, username);
    if (entries.length === 0) {
      return {
        ok: false,
        detail:
          "No public videos found for that profile. Check the handle, make sure the account is public, and try again.",
        videos: 0,
        profileUrl,
        username,
      };
    }
    return {
      ok: true,
      detail: `Found ${entries.length} recent public video(s)`,
      videos: entries.length,
      profileUrl,
      username,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Could not read that TikTok profile",
      videos: 0,
    };
  }
}

function profileFromConnection(connection: Connection): { profileUrl: string; username: string } {
  const meta = (connection.metadata ?? {}) as PublicProfileMeta;
  const raw = meta.profileUrl ?? (connection.username ? `https://www.tiktok.com/@${connection.username}` : "");
  return normalizeTikTokProfile(raw);
}

export class TikTokProfileSource implements SourceAdapter {
  readonly provider = "TIKTOK";

  constructor(private readonly connection: Connection) {}

  async listRecent(options: SourceListOptions = {}): Promise<SourcePost[]> {
    const { profileUrl, username } = profileFromConnection(this.connection);
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
    const stdout = await runYtDlp(profileUrl, limit);
    const entries = parseTikTokListing(stdout, username);
    const since = options.since ?? null;

    return entries
      .filter((entry) => !since || !entry.publishedAt || entry.publishedAt >= since)
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        url: entry.pageUrl,
        mediaType: "short_video",
        title: entry.caption?.split("\n")[0]?.slice(0, 100),
        caption: entry.caption ?? "",
        thumbnailUrl: entry.thumbnailUrl,
        durationSec: entry.durationSec,
        publishedAt: entry.publishedAt,
        media: [{ url: entry.pageUrl, kind: "video" }],
        raw: {
          source: "tiktok-public-profile",
          profileUrl,
          username,
          id: entry.id,
          pageUrl: entry.pageUrl,
        },
      }));
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const { profileUrl, username } = profileFromConnection(this.connection);
      const stdout = await runYtDlp(profileUrl, 3);
      const entries = parseTikTokListing(stdout, username);
      if (entries.length === 0) {
        return {
          ok: false,
          detail: "Profile reachable but no public videos were listed — is the account public?",
        };
      }
      return {
        ok: true,
        detail: `@${username}: ${entries.length} recent public video(s) visible`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "TikTok profile check failed",
      };
    }
  }
}
