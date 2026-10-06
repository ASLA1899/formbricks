"use server";

import { z } from "zod";
import { prisma } from "@formbricks/database";
import { OperationNotAllowedError } from "@formbricks/types/errors";
import { TAllowedFileExtension, mimeTypes } from "@formbricks/types/storage";
import { FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES } from "@formbricks/types/surveys/follow-up";
import { assertCan } from "@/lib/authorization";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { getOrganizationIdFromWorkspaceId } from "@/lib/utils/helper";
import { getSignedUrlForUpload } from "@/modules/storage/service";
import { isAllowedFileExtension } from "@/modules/storage/utils";
import { getSurveyFollowUpsPermission } from "@/modules/survey/follow-ups/lib/utils";

const ZGetFollowUpFileUploadUrl = z.object({
  workspaceId: z.cuid2(),
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(1),
  fileSize: z.number().int().positive().max(FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES),
});

/**
 * Signed upload for a follow-up file. The file is stored as `private`, so it can only be fetched through
 * the tracked /f/<token> link (or by a signed-in user of the workspace).
 */
export const getFollowUpFileUploadUrlAction = authenticatedActionClient
  .inputSchema(ZGetFollowUpFileUploadUrl)
  .action(async ({ ctx, parsedInput }) => {
    const { workspaceId, fileName, fileType, fileSize } = parsedInput;
    const organizationId = await getOrganizationIdFromWorkspaceId(workspaceId);

    await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
      type: "workspace",
      id: workspaceId,
    });

    if (!(await getSurveyFollowUpsPermission(organizationId))) {
      throw new OperationNotAllowedError("Survey follow ups are not enabled for this organization");
    }

    const extension = fileName.split(".").pop()?.toLowerCase() as TAllowedFileExtension | undefined;
    if (!isAllowedFileExtension(fileName) || !extension || mimeTypes[extension] !== fileType.toLowerCase()) {
      throw new OperationNotAllowedError("This file type is not allowed");
    }

    const result = await getSignedUrlForUpload(
      fileName,
      workspaceId,
      mimeTypes[extension],
      "private",
      FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES
    );
    if (!result.ok) {
      throw new OperationNotAllowedError("Could not prepare the upload");
    }

    const storedName = decodeURIComponent(result.data.fileUrl.split("/").pop() ?? "");

    return {
      signedUrl: result.data.signedUrl,
      presignedFields: result.data.presignedFields,
      storageKey: `${workspaceId}/private/${storedName}`,
      contentType: mimeTypes[extension],
      size: fileSize,
    };
  });

const ZGetFollowUpFileLinks = z.object({
  surveyId: z.cuid2(),
  followUpId: z.cuid2(),
});

const MAX_LISTED_LINKS = 200;

export const getFollowUpFileLinksAction = authenticatedActionClient
  .inputSchema(ZGetFollowUpFileLinks)
  .action(async ({ ctx, parsedInput }) => {
    const { surveyId, followUpId } = parsedInput;

    // The list shows recipient emails, so reading it needs write access to the survey itself
    // (the survey's own access rules apply on top of workspace access).
    await assertCan({ type: "user", id: ctx.user.id }, "survey.write", { type: "survey", id: surveyId });

    const where = { followUpId, followUp: { surveyId } };
    const [rows, total] = await Promise.all([
      prisma.surveyFollowUpFileLink.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: MAX_LISTED_LINKS,
        select: {
          id: true,
          recipientEmail: true,
          createdAt: true,
          firstDownloadedAt: true,
          lastDownloadedAt: true,
          downloadCount: true,
        },
      }),
      prisma.surveyFollowUpFileLink.count({ where }),
    ]);

    return { links: rows, total };
  });
