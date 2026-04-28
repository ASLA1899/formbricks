import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { runContactSync } from "./sync";

export interface DueSyncSummary {
  syncId: string;
  environmentId: string;
  status: "succeeded" | "failed";
  rowsProcessed?: number;
  rowsCreated?: number;
  rowsUpdated?: number;
  rowsDeactivated?: number;
  errorMessage?: string;
}

// Called from the cron endpoint. Scans for enabled syncs whose interval has
// elapsed and runs them. Per-sync errors are caught and logged so one sync
// failing doesn't prevent the others from running.
//
// Schedule logic: a sync is due if it's enabled AND
//   - it has never run (lastRunAt is null), OR
//   - now() - lastRunAt >= intervalMinutes minutes.
//
// We do the filter in-memory rather than via SQL because intervalMinutes is
// per-row (different syncs can have different cadences). At v1 scale (single-
// digit ContactSync rows per deployment), this is trivially fast.
export async function runDueSyncs(): Promise<DueSyncSummary[]> {
  const now = new Date();
  const candidates = await prisma.contactSync.findMany({
    where: { enabled: true },
    select: {
      id: true,
      environmentId: true,
      intervalMinutes: true,
      lastRunAt: true,
    },
  });

  const due = candidates.filter((c) => {
    if (!c.lastRunAt) return true;
    const elapsedMs = now.getTime() - c.lastRunAt.getTime();
    return elapsedMs >= c.intervalMinutes * 60 * 1000;
  });

  const results: DueSyncSummary[] = [];

  for (const sync of due) {
    try {
      const summary = await runContactSync(sync.id);
      results.push({
        syncId: sync.id,
        environmentId: sync.environmentId,
        status: "succeeded",
        ...summary,
      });
    } catch (error) {
      logger.error({ syncId: sync.id, error }, "ContactSync run failed in cron loop");
      results.push({
        syncId: sync.id,
        environmentId: sync.environmentId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
