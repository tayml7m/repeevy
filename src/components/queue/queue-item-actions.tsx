"use client";

import * as React from "react";

import {
  AlertCircle,
  Pencil,
  RotateCcw,
  Scissors,
  Send,
} from "lucide-react";

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
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  publishNowAction,
  rerunItemAction,
  trimItemAction,
  updateItemCopyAction,
} from "@/lib/actions/queue";
import type { ActionResult } from "@/lib/actions/types";

export type QueueLog = {
  id: string;
  level: string;
  stage: string;
  message: string;
  stack: string | null;
  createdAt: string;
};

export type QueueItemActionsProps = {
  itemId: string;
  caption: string;
  title: string | null;
  firstComment: string | null;
  trimStartSec: number | null;
  trimEndSec: number | null;
  status: string;
  errorText: string | null;
  targetErrors: string[];
  logs: QueueLog[];
};

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
        result.ok
          ? "bg-[var(--success)]/10 text-[var(--success)]"
          : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
      }`}
    >
      {result.message}
    </p>
  );
}

export function QueueItemActions(props: QueueItemActionsProps) {
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"edit" | "trim" | "error" | null>(null);
  const [result, setResult] = React.useState<ActionResult | null>(null);

  const [caption, setCaption] = React.useState(props.caption);
  const [title, setTitle] = React.useState(props.title ?? "");
  const [firstComment, setFirstComment] = React.useState(props.firstComment ?? "");
  const [trimStart, setTrimStart] = React.useState(
    props.trimStartSec != null ? String(props.trimStartSec) : "",
  );
  const [trimEnd, setTrimEnd] = React.useState(
    props.trimEndSec != null ? String(props.trimEndSec) : "",
  );

  const hasError =
    Boolean(props.errorText) || props.targetErrors.length > 0 || props.logs.length > 0;

  const run = (action: () => Promise<ActionResult>, close = false) => {
    setResult(null);
    startTransition(async () => {
      const response = await action();
      setResult(response);
      if (response.ok && close) setDialog(null);
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          disabled={pending || props.status === "PUBLISHING"}
          onClick={() => run(() => publishNowAction(props.itemId))}
        >
          <Send className="size-3.5" aria-hidden />
          Publish now
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          title="Edit title & caption"
          aria-label="Edit title and caption"
          onClick={() => {
            setResult(null);
            setDialog("edit");
          }}
        >
          <Pencil className="size-3.5" aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          title="Trim video"
          aria-label="Trim video"
          onClick={() => {
            setResult(null);
            setDialog("trim");
          }}
        >
          <Scissors className="size-3.5" aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          title="Re-run pipeline"
          aria-label="Re-run pipeline"
          disabled={pending}
          onClick={() => run(() => rerunItemAction(props.itemId))}
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
        {hasError ? (
          <Button
            size="icon-sm"
            variant="outline"
            title="View full error trace"
            aria-label="View full error trace"
            onClick={() => {
              setResult(null);
              setDialog("error");
            }}
          >
            <AlertCircle className="size-3.5 text-[var(--destructive)]" aria-hidden />
          </Button>
        ) : null}
      </div>

      {result ? <div className="mt-2"><Result result={result} /></div> : null}

      <Dialog open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit title & caption</DialogTitle>
            <DialogDescription>
              Changes apply to every destination that has not been published yet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Title" htmlFor={`title-${props.itemId}`}>
              <Input
                id={`title-${props.itemId}`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Destination title (YouTube uses 100 chars)"
              />
            </Field>
            <Field label="Caption" htmlFor={`caption-${props.itemId}`}>
              <Textarea
                id={`caption-${props.itemId}`}
                value={caption}
                rows={7}
                onChange={(event) => setCaption(event.target.value)}
              />
            </Field>
            <Field
              label="First comment"
              htmlFor={`comment-${props.itemId}`}
              hint="Posted when the workflow has first-comment repurposing enabled."
            >
              <Textarea
                id={`comment-${props.itemId}`}
                value={firstComment}
                rows={2}
                onChange={(event) => setFirstComment(event.target.value)}
              />
            </Field>
            <Result result={result} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateItemCopyAction({
                      contentItemId: props.itemId,
                      caption,
                      title,
                      firstComment,
                    }),
                  true,
                )
              }
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "trim"} onOpenChange={(open) => setDialog(open ? "trim" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trim video</DialogTitle>
            <DialogDescription>
              Seconds to cut from the start and end. Re-running renders every destination again
              with the new trim.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start (seconds)" htmlFor={`start-${props.itemId}`}>
                <Input
                  id={`start-${props.itemId}`}
                  type="number"
                  min={0}
                  step="0.1"
                  value={trimStart}
                  onChange={(event) => setTrimStart(event.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="End (seconds)" htmlFor={`end-${props.itemId}`}>
                <Input
                  id={`end-${props.itemId}`}
                  type="number"
                  min={0}
                  step="0.1"
                  value={trimEnd}
                  onChange={(event) => setTrimEnd(event.target.value)}
                  placeholder="—"
                />
              </Field>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Leave both empty to fall back to the workflow trim settings.
            </p>
            <Result result={result} />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const response = await trimItemAction({
                    contentItemId: props.itemId,
                    trimStartSec: null,
                    trimEndSec: null,
                  });
                  return response;
                })
              }
            >
              Reset
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    trimItemAction({
                      contentItemId: props.itemId,
                      trimStartSec: trimStart.trim() === "" ? null : Number(trimStart),
                      trimEndSec: trimEnd.trim() === "" ? null : Number(trimEnd),
                    }),
                  true,
                )
              }
            >
              Save & re-render
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "error"} onOpenChange={(open) => setDialog(open ? "error" : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Error trace</DialogTitle>
            <DialogDescription>
              Pipeline failures for this item, including stack traces and per-destination errors.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {props.errorText ? (
              <div>
                <p className="mb-1 text-xs font-medium">Last error</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3 font-mono text-[11px] leading-relaxed">
                  {props.errorText}
                </pre>
              </div>
            ) : null}

            {props.targetErrors.map((error, index) => (
              <div key={index}>
                <p className="mb-1 text-xs font-medium">Destination error</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
                  {error}
                </pre>
              </div>
            ))}

            {props.logs.map((log) => (
              <div key={log.id}>
                <p className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <span className="uppercase tracking-wide text-muted-foreground">{log.stage}</span>
                  <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                </p>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
                  {log.stack ? `${log.message}\n\n${log.stack}` : log.message}
                </pre>
              </div>
            ))}

            {!props.errorText && props.targetErrors.length === 0 && props.logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No errors recorded for this item.</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => rerunItemAction(props.itemId), true)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Re-run pipeline
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
