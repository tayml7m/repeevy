/**
 * OAuth 2.0 connect flows (authorize URL, code exchange, profile lookup and
 * connection persistence). Refresh is handled separately in oauth/refresh.ts.
 */
import { createHash, randomBytes } from "node:crypto";

import type { Connection, Provider } from "@prisma/client";

import { AdapterError } from "@/lib/adapters/types";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getPlatform, type PlatformDefinition } from "@/lib/platforms";
import { getProviderCredentials, type ProviderCredentials } from "@/lib/settings";

export const OAUTH_PENDING_COOKIE = "repurpose_oauth";

export type OAuthFamily = "google" | "tiktok" | "meta" | "x" | "linkedin" | "snapchat" | "dropbox";

const FAMILY_BY_SLUG: Record<string, OAuthFamily> = {
  tiktok: "tiktok",
  youtube: "google",
  "google-drive": "google",
  instagram: "meta",
  facebook: "meta",
  x: "x",
  linkedin: "linkedin",
  snapchat: "snapchat",
  dropbox: "dropbox",
};

export function oauthFamilyFor(slug: string): OAuthFamily | null {
  return FAMILY_BY_SLUG[slug] ?? null;
}

export function isOAuthPlatform(slug: string): boolean {
  return Boolean(FAMILY_BY_SLUG[slug]);
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString("base64url");
}

export function buildAuthorizeUrl(options: {
  platform: PlatformDefinition;
  credentials: ProviderCredentials;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const { platform, credentials, redirectUri, state, codeChallenge } = options;
  const family = oauthFamilyFor(platform.slug);
  if (!family) throw new AdapterError(`${platform.label} does not use OAuth`, platform.provider);

  const params = new URLSearchParams();
  params.set("redirect_uri", redirectUri);
  params.set("state", state);
  params.set("response_type", "code");

  switch (family) {
    case "google": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(" "));
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      params.set("include_granted_scopes", "true");
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    case "tiktok": {
      params.set("client_key", credentials.clientId);
      params.set("scope", platform.scopes.join(","));
      return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    }
    case "meta": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(","));
      return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
    }
    case "x": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(" "));
      if (codeChallenge) {
        params.set("code_challenge", codeChallenge);
        params.set("code_challenge_method", "S256");
      }
      return `https://x.com/i/oauth2/authorize?${params.toString()}`;
    }
    case "linkedin": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(" "));
      return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    }
    case "snapchat": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(" "));
      return `https://accounts.snapchat.com/accounts/oauth2/auth?${params.toString()}`;
    }
    case "dropbox": {
      params.set("client_id", credentials.clientId);
      params.set("scope", platform.scopes.join(" "));
      params.set("token_access_type", "offline");
      return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
    }
  }
}

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  scopes: string[];
  openId?: string;
};

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
  error_message?: string;
};

function basicAuth(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function parseTokenResponse(
  provider: string,
  response: Response,
  fallbackScopes: string[],
): Promise<TokenSet> {
  const text = await response.text();
  let payload: TokenPayload;
  try {
    payload = JSON.parse(text) as TokenPayload;
  } catch {
    throw new AdapterError(`${provider}: token endpoint returned non-JSON`, provider, text.slice(0, 500));
  }
  if (!response.ok || !payload.access_token) {
    throw new AdapterError(
      `${provider}: authorization failed (HTTP ${response.status})`,
      provider,
      payload.error_description ?? payload.error_message ?? payload.error ?? text.slice(0, 500),
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresInSec: payload.expires_in,
    openId: payload.open_id,
    scopes: payload.scope ? payload.scope.split(/[ ,]+/).filter(Boolean) : fallbackScopes,
  };
}

export async function exchangeAuthorizationCode(args: {
  platform: PlatformDefinition;
  credentials: ProviderCredentials;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<TokenSet> {
  const { platform, credentials, code, redirectUri, codeVerifier } = args;
  const family = oauthFamilyFor(platform.slug);
  if (!family) throw new AdapterError(`${platform.label} does not use OAuth`, platform.provider);

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);

  if (family === "google" || family === "linkedin" || family === "snapchat") {
    form.set("client_id", credentials.clientId);
    form.set("client_secret", credentials.clientSecret);
  }
  if (family === "tiktok") {
    form.set("client_key", credentials.clientId);
    form.set("client_secret", credentials.clientSecret);
  }
  if (family === "x") {
    form.set("client_id", credentials.clientId);
    if (codeVerifier) form.set("code_verifier", codeVerifier);
  }

  let response: Response;
  switch (family) {
    case "google":
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      break;
    case "tiktok":
      response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      break;
    case "meta": {
      const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      url.searchParams.set("client_id", credentials.clientId);
      url.searchParams.set("client_secret", credentials.clientSecret);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("code", code);
      response = await fetch(url);
      break;
    }
    case "x":
      response = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(credentials.clientId, credentials.clientSecret),
        },
        body: form,
      });
      break;
    case "linkedin":
      response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      break;
    case "snapchat":
      response = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      break;
    case "dropbox":
      response = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(credentials.clientId, credentials.clientSecret),
        },
        body: form,
      });
      break;
  }

  return parseTokenResponse(platform.provider, response, platform.scopes);
}

