"use client";

import * as React from "react";

import { CalendarClock, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { updateScheduleAction } from "@/lib/actions/schedule";
import type { ActionResult } from "@/lib/actions/types";
import { SCHEDULE_OPTIONS, joinList, splitList } from "@/lib/workflow-types";

export function ScheduleForm({
  workflowId,
  name,
  scheduleMode,
  dripTimes,
  dripMaxPerDay,
  timezone,
  isActive,
}: {
  workflowId: string;
  name: string;
  scheduleMode: string;
  dripTimes: string[];
  dripMaxPerDay: number | null;
  timezone: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [mode, setMode] = React.useState(scheduleMode);
  const [times, setTimes] = React.useState(joinList(dripTimes));
  const [maxPerDay, setMaxPerDay] = React.useState(dripMaxPerDay != null ? String(dripMaxPerDay) : "");
  const [zone, setZone] = React.useState(timezone);
  const [result, setResult] = React.useState<ActionResult | null>(null);

  const save = () => {
    setResult(null);
    startTransition(async () => {
      setResult(
        await updateScheduleAction({
          workflowId,
          scheduleMode: mode,
          dripTimes: splitList(times),
          dripMaxPerDay: maxPerDay.trim() === "" ? null : Number(maxPerDay),
          timezone: zone,
        }),
      );
    });
  };

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            {name}
          </CardTitle>
          <Badge variant={isActive ? "success" : "muted"} dot>
            {isActive ? "Active" : "Paused"}
          </Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Drip reserves the next free slot in the workflow timezone; slots are unique so two items
          never publish at the same minute.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mode" htmlFor={`mode-${workflowId}`}>
            <Select id={`mode-${workflowId}`} value={mode} onChange={(event) => setMode(event.target.value)}>
              {SCHEDULE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone" htmlFor={`tz-${workflowId}`}>
            <Input
              id={`tz-${workflowId}`}
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              placeholder="UTC"
            />
          </Field>
        </div>

        {mode === "DRIP" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Publish times"
              htmlFor={`times-${workflowId}`}
              hint="24h HH:mm, comma separated (e.g. 11:00, 18:00)."
            >
              <Input
                id={`times-${workflowId}`}
                value={times}
                onChange={(event) => setTimes(event.target.value)}
              />
            </Field>
            <Field label="Max per day" htmlFor={`max-${workflowId}`}>
              <Input
                id={`max-${workflowId}`}
                type="number"
                min={1}
                value={maxPerDay}
                onChange={(event) => setMaxPerDay(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={save}>
            <Save className="size-3.5" aria-hidden />
            Save schedule
          </Button>
          {result ? (
            <span
              className={`text-[11px] ${
                result.ok ? "text-[var(--success)]" : "text-[var(--destructive)]"
              }`}
            >
              {result.message}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
