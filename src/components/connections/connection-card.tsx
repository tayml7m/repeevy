"use client";

import * as React from "react";

import {
  ExternalLink,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { StatusBadge } from "@/components/status-badge";
import {
  addPublicTikTokProfileAction,
  deleteCredentialsAction,
  disconnectAction,
  refreshTokenAction,
  saveCredentialsAction,
  testConnectionAction,
} from "@/lib/actions/connections";
import type { ActionResult } from "@/lib/actions/types";
import { formatRelative } from "@/lib/format";
import type { PlatformDefinition } from "@/lib/platforms";

export type ConnectionSummary = {
  id: string;
  label: string;
  accountName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  canSource: boolean;
  canDestination: boolean;
  authType: string;
  profileUrl: string | null;
};

export function ConnectionCard({
  platform,
  connection,
  credentials,
  redirectUri,
  adapterImplemented,
}: {
  platform: PlatformDefinition;
  connection: ConnectionSummary | null;
  credentials: { configured: boolean; source: "database" | "environment" | "missing" };
  redirectUri: string;
  adapterImplemented: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [profileInput, setProfileInput] = React.useState("");
  const [profileMessage, setProfileMessage] = React.useState<string | null>(null);

  const isTikTok = platform.slug === "tiktok";
  const manualProfile = connection?.authType === "MANUAL";

  const run = (action: () => Promise<ActionResult>) => {
    setResult(null);
    startTransition(async () => setResult(await action()));
  };

  const credentialTone =
    credentials.source === "database" ? "success" : credentials.source === "environment" ? "default" : "warning";
  const credentialLabel =
    credentials.source === "database"
      ? "Saved in DB"
      : credentials.source === "environment"
        ? "From env"
        : "No credentials";

  return (
    <Card className="flex flex-col" style={{ borderTopColor: platform.accent, borderTopWidth: 2 }}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: platform.accent }}
              aria-hidden
            />
            <h3 className="text-sm font-semibold tracking-tight">{platform.label}</h3>
            <Badge variant="muted">{platform.category}</Badge>
          </div>
          {connection ? (
            <StatusBadge status={connection.status} kind="connection" />
          ) : (
            <Badge variant="muted">Not connected</Badge>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{platform.blurb}</p>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {platform.source.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              source: {platform.source.join(", ")}
            </Badge>
          ) : null}
          {platform.destination.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              destination: {platform.destination.slice(0, 3).join(", ")}
            </Badge>
          ) : null}
          {!adapterImplemented ? <Badge variant="warning">adapter pending</Badge> : null}
        </div>

        {connection ? (
          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <div className="flex items-center gap-2">
              {connection.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={connection.avatarUrl}
                  alt=""
                  className="size-8 rounded-full border border-border object-cover"
                />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-muted text-[11px] font-medium">
                  {platform.label.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {connection.accountName || connection.label}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {connection.username ? `@${connection.username} · ` : ""}
                  {connection.authType === "OAUTH"
                    ? `token ${connection.tokenExpiresAt ? `expires ${formatRelative(connection.tokenExpiresAt)}` : "long-lived"}`
                    : "public profile polling (no login)"}
                </p>
                {manualProfile && connection.profileUrl ? (
                  <p className="truncate text-[10px] text-muted-foreground">{connection.profileUrl}</p>
                ) : null}
              </div>
            </div>
            {connection.lastError ? (
              <p className="mt-2 line-clamp-2 rounded-lg bg-[var(--destructive)]/10 px-2 py-1 text-[10px] leading-relaxed text-[var(--destructive)]">
                {connection.lastError}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
            No {platform.label} account connected yet.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={credentialTone} dot>
            {credentialLabel}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto px-2"
            onClick={() => setDialogOpen(true)}
          >
            <KeyRound className="size-3.5" aria-hidden />
            API credentials
          </Button>
        </div>

        {connection ? (
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => testConnectionAction(connection.id))}
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              Test
            </Button>
            {connection.authType === "OAUTH" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => refreshTokenAction(connection.id))}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Refresh
              </Button>
            ) : null}
            {isTikTok && manualProfile ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setProfileMessage(null);
                  setProfileInput(connection.profileUrl ?? "");
                  setProfileOpen(true);
                }}
              >
                Change profile
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
              disabled={pending}
              onClick={() => run(() => disconnectAction(connection.id))}
            >
              <Unplug className="size-3.5" aria-hidden />
              Disconnect
            </Button>
          </div>
        ) : platform.auth === "oauth" ? (
          <div className="mt-auto space-y-2">
            <a
              href={`/api/oauth/${platform.slug}/start`}
              className={buttonVariants({ size: "sm", className: "w-full" })}
            >
              <PlugZap className="size-3.5" aria-hidden />
              Connect {platform.label}
            </a>
            {isTikTok ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setProfileMessage(null);
                  setProfileInput("");
                  setProfileOpen(true);
                }}
              >
                Use public profile (no developer app)
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="mt-auto rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {platform.notes ?? "No OAuth app required for this platform."}
          </p>
        )}

        {result ? (
          <p
            className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
              result.ok
                ? "bg-[var(--success)]/10 text-[var(--success)]"
                : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
            }`}
          >
            {result.message}
          </p>
        ) : null}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{platform.label} developer app</DialogTitle>
            <DialogDescription>
              Paste the client id and secret from your own {platform.label} developer app. The
              secret is encrypted with APP_SECRET and stored in PostgreSQL; values here override
              environment variables.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Redirect URI" hint="Register this exact URL in the provider dashboard.">
              <div className="flex gap-2">
                <Input readOnly value={redirectUri} className="font-mono text-[11px]" />
                <CopyButton value={redirectUri} size="icon" />
              </div>
            </Field>
            <Field
              label="Client ID / key"
              htmlFor={`client-id-${platform.slug}`}
              hint={
                credentials.configured
                  ? "A credential set is already saved. Enter both fields to replace it."
                  : undefined
              }
            >
              <Input
                id={`client-id-${platform.slug}`}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="client id"
                autoComplete="off"
              />
            </Field>
            <Field label="Client secret" htmlFor={`client-secret-${platform.slug}`}>
              <Input
                id={`client-secret-${platform.slug}`}
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder="client secret"
                autoComplete="new-password"
              />
            </Field>
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Env fallback:{" "}
              <span className="font-mono">
                {platform.env.clientId?.[0] ?? "—"}, {platform.env.clientSecret?.[0] ?? "—"}
              </span>
              . Scopes requested: <span className="font-mono">{platform.scopes.join(" ")}</span>
            </p>
            <a
              href={platform.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              How to create this app
            </a>
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
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--destructive)]"
              disabled={pending || !credentials.configured}
              onClick={() => run(() => deleteCredentialsAction(platform.slug))}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remove saved
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const response = await saveCredentialsAction({
                      slug: platform.slug,
                      clientId,
                      clientSecret,
                    });
                    if (response.ok) {
                      setClientId("");
                      setClientSecret("");
                    }
                    return response;
                  })
                }
              >
                Save credentials
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Watch a public TikTok profile</DialogTitle>
            <DialogDescription>
              No developer app, no login, no TikTok audit. The worker lists your newest public videos
              with yt-dlp, then your workflow downloads and publishes them. The videos must be public.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field
              label="Profile URL or @handle"
              htmlFor="tiktok-profile"
              hint="e.g. https://www.tiktok.com/@yourhandle"
            >
              <Input
                id="tiktok-profile"
                value={profileInput}
                onChange={(event) => setProfileInput(event.target.value)}
                placeholder="https://www.tiktok.com/@yourhandle"
                autoComplete="off"
              />
            </Field>
            {profileMessage ? (
              <p
                className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                  profileMessage.toLowerCase().includes("watching")
                    ? "bg-[var(--success)]/10 text-[var(--success)]"
                    : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
                }`}
              >
                {profileMessage}
              </p>
            ) : null}
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              TikTok occasionally rate-limits server IPs. If polling fails, export cookies from a
              browser and point <span className="font-mono">YTDLP_COOKIES_FILE</span> at them.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || !profileInput.trim()}
              onClick={() =>
                startTransition(async () => {
                  const response = await addPublicTikTokProfileAction(profileInput);
                  setProfileMessage(response.message);
                  if (response.ok) {
                    setProfileOpen(false);
                    setProfileInput("");
                  }
                })
              }
            >
              Start watching
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
