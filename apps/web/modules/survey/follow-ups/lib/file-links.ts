import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@formbricks/database";
import {
  FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES,
  TSurveyFollowUpAttachment,
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
  attachment,
}: {
  followUpId: string;
  responseId: string;
  recipientEmail: string;
  attachment: TSurveyFollowUpAttachment;
}): Promise<string> => {
  const token = generateFileLinkToken();
  // The file is snapshotted on the link, so links already sent keep working if the follow-up's file is
  // later replaced or removed.
  await prisma.surveyFollowUpFileLink.create({
    data: {
      token,
      followUpId,
      responseId,
      recipientEmail,
      storageKey: attachment.storageKey,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: attachment.size,
    },
    select: { id: true },
  });
  return token;
};

export const deleteFollowUpFileLinkByToken = async (token: string): Promise<void> => {
  await prisma.surveyFollowUpFileLink.deleteMany({ where: { token } });
};

type TResolvedFileLink = {
  attachment: Pick<TSurveyFollowUpAttachment, "storageKey" | "fileName" | "contentType" | "size">;
  environmentId: string;
};

/**
 * Resolves a token to the file that was emailed. Returns null for unknown tokens or keys outside the
 * survey's own environment.
 */
export const resolveFollowUpFileLink = async (token: string): Promise<TResolvedFileLink | null> => {
  if (!isValidFileLinkToken(token)) return null;

  const link = await prisma.surveyFollowUpFileLink.findUnique({
    where: { token },
    select: {
      storageKey: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      followUp: { select: { survey: { select: { environmentId: true } } } },
    },
  });
  if (!link) return null;

  const environmentId = link.followUp.survey.environmentId;
  if (!isAttachmentKeyInEnvironment(link.storageKey, environmentId)) {
    logger.warn({ environmentId }, "Follow-up file link points outside its environment");
    return null;
  }

  return {
    attachment: {
      storageKey: link.storageKey,
      fileName: link.fileName,
      contentType: link.contentType,
      size: link.fileSize,
    },
    environmentId,
  };
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

  try {
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
  } catch (error) {
    // e.g. the link was deleted between lookup and count: release the open S3 stream.
    await stream.data.body.cancel().catch(() => undefined);
    logger.warn({ error }, "Could not count follow-up file download");
    return null;
  }

  return {
    body: stream.data.body,
    contentType: attachment.contentType,
    contentLength: stream.data.contentLength,
    contentDisposition: buildContentDisposition(attachment.fileName),
  };
};
