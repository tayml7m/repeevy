/**
 * OAuth token refresh for every supported provider, plus
 * getValidAccessToken() which adapters call before each API request.
 */
import type { Connection, Provider } from "@prisma/client";

import { AdapterError } from "@/lib/adapters/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logJob } from "@/lib/pipeline/logger";
import { getProviderCredentials } from "@/lib/settings";

const CREDENTIAL_SLUG: Record<Provider, string> = {
  TIKTOK: "tiktok",
  YOUTUBE: "youtube",
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  X: "x",
  LINKEDIN: "linkedin",
  SNAPCHAT: "snapchat",
  GOOGLE_DRIVE: "google-drive",
  DROPBOX: "dropbox",
  GOOGLE: "youtube",
  PODCAST_RSS: "podcast-rss",
};

const FORM_ENDPOINTS: Partial<Record<Provider, string>> = {
  TIKTOK: "https://open.tiktokapis.com/v2/oauth/token/",
  YOUTUBE: "https://oauth2.googleapis.com/token",
  GOOGLE_DRIVE: "https://oauth2.googleapis.com/token",
  GOOGLE: "https://oauth2.googleapis.com/token",
  X: "https://api.x.com/2/oauth2/token",
  LINKEDIN: "https://www.linkedin.com/oauth/v2/accessToken",
  SNAPCHAT: "https://accounts.snapchat.com/login/oauth2/access_token",
  DROPBOX: "https://api.dropboxapi.com/oauth2/token",
};

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/** Refresh lock so two concurrent jobs can't rotate the same refresh token. */
const inFlight = new Map<string, Promise<string>>();

async function requestRefresh(
  connection: Connection,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresInSec?: number }> {
  const provider = connection.provider;

  if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
    const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("fb_exchange_token", refreshToken);
    const response = await fetch(url);
    const payload = (await response.json()) as TokenPayload;
    if (!response.ok || !payload.access_token) {
      throw new AdapterError(
        `${provider}: token exchange failed`,
        provider,
        payload.error_description ?? payload.error ?? `HTTP ${response.status}`,
      );
    }
    return { accessToken: payload.access_token, expiresInSec: payload.expires_in };
  }

  const endpoint = FORM_ENDPOINTS[provider];
  if (!endpoint) {
    throw new AdapterError(`${provider}: no refresh flow implemented`, provider);
  }

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  if (provider === "TIKTOK") {
    form.set("client_key", clientId);
    form.set("client_secret", clientSecret);
  } else {
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
  }

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (provider === "X") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  const response = await fetch(endpoint, { method: "POST", headers, body: form });
  const text = await response.text();
  let payload: TokenPayload;
  try {
    payload = JSON.parse(text) as TokenPayload;
  } catch {
    throw new AdapterError(`${provider}: token endpoint returned non-JSON`, provider, text.slice(0, 500));
  }
  if (!response.ok || !payload.access_token) {
    throw new AdapterError(
      `${provider}: token refresh failed (HTTP ${response.status})`,
      provider,
      payload.error_description ?? payload.error ?? text.slice(0, 500),
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresInSec: payload.expires_in,
  };
}

/** Refresh one connection, persist encrypted tokens and return the new token. */
export async function refreshConnectionToken(connection: Connection): Promise<string> {
  if (!connection.refreshToken) {
    throw new AdapterError(
      `${connection.provider}: connection has no refresh token — reconnect the account`,
      connection.provider,
    );
  }

  const slug = CREDENTIAL_SLUG[connection.provider];
  const credentials = await getProviderCredentials(slug);
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new AdapterError(
      `${connection.provider}: developer client id/secret missing — add them in Connections → API credentials`,
      connection.provider,
    );
  }

  const refreshToken = decryptSecret(connection.refreshToken);

  try {
    const result = await requestRefresh(
      connection,
      credentials.clientId,
      credentials.clientSecret,
      refreshToken,
    );
    const expiresAt = result.expiresInSec
      ? new Date(Date.now() + result.expiresInSec * 1000)
      : connection.tokenExpiresAt;

    await prisma.connection.update({
      where: { id: connection.id },
      data: {
        accessToken: encryptSecret(result.accessToken),
        refreshToken: encryptSecret(result.refreshToken ?? refreshToken),
        tokenExpiresAt: expiresAt,
        status: "ACTIVE",
        lastRefreshedAt: new Date(),
        lastError: null,
      },
    });

    await logJob({
      stage: "AUTH_REFRESH",
      level: "INFO",
      message: `Refreshed ${connection.provider} token`,
      connectionId: connection.id,
      data: { expiresAt: expiresAt?.toISOString() ?? null },
    });

    return result.accessToken;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await prisma.connection.update({
      where: { id: connection.id },
      data: { status: "EXPIRED", lastError: detail.slice(0, 2000) },
    });
    await logJob({
      stage: "AUTH_REFRESH",
      level: "ERROR",
      message: `Could not refresh ${connection.provider} token`,
      connectionId: connection.id,
      error,
    });
    throw error;
  }
}

/**
 * Decrypted access token, refreshed when it expires within two minutes.
 * Serialized per connection id to avoid refresh-token rotation races.
 */
export async function getValidAccessToken(
  connectionId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const existing = inFlight.get(connectionId);
  if (existing && !options.forceRefresh) return existing;

  const task = (async () => {
    const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new AdapterError("Connection no longer exists", "unknown");
    if (connection.provider === "PODCAST_RSS") return "";
    if (!connection.accessToken) {
      throw new AdapterError(
        `${connection.provider}: connection is not authorized — reconnect the account`,
        connection.provider,
      );
    }

    const expiring =
      connection.tokenExpiresAt !== null &&
      connection.tokenExpiresAt.getTime() - Date.now() < 120_000;

    if (options.forceRefresh || expiring) {
      return refreshConnectionToken(connection);
    }
    return decryptSecret(connection.accessToken);
  })();

  inFlight.set(connectionId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(connectionId);
  }
}

/** Maintenance: refresh every connection whose token expires soon. */
export async function refreshExpiringConnections(): Promise<number> {
  const soon = new Date(Date.now() + 15 * 60 * 1000);
  const connections = await prisma.connection.findMany({
    where: {
      autoRefresh: true,
      status: "ACTIVE",
      refreshToken: { not: null },
      tokenExpiresAt: { not: null, lte: soon },
    },
  });

  let refreshed = 0;
  for (const connection of connections) {
    try {
      await getValidAccessToken(connection.id);
      refreshed += 1;
    } catch (error) {
      console.error(`[oauth] refresh failed for ${connection.id}`, error);
    }
  }
  return refreshed;
}

/** Used by the Connections UI "Test connection" button. */
export async function testConnectionCredentials(connectionId: string) {
  const { sourceAdapterFor, destinationAdapterFor } = await import("@/lib/adapters/registry");
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AdapterError("Connection no longer exists", "unknown");

  if (connection.canDestination) {
    return destinationAdapterFor(connection).testConnection();
  }
  return sourceAdapterFor(connection).testConnection();
}
