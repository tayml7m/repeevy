"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { enqueueDetect } from "@/lib/pipeline/enqueue";
import { actionError, type ActionResult } from "@/lib/actions/types";
import type { WorkflowInput } from "@/lib/workflow-types";

const mediaType = z.enum(["VIDEO", "SHORT_VIDEO", "STORY", "PHOTO", "CAROUSEL", "AUDIO", "ANY"]);
const targetMediaType = z.enum([
  "VIDEO",
  "SHORT_VIDEO",
  "STORY",
  "PHOTO",
  "CAROUSEL",
  "AUDIO",
]);

const destinationSchema = z.object({
  connectionId: z.string().min(1),
  targetMediaType,
  privacyStatus: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).nullable().optional(),
  folderPath: z.string().trim().max(500).nullable().optional(),
  aspectRatio: z.enum(["SOURCE", "PORTRAIT_9_16", "LANDSCAPE_16_9", "SQUARE_1_1"]).nullable().optional(),
  titleTemplate: z.string().max(500).nullable().optional(),
  captionTemplate: z.string().max(5000).nullable().optional(),
  firstCommentTemplate: z.string().max(2000).nullable().optional(),
  maxDurationSec: z.number().int().positive().max(24 * 3600).nullable().optional(),
});

const workflowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean(),
  sourceConnectionId: z.string().min(1),
  sourceMediaType: mediaType,
  sourceCollection: z.string().trim().max(500).nullable().optional(),
  pollIntervalMinutes: z.number().int().min(1).max(1440),
  mode: z.enum(["AUTO_PUBLISH", "MANUAL_APPROVAL"]),
  includeHashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  excludeHashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
  excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
  minDurationSec: z.number().int().nonnegative().max(24 * 3600).nullable().optional(),
  maxDurationSec: z.number().int().positive().max(24 * 3600).nullable().optional(),
  importBacklog: z.boolean(),
  backlogSince: z.string().trim().max(40).nullable().optional(),
  captionTemplate: z.string().max(5000).nullable().optional(),
  firstCommentTemplate: z.string().max(2000).nullable().optional(),
  captionPrefix: z.string().max(300).nullable().optional(),
  captionSuffix: z.string().max(300).nullable().optional(),
  stripHashtags: z.boolean(),
  replaceHashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  preserveMentions: z.boolean(),
  repurposeFirstComment: z.boolean(),
  aspectRatio: z.enum(["SOURCE", "PORTRAIT_9_16", "LANDSCAPE_16_9", "SQUARE_1_1"]),
  fillMode: z.enum(["BLUR", "CROP", "PAD"]),
  trimStartSec: z.number().nonnegative().max(24 * 3600).nullable().optional(),
  trimEndSec: z.number().positive().max(24 * 3600).nullable().optional(),
  trimMaxDurationSec: z.number().int().positive().max(24 * 3600).nullable().optional(),
  subtitleMode: z.enum(["NONE", "BURN_IN", "AUTO_TRANSCRIBE"]),
  audioMode: z.enum(["KEEP", "EXTRACT_MP3", "WAVEFORM_VIDEO"]),
  scheduleMode: z.enum(["IMMEDIATE", "DRIP"]),
  dripMaxPerDay: z.number().int().min(1).max(50).nullable().optional(),
  dripTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24),
  timezone: z.string().trim().min(1).max(80),
  destinations: z.array(destinationSchema).min(1).max(12),
});

export type SaveWorkflowResult = ActionResult & { workflowId?: string };

function isoOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function revalidateWorkflowPages(workflowId?: string) {
  revalidatePath("/");
  revalidatePath("/workflows");
  revalidatePath("/schedule");
  revalidatePath("/queue");
  if (workflowId) revalidatePath(`/workflows/${workflowId}`);
}

