import Link from "next/link";

import { ArrowRight, Clock, Send, Workflow as WorkflowIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SetupRequired } from "@/components/setup-required";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowCardActions } from "@/components/workflows/workflow-card-actions";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { providerLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  if (!(await databaseReady())) return <SetupRequired />;

  const workflows = await prisma.workflow.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      sourceConnection: { select: { provider: true, accountName: true, label: true } },
      destinations: {
        where: { isEnabled: true },
        include: { connection: { select: { provider: true, accountName: true, label: true } } },
      },
      _count: { select: { contentItems: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workflows"
        description="Source → filters → render rules → many destinations. The worker polls every active workflow."
        actions={
          <>
            <Link href="/queue" className={buttonVariants({ variant: "outline" })}>
              Queue
            </Link>
            <Link href="/workflows/new" className={buttonVariants()}>
              New workflow
            </Link>
          </>
        }
      />

      {workflows.length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon className="size-7" />}
          title="No workflows yet"
          description="A workflow watches one source account, applies your filters and publishes each new post to as many destinations as you like."
          action={{ href: "/workflows/new", label: "Build a workflow" }}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{workflow.name}</CardTitle>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant={workflow.isActive ? "success" : "muted"} dot>
                      {workflow.isActive ? "Active" : "Paused"}
                    </Badge>
                    <Badge variant="outline">
                      {workflow.mode === "AUTO_PUBLISH" ? "Auto-publish" : "Manual review"}
                    </Badge>
                    <Badge variant="outline">
                      {workflow.scheduleMode === "DRIP"
                        ? `Drip · ${workflow.dripTimes.join(", ") || "no slots"}`
                        : "Immediate"}
                    </Badge>
                  </p>
                </div>
                <Link
                  href={`/workflows/${workflow.id}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Edit
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Source</p>
                    <p className="truncate text-xs font-medium">
                      {providerLabel(workflow.sourceConnection.provider)} ·{" "}
                      {workflow.sourceConnection.accountName || workflow.sourceConnection.label}
                    </p>
                  </div>
                  <Send className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Destinations ({workflow.destinations.length})
                    </p>
                    <p className="truncate text-xs font-medium">
                      {workflow.destinations.length === 0
                        ? "None enabled"
                        : workflow.destinations
                            .map((destination) => providerLabel(destination.connection.provider))
                            .join(" · ")}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" aria-hidden />
                    every {workflow.pollIntervalMinutes}m · polled {formatRelative(workflow.lastPolledAt)}
                  </span>
                  <span>{workflow._count.contentItems} item(s)</span>
                  <span className="font-mono text-[10px]">{workflow.sourceMediaType.toLowerCase()}</span>
                </div>

                {workflow.lastPollError ? (
                  <p className="line-clamp-2 rounded-lg bg-[var(--destructive)]/10 px-2.5 py-1.5 text-[11px] text-[var(--destructive)]">
                    {workflow.lastPollError}
                  </p>
                ) : null}

                <WorkflowCardActions
                  workflowId={workflow.id}
                  workflowName={workflow.name}
                  isActive={workflow.isActive}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
