"use client";

import { Project } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TResumedResponse } from "@formbricks/types/formbricks-surveys";
import { TProjectStyling } from "@formbricks/types/project";
import { TResponseData } from "@formbricks/types/responses";
import { TSurvey, TSurveyStyling } from "@formbricks/types/surveys/types";
import { toJsEnvironmentStateSurvey } from "@/lib/survey/client-utils";
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";
import { CustomScriptsInjector } from "@/modules/survey/link/components/custom-scripts-injector";
import { LinkSurveyWrapper } from "@/modules/survey/link/components/link-survey-wrapper";
import { OfflineAlert } from "@/modules/survey/link/components/offline-alert";
import { getPrefillValue } from "@/modules/survey/link/lib/prefill";
import { isRTLLanguage } from "@/modules/survey/link/lib/utils";
import { SurveyInline } from "@/modules/ui/components/survey";

const RESUME_STORAGE_PREFIX = "formbricks-resume-";

interface StoredResume {
  responseId: string;
  updatedAt: number;
}

function readStoredResume(surveyId: string): StoredResume | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_PREFIX + surveyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResume;
    if (!parsed.responseId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredResume(surveyId: string, responseId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RESUME_STORAGE_PREFIX + surveyId,
      JSON.stringify({ responseId, updatedAt: Date.now() })
    );
  } catch {
    // localStorage may be disabled (private mode, quota); ignore — feature
    // degrades gracefully to no resume
  }
}

function clearStoredResume(surveyId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RESUME_STORAGE_PREFIX + surveyId);
  } catch {
    // ignore
  }
}

interface SurveyClientWrapperProps {
  survey: TSurvey;
  project: Pick<Project, "styling" | "logo" | "linkSurveyBranding" | "customHeadScripts">;
  styling: TProjectStyling | TSurveyStyling;
  publicDomain: string;
  responseCount?: number;
  languageCode: string;
  isEmbed: boolean;
  singleUseId?: string;
  singleUseResponseId?: string;
  contactId?: string;
  recaptchaSiteKey?: string;
  isSpamProtectionEnabled: boolean;
  isPreview: boolean;
  verifiedEmail?: string;
  IMPRINT_URL?: string;
  PRIVACY_URL?: string;
  TERMS_URL?: string;
  IS_FORMBRICKS_CLOUD: boolean;
  initialValues?: Record<string, string>;
}

let setBlockId = (_: string) => {};
let setResponseData = (_: TResponseData) => {};

