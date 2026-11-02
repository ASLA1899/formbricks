"use server";

import { z } from "zod";
import { prisma } from "@formbricks/database";
import { InvalidInputError, ResourceNotFoundError } from "@formbricks/types/errors";
import { findSurveyOutboundBlockers } from "@/app/api/v3/surveys/visibility/blockers";
import { planVisibilityTransition } from "@/app/api/v3/surveys/visibility/transition";
import { assertCan, can } from "@/lib/authorization";
import { setSurveyAccessMode } from "@/lib/survey/access-mode";
import { accessModeForVisibility } from "@/lib/survey/visibility/access-mode-map";
import { getEffectiveVisibility, getPendingVisibility } from "@/lib/survey/visibility/policy";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { getOrganizationIdFromSurveyId, getWorkspaceIdFromSurveyId } from "@/lib/utils/helper";
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

/** A share only works for someone who can still read the survey's workspace. */
const filterWorkspaceReaders = async <T extends { id: string }>(
  workspaceId: string,
  users: T[]
): Promise<T[]> => {
  const flags = await Promise.all(
    users.map((user) =>
      can({ id: user.id, type: "user" }, "workspace.read", { id: workspaceId, type: "workspace" })
    )
  );
  return users.filter((_, index) => flags[index]);
};

const ZSurveyId = z.object({ surveyId: z.cuid2() });

export const getSurveySharingStateAction = authenticatedActionClient
  .inputSchema(ZSurveyId)
  .action(async ({ ctx, parsedInput }) => {
    const organizationId = await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    const survey = await prisma.survey.findUnique({
      select: {
        visibility: true,
        visibilityProjectedVersion: true,
        visibilityVersion: true,
        workspaceId: true,
      },
      where: { id: parsedInput.surveyId },
    });
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);
    const [access, members] = await Promise.all([
      listSurveyAccess(parsedInput.surveyId),
      listShareableMembers(organizationId),
    ]);
    // The panel shows what authorization enforces right now (a grant the graph has not acknowledged
    // counts as restricted) plus the value a stored change is still settling to, never the mirrored
    // `accessMode` column or the raw stored flag.
    const orgMembers = await filterWorkspaceReaders(
      survey.workspaceId,
      members.map((member) => member.user)
    );
    const pending = getPendingVisibility(survey);
    return {
      accessMode: accessModeForVisibility(getEffectiveVisibility(survey)),
      pendingAccessMode: pending ? accessModeForVisibility(pending) : null,
      access: access.map((row) => row.user),
      orgMembers,
    };
  });

export const setSurveyAccessModeAction = authenticatedActionClient
  .inputSchema(z.object({ accessMode: z.enum(["private", "public"]), surveyId: z.cuid2() }))
  .action(async ({ ctx, parsedInput }) => {
    await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    if (parsedInput.accessMode === "private") {
      // Same gate as Collaborate and the v3 endpoint: a restriction is refused while a connection that
      // would silently stop (webhook, integration, workflow, ...) still references the survey.
      const survey = await prisma.survey.findUnique({
        select: {
          ownerId: true,
          visibility: true,
          visibilityProjectedVersion: true,
          visibilityVersion: true,
          workspaceId: true,
        },
        where: { id: parsedInput.surveyId },
      });
      if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);
      const settledRestricted = survey.visibility === "restricted" && getPendingVisibility(survey) === null;
      const blockers = settledRestricted
        ? []
        : await findSurveyOutboundBlockers(parsedInput.surveyId, survey.workspaceId);
      const plan = planVisibilityTransition({
        blockerCount: blockers.length,
        requested: "restricted",
        row: survey,
      });
      if (plan.kind === "reject") {
        return { status: "blocked" as const, code: plan.code, blockers };
      }
    }
    const result = await setSurveyAccessMode(parsedInput.surveyId, parsedInput.accessMode, ctx.user.id);
    return { status: "saved" as const, projection: result.projection };
  });

export const addSurveyAccessAction = authenticatedActionClient
  .inputSchema(z.object({ surveyId: z.cuid2(), userIds: z.array(z.cuid2()).min(1).max(200) }))
  .action(async ({ ctx, parsedInput }) => {
    const organizationId = await authorizeSharing(parsedInput.surveyId, ctx.user.id);
    const workspaceId = await getWorkspaceIdFromSurveyId(parsedInput.surveyId);
    const readers = await filterWorkspaceReaders(
      workspaceId,
      [...new Set(parsedInput.userIds)].map((id) => ({ id }))
    );
    if (readers.length !== new Set(parsedInput.userIds).size) {
      throw new InvalidInputError("Surveys can only be shared with people who have access to the workspace.");
    }
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
