/**
 * Runtime environment. Parsing is lazy and non-throwing so that
 * `next build` (which runs without a database) never fails; missing
 * infrastructure is surfaced as `degraded` in /api/health instead.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Repurpose Studio"),

  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  // Encrypts OAuth tokens + secret settings at rest (min 32 chars recommended).
  APP_SECRET: z.string().default(""),
  // Optional bearer token for /api/cron/* triggers.
  CRON_SECRET: z.string().default(""),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  // Container default; local development falls back to ./media in the project.
  MEDIA_ROOT: z.string().default(process.env.NODE_ENV === "production" ? "/data/media" : "./media"),
  MEDIA_RETENTION_HOURS: z.coerce.number().int().nonnegative().default(24),
  MEDIA_BASE_URL: z.string().default(""),

  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  S3_PUBLIC_BASE_URL: z.string().default(""),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  YTDLP_PATH: z.string().default("yt-dlp"),
  YTDLP_COOKIES_FILE: z.string().default(""),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  POLL_DEFAULT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  TZ: z.string().default("UTC"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] invalid environment", parsed.error.flatten().fieldErrors);
}

export const env = parsed.success ? parsed.data : schema.parse({});

export const isProduction = env.NODE_ENV === "production";
export const hasDatabase = env.DATABASE_URL.length > 0;
export const hasSecret = env.APP_SECRET.length > 0;
export const hasRedis = env.REDIS_URL.length > 0;
export const storageDriver = env.STORAGE_DRIVER;
