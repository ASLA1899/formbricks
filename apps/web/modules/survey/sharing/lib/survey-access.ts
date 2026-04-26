import "server-only";
import { prisma } from "@formbricks/database";

export const setSurveyVisibility = async (surveyId: string, visibility: "private" | "public") => {
  return prisma.survey.update({
    where: { id: surveyId },
    data: { visibility },
    select: { id: true, visibility: true },
  });
};

export const addSurveyAccess = async (surveyId: string, userIds: string[]) => {
  if (userIds.length === 0) return;
  await prisma.surveyAccess.createMany({
    data: userIds.map((userId) => ({ surveyId, userId })),
    skipDuplicates: true,
  });
};

export const removeSurveyAccess = async (surveyId: string, userId: string) => {
  await prisma.surveyAccess.delete({
    where: { surveyId_userId: { surveyId, userId } },
  });
};

export const listSurveyAccess = async (surveyId: string) => {
  return prisma.surveyAccess.findMany({
    where: { surveyId },
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const listOrgMembers = async (organizationId: string) => {
  return prisma.membership.findMany({
    where: { organizationId, accepted: true },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
};
