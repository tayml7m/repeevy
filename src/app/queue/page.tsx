import Link from "next/link";

import type { Prisma } from "@prisma/client";
import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { QueueFilters } from "@/components/queue/queue-filters";
import { QueueItemActions, type QueueLog } from "@/components/queue/queue-item-actions";
import { SetupRequired } from "@/components/setup-required";
import { StatusBadge } from "@/components/status-badge";
import { Thumbnail } from "@/components/thumbnail";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { artifactMediaUrl } from "@/lib/media/storage";
import { parseArtifacts } from "@/lib/pipeline/artifacts";
import { normalizeHashtag } from "@/lib/pipeline/captions";
import { providerLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const STATUSES = new Set([
  "DETECTED",
  "DOWNLOADING",
  "PROCESSING",
  "READY",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "PARTIAL",
  "FAILED",
  "SKIPPED",
]);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await databaseReady())) return <SetupRequired />;

  const sp = await searchParams;
  const first = (key: string) => {
    const value = sp[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  const q = first("q");
  const status = first("status");
  const workflowId = first("workflow");
  const hashtag = first("hashtag");
  const page = Math.max(1, Number(first("page") ?? 1) || 1);

  const where: Prisma.ContentItemWhereInput = {};
  if (status && STATUSES.has(status)) where.status = status as never;
  if (workflowId) where.workflowId = workflowId;
  if (hashtag) where.hashtags = { has: normalizeHashtag(hashtag) };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { caption: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total, workflows, counts] = await Promise.all([
    prisma.contentItem.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        workflow: { select: { id: true, name: true } },
        sourceConnection: { select: { provider: true, label: true } },
        targets: {
          select: { id: true, provider: true, status: true, lastError: true },
          orderBy: { provider: "asc" },
        },
      },
    }),
    prisma.contentItem.count({ where }),
    prisma.workflow.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.contentItem.count(),
  ]);

  const errorLogs = items.length
    ? await prisma.jobLog.findMany({
        where: {
          contentItemId: { in: items.map((item) => item.id) },
          level: { in: ["ERROR", "WARN"] },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          contentItemId: true,
          level: true,
          stage: true,
          message: true,
          stack: true,
          createdAt: true,
        },
      })
    : [];

  const logsByItem = new Map<string, QueueLog[]>();
  for (const log of errorLogs) {
    if (!log.contentItemId) continue;
    const bucket = logsByItem.get(log.contentItemId) ?? [];
    if (bucket.length < 6) {
      bucket.push({
        id: log.id,
        level: log.level,
        stage: log.stage,
        message: log.message,
        stack: log.stack,
        createdAt: log.createdAt.toISOString(),
      });
    }
    logsByItem.set(log.contentItemId, bucket);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content queue"
        description="Every post detected by your workflows, with review, trim and publish controls."
        actions={
          <>
            <Link href="/workflows" className={buttonVariants({ variant: "outline" })}>
              Workflows
            </Link>
            <Badge variant="muted">{total} item(s)</Badge>
          </>
        }
      />

      <QueueFilters
        workflows={workflows}
        values={{ q, status, workflow: workflowId, hashtag }}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-7" />}
          title={counts === 0 ? "No content yet" : "Nothing matches these filters"}
          description={
            counts === 0
              ? "Once an active workflow polls a source post you'll see it here with a thumbnail, status and actions."
              : "Try clearing the search, hashtag or status filters to see the rest of the queue."
          }
          action={counts === 0 ? { href: "/workflows/new", label: "Create a workflow" } : { href: "/queue", label: "Clear filters" }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const artifacts = parseArtifacts(item.artifacts);
            const thumb = artifactMediaUrl(artifacts.thumbnail) ?? item.thumbnailUrl ?? null;
            const kind = artifacts.images.length > 0 ? "images" : "video";
            const targetErrors = item.targets
              .filter((target) => target.lastError)
              .map((target) => `${providerLabel(target.provider)}: ${target.lastError}`);
            const logs = logsByItem.get(item.id) ?? [];

            return (
              <Card key={item.id} className="flex flex-col overflow-hidden p-3">
                <div className="relative">
                  <Thumbnail
                    src={thumb}
                    alt={item.title ?? item.caption?.slice(0, 60) ?? "Source post"}
                    durationSec={item.durationSec}
                    kind={kind}
                  />
                  <div className="absolute left-2 top-2">
                    <StatusBadge status={item.status} />
                  </div>
                  {item.mediaCount > 1 ? (
                    <Badge variant="secondary" className="absolute right-2 top-2">
                      {item.mediaCount} photos
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-2 px-1 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-sm font-medium leading-snug">
                      {item.title || item.caption?.split("\n")[0] || "Untitled post"}
                    </h2>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatRelative(item.detectedAt)}
                    </span>
                  </div>

                  {item.caption ? (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.caption}
                    </p>
                  ) : null}

                  {item.hashtags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {item.hashtags.slice(0, 4).map((tag) => (
                        <Link
                          key={tag}
                          href={`/queue?hashtag=${encodeURIComponent(tag)}`}
                          className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                        >
                          {tag}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      {item.workflow.name} · {providerLabel(item.sourceConnection.provider)}
                    </span>
                    {item.scheduledFor ? (
                      <span className="text-[11px] text-[var(--warning)]">
                        · slot {formatRelative(item.scheduledFor)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {item.targets.map((target) => (
                      <StatusBadge
                        key={target.id}
                        status={target.status}
                        dot={false}
                        className="text-[10px]"
                      />
                    ))}
                  </div>

                  <div className="mt-auto pt-1">
                    <QueueItemActions
                      itemId={item.id}
                      caption={item.caption ?? ""}
                      title={item.title}
                      firstComment={item.firstComment}
                      trimStartSec={item.trimStartSec}
                      trimEndSec={item.trimEndSec}
                      status={item.status}
                      errorText={item.lastError}
                      targetErrors={targetErrors}
                      logs={logs}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Pagination
        basePath="/queue"
        page={page}
        totalPages={totalPages}
        params={{ q, status, workflow: workflowId, hashtag }}
      />
    </div>
  );
}
