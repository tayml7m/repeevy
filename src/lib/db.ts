import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client reused across hot reloads (dev) and route handlers.
 * Next.js bundles this module per server entrypoint, so the global guard keeps
 * the connection pool from growing during development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
