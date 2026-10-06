import { logger } from "@formbricks/logger";
import { getFileStream } from "@formbricks/storage";
import { TResponse } from "@formbricks/types/responses";
import {
  FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES,
  TSurveyFollowUpAttachment,
} from "@formbricks/types/surveys/follow-up";
import { TSurveyFollowUp } from "@formbricks/types/surveys/follow-up";
import { TSurvey } from "@formbricks/types/surveys/types";
import { TUserLocale } from "@formbricks/types/user";
import { sendEmail } from "@/modules/email";
import { buildSurveyResponseEmailHtml } from "@/modules/email/lib/survey-response-email";
import {
  canAttachFileToEmail,
  createFollowUpFileLink,
  deleteFollowUpFileLinkByToken,
  getFollowUpFileUrl,
  isAttachmentKeyInWorkspace,
} from "@/modules/survey/follow-ups/lib/file-links";

/** Reads the file for a real email attachment. The byte count is checked here, not trusted from the editor. */
export const readFollowUpAttachment = async (
  attachment: TSurveyFollowUpAttachment
): Promise<{ filename: string; content: Buffer; contentType: string } | null> => {
  if (!canAttachFileToEmail(attachment)) return null;

  const stream = await getFileStream(attachment.storageKey);
  if (!stream.ok) {
    logger.error({ code: stream.error.code }, "Could not read follow-up file for email attachment");
    return null;
  }
  if (stream.data.contentLength > FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES) return null;

  const content = Buffer.from(await new Response(stream.data.body).arrayBuffer());
  if (content.byteLength > FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES) return null;

  return { filename: attachment.fileName, content, contentType: attachment.contentType };
};

export const sendFollowUpEmail = async ({
  followUp,
  to,
  replyTo,
  survey,
  response,
  attachResponseData = false,
  includeVariables = false,
  includeHiddenFields = false,
  logoUrl,
  locale,
}: {
  followUp: TSurveyFollowUp;
  to: string;
  replyTo: string[];
  attachResponseData: boolean;
  includeVariables?: boolean;
  includeHiddenFields?: boolean;
  survey: TSurvey;
  response: TResponse;
  logoUrl?: string;
  locale?: TUserLocale;
}): Promise<void> => {
  const {
    action: {
      properties: { subject, body, attachment },
    },
  } = followUp;

  if (attachment && !isAttachmentKeyInWorkspace(attachment.storageKey, survey.workspaceId)) {
    throw new Error(`Follow-up file does not belong to this survey's workspace: ${followUp.id}`);
  }

  // One tracked link per sent email, so downloads can be attributed to a recipient.
  const fileLinkToken = attachment
    ? await createFollowUpFileLink({ followUpId: followUp.id, responseId: response.id, recipientEmail: to })
    : null;

  try {
    const emailHtmlBody = await buildSurveyResponseEmailHtml({
      body,
      survey,
      response,
      attachResponseData,
      includeVariables,
      includeHiddenFields,
      fileLink:
        attachment && fileLinkToken
          ? { url: getFollowUpFileUrl(fileLinkToken), fileName: attachment.fileName }
          : undefined,
      logoUrl,
      locale,
    });

    const fileAttachment = attachment ? await readFollowUpAttachment(attachment) : null;

    const sent = await sendEmail({
      emailType: "survey_follow_up",
      to,
      replyTo: replyTo.join(", "),
      subject,
      html: emailHtmlBody,
      ...(fileAttachment && { attachments: [fileAttachment] }),
    });

    // Nothing was sent (e.g. SMTP not configured), so the link must not stay around as a dead record.
    if (!sent && fileLinkToken) await deleteFollowUpFileLinkByToken(fileLinkToken);
  } catch (error) {
    if (fileLinkToken) await deleteFollowUpFileLinkByToken(fileLinkToken);
    throw error;
  }
};
