"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { ResourceNotFoundError } from "@formbricks/types/errors";
import { ZSurveyInvitationConfig } from "@formbricks/types/surveys/types";
import { assertCan } from "@/lib/authorization";
import { getOrganizationByWorkspaceId } from "@/lib/organization/service";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { getSurvey } from "@/modules/survey/lib/survey";
import {
  enqueueInvitationsForSurvey,
  getInvitationSummary,
  listInvitationsBySurveyId,
  runPendingInvitationSends,
} from "./lib/invitations";
import { sendManualReminders } from "./lib/reminders";

const ZSurveyIdInput = z.object({ surveyId: z.string().cuid2() });

export const getInvitationSummaryAction = authenticatedActionClient
  .inputSchema(ZSurveyIdInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.read", {
      type: "survey",
      id: parsedInput.surveyId,
    });
    return getInvitationSummary(parsedInput.surveyId);
  });

export const listSurveyInvitationsAction = authenticatedActionClient
  .inputSchema(ZSurveyIdInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.read", {
      type: "survey",
      id: parsedInput.surveyId,
    });
    return listInvitationsBySurveyId(parsedInput.surveyId);
  });

const ZSendInvitationsInput = z.object({
  surveyId: z.string().cuid2(),
  config: ZSurveyInvitationConfig,
});

export const sendInvitationsAction = authenticatedActionClient
  .inputSchema(ZSendInvitationsInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.write", {
      type: "survey",
      id: parsedInput.surveyId,
    });

    const survey = await getSurvey(parsedInput.surveyId);
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);

    // Persist the config used for this send back to the survey, so the
    // editor sees what we actually sent next time it loads. Bypasses
    // updateSurvey's full-shape Zod validation by writing only this field
    // — SurveyInvitationConfig is its own validated input above.
    await prisma.survey.update({
      where: { id: survey.id },
      data: { invitationConfig: parsedInput.config },
    });

    // Enqueue-only: persist SurveyInvitation rows with sentAt=null and return
    // immediately. Actual SMTP sends are throttled by the drainer to respect
    // provider rate limits (Resend = 2-10 req/s) and to avoid blocking the user
    // for the duration of a large send.
    const result = await enqueueInvitationsForSurvey({
      surveyId: survey.id,
      workspaceId: survey.workspaceId,
      config: parsedInput.config,
    });

    // Kick the drainer in the background so users see the first batch go out
    // immediately rather than waiting for the next cron tick. We deliberately
    // don't await — long sends would block the action far past the user's
    // patience and any HTTP timeout. Errors are logged inside the drainer.
    if (result.enqueued > 0) {
      void runPendingInvitationSends({ surveyId: survey.id }).catch((error) => {
        logger.error({ error, surveyId: survey.id }, "Background invitation drainer failed");
      });
    }

    revalidatePath(`/workspaces/${survey.workspaceId}/surveys/${survey.id}`);
    return result;
  });

const ZSendRemindersInput = z.object({
  surveyId: z.string().cuid2(),
  config: ZSurveyInvitationConfig,
  minDaysSinceLast: z.number().int().min(0).max(365).optional(),
});

export const sendRemindersAction = authenticatedActionClient
  .inputSchema(ZSendRemindersInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.write", {
      type: "survey",
      id: parsedInput.surveyId,
    });

    const survey = await getSurvey(parsedInput.surveyId);
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);

    // Same persist-on-send as sendInvitationsAction.
    await prisma.survey.update({
      where: { id: survey.id },
      data: { invitationConfig: parsedInput.config },
    });

    const org = await getOrganizationByWorkspaceId(survey.workspaceId);
    const organizationName = org?.name ?? "";

    const result = await sendManualReminders({
      surveyId: survey.id,
      organizationName,
      surveyName: survey.name,
      config: parsedInput.config,
      minDaysSinceLast: parsedInput.minDaysSinceLast,
    });

    revalidatePath(`/workspaces/${survey.workspaceId}/surveys/${survey.id}`);
    return result;
  });
