/**
 * Publish pipeline: one PublishTarget at a time, per-destination media,
 * partial failures captured instead of aborting the whole item.
 */
import { Prisma } from "@prisma/client";

import { destinationAdapterFor } from "@/lib/adapters/registry";
import { prisma } from "@/lib/db";
import { removeItemMedia } from "@/lib/media/storage";
import { parseArtifacts } from "@/lib/pipeline/artifacts";
import { logJob } from "@/lib/pipeline/logger";
import { getStorageSettings } from "@/lib/settings";

export type PublishOutcome = {
  published: number;
  failed: number;
  status: "PUBLISHED" | "PARTIAL" | "FAILED" | "DEFERRED";
};

export async function publishContentItem(
  contentItemId: string,
  options: { queueJobId?: string; force?: boolean } = {},
): Promise<PublishOutcome> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      workflow: true,
      targets: { include: { destination: true, connection: true } },
    },
  });
  if (!item) throw new Error(`ContentItem ${contentItemId} no longer exists`);

  // A drip slot that hasn't arrived yet must not publish early.
  if (
    item.status === "SCHEDULED" &&
    item.scheduledFor &&
    item.scheduledFor.getTime() > Date.now() &&
    !options.force
  ) {
    await logJob({
      stage: "PUBLISH",
      level: "DEBUG",
      message: "Drip slot not due yet — skipping publish",
      workflowId: item.workflowId,
      contentItemId: item.id,
      queueJobId: options.queueJobId ?? null,
      data: { scheduledFor: item.scheduledFor.toISOString() },
    });
    return { published: 0, failed: 0, status: "DEFERRED" };
  }

  if (item.status === "PUBLISHED" && !options.force) {
    return { published: item.targets.length, failed: 0, status: "PUBLISHED" };
  }

  const artifacts = parseArtifacts(item.artifacts);
  const context = {
    workflowId: item.workflowId,
    contentItemId: item.id,
    queueJobId: options.queueJobId ?? null,
  };

  if (Object.keys(artifacts.variants).length === 0 && artifacts.images.length === 0 && !artifacts.audio) {
    throw new Error("Content has no processed media — run processing again before publishing");
  }

  await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: "PUBLISHING", lastError: null },
  });

  let published = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const target of item.targets) {
    if (target.status === "PUBLISHED") {
      published += 1;
      continue;
    }
    if (target.status === "SKIPPED") continue;

    const metadata = (target.metadata ?? {}) as Record<string, unknown>;
    const variantKey = typeof metadata.variantKey === "string" ? metadata.variantKey : null;
    const mediaKind = typeof metadata.mediaKind === "string" ? metadata.mediaKind : "video";
    const variant = variantKey ? artifacts.variants[variantKey] : Object.values(artifacts.variants)[0];

    // Claim the target atomically: two overlapping publish jobs can never
    // upload the same destination twice.
    const claim = await prisma.publishTarget.updateMany({
      where: { id: target.id, status: { in: ["PENDING", "FAILED", "SCHEDULED"] } },
      data: { status: "PROCESSING", attemptCount: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    try {
      const adapter = destinationAdapterFor(target.connection);
      const result = await adapter.publish({
        connection: target.connection,
        destination: target.destination,
        contentItem: item,
        title: target.title ?? "",
        caption: target.caption ?? "",
        firstComment: target.firstComment ?? undefined,
        media: {
          videoPath: mediaKind === "video" ? variant?.path : undefined,
          audioPath: mediaKind === "audio" ? (artifacts.audio ?? undefined) : undefined,
          imagePaths: mediaKind === "images" ? artifacts.images : undefined,
          thumbnailPath: artifacts.thumbnail ?? undefined,
          aspectRatio: variant?.aspect,
        },
      });

      await prisma.publishTarget.update({
        where: { id: target.id },
        data: {
          status: "PUBLISHED",
          remotePostId: result.remotePostId,
          remoteUrl: result.remoteUrl ?? null,
          publishedAt: new Date(),
          lastError: null,
          metadata: {
            ...metadata,
            result: result.metadata ?? {},
          } as unknown as Prisma.InputJsonValue,
        },
      });
      published += 1;

      await logJob({
        ...context,
        stage: "PUBLISH",
        message: `Published to ${target.connection.provider}`,
        connectionId: target.connectionId,
        targetId: target.id,
        data: { remotePostId: result.remotePostId, remoteUrl: result.remoteUrl },
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      firstError ??= `${target.connection.provider}: ${message}`;

      await prisma.publishTarget.update({
        where: { id: target.id },
        data: { status: "FAILED", lastError: message.slice(0, 4000) },
      });
      await logJob({
        ...context,
        stage: "PUBLISH",
        message: `Publish to ${target.connection.provider} failed`,
        connectionId: target.connectionId,
        targetId: target.id,
        error,
      });
    }
  }

  const status: "PUBLISHED" | "PARTIAL" | "FAILED" =
    failed === 0 ? "PUBLISHED" : published > 0 ? "PARTIAL" : "FAILED";

  await prisma.contentItem.update({
    where: { id: item.id },
    data: {
      status,
      publishedAt: failed === 0 ? new Date() : item.publishedAt,
      lastError: firstError,
      ...(failed === 0 ? { scheduledFor: null } : {}),
    },
  });

  if (failed === 0) {
    await prisma.scheduleSlot.updateMany({
      where: { contentItemId: item.id, status: "RESERVED" },
      data: { status: "USED" },
    });

    const settings = await getStorageSettings();
    if (settings.retentionHours <= 0) {
      await removeItemMedia(item.id);
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { artifacts: Prisma.DbNull },
      });
    }
  }

  await logJob({
    ...context,
    stage: "PUBLISH",
    level: failed === 0 ? "INFO" : "WARN",
    message: `Publish finished: ${published} succeeded, ${failed} failed`,
    data: { published, failed, status },
  });

  return { published, failed, status };
}
