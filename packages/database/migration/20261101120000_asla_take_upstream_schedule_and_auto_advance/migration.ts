import { logger } from "@formbricks/logger";
import type { MigrationScript } from "../../src/scripts/migration-runner";
import { FALLBACK_SCHEDULE_TIME_ZONE, type ForkScheduleRow, planScheduleUpdate } from "./utils";

/**
 * ASLA fork, upgrade group 15: take upstream's scheduling and auto-advance over the fork's.
 *
 * - `runOnDate` / `closeOnDate` / `scheduleTimezone` -> `publishOn` / `closeOn` (a day, stored as noon
 *   UTC, read in the survey's own zone). A draft with a pending run date becomes `paused` + `publishOn`,
 *   which is the state upstream's reconciler publishes from.
 * - `autoAdvance` -> `isAutoProgressingEnabled`.
 *
 * The fork columns are left in place (data kept for rollback; a later cleanup drops them). Both steps
 * are skipped when the fork columns do not exist (fresh database) and are idempotent: they only fill
 * empty targets. Logs every future close date and every non-default zone for the cutover check.
 */
export const takeUpstreamScheduleAndAutoAdvance: MigrationScript = {
  type: "data",
  id: "lq8w2k5ntd0yv7bhx3r9c4ge",
  name: "20261101120000_asla_take_upstream_schedule_and_auto_advance",
  run: async ({ tx }) => {
    const columns = await tx.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Survey'
        AND column_name IN ('runOnDate', 'closeOnDate', 'scheduleTimezone', 'autoAdvance')
    `;
    const present = new Set(columns.map((column) => column.column_name));

    if (present.has("autoAdvance")) {
      const updated = await tx.$executeRaw`
        UPDATE "Survey" SET "isAutoProgressingEnabled" = true
        WHERE "autoAdvance" = true AND "isAutoProgressingEnabled" = false
      `;
      logger.info(`Schedule/auto-advance port: ${updated.toString()} surveys got isAutoProgressingEnabled`);
    }

    if (!present.has("runOnDate") || !present.has("closeOnDate") || !present.has("scheduleTimezone")) {
      logger.info("Schedule/auto-advance port: fork schedule columns absent, nothing to copy");
      return;
    }

    const defaultTimeZone = FALLBACK_SCHEDULE_TIME_ZONE;
    const now = new Date();

    const rows = await tx.$queryRaw<ForkScheduleRow[]>`
      SELECT id, status::text AS status, "runOnDate", "closeOnDate", "scheduleTimezone", "publishOn", "closeOn"
      FROM "Survey"
      WHERE "runOnDate" IS NOT NULL OR "closeOnDate" IS NOT NULL
    `;

    const nonDefaultZones: string[] = [];
    const futureCloseDates: string[] = [];
    let published = 0;
    let closed = 0;
    let paused = 0;

    for (const row of rows) {
      if (row.scheduleTimezone !== null && row.scheduleTimezone !== defaultTimeZone) {
        nonDefaultZones.push(`${row.id}=${row.scheduleTimezone}`);
      }
      if (row.closeOnDate !== null && row.closeOnDate.getTime() > now.getTime()) {
        futureCloseDates.push(`${row.id}=${row.closeOnDate.toISOString()}`);
      }

      const update = planScheduleUpdate(row, now, defaultTimeZone);
      if (!update) continue;
      if (update.timeZoneFallback) {
        logger.warn(
          `Survey ${row.id}: invalid scheduleTimezone "${row.scheduleTimezone}", used ${defaultTimeZone}`
        );
      }

      await tx.$executeRaw`
        UPDATE "Survey" SET
          "publishOn" = COALESCE(${update.publishOn}::timestamp, "publishOn"),
          "closeOn" = COALESCE(${update.closeOn}::timestamp, "closeOn"),
          "status" = CASE WHEN ${update.pause}::boolean THEN 'paused'::"SurveyStatus" ELSE "status" END
        WHERE id = ${update.id}
      `;
      if (update.publishOn) published += 1;
      if (update.closeOn) closed += 1;
      if (update.pause) paused += 1;
    }

    logger.info(
      `Schedule port: ${published.toString()} publishOn, ${closed.toString()} closeOn, ${paused.toString()} draft->paused`
    );
    logger.info(
      `Schedule port: surveys with a future close date (check at cutover): ${futureCloseDates.join(", ") || "none"}`
    );
    logger.info(
      `Schedule port: surveys with a non-default scheduleTimezone: ${nonDefaultZones.join(", ") || "none"}`
    );
  },
};
