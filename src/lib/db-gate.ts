import { prisma } from "@/lib/db";

/**
 * Pages render a setup screen instead of crashing when the database isn't
 * reachable yet (fresh checkout before `docker compose up`).
 */
export async function databaseReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
