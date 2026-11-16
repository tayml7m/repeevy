import Link from "next/link";

import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Inbox,
  Plug,
  ScrollText,
  TriangleAlert,
  Workflow as WorkflowIcon,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SetupRequired } from "@/components/setup-required";
import { StatusBadge } from "@/components/status-badge";
import { Thumbnail } from "@/components/thumbnail";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { artifactMediaUrl } from "@/lib/media/storage";
import { parseArtifacts } from "@/lib/pipeline/artifacts";
import { getHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

const CARD_LINKS = [
  { key: "new", label: "Detected today", href: "/queue", icon: Inbox },
  { key: "waiting", label: "Waiting review", href: "/queue?status=READY", icon: CheckCircle2 },
  { key: "scheduled", label: "Scheduled", href: "/schedule", icon: CalendarClock },
  { key: "published", label: "Published (7d)", href: "/queue?status=PUBLISHED", icon: WorkflowIcon },
  { key: "failed", label: "Failed", href: "/queue?status=FAILED", icon: XCircle },
] as const;

export default async function DashboardPage() {
  if (!(await databaseReady())) return <SetupRequired />;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    newToday,
    waiting,
    scheduled,
    publishedWeek,
    failed,
    activeWorkflows,
    activeConnections,
    recent,
    recentErrors,
    health,
  ] = await Promise.all([
    prisma.contentItem.count({ where: { detectedAt: { gte: dayStart } } }),
    prisma.contentItem.count({ where: { status: { in: ["DETECTED", "READY"] } } }),
    prisma.contentItem.count({ where: { status: "SCHEDULED" } }),
    prisma.contentItem.count({
      where: { status: "PUBLISHED", publishedAt: { gte: weekStart } },
    }),
    prisma.contentItem.count({ where: { status: { in: ["FAILED", "PARTIAL"] } } }),
    prisma.workflow.count({ where: { isActive: true } }),
    prisma.connection.count({ where: { status: "ACTIVE" } }),
    prisma.contentItem.findMany({
      orderBy: { detectedAt: "desc" },
      take: 5,
      include: {
        workflow: { select: { id: true, name: true } },
        targets: { select: { provider: true, status: true } },
      },
    }),
    prisma.jobLog.findMany({
      where: { level: { in: ["ERROR", "WARN"] } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, level: true, message: true, createdAt: true, stage: true },
    }),
    getHealthReport(),
  ]);

  const counts: Record<string, number> = {
    new: newToday,
    waiting,
    scheduled,
    published: publishedWeek,
    failed,
  };
  const failing = health.checks.filter((check) => check.state !== "ok");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Everything flowing through your private repurpose engine — sources, renders and destinations."
        actions={
          <>
            <Link href="/queue" className={buttonVariants({ variant: "outline" })}>
              Review queue
            </Link>
            <Link href="/workflows/new" className={buttonVariants()}>
              New workflow
            </Link>
          </>
        }
      />

      {health.status !== "ok" ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
            <div>
              <p className="font-medium">Infrastructure needs attention</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {failing.slice(0, 4).map((check) => (
                  <li key={check.id}>
                    {check.label}: {check.detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link href="/api/health" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Health report
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CARD_LINKS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.key}
              href={card.href}
              className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/80"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{card.label}</span>
                <Icon className="size-4 text-muted-foreground/70" aria-hidden />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{counts[card.key] ?? 0}</p>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Latest detections</CardTitle>
              <p className="text-xs text-muted-foreground">Newest source posts across all workflows.</p>
            </div>
            <Link href="/queue" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              View all
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-6" />}
                title="No content detected yet"
                description="Create an active workflow and the worker will start polling your source account every few minutes."
                action={{ href: "/workflows/new", label: "Build your first workflow" }}
              />
            ) : (
              recent.map((item) => {
                const artifacts = parseArtifacts(item.artifacts);
                const thumb =
                  artifactMediaUrl(artifacts.thumbnail) ?? item.thumbnailUrl ?? null;
                return (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-28 shrink-0 sm:w-32">
                      <Thumbnail
                        src={thumb}
                        alt={item.title ?? "Source post"}
                        durationSec={item.durationSec}
                        kind={artifacts.images.length > 0 ? "images" : "video"}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {formatRelative(item.detectedAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm font-medium">
                        {item.title || item.caption || "Untitled post"}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {item.workflow.name} · {item.targets.length} destination(s)
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Engine</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active workflows</span>
                <span className="font-medium tabular-nums">{activeWorkflows}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Connected accounts</span>
                <span className="font-medium tabular-nums">{activeConnections}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Queue status</span>
                <Badge variant={health.status === "ok" ? "success" : "warning"} dot>
                  {health.status === "ok" ? "Operational" : "Degraded"}
                </Badge>
              </div>
              <div className="flex gap-2 pt-1">
                <Link href="/connections" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Plug className="size-3.5" aria-hidden />
                  Connections
                </Link>
                <Link href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <CalendarClock className="size-3.5" aria-hidden />
                  Schedule
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Needs attention</CardTitle>
              <Link href="/logs" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Logs
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentErrors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing failing. Worker warnings and errors will show up here.
                </p>
              ) : (
                recentErrors.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border/70 bg-background/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.level === "ERROR" ? "danger" : "warning"} dot>
                        {entry.level}
                      </Badge>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {entry.stage}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {entry.message}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      {formatRelative(entry.createdAt)}
                    </p>
                  </div>
                ))
              )}
              <Link
                href="/logs?level=ERROR"
                className={buttonVariants({ variant: "ghost", size: "sm", className: "w-full" })}
              >
                <ScrollText className="size-3.5" aria-hidden />
                Open full logs
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
