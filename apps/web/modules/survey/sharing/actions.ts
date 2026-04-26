"use server";

import { z } from "zod";
import { prisma } from "@formbricks/database";
import { OperationNotAllowedError, ResourceNotFoundError } from "@formbricks/types/errors";
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";
import { canAccessSurvey, getSurveyAccessMembership } from "@/lib/survey/access";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import {
  addSurveyAccess,
  listOrgMembers,
  listSurveyAccess,
  removeSurveyAccess,
  setSurveyVisibility,
} from "@/modules/survey/sharing/lib/survey-access";

const loadSurveyManageContext = async (surveyId: string, userId: string) => {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!survey) throw new ResourceNotFoundError("Survey", surveyId);

  const organizationId = survey.environment.project.organizationId;
  const accessMembership = await getSurveyAccessMembership(userId, organizationId);
  const orgMembership = await getMembershipByUserIdOrganizationId(userId, organizationId);

  if (!canAccessSurvey({ userId, survey, membership: accessMembership })) {
    throw new OperationNotAllowedError("No access to this survey.");
  }

  const canManage =
    survey.createdBy === userId ||
    accessMembership?.surveyAdmin === true ||
    orgMembership?.role === "owner" ||
    orgMembership?.role === "manager";
  if (!canManage) {
    throw new OperationNotAllowedError("Only the creator or an admin can manage sharing.");
  }
  return { survey, organizationId };
};

const ZSurveyId = z.object({ surveyId: z.string().cuid2() });

export const getSurveySharingStateAction = authenticatedActionClient
  .schema(ZSurveyId)
  .action(async ({ ctx, parsedInput }) => {
    const { survey, organizationId } = await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    const [accessList, members] = await Promise.all([
      listSurveyAccess(parsedInput.surveyId),
      listOrgMembers(organizationId),
    ]);
    return {
      visibility: survey.visibility,
      access: accessList.map((row) => row.user),
      orgMembers: members.map((m) => m.user),
    };
  });

const ZSetVisibility = z.object({
  surveyId: z.string().cuid2(),
  visibility: z.enum(["private", "public"]),
});

export const setSurveyVisibilityAction = authenticatedActionClient
  .schema(ZSetVisibility)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    return setSurveyVisibility(parsedInput.surveyId, parsedInput.visibility);
  });

const ZAddAccess = z.object({
  surveyId: z.string().cuid2(),
  userIds: z.array(z.string().min(1)).min(1),
});

export const addSurveyAccessAction = authenticatedActionClient
  .schema(ZAddAccess)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    await addSurveyAccess(parsedInput.surveyId, parsedInput.userIds);
    return { ok: true };
  });

const ZRemoveAccess = z.object({
  surveyId: z.string().cuid2(),
  userId: z.string().min(1),
});

export const removeSurveyAccessAction = authenticatedActionClient
  .schema(ZRemoveAccess)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    await removeSurveyAccess(parsedInput.surveyId, parsedInput.userId);
    return { ok: true };
  });
