/**
 * Idempotent seed: creates the default settings rows the app reads at boot.
 * There is no user/account seeding — this deployment has exactly one owner.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULTS: Array<{ key: string; value: Prisma.InputJsonValue; description: string }> = [
  {
    key: "scheduler.defaults",
    value: { timezone: "UTC", maxPerDay: 2, times: ["11:00", "18:00"] },
    description: "Default drip settings applied to new workflows.",
  },
  {
    key: "pipeline.defaults",
    value: {
      pollIntervalMinutes: 15,
      maxAttempts: 3,
      retentionHours: 24,
      workerConcurrency: 2,
    },
    description: "Detector/processor defaults.",
  },
];

async function main() {
  for (const row of DEFAULTS) {
    await prisma.appConfig.upsert({
      where: { key: row.key },
      update: {},
      create: row,
    });
  }
  console.log(`[seed] ensured ${DEFAULTS.length} default settings rows`);
}

main()
  .catch((error) => {
    console.error("[seed] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
