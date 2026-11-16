/**
 * Cron sweep: enqueue a detect job for every active workflow whose poll
 * interval has elapsed. Actual polling intervals live in the database, so the
 * worker tick can stay a cheap one-minute heartbeat.
 */
import { prisma } from "@/lib/db";
import { enqueueDetect } from "@/lib/pipeline/enqueue";

export async function sweepDueWorkflows(limit = 200): Promise<number> {
  const workflows = await prisma.workflow.findMany({
    where: { isActive: true },
    select: { id: true, pollIntervalMinutes: true, lastPolledAt: true },
    take: limit,
  });

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  let queued = 0;

  for (const workflow of workflows) {
    const intervalMs = Math.max(1, workflow.pollIntervalMinutes) * 60_000;
    const due =
      !workflow.lastPolledAt || now - workflow.lastPolledAt.getTime() >= intervalMs;
    if (!due) continue;

    // Deterministic job id per minute: overlapping sweeps can't double-poll.
    await enqueueDetect(workflow.id, "schedule", minuteBucket);
    queued += 1;
  }

  return queued;
}
