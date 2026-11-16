import { NextResponse } from "next/server";

import { getHealthReport } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Docker/compose health probe. 200 ok, 503 degraded. */
export async function GET() {
  const report = await getHealthReport();
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
