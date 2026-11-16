"use server";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { actionError, type ActionResult } from "@/lib/actions/types";

const ALLOWED: Record<string, { ext: string[]; field: "prependIntroAssetId" | "appendOutroAssetId" | "subtitleAssetId" }> = {
  INTRO: { ext: [".mp4", ".mov", ".webm"], field: "prependIntroAssetId" },
  OUTRO: { ext: [".mp4", ".mov", ".webm"], field: "appendOutroAssetId" },
  SUBTITLE: { ext: [".srt", ".vtt"], field: "subtitleAssetId" },
};

const MAX_BYTES = 24 * 1024 * 1024;

/** Uploads an intro/outro clip or .srt file for a workflow. */
export async function uploadWorkflowAssetAction(
  workflowId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const kind = String(formData.get("kind") ?? "");
    const rules = ALLOWED[kind];
    if (!rules) return { ok: false, message: "Unknown asset type" };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "Choose a file first" };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, message: "File is larger than 24 MB" };
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!rules.ext.includes(ext)) {
      return { ok: false, message: `${kind.toLowerCase()} files must be ${rules.ext.join(", ")}` };
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true },
    });
    if (!workflow) return { ok: false, message: "Save the workflow first, then attach assets" };

    const directory = path.join(env.MEDIA_ROOT, "assets", workflowId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${kind.toLowerCase()}-${randomUUID()}${ext}`);
    await writeFile(target, Buffer.from(await file.arrayBuffer()));

    const previous = await prisma.mediaAsset.findMany({
      where: { workflowId, kind: kind as "INTRO" | "OUTRO" | "SUBTITLE" },
    });

    const asset = await prisma.mediaAsset.create({
      data: {
        workflowId,
        kind: kind as "INTRO" | "OUTRO" | "SUBTITLE",
        filename: file.name,
        storageDriver: "LOCAL",
        storageKey: target,
        mimeType: file.type || null,
        sizeBytes: file.size,
      },
    });

    await prisma.workflow.update({
      where: { id: workflowId },
      data: { [rules.field]: asset.id },
    });

    for (const old of previous) {
      await prisma.mediaAsset.delete({ where: { id: old.id } }).catch(() => undefined);
      await rm(old.storageKey, { force: true }).catch(() => undefined);
    }

    revalidatePath(`/workflows/${workflowId}`);
    return { ok: true, message: `${file.name} attached` };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteWorkflowAssetAction(
  workflowId: string,
  assetId: string,
): Promise<ActionResult> {
  try {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.workflowId !== workflowId) {
      return { ok: false, message: "Asset not found" };
    }

    await prisma.workflow.updateMany({
      where: { id: workflowId, prependIntroAssetId: assetId },
      data: { prependIntroAssetId: null },
    });
    await prisma.workflow.updateMany({
      where: { id: workflowId, appendOutroAssetId: assetId },
      data: { appendOutroAssetId: null },
    });
    await prisma.workflow.updateMany({
      where: { id: workflowId, subtitleAssetId: assetId },
      data: { subtitleAssetId: null },
    });
    await prisma.mediaAsset.delete({ where: { id: assetId } }).catch(() => undefined);
    await rm(asset.storageKey, { force: true }).catch(() => undefined);

    revalidatePath(`/workflows/${workflowId}`);
    return { ok: true, message: "Asset removed" };
  } catch (error) {
    return actionError(error);
  }
}
