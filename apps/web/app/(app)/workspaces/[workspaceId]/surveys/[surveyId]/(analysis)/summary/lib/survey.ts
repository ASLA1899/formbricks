import "server-only";
import { prisma } from "@formbricks/database";
import { Prisma } from "@formbricks/database/prisma";
import { DatabaseError } from "@formbricks/types/errors";
import { convertFloatTo2Decimal } from "@/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/summary/lib/utils";
import {
  collectSurveyResponseFileUrls,
  deleteSurveyResponseFiles,
} from "@/modules/storage/lib/survey-response-files";

/**
 * Execution budget for a survey reset, which deletes every response (with its cascades) and display of
 * the survey in one batch, so its cost grows with the survey. Prisma's timeout cancels nothing on the
 * server — the statements run to completion either way — so a budget below that only turns a reset
 * that was about to commit into a rolled-back failure (ENG-3285). `maxWait` stays the client default.
 */
const SURVEY_RESET_TRANSACTION_TIMEOUT_MS = 120_000;

export const deleteResponsesAndDisplaysForSurvey = async (
  surveyId: string
): Promise<{ deletedResponsesCount: number; deletedDisplaysCount: number; deletedResponseIds: string[] }> => {
  try {
    // Read the file-upload answers while the responses still exist (see collectSurveyResponseFileUrls).
    const { fileUrls, workspaceId } = await collectSurveyResponseFileUrls(surveyId);

    // Delete all responses for this survey

    // RETURNING reports exactly the responses this statement removed, so the Snowflake cleanup never
    // touches a response submitted while the reset was still running.
    const [deletedResponses, deletedDisplaysCount] = await prisma.$transaction(
      [
        prisma.$queryRaw<{ id: string }[]>`DELETE FROM "Response" WHERE "surveyId" = ${surveyId} RETURNING "id"`,
        prisma.display.deleteMany({
          where: {
            surveyId: surveyId,
          },
        }),
      ],
      { timeout: SURVEY_RESET_TRANSACTION_TIMEOUT_MS }
    );

    // Runs after the rows are gone so a storage failure can never delete files whose responses
    // survived. It logs and swallows storage errors, so cleanup cannot turn a committed reset into a
    // failed one.
    await deleteSurveyResponseFiles(fileUrls, workspaceId, surveyId);

    return {
      deletedResponsesCount: deletedResponses.length,
      deletedDisplaysCount: deletedDisplaysCount.count,
      deletedResponseIds: deletedResponses.map((response) => response.id),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError(error.message);
    }

    throw error;
  }
};

export const getQuotasSummary = async (surveyId: string) => {
  try {
    const quotas = await prisma.surveyQuota.findMany({
      where: {
        surveyId: surveyId,
      },
      select: {
        _count: {
          select: {
            quotaLinks: {
              where: {
                status: "screenedIn",
              },
            },
          },
        },
        id: true,
        name: true,
        limit: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return quotas.map((quota) => {
      const { _count, ...rest } = quota;
      const count = _count.quotaLinks;

      return {
        ...rest,
        count,
        percentage: quota.limit > 0 ? convertFloatTo2Decimal((count / quota.limit) * 100) : 0,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError(error.message);
    }

    throw error;
  }
};
