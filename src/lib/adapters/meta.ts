/**
 * Shared Meta (Graph API) helpers for the Instagram and Facebook adapters.
 *
 * Both platforms publish with a *Page* access token for the Page connected to
 * the Instagram professional account / Facebook Page, and both accept direct
 * uploads from disk through rupload.facebook.com — no public media URL needed.
 */
import { AdapterError, providerFetch, readJson } from "@/lib/adapters/types";

/** Pinned Graph API version (each version is supported for ~2 years). */
export const META_API_VERSION = "v23.0";
export const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
export const META_RUPLOAD = "https://rupload.facebook.com";

export type MetaInstagramAccount = { id: string; username?: string };

export type MetaPage = {
  id: string;
  name: string;
  accessToken: string;
  instagram?: MetaInstagramAccount;
};

type AccountsPayload = {
  data?: Array<{
    id?: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id?: string; username?: string };
  }>;
};

/** Pages the connected user administers, with their tokens and linked IG account. */
export async function fetchMetaPages(provider: string, userAccessToken: string): Promise<MetaPage[]> {
  const response = await providerFetch(
    provider,
    `${META_GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`,
    { headers: { authorization: `Bearer ${userAccessToken}` } },
    "page list",
  );
  const payload = await readJson<AccountsPayload>(provider, response, "page list");
  return (payload.data ?? [])
    .filter(
      (page): page is NonNullable<AccountsPayload["data"]>[number] & { id: string; access_token: string } =>
        Boolean(page.id && page.access_token),
    )
    .map((page) => ({
      id: page.id,
      name: page.name ?? page.id,
      accessToken: page.access_token,
      instagram: page.instagram_business_account?.id
        ? {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username,
          }
        : undefined,
    }));
}

/**
 * Picks the Page to publish from. `hint` is the workflow destination's folder
 * field: a Page id or an @username. With several candidates and no hint we fail
 * loudly rather than posting to the wrong account.
 */
export function pickMetaPage(
  provider: string,
  pages: MetaPage[],
  hint: string | null | undefined,
  options: { requireInstagram: boolean },
): MetaPage {
  const eligible = options.requireInstagram ? pages.filter((page) => page.instagram) : pages;
  const label = options.requireInstagram ? "Instagram professional account" : "Facebook Page";

  if (eligible.length === 0) {
    throw new AdapterError(
      options.requireInstagram
        ? `${provider}: no Instagram professional account found. Link a Business/Creator Instagram account to a Facebook Page you administer, then reconnect.`
        : `${provider}: no Facebook Page found for this account.`,
      provider,
    );
  }

  const wanted = hint?.trim().replace(/^@/, "").toLowerCase();
  if (wanted) {
    const match =
      eligible.find((page) => page.id === hint?.trim()) ??
      eligible.find((page) => page.instagram?.username?.toLowerCase() === wanted) ??
      eligible.find((page) => page.name.toLowerCase() === wanted);
    if (match) return match;
    throw new AdapterError(
      `${provider}: no ${label} matches "${hint}". Available: ${describePages(eligible)}`,
      provider,
    );
  }

  if (eligible.length === 1) return eligible[0];
  throw new AdapterError(
    `${provider}: several ${label}s are available (${describePages(eligible)}). Set the destination's account field to the one you want.`,
    provider,
  );
}

export function describePages(pages: MetaPage[]): string {
  return pages
    .map((page) => `${page.name} (page ${page.id}${page.instagram ? `, @${page.instagram.username ?? page.instagram.id}` : ""})`)
    .join(", ");
}

/** Small Graph GET with a Bearer token (tokens never go in the URL). */
export async function graphGet<T>(provider: string, path: string, token: string): Promise<T> {
  const response = await providerFetch(
    provider,
    `${META_GRAPH}${path}`,
    { headers: { authorization: `Bearer ${token}` } },
    path,
  );
  return readJson<T>(provider, response, path);
}

/** Small Graph POST with form-encoded params. */
export async function graphPost<T>(
  provider: string,
  path: string,
  token: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) form.set(key, String(value));
  const response = await providerFetch(
    provider,
    `${META_GRAPH}${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
    path,
  );
  return readJson<T>(provider, response, path);
}

export type InstagramContainerStatus = {
  id?: string;
  status?: string;
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
};

/** Instagram processes resumable uploads asynchronously; publish only when FINISHED. */
export async function waitForInstagramContainer(
  containerId: string,
  token: string,
  timeoutMs = 6 * 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: InstagramContainerStatus = {};
  while (Date.now() < deadline) {
    last = await graphGet<InstagramContainerStatus>(
      "INSTAGRAM",
      `/${containerId}?fields=status_code,status`,
      token,
    );
    if (last.status_code === "FINISHED" || last.status_code === "PUBLISHED") return;
    if (last.status_code === "ERROR" || last.status_code === "EXPIRED") {
      throw new AdapterError(
        `INSTAGRAM: media container ${last.status_code.toLowerCase()}`,
        "INSTAGRAM",
        last.status ?? undefined,
      );
    }
    await sleep(3000);
  }
  throw new AdapterError(
    "INSTAGRAM: media processing timed out before it became publishable",
    "INSTAGRAM",
    last.status,
  );
}

/** Waits until the Facebook Reels upload phase has finished transferring bytes. */
export async function waitForFacebookUpload(
  videoId: string,
  token: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await graphGet<{
      status?: {
        video_status?: string;
        uploading_phase?: { status?: string };
        processing_phase?: { status?: string; error?: { message?: string } };
      };
    }>("FACEBOOK", `/${videoId}?fields=status`, token);
    const phase = status.status;
    if (phase?.processing_phase?.error?.message) {
      throw new AdapterError(
        "FACEBOOK: the reel was rejected while processing",
        "FACEBOOK",
        phase.processing_phase.error.message,
      );
    }
    if (phase?.uploading_phase?.status === "complete") return;
    if (phase?.uploading_phase?.status === "error") {
      throw new AdapterError("FACEBOOK: upload phase failed", "FACEBOOK");
    }
    await sleep(3000);
  }
  throw new AdapterError("FACEBOOK: upload status check timed out", "FACEBOOK");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a rupload response body and turns `{success:false}` into an AdapterError. */
export async function assertUploadSucceeded(
  provider: string,
  response: Response,
  context: string,
): Promise<void> {
  const text = await response.text();
  if (response.ok && !text.includes('"success":false') && !text.includes('"success": false')) return;
  throw new AdapterError(
    `${provider}: ${context} upload failed (HTTP ${response.status})`,
    provider,
    text.slice(0, 2000),
  );
}
