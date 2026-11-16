import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  credentialsFor,
  oauthFamilyFor,
  platformForSlug,
  redirectUriFor,
  OAUTH_PENDING_COOKIE,
} from "@/lib/oauth/authorize";
import { getAppOrigin } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts an OAuth connect flow: /api/oauth/<platform-slug>/start
 * The platform slug (youtube, google-drive, tiktok…) is remembered in a
 * short-lived httpOnly cookie alongside the state and PKCE verifier.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await params;
  const appOrigin = await getAppOrigin();
  const failure = (message: string) =>
    NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(message)}`, appOrigin),
    );

  let platform;
  try {
    platform = platformForSlug(slug);
  } catch {
    return failure(`Unknown platform: ${slug}`);
  }

  const family = oauthFamilyFor(slug);
  if (!family) return failure(`${platform.label} does not use OAuth — add it manually instead.`);

  const credentials = await credentialsFor(slug);
  if (credentials.source === "missing") {
    return failure(
      `Add a ${platform.label} client id and secret in Connections → API credentials first.`,
    );
  }

  const state = createState();
  const pkce = family === "x" ? createPkcePair() : null;
  const redirectUri = redirectUriFor(platform, appOrigin);

  const authorizeUrl = buildAuthorizeUrl({
    platform,
    credentials,
    redirectUri,
    state,
    codeChallenge: pkce?.challenge,
  });

  const store = await cookies();
  store.set(
    OAUTH_PENDING_COOKIE,
    JSON.stringify({ slug, family, state, verifier: pkce?.verifier ?? null }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: appOrigin.startsWith("https://"),
      path: "/",
      maxAge: 10 * 60,
    },
  );

  return NextResponse.redirect(authorizeUrl);
}
