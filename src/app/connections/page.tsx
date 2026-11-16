import Link from "next/link";

import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

import { ConnectionCard, type ConnectionSummary } from "@/components/connections/connection-card";
import { PageHeader } from "@/components/page-header";
import { SetupRequired } from "@/components/setup-required";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { databaseReady } from "@/lib/db-gate";
import { prisma } from "@/lib/db";
import { isDestinationImplemented, isSourceImplemented } from "@/lib/adapters/registry";
import { PLATFORMS } from "@/lib/platforms";
import { listOAuthCredentialStatus } from "@/lib/settings";
import { getAppOrigin } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const GROUPS: Array<{ title: string; description: string; categories: string[] }> = [
  {
    title: "Video & social",
    description: "Sources you pull from and destinations you publish to.",
    categories: ["video", "social"],
  },
  {
    title: "Cloud storage",
    description: "Backup destinations for masters, exports and captions.",
    categories: ["cloud"],
  },
  {
    title: "Audio",
    description: "Long-form audio sources that become short video.",
    categories: ["audio"],
  },
];

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await databaseReady())) return <SetupRequired />;

  const sp = await searchParams;
  const connected = typeof sp.connected === "string" ? sp.connected : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [connections, credentialStatus, appOrigin] = await Promise.all([
    prisma.connection.findMany({ orderBy: { provider: "asc" } }),
    listOAuthCredentialStatus(),
    getAppOrigin(),
  ]);

  const byProvider = new Map<string, ConnectionSummary>();
  for (const connection of connections) {
    if (!byProvider.has(connection.provider)) {
      const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
      byProvider.set(connection.provider, {
        id: connection.id,
        label: connection.label,
        accountName: connection.accountName,
        username: connection.username,
        avatarUrl: connection.avatarUrl,
        status: connection.status,
        tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
        lastRefreshedAt: connection.lastRefreshedAt?.toISOString() ?? null,
        lastError: connection.lastError,
        canSource: connection.canSource,
        canDestination: connection.canDestination,
        authType: connection.authType,
        profileUrl:
          typeof metadata.profileUrl === "string" ? metadata.profileUrl : null,
        hasCookies: Boolean(connection.cookieJar),
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="Connect your own accounts, manage developer credentials and keep tokens fresh."
        actions={
          <>
            <Link href="/workflows" className={buttonVariants({ variant: "outline" })}>
              Workflows
            </Link>
            <Badge variant="muted">{connections.length} connected</Badge>
          </>
        }
      />

      {connected ? (
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-xs text-[var(--success)]">
          <CheckCircle2 className="size-4" aria-hidden />
          Connected successfully. The connection is ready for workflows.
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{error}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            How credentials work
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
          <p>
            <span className="font-medium text-foreground">1. Create a developer app</span> for each
            platform you want to connect (link in each card).
          </p>
          <p>
            <span className="font-medium text-foreground">2. Paste credentials here</span> — they are
            encrypted with APP_SECRET and stored in PostgreSQL, or read from environment variables as
            a fallback.
          </p>
          <p>
            <span className="font-medium text-foreground">3. Connect the account</span> — tokens are
            refreshed automatically in the background and can be refreshed manually per card.
          </p>
        </CardContent>
      </Card>

      {GROUPS.map((group) => {
        const platforms = PLATFORMS.filter((platform) => group.categories.includes(platform.category));
        if (platforms.length === 0) return null;

        return (
          <section key={group.title} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{group.title}</h2>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {platforms.map((platform) => {
                const status = credentialStatus[platform.slug] ?? {
                  configured: false,
                  source: "missing" as const,
                };
                return (
                  <ConnectionCard
                    key={platform.slug}
                    platform={platform}
                    connection={byProvider.get(platform.provider) ?? null}
                    credentials={status}
                    redirectUri={`${appOrigin}${platform.callbackPath}`}
                    adapterImplemented={
                      isSourceImplemented(platform.provider) ||
                      isDestinationImplemented(platform.provider)
                    }
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
