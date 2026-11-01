import "server-only";
import { prisma } from "@formbricks/database";
import { InvalidInputError } from "@formbricks/types/errors";

/** Accepted, non-billing members of the survey's organization: the people a survey can be shared with. */
const shareableMembershipWhere = (organizationId: string) =>
  ({ accepted: true, organizationId, role: { not: "billing" } }) as const;

export const listSurveyAccess = async (surveyId: string) =>
  prisma.surveyAccess.findMany({
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, id: true, name: true } } },
    where: { surveyId },
  });

export const listShareableMembers = async (organizationId: string) =>
  prisma.membership.findMany({
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { email: true, id: true, name: true } } },
    where: shareableMembershipWhere(organizationId),
  });

/** Every grantee must belong to the survey's organization: a foreign id is refused, never stored. */
export const addSurveyAccess = async (surveyId: string, organizationId: string, userIds: string[]) => {
  const unique = [...new Set(userIds)];
  const members = await prisma.membership.count({
    where: { ...shareableMembershipWhere(organizationId), userId: { in: unique } },
  });
  if (members !== unique.length) {
    throw new InvalidInputError("Surveys can only be shared with members of the organization.");
  }
  await prisma.surveyAccess.createMany({
    data: unique.map((userId) => ({ surveyId, userId })),
    skipDuplicates: true,
  });
};

export const removeSurveyAccess = async (surveyId: string, userId: string) => {
  await prisma.surveyAccess.deleteMany({ where: { surveyId, userId } });
};
