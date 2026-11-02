import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import type { TResponse } from "@formbricks/types/responses";
import {
  deleteSurveyResponseRows,
  insertSurveyResponseRows,
  isSnowflakeConfigured,
} from "./client";
import { type TSnowflakeSurvey, buildSnowflakeRows } from "./response-rows";

/**
 * Snowflake writes from one process run one at a time, in call order, over its single connection. A failed
 * task does not stop the queue. The queue cannot see other processes: web replicas and rolling deploys
 * each run their own jobs. A per-response Postgres advisory lock (see syncResponseToSnowflake) orders the
 * replace of one response across all of them.
 */
let queueTail: Promise<unknown> = Promise.resolve();
const runSerially = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => undefined);
  return result;
};

/** The replace holds a database transaction open while it talks to Snowflake, so the budget covers that. */
const REPLACE_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 120_000 };

/**
 * Sends one finished response to Snowflake. Replaces the response's rows, so a retried pipeline job
 * cannot duplicate them. Never throws: a warehouse outage must not fail the response pipeline.
 *
 * The queued job carries a snapshot, so the response may have been deleted (or its survey reset) since.
 * The sync checks that the response still exists before writing and again after, and removes its rows if
 * it was deleted in between. A delete that commits later runs its own cleanup after this write.
 */
export const syncResponseToSnowflake = async (
  survey: TSnowflakeSurvey,
  response: Parameters<typeof buildSnowflakeRows>[1]
): Promise<void> => {
  if (!isSnowflakeConfigured()) return;
  try {
    await runSerially(() =>
      prisma.$transaction(async (tx) => {
        // Held until the transaction ends. Another process replacing the same response waits here, so
        // two replaces never interleave DELETE, DELETE, INSERT, INSERT and leave duplicate rows.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${response.id}))`;
        const exists = async () =>
          Boolean(await tx.response.findUnique({ where: { id: response.id }, select: { id: true } }));

        if (!(await exists())) return;
        await deleteSurveyResponseRows([response.id]);
        await insertSurveyResponseRows(buildSnowflakeRows(survey, response));
        if (!(await exists())) {
          await deleteSurveyResponseRows([response.id]);
        }
      }, REPLACE_TRANSACTION_OPTIONS)
    );
  } catch (error) {
    logger.error(
      { err: error, surveyId: survey.id, responseId: response.id },
      "Snowflake response sync failed"
    );
  }
};

/**
 * Removes deleted responses from Snowflake. Call it after the local delete committed. It does not look at
 * the survey's sync flag: rows written while the flag was on must go even if it was turned off since.
 * Never throws.
 */
export const deleteResponsesFromSnowflake = async (
  responses: { id: string }[]
): Promise<boolean> => {
  const ids = responses.map((response) => response.id);
  if (ids.length === 0 || !isSnowflakeConfigured()) return false;
  try {
    await runSerially(() => deleteSurveyResponseRows(ids));
    return true;
  } catch (error) {
    logger.error({ err: error, responseCount: ids.length }, "Snowflake response cleanup failed");
    return false;
  }
};

export const deleteResponseFromSnowflake = async (response: Pick<TResponse, "id">): Promise<void> => {
  await deleteResponsesFromSnowflake([response]);
};
