import Link from "next/link";

import { Database, ServerCog, Terminal } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";

export function SetupRequired({ reason }: { reason?: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Repurpose Studio is not connected yet</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {reason ?? "The dashboard needs PostgreSQL and Redis. Start the stack and this page turns into your content queue."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" aria-hidden />
            Start everything with Docker Compose
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <pre className="overflow-x-auto rounded-xl border border-border bg-background/70 p-3 font-mono text-xs leading-relaxed">
{`cp .env.example .env
# set APP_SECRET (openssl rand -hex 32)
docker compose up -d --build`}
          </pre>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Compose starts Postgres, Redis, the one-shot migration, the Next.js app and the 24/7 worker.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-primary" aria-hidden />
            Current configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <p>DATABASE_URL: {process.env.DATABASE_URL ? "set" : "missing"}</p>
          <p>REDIS_URL: {process.env.REDIS_URL ? "set" : "missing"}</p>
          <p>APP_SECRET: {env.APP_SECRET ? "set" : "missing"}</p>
          <p>MEDIA_ROOT: {env.MEDIA_ROOT}</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href="/api/health" className={buttonVariants({ variant: "outline" })}>
          <ServerCog className="size-4" aria-hidden />
          Open health report
        </Link>
        <Button variant="ghost" disabled>
          Waiting for the database
        </Button>
      </div>
    </div>
  );
}
