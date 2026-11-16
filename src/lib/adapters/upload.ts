/**
 * Streaming uploads: files are piped straight from disk to the provider with
 * an exact Content-Length, so a 2 GB video never becomes a 2 GB Buffer.
 *
 * `duplex: "half"` is required by fetch (undici) for Readable bodies.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { AdapterError } from "@/lib/adapters/types";

export type StreamUploadOptions = {
  url: string;
  filePath: string;
  provider: string;
  mimeType: string;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
};

export type StreamUploadResult = { response: Response; bytes: number };

export async function uploadFileStream(options: StreamUploadOptions): Promise<StreamUploadResult> {
  const info = await stat(options.filePath).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    throw new AdapterError(
      `${options.provider}: rendered file is missing or empty`,
      options.provider,
      options.filePath,
    );
  }

  try {
    const response = await fetch(options.url, {
      method: options.method ?? "PUT",
      headers: {
        ...options.headers,
        "content-type": options.mimeType,
        "content-length": String(info.size),
      },
      body: createReadStream(options.filePath) as unknown as BodyInit,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    return { response, bytes: info.size };
  } catch (error) {
    throw new AdapterError(
      `${options.provider}: upload stream failed`,
      options.provider,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Small text bodies (caption sidecars) don't need a stream. */
export async function uploadTextBody(
  url: string,
  body: string,
  options: { provider: string; mimeType?: string; method?: "PUT" | "POST"; headers?: Record<string, string> },
): Promise<Response> {
  try {
    return await fetch(url, {
      method: options.method ?? "POST",
      headers: {
        ...options.headers,
        "content-type": options.mimeType ?? "text/plain; charset=UTF-8",
      },
      body,
    });
  } catch (error) {
    throw new AdapterError(
      `${options.provider}: text upload failed`,
      options.provider,
      error instanceof Error ? error.message : String(error),
    );
  }
}
