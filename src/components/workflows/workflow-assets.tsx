"use client";

import * as React from "react";

import { Film, Paperclip, Subtitles, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import {
  deleteWorkflowAssetAction,
  uploadWorkflowAssetAction,
} from "@/lib/actions/assets";
import type { ActionResult } from "@/lib/actions/types";
import { formatBytes } from "@/lib/utils";

export type WorkflowAsset = {
  id: string;
  kind: string;
  filename: string;
  sizeBytes: number | null;
};

const KIND_LABEL: Record<string, string> = {
  INTRO: "Intro clip",
  OUTRO: "Outro clip",
  SUBTITLE: "Subtitle file",
};

export function WorkflowAssets({
  workflowId,
  assets,
}: {
  workflowId: string;
  assets: WorkflowAsset[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState("SUBTITLE");
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = () => {
    if (!file) {
      setResult({ ok: false, message: "Choose a file first" });
      return;
    }
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("file", file);
    startTransition(async () => {
      const response = await uploadWorkflowAssetAction(workflowId, formData);
      setResult(response);
      if (response.ok) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="size-4 text-primary" aria-hidden />
          Media assets
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Intro/outro clips are concatenated during rendering; a subtitle file is burned in when the
          workflow subtitle mode is set to burn-in.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            aria-label="Asset type"
            className="sm:w-44"
          >
            <option value="SUBTITLE">Subtitle (.srt)</option>
            <option value="INTRO">Intro clip</option>
            <option value="OUTRO">Outro clip</option>
          </Select>
          <input
            ref={inputRef}
            type="file"
            accept={kind === "SUBTITLE" ? ".srt,.vtt" : ".mp4,.mov,.webm"}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 rounded-xl border border-input bg-background/60 px-3 py-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]"
          />
          <Button size="sm" disabled={pending || !file} onClick={upload}>
            <Upload className="size-3.5" aria-hidden />
            Upload
          </Button>
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

        {assets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
            No assets attached yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {assets.map((asset) => {
              const Icon =
                asset.kind === "SUBTITLE" ? Subtitles : Film;
              return (
                <li
                  key={asset.id}
                  className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2"
                >
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{asset.filename}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatBytes(asset.sizeBytes ?? 0)}
                    </p>
                  </div>
                  <Badge variant="muted">{KIND_LABEL[asset.kind] ?? asset.kind}</Badge>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-[var(--destructive)]"
                    disabled={pending}
                    aria-label={`Remove ${asset.filename}`}
                    onClick={() =>
                      startTransition(async () =>
                        setResult(await deleteWorkflowAssetAction(workflowId, asset.id)),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
