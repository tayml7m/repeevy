"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Activity,
  CalendarClock,
  LayoutDashboard,
  ListVideo,
  Plug,
  ScrollText,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Queue", icon: ListVideo },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/logs", label: "Logs", icon: ScrollText },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-border bg-card/40 lg:flex lg:h-dvh lg:flex-col lg:sticky lg:top-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Activity className="size-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">Repurpose Studio</p>
            <p className="truncate text-[11px] text-muted-foreground">Private · no accounts</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-5 py-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Opening this URL is all the access control there is. Keep it behind your VPN or proxy.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
                <Activity className="size-4 text-primary" aria-hidden />
              </span>
              <span className="text-sm font-semibold tracking-tight">Repurpose Studio</span>
            </Link>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Private
            </span>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Main"
          >
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
