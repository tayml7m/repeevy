import { Badge, type BadgeProps } from "@/components/ui/badge";

const CONTENT_TONES: Record<string, BadgeProps["variant"]> = {
  DETECTED: "muted",
  DOWNLOADING: "default",
  PROCESSING: "default",
  READY: "outline",
  SCHEDULED: "warning",
  PUBLISHING: "default",
  PUBLISHED: "success",
  PARTIAL: "warning",
  FAILED: "danger",
  SKIPPED: "muted",
};

const LABELS: Record<string, string> = {
  DETECTED: "Detected",
  DOWNLOADING: "Downloading",
  PROCESSING: "Processing",
  READY: "Ready",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  PARTIAL: "Partial",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  PENDING: "Pending",
  ACTIVE: "Connected",
  EXPIRED: "Token expired",
  ERROR: "Error",
  DISCONNECTED: "Disconnected",
  RESERVED: "Reserved",
  USED: "Used",
  RELEASED: "Released",
};

const CONNECTION_TONES: Record<string, BadgeProps["variant"]> = {
  ACTIVE: "success",
  EXPIRED: "warning",
  ERROR: "danger",
  PENDING: "muted",
  DISCONNECTED: "muted",
};

export function StatusBadge({
  status,
  kind = "content",
  dot = true,
  className,
}: {
  status: string;
  kind?: "content" | "connection";
  dot?: boolean;
  className?: string;
}) {
  const tone =
    kind === "connection"
      ? (CONNECTION_TONES[status] ?? "muted")
      : (CONTENT_TONES[status] ?? "muted");
  return (
    <Badge variant={tone} dot={dot} className={className}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
