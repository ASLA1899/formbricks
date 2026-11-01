"use server";

import { z } from "zod";
import { prisma } from "@formbricks/database";
import { ResourceNotFoundError } from "@formbricks/types/errors";
import { assertCan } from "@/lib/authorization";
import { setSurveyAccessMode } from "@/lib/survey/access-mode";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { getOrganizationIdFromSurveyId } from "@/lib/utils/helper";
import {
  addSurveyAccess,
  listShareableMembers,
  listSurveyAccess,
  removeSurveyAccess,
} from "@/modules/survey/sharing/lib/survey-access";

/**
 * Per-survey sharing (ASL-1880). Every action goes through the graph first: managing sharing is
 * `survey.change_visibility`, the same permission as the v3 visibility endpoint, so a shared (read-only)
 * user can never manage the shares. The shares themselves are the fork's `SurveyAccess` rows.
 */
const authorizeSharing = async (surveyId: string, userId: string): Promise<string> => {
  const organizationId = await getOrganizationIdFromSurveyId(surveyId);
  await assertCan({ id: userId, type: "user" }, "survey.change_visibility", { id: surveyId, type: "survey" });
  return organizationId;
};

const ZSurveyId = z.object({ surveyId: z.cuid2() });

export const getSurveySharingStateAction = authenticatedActionClient
  .inputSchema(ZSurveyId)
  .action(async ({ ctx, parsedInput }) => {
    const organizationId = await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    const survey = await prisma.survey.findUnique({
      select: { accessMode: true },
      where: { id: parsedInput.surveyId },
    });
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);
    const [access, members] = await Promise.all([
      listSurveyAccess(parsedInput.surveyId),
      listShareableMembers(organizationId),
    ]);
    return {
      accessMode: survey.accessMode,
      access: access.map((row) => row.user),
      orgMembers: members.map((member) => member.user),
    };
  });

export const setSurveyAccessModeAction = authenticatedActionClient
  .inputSchema(z.object({ accessMode: z.enum(["private", "public"]), surveyId: z.cuid2() }))
  .action(async ({ ctx, parsedInput }) => {
    await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    return setSurveyAccessMode(parsedInput.surveyId, parsedInput.accessMode, ctx.user.id);
  });

export const addSurveyAccessAction = authenticatedActionClient
  .inputSchema(z.object({ surveyId: z.cuid2(), userIds: z.array(z.cuid2()).min(1).max(200) }))
  .action(async ({ ctx, parsedInput }) => {
    const organizationId = await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    await addSurveyAccess(parsedInput.surveyId, organizationId, parsedInput.userIds);
    return { ok: true };
  });

export const removeSurveyAccessAction = authenticatedActionClient
  .inputSchema(z.object({ surveyId: z.cuid2(), userId: z.cuid2() }))
  .action(async ({ ctx, parsedInput }) => {
    await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    await removeSurveyAccess(parsedInput.surveyId, parsedInput.userId);
    return { ok: true };
  });
