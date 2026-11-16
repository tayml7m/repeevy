import Redis, { type RedisOptions } from "ioredis";

import { env } from "@/lib/env";

/**
 * BullMQ wants its own connections (workers issue blocking commands), so we
 * hand it options and let it create/duplicate connections per queue/worker.
 */
export function redisConnectionOptions(): RedisOptions {
  const url = new URL(env.REDIS_URL);
  const dbPath = url.pathname.replace(/^\//, "");
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    ...(dbPath ? { db: Number(dbPath) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

/**
 * Producer connections (API routes / server actions). Unlike workers they must
 * fail fast when Redis is down instead of queueing commands forever.
 */
export function producerConnectionOptions(): RedisOptions {
  return {
    ...redisConnectionOptions(),
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    // Never reconnect in the background: a server action should fail once, not
    // leave a retrying socket attached to the web process.
    retryStrategy: () => null,
  };
}

/** Short-lived client for one-off checks so a dead Redis can't hang the UI. */
export async function pingRedis(timeoutMs = 1500): Promise<{ ok: boolean; detail: string }> {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  // ioredis logs "Unhandled error event" without a listener; the caller below
  // reports the failure as a check instead of a stack trace.
  client.on("error", () => undefined);
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === "PONG", detail: `Redis replied ${pong}` };
  } catch (error) {
    // Never echo the URL: it can contain credentials.
    const detail = error instanceof Error ? error.message : "Unreachable";
    return { ok: false, detail: `Redis unreachable (${detail}) — check REDIS_URL` };
  } finally {
    client.disconnect();
  }
}
