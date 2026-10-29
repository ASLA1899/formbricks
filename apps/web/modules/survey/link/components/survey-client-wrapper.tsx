"use client";

import { useSearchParams } from "next/navigation";
<<<<<<< HEAD
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Workspace } from "@formbricks/database/prisma-browser";
import type { TRendererCustomCss } from "@formbricks/types/custom-css";
import { getIngestedStorageKeys } from "@formbricks/types/embedded-data-resolver";
import { TResponseData } from "@formbricks/types/responses";
import { TSurvey, TSurveyStyling } from "@formbricks/types/surveys/types";
import { TWorkspaceStyling } from "@formbricks/types/workspace";
import { toJsWorkspaceStateSurvey } from "@/lib/survey/client-utils";
=======
import { useCallback, useEffect, useMemo, useState } from "react";
import { TResumedResponse } from "@formbricks/types/formbricks-surveys";
import { TProjectStyling } from "@formbricks/types/project";
import { TResponseData } from "@formbricks/types/responses";
import { TSurvey, TSurveyStyling } from "@formbricks/types/surveys/types";
import { toJsEnvironmentStateSurvey } from "@/lib/survey/client-utils";
>>>>>>> origin/main
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";
import { CustomScriptsInjector } from "@/modules/survey/link/components/custom-scripts-injector";
import { LinkSurveyWrapper } from "@/modules/survey/link/components/link-survey-wrapper";
import { OfflineAlert } from "@/modules/survey/link/components/offline-alert";
import { useAppLocale } from "@/modules/survey/link/hooks/use-app-locale";
import { buildSurveyDocumentTitle } from "@/modules/survey/link/lib/document-title";
import {
  getHiddenFieldsFromSearchParams,
  warnOnMissingEmbeddedDataJoin,
} from "@/modules/survey/link/lib/hidden-fields";
import { getPrefillValue } from "@/modules/survey/link/lib/prefill";
import { getUserIdFromSearchParams } from "@/modules/survey/link/lib/user-id";
import { getSurveyLanguageTag, getWebAppLocale, isRTLLanguage } from "@/modules/survey/link/lib/utils";
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
  workspace: Pick<Workspace, "styling" | "logo" | "linkSurveyBranding" | "customHeadScripts">;
  styling: TWorkspaceStyling | TSurveyStyling;
  publicDomain: string;
  responseCount?: number;
  languageCode: string;
  isEmbed: boolean;
  singleUseId?: string;
  singleUseResponseId?: string;
  contactId?: string;
  canReadUserIdFromUrl?: boolean;
  recaptchaSiteKey?: string;
  isSpamProtectionEnabled: boolean;
  isPreview: boolean;
  verifiedEmail?: string;
  IMPRINT_URL?: string;
  PRIVACY_URL?: string;
  TERMS_URL?: string;
  IS_FORMBRICKS_CLOUD: boolean;
<<<<<<< HEAD
  pinAuthToken?: string;
  /** Compiled workspace + survey custom CSS, resolved server-side (ENG-3552). Never the source. */
  customCss?: TRendererCustomCss;
=======
  initialValues?: Record<string, string>;
>>>>>>> origin/main
}

let setBlockId = (_: string) => {};
let setResponseData = (_: TResponseData) => {};

