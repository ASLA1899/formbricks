import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import type { TResponse } from "@formbricks/types/responses";
import {
  deleteSurveyResponseRows,
  deleteSurveyRows,
  insertSurveyResponseRows,
  isSnowflakeConfigured,
} from "./client";
import { type TSnowflakeSurvey, buildSnowflakeRows } from "./response-rows";

/**
 * Every Snowflake write runs one at a time, in call order. A response's replace (DELETE then INSERT) can
 * therefore never interleave with another job's replace or with a cleanup. The sync runs inside the web
 * process, so a process-local queue is enough. A failed task does not stop the queue.
 */
let queueTail: Promise<unknown> = Promise.resolve();
const runSerially = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => undefined);
  return result;
};

const responseExists = async (responseId: string): Promise<boolean> =>
  Boolean(await prisma.response.findUnique({ where: { id: responseId }, select: { id: true } }));

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
    await runSerially(async () => {
      if (!(await responseExists(response.id))) return;
      await deleteSurveyResponseRows([response.id]);
      await insertSurveyResponseRows(buildSnowflakeRows(survey, response));
      if (!(await responseExists(response.id))) {
        await deleteSurveyResponseRows([response.id]);
      }
    });
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
  responses: { id: string; surveyId: string }[]
): Promise<void> => {
  if (responses.length === 0 || !isSnowflakeConfigured()) return;
  try {
    await runSerially(() => deleteSurveyResponseRows(responses.map((response) => response.id)));
  } catch (error) {
    logger.error({ err: error, responseCount: responses.length }, "Snowflake response cleanup failed");
  }
};

export const deleteResponseFromSnowflake = (response: Pick<TResponse, "id" | "surveyId">): Promise<void> =>
  deleteResponsesFromSnowflake([response]);

/**
 * Survey reset: removes every row of the survey, whatever its sync flag says now. The reset calls it
 * before and after the local delete, so a row written by a job in between is removed too. Returns whether
 * the cleanup ran; a failure is logged and the reset goes on.
 */
export const deleteSurveyFromSnowflake = async (surveyId: string): Promise<boolean> => {
  if (!isSnowflakeConfigured()) return false;
  try {
    await runSerially(() => deleteSurveyRows(surveyId));
    return true;
  } catch (error) {
    logger.error({ err: error, surveyId }, "Snowflake cleanup failed during survey reset");
    return false;
  }
};
