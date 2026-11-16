import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeft, Clock } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SetupRequired } from "@/components/setup-required";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  WorkflowBuilder,
  type BuilderConnection,
} from "@/components/workflows/workflow-builder";
import { WorkflowAssets } from "@/components/workflows/workflow-assets";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import type { WorkflowInput } from "@/lib/workflow-types";

export const dynamic = "force-dynamic";

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await databaseReady())) return <SetupRequired />;

  const { id } = await params;

  const [workflow, connections, assets] = await Promise.all([
    prisma.workflow.findUnique({
      where: { id },
      include: { destinations: true, _count: { select: { contentItems: true } } },
    }),
    prisma.connection.findMany({
      where: { status: { not: "DISCONNECTED" } },
      orderBy: { provider: "asc" },
      select: {
        id: true,
        provider: true,
        label: true,
        accountName: true,
        canSource: true,
        canDestination: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: { workflowId: id, kind: { in: ["INTRO", "OUTRO", "SUBTITLE"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, filename: true, sizeBytes: true },
    }),
  ]);

  if (!workflow) notFound();

  const builderConnections: BuilderConnection[] = connections;

  const initial: WorkflowInput = {
    name: workflow.name,
    description: workflow.description ?? "",
    isActive: workflow.isActive,
    sourceConnectionId: workflow.sourceConnectionId,
    sourceMediaType: workflow.sourceMediaType,
    sourceCollection: workflow.sourceCollection ?? "",
    pollIntervalMinutes: workflow.pollIntervalMinutes,
    mode: workflow.mode,
    includeHashtags: workflow.includeHashtags,
    excludeHashtags: workflow.excludeHashtags,
    includeKeywords: workflow.includeKeywords,
    excludeKeywords: workflow.excludeKeywords,
    minDurationSec: workflow.minDurationSec,
    maxDurationSec: workflow.maxDurationSec,
    importBacklog: workflow.importBacklog,
    backlogSince: workflow.backlogSince
      ? workflow.backlogSince.toISOString().slice(0, 10)
      : null,
    captionTemplate: workflow.captionTemplate ?? "",
    firstCommentTemplate: workflow.firstCommentTemplate ?? "",
    captionPrefix: workflow.captionPrefix ?? "",
    captionSuffix: workflow.captionSuffix ?? "",
    stripHashtags: workflow.stripHashtags,
    replaceHashtags: workflow.replaceHashtags,
    preserveMentions: workflow.preserveMentions,
    repurposeFirstComment: workflow.repurposeFirstComment,
    aspectRatio: workflow.aspectRatio,
    fillMode: workflow.fillMode,
    trimStartSec: workflow.trimStartSec,
    trimEndSec: workflow.trimEndSec,
    trimMaxDurationSec: workflow.trimMaxDurationSec,
    subtitleMode: workflow.subtitleMode,
    audioMode: workflow.audioMode,
    scheduleMode: workflow.scheduleMode,
    dripMaxPerDay: workflow.dripMaxPerDay,
    dripTimes: workflow.dripTimes.length ? workflow.dripTimes : ["11:00", "18:00"],
    timezone: workflow.timezone,
    destinations: workflow.destinations
      .filter((destination) => destination.isEnabled)
      .map((destination) => ({
        connectionId: destination.connectionId,
        targetMediaType: destination.targetMediaType,
        privacyStatus: destination.privacyStatus,
        folderPath: destination.folderPath,
        aspectRatio: destination.aspectRatio,
        titleTemplate: destination.titleTemplate,
        captionTemplate: destination.captionTemplate,
        firstCommentTemplate: destination.firstCommentTemplate,
        maxDurationSec: destination.maxDurationSec,
      })),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={workflow.name}
        description={workflow.description ?? "Edit source, filters, render rules and destinations."}
        actions={
          <>
            <Link href="/workflows" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft className="size-4" aria-hidden />
              Workflows
            </Link>
            <StatusBadge status={workflow.isActive ? "ACTIVE" : "PENDING"} kind="connection" />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <Badge variant="outline">
          <Clock className="mr-1 size-3" aria-hidden />
          every {workflow.pollIntervalMinutes}m · polled {formatRelative(workflow.lastPolledAt)}
        </Badge>
        <Badge variant="outline">{workflow._count.contentItems} item(s)</Badge>
        <Badge variant="outline">{workflow.mode === "AUTO_PUBLISH" ? "Auto-publish" : "Manual review"}</Badge>
        {workflow.scheduleMode === "DRIP" ? (
          <Badge variant="warning">
            drip {workflow.dripTimes.join(", ")} · {workflow.dripMaxPerDay ?? "∞"}/day · {workflow.timezone}
          </Badge>
        ) : null}
      </div>

      <WorkflowBuilder
        connections={builderConnections}
        workflowId={workflow.id}
        initial={initial}
      />

      <WorkflowAssets workflowId={workflow.id} assets={assets} />
    </div>
  );
}
