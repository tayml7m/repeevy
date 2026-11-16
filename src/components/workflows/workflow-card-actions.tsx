"use client";

import * as React from "react";

import { Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/field";
import {
  deleteWorkflowAction,
  runWorkflowAction,
  toggleWorkflowAction,
} from "@/lib/actions/workflows";
import type { ActionResult } from "@/lib/actions/types";

export function WorkflowCardActions({
  workflowId,
  workflowName,
  isActive,
}: {
  workflowId: string;
  workflowName: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [active, setActive] = React.useState(isActive);
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const run = (action: () => Promise<ActionResult>) => {
    startTransition(async () => setResult(await action()));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Switch
            checked={active}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.checked;
              setActive(next);
              run(() => toggleWorkflowAction(workflowId, next));
            }}
            aria-label={`Toggle ${workflowName}`}
          />
          {active ? "Active" : "Paused"}
        </label>

        <div className="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => runWorkflowAction(workflowId))}
          >
            <Play className="size-3.5" aria-hidden />
            Run now
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
            aria-label={`Delete ${workflowName}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {result ? (
        <p
          className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
            result.ok
              ? "bg-[var(--success)]/10 text-[var(--success)]"
              : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
          }`}
        >
          {result.message}
        </p>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{workflowName}”?</DialogTitle>
            <DialogDescription>
              This removes the workflow and its queue history, including publish records. Detected
              media on the volume is cleaned up on the next retention sweep.
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const response = await deleteWorkflowAction(workflowId);
                  if (response.ok) setConfirmDelete(false);
                  setResult(response);
                });
              }}
            >
              Delete workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
