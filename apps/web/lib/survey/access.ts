import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@formbricks/database";

export type SurveyAccessSurvey = {
  id: string;
  visibility: "private" | "public";
  createdBy: string | null;
  surveyAccess: { userId: string }[];
};

export type SurveyAccessMembership = { userId: string; surveyAdmin: boolean } | null;

export const getSurveyAccessMembership = async (
  userId: string,
  organizationId: string
): Promise<SurveyAccessMembership> => {
  const row = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { userId: true, surveyAdmin: true },
  });
  return row;
};

export const canAccessSurvey = ({
  userId,
  survey,
  membership,
}: {
  userId: string;
  survey: SurveyAccessSurvey;
  membership: SurveyAccessMembership;
}): boolean => {
  if (!membership) return false;
  if (membership.surveyAdmin) return true;
  if (survey.visibility === "public") return true;
  if (survey.createdBy === userId) return true;
  return survey.surveyAccess.some((row) => row.userId === userId);
};

export const getSurveyAccessWhere = ({
  userId,
  membership,
}: {
  userId: string;
  membership: SurveyAccessMembership;
}): Prisma.SurveyWhereInput => {
  if (!membership) {
    return { id: "__no_access__" };
  }
  if (membership.surveyAdmin) {
    return {};
  }
  return {
    OR: [{ visibility: "public" }, { createdBy: userId }, { surveyAccess: { some: { userId } } }],
  };
};
