/**
 * Server-only request helpers. Kept out of lib/utils.ts so client components
 * can import the pure helpers there without pulling in `next/headers`.
 */
import { cookies, headers } from "next/headers";

/** Absolute app URL used for OAuth redirect URIs and links in logs. */
export async function getAppOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Read a UI preference cookie (no sessions — purely cosmetic). */
export async function readUiCookie(name: string): Promise<string | undefined> {
  const store = await cookies();
  return store.get(name)?.value;
}