export type AccountProfile = {
  accountId?: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
};

/** Best-effort profile lookup so the connection card shows a real account. */
export async function fetchAccountProfile(
  platform: PlatformDefinition,
  tokens: TokenSet,
): Promise<AccountProfile> {
  const family = oauthFamilyFor(platform.slug);
  const auth = { authorization: `Bearer ${tokens.accessToken}` };
  try {
    switch (family) {
      case "google": {
        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: auth });
        if (!response.ok) return {};
        const data = (await response.json()) as {
          sub?: string;
          name?: string;
          email?: string;
          picture?: string;
        };
        return {
          accountId: data.sub,
          name: data.name ?? data.email,
          avatarUrl: data.picture,
        };
      }
      case "tiktok": {
        const response = await fetch(
          "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
          { headers: auth },
        );
        if (!response.ok) return { accountId: tokens.openId };
        const data = (await response.json()) as {
          data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
        };
        const user = data.data?.user;
        return {
          accountId: user?.open_id ?? tokens.openId,
          name: user?.display_name,
          avatarUrl: user?.avatar_url,
        };
      }
      case "meta": {
        const url = new URL("https://graph.facebook.com/v21.0/me");
        url.searchParams.set("fields", "id,name,picture");
        url.searchParams.set("access_token", tokens.accessToken);
        const response = await fetch(url);
        if (!response.ok) return {};
        const data = (await response.json()) as {
          id?: string;
          name?: string;
          picture?: { data?: { url?: string } };
        };
        return { accountId: data.id, name: data.name, avatarUrl: data.picture?.data?.url };
      }
      case "x": {
        const response = await fetch("https://api.x.com/2/users/me", { headers: auth });
        if (!response.ok) return {};
        const data = (await response.json()) as {
          data?: { id?: string; name?: string; username?: string };
        };
        return {
          accountId: data.data?.id,
          name: data.data?.name,
          username: data.data?.username,
        };
      }
      case "linkedin": {
        const response = await fetch("https://api.linkedin.com/v2/userinfo", { headers: auth });
        if (!response.ok) return {};
        const data = (await response.json()) as {
          sub?: string;
          name?: string;
          picture?: string;
        };
        return { accountId: data.sub, name: data.name, avatarUrl: data.picture };
      }
      case "dropbox": {
        const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
          method: "POST",
          headers: auth,
        });
        if (!response.ok) return {};
        const data = (await response.json()) as {
          account_id?: string;
          name?: { display_name?: string };
          profile_photo_url?: string;
        };
        return {
          accountId: data.account_id,
          name: data.name?.display_name,
          avatarUrl: data.profile_photo_url,
        };
      }
      default:
        return {};
    }
  } catch {
    return {};
  }
}

/** Creates or updates the single connection row for this account. */
export async function persistConnection(
  platform: PlatformDefinition,
  tokens: TokenSet,
  profile: AccountProfile,
): Promise<Connection> {
  const provider = platform.provider as Provider;
  const accountId = profile.accountId ?? tokens.openId ?? null;
  const tokenExpiresAt = tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null;

  const existing = accountId
    ? await prisma.connection.findFirst({ where: { provider, accountId } })
    : null;

  const data = {
    provider,
    label: profile.name ? `${platform.label} · ${profile.name}` : platform.label,
    authType: "OAUTH" as const,
    status: "ACTIVE" as const,
    accountId,
    accountName: profile.name ?? null,
    username: profile.username ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    tokenExpiresAt,
    scopes: tokens.scopes,
    canSource: platform.source.length > 0,
    canDestination: platform.destination.length > 0,
    lastRefreshedAt: new Date(),
    lastCheckedAt: new Date(),
    lastError: null,
    metadata: {
      oauthFamily: oauthFamilyFor(platform.slug),
      platformSlug: platform.slug,
    },
  };

  if (existing) {
    return prisma.connection.update({ where: { id: existing.id }, data });
  }
  return prisma.connection.create({ data });
}

/** Resolves the redirect URI registered with the provider. */
export function redirectUriFor(platform: PlatformDefinition, appOrigin: string): string {
  return `${appOrigin.replace(/\/$/, "")}${platform.callbackPath}`;
}

export async function credentialsFor(slug: string): Promise<ProviderCredentials> {
  return getProviderCredentials(slug);
}

export function platformForSlug(slug: string): PlatformDefinition {
  return getPlatform(slug);
}
