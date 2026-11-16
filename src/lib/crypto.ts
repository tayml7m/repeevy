/**
 * AES-256-GCM encryption for OAuth tokens and secret settings stored in
 * PostgreSQL. The key is derived from APP_SECRET (scrypt), so rotating the
 * secret requires re-saving credentials — documented in README.
 *
 * Format: v1.<iv base64url>.<auth tag base64url>.<ciphertext base64url>
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "@/lib/env";

const PREFIX = "v1";
const KEY_SALT = "repurpose-studio::token-encryption";

function deriveKey(): Buffer {
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new Error(
      "APP_SECRET must be set to a random string of at least 16 characters before storing credentials.",
    );
  }
  return scryptSync(env.APP_SECRET, KEY_SALT, 32);
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${PREFIX}.`);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  if (!isEncrypted(payload)) return payload; // tolerate legacy plaintext rows
  const [, ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

/** Never render a full credential in the UI or logs. */
export function maskSecret(value?: string | null): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
