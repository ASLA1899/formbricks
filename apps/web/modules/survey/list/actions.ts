"use server";

import { z } from "zod";
<<<<<<< HEAD
import { OperationNotAllowedError } from "@formbricks/types/errors";
import { assertCan } from "@/lib/authorization";
=======
import { prisma } from "@formbricks/database";
import {
  AuthorizationError,
  OperationNotAllowedError,
  ResourceNotFoundError,
} from "@formbricks/types/errors";
import { ZSurveyFilterCriteria } from "@formbricks/types/surveys/types";
import { canAccessSurvey, getSurveyAccessMembership } from "@/lib/survey/access";
import { getSurvey as getFullSurveyService } from "@/lib/survey/service";
>>>>>>> origin/main
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { getOrganizationIdFromWorkspaceId, getWorkspaceIdFromSurveyId } from "@/lib/utils/helper";
import {
<<<<<<< HEAD
  generateSurveySingleUseLinkParams,
  generateSurveySingleUseLinkParamsList,
} from "@/lib/utils/single-use-surveys";
import { applyRateLimit } from "@/modules/core/rate-limit/helpers";
import { rateLimitConfigs } from "@/modules/core/rate-limit/rate-limit-configs";
=======
  getEnvironmentIdFromSurveyId,
  getOrganizationIdFromEnvironmentId,
  getProjectIdFromEnvironmentId,
} from "@/lib/utils/helper";
import { generateSurveySingleUseIds } from "@/lib/utils/single-use-surveys";
>>>>>>> origin/main
import { withAuditLogging } from "@/modules/ee/audit-logs/lib/handler";
import { copySurveyToOtherWorkspace } from "@/modules/survey/list/lib/survey";

<<<<<<< HEAD
const ZCopySurveyToOtherWorkspaceAction = z.object({
=======
const loadSurveyForAccess = async (surveyId: string, userId: string) => {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      environmentId: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!survey) throw new ResourceNotFoundError("Survey", surveyId);

  const organizationId = survey.environment.project.organizationId;
  const accessMembership = await getSurveyAccessMembership(userId, organizationId);

  if (!canAccessSurvey({ userId, survey, membership: accessMembership })) {
    throw new AuthorizationError("You do not have access to this survey.");
  }
  return { survey, accessMembership, organizationId };
};

// OrganizationRole is unreliable in non-EE (every member defaults to "owner"),
// so mutating-action gate = creator OR surveyAdmin only.
const requireSurveyManagePrivilege = (
  survey: { createdBy: string | null },
  accessMembership: { surveyAdmin: boolean } | null,
  userId: string
) => {
  const isPrivileged = accessMembership?.surveyAdmin === true || survey.createdBy === userId;
  if (!isPrivileged) {
    throw new OperationNotAllowedError("Only the survey creator or a survey admin can perform this action.");
  }
};

const ZGetSurveyAction = z.object({
>>>>>>> origin/main
  surveyId: z.cuid2(),
  targetWorkspaceId: z.cuid2(),
});

<<<<<<< HEAD
export const copySurveyToOtherWorkspaceAction = authenticatedActionClient
  .inputSchema(ZCopySurveyToOtherWorkspaceAction)
=======
export const getSurveyAction = authenticatedActionClient
  .inputSchema(ZGetSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    return await getSurvey(parsedInput.surveyId);
  });

const ZGetFullSurveyAction = z.object({
  surveyId: z.string().cuid2(),
});

export const getFullSurveyAction = authenticatedActionClient
  .inputSchema(ZGetFullSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    return await getFullSurveyService(parsedInput.surveyId);
  });

const ZCopySurveyToOtherEnvironmentAction = z.object({
  surveyId: z.cuid2(),
  targetEnvironmentId: z.cuid2(),
});

export const copySurveyToOtherEnvironmentAction = authenticatedActionClient
  .inputSchema(ZCopySurveyToOtherEnvironmentAction)
>>>>>>> origin/main
  .action(
    withAuditLogging("copiedToOtherWorkspace", "survey", async ({ ctx, parsedInput }) => {
      const sourceWorkspaceId = await getWorkspaceIdFromSurveyId(parsedInput.surveyId);

      const sourceOrganizationId = await getOrganizationIdFromWorkspaceId(sourceWorkspaceId);
      const targetOrganizationId = await getOrganizationIdFromWorkspaceId(parsedInput.targetWorkspaceId);

      if (sourceOrganizationId !== targetOrganizationId) {
        throw new OperationNotAllowedError("Source and target workspaces must be in the same organization");
      }

<<<<<<< HEAD
      // authorization check for source workspace
      await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
        type: "workspace",
        id: sourceWorkspaceId,
=======
      const sourceEnvironmentOrganizationId = await getOrganizationIdFromEnvironmentId(sourceEnvironmentId);
      const targetEnvironmentOrganizationId = await getOrganizationIdFromEnvironmentId(
        parsedInput.targetEnvironmentId
      );

      if (sourceEnvironmentOrganizationId !== targetEnvironmentOrganizationId) {
        throw new OperationNotAllowedError("Source and target environments must be in the same organization");
      }

      // ACL: caller must have access to the source survey AND manage privilege (creator or surveyAdmin).
      // Org-role checks below are no-ops in non-EE (every member defaults to "owner").
      const { survey: copySurvey, accessMembership: copyAccessMembership } = await loadSurveyForAccess(
        parsedInput.surveyId,
        ctx.user.id
      );
      requireSurveyManagePrivilege(copySurvey, copyAccessMembership, ctx.user.id);

      // authorization check for source environment
      await checkAuthorizationUpdated({
        userId: ctx.user.id,
        organizationId: sourceEnvironmentOrganizationId,
        access: [
          {
            type: "organization",
            roles: ["owner", "manager"],
          },
          {
            type: "projectTeam",
            minPermission: "readWrite",
            projectId: sourceEnvironmentProjectId,
          },
        ],
>>>>>>> origin/main
      });

      // authorization check for target workspace
      await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
        type: "workspace",
        id: parsedInput.targetWorkspaceId,
      });

      // ENG-3282: a copy carries the whole survey, so the caller must be able to read the source survey
      // itself — workspace write does not reach a restricted survey. Same denial as any other refusal.
      await assertCan({ type: "user", id: ctx.user.id }, "survey.read", {
        type: "survey",
        id: parsedInput.surveyId,
      });
      await applyRateLimit(rateLimitConfigs.actions.stateMutation, parsedInput.targetWorkspaceId);

      ctx.auditLoggingCtx.organizationId = sourceOrganizationId;
      ctx.auditLoggingCtx.surveyId = parsedInput.surveyId;
      const result = await copySurveyToOtherWorkspace(
        sourceWorkspaceId,
        parsedInput.surveyId,
        parsedInput.targetWorkspaceId,
        ctx.user.id
      );
      ctx.auditLoggingCtx.newObject = result;
      return result;
    })
  );

