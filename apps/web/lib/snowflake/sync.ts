import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import type { TResponse } from "@formbricks/types/responses";
import { isSurveyOutboundAllowed, surveyOutboundVisibilitySelect } from "@/lib/survey/visibility/outbound";
import { deleteSurveyResponseRows, isSnowflakeConfigured, upsertSurveyResponseRows } from "./client";
import { type TSnowflakeSurvey, buildSnowflakeRows } from "./response-rows";

/**
 * Snowflake writes from one process run one at a time, in call order, over its single connection. A failed
 * task does not stop the queue. Order across processes is not needed: every write is safe to repeat or to
 * run late (MERGE by response and question; delete by response), and the reconcile below settles the rest.
 */
let queueTail: Promise<unknown> = Promise.resolve();
const runSerially = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => undefined);
  return result;
};

/**
 * How long after a write or delete the reconcile runs. The driver can deliver a retried statement long after
 * its client deadline, so a late write may land after the first cleanup; the second pass removes it. The
 * timer lives in this process only. A restart in the window loses it, so a periodic reconcile job is the
 * backstop (tracked as a follow-up).
 */
export const RECONCILE_DELAY_MS = 10 * 60_000;

/**
 * Settles the warehouse to the local state of every given response. Never throws.
 * - A response that no longer exists locally has its rows deleted.
 * - A finished response of a survey that still syncs is written again from its current local data. This
 *   repairs a stale snapshot the driver delivered late (an old write that overwrote newer answers, or an
 *   old prune that removed newer rows). Writes are MERGEs, so repeating them is safe.
 * Returns whether the lookup and any write succeeded.
 */
export const reconcileResponses = async (responseIds: string[]): Promise<boolean> => {
  if (responseIds.length === 0 || !isSnowflakeConfigured()) return false;
  try {
    const existing = await prisma.response.findMany({
      where: { id: { in: responseIds } },
      select: {
        id: true,
        createdAt: true,
        finished: true,
        language: true,
        meta: true,
        data: true,
        contactAttributes: true,
        survey: {
          select: {
            id: true,
            name: true,
            blocks: true,
            hiddenFields: true,
            snowflakeSync: true,
            ...surveyOutboundVisibilitySelect,
          },
        },
      },
    });
    const present = new Set(existing.map((response) => response.id));
    const gone = responseIds.filter((id) => !present.has(id));
    if (gone.length > 0) await runSerially(() => deleteSurveyResponseRows(gone));
    for (const { survey, ...response } of existing) {
      // Same outbound rule as the pipeline: a restricted survey is never written to the warehouse.
      if (!survey.snowflakeSync || !response.finished || !isSurveyOutboundAllowed(survey)) continue;
      const current = response as Parameters<typeof buildSnowflakeRows>[1];
      await runSerially(() =>
        upsertSurveyResponseRows(response.id, buildSnowflakeRows(survey as TSnowflakeSurvey, current))
      );
    }
    return true;
  } catch (error) {
    logger.error({ err: error, responseCount: responseIds.length }, "Snowflake reconcile failed");
    return false;
  }
};

const scheduleReconcile = (responseIds: string[]) => {
  const timer = setTimeout(() => void reconcileResponses(responseIds), RECONCILE_DELAY_MS);
  timer.unref?.();
};

/**
 * Sends one finished response to Snowflake. The write is a MERGE, so a retried pipeline job, or a statement
 * the driver delivers twice or late, leaves the same rows. Never throws: a warehouse outage must not fail
 * the response pipeline.
 *
 * The queued job carries a snapshot, so the response may have been deleted (or its survey reset) since.
 * The sync checks that the response still exists before writing; after writing it reconciles at once and
 * again after RECONCILE_DELAY_MS, which removes the rows if the response is gone by then.
 */
export const syncResponseToSnowflake = async (
  survey: TSnowflakeSurvey,
  response: Parameters<typeof buildSnowflakeRows>[1]
): Promise<void> => {
  if (!isSnowflakeConfigured()) return;
  let attempted = false;
  try {
    const exists = await prisma.response.findUnique({ where: { id: response.id }, select: { id: true } });
    if (!exists) return;
    attempted = true;
    await runSerially(() => upsertSurveyResponseRows(response.id, buildSnowflakeRows(survey, response)));
  } catch (error) {
    logger.error(
      { err: error, surveyId: survey.id, responseId: response.id },
      "Snowflake response sync failed"
    );
  }
  // After a failure too: the failed statement may still have run.
  if (attempted) {
    await reconcileResponses([response.id]);
    scheduleReconcile([response.id]);
  }
};

/**
 * Removes deleted responses from Snowflake. Call it after the local delete committed. It does not look at
 * the survey's sync flag: rows written while the flag was on must go even if it was turned off since. A
 * second pass runs later to remove rows a delayed write added after this one. Never throws.
 */
export const deleteResponsesFromSnowflake = async (responses: { id: string }[]): Promise<boolean> => {
  const ids = responses.map((response) => response.id);
  if (ids.length === 0 || !isSnowflakeConfigured()) return false;
  try {
    await runSerially(() => deleteSurveyResponseRows(ids));
    scheduleReconcile(ids);
    return true;
  } catch (error) {
    logger.error({ err: error, responseCount: ids.length }, "Snowflake response cleanup failed");
    scheduleReconcile(ids);
    return false;
  }
};

export const deleteResponseFromSnowflake = async (response: Pick<TResponse, "id">): Promise<void> => {
  await deleteResponsesFromSnowflake([response]);
};
