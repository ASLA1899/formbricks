import "server-only";
import { prisma } from "@formbricks/database";
import type { Prisma } from "@formbricks/database/prisma";
import { lockSurveyVisibility, reconcileSurveyRelationships } from "@/lib/authzed/survey";
import { type TSurveyAccessMode, visibilityForAccessMode } from "@/lib/survey/visibility/access-mode-map";

type TModeChange = Readonly<{ changed: boolean; mode: TSurveyAccessMode }>;

/**
 * Store the mode and its visibility together under the per-survey lock the projector also takes. Raw SQL
 * so `updatedAt` is not bumped (visibility is not survey content) and the version is fenced exactly like
 * the v3 visibility endpoint: +1 on a real change, none on a no-op.
 */
const storeAccessMode = (surveyId: string, mode: TSurveyAccessMode, userId: string): Promise<TModeChange> =>
  prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockSurveyVisibility(tx, surveyId);
    const visibility = visibilityForAccessMode(mode);
    const changedRows = await tx.$executeRaw`
      UPDATE "Survey"
      SET "accessMode" = ${mode}::"SurveyAccessMode",
          "visibility" = ${visibility}::"SurveyVisibility",
          "visibilityVersion" = "visibilityVersion" + 1,
          "visibilityChangedAt" = NOW(),
          "visibilityChangedById" = ${userId}
      WHERE id = ${surveyId}
        AND ("accessMode" <> ${mode}::"SurveyAccessMode" OR "visibility" <> ${visibility}::"SurveyVisibility")
    `;
    return { changed: changedRows > 0, mode };
  });

const hasUnacknowledgedProjection = async (surveyId: string): Promise<boolean> => {
  const row = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: { visibilityVersion: true, visibilityProjectedVersion: true },
  });
  return row !== null && row.visibilityVersion !== row.visibilityProjectedVersion;
};

/**
 * Switch a survey between private and public. The caller has already authorized
 * `survey.change_visibility`. Projects to SpiceDB on the fast path; a failed projection is finished by the
 * outbox event the UPDATE enqueued, and a restriction is enforced by the row the moment it is stored.
 */
export const setSurveyAccessMode = async (
  surveyId: string,
  mode: TSurveyAccessMode,
  userId: string
): Promise<Readonly<{ id: string; accessMode: TSurveyAccessMode; projection: "projected" | "failed" }>> => {
  const { changed } = await storeAccessMode(surveyId, mode, userId);
  let projection: "projected" | "failed" = "projected";
  // A same-mode retry changes no row, but an earlier failed projection may still be unacknowledged:
  // reconcile whenever the stored version is ahead of the acknowledged one, not only on a real change.
  if (changed || (await hasUnacknowledgedProjection(surveyId))) {
    const result = await reconcileSurveyRelationships([surveyId]);
    projection = result.status === "failed" ? "failed" : "projected";
  }
  return { accessMode: mode, id: surveyId, projection };
};
