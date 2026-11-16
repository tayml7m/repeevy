import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { resolveMediaRequestPath } from "@/lib/media/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
};

/** Streams media from the shared volume: /api/media?path=items/<id>/out/thumb.jpg */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("path");
  if (!requested) return new Response("Missing path", { status: 400 });

  const resolved = resolveMediaRequestPath(requested);
  if (!resolved) return new Response("Invalid path", { status: 400 });

  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });

  const type = MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
  const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "content-type": type,
      "content-length": String(info.size),
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
