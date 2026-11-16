/**
 * Maintenance tick handler kept separate from the worker entrypoint so the
 * polling sweep can be unit-tested or triggered from an API route.
 */
import { logJob } from "@/lib/pipeline/logger";
import { sweepDueWorkflows } from "@/lib/pipeline/poll";

export async function pollTickHandler(queueJobId?: string): Promise<{ queued: number }> {
  const queued = await sweepDueWorkflows();
  if (queued > 0) {
    await logJob({
      stage: "POLL",
      message: `Poll sweep queued ${queued} workflow(s)`,
      queueJobId: queueJobId ?? null,
      data: { queued },
    });
  }
  return { queued };
}
