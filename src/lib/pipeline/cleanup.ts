/**
 * Media retention: delete downloaded/rendered files after publishing, and
 * sweep directories whose ContentItem no longer exists.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { mediaRoot, removeItemMedia } from "@/lib/media/storage";
import { logJob } from "@/lib/pipeline/logger";
import { getStorageSettings } from "@/lib/settings";

export type CleanupResult = { removed: number; orphans: number };

export async function cleanupExpiredMedia(): Promise<CleanupResult> {
  const settings = await getStorageSettings();
  const retentionMs = Math.max(0, settings.retentionHours) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs);

  const candidates = await prisma.contentItem.findMany({
    where: {
      status: { in: ["PUBLISHED", "PARTIAL", "SKIPPED"] },
      OR: [{ publishedAt: { lte: cutoff } }, { publishedAt: null, detectedAt: { lte: cutoff } }],
    },
    select: { id: true, workflowId: true, artifacts: true },
    take: 200,
  });

  let removed = 0;
  for (const item of candidates) {
    if (!item.artifacts) continue;
    await removeItemMedia(item.id);
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { artifacts: Prisma.DbNull },
    });
    removed += 1;
    await logJob({
      stage: "CLEANUP",
      message: "Removed media after successful publish",
      workflowId: item.workflowId,
      contentItemId: item.id,
      data: { retentionHours: settings.retentionHours },
    });
  }

  // Orphan sweep: directories with no ContentItem row (e.g. DB restored, or a
  // crashed run before the row was written).
  let orphans = 0;
  const itemsRoot = path.join(mediaRoot(), "items");
  let entries: Array<{ isDirectory(): boolean; name: string }> = [];
  try {
    entries = await readdir(itemsRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(itemsRoot, entry.name);
    try {
      const info = await stat(directory);
      if (info.mtime > cutoff) continue;
      const existing = await prisma.contentItem.findUnique({
        where: { id: entry.name },
        select: { id: true },
      });
      if (!existing) {
        await removeItemMedia(entry.name);
        orphans += 1;
      }
    } catch {
      // Ignore unreadable/racing directories.
    }
  }

  return { removed, orphans };
}
