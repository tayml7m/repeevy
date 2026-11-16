/**
 * Drip scheduler: reserves publishing slots inside the workflow's timezone,
 * enforces the per-day cap, and lets the maintenance tick release due items.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logJob } from "@/lib/pipeline/logger";
import { enqueuePublish } from "@/lib/pipeline/enqueue";
import { getStorageSettings } from "@/lib/settings";

const DEFAULT_TIMES = ["11:00", "18:00"];

function formatParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `timeZone` at a given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = formatParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Converts a wall-clock time in `timeZone` into a UTC instant. */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0);

  let offset = zoneOffsetMs(new Date(guess), timeZone);
  let result = guess - offset;
  const secondOffset = zoneOffsetMs(new Date(result), timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    result = guess - offset;
  }
  return new Date(result);
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = formatParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

function validTimes(times: string[]): string[] {
  const filtered = times
    .map((time) => time.trim())
    .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  return [...new Set(filtered)].sort();
}

/**
 * Reserves the next free drip slot for a content item and marks it SCHEDULED.
 * Returns the slot time, or null when no slot could be found (caller then
 * publishes immediately).
 */
export async function scheduleContentItem(contentItemId: string): Promise<Date | null> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { workflow: true },
  });
  if (!item) return null;

  const workflow = item.workflow;
  const timeZone = workflow.timezone || "UTC";
  const times = validTimes(workflow.dripTimes.length ? workflow.dripTimes : DEFAULT_TIMES);
  const maxPerDay = Math.max(1, workflow.dripMaxPerDay ?? times.length);
  const now = new Date();
  const horizonDays = 14;

  await prisma.scheduleSlot.deleteMany({
    where: { contentItemId, status: "RESERVED" },
  });

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const dateKey = addDays(localDateKey(now, timeZone), dayOffset);

    const used = await prisma.scheduleSlot.count({
      where: { workflowId: workflow.id, localDate: dateKey, status: { in: ["RESERVED", "USED"] } },
    });
    if (used >= maxPerDay) continue;

    for (const time of times) {
      const scheduledFor = zonedTimeToUtc(dateKey, time, timeZone);
      if (scheduledFor.getTime() <= now.getTime() + 30_000) continue;

      try {
        const slot = await prisma.scheduleSlot.create({
          data: {
            workflowId: workflow.id,
            contentItemId,
            scheduledFor,
            localDate: dateKey,
            status: "RESERVED",
          },
        });

        await prisma.contentItem.update({
          where: { id: contentItemId },
          data: { status: "SCHEDULED", scheduledFor: slot.scheduledFor },
        });

        await logJob({
          stage: "SCHEDULE",
          message: `Reserved drip slot ${dateKey} ${time} (${timeZone})`,
          workflowId: workflow.id,
          contentItemId,
          data: { scheduledFor: scheduledFor.toISOString(), localDate: dateKey },
        });

        return scheduledFor;
      } catch (error) {
        // Unique (workflowId, scheduledFor) collision: try the next slot.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
  }

  await logJob({
    stage: "SCHEDULE",
    level: "WARN",
    message: "No drip slot available in the next 14 days — publishing immediately",
    workflowId: workflow.id,
    contentItemId,
  });
  return null;
}

/** Maintenance tick: enqueue every scheduled item whose slot has arrived. */
export async function publishDueScheduled(limit = 50): Promise<number> {
  const due = await prisma.contentItem.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true, workflowId: true, scheduledFor: true },
    take: limit,
    orderBy: { scheduledFor: "asc" },
  });

  for (const item of due) {
    await enqueuePublish(item.id);
    await logJob({
      stage: "SCHEDULE",
      message: "Drip slot due — queued publish",
      workflowId: item.workflowId,
      contentItemId: item.id,
      data: { scheduledFor: item.scheduledFor?.toISOString() ?? null },
    });
  }

  return due.length;
}

/** Retention used by the cleanup job (exported here to keep settings usage low). */
export async function mediaRetentionHours(): Promise<number> {
  const settings = await getStorageSettings();
  return settings.retentionHours;
}
