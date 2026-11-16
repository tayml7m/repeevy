"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Filter,
  Globe2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { saveWorkflowAction } from "@/lib/actions/workflows";
import type { ActionResult } from "@/lib/actions/types";
import { providerLabel } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import {
  ASPECT_OPTIONS,
  AUDIO_OPTIONS,
  AUTOMATION_OPTIONS,
  FILL_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  PRIVACY_OPTIONS,
  SCHEDULE_OPTIONS,
  SUBTITLE_OPTIONS,
  TARGET_MEDIA_OPTIONS,
  joinList,
  splitList,
  type DestinationInput,
  type WorkflowInput,
} from "@/lib/workflow-types";

export type BuilderConnection = {
  id: string;
  provider: string;
  label: string;
  accountName: string | null;
  canSource: boolean;
  canDestination: boolean;
};

const STEPS = [
  { key: "source", title: "Source", icon: Sparkles },
  { key: "filters", title: "Trigger & filters", icon: Filter },
  { key: "rules", title: "Media & captions", icon: Captions },
  { key: "destinations", title: "Destinations", icon: Send },
] as const;

const LIST_KEYS = [
  "includeHashtags",
  "excludeHashtags",
  "includeKeywords",
  "excludeKeywords",
  "replaceHashtags",
  "dripTimes",
] as const;

type ListKey = (typeof LIST_KEYS)[number];

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function destinationDefaults(connection: BuilderConnection) {
  return {
    connectionId: connection.id,
    targetMediaType: connection.provider === "GOOGLE_DRIVE" ? "VIDEO" : "SHORT_VIDEO",
    privacyStatus: null as string | null,
    folderPath: null as string | null,
    aspectRatio: null as string | null,
    titleTemplate: null as string | null,
    captionTemplate: null as string | null,
    firstCommentTemplate: null as string | null,
    maxDurationSec: null as number | null,
  };
}

