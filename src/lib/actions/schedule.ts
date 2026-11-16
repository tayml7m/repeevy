"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { actionError, type ActionResult } from "@/lib/actions/types";

export async function updateScheduleAction(input: {
  workflowId: string;
  scheduleMode: string;
  dripMaxPerDay?: number | null;
  dripTimes: string[];
  timezone: string;
}): Promise<ActionResult> {
  try {
    if (input.scheduleMode !== "IMMEDIATE" && input.scheduleMode !== "DRIP") {
      return { ok: false, message: "Unknown schedule mode" };
    }
    const times = [...new Set(input.dripTimes.map((time) => time.trim()).filter(Boolean))];
    if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      return { ok: false, message: "Times must use 24h HH:mm format" };
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      return { ok: false, message: `Unknown timezone: ${input.timezone}` };
    }

    await prisma.workflow.update({
      where: { id: input.workflowId },
      data: {
        scheduleMode: input.scheduleMode,
        dripTimes: times,
        dripMaxPerDay: input.dripMaxPerDay ?? null,
        timezone: input.timezone || "UTC",
      },
    });

    revalidatePath("/schedule");
    revalidatePath("/workflows");
    return { ok: true, message: "Schedule saved" };
  } catch (error) {
    return actionError(error);
  }
}
