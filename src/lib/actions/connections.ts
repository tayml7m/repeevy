"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { getValidAccessToken, testConnectionCredentials } from "@/lib/oauth/refresh";
import { getPlatform } from "@/lib/platforms";
import { deleteSetting, getProviderCredentials, writeSetting } from "@/lib/settings";
import { actionError, type ActionResult } from "@/lib/actions/types";

function revalidateConnections() {
  revalidatePath("/connections");
  revalidatePath("/workflows");
  revalidatePath("/");
}

/** Save developer app credentials (encrypted) for a platform. */
export async function saveCredentialsAction(input: {
  slug: string;
  clientId: string;
  clientSecret: string;
}): Promise<ActionResult> {
  try {
    const platform = getPlatform(input.slug);
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();

    if (!clientId || !clientSecret) {
      return { ok: false, message: "Both client id and client secret are required" };
    }

    await writeSetting(
      `oauth.${platform.slug}`,
      { clientId, clientSecret },
      { secret: true, description: `${platform.label} developer app credentials` },
    );

    revalidateConnections();
    return { ok: true, message: `${platform.label} credentials saved` };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteCredentialsAction(slug: string): Promise<ActionResult> {
  try {
    const platform = getPlatform(slug);
    await deleteSetting(`oauth.${platform.slug}`);
    revalidateConnections();
    return { ok: true, message: `${platform.label} credentials removed` };
  } catch (error) {
    return actionError(error);
  }
}

export async function credentialStatusAction(slug: string): Promise<ActionResult> {
  try {
    const credentials = await getProviderCredentials(slug);
    return {
      ok: credentials.source !== "missing",
      message:
        credentials.source === "database"
          ? "Saved credentials found in the database"
          : credentials.source === "environment"
            ? "Using credentials from environment variables"
            : "No credentials configured yet",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function testConnectionAction(connectionId: string): Promise<ActionResult> {
  try {
    const result = await testConnectionCredentials(connectionId);
    await prisma.connection.update({
      where: { id: connectionId },
      data: { lastCheckedAt: new Date(), lastError: result.ok ? null : result.detail },
    });
    revalidateConnections();
    return { ok: result.ok, message: result.detail };
  } catch (error) {
    return actionError(error);
  }
}

export async function refreshTokenAction(connectionId: string): Promise<ActionResult> {
  try {
    await getValidAccessToken(connectionId, { forceRefresh: true });
    revalidateConnections();
    return { ok: true, message: "Access token refreshed" };
  } catch (error) {
    return actionError(error);
  }
}

export async function disconnectAction(connectionId: string): Promise<ActionResult> {
  try {
    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        status: "DISCONNECTED",
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        lastError: null,
      },
    });
    revalidateConnections();
    return { ok: true, message: "Disconnected — tokens removed" };
  } catch (error) {
    return actionError(error);
  }
}
