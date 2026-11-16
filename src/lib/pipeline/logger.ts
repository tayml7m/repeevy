/**
 * Structured job logging. Logging must never take down a pipeline step, so
 * every write is best-effort.
 */
import type { JobStage, LogLevel, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type LogInput = {
  stage: JobStage;
  message: string;
  level?: LogLevel;
  workflowId?: string | null;
  contentItemId?: string | null;
  connectionId?: string | null;
  targetId?: string | null;
  queueJobId?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  data?: Record<string, unknown> | null;
  error?: unknown;
};

function errorParts(error: unknown): { message: string; stack?: string; data?: Record<string, unknown> } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      data: "detail" in error && typeof error.detail === "string" ? { detail: error.detail } : undefined,
    };
  }
  return { message: String(error) };
}

export async function logJob(input: LogInput): Promise<void> {
  const failure = input.error ? errorParts(input.error) : null;
  const level = input.level ?? (failure ? "ERROR" : "INFO");
  const message = failure ? `${input.message}: ${failure.message}` : input.message;

  const data = {
    ...(input.data ?? {}),
    ...(failure?.data ?? {}),
  };

  try {
    await prisma.jobLog.create({
      data: {
        stage: input.stage,
        level,
        message: message.slice(0, 4000),
        workflowId: input.workflowId ?? null,
        contentItemId: input.contentItemId ?? null,
        connectionId: input.connectionId ?? null,
        targetId: input.targetId ?? null,
        queueJobId: input.queueJobId ?? null,
        attempt: input.attempt ?? null,
        durationMs: input.durationMs ?? null,
        data: Object.keys(data).length
          ? (data as unknown as Prisma.InputJsonValue)
          : undefined,
        stack: failure?.stack?.slice(0, 8000) ?? null,
      },
    });
  } catch (error) {
    console.error("[log] failed to persist job log", error);
  }
}

/** Measures a pipeline stage and logs its duration. */
export async function runStage<T>(
  stage: JobStage,
  message: string,
  context: Omit<LogInput, "stage" | "message">,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await logJob({ ...context, stage, message, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    await logJob({ ...context, stage, message: `${message} failed`, error, durationMs: Date.now() - startedAt });
    throw error;
  }
}