export const SurveyClientWrapper = ({
  survey,
  project,
  styling,
  publicDomain,
  responseCount,
  languageCode,
  isEmbed,
  singleUseId,
  singleUseResponseId,
  contactId,
  recaptchaSiteKey,
  isSpamProtectionEnabled,
  isPreview,
  verifiedEmail,
  IMPRINT_URL,
  PRIVACY_URL,
  TERMS_URL,
  IS_FORMBRICKS_CLOUD,
  initialValues,
}: SurveyClientWrapperProps) => {
  const searchParams = useSearchParams();
  const skipPrefilled = searchParams.get("skipPrefilled") === "true";
  const offlineSupport = searchParams.get("offlineSupport") === "true";
  const elements = useMemo(() => getElementsFromBlocks(survey.blocks), [survey.blocks]);

  const startAt = searchParams.get("startAt");

  // Extract survey properties outside useMemo to create stable references
  const welcomeCardEnabled = survey.welcomeCard.enabled;

  // Validate startAt parameter against survey elements
  const isStartAtValid = useMemo(() => {
    if (!startAt) return false;
    if (welcomeCardEnabled && startAt === "start") return true;

    const isValid = elements.some((element) => element.id === startAt);

    // Clean up invalid startAt from URL to prevent confusion
    if (!isValid && globalThis.window !== undefined) {
      const url = new URL(globalThis.location.href);
      url.searchParams.delete("startAt");
      globalThis.history.replaceState({}, "", url.toString());
    }

    return isValid;
  }, [welcomeCardEnabled, elements, startAt]);

  const prefillValue = getPrefillValue(survey, searchParams, languageCode);

  // Merge initial values from contact attributes with prefill values
  // Prefill values from URL take precedence over initial values
  const mergedPrefillValue = useMemo(() => {
    if (!initialValues || Object.keys(initialValues).length === 0) {
      return prefillValue;
    }
    return {
      ...initialValues,
      ...prefillValue, // URL params override initial values
    };
  }, [initialValues, prefillValue]);

  const [autoFocus, setAutoFocus] = useState(false);

  // Enable autofocus only when not in iframe
  useEffect(() => {
    if (globalThis.self === globalThis.top) {
      setAutoFocus(true);
    }
  }, []);

  // Resume support for shared-URL link surveys: we stash the responseId in
  // localStorage on first submit and try to rehydrate it on revisit. Resume is
  // intentionally skipped for previews, contact-survey flows (server already
  // dedupes via contactId), and single-use surveys (server tracks via suId).
  const isResumeEligible = !isPreview && !contactId && !singleUseId;
  const [resumeStatus, setResumeStatus] = useState<"loading" | "ready">(
    isResumeEligible ? "loading" : "ready"
  );
  const [resumedResponse, setResumedResponse] = useState<TResumedResponse | undefined>(undefined);

  useEffect(() => {
    if (!isResumeEligible) return;
    const stored = readStoredResume(survey.id);
    if (!stored) {
      setResumeStatus("ready");
      return;
    }
    let cancelled = false;
    const url = `/api/v2/client/${survey.environmentId}/responses/${stored.responseId}?surveyId=${survey.id}`;
    fetch(url, { method: "GET" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // 404 / 410 — response gone or already finished. Clear and start fresh.
          clearStoredResume(survey.id);
          setResumeStatus("ready");
          return;
        }
        const body = (await res.json()) as {
          data?: {
            id: string;
            data: TResponseData;
            ttc: Record<string, number>;
            variables: Record<string, string | number>;
          };
        };
        if (body?.data?.id) {
          setResumedResponse({
            id: body.data.id,
            data: body.data.data ?? {},
            ttc: body.data.ttc ?? {},
            variables: body.data.variables ?? {},
          });
        } else {
          clearStoredResume(survey.id);
        }
        setResumeStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setResumeStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [isResumeEligible, survey.id, survey.environmentId]);

  const handleResponseIdReceived = useCallback(
    (responseId: string) => {
      if (!isResumeEligible) return;
      writeStoredResume(survey.id, responseId);
    },
    [isResumeEligible, survey.id]
  );

  const handleFinished = useCallback(() => {
    clearStoredResume(survey.id);
  }, [survey.id]);

  // Extract hidden fields from URL parameters
  const hiddenFieldsRecord = useMemo(() => {
    const fieldsRecord: Record<string, string> = {};
    for (const field of survey.hiddenFields.fieldIds || []) {
      const answer = searchParams.get(field);
      if (answer) fieldsRecord[field] = answer;
    }
    return fieldsRecord;
  }, [searchParams, JSON.stringify(survey.hiddenFields.fieldIds || [])]);

  // Include verified email in hidden fields if available
  const getVerifiedEmail = useMemo<Record<string, string> | null>(() => {
    if (survey.isVerifyEmailEnabled && verifiedEmail) {
      return { verifiedEmail: verifiedEmail };
    }
    return null;
  }, [survey.isVerifyEmailEnabled, verifiedEmail]);

  const [offlineStatus, setOfflineStatus] = useState({
    isOnline: true,
    isSyncing: false,
    pendingSyncCount: 0,
  });
  const handleOfflineStatusChange = useCallback(
    (status: { isOnline: boolean; isSyncing: boolean; pendingSyncCount: number }) => {
      setOfflineStatus(status);
    },
    []
  );

  const handleResetSurvey = () => {
    if (survey.welcomeCard.enabled) {
      setBlockId("start");
    } else if (survey.blocks[0]) {
      setBlockId(survey.blocks[0].id);
    }
    setResponseData({});
    clearStoredResume(survey.id);
  };
  // Determine text direction based on language code for logo positioning only
  // which checks both language code and survey content. This is only for logo UI positioning.
  const logoDir = useMemo(() => {
    return isRTLLanguage(toJsEnvironmentStateSurvey(survey), languageCode) ? "rtl" : "auto";
  }, [languageCode, survey]);

  // Block the survey from mounting until we've decided whether to resume —
  // otherwise the runtime initializes with empty state and the resume fetch
  // result would be discarded.
  if (resumeStatus === "loading") {
    return null;
  }

  return (
    <>
      {/* Inject custom scripts for tracking/analytics (self-hosted only) */}
      {!IS_FORMBRICKS_CLOUD && !isPreview && (
        <CustomScriptsInjector
          projectScripts={project.customHeadScripts}
          surveyScripts={survey.customHeadScripts}
          scriptsMode={survey.customHeadScriptsMode}
        />
      )}
      <LinkSurveyWrapper
        project={project}
        surveyId={survey.id}
        isWelcomeCardEnabled={survey.welcomeCard.enabled}
        isPreview={isPreview}
        surveyType={survey.type}
        determineStyling={() => styling}
        handleResetSurvey={handleResetSurvey}
        isEmbed={isEmbed}
        publicDomain={publicDomain}
        IS_FORMBRICKS_CLOUD={IS_FORMBRICKS_CLOUD}
        IMPRINT_URL={IMPRINT_URL}
        PRIVACY_URL={PRIVACY_URL}
        TERMS_URL={TERMS_URL}
        isBrandingEnabled={project.linkSurveyBranding}
        dir={logoDir}>
        <SurveyInline
          appUrl={publicDomain}
          environmentId={survey.environmentId}
          isPreviewMode={isPreview}
          // ASLA #7931: pass the metadata-stripped js-environment-state survey shape, NOT the
          // raw TSurvey (upstream 4.9 predates #7931 and passes the unstripped survey here).
          survey={toJsEnvironmentStateSurvey(survey)}
          styling={styling}
          languageCode={languageCode}
          isBrandingEnabled={project.linkSurveyBranding}
          shouldResetQuestionId={false}
          autoFocus={autoFocus}
          prefillResponseData={mergedPrefillValue}
          skipPrefilled={skipPrefilled}
          responseCount={responseCount}
          getSetBlockId={(f: (value: string) => void) => {
            setBlockId = f;
          }}
          getSetResponseData={(f: (value: TResponseData) => void) => {
            setResponseData = f;
          }}
          startAtQuestionId={startAt && isStartAtValid ? startAt : undefined}
          fullSizeCards={isEmbed}
          cardSize={survey.styling?.cardSize ?? "normal"}
          autoAdvance={survey.autoAdvance ?? false}
          hiddenFieldsRecord={{
            ...hiddenFieldsRecord,
            ...getVerifiedEmail,
          }}
          singleUseId={singleUseId}
          singleUseResponseId={singleUseResponseId}
          getSetIsResponseSendingFinished={(_f: (value: boolean) => void) => {}}
          contactId={contactId}
          recaptchaSiteKey={recaptchaSiteKey}
          isSpamProtectionEnabled={isSpamProtectionEnabled}
          offlineSupport={offlineSupport}
          onOfflineStatusChange={offlineSupport ? handleOfflineStatusChange : undefined}
          resumedResponse={resumedResponse}
          onResponseIdReceived={handleResponseIdReceived}
          onFinished={handleFinished}
        />
      </LinkSurveyWrapper>
      {offlineSupport && !isEmbed && (
        <OfflineAlert
          isOnline={offlineStatus.isOnline}
          isSyncing={offlineStatus.isSyncing}
          pendingSyncCount={offlineStatus.pendingSyncCount}
        />
      )}
    </>
  );
};
