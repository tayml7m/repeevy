/**
 * Queue contract shared by the web app (producer) and the worker (consumer).
 * Keeping the names and payload types in one module means an API route can
 * enqueue work without importing any processing code.
 */
export const QUEUES = {
  /** Source polling: one repeatable job per active workflow. */
  DETECT: "detect",
  /** Download + FFmpeg/yt-dlp pipeline for one ContentItem. */
  PROCESS: "process",
  /** Upload + publish to every destination target. */
  PUBLISH: "publish",
  /** Drip scheduler + token refresh + media cleanup. */
  MAINTENANCE: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type DetectJob = { workflowId: string; reason?: "schedule" | "manual" | "backlog" };
export type ProcessJob = { contentItemId: string; force?: boolean; autoPublish?: boolean };
export type PublishJob = { contentItemId: string; targetIds?: string[] };
export type MaintenanceJob =
  | { kind: "heartbeat" }
  | { kind: "poll-sweep" }
  | { kind: "drip-tick" }
  | { kind: "token-refresh" }
  | { kind: "cleanup-media" };

export type JobPayloadMap = {
  [QUEUES.DETECT]: DetectJob;
  [QUEUES.PROCESS]: ProcessJob;
  [QUEUES.PUBLISH]: PublishJob;
  [QUEUES.MAINTENANCE]: MaintenanceJob;
};

/** Deterministic BullMQ job id so a post can never be queued twice. */
export function jobId(...parts: Array<string | number>): string {
  return parts.join(":").replace(/[^a-zA-Z0-9:_-]/g, "_");
}