export async function saveWorkflowAction(
  input: WorkflowInput,
  workflowId?: string,
): Promise<SaveWorkflowResult> {
  try {
    const parsed = workflowSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        message: `${first.path.join(".") || "input"}: ${first.message}`,
      };
    }
    const data = parsed.data;

    if (data.trimStartSec != null && data.trimEndSec != null && data.trimEndSec <= data.trimStartSec) {
      return { ok: false, message: "Trim end must be after trim start" };
    }
    if (data.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
      } catch {
        return { ok: false, message: `Unknown timezone: ${data.timezone}` };
      }
    }

    const source = await prisma.connection.findUnique({ where: { id: data.sourceConnectionId } });
    if (!source) return { ok: false, message: "Source connection not found" };

    const destinationConnections = await prisma.connection.findMany({
      where: { id: { in: data.destinations.map((destination) => destination.connectionId) } },
    });
    if (destinationConnections.length !== new Set(data.destinations.map((d) => d.connectionId)).size) {
      return { ok: false, message: "One or more destination connections no longer exist" };
    }

    const scalar = {
      name: data.name,
      description: data.description ?? null,
      isActive: data.isActive,
      sourceConnectionId: data.sourceConnectionId,
      sourceMediaType: data.sourceMediaType,
      sourceCollection: data.sourceCollection ?? null,
      pollIntervalMinutes: data.pollIntervalMinutes,
      mode: data.mode,
      includeHashtags: data.includeHashtags,
      excludeHashtags: data.excludeHashtags,
      includeKeywords: data.includeKeywords,
      excludeKeywords: data.excludeKeywords,
      minDurationSec: data.minDurationSec ?? null,
      maxDurationSec: data.maxDurationSec ?? null,
      importBacklog: data.importBacklog,
      backlogSince: isoOrNull(data.backlogSince),
      captionTemplate: data.captionTemplate ?? null,
      firstCommentTemplate: data.firstCommentTemplate ?? null,
      captionPrefix: data.captionPrefix ?? null,
      captionSuffix: data.captionSuffix ?? null,
      stripHashtags: data.stripHashtags,
      replaceHashtags: data.replaceHashtags,
      preserveMentions: data.preserveMentions,
      repurposeFirstComment: data.repurposeFirstComment,
      aspectRatio: data.aspectRatio,
      fillMode: data.fillMode,
      trimStartSec: data.trimStartSec ?? null,
      trimEndSec: data.trimEndSec ?? null,
      trimMaxDurationSec: data.trimMaxDurationSec ?? null,
      subtitleMode: data.subtitleMode,
      audioMode: data.audioMode,
      scheduleMode: data.scheduleMode,
      dripMaxPerDay: data.dripMaxPerDay ?? null,
      dripTimes: data.dripTimes,
      timezone: data.timezone,
    };

    const destinationData = (destination: (typeof data.destinations)[number]) => ({
      connectionId: destination.connectionId,
      targetMediaType: destination.targetMediaType,
      isEnabled: true,
      privacyStatus: destination.privacyStatus ?? null,
      folderPath: destination.folderPath ?? null,
      aspectRatio: destination.aspectRatio ?? null,
      titleTemplate: destination.titleTemplate ?? null,
      captionTemplate: destination.captionTemplate ?? null,
      firstCommentTemplate: destination.firstCommentTemplate ?? null,
      maxDurationSec: destination.maxDurationSec ?? null,
    });

    if (!workflowId) {
      const created = await prisma.workflow.create({
        data: {
          ...scalar,
          destinations: { create: data.destinations.map(destinationData) },
        },
      });
      revalidateWorkflowPages(created.id);
      return { ok: true, message: "Workflow created", workflowId: created.id };
    }

    const existing = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!existing) return { ok: false, message: "Workflow not found" };

    const currentDestinations = await prisma.workflowDestination.findMany({
      where: { workflowId },
    });

    await prisma.workflow.update({ where: { id: workflowId }, data: scalar });

    const keep = new Set<string>();
    for (const destination of data.destinations) {
      const match = currentDestinations.find(
        (row) =>
          row.connectionId === destination.connectionId &&
          row.targetMediaType === destination.targetMediaType,
      );
      if (match) {
        await prisma.workflowDestination.update({
          where: { id: match.id },
          data: destinationData(destination),
        });
        keep.add(match.id);
      } else {
        const created = await prisma.workflowDestination.create({
          data: { ...destinationData(destination), workflowId },
        });
        keep.add(created.id);
      }
    }

    // Never delete destinations: published PublishTarget rows cascade from
    // them, so removed destinations are simply disabled.
    for (const row of currentDestinations) {
      if (!keep.has(row.id) && row.isEnabled) {
        await prisma.workflowDestination.update({
          where: { id: row.id },
          data: { isEnabled: false },
        });
      }
    }

    revalidateWorkflowPages(workflowId);
    return { ok: true, message: "Workflow saved", workflowId };
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleWorkflowAction(
  workflowId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    await prisma.workflow.update({ where: { id: workflowId }, data: { isActive } });
    revalidateWorkflowPages(workflowId);
    return { ok: true, message: isActive ? "Workflow activated" : "Workflow paused" };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteWorkflowAction(workflowId: string): Promise<ActionResult> {
  try {
    await prisma.workflow.delete({ where: { id: workflowId } });
    revalidateWorkflowPages();
    return { ok: true, message: "Workflow deleted" };
  } catch (error) {
    return actionError(error);
  }
}

export async function runWorkflowAction(workflowId: string): Promise<ActionResult> {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, importBacklog: true },
    });
    if (!workflow) return { ok: false, message: "Workflow not found" };

    await enqueueDetect(workflow.id, "manual");
    revalidateWorkflowPages(workflow.id);
    return {
      ok: true,
      message: workflow.importBacklog ? "Backlog import queued" : "Poll queued",
    };
  } catch (error) {
    return actionError(error);
  }
}
