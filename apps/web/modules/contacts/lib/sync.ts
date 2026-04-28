import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import { parseColumnMappingConfig, type ColumnMappingConfig } from "./column-mapping";

export interface SyncRunResult {
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsDeactivated: number;
}

// Runs one Contact sync: fetches all rows from the configured Snowflake query,
// upserts matching Contacts, and deactivates Snowflake-source contacts that
// dropped out of the result set. Manual-source contacts are never touched.
//
// Idempotent and crash-safe: every run is a full upsert. Concurrent runs of
// the same sync are not expected (single cron caller per sync) but would not
// corrupt state — they'd just compete on the same rows.
export async function runContactSync(syncId: string): Promise<SyncRunResult> {
  const sync = await prisma.contactSync.findUnique({ where: { id: syncId } });
  if (!sync) throw new Error(`ContactSync not found: ${syncId}`);

  // TODO(phase 2): a "running" run that crashes mid-loop never gets finishedAt
  // set. Add a sweeper that marks long-running runs (status='running' and
  // startedAt older than e.g. 30 minutes) as failed with a "stale run" message.
  const run = await prisma.contactSyncRun.create({
    data: { syncId, status: "running" },
    select: { id: true },
  });

  const summary: SyncRunResult = {
    rowsProcessed: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsDeactivated: 0,
  };

  try {
    // Parse the persisted JSON mapping defensively. A typo in `kind`, a stale
    // attributeKeyId, or a non-string key would silently misroute data
    // otherwise — and silent misroutes are irreversible without a re-run from
    // a corrected mapping.
    const mapping = parseColumnMappingConfig(sync.columnMapping);
    const rows = await executeConfiguredQueryAllRows(sync.snowflakeQueryId);
    const seenExternalIds: string[] = [];

    for (const row of rows) {
      summary.rowsProcessed++;
      const extracted = extractFromRow(row, mapping);
      if (!extracted.email && !extracted.externalId) {
        // No identifying field — skip (would create dangling Contact otherwise).
        continue;
      }
      if (extracted.externalId) seenExternalIds.push(extracted.externalId);
      const result = await upsertContact(sync.environmentId, extracted);
      if (result === "created") summary.rowsCreated++;
      else if (result === "updated") summary.rowsUpdated++;
      // "skipped" means manual contact — no counter increment.
    }

    // Deactivate snowflake-source contacts that aren't in this result set.
    // Only acts on currently-active rows; idempotent on repeated runs.
    const deactivated = await prisma.contact.updateMany({
      where: {
        environmentId: sync.environmentId,
        source: "snowflake",
        externalId: { notIn: seenExternalIds },
        inactive: false,
      },
      data: { inactive: true, inactiveAt: new Date() },
    });
    summary.rowsDeactivated = deactivated.count;

    await prisma.contactSyncRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        ...summary,
      },
    });

    await prisma.contactSync.update({
      where: { id: syncId },
      data: { lastRunAt: new Date(), lastRunStatus: "succeeded" },
    });

    return summary;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    // Truncate to keep ContactSyncRun rows compact — a 100KB stack trace bloats
    // the run history without adding diagnostic value beyond the first frame.
    // Full error is preserved in the structured log below.
    const message = rawMessage.slice(0, 2000);
    logger.error({ syncId, error }, "Contact sync failed");

    await prisma.contactSyncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message,
        ...summary, // preserve partial counts up to the error
      },
    });
    await prisma.contactSync.update({
      where: { id: syncId },
      data: { lastRunAt: new Date(), lastRunStatus: "failed" },
    });

    throw error;
  }
}

// Project a Snowflake row through the column mapping to typed fields + attribute
// assignments. Keys in mapping are the SOURCE headers (Snowflake column names).
//
// Assumes mapped columns are SQL string types. DATE / TIMESTAMP / BIGINT
// columns would coerce to locale-formatted strings via String() — operators
// who need to ingest those types should add a transform layer in the
// Snowflake query itself (e.g. TO_CHAR(date_col, 'YYYY-MM-DD')).
type ExtractedRow = {
  email: string | null;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  attributeAssignments: { attributeKeyId: string; value: string }[];
};

function extractFromRow(row: Record<string, unknown>, mapping: ColumnMappingConfig): ExtractedRow {
  const out: ExtractedRow = {
    email: null,
    externalId: null,
    firstName: null,
    lastName: null,
    attributeAssignments: [],
  };

  for (const [sourceHeader, dest] of Object.entries(mapping)) {
    if (dest.kind === "skip") continue;
    const raw = row[sourceHeader];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;

    if (dest.kind === "typed") {
      if (dest.column === "email") out.email = value.toLowerCase();
      else if (dest.column === "externalId") out.externalId = value;
      else if (dest.column === "firstName") out.firstName = value;
      else if (dest.column === "lastName") out.lastName = value;
    } else {
      out.attributeAssignments.push({ attributeKeyId: dest.attributeKeyId, value });
    }
  }

  return out;
}

async function upsertContact(
  environmentId: string,
  extracted: ExtractedRow
): Promise<"created" | "updated" | "skipped"> {
  // Match priority: externalId first, then email.
  // Use findFirst (not findUnique) because the partial unique indexes live
  // only in raw SQL — Prisma can't express WHERE on indexes natively.
  let existing = extracted.externalId
    ? await prisma.contact.findFirst({
        where: { environmentId, externalId: extracted.externalId },
        select: { id: true, source: true, inactive: true },
      })
    : null;

  if (!existing && extracted.email) {
    existing = await prisma.contact.findFirst({
      where: { environmentId, email: extracted.email },
      select: { id: true, source: true, inactive: true },
    });
  }

  if (existing) {
    // Manual contacts are protected — sync never updates them.
    if (existing.source !== "snowflake") {
      return "skipped";
    }
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        email: extracted.email ?? undefined,
        externalId: extracted.externalId ?? undefined,
        inactive: false,
        inactiveAt: null,
      },
    });
    await applyAttributes(existing.id, extracted.attributeAssignments);
    return "updated";
  }

  const created = await prisma.contact.create({
    data: {
      environmentId,
      email: extracted.email,
      externalId: extracted.externalId,
      source: "snowflake",
    },
    select: { id: true },
  });
  await applyAttributes(created.id, extracted.attributeAssignments);
  return "created";
}

async function applyAttributes(
  contactId: string,
  assignments: { attributeKeyId: string; value: string }[]
): Promise<void> {
  for (const { attributeKeyId, value } of assignments) {
    await prisma.contactAttribute.upsert({
      where: { contactId_attributeKeyId: { contactId, attributeKeyId } },
      create: { contactId, attributeKeyId, value },
      update: { value },
    });
  }
}
