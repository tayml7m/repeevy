/**
 * Polling detector: asks the source adapter for recent posts, applies filters,
 * inserts new ContentItems (strict DB dedupe) and queues processing.
 */
import { Prisma } from "@prisma/client";

import { sourceAdapterFor } from "@/lib/adapters/registry";
import { mediaKindToType, type SourcePost } from "@/lib/adapters/types";
import { prisma } from "@/lib/db";
import { logJob } from "@/lib/pipeline/logger";
import { evaluateSourcePost } from "@/lib/pipeline/filters";
import { extractHashtags, normalizeHashtags } from "@/lib/pipeline/captions";
import { enqueueProcess } from "@/lib/pipeline/enqueue";

/** Small overlap so a post published mid-poll isn't missed; dedupe absorbs it. */
const OVERLAP_MS = 15 * 60 * 1000;
const MAX_POSTS_PER_POLL = 30;

export type DetectResult = {
  detected: number;
  filtered: number;
  duplicates: number;
  ignored?: boolean;
};

function detectionWindow(workflow: {
  importBacklog: boolean;
  backlogSince: Date | null;
  lastPolledAt: Date | null;
  createdAt: Date;
}): Date | null {
  if (workflow.importBacklog) return workflow.backlogSince ?? null;
  const anchor = workflow.lastPolledAt ?? workflow.createdAt;
  return new Date(anchor.getTime() - OVERLAP_MS);
}

export async function detectForWorkflow(
  workflowId: string,
  reason: "schedule" | "manual" | "backlog" = "schedule",
  queueJobId?: string,
): Promise<DetectResult> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      sourceConnection: true,
      destinations: { where: { isEnabled: true }, include: { connection: true } },
    },
  });

  if (!workflow) return { detected: 0, filtered: 0, duplicates: 0, ignored: true };
  if (!workflow.isActive) {
    await logJob({
      stage: "POLL",
      level: "DEBUG",
      message: "Workflow is paused — skipping poll",
      workflowId,
      queueJobId,
    });
    return { detected: 0, filtered: 0, duplicates: 0, ignored: true };
  }
  if (workflow.sourceConnection.status === "DISCONNECTED") {
    await logJob({
      stage: "POLL",
      level: "DEBUG",
      message: "Source connection is disconnected — skipping poll",
      workflowId,
      queueJobId,
    });
    return { detected: 0, filtered: 0, duplicates: 0, ignored: true };
  }
  if (workflow.destinations.length === 0) {
    await logJob({
      stage: "POLL",
      level: "WARN",
      message: "Workflow has no enabled destinations — skipping poll",
      workflowId,
      queueJobId,
    });
    return { detected: 0, filtered: 0, duplicates: 0, ignored: true };
  }

  const since = reason === "backlog" ? null : detectionWindow(workflow);
  const adapter = sourceAdapterFor(workflow.sourceConnection);

  let posts: SourcePost[];
  try {
    posts = await adapter.listRecent({
      since,
      limit: MAX_POSTS_PER_POLL,
      collection: workflow.sourceCollection,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.workflow.update({
      where: { id: workflowId },
      data: { lastPolledAt: new Date(), lastPollError: message.slice(0, 2000) },
    });
    await logJob({
      stage: "POLL",
      message: "Source poll failed",
      workflowId,
      connectionId: workflow.sourceConnectionId,
      queueJobId,
      error,
    });
    throw error;
  }

  let detected = 0;
  let filtered = 0;
  let duplicates = 0;
  const queued: string[] = [];

  for (const post of posts) {
    const verdict = evaluateSourcePost(workflow, post, since);
    if (!verdict.pass) {
      filtered += 1;
      await logJob({
        stage: "DEDUPE",
        level: "DEBUG",
        message: `Skipped source post ${post.id}`,
        workflowId,
        queueJobId,
        data: { reason: verdict.reason, sourcePostId: post.id },
      });
      continue;
    }

    const hashtags = normalizeHashtags(post.hashtags ?? extractHashtags(post.caption));

    try {
      const item = await prisma.contentItem.create({
        data: {
          workflowId,
          sourceConnectionId: workflow.sourceConnectionId,
          sourcePostId: post.id,
          sourceUrl: post.url ?? null,
          sourceCollection: workflow.sourceCollection,
          mediaType: mediaKindToType(post.mediaType),
          title: post.title ?? null,
          caption: post.caption ?? null,
          firstComment: post.firstComment ?? null,
          hashtags,
          thumbnailUrl: post.thumbnailUrl ?? null,
          durationSec: post.durationSec ?? null,
          mediaCount: Math.max(1, post.media.length),
          sourceMedia: post.media as unknown as Prisma.InputJsonValue,
          sourcePublishedAt: post.publishedAt ?? null,
          status: "DETECTED",
          mode: workflow.mode,
          metadata: (post.raw ?? {}) as Prisma.InputJsonValue,
          targets: {
            create: workflow.destinations.map((destination) => ({
              destinationId: destination.id,
              connectionId: destination.connectionId,
              provider: destination.connection.provider,
              status: "PENDING" as const,
            })),
          },
        },
      });

      detected += 1;
      queued.push(item.id);
      await logJob({
        stage: "POLL",
        message: `Detected ${post.mediaType} post`,
        workflowId,
        contentItemId: item.id,
        queueJobId,
        data: { sourcePostId: post.id, sourceUrl: post.url, mode: workflow.mode },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // (workflowId, sourcePostId) unique constraint: already handled.
        duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      lastPolledAt: new Date(),
      lastPollError: null,
      ...(workflow.importBacklog && !workflow.backlogImportedAt
        ? { backlogImportedAt: new Date() }
        : {}),
    },
  });

  if (workflow.mode === "AUTO_PUBLISH") {
    for (const contentItemId of queued) {
      await enqueueProcess(contentItemId);
    }
  }

  await logJob({
    stage: "POLL",
    message: `Poll finished: ${detected} new, ${filtered} filtered, ${duplicates} duplicates`,
    workflowId,
    queueJobId,
    data: { detected, filtered, duplicates, reason, since: since?.toISOString() ?? null },
  });

  return { detected, filtered, duplicates };
}
