/**
 * Per-connection yt-dlp cookie jars.
 *
 * Cookies are stored encrypted and only written to a 0600 temp file for the
 * duration of one yt-dlp call, then deleted. Used when a platform (TikTok in
 * particular) blocks requests from server IPs.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";

export const COOKIE_JAR_MAX_BYTES = 512 * 1024;

/** Validates a pasted cookies.txt and normalizes line endings. */
export function normalizeCookieJar(input: string): string {
  const text = input.replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("Cookie file is empty");

  if (Buffer.byteLength(text, "utf8") > COOKIE_JAR_MAX_BYTES) {
    throw new Error("Cookie file is too large (512 KB max)");
  }

  const lines = text.split("\n");
  const looksNetscape =
    lines.some((line) => line.includes("Netscape HTTP Cookie File")) ||
    lines.some((line) => {
      if (line.startsWith("#") || !line.trim()) return false;
      const fields = line.split("\t");
      return fields.length >= 6 && /^https?:/.test(fields[0] ?? "") === false;
    });

  if (!looksNetscape) {
    throw new Error(
      "That does not look like a Netscape cookies.txt file. Export cookies from a logged-in browser (Get cookies.txt extension) and paste the file contents.",
    );
  }

  return text;
}

/** Runs fn with a temporary cookies file, deleting it afterwards. */
export async function withTempCookies<T>(
  text: string | null | undefined,
  fn: (cookiesFile: string | null) => Promise<T>,
): Promise<T> {
  if (!text?.trim()) return fn(null);

  const dir = await mkdtemp(path.join(tmpdir(), "repurpose-cookies-"));
  const file = path.join(dir, "cookies.txt");
  await writeFile(file, text, { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Decrypts a connection's cookie jar into a temporary file for one call. */
export async function withConnectionCookies<T>(
  connectionId: string,
  fn: (cookiesFile: string | null) => Promise<T>,
): Promise<T> {
  const row = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { cookieJar: true },
  });
  if (!row?.cookieJar) return fn(null);
  return withTempCookies(decryptSecret(row.cookieJar), fn);
}
