/**
 * Media storage on the shared Docker volume. S3/R2 can be layered on later
 * behind the same helpers; the pipeline only ever handles absolute paths.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

export function mediaRoot(): string {
  return env.MEDIA_ROOT;
}

export function itemMediaDir(contentItemId: string): string {
  return path.join(env.MEDIA_ROOT, "items", contentItemId);
}

export async function ensureItemMediaDir(contentItemId: string): Promise<string> {
  const dir = itemMediaDir(contentItemId);
  await mkdir(path.join(dir, "sources"), { recursive: true });
  await mkdir(path.join(dir, "out"), { recursive: true });
  return dir;
}

export async function removeItemMedia(contentItemId: string): Promise<void> {
  await rm(itemMediaDir(contentItemId), { recursive: true, force: true });
}

/** MediaAsset.storageKey may be absolute or relative to the media root. */
export function resolveAssetPath(storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(env.MEDIA_ROOT, storageKey);
}

export async function fileExists(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Browser URL for a rendered artifact on the media volume. */
export function artifactMediaUrl(absolutePath?: string | null): string | null {
  if (!absolutePath) return null;
  const root = path.resolve(env.MEDIA_ROOT);
  const resolved = path.resolve(absolutePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return `/api/media?path=${encodeURIComponent(path.relative(root, resolved))}`;
}

/**
 * Resolves a browser-supplied media path and refuses anything outside the
 * media root (path traversal guard for /api/media).
 */
export function resolveMediaRequestPath(input: string): string | null {
  const root = path.resolve(env.MEDIA_ROOT);
  const resolved = path.resolve(root, input.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export function assertLocalStorage(): void {
  if (env.STORAGE_DRIVER !== "local") {
    throw new Error(
      `STORAGE_DRIVER=${env.STORAGE_DRIVER} is configured but this build writes to the shared media volume only. Set STORAGE_DRIVER=local (R2/S3 driver lands with the settings UI).`,
    );
  }
}
