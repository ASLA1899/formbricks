import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@formbricks/database";
import {
  FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES,
  TSurveyFollowUpAttachment,
  ZSurveyFollowUpAction,
} from "@formbricks/database/types/survey-follow-up";
import { logger } from "@formbricks/logger";
import { getFileStream } from "@formbricks/storage";
import { getPublicDomain } from "@/lib/getPublicUrl";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const isValidFileLinkToken = (token: string): boolean => TOKEN_PATTERN.test(token);

/** 256-bit, URL-safe. Never log the result. */
export const generateFileLinkToken = (): string => randomBytes(32).toString("base64url");

export const getFollowUpFileUrl = (token: string): string => `${getPublicDomain()}/f/${token}`;

/** A key is only usable for a survey if it points at a private file in that survey's own environment. */
export const isAttachmentKeyInEnvironment = (storageKey: string, environmentId: string): boolean =>
  storageKey.startsWith(`${environmentId}/private/`) && !storageKey.includes("..");

export const canAttachFileToEmail = (attachment: TSurveyFollowUpAttachment | undefined): boolean =>
  !!attachment && attachment.attachToEmail && attachment.size <= FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES;

const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/[\r\n"\\/]/g, "_").trim() || "download";

export const buildContentDisposition = (fileName: string): string => {
  const safe = sanitizeFileName(fileName);
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
};

export const createFollowUpFileLink = async ({
  followUpId,
  responseId,
  recipientEmail,
}: {
  followUpId: string;
  responseId: string;
  recipientEmail: string;
}): Promise<string> => {
  const token = generateFileLinkToken();
  await prisma.surveyFollowUpFileLink.create({
    data: { token, followUpId, responseId, recipientEmail },
    select: { id: true },
  });
  return token;
};

export const deleteFollowUpFileLinkByToken = async (token: string): Promise<void> => {
  await prisma.surveyFollowUpFileLink.deleteMany({ where: { token } });
};

type TResolvedFileLink = {
  attachment: TSurveyFollowUpAttachment;
  environmentId: string;
};

/**
 * Resolves a token to its file. Returns null for unknown tokens, follow-ups that no longer carry a file,
 * or keys outside the survey's own environment.
 */
export const resolveFollowUpFileLink = async (token: string): Promise<TResolvedFileLink | null> => {
  if (!isValidFileLinkToken(token)) return null;

  const link = await prisma.surveyFollowUpFileLink.findUnique({
    where: { token },
    select: {
      followUp: { select: { action: true, survey: { select: { environmentId: true } } } },
    },
  });
  if (!link) return null;

  const action = ZSurveyFollowUpAction.safeParse(link.followUp.action);
  const attachment = action.success ? action.data.properties.attachment : undefined;
  if (!attachment) return null;

  const environmentId = link.followUp.survey.environmentId;
  if (!isAttachmentKeyInEnvironment(attachment.storageKey, environmentId)) {
    logger.warn({ environmentId }, "Follow-up file link points outside its environment");
    return null;
  }

  return { attachment, environmentId };
};

export type TFollowUpFileDownload = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  contentDisposition: string;
};

/**
 * Opens the file and counts the download. The file is streamed from this app instead of redirecting to a
 * signed S3 URL: the app's CSP (`form-action 'self'`) blocks form posts that redirect to another origin, and
 * streaming keeps raw storage URLs out of the browser. The stream is opened before counting, so a failed
 * request is never counted.
 */
export const registerFollowUpFileDownload = async (token: string): Promise<TFollowUpFileDownload | null> => {
  const resolved = await resolveFollowUpFileLink(token);
  if (!resolved) return null;

  const { attachment } = resolved;
  const stream = await getFileStream(attachment.storageKey);
  if (!stream.ok) {
    logger.error({ code: stream.error.code }, "Could not open follow-up file for download");
    return null;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.surveyFollowUpFileLink.updateMany({
      where: { token, firstDownloadedAt: null },
      data: { firstDownloadedAt: now },
    }),
    prisma.surveyFollowUpFileLink.update({
      where: { token },
      data: { lastDownloadedAt: now, downloadCount: { increment: 1 } },
      select: { id: true },
    }),
  ]);

  return {
    body: stream.data.body,
    contentType: attachment.contentType,
    contentLength: stream.data.contentLength,
    contentDisposition: buildContentDisposition(attachment.fileName),
  };
};