<<<<<<< HEAD
const ZGenerateSingleUseIdAction = z
  .object({
    surveyId: z.cuid2(),
    isEncrypted: z.boolean(),
    count: z.number().min(1).max(5000).prefault(1),
    singleUseId: z.string().trim().min(1).max(255).optional(),
=======
const ZGetProjectsByEnvironmentIdAction = z.object({
  environmentId: z.cuid2(),
});

export const getProjectsByEnvironmentIdAction = authenticatedActionClient
  .inputSchema(ZGetProjectsByEnvironmentIdAction)
  .action(async ({ ctx, parsedInput }) => {
    const organizationId = await getOrganizationIdFromEnvironmentId(parsedInput.environmentId);
    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: organizationId,
      access: [
        {
          type: "organization",
          roles: ["owner", "manager"],
        },
        {
          type: "projectTeam",
          minPermission: "readWrite",
          projectId: await getProjectIdFromEnvironmentId(parsedInput.environmentId),
        },
      ],
    });

    return await getUserProjects(ctx.user.id, organizationId);
  });

const ZDeleteSurveyAction = z.object({
  surveyId: z.cuid2(),
});

export const deleteSurveyAction = authenticatedActionClient.inputSchema(ZDeleteSurveyAction).action(
  withAuditLogging("deleted", "survey", async ({ ctx, parsedInput }) => {
    // ACL gate: creator or surveyAdmin only. Org-role checks are no-ops in non-EE
    // (every member defaults to "owner"), so do not use checkAuthorizationUpdated here.
    const { survey, accessMembership, organizationId } = await loadSurveyForAccess(
      parsedInput.surveyId,
      ctx.user.id
    );
    requireSurveyManagePrivilege(survey, accessMembership, ctx.user.id);

    ctx.auditLoggingCtx.organizationId = organizationId;
    ctx.auditLoggingCtx.surveyId = parsedInput.surveyId;
    ctx.auditLoggingCtx.oldObject = await getSurvey(parsedInput.surveyId);
    return await deleteSurvey(parsedInput.surveyId);
>>>>>>> origin/main
  })
  .refine((data) => !data.singleUseId || (!data.isEncrypted && data.count === 1), {
    message: "Custom single-use IDs can only be generated one at a time without encryption",
  });

export const generateSingleUseIdsAction = authenticatedActionClient
  .inputSchema(ZGenerateSingleUseIdAction)
  .action(async ({ ctx, parsedInput }) => {
<<<<<<< HEAD
    await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
      type: "workspace",
      id: await getWorkspaceIdFromSurveyId(parsedInput.surveyId),
    });
    // ENG-3282: the minted links write responses into this survey, as the survey summary's link actions
    // already require.
    await assertCan({ type: "user", id: ctx.user.id }, "survey.write", {
      type: "survey",
      id: parsedInput.surveyId,
    });
=======
    const { survey, accessMembership } = await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    requireSurveyManagePrivilege(survey, accessMembership, ctx.user.id);
>>>>>>> origin/main

    if (parsedInput.singleUseId) {
      return [generateSurveySingleUseLinkParams(parsedInput.surveyId, false, parsedInput.singleUseId)];
    }

<<<<<<< HEAD
    return generateSurveySingleUseLinkParamsList(
      parsedInput.count,
      parsedInput.surveyId,
      parsedInput.isEncrypted
=======
const ZGetSurveysAction = z.object({
  environmentId: z.cuid2(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  filterCriteria: ZSurveyFilterCriteria.optional(),
});

export const getSurveysAction = authenticatedActionClient
  .inputSchema(ZGetSurveysAction)
  .action(async ({ ctx, parsedInput }) => {
    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: await getOrganizationIdFromEnvironmentId(parsedInput.environmentId),
      access: [
        {
          data: parsedInput.filterCriteria,
          schema: ZSurveyFilterCriteria,
          type: "organization",
          roles: ["owner", "manager"],
        },
        {
          type: "projectTeam",
          minPermission: "read",
          projectId: await getProjectIdFromEnvironmentId(parsedInput.environmentId),
        },
      ],
    });

    const organizationId = await getOrganizationIdFromEnvironmentId(parsedInput.environmentId);
    const membership = await getSurveyAccessMembership(ctx.user.id, organizationId);

    return await getSurveys(
      parsedInput.environmentId,
      { userId: ctx.user.id, membership },
      parsedInput.limit,
      parsedInput.offset,
      parsedInput.filterCriteria
>>>>>>> origin/main
    );
  });
