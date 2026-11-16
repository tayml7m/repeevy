"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { enqueueProcess, enqueuePublish } from "@/lib/pipeline/enqueue";
import { actionError, type ActionResult } from "@/lib/actions/types";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath("/workflows");
  revalidatePath("/schedule");
}

/** Publish now: processes first when the item has no rendered media yet. */
export async function publishNowAction(contentItemId: string): Promise<ActionResult> {
  try {
    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { id: true, artifacts: true, mode: true, status: true },
    });
    if (!item) return { ok: false, message: "Item not found" };
    if (item.status === "PUBLISHED") return { ok: false, message: "Already published" };

    if (item.artifacts) {
      await enqueuePublish(item.id, { force: true });
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { status: "PUBLISHING", lastError: null },
      });
      revalidateAll();
      return { ok: true, message: "Publishing queued" };
    }

    await enqueueProcess(item.id, { force: true, autoPublish: true });
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "PROCESSING", lastError: null },
    });
    revalidateAll();
    return { ok: true, message: "Processing, then publishing" };
  } catch (error) {
    return actionError(error);
  }
}

/** Re-run the full download/render pipeline. */
export async function rerunItemAction(contentItemId: string): Promise<ActionResult> {
  try {
    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { id: true, mode: true },
    });
    if (!item) return { ok: false, message: "Item not found" };

    await enqueueProcess(item.id, {
      force: true,
      autoPublish: item.mode === "AUTO_PUBLISH",
    });
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "PROCESSING", lastError: null },
    });
    revalidateAll();
    return { ok: true, message: "Re-run queued" };
  } catch (error) {
    return actionError(error);
  }
}

/** Saves caption/title edits and pushes them to every unpublished target. */
export async function updateItemCopyAction(input: {
  contentItemId: string;
  caption: string;
  title?: string;
  firstComment?: string;
}): Promise<ActionResult> {
  try {
    const caption = input.caption.trim();
    if (!caption) return { ok: false, message: "Caption cannot be empty" };
    const title = input.title?.trim() || null;
    const firstComment = input.firstComment?.trim() || null;

    const item = await prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
      select: { id: true },
    });
    if (!item) return { ok: false, message: "Item not found" };

    await prisma.contentItem.update({
      where: { id: item.id },
      data: { caption, title },
    });
    await prisma.publishTarget.updateMany({
      where: { contentItemId: item.id, status: { not: "PUBLISHED" } },
      data: { caption, title, firstComment },
    });

    revalidateAll();
    return { ok: true, message: "Caption updated" };
  } catch (error) {
    return actionError(error);
  }
}

/** Per-item trim, then re-render. */
export async function trimItemAction(input: {
  contentItemId: string;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
}): Promise<ActionResult> {
  try {
    const start = input.trimStartSec ?? null;
    const end = input.trimEndSec ?? null;
    if (start !== null && (!Number.isFinite(start) || start < 0)) {
      return { ok: false, message: "Trim start must be zero or greater" };
    }
    if (end !== null && (!Number.isFinite(end) || end <= 0)) {
      return { ok: false, message: "Trim end must be greater than zero" };
    }
    if (start !== null && end !== null && end <= start) {
      return { ok: false, message: "Trim end must be after trim start" };
    }

    const item = await prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
      select: { id: true, mode: true },
    });
    if (!item) return { ok: false, message: "Item not found" };

    await enqueueProcess(item.id, {
      force: true,
      autoPublish: item.mode === "AUTO_PUBLISH",
    });
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { trimStartSec: start, trimEndSec: end, status: "PROCESSING", lastError: null },
    });

    revalidateAll();
    return { ok: true, message: "Trim saved — re-rendering" };
  } catch (error) {
    return actionError(error);
  }
}

/** Restores the workflow's default trim and re-renders. */
export async function resetTrimAction(contentItemId: string): Promise<ActionResult> {
  try {
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { trimStartSec: null, trimEndSec: null, status: "PROCESSING" },
    });
    await enqueueProcess(contentItemId, { force: true });
    revalidateAll();
    return { ok: true, message: "Trim reset" };
  } catch (error) {
    return actionError(error);
  }
}
