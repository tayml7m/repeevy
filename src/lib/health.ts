import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import { env, hasDatabase } from "@/lib/env";
import { pingRedis } from "@/lib/redis";

const exec = promisify(execFile);

export type CheckState = "ok" | "warn" | "error";

export type HealthCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
};

export type HealthReport = {
  status: "ok" | "degraded";
  checks: HealthCheck[];
  version: string;
  checkedAt: string;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function toolVersion(binary: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(binary, args, { timeout: 4000 });
    return stdout.split("\n")[0]?.trim() || "installed";
  } catch {
    return "";
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // PostgreSQL
  if (!hasDatabase) {
    checks.push({
      id: "database",
      label: "PostgreSQL",
      state: "warn",
      detail: "DATABASE_URL is not set — add it to .env and restart.",
    });
  } else {
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 3000, "Database did not answer within 3s");
      checks.push({ id: "database", label: "PostgreSQL", state: "ok", detail: "Connected" });
    } catch (error) {
      checks.push({
        id: "database",
        label: "PostgreSQL",
        state: "error",
        detail: error instanceof Error ? error.message : "Unreachable",
      });
    }
  }

  // Redis + BullMQ
  const redis = await pingRedis();
  checks.push({
    id: "redis",
    label: "Redis / BullMQ",
    state: redis.ok ? "ok" : "error",
    detail: redis.detail,
  });

  // Media pipeline binaries
  const [ffmpeg, ytdlp] = await Promise.all([
    toolVersion(env.FFMPEG_PATH, ["-version"]),
    toolVersion(env.YTDLP_PATH, ["--version"]),
  ]);
  checks.push({
    id: "ffmpeg",
    label: "FFmpeg",
    state: ffmpeg ? "ok" : "error",
    detail: ffmpeg || "Not found — install ffmpeg in the image.",
  });
  checks.push({
    id: "yt-dlp",
    label: "yt-dlp",
    state: ytdlp ? "ok" : "error",
    detail: ytdlp ? `version ${ytdlp}` : "Not found — install yt-dlp in the image.",
  });

  // Media volume
  try {
    await mkdir(env.MEDIA_ROOT, { recursive: true });
    await access(env.MEDIA_ROOT, constants.W_OK);
    checks.push({
      id: "media",
      label: "Media storage",
      state: "ok",
      detail: `${env.STORAGE_DRIVER} · ${env.MEDIA_ROOT} writable`,
    });
  } catch (error) {
    checks.push({
      id: "media",
      label: "Media storage",
      state: "error",
      detail: error instanceof Error ? error.message : `${env.MEDIA_ROOT} not writable`,
    });
  }

  // Token encryption key
  checks.push({
    id: "secret",
    label: "Token encryption",
    state: env.APP_SECRET.length >= 16 ? "ok" : "warn",
    detail:
      env.APP_SECRET.length >= 16
        ? "APP_SECRET set — OAuth tokens encrypted at rest"
        : "Set APP_SECRET (16+ chars) before connecting accounts",
  });

  const status = checks.some((check) => check.state === "error") ? "degraded" : "ok";

  return {
    status,
    checks,
    version: process.env.npm_package_version ?? "0.1.0",
    checkedAt: new Date().toISOString(),
  };
}
