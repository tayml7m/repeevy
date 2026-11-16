/**
 * 24/7 background worker (separate container from Next.js).
 *
 * Queues: detect (polling), process (download + FFmpeg), publish (uploads),
 * maintenance (repeat sweeps: poll/drip/tokens/cleanup/heartbeat).
 */
import { Worker, type Job } from "bullmq";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { refreshExpiringConnections } from "@/lib/oauth/refresh";
import { cleanupExpiredMedia } from "@/lib/pipeline/cleanup";
import { detectForWorkflow } from "@/lib/pipeline/detect";
import { closeQueues, scheduleRepeat } from "@/lib/pipeline/enqueue";
import { logJob } from "@/lib/pipeline/logger";
import { pollTickHandler } from "@/lib/pipeline/poll-handlers";
import { processContentItem } from "@/lib/pipeline/process";
import { publishContentItem } from "@/lib/pipeline/publish";
import { publishDueScheduled } from "@/lib/pipeline/schedule";
import {
  QUEUES,
  type DetectJob,
  type MaintenanceJob,
  type ProcessJob,
  type PublishJob,
} from "@/lib/queue";
import { redisConnectionOptions } from "@/lib/redis";

const MINUTE = 60_000;
const log = (message: string, meta?: Record<string, unknown>) => {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[worker ${new Date().toISOString()}] ${message}${suffix}`);
};

async function handleMaintenance(job: Job<MaintenanceJob>): Promise<unknown> {
  switch (job.data?.kind) {
    case "heartbeat": {
      await logJob({
        stage: "SYSTEM",
        message: "Worker heartbeat",
        queueJobId: String(job.id),
        data: {
          uptimeSec: Math.round(process.uptime()),
          concurrency: env.WORKER_CONCURRENCY,
          worker: "maintenance",
        },
      });
      return { ok: true };
    }
    case "poll-sweep":
      return pollTickHandler(String(job.id));
    case "drip-tick": {
      const count = await publishDueScheduled();
      return { due: count };
    }
    case "token-refresh": {
      const refreshed = await refreshExpiringConnections();
      return { refreshed };
    }
    case "cleanup-media":
      return cleanupExpiredMedia();
    default:
      return { ignored: true };
  }
}

async function main() {
  log("booting", {
    node: process.version,
    database: Boolean(env.DATABASE_URL),
    mediaRoot: env.MEDIA_ROOT,
  });

  // Fail fast if the schema/migrations aren't applied yet.
  await prisma.$queryRaw`SELECT 1`;

  const connection = redisConnectionOptions();

  const workers = [
    new Worker<DetectJob>(
      QUEUES.DETECT,
      async (job) =>
        detectForWorkflow(job.data.workflowId, job.data.reason ?? "schedule", String(job.id)),
      { connection, concurrency: 3, lockDuration: 120_000 },
    ),
    new Worker<ProcessJob>(
      QUEUES.PROCESS,
      async (job) =>
        processContentItem(job.data.contentItemId, {
          queueJobId: String(job.id),
          force: job.data.force,
          autoPublish: job.data.autoPublish,
        }),
      {
        connection,
        concurrency: env.WORKER_CONCURRENCY,
        lockDuration: 20 * 60_000,
      },
    ),
    new Worker<PublishJob>(
      QUEUES.PUBLISH,
      async (job) =>
        publishContentItem(job.data.contentItemId, { queueJobId: String(job.id) }),
      { connection, concurrency: 2, lockDuration: 10 * 60_000 },
    ),
    new Worker<MaintenanceJob>(QUEUES.MAINTENANCE, handleMaintenance, {
      connection,
      concurrency: 1,
      lockDuration: 5 * 60_000,
    }),
  ];

  for (const worker of workers) {
    worker.on("completed", (job) => log(`completed ${worker.name}:${job.name}`, { id: job.id }));
    worker.on("failed", (job, error) =>
      log(`failed ${worker.name}:${job?.name ?? "?"}`, {
        id: job?.id,
        attempts: job?.attemptsMade,
        error: error.message,
      }),
    );
    worker.on("error", (error) => log(`worker error (${worker.name})`, { error: error.message }));
  }

  // Repeat schedules live on the maintenance queue only — including the
  // heartbeat, so no other queue accumulates one.
  await scheduleRepeat("heartbeat", 5 * MINUTE, "worker-heartbeat");
  await scheduleRepeat("poll-sweep", MINUTE, "poll-sweep");
  await scheduleRepeat("drip-tick", MINUTE, "drip-tick");
  await scheduleRepeat("token-refresh", 30 * MINUTE, "token-refresh");
  await scheduleRepeat("cleanup-media", 60 * MINUTE, "cleanup-media");

  log("ready", {
    queues: Object.values(QUEUES),
    processConcurrency: env.WORKER_CONCURRENCY,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, draining`);
    const deadline = setTimeout(() => {
      log("drain timeout — forcing exit");
      process.exit(1);
    }, 90_000);

    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await closeQueues();
      await prisma.$disconnect();
    } catch (error) {
      log("shutdown error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(deadline);
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[worker] fatal", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
