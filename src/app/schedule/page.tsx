import Link from "next/link";

import { CalendarClock, Clock, Timer } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ScheduleForm } from "@/components/schedule/schedule-form";
import { SetupRequired } from "@/components/setup-required";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import { providerLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  if (!(await databaseReady())) return <SetupRequired />;

  const now = new Date();
  const [workflows, slots, scheduledItems] = await Promise.all([
    prisma.workflow.findMany({
      orderBy: { name: "asc" },
      include: {
        destinations: { where: { isEnabled: true }, include: { connection: true } },
      },
    }),
    prisma.scheduleSlot.findMany({
      where: { status: "RESERVED", scheduledFor: { gte: new Date(now.getTime() - 5 * 60_000) } },
      orderBy: { scheduledFor: "asc" },
      take: 20,
      include: {
        workflow: { select: { name: true, timezone: true } },
        contentItem: { select: { id: true, title: true, caption: true, status: true } },
      },
    }),
    prisma.contentItem.findMany({
      where: { status: { in: ["SCHEDULED", "PUBLISHING"] } },
      orderBy: { scheduledFor: "asc" },
      take: 10,
      include: { workflow: { select: { id: true, name: true } } },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drip scheduler"
        description="Publish immediately on detection, or spread content across time slots so your feed never floods."
        actions={
          <>
            <Link href="/queue?status=SCHEDULED" className={buttonVariants({ variant: "outline" })}>
              Scheduled queue
            </Link>
            <Badge variant="muted">{slots.length} upcoming</Badge>
          </>
        }
      />

      <Card>
        <CardContent className="grid gap-3 p-4 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3 sm:p-5">
          <p className="flex gap-2">
            <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            Slots are computed in each workflow&apos;s timezone, including DST changes.
          </p>
          <p className="flex gap-2">
            <Timer className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            Max-per-day counts both reserved and used slots, so the cap is never exceeded.
          </p>
          <p className="flex gap-2">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            The worker checks every minute and publishes due items automatically.
          </p>
        </CardContent>
      </Card>

      {workflows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-7" />}
          title="No workflows to schedule"
          description="Create a workflow first; its drip slots can be configured here."
          action={{ href: "/workflows/new", label: "Create a workflow" }}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {workflows.map((workflow) => (
            <ScheduleForm
              key={workflow.id}
              workflowId={workflow.id}
              name={workflow.name}
              scheduleMode={workflow.scheduleMode}
              dripTimes={workflow.dripTimes}
              dripMaxPerDay={workflow.dripMaxPerDay}
              timezone={workflow.timezone}
              isActive={workflow.isActive}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming reserved slots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {slots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                Nothing reserved. Items are assigned a slot when they finish processing in a drip
                workflow.
              </p>
            ) : (
              slots.map((slot) => (
                <div
                  key={slot.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-primary">
                    {formatDateTime(slot.scheduledFor)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">
                      {slot.contentItem?.title || slot.contentItem?.caption || "Reserved slot"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {slot.workflow.name} · {slot.workflow.timezone}
                    </p>
                  </div>
                  {slot.contentItem ? <StatusBadge status={slot.contentItem.status} dot={false} /> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Waiting for a slot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scheduledItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                No scheduled content right now.
              </p>
            ) : (
              scheduledItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{item.title || item.caption || "Untitled"}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {item.workflow.name} · {item.scheduledFor ? formatRelative(item.scheduledFor) : "no slot"}
                    </p>
                  </div>
                  <Link
                    href={`/queue?workflow=${item.workflow.id}`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Queue
                  </Link>
                </div>
              ))
            )}
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              Destinations:{" "}
              {[...new Set(workflows.flatMap((workflow) => workflow.destinations.map((destination) => providerLabel(destination.connection.provider))))].join(
                ", ",
              ) || "none yet"}
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
