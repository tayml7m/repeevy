import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SetupRequired } from "@/components/setup-required";
import { buttonVariants } from "@/components/ui/button";
import {
  WorkflowBuilder,
  type BuilderConnection,
} from "@/components/workflows/workflow-builder";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import type { WorkflowInput } from "@/lib/workflow-types";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  if (!(await databaseReady())) return <SetupRequired />;

  const connections = await prisma.connection.findMany({
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
  });

  const builderConnections: BuilderConnection[] = connections;
  const firstSource = connections.find((connection) => connection.canSource);

  const initial: WorkflowInput = {
    name: "",
    description: "",
    isActive: true,
    sourceConnectionId: firstSource?.id ?? "",
    sourceMediaType: "SHORT_VIDEO",
    sourceCollection: "",
    pollIntervalMinutes: 15,
    mode: "MANUAL_APPROVAL",
    includeHashtags: [],
    excludeHashtags: ["#norepost"],
    includeKeywords: [],
    excludeKeywords: [],
    minDurationSec: null,
    maxDurationSec: 60,
    importBacklog: false,
    backlogSince: null,
    captionTemplate: "{original_caption}",
    firstCommentTemplate: "",
    captionPrefix: "",
    captionSuffix: "",
    stripHashtags: false,
    replaceHashtags: [],
    preserveMentions: true,
    repurposeFirstComment: false,
    aspectRatio: "PORTRAIT_9_16",
    fillMode: "BLUR",
    trimStartSec: null,
    trimEndSec: null,
    trimMaxDurationSec: 180,
    subtitleMode: "NONE",
    audioMode: "KEEP",
    scheduleMode: "IMMEDIATE",
    dripMaxPerDay: 2,
    dripTimes: ["11:00", "18:00"],
    timezone: "UTC",
    destinations: [],
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="New workflow"
        description="Wire a source account to as many destinations as you need, with filters and render rules."
        actions={
          <Link href="/workflows" className={buttonVariants({ variant: "outline" })}>
            Back to workflows
          </Link>
        }
      />
      <WorkflowBuilder connections={builderConnections} initial={initial} />
    </div>
  );
}
