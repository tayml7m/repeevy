/**
 * Source download: yt-dlp for platform URLs (watermark-free originals),
 * plain HTTP streaming for direct files (RSS enclosures, Drive exports).
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { env } from "@/lib/env";

const exec = promisify(execFile);
const YTDLP_TIMEOUT_MS = 20 * 60 * 1000;
const HTTP_TIMEOUT_MS = 5 * 60 * 1000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

async function fileSize(target: string): Promise<number> {
  try {
    return (await stat(target)).size;
  } catch {
    return 0;
  }
}

export async function downloadHttpFile(url: string, destination: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new DownloadError(`Download failed with HTTP ${response.status}`, url);
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
    if ((await fileSize(destination)) === 0) {
      throw new DownloadError("Downloaded file is empty", url);
    }
    return destination;
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      error instanceof Error ? error.message : "Download failed",
      controller.signal.aborted ? "Timed out" : url,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads a platform URL with yt-dlp. Returns the real produced path:
 * yt-dlp rewrites the container extension after merging, so we look for
 * `<base>.<ext>` instead of assuming `.mp4`.
 */
export async function downloadWithYtDlp(url: string, outputBase: string): Promise<string> {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--no-part",
    "--restrict-filenames",
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*+ba/b",
    "-o",
    `${outputBase}.%(ext)s`,
    url,
  ];

  const cookies = env.YTDLP_COOKIES_FILE;
  if (cookies) args.unshift("--cookies", cookies);

  try {
    await exec(env.YTDLP_PATH, args, {
      timeout: YTDLP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr).slice(-2000)
        : undefined;
    throw new DownloadError("yt-dlp could not download this post", detail);
  }

  const directory = path.dirname(outputBase);
  const base = path.basename(outputBase);
  const candidates = (await readdir(directory))
    .filter((name) => name === base || name.startsWith(`${base}.`))
    .map((name) => path.join(directory, name));

  for (const candidate of candidates) {
    if ((await fileSize(candidate)) > 0) return candidate;
  }

  throw new DownloadError("yt-dlp reported success but produced no file", url);
}

/** Chooses the right strategy for a source media entry. */
export async function downloadSourceMedia(
  media: { url: string; kind: "video" | "image" | "audio" },
  destinationBase: string,
): Promise<string> {
  if (media.kind === "video") {
    // Platform URLs (TikTok, YouTube…) need yt-dlp for a usable source file.
    return downloadWithYtDlp(media.url, destinationBase);
  }
  try {
    return await downloadHttpFile(media.url, `${destinationBase}${guessExtension(media.url)}`);
  } catch (error) {
    // Some hosts block plain HTTP; yt-dlp can still fetch them.
    try {
      return await downloadWithYtDlp(media.url, destinationBase);
    } catch {
      throw error;
    }
  }
}

function guessExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".mp3", ".m4a", ".wav", ".mp4", ".mov"].includes(ext)) {
      return ext;
    }
  } catch {
    // ignore malformed URLs
  }
  return "";
}
