"use server";

import { z } from "zod";
import { prisma } from "@formbricks/database";
import {
  AuthorizationError,
  OperationNotAllowedError,
  ResourceNotFoundError,
} from "@formbricks/types/errors";
import { ZSurveyFilterCriteria } from "@formbricks/types/surveys/types";
import { canAccessSurvey, getSurveyAccessMembership } from "@/lib/survey/access";
import { getSurvey as getFullSurveyService } from "@/lib/survey/service";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { checkAuthorizationUpdated } from "@/lib/utils/action-client/action-client-middleware";
import { AuthenticatedActionClientCtx } from "@/lib/utils/action-client/types/context";
import {
  getEnvironmentIdFromSurveyId,
  getOrganizationIdFromEnvironmentId,
  getProjectIdFromEnvironmentId,
} from "@/lib/utils/helper";
import { generateSurveySingleUseIds } from "@/lib/utils/single-use-surveys";
import { withAuditLogging } from "@/modules/ee/audit-logs/lib/handler";
import { getProjectIdIfEnvironmentExists } from "@/modules/survey/list/lib/environment";
import { getUserProjects } from "@/modules/survey/list/lib/project";
import {
  copySurveyToOtherEnvironment,
  deleteSurvey,
  getSurvey,
  getSurveys,
} from "@/modules/survey/list/lib/survey";

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
  surveyId: z.string().cuid2(),
});

export const getSurveyAction = authenticatedActionClient
  .schema(ZGetSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    return await getSurvey(parsedInput.surveyId);
  });

const ZGetFullSurveyAction = z.object({
  surveyId: z.string().cuid2(),
});

export const getFullSurveyAction = authenticatedActionClient
  .schema(ZGetFullSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    return await getFullSurveyService(parsedInput.surveyId);
  });

const ZCopySurveyToOtherEnvironmentAction = z.object({
  surveyId: z.string().cuid2(),
  targetEnvironmentId: z.string().cuid2(),
});

export const copySurveyToOtherEnvironmentAction = authenticatedActionClient
  .schema(ZCopySurveyToOtherEnvironmentAction)
  .action(
    withAuditLogging(
      "copiedToOtherEnvironment",
      "survey",
      async ({
        ctx,
        parsedInput,
      }: {
        ctx: AuthenticatedActionClientCtx;
        parsedInput: z.infer<typeof ZCopySurveyToOtherEnvironmentAction>;
      }) => {
        const sourceEnvironmentId = await getEnvironmentIdFromSurveyId(parsedInput.surveyId);
        const sourceEnvironmentProjectId = await getProjectIdIfEnvironmentExists(sourceEnvironmentId);
        const targetEnvironmentProjectId = await getProjectIdIfEnvironmentExists(
          parsedInput.targetEnvironmentId
        );

        if (!sourceEnvironmentProjectId || !targetEnvironmentProjectId) {
          throw new ResourceNotFoundError(
            "Environment",
            sourceEnvironmentProjectId ? parsedInput.targetEnvironmentId : sourceEnvironmentId
          );
        }

        const sourceEnvironmentOrganizationId = await getOrganizationIdFromEnvironmentId(sourceEnvironmentId);
        const targetEnvironmentOrganizationId = await getOrganizationIdFromEnvironmentId(
          parsedInput.targetEnvironmentId
        );

        if (sourceEnvironmentOrganizationId !== targetEnvironmentOrganizationId) {
          throw new OperationNotAllowedError(
            "Source and target environments must be in the same organization"
          );
        }

        // ACL: caller must have access to the source survey AND manage privilege
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
        });

        // authorization check for target environment
        await checkAuthorizationUpdated({
          userId: ctx.user.id,
          organizationId: targetEnvironmentOrganizationId,
          access: [
            {
              type: "organization",
              roles: ["owner", "manager"],
            },
            {
              type: "projectTeam",
              minPermission: "readWrite",
              projectId: targetEnvironmentProjectId,
            },
          ],
        });

        ctx.auditLoggingCtx.organizationId = sourceEnvironmentOrganizationId;
        ctx.auditLoggingCtx.surveyId = parsedInput.surveyId;
        const result = await copySurveyToOtherEnvironment(
          sourceEnvironmentId,
          parsedInput.surveyId,
          parsedInput.targetEnvironmentId,
          ctx.user.id
        );
        ctx.auditLoggingCtx.newObject = result;
        return result;
      }
    )
  );

const ZGetProjectsByEnvironmentIdAction = z.object({
  environmentId: z.string().cuid2(),
});

export const getProjectsByEnvironmentIdAction = authenticatedActionClient
  .schema(ZGetProjectsByEnvironmentIdAction)
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
  surveyId: z.string().cuid2(),
});

export const deleteSurveyAction = authenticatedActionClient.schema(ZDeleteSurveyAction).action(
  withAuditLogging(
    "deleted",
    "survey",
    async ({ ctx, parsedInput }: { ctx: AuthenticatedActionClientCtx; parsedInput: Record<string, any> }) => {
      const { survey, accessMembership, organizationId } = await loadSurveyForAccess(
        parsedInput.surveyId,
        ctx.user.id
      );
      requireSurveyManagePrivilege(survey, accessMembership, ctx.user.id);

      ctx.auditLoggingCtx.organizationId = organizationId;
      ctx.auditLoggingCtx.surveyId = parsedInput.surveyId;
      ctx.auditLoggingCtx.oldObject = await getSurvey(parsedInput.surveyId);
      return await deleteSurvey(parsedInput.surveyId);
    }
  )
);

const ZGenerateSingleUseIdAction = z.object({
  surveyId: z.string().cuid2(),
  isEncrypted: z.boolean(),
  count: z.number().min(1).max(5000).default(1),
});

export const generateSingleUseIdsAction = authenticatedActionClient
  .schema(ZGenerateSingleUseIdAction)
  .action(async ({ ctx, parsedInput }) => {
    const { survey, accessMembership } = await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    requireSurveyManagePrivilege(survey, accessMembership, ctx.user.id);

    return generateSurveySingleUseIds(parsedInput.count, parsedInput.isEncrypted);
  });

const ZGetSurveysAction = z.object({
  environmentId: z.string().cuid2(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  filterCriteria: ZSurveyFilterCriteria.optional(),
});

export const getSurveysAction = authenticatedActionClient
  .schema(ZGetSurveysAction)
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
    );
  });
