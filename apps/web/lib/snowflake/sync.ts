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
 * Sends one finished response to Snowflake. Replaces the response's rows, so a retried pipeline job
 * cannot duplicate them. Never throws: a warehouse outage must not fail the response pipeline.
 */
export const syncResponseToSnowflake = async (
  survey: TSnowflakeSurvey,
  response: Parameters<typeof buildSnowflakeRows>[1]
): Promise<void> => {
  if (!isSnowflakeConfigured()) return;
  try {
    await deleteSurveyResponseRows([response.id]);
    await insertSurveyResponseRows(buildSnowflakeRows(survey, response));
  } catch (error) {
    logger.error(
      { err: error, surveyId: survey.id, responseId: response.id },
      "Snowflake response sync failed"
    );
  }
};

/**
 * Removes deleted responses from Snowflake, but only for surveys that have the sync on. Call it after
 * the local delete committed. Never throws.
 */
export const deleteResponsesFromSnowflake = async (
  responses: { id: string; surveyId: string }[]
): Promise<void> => {
  if (responses.length === 0 || !isSnowflakeConfigured()) return;
  try {
    const surveyIds = [...new Set(responses.map((response) => response.surveyId))];
    const syncing = await prisma.survey.findMany({
      where: { id: { in: surveyIds }, snowflakeSync: true },
      select: { id: true },
    });
    const syncingIds = new Set(syncing.map((survey) => survey.id));
    const ids = responses
      .filter((response) => syncingIds.has(response.surveyId))
      .map((response) => response.id);
    await deleteSurveyResponseRows(ids);
  } catch (error) {
    logger.error({ err: error, responseCount: responses.length }, "Snowflake response cleanup failed");
  }
};

export const deleteResponseFromSnowflake = (response: Pick<TResponse, "id" | "surveyId">): Promise<void> =>
  deleteResponsesFromSnowflake([response]);

/**
 * Survey reset. Runs BEFORE the local delete so a response that arrives in between is never wiped from
 * Snowflake while it still exists locally. Returns whether the cleanup ran; a failure is logged and the
 * reset goes on.
 */
export const deleteSurveyFromSnowflake = async (surveyId: string): Promise<boolean> => {
  if (!isSnowflakeConfigured()) return false;
  try {
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      select: { snowflakeSync: true },
    });
    if (!survey?.snowflakeSync) return false;
    await deleteSurveyRows(surveyId);
    return true;
  } catch (error) {
    logger.error({ err: error, surveyId }, "Snowflake cleanup failed during survey reset");
    return false;
  }
};
