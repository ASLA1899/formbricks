"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@formbricks/database";
import { ZId } from "@formbricks/types/common";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { ZColumnMappingConfig, parseColumnMappingConfig } from "@/modules/contacts/lib/column-mapping";
import { runContactSync } from "@/modules/contacts/lib/sync";

// ---------------------------------------------------------------------------
// saveSyncConfigAction — upserts the single ContactSync row per environment.
//
// Audit logging is intentionally omitted: this is an environment-admin
// operation, not a destructive customer-data action. Phase 1b can wrap with
// withAuditLogging if compliance requires it.
// ---------------------------------------------------------------------------
const ZSaveSyncConfig = z.object({
  environmentId: ZId,
  snowflakeQueryId: z.string().min(1),
  columnMapping: ZColumnMappingConfig,
  intervalMinutes: z.number().int().min(5).max(1440),
  enabled: z.boolean(),
});

export const saveSyncConfigAction = authenticatedActionClient
  .schema(ZSaveSyncConfig)
  .action(async ({ parsedInput }) => {
    // Defense-in-depth: even though the zod schema already validated, we
    // re-parse via the canonical parser. If a future caller skips schema
    // validation, parseColumnMappingConfig still catches a malformed JSON
    // before it lands in the DB and silently misroutes data on the next sync.
    const validated = parseColumnMappingConfig(parsedInput.columnMapping);

    const existing = await prisma.contactSync.findUnique({
      where: { environmentId: parsedInput.environmentId },
      select: { id: true },
    });

    if (existing) {
      await prisma.contactSync.update({
        where: { id: existing.id },
        data: {
          snowflakeQueryId: parsedInput.snowflakeQueryId,
          columnMapping: validated,
          intervalMinutes: parsedInput.intervalMinutes,
          enabled: parsedInput.enabled,
        },
      });
    } else {
      await prisma.contactSync.create({
        data: {
          environmentId: parsedInput.environmentId,
          snowflakeQueryId: parsedInput.snowflakeQueryId,
          columnMapping: validated,
          intervalMinutes: parsedInput.intervalMinutes,
          enabled: parsedInput.enabled,
        },
      });
    }

    revalidatePath(`/environments/${parsedInput.environmentId}/settings/snowflake-sync`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// runSyncNowAction — invokes runContactSync synchronously. Returns the
// SyncRunResult so the form can flash the counts to the operator.
// ---------------------------------------------------------------------------
const ZRunSyncNow = z.object({ environmentId: ZId });

export const runSyncNowAction = authenticatedActionClient
  .schema(ZRunSyncNow)
  .action(async ({ parsedInput }) => {
    const sync = await prisma.contactSync.findUnique({
      where: { environmentId: parsedInput.environmentId },
      select: { id: true },
    });
    if (!sync) {
      throw new Error("No sync configured for this environment");
    }
    const summary = await runContactSync(sync.id);
    revalidatePath(`/environments/${parsedInput.environmentId}/settings/snowflake-sync`);
    return summary;
  });

// ---------------------------------------------------------------------------
// previewSnowflakeQueryAction — runs the configured query and returns the
// first 5 rows + headers + total count.
//
// NB: executeConfiguredQueryAllRows fetches the full result set. For huge
// queries this is wasteful — preview only needs ~5 rows. Phase 1b can add a
// LIMIT-injecting variant; for now the configured queries already cap at a
// few thousand rows by design (member rosters), so the cost is acceptable.
// ---------------------------------------------------------------------------
const ZPreviewQuery = z.object({ snowflakeQueryId: z.string().min(1) });

export const previewSnowflakeQueryAction = authenticatedActionClient
  .schema(ZPreviewQuery)
  .action(async ({ parsedInput }) => {
    const rows = await executeConfiguredQueryAllRows(parsedInput.snowflakeQueryId);
    const sample = rows.slice(0, 5);
    const headers = sample.length > 0 ? Object.keys(sample[0]) : [];
    return { headers, sample, totalRows: rows.length };
  });
