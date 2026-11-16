import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { logJob } from "@/lib/pipeline/logger";
import {
  credentialsFor,
  exchangeAuthorizationCode,
  fetchAccountProfile,
  oauthFamilyFor,
  persistConnection,
  platformForSlug,
  redirectUriFor,
  OAUTH_PENDING_COOKIE,
} from "@/lib/oauth/authorize";
import { getAppOrigin } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Pending = { slug: string; family: string; state: string; verifier?: string | null };

/** OAuth callback: /api/oauth/<family>/callback?code=...&state=... */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: family } = await params;
  const url = new URL(request.url);
  const appOrigin = await getAppOrigin();
  const redirect = (query: string) => {
    const response = NextResponse.redirect(new URL(`/connections?${query}`, appOrigin));
    response.cookies.set(OAUTH_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return redirect(`error=${encodeURIComponent(providerError)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return redirect("error=Missing%20authorization%20code");

  const store = await cookies();
  const pendingRaw = store.get(OAUTH_PENDING_COOKIE)?.value;
  if (!pendingRaw) return redirect("error=OAuth%20session%20expired%20-%20start%20again");

  let pending: Pending;
  try {
    pending = JSON.parse(pendingRaw) as Pending;
  } catch {
    return redirect("error=OAuth%20session%20is%20invalid");
  }

  if (pending.state !== state) return redirect("error=OAuth%20state%20mismatch");
  if (pending.family !== family) return redirect("error=OAuth%20provider%20mismatch");

  let platform;
  try {
    platform = platformForSlug(pending.slug);
  } catch {
    return redirect("error=Unknown%20platform");
  }

  try {
    const credentials = await credentialsFor(platform.slug);
    if (credentials.source === "missing") {
      return redirect("error=Missing%20developer%20credentials");
    }

    const tokens = await exchangeAuthorizationCode({
      platform,
      credentials,
      code,
      redirectUri: redirectUriFor(platform, appOrigin),
      codeVerifier: pending.verifier ?? undefined,
    });
    const profile = await fetchAccountProfile(platform, tokens);
    const connection = await persistConnection(platform, tokens, profile);

    await logJob({
      stage: "AUTH_REFRESH",
      message: `Connected ${platform.label}`,
      connectionId: connection.id,
      data: { accountName: profile.name ?? null, scopes: tokens.scopes },
    });

    return redirect(`connected=${encodeURIComponent(platform.slug)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    await logJob({
      stage: "AUTH_REFRESH",
      level: "ERROR",
      message: `Could not connect ${platform.label}`,
      error,
    });
    return redirect(`error=${encodeURIComponent(message)}`);
  }
}
