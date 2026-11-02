import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import type { TResponse } from "@formbricks/types/responses";
import {
  SNOWFLAKE_LATE_WRITE_QUARANTINE_MS,
  SNOWFLAKE_STATEMENT_DEADLINE_MS,
  SnowflakeLateWriteError,
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

/**
 * The replace holds a database transaction (and its lock) open while it talks to Snowflake. No statement
 * starts after REPLACE_WRITE_BUDGET_MS, each ends or is abandoned within SNOWFLAKE_STATEMENT_DEADLINE_MS, and
 * an abandoned one may still run, so the lock is then held for the quarantine too. The three together stay
 * under the transaction timeout, so the lock never goes while a write of this replace can still land.
 */
const REPLACE_WRITE_BUDGET_MS = 360_000;
const REPLACE_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 600_000 };
export const REPLACE_WORST_CASE_MS =
  REPLACE_WRITE_BUDGET_MS + SNOWFLAKE_STATEMENT_DEADLINE_MS + SNOWFLAKE_LATE_WRITE_QUARANTINE_MS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  let wroteRows = false;
  try {
    await runSerially(() =>
      prisma.$transaction(async (tx) => {
        const deadlineAt = Date.now() + REPLACE_WRITE_BUDGET_MS;
        // Held until the transaction ends. Another process replacing the same response waits here, so
        // two replaces never interleave DELETE, DELETE, INSERT, INSERT and leave duplicate rows.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${response.id}))`;
        const exists = async () =>
          Boolean(await tx.response.findUnique({ where: { id: response.id }, select: { id: true } }));

        if (!(await exists())) return;
        wroteRows = true;
        try {
          await deleteSurveyResponseRows([response.id], deadlineAt);
          await insertSurveyResponseRows(buildSnowflakeRows(survey, response), deadlineAt);
          if (!(await exists())) {
            await deleteSurveyResponseRows([response.id], deadlineAt);
          }
        } catch (error) {
          // The abandoned statement may still be delivered and run. Keep the lock until it cannot, so no
          // other replace is interleaved with it; the cleanup below then runs after it has settled.
          if (error instanceof SnowflakeLateWriteError) await sleep(SNOWFLAKE_LATE_WRITE_QUARANTINE_MS);
          throw error;
        }
      }, REPLACE_TRANSACTION_OPTIONS)
    );
  } catch (error) {
    logger.error(
      { err: error, surveyId: survey.id, responseId: response.id },
      "Snowflake response sync failed"
    );
  }
  if (wroteRows) await removeRowsIfResponseGone(response.id);
};

/**
 * Runs outside the replace transaction, so it still works when that transaction failed or expired. If the
 * response is gone locally, its warehouse rows go too. Never throws.
 */
const removeRowsIfResponseGone = async (responseId: string): Promise<void> => {
  try {
    const stillThere = await prisma.response.findUnique({ where: { id: responseId }, select: { id: true } });
    if (!stillThere) await runSerially(() => deleteSurveyResponseRows([responseId]));
  } catch (error) {
    logger.error({ err: error, responseId }, "Snowflake post-sync cleanup failed");
  }
};

/**
 * Removes deleted responses from Snowflake. Call it after the local delete committed. It does not look at
 * the survey's sync flag: rows written while the flag was on must go even if it was turned off since.
 * Never throws.
 */
export const deleteResponsesFromSnowflake = async (responses: { id: string }[]): Promise<boolean> => {
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