export function WorkflowBuilder({
  connections,
  workflowId,
  initial,
}: {
  connections: BuilderConnection[];
  workflowId?: string;
  initial: WorkflowInput;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [values, setValues] = React.useState<WorkflowInput>(initial);
  const [lists, setLists] = React.useState<Record<ListKey, string>>(() => ({
    includeHashtags: joinList(initial.includeHashtags),
    excludeHashtags: joinList(initial.excludeHashtags),
    includeKeywords: joinList(initial.includeKeywords),
    excludeKeywords: joinList(initial.excludeKeywords),
    replaceHashtags: joinList(initial.replaceHashtags),
    dripTimes: joinList(initial.dripTimes),
  }));
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<ActionResult | null>(null);

  const sources = connections.filter((connection) => connection.canSource);
  const destinations = connections.filter((connection) => connection.canDestination);

  const set = <K extends keyof WorkflowInput>(key: K, value: WorkflowInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const setList = (key: ListKey, value: string) =>
    setLists((current) => ({ ...current, [key]: value }));

  const toggleDestination = (connection: BuilderConnection) => {
    setValues((current) => {
      const exists = current.destinations.some((entry) => entry.connectionId === connection.id);
      return {
        ...current,
        destinations: exists
          ? current.destinations.filter((entry) => entry.connectionId !== connection.id)
          : [...current.destinations, destinationDefaults(connection)],
      };
    });
  };

  const updateDestination = (connectionId: string, patch: Partial<DestinationInput>) => {
    setValues((current) => ({
      ...current,
      destinations: current.destinations.map((entry) =>
        entry.connectionId === connectionId ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const submit = () => {
    setResult(null);
    const payload: WorkflowInput = {
      ...values,
      includeHashtags: splitList(lists.includeHashtags),
      excludeHashtags: splitList(lists.excludeHashtags),
      includeKeywords: splitList(lists.includeKeywords),
      excludeKeywords: splitList(lists.excludeKeywords),
      replaceHashtags: splitList(lists.replaceHashtags),
      dripTimes: splitList(lists.dripTimes),
    };

    if (payload.name.trim().length < 2) {
      setStep(0);
      setResult({ ok: false, message: "Give the workflow a name first" });
      return;
    }
    if (!payload.sourceConnectionId) {
      setStep(0);
      setResult({ ok: false, message: "Pick a source connection" });
      return;
    }
    if (payload.destinations.length === 0) {
      setStep(3);
      setResult({ ok: false, message: "Select at least one destination" });
      return;
    }

    startTransition(async () => {
      const response = await saveWorkflowAction(payload, workflowId);
      setResult(response);
      if (response.ok && response.workflowId) {
        if (!workflowId) {
          router.push(`/workflows/${response.workflowId}`);
        } else {
          router.refresh();
        }
      }
    });
  };

  const sourceConnection = connections.find((connection) => connection.id === values.sourceConnectionId);
  const selectedDestinations = values.destinations
    .map((entry) => destinations.find((connection) => connection.id === entry.connectionId))
    .filter((entry): entry is BuilderConnection => Boolean(entry));

  return (
    <div className="space-y-5">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((item, index) => {
          const Icon = item.icon;
          const done = index < step;
          const active = index === step;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setStep(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : done
                      ? "border-[var(--success)]/30 bg-[var(--success)]/5 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-lg text-[10px] font-semibold",
                    active ? "bg-primary text-primary-foreground" : done ? "bg-[var(--success)]/20 text-[var(--success)]" : "bg-muted",
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden /> : index + 1}
                </span>
                <span className="flex items-center gap-1.5 truncate">
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {item.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {step === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Source account</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Where new content comes from. One source can fan out to many destinations.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Workflow name" htmlFor="wf-name">
                    <Input
                      id="wf-name"
                      value={values.name}
                      onChange={(event) => set("name", event.target.value)}
                      placeholder="TikTok → Shorts + Drive"
                    />
                  </Field>
                  <Field label="Poll interval (minutes)" htmlFor="wf-poll">
                    <Input
                      id="wf-poll"
                      type="number"
                      min={1}
                      max={1440}
                      value={values.pollIntervalMinutes}
                      onChange={(event) => set("pollIntervalMinutes", Number(event.target.value) || 15)}
                    />
                  </Field>
                </div>

                <Field label="Description" htmlFor="wf-description" hint="Optional note for yourself.">
                  <Input
                    id="wf-description"
                    value={values.description ?? ""}
                    onChange={(event) => set("description", event.target.value)}
                  />
                </Field>

                <Field label="Source connection" htmlFor="wf-source">
                  <Select
                    id="wf-source"
                    value={values.sourceConnectionId}
                    onChange={(event) => set("sourceConnectionId", event.target.value)}
                  >
                    <option value="">Select a connected source…</option>
                    {sources.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {providerLabel(connection.provider)} — {connection.accountName || connection.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {sources.length === 0 ? (
                  <p className="rounded-xl bg-[var(--warning)]/10 px-3 py-2 text-[11px] text-[var(--warning)]">
                    No source-capable connection yet. Connect TikTok (or another source) on the
                    Connections page first.
                  </p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Source media type" htmlFor="wf-media-type">
                    <Select
                      id="wf-media-type"
                      value={values.sourceMediaType}
                      onChange={(event) => set("sourceMediaType", event.target.value)}
                    >
                      {MEDIA_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Collection / folder (optional)"
                    htmlFor="wf-collection"
                    hint="Drive folder id, playlist id or feed override."
                  >
                    <Input
                      id="wf-collection"
                      value={values.sourceCollection ?? ""}
                      onChange={(event) => set("sourceCollection", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/40 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium">Workflow active</p>
                    <p className="text-[11px] text-muted-foreground">
                      Active workflows are polled 24/7 by the worker.
                    </p>
                  </div>
                  <Switch
                    checked={values.isActive}
                    onChange={(event) => set("isActive", event.target.checked)}
                    aria-label="Workflow active"
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Trigger, filters & automation</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Only matching posts continue down the pipeline. Hashtags match case-insensitively.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Automation mode" htmlFor="wf-mode">
                    <Select
                      id="wf-mode"
                      value={values.mode}
                      onChange={(event) => set("mode", event.target.value)}
                    >
                      {AUTOMATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Publishing schedule" htmlFor="wf-schedule-mode">
                    <Select
                      id="wf-schedule-mode"
                      value={values.scheduleMode}
                      onChange={(event) => set("scheduleMode", event.target.value)}
                    >
                      {SCHEDULE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Include hashtags"
                    htmlFor="wf-include-tags"
                    hint="Comma separated. Empty = all posts."
                  >
                    <Input
                      id="wf-include-tags"
                      value={lists.includeHashtags}
                      onChange={(event) => setList("includeHashtags", event.target.value)}
                      placeholder="#shorts, #repost"
                    />
                  </Field>
                  <Field label="Exclude hashtags" htmlFor="wf-exclude-tags">
                    <Input
                      id="wf-exclude-tags"
                      value={lists.excludeHashtags}
                      onChange={(event) => setList("excludeHashtags", event.target.value)}
                      placeholder="#norepost"
                    />
                  </Field>
                  <Field label="Include keywords" htmlFor="wf-include-keywords">
                    <Input
                      id="wf-include-keywords"
                      value={lists.includeKeywords}
                      onChange={(event) => setList("includeKeywords", event.target.value)}
                      placeholder="recipe, tutorial"
                    />
                  </Field>
                  <Field label="Exclude keywords" htmlFor="wf-exclude-keywords">
                    <Input
                      id="wf-exclude-keywords"
                      value={lists.excludeKeywords}
                      onChange={(event) => setList("excludeKeywords", event.target.value)}
                      placeholder="giveaway, ad"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Min duration (seconds)" htmlFor="wf-min-duration">
                    <Input
                      id="wf-min-duration"
                      type="number"
                      min={0}
                      value={values.minDurationSec ?? ""}
                      onChange={(event) => set("minDurationSec", numberOrNull(event.target.value))}
                    />
                  </Field>
                  <Field
                    label="Max duration (seconds)"
                    htmlFor="wf-max-duration"
                    hint="Skip longer videos, e.g. 60 for Shorts-only sources."
                  >
                    <Input
                      id="wf-max-duration"
                      type="number"
                      min={0}
                      value={values.maxDurationSec ?? ""}
                      onChange={(event) => set("maxDurationSec", numberOrNull(event.target.value))}
                    />
                  </Field>
                </div>

                <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium">Import existing backlog</p>
                      <p className="text-[11px] text-muted-foreground">
                        Off = only posts from now on. On = older posts are eligible.
                      </p>
                    </div>
                    <Switch
                      checked={values.importBacklog}
                      onChange={(event) => set("importBacklog", event.target.checked)}
                      aria-label="Import existing backlog"
                    />
                  </div>
                  {values.importBacklog ? (
                    <Field label="Backlog since (optional)" htmlFor="wf-backlog-since">
                      <Input
                        id="wf-backlog-since"
                        type="date"
                        value={values.backlogSince ?? ""}
                        onChange={(event) => set("backlogSince", event.target.value)}
                      />
                    </Field>
                  ) : null}
                </div>

                {values.scheduleMode === "DRIP" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Publish times"
                      htmlFor="wf-drip-times"
                      hint="24h HH:mm, comma separated."
                    >
                      <Input
                        id="wf-drip-times"
                        value={lists.dripTimes}
                        onChange={(event) => setList("dripTimes", event.target.value)}
                        placeholder="11:00, 18:00"
                      />
                    </Field>
                    <Field label="Max per day" htmlFor="wf-drip-max">
                      <Input
                        id="wf-drip-max"
                        type="number"
                        min={1}
                        value={values.dripMaxPerDay ?? ""}
                        onChange={(event) => set("dripMaxPerDay", numberOrNull(event.target.value))}
                      />
                    </Field>
                    <Field label="Timezone" htmlFor="wf-timezone">
                      <Input
                        id="wf-timezone"
                        value={values.timezone}
                        onChange={(event) => set("timezone", event.target.value)}
                        placeholder="America/New_York"
                      />
                    </Field>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {step === 2 ? (
            <Card>
              <CardHeader>
                <CardTitle>Media & caption rules</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Applied with FFmpeg during processing. Destination overrides live in step 4.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Aspect ratio" htmlFor="wf-aspect">
                    <Select
                      id="wf-aspect"
                      value={values.aspectRatio}
                      onChange={(event) => set("aspectRatio", event.target.value)}
                    >
                      {ASPECT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Fill mode" htmlFor="wf-fill">
                    <Select
                      id="wf-fill"
                      value={values.fillMode}
                      onChange={(event) => set("fillMode", event.target.value)}
                    >
                      {FILL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Audio" htmlFor="wf-audio">
                    <Select
                      id="wf-audio"
                      value={values.audioMode}
                      onChange={(event) => set("audioMode", event.target.value)}
                    >
                      {AUDIO_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Trim start (s)" htmlFor="wf-trim-start">
                    <Input
                      id="wf-trim-start"
                      type="number"
                      min={0}
                      step="0.1"
                      value={values.trimStartSec ?? ""}
                      onChange={(event) => set("trimStartSec", numberOrNull(event.target.value))}
                    />
                  </Field>
                  <Field label="Trim end (s)" htmlFor="wf-trim-end">
                    <Input
                      id="wf-trim-end"
                      type="number"
                      min={0}
                      step="0.1"
                      value={values.trimEndSec ?? ""}
                      onChange={(event) => set("trimEndSec", numberOrNull(event.target.value))}
                    />
                  </Field>
                  <Field label="Cap duration (s)" htmlFor="wf-trim-cap">
                    <Input
                      id="wf-trim-cap"
                      type="number"
                      min={1}
                      value={values.trimMaxDurationSec ?? ""}
                      onChange={(event) => set("trimMaxDurationSec", numberOrNull(event.target.value))}
                    />
                  </Field>
                </div>

                <Field
                  label="Subtitles"
                  htmlFor="wf-subtitles"
                  hint="Burn-in uses the .srt asset attached on the workflow page after saving."
                >
                  <Select
                    id="wf-subtitles"
                    value={values.subtitleMode}
                    onChange={(event) => set("subtitleMode", event.target.value)}
                  >
                    {SUBTITLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Caption template"
                  htmlFor="wf-caption-template"
                  hint="Variables: {original_caption} {title} {source_url} {hashtags} {date} {workflow_name}"
                >
                  <Textarea
                    id="wf-caption-template"
                    value={values.captionTemplate ?? ""}
                    onChange={(event) => set("captionTemplate", event.target.value)}
                    rows={4}
                    placeholder="{original_caption}"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Caption prefix" htmlFor="wf-prefix">
                    <Input
                      id="wf-prefix"
                      value={values.captionPrefix ?? ""}
                      onChange={(event) => set("captionPrefix", event.target.value)}
                    />
                  </Field>
                  <Field label="Caption suffix" htmlFor="wf-suffix">
                    <Input
                      id="wf-suffix"
                      value={values.captionSuffix ?? ""}
                      onChange={(event) => set("captionSuffix", event.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Replacement hashtags" htmlFor="wf-replace-tags" hint="Replaces source hashtags.">
                    <Input
                      id="wf-replace-tags"
                      value={lists.replaceHashtags}
                      onChange={(event) => setList("replaceHashtags", event.target.value)}
                      placeholder="#shorts"
                    />
                  </Field>
                  <div className="space-y-2 rounded-xl border border-border/70 bg-background/40 p-3">
                    <label className="flex items-center justify-between gap-2 text-xs">
                      Strip source hashtags
                      <Switch
                        checked={values.stripHashtags}
                        onChange={(event) => set("stripHashtags", event.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs">
                      Preserve @mentions
                      <Switch
                        checked={values.preserveMentions}
                        onChange={(event) => set("preserveMentions", event.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs">
                      Repurpose first comment
                      <Switch
                        checked={values.repurposeFirstComment}
                        onChange={(event) => set("repurposeFirstComment", event.target.checked)}
                      />
                    </label>
                  </div>
                </div>

                {values.repurposeFirstComment ? (
                  <Field
                    label="First comment template"
                    htmlFor="wf-first-comment"
                    hint="{original_first_comment} is the source comment."
                  >
                    <Textarea
                      id="wf-first-comment"
                      value={values.firstCommentTemplate ?? ""}
                      onChange={(event) => set("firstCommentTemplate", event.target.value)}
                      rows={2}
                      placeholder="{original_first_comment}"
                    />
                  </Field>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card>
              <CardHeader>
                <CardTitle>Destinations</CardTitle>
                <p className="text-xs text-muted-foreground">
                  One source fans out to every destination you select here.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {destinations.length === 0 ? (
                  <p className="rounded-xl bg-[var(--warning)]/10 px-3 py-2 text-[11px] text-[var(--warning)]">
                    No destination-capable connection. Connect YouTube, Google Drive or another
                    destination first.
                  </p>
                ) : null}

                {destinations.map((connection) => {
                  const selected = values.destinations.find(
                    (entry) => entry.connectionId === connection.id,
                  );
                  return (
                    <div
                      key={connection.id}
                      className={cn(
                        "rounded-xl border p-3 transition-colors",
                        selected ? "border-primary/40 bg-primary/5" : "border-border bg-background/30",
                      )}
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(selected)}
                          onChange={() => toggleDestination(connection)}
                          className="size-4 accent-[var(--primary)]"
                        />
                        <span className="font-medium">{providerLabel(connection.provider)}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {connection.accountName || connection.label}
                        </span>
                      </label>

                      {selected ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field label="Target media" htmlFor={`target-${connection.id}`}>
                            <Select
                              id={`target-${connection.id}`}
                              value={selected.targetMediaType}
                              onChange={(event) =>
                                updateDestination(connection.id, {
                                  targetMediaType: event.target.value,
                                })
                              }
                            >
                              {TARGET_MEDIA_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Aspect override" htmlFor={`aspect-${connection.id}`}>
                            <Select
                              id={`aspect-${connection.id}`}
                              value={selected.aspectRatio ?? ""}
                              onChange={(event) =>
                                updateDestination(connection.id, {
                                  aspectRatio: event.target.value || null,
                                })
                              }
                            >
                              <option value="">Use workflow default</option>
                              {ASPECT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          {connection.provider !== "INSTAGRAM" && connection.provider !== "FACEBOOK" ? (
                            <Field label="Privacy" htmlFor={`privacy-${connection.id}`}>
                              <Select
                                id={`privacy-${connection.id}`}
                                value={selected.privacyStatus ?? ""}
                                onChange={(event) =>
                                  updateDestination(connection.id, {
                                    privacyStatus: event.target.value || null,
                                  })
                                }
                              >
                                {PRIVACY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          ) : null}
                          {connection.provider === "FACEBOOK" || connection.provider === "INSTAGRAM" ? (
                            <Field
                              label={
                                connection.provider === "FACEBOOK"
                                  ? "Page (optional)"
                                  : "Instagram account (optional)"
                              }
                              htmlFor={`account-${connection.id}`}
                              hint={
                                connection.provider === "FACEBOOK"
                                  ? "Page id or name. Leave blank when you only administer one Page."
                                  : "@username or Page id. Leave blank when only one account is linked."
                              }
                            >
                              <Input
                                id={`account-${connection.id}`}
                                value={selected.folderPath ?? ""}
                                onChange={(event) =>
                                  updateDestination(connection.id, {
                                    folderPath: event.target.value || null,
                                  })
                                }
                                placeholder={connection.provider === "FACEBOOK" ? "My Page" : "@studio"}
                              />
                            </Field>
                          ) : connection.provider === "GOOGLE_DRIVE" || connection.provider === "DROPBOX" ? (
                            <Field
                              label="Folder id or URL"
                              htmlFor={`folder-${connection.id}`}
                              hint="Google Drive folder id, folder URL, or root."
                            >
                              <Input
                                id={`folder-${connection.id}`}
                                value={selected.folderPath ?? ""}
                                onChange={(event) =>
                                  updateDestination(connection.id, {
                                    folderPath: event.target.value || null,
                                  })
                                }
                              />
                            </Field>
                          ) : (
                            <Field label="Title template" htmlFor={`title-${connection.id}`}>
                              <Input
                                id={`title-${connection.id}`}
                                value={selected.titleTemplate ?? ""}
                                onChange={(event) =>
                                  updateDestination(connection.id, {
                                    titleTemplate: event.target.value || null,
                                  })
                                }
                                placeholder="{title}"
                              />
                            </Field>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {result ? (
            <p
              className={cn(
                "rounded-xl px-3 py-2 text-xs",
                result.ok
                  ? "bg-[var(--success)]/10 text-[var(--success)]"
                  : "bg-[var(--destructive)]/10 text-[var(--destructive)]",
              )}
            >
              {result.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
            <div className="flex gap-2">
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>
                  Next
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : null}
              <Button variant={step === STEPS.length - 1 ? "default" : "secondary"} onClick={submit} disabled={pending}>
                <Save className="size-4" aria-hidden />
                {pending ? "Saving…" : workflowId ? "Save workflow" : "Create workflow"}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="xl:sticky xl:top-24">
            <CardHeader>
              <CardTitle>Recipe summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Source</p>
                <p className="mt-1 text-sm font-medium">
                  {sourceConnection ? providerLabel(sourceConnection.provider) : "Not selected"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {sourceConnection?.accountName || sourceConnection?.label || "Pick a connection"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{values.mode === "AUTO_PUBLISH" ? "Auto-publish" : "Manual review"}</Badge>
                <Badge variant="outline">
                  {values.scheduleMode === "DRIP" ? "Drip schedule" : "Immediate"}
                </Badge>
                <Badge variant="outline">{values.sourceMediaType.toLowerCase().replace("_", " ")}</Badge>
                <Badge variant={values.isActive ? "success" : "muted"} dot>
                  {values.isActive ? "Active" : "Paused"}
                </Badge>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Destinations ({selectedDestinations.length})
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {selectedDestinations.length === 0 ? (
                    <li className="text-[11px] text-muted-foreground">None selected yet</li>
                  ) : (
                    selectedDestinations.map((connection) => (
                      <li
                        key={connection.id}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-2 py-1.5"
                      >
                        <Globe2 className="size-3.5 text-primary" aria-hidden />
                        <span className="flex-1 truncate">{providerLabel(connection.provider)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {values.destinations
                            .find((entry) => entry.connectionId === connection.id)
                            ?.targetMediaType.toLowerCase()
                            .replace("_", " ")}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              {values.captionTemplate ? (
                <div className="rounded-xl border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Caption</p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                    {values.captionTemplate}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tips</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p className="flex gap-2">
                <Plus className="mt-0.5 size-3 shrink-0" aria-hidden />
                Add destinations in step 4 — one source post can publish to all of them at once.
              </p>
              <p className="flex gap-2">
                <Trash2 className="mt-0.5 size-3 shrink-0" aria-hidden />
                Deselecting a destination keeps its publish history; it's disabled, not deleted.
              </p>
              <p className="flex gap-2">
                <Send className="mt-0.5 size-3 shrink-0" aria-hidden />
                Manual workflows collect items for review instead of publishing instantly.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
