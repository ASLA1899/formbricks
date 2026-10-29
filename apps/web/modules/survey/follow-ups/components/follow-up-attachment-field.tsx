"use client";

import { FileIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES,
  FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES,
} from "@formbricks/database/types/survey-follow-up";
import { ALLOWED_FILE_EXTENSIONS, mimeTypes } from "@formbricks/types/storage";
import { getFormattedErrorMessage } from "@/lib/utils/helper";
import { TCreateSurveyFollowUpForm } from "@/modules/survey/editor/types/survey-follow-up";
import { getFollowUpFileUploadUrlAction } from "@/modules/survey/follow-ups/actions";
import { AdvancedOptionToggle } from "@/modules/ui/components/advanced-option-toggle";
import { Button } from "@/modules/ui/components/button";

const MB = 1024 * 1024;

const formatSize = (bytes: number): string =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

interface FollowUpAttachmentFieldProps {
  environmentId: string;
}

export const FollowUpAttachmentField = ({ environmentId }: FollowUpAttachmentFieldProps) => {
  const { t } = useTranslation();
  const { watch, setValue } = useFormContext<TCreateSurveyFollowUpForm>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const attachment = watch("attachment");

  const canAttachToEmail = !!attachment && attachment.size <= FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES;

  const handleFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const contentType = extension ? (mimeTypes as Record<string, string>)[extension] : undefined;
    if (!extension || !contentType || !ALLOWED_FILE_EXTENSIONS.includes(extension as never)) {
      toast.error(t("environments.surveys.edit.follow_up_attachment_type_not_allowed"));
      return;
    }
    if (file.size > FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES) {
      toast.error(
        t("environments.surveys.edit.follow_up_attachment_too_large", {
          maxSize: FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES / MB,
        })
      );
      return;
    }

    setIsUploading(true);
    try {
      const result = await getFollowUpFileUploadUrlAction({
        environmentId,
        fileName: file.name,
        fileType: contentType,
        fileSize: file.size,
      });
      if (!result?.data) {
        toast.error(getFormattedErrorMessage(result));
        return;
      }

      const { signedUrl, presignedFields, storageKey } = result.data;
      const formData = new FormData();
      Object.entries(presignedFields).forEach(([key, value]) => formData.append(key, value));
      formData.append("file", file);

      const uploadResponse = await fetch(signedUrl, { method: "POST", body: formData });
      if (!uploadResponse.ok) {
        toast.error(t("environments.surveys.edit.follow_up_attachment_upload_failed"));
        return;
      }

      setValue(
        "attachment",
        {
          storageKey,
          fileName: file.name,
          contentType,
          size: file.size,
          attachToEmail: file.size <= FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES && !!attachment?.attachToEmail,
        },
        { shouldDirty: true, shouldValidate: true }
      );
    } catch {
      toast.error(t("environments.surveys.edit.follow_up_attachment_upload_failed"));
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col space-y-2 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-900">
        {t("environments.surveys.edit.follow_up_attachment_title")}
      </h3>
      <p className="text-sm text-slate-500">
        {t("environments.surveys.edit.follow_up_attachment_description")}
      </p>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
        data-testid="follow-up-attachment-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {attachment ? (
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 items-center space-x-2">
            <FileIcon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="truncate text-sm text-slate-900">{attachment.fileName}</span>
            <span className="shrink-0 text-xs text-slate-500">{formatSize(attachment.size)}</span>
          </div>
          <div className="flex items-center space-x-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isUploading}
              onClick={() => inputRef.current?.click()}>
              {isUploading
                ? t("environments.surveys.edit.follow_up_attachment_uploading")
                : t("environments.surveys.edit.follow_up_attachment_replace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("environments.surveys.edit.follow_up_attachment_remove")}
              onClick={() => setValue("attachment", undefined, { shouldDirty: true, shouldValidate: true })}>
              <Trash2Icon className="h-4 w-4 text-slate-500" />
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={isUploading}
            onClick={() => inputRef.current?.click()}>
            <PaperclipIcon className="h-4 w-4" aria-hidden="true" />
            {isUploading
              ? t("environments.surveys.edit.follow_up_attachment_uploading")
              : t("environments.surveys.edit.follow_up_attachment_upload")}
          </Button>
        </div>
      )}

      {attachment ? (
        <AdvancedOptionToggle
          htmlId="attachFileToEmail"
          isChecked={canAttachToEmail && attachment.attachToEmail}
          disabled={!canAttachToEmail}
          onToggle={(checked) =>
            setValue("attachment", { ...attachment, attachToEmail: checked }, { shouldDirty: true })
          }
          title={t("environments.surveys.edit.follow_up_attachment_attach_label")}
          description={
            canAttachToEmail
              ? t("environments.surveys.edit.follow_up_attachment_attach_description")
              : t("environments.surveys.edit.follow_up_attachment_attach_disabled", {
                  maxSize: FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES / MB,
                })
          }
          customContainerClass="p-0"
        />
      ) : null}
    </div>
  );
};
