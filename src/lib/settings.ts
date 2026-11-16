/**
 * Settings access layer. DB values win over environment variables so the
 * owner can paste developer app credentials in the browser without a redeploy;
 * environment variables remain the fallback for infrastructure-style config.
 */
import type { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getPlatform } from "@/lib/platforms";

export type ProviderCredentials = {
  clientId: string;
  clientSecret: string;
  source: "database" | "environment" | "missing";
};

function unwrap(value: Prisma.JsonValue): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "ciphertext" in value) {
    const ciphertext = (value as { ciphertext?: unknown }).ciphertext;
    if (isEncrypted(ciphertext)) return JSON.parse(decryptSecret(ciphertext));
  }
  return value;
}

export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.appConfig.findUnique({ where: { key } });
    if (!row) return fallback;
    return unwrap(row.value) as T;
  } catch (error) {
    console.error(`[settings] could not read ${key}`, error);
    return fallback;
  }
}

export async function writeSetting(
  key: string,
  value: Prisma.InputJsonValue,
  options: { secret?: boolean; description?: string } = {},
): Promise<void> {
  const payload = options.secret
    ? ({ ciphertext: encryptSecret(JSON.stringify(value)) } as Prisma.InputJsonValue)
    : value;

  await prisma.appConfig.upsert({
    where: { key },
    update: { value: payload, isSecret: options.secret ?? false, description: options.description },
    create: {
      key,
      value: payload,
      isSecret: options.secret ?? false,
      description: options.description,
    },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.appConfig.deleteMany({ where: { key } });
}

/** Resolve developer app credentials: DB first, then env, then missing. */
export async function getProviderCredentials(slug: string): Promise<ProviderCredentials> {
  const platform = getPlatform(slug);
  const stored = await readSetting<{ clientId?: string; clientSecret?: string } | null>(
    `oauth.${platform.slug}`,
    null,
  );

  if (stored?.clientId && stored?.clientSecret) {
    return { clientId: stored.clientId, clientSecret: stored.clientSecret, source: "database" };
  }

  const clientId = platform.env.clientId?.map((name) => process.env[name]).find(Boolean) ?? "";
  const clientSecret = platform.env.clientSecret?.map((name) => process.env[name]).find(Boolean) ?? "";

  if (clientId && clientSecret) {
    return { clientId, clientSecret, source: "environment" };
  }

  return { clientId, clientSecret, source: "missing" };
}

export async function listOAuthCredentialStatus(): Promise<
  Record<string, { configured: boolean; source: ProviderCredentials["source"] }>
> {
  const platforms = ["tiktok", "youtube", "instagram", "facebook", "x", "linkedin", "snapchat", "google-drive", "dropbox"];
  const entries = await Promise.all(
    platforms.map(async (slug) => {
      const credentials = await getProviderCredentials(slug);
      return [slug, { configured: credentials.source !== "missing", source: credentials.source }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Media/storage settings, merging env defaults with DB overrides. */
export type StorageSettings = {
  driver: "local" | "s3";
  mediaRoot: string;
  retentionHours: number;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    publicBaseUrl: string;
  };
};

export async function getStorageSettings(): Promise<StorageSettings> {
  const stored = await readSetting<Partial<StorageSettings> | null>("storage.config", null);
  return {
    driver: stored?.driver ?? (process.env.STORAGE_DRIVER === "s3" ? "s3" : "local"),
    mediaRoot: stored?.mediaRoot ?? process.env.MEDIA_ROOT ?? "/data/media",
    retentionHours: stored?.retentionHours ?? Number(process.env.MEDIA_RETENTION_HOURS ?? 24),
    s3: {
      endpoint: stored?.s3?.endpoint ?? process.env.S3_ENDPOINT ?? "",
      region: stored?.s3?.region ?? process.env.S3_REGION ?? "auto",
      bucket: stored?.s3?.bucket ?? process.env.S3_BUCKET ?? "",
      accessKeyId: stored?.s3?.accessKeyId ?? process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: stored?.s3?.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY ?? "",
      forcePathStyle: stored?.s3?.forcePathStyle ?? process.env.S3_FORCE_PATH_STYLE === "true",
      publicBaseUrl: stored?.s3?.publicBaseUrl ?? process.env.S3_PUBLIC_BASE_URL ?? "",
    },
  };
}
