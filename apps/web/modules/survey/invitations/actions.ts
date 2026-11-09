"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { AuthorizationError, ResourceNotFoundError } from "@formbricks/types/errors";
import { type TSurveyInvitationConfig, ZSurveyInvitationConfig } from "@formbricks/types/surveys/types";
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

// Writes a client-supplied invitation config onto its survey. Every action that stores the config goes
// through here, so none of them can save another workspace's segment. Writes only this field, which
// skips updateSurvey's full-survey validation; ZSurveyInvitationConfig has already validated it.
async function persistInvitationConfig(
  survey: { id: string; workspaceId: string },
  config: TSurveyInvitationConfig
): Promise<void> {
  if (config.audience.source === "segment") {
    const segment = await prisma.segment.findUnique({
      where: { id: config.audience.segmentId },
      select: { workspaceId: true },
    });
    if (segment && segment.workspaceId !== survey.workspaceId) {
      throw new AuthorizationError("Segment is not in this survey's workspace");
    }
  }
  await prisma.survey.update({ where: { id: survey.id }, data: { invitationConfig: config } });
}

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

export const getInvitationConfigAction = authenticatedActionClient
  .inputSchema(ZSurveyIdInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.read", {
      type: "survey",
      id: parsedInput.surveyId,
    });
    const survey = await prisma.survey.findUnique({
      where: { id: parsedInput.surveyId },
      select: { invitationConfig: true },
    });
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);
    // A stored config that no longer matches the schema is shown as empty rather than failing the card.
    const parsed = ZSurveyInvitationConfig.safeParse(survey.invitationConfig);
    return parsed.success ? parsed.data : null;
  });

const ZSaveInvitationConfigInput = z.object({
  surveyId: z.string().cuid2(),
  config: ZSurveyInvitationConfig,
});

// Saves the editor's recipients and reminder settings without sending. Scheduled reminders read this
// config, so it has to be saved before the schedule can run.
export const saveInvitationConfigAction = authenticatedActionClient
  .inputSchema(ZSaveInvitationConfigInput)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "survey.write", {
      type: "survey",
      id: parsedInput.surveyId,
    });

    const survey = await getSurvey(parsedInput.surveyId);
    if (!survey) throw new ResourceNotFoundError("Survey", parsedInput.surveyId);

    await persistInvitationConfig(survey, parsedInput.config);
    revalidatePath(`/workspaces/${survey.workspaceId}/surveys/${survey.id}`);
    return { saved: true };
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

    // Persist the config used for this send, so the editor shows what was actually sent.
    await persistInvitationConfig(survey, parsedInput.config);

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
    await persistInvitationConfig(survey, parsedInput.config);

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
