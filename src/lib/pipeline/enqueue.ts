/**
 * Queue producers shared by API routes, server actions and the worker's own
 * repeat jobs. One Queue instance per name per process.
 */
import { Queue, type JobsOptions } from "bullmq";

import { jobId, QUEUES, type MaintenanceJob, type QueueName } from "@/lib/queue";
import { producerConnectionOptions } from "@/lib/redis";

const queues = new Map<QueueName, Queue>();

/**
 * BullMQ waits for its connection to become ready, so a dead Redis would leave
 * a server action hanging forever. Producers therefore race the add against a
 * short timeout and surface a normal action error instead.
 */
const ENQUEUE_TIMEOUT_MS = 5_000;

async function addJob(
  name: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  options: JobsOptions,
) {
  const queue = queueFor(name);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      queue.add(jobName, data, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Redis unavailable — could not queue ${jobName} within ${ENQUEUE_TIMEOUT_MS / 1000}s`,
              ),
            ),
          ENQUEUE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    queues.delete(name);
    void queue.close().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function queueFor(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: producerConnectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 20_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  queues.set(name, queue);
  return queue;
}

export async function enqueueDetect(
  workflowId: string,
  reason: "schedule" | "manual" | "backlog" = "schedule",
  bucket?: number,
): Promise<string | undefined> {
  // Scheduled polls dedupe within the minute bucket; manual/backlog runs get
  // their own id so a "Run now" click is never swallowed by a recent poll.
  const slot = reason === "schedule" ? (bucket ?? Math.floor(Date.now() / 60_000)) : Date.now();
  const job = await addJob(
    QUEUES.DETECT,
    "detect",
    { workflowId, reason },
    { jobId: jobId("detect", workflowId, reason, slot) },
  );
  return job.id;
}

export async function enqueueProcess(
  contentItemId: string,
  options: { force?: boolean; autoPublish?: boolean } = {},
): Promise<string | undefined> {
  const job = await addJob(
    QUEUES.PROCESS,
    "process",
    { contentItemId, force: options.force ?? false, autoPublish: options.autoPublish ?? false },
    {
      // Unique id so a re-run always executes; short TTL dedupe stops bursts.
      jobId: jobId("process", contentItemId, Date.now()),
      deduplication: { id: jobId("dedupe-process", contentItemId), ttl: 30_000 },
      attempts: 2,
    },
  );
  return job.id;
}

export async function enqueuePublish(
  contentItemId: string,
  options: { force?: boolean } = {},
): Promise<string | undefined> {
  const job = await addJob(
    QUEUES.PUBLISH,
    "publish",
    { contentItemId },
    {
      jobId: jobId("publish", contentItemId, Date.now()),
      deduplication: { id: jobId("dedupe-publish", contentItemId), ttl: 30_000 },
      // Do not retry automatically: a partial upload must not duplicate posts.
      attempts: 1,
    },
  );
  return job.id;
}

export async function enqueueMaintenance(kind: MaintenanceJob["kind"]): Promise<string | undefined> {
  const job = await queueFor(QUEUES.MAINTENANCE).add(kind, { kind } satisfies MaintenanceJob);
  return job.id;
}

/** Repeatable maintenance schedules — only ever added to the maintenance queue. */
export async function scheduleRepeat(
  kind: MaintenanceJob["kind"],
  everyMs: number,
  repeatJobId: string,
): Promise<void> {
  await queueFor(QUEUES.MAINTENANCE).add(kind, { kind } satisfies MaintenanceJob, {
    jobId: repeatJobId,
    repeat: { every: everyMs },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  });
}

export async function closeQueues(): Promise<void> {
  const all = [...queues.values()];
  queues.clear();
  await Promise.all(all.map((queue) => queue.close()));
}
