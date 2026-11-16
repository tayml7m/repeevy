import Link from "next/link";

import { Search, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

const STATUS_OPTIONS = [
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
];

export function QueueFilters({
  workflows,
  values,
}: {
  workflows: Array<{ id: string; name: string }>;
  values: { q?: string; status?: string; workflow?: string; hashtag?: string };
}) {
  const hasFilters = Boolean(values.q || values.status || values.workflow || values.hashtag);

  return (
    <form
      method="get"
      action="/queue"
      className="grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.8fr_0.9fr_0.8fr_auto]"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          name="q"
          defaultValue={values.q ?? ""}
          placeholder="Search title or caption"
          className="pl-8"
          aria-label="Search title or caption"
        />
      </div>
      <Input
        name="hashtag"
        defaultValue={values.hashtag ?? ""}
        placeholder="#hashtag"
        aria-label="Filter by hashtag"
      />
      <Select name="status" defaultValue={values.status ?? ""} aria-label="Filter by status">
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>
      <Select name="workflow" defaultValue={values.workflow ?? ""} aria-label="Filter by workflow">
        <option value="">All workflows</option>
        {workflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.name}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <button type="submit" className={buttonVariants({ className: "flex-1" })}>
          Apply
        </button>
        {hasFilters ? (
          <Link href="/queue" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Clear filters">
            <X className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </form>
  );
}