export const SurveyClientWrapper = ({
  survey,
  workspace,
  styling,
  publicDomain,
  responseCount,
  languageCode,
  isEmbed,
  singleUseId,
  singleUseResponseId,
  contactId,
  canReadUserIdFromUrl = false,
  recaptchaSiteKey,
  isSpamProtectionEnabled,
  isPreview,
  verifiedEmail,
  IMPRINT_URL,
  PRIVACY_URL,
  TERMS_URL,
  IS_FORMBRICKS_CLOUD,
<<<<<<< HEAD
  pinAuthToken,
  customCss,
=======
  initialValues,
>>>>>>> origin/main
}: SurveyClientWrapperProps) => {
  const searchParams = useSearchParams();

  // The survey's active language: starts at the server-provided code, then follows the
  // in-survey language switch (via onLanguageChange). The whole shell (i18n strings, logo
  // direction, page lang/dir) keys off this so it stays in sync, not just the document.
  const [currentLanguageCode, setCurrentLanguageCode] = useState(languageCode);
  useEffect(() => {
    setCurrentLanguageCode(languageCode);
  }, [languageCode]);

  useAppLocale(getWebAppLocale(currentLanguageCode, survey));

  const skipPrefilled = searchParams.get("skipPrefilled") === "true";
  const offlineSupport = searchParams.get("offlineSupport") === "true";
  const userId = canReadUserIdFromUrl ? getUserIdFromSearchParams(searchParams) : undefined;
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

<<<<<<< HEAD
  // Extract ingestible Embedded Data from URL parameters.
  //
  // The allow-list is the survey's linked `ingested` rows (ENG-1843), which the legacy
  // `hiddenFields.fieldIds` is only derived from. `locked` fields are deliberately included: the
  // renderer's ingest contract drops their incoming values and logs why, and filtering them out here
  // would silence that diagnostic while duplicating a rule that already has one home.
  //
  // Keyed on the ids' contents, not the array identity, which changes on every parent render
  // (ENG-2366).
  const ingestedStorageKeys = getIngestedStorageKeys(survey);
=======
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
>>>>>>> origin/main
  const hiddenFieldsRecord = useMemo(() => {
    return getHiddenFieldsFromSearchParams(ingestedStorageKeys, searchParams);
    // eslint-disable-next-line react-hooks/use-memo -- migration ENG-1677
  }, [searchParams, JSON.stringify(ingestedStorageKeys)]);

  // The diagnostic is a side effect, so it belongs in an effect rather than in the memo above: a memo
  // body runs twice per mount under StrictMode, so this warning printed twice on every dev page load,
  // and it would re-run on any `searchParams` change even though what it reports depends only on the
  // survey. Keyed on whether the join was read, which is all it reports on.
  const hasEmbeddedFields = survey.embeddedFields !== undefined;
  useEffect(() => {
    warnOnMissingEmbeddedDataJoin(hasEmbeddedFields);
  }, [hasEmbeddedFields]);

  // Include verified email in hidden fields if available
  const getVerifiedEmail = useMemo<Record<string, string> | null>(() => {
    if (survey.isVerifyEmailEnabled && verifiedEmail) {
      return { verifiedEmail: verifiedEmail };
    }
    return null;
  }, [survey.isVerifyEmailEnabled, verifiedEmail]);

  // Position label for the card the respondent is on, reported by the survey renderer and already
  // localized in the survey's active language (see SurveyBaseProps.onPageChange).
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const handlePageChange = useCallback((page: { index: number; total: number; label: string }) => {
    setPageLabel(page.label);
  }, []);

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
  const jsSurvey = useMemo(() => toJsWorkspaceStateSurvey(survey), [survey]);
  const isCardless = styling.cardArrangement?.linkSurveys === "cardless";
  const hasLogo = !styling.isLogoHidden && !!(styling.logo?.url || workspace.logo?.url);

  // Determine text direction based on language code for logo positioning only
  // which checks both language code and survey content. This is only for logo UI positioning.
  const logoDir = useMemo(() => {
<<<<<<< HEAD
    return isRTLLanguage(jsSurvey, currentLanguageCode) ? "rtl" : "auto";
  }, [currentLanguageCode, jsSurvey]);

  // Keep the page lang/dir aligned with the survey's active language so the browser
  // and screen readers announce content in the right language, and RTL languages flip
  // direction (WCAG 3.1.1 / 1.3.2). Link surveys own their document; the embedded JS
  // widget never reaches this component, so host pages are never mutated.
  useEffect(() => {
    const html = document.documentElement;
    const previousLang = html.getAttribute("lang");
    const previousDir = html.getAttribute("dir");

    const tag = getSurveyLanguageTag(jsSurvey, currentLanguageCode);
    if (tag) html.setAttribute("lang", tag);
    html.setAttribute("dir", isRTLLanguage(jsSurvey, currentLanguageCode) ? "rtl" : "ltr");

    return () => {
      if (previousLang === null) html.removeAttribute("lang");
      else html.setAttribute("lang", previousLang);
      if (previousDir === null) html.removeAttribute("dir");
      else html.setAttribute("dir", previousDir);
    };
  }, [currentLanguageCode, jsSurvey]);

  // Give every page of the survey a title that says which page it is (WCAG 2.4.2). generateMetadata
  // cannot do this: the step lives in the renderer's state, which the server never sees.
  //
  // The base is the server-rendered title, captured once on mount, so the author's custom link
  // metadata title and the "| Formbricks" template are respected without reimplementing
  // getBasicSurveyMetadata's priority chain here. Restored on unmount for the same reason the
  // lang/dir effect restores: a client-side navigation away must not leave a stale title behind.
  //
  // Link surveys own their document. The embedded JS widget never reaches this component, so a host
  // page's title is never touched.
  const baseTitleRef = useRef<string | null>(null);
  useEffect(() => {
    baseTitleRef.current ??= document.title;
    const baseTitle = baseTitleRef.current;
    return () => {
      document.title = baseTitle;
    };
  }, []);

  useEffect(() => {
    if (baseTitleRef.current === null || !pageLabel) return;
    document.title = buildSurveyDocumentTitle(baseTitleRef.current, pageLabel);
  }, [pageLabel]);
=======
    return isRTLLanguage(toJsEnvironmentStateSurvey(survey), languageCode) ? "rtl" : "auto";
  }, [languageCode, survey]);
>>>>>>> origin/main

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
          workspaceScripts={workspace.customHeadScripts}
          surveyScripts={survey.customHeadScripts}
          scriptsMode={survey.customHeadScriptsMode}
        />
      )}
      <LinkSurveyWrapper
        workspace={workspace}
        workspaceId={survey.workspaceId}
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
        isBrandingEnabled={workspace.linkSurveyBranding}
        dir={logoDir}>
        <SurveyInline
          appUrl={publicDomain}
          workspaceId={survey.workspaceId}
          isPreviewMode={isPreview}
<<<<<<< HEAD
          survey={jsSurvey}
=======
          // ASLA #7931: pass the metadata-stripped js-environment-state survey shape, NOT the
          // raw TSurvey (upstream 4.9 predates #7931 and passes the unstripped survey here).
          survey={toJsEnvironmentStateSurvey(survey)}
>>>>>>> origin/main
          styling={styling}
          customCss={customCss}
          languageCode={languageCode}
          onLanguageChange={setCurrentLanguageCode}
          onPageChange={handlePageChange}
          isBrandingEnabled={workspace.linkSurveyBranding}
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
          pinAuthToken={pinAuthToken}
          getSetIsResponseSendingFinished={(_f: (value: boolean) => void) => {}}
          contactId={contactId}
          userId={userId}
          recaptchaSiteKey={recaptchaSiteKey}
          isSpamProtectionEnabled={isSpamProtectionEnabled}
          offlineSupport={offlineSupport}
          onOfflineStatusChange={offlineSupport ? handleOfflineStatusChange : undefined}
<<<<<<< HEAD
          showCardlessPreviewLogoSlot={isCardless && hasLogo}
=======
          resumedResponse={resumedResponse}
          onResponseIdReceived={handleResponseIdReceived}
          onFinished={handleFinished}
>>>>>>> origin/main
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
