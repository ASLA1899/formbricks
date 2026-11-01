import "server-only";
import { prisma } from "@formbricks/database";

/**
 * ASLA fork (ASL-1880): per-person survey shares. SpiceDB's schema has no per-user survey relation, so
 * `SurveyAccess` rows widen `can()` for these read actions only, and only once the evaluator has already
 * denied. They never replace the graph's answer and never grant write, export, delete or visibility.
 */
export const SURVEY_SHARE_GRANTED_ACTIONS: ReadonlySet<string> = new Set([
  "survey.read",
  "survey.response_read",
]);

/** The workspace of a survey shared with `userId`, or `null` when no share exists. */
export const getSurveyShareWorkspaceId = async (userId: string, surveyId: string): Promise<string | null> => {
  const share = await prisma.surveyAccess.findUnique({
    where: { surveyId_userId: { surveyId, userId } },
    select: { survey: { select: { workspaceId: true } } },
  });
  return share?.survey.workspaceId ?? null;
};
