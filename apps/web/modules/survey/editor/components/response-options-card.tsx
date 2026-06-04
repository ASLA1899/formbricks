"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CheckIcon } from "lucide-react";
import { KeyboardEventHandler, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { TSurvey } from "@formbricks/types/surveys/types";
import { cn } from "@/lib/cn";
import { AdvancedOptionToggle } from "@/modules/ui/components/advanced-option-toggle";
import { Alert, AlertTitle } from "@/modules/ui/components/alert";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import { Slider } from "@/modules/ui/components/slider";

function ScheduleRow({
  mode,
  survey,
  setLocalSurvey,
  tz,
}: {
  mode: "open" | "close";
  survey: TSurvey;
  setLocalSurvey: (s: TSurvey) => void;
  tz: string;
}) {
  const { t } = useTranslation();
  const fieldName = mode === "open" ? "runOnDate" : "closeOnDate";
  const value: Date | null = (survey as any)[fieldName];
  const enabled = value !== null;

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    [tz]
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }),
    [tz]
  );
  const previewFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "short",
      }),
    [tz]
  );

  // value -> wall-clock parts
  const dateStr = value ? dateFmt.format(value) : ""; // YYYY-MM-DD
  const timeStr = value ? timeFmt.format(value) : ""; // HH:MM

  // wall-clock + tz -> UTC instant (round-trip via toLocaleString)
  const updateFromWallClock = (date: string, time: string) => {
    if (!date || !time) return;
    const naive = new Date(`${date}T${time}:00`);
    const tzOffsetMs = naive.getTime() - new Date(naive.toLocaleString("en-US", { timeZone: tz })).getTime();
    const utc = new Date(naive.getTime() + tzOffsetMs);
    setLocalSurvey({ ...survey, [fieldName]: utc } as TSurvey);
  };

  const checkboxId = `schedule-${mode}-enabled`;
  const labelText = t(
    mode === "open"
      ? "environments.surveys.edit.schedule_open_label"
      : "environments.surveys.edit.schedule_close_label"
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            setLocalSurvey({ ...survey, [fieldName]: e.target.checked ? new Date() : null } as TSurvey)
          }
        />
        <label htmlFor={checkboxId} className="w-32 text-sm font-semibold text-slate-700">
          {labelText}
        </label>
        <Input
          type="date"
          data-testid={`schedule-${mode}-date`}
          value={dateStr}
          disabled={!enabled}
          onChange={(e) => updateFromWallClock(e.target.value, timeStr || "09:00")}
          className="w-36"
        />
        <Input
          type="time"
          data-testid={`schedule-${mode}-time`}
          value={timeStr}
          disabled={!enabled}
          onChange={(e) => updateFromWallClock(dateStr, e.target.value)}
          className="w-24"
        />
      </div>
      {enabled && value && (
        <>
          <p className="pl-32 text-xs text-slate-500">
            {t(
              mode === "open"
                ? "environments.surveys.edit.schedule_preview_open"
                : "environments.surveys.edit.schedule_preview_close",
              { date: previewFmt.format(value) }
            )}
          </p>
          {value.getTime() < Date.now() && (
            <p className="pl-32 text-xs text-yellow-700">
              {t("environments.surveys.edit.schedule_time_in_past")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface ResponseOptionsCardProps {
  localSurvey: TSurvey;
  setLocalSurvey: (survey: TSurvey | ((prev: TSurvey) => TSurvey)) => void;
  responseCount: number;
  isSpamProtectionAllowed: boolean;
}

export const ResponseOptionsCard = ({
  localSurvey,
  setLocalSurvey,
  responseCount,
  isSpamProtectionAllowed,
}: ResponseOptionsCardProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(localSurvey.type === "link" ? true : false);
  const autoComplete = localSurvey.autoComplete !== null;
  const [surveyClosedMessageToggle, setSurveyClosedMessageToggle] = useState(false);
  const [verifyEmailToggle, setVerifyEmailToggle] = useState(localSurvey.isVerifyEmailEnabled);
  const [recaptchaToggle, setRecaptchaToggle] = useState(localSurvey.recaptcha?.enabled ?? false);
  const [singleResponsePerEmailToggle, setSingleResponsePerEmailToggle] = useState(
    localSurvey.isSingleResponsePerEmailEnabled
  );
  const [captureIpToggle, setCaptureIpToggle] = useState(localSurvey.isCaptureIpEnabled);

  const [surveyClosedMessage, setSurveyClosedMessage] = useState({
    heading: t("environments.surveys.edit.survey_completed_heading"),
    subheading: t("environments.surveys.edit.survey_completed_subheading"),
  });

  const [recaptchaThreshold, setRecaptchaThreshold] = useState<number>(localSurvey.recaptcha?.threshold ?? 0);

  const isPinProtectionEnabled = localSurvey.pin !== null;

  const [verifyProtectWithPinError, setVerifyProtectWithPinError] = useState<string | null>(null);

  const handleProtectSurveyWithPinToggle = () => {
    setLocalSurvey((prevSurvey) => ({ ...prevSurvey, pin: isPinProtectionEnabled ? null : "1234" }));
  };

  const handleProtectSurveyPinChange = (pin: string) => {
    //check if pin only contains numbers
    const validation = /^\d+$/;
    const isValidPin = validation.test(pin);
    if (!isValidPin) return toast.error(t("environments.surveys.edit.pin_can_only_contain_numbers"));
    setLocalSurvey({ ...localSurvey, pin });
  };

  const handleProtectSurveyPinBlurEvent = () => {
    if (!localSurvey.pin) return setVerifyProtectWithPinError(null);

    const regexPattern = /^\d{4}$/;
    const isValidPin = regexPattern.test(`${localSurvey.pin}`);

    if (!isValidPin)
      return setVerifyProtectWithPinError(t("environments.surveys.edit.pin_must_be_a_four_digit_number"));
    setVerifyProtectWithPinError(null);
  };

  const handleSurveyPinInputKeyDown: KeyboardEventHandler<HTMLInputElement> = (e) => {
    const exceptThisSymbols = ["e", "E", "+", "-", "."];
    if (exceptThisSymbols.includes(e.key)) e.preventDefault();
  };

  const handleCloseSurveyMessageToggle = () => {
    setSurveyClosedMessageToggle((prev) => !prev);

    if (surveyClosedMessageToggle && localSurvey.surveyClosedMessage) {
      setLocalSurvey({ ...localSurvey, surveyClosedMessage: null });
    }
  };

  const handleVerifyEmailToogle = () => {
    const next = !verifyEmailToggle;
    setVerifyEmailToggle(next);
    // Disabling email verification forces the dedupe sub-option off too —
    // it has no meaning without a verified email.
    setLocalSurvey({
      ...localSurvey,
      isVerifyEmailEnabled: next,
      isSingleResponsePerEmailEnabled: next ? localSurvey.isSingleResponsePerEmailEnabled : false,
    });
    if (!next) setSingleResponsePerEmailToggle(false);
  };

  const handleLimitOneResponsePerPersonToggle = () => {
    const next = !singleResponsePerEmailToggle;
    setSingleResponsePerEmailToggle(next);
    // Dedupe implies verification: flip both on together; flipping off leaves verification alone.
    setLocalSurvey({
      ...localSurvey,
      isSingleResponsePerEmailEnabled: next,
      isVerifyEmailEnabled: next ? true : localSurvey.isVerifyEmailEnabled,
    });
    if (next) setVerifyEmailToggle(true);
  };

  const handleClosedSurveyMessageChange = ({
    heading,
    subheading,
  }: {
    heading?: string;
    subheading?: string;
  }) => {
    const message = {
      heading: heading ?? surveyClosedMessage.heading,
      subheading: subheading ?? surveyClosedMessage.subheading,
    };

    setSurveyClosedMessage(message);
    setLocalSurvey({ ...localSurvey, surveyClosedMessage: message });
  };

  const handleHideBackButtonToggle = () => {
    setLocalSurvey({ ...localSurvey, isBackButtonHidden: !localSurvey.isBackButtonHidden });
  };

  const handleCaptureIpToggle = () => {
    setCaptureIpToggle(!captureIpToggle);
    setLocalSurvey({ ...localSurvey, isCaptureIpEnabled: !localSurvey.isCaptureIpEnabled });
  };

  useEffect(() => {
    if (!!localSurvey.surveyClosedMessage) {
      setSurveyClosedMessage({
        heading: localSurvey.surveyClosedMessage.heading ?? surveyClosedMessage.heading,
        subheading: localSurvey.surveyClosedMessage.subheading ?? surveyClosedMessage.subheading,
      });
      setSurveyClosedMessageToggle(true);
    }
  }, [localSurvey, surveyClosedMessage.heading, surveyClosedMessage.subheading]);

  const toggleAutocomplete = () => {
    if (autoComplete) {
      const updatedSurvey = { ...localSurvey, autoComplete: null };
      setLocalSurvey(updatedSurvey);
    } else {
      const updatedSurvey = { ...localSurvey, autoComplete: Math.max(25, responseCount + 5) };
      setLocalSurvey(updatedSurvey);
    }
  };

  const handleInputResponse = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = parseInt(e.target.value);
    if (Number.isNaN(value) || value < 1) {
      value = 1;
    }

    const updatedSurvey = { ...localSurvey, autoComplete: value };
    setLocalSurvey(updatedSurvey);
  };

  const handleInputResponseBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (parseInt(e.target.value) === 0) {
      toast.error(t("environments.surveys.edit.response_limit_can_t_be_set_to_0"));
      return;
    }

    if (parseInt(e.target.value) <= responseCount) {
      toast.error(
        t("environments.surveys.edit.response_limit_needs_to_exceed_number_of_received_responses", {
          responseCount,
        }),
        {
          id: "response-limit-error",
        }
      );
      return;
    }
  };
  const [parent] = useAutoAnimate();

  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const allTzs = useMemo<string[]>(() => {
    try {
      return (Intl as any).supportedValuesOf?.("timeZone") ?? [browserTz];
    } catch {
      return [browserTz];
    }
  }, [browserTz]);

  const scheduleEnabled = !!(
    localSurvey.runOnDate ||
    localSurvey.closeOnDate ||
    localSurvey.scheduleTimezone
  );

  const toggleSchedule = (next: boolean) => {
    setLocalSurvey({
      ...localSurvey,
      runOnDate: null,
      closeOnDate: null,
      scheduleTimezone: next ? browserTz : null,
    });
  };

  const handleRecaptchaToggle = () => {
    if (!isSpamProtectionAllowed) return;
    if (recaptchaToggle) {
      setRecaptchaToggle(false);
      if (localSurvey.recaptcha?.enabled) {
        setRecaptchaThreshold(0.1);
        setLocalSurvey({ ...localSurvey, recaptcha: { enabled: false, threshold: 0.1 } });
      }
    } else {
      setRecaptchaToggle(true);
      setLocalSurvey({ ...localSurvey, recaptcha: { enabled: true, threshold: 0.1 } });
    }
  };

  const handleThresholdChange = (value: number) => {
    setRecaptchaThreshold(value);
    setLocalSurvey(
      (prevSurvey: TSurvey): TSurvey => ({
        ...prevSurvey,
        recaptcha: {
          enabled: prevSurvey.recaptcha?.enabled ?? false,
          threshold: value,
        },
      })
    );
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn(
        open ? "" : "hover:bg-slate-50",
        "w-full space-y-2 rounded-lg border border-slate-300 bg-white"
      )}>
      <Collapsible.CollapsibleTrigger asChild className="h-full w-full cursor-pointer">
        <div className="inline-flex px-4 py-4">
          <div className="flex items-center pr-5 pl-2">
            <CheckIcon
              strokeWidth={3}
              className="h-7 w-7 rounded-full border border-green-300 bg-green-100 p-1.5 text-green-600"
            />{" "}
          </div>
          <div>
            <p className="font-semibold text-slate-800">{t("environments.surveys.edit.response_options")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("environments.surveys.edit.response_limits_redirections_and_more")}
            </p>
          </div>
        </div>
      </Collapsible.CollapsibleTrigger>
      <Collapsible.CollapsibleContent className="flex flex-col" ref={parent}>
        <hr className="py-1 text-slate-600" />
        <div className="p-3">
          {/* Schedule survey window */}
          <AdvancedOptionToggle
            htmlId="scheduleSurveyWindow"
            isChecked={scheduleEnabled}
            onToggle={toggleSchedule}
            title={t("environments.surveys.edit.schedule_survey_window_title")}
            description={t("environments.surveys.edit.schedule_survey_window_description")}
            childBorder={true}>
            <div className="flex flex-col gap-3 bg-slate-50 p-4">
              {/* Timezone dropdown */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="scheduleTimezoneSelect"
                  className="w-32 text-sm font-semibold text-slate-700">
                  {t("environments.surveys.edit.schedule_timezone_label")}
                </label>
                <select
                  id="scheduleTimezoneSelect"
                  value={localSurvey.scheduleTimezone ?? browserTz}
                  onChange={(e) => setLocalSurvey({ ...localSurvey, scheduleTimezone: e.target.value })}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
                  {allTzs.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <ScheduleRow
                mode="open"
                survey={localSurvey}
                setLocalSurvey={(s) => setLocalSurvey(s)}
                tz={localSurvey.scheduleTimezone ?? browserTz}
              />
              <ScheduleRow
                mode="close"
                survey={localSurvey}
                setLocalSurvey={(s) => setLocalSurvey(s)}
                tz={localSurvey.scheduleTimezone ?? browserTz}
              />

              {localSurvey.runOnDate &&
                localSurvey.closeOnDate &&
                localSurvey.closeOnDate.getTime() <= localSurvey.runOnDate.getTime() && (
                  <p className="text-sm text-red-600">
                    {t("environments.surveys.edit.schedule_close_must_be_after_open")}
                  </p>
                )}
            </div>
          </AdvancedOptionToggle>

          {/* Close Survey on Limit */}
          <AdvancedOptionToggle
            htmlId="closeOnNumberOfResponse"
            isChecked={autoComplete}
            onToggle={toggleAutocomplete}
            title={t("environments.surveys.edit.close_survey_on_response_limit")}
            description={t(
              "environments.surveys.edit.automatically_close_the_survey_after_a_certain_number_of_responses"
            )}
            childBorder={true}>
            <label htmlFor="autoCompleteResponses" className="cursor-pointer bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">
                {t("environments.surveys.edit.automatically_mark_the_survey_as_complete_after")}
                <Input
                  autoFocus
                  type="number"
                  min={responseCount ? (responseCount + 1).toString() : "1"}
                  id="autoCompleteResponses"
                  value={localSurvey.autoComplete?.toString()}
                  onChange={handleInputResponse}
                  onBlur={handleInputResponseBlur}
                  className="mr-2 ml-2 inline w-20 bg-white text-center text-sm"
                />
                {t("environments.surveys.edit.completed_responses")}
              </p>
            </label>
          </AdvancedOptionToggle>

          {/* recaptcha for spam protection */}
          {isSpamProtectionAllowed && (
            <AdvancedOptionToggle
              htmlId="recaptchaToggle"
              isChecked={recaptchaToggle}
              onToggle={handleRecaptchaToggle}
              title={t("environments.surveys.edit.enable_spam_protection")}
              description={t("environments.surveys.edit.enable_recaptcha_to_protect_your_survey_from_spam")}
              childBorder={true}>
              <div className="w-full px-2 py-4">
                <p className="text-sm font-semibold text-slate-800">
                  {t("environments.surveys.edit.spam_protection_threshold_heading")} : {recaptchaThreshold}
                </p>
                <p className="mb-2 text-xs text-slate-500">
                  {t("environments.surveys.edit.spam_protection_threshold_description")}
                </p>
                <div className="flex w-full items-center gap-1">
                  <div className="text-center">
                    <p className="mx-2">0.1</p>
                    <p className="mx-2 text-xs text-slate-500">Lenient</p>
                  </div>

                  <Slider
                    value={[recaptchaThreshold]}
                    className="grow"
                    max={0.9}
                    min={0.1}
                    step={0.1}
                    onValueChange={(value) => {
                      handleThresholdChange(value[0]);
                    }}
                  />
                  <div className="text-center">
                    <p className="mx-2">0.9</p>
                    <p className="mx-2 text-xs text-slate-500">Strict</p>
                  </div>
                </div>
                <Alert variant="warning" size="default" className="w-fill mt-2 text-sm">
                  <AlertTitle>{t("environments.surveys.edit.spam_protection_note")}</AlertTitle>
                </Alert>
              </div>
            </AdvancedOptionToggle>
          )}

          {localSurvey.type === "link" && (
            <>
              {/* Adjust Survey Closed Message */}
              <AdvancedOptionToggle
                htmlId="adjustSurveyClosedMessage"
                isChecked={surveyClosedMessageToggle}
                onToggle={handleCloseSurveyMessageToggle}
                title={t("environments.surveys.edit.adjust_survey_closed_message")}
                description={t("environments.surveys.edit.adjust_survey_closed_message_description")}
                childBorder={true}>
                <div className="flex w-full items-center space-x-1 p-4 pb-4">
                  <div className="w-full cursor-pointer items-center bg-slate-50">
                    <Label htmlFor="headline">{t("environments.surveys.edit.heading")}</Label>
                    <Input
                      autoFocus
                      id="heading"
                      className="mt-2 mb-4 bg-white"
                      name="heading"
                      defaultValue={surveyClosedMessage.heading}
                      onChange={(e) => handleClosedSurveyMessageChange({ heading: e.target.value })}
                    />

                    <Label htmlFor="headline">{t("environments.surveys.edit.subheading")}</Label>
                    <Input
                      className="mt-2 bg-white"
                      id="subheading"
                      name="subheading"
                      defaultValue={surveyClosedMessage.subheading}
                      onChange={(e) => handleClosedSurveyMessageChange({ subheading: e.target.value })}
                    />
                  </div>
                </div>
              </AdvancedOptionToggle>

              {/* Verify Email Section */}
              <AdvancedOptionToggle
                htmlId="verifyEmailBeforeSubmission"
                isChecked={verifyEmailToggle}
                onToggle={handleVerifyEmailToogle}
                title={t("environments.surveys.edit.verify_email_before_submission")}
                description={t("environments.surveys.edit.verify_email_before_submission_description")}
              />

              {/* Limit One Response Per Person (was nested; promoted to top-level so it's discoverable) */}
              <AdvancedOptionToggle
                htmlId="limitOneResponsePerPerson"
                isChecked={singleResponsePerEmailToggle}
                onToggle={handleLimitOneResponsePerPersonToggle}
                title={t("environments.surveys.edit.limit_one_response_per_person")}
                description={t("environments.surveys.edit.limit_one_response_per_person_description")}
              />

              {/* Protect Survey with Pin */}
              <AdvancedOptionToggle
                htmlId="protectSurveyWithPin"
                isChecked={isPinProtectionEnabled}
                onToggle={handleProtectSurveyWithPinToggle}
                title={t("environments.surveys.edit.protect_survey_with_pin")}
                description={t("environments.surveys.edit.protect_survey_with_pin_description")}
                childBorder={true}>
                <div className="p-4">
                  <Label htmlFor="headline" className="sr-only">
                    {t("environments.surveys.edit.add_pin")}
                  </Label>
                  <Input
                    autoFocus
                    id="pin"
                    isInvalid={Boolean(verifyProtectWithPinError)}
                    className="bg-white"
                    name="pin"
                    placeholder={t("environments.surveys.edit.add_a_four_digit_pin")}
                    onBlur={handleProtectSurveyPinBlurEvent}
                    defaultValue={localSurvey.pin ? localSurvey.pin : undefined}
                    onKeyDown={handleSurveyPinInputKeyDown}
                    onChange={(e) => handleProtectSurveyPinChange(e.target.value)}
                    maxLength={4}
                  />
                  {verifyProtectWithPinError && (
                    <p className="pt-1 text-sm text-red-700">{verifyProtectWithPinError}</p>
                  )}
                </div>
              </AdvancedOptionToggle>
            </>
          )}
          <AdvancedOptionToggle
            htmlId="hideBackButton"
            isChecked={localSurvey.isBackButtonHidden}
            onToggle={handleHideBackButtonToggle}
            title={t("environments.surveys.edit.hide_back_button")}
            description={t("environments.surveys.edit.hide_back_button_description")}
          />
          <AdvancedOptionToggle
            htmlId="autoAdvance"
            isChecked={localSurvey.autoAdvance ?? false}
            onToggle={() => {
              setLocalSurvey({ ...localSurvey, autoAdvance: !localSurvey.autoAdvance });
            }}
            title="Auto-advance on answer"
            description="Automatically scroll to the next question and submit when all single-choice questions in a block are answered"
          />
          <AdvancedOptionToggle
            htmlId="snowflakeSync"
            isChecked={localSurvey.snowflakeSync ?? false}
            onToggle={() => {
              setLocalSurvey({ ...localSurvey, snowflakeSync: !localSurvey.snowflakeSync });
            }}
            title="Sync responses to Snowflake"
            description={
              localSurvey.snowflakeSync &&
              !localSurvey.hiddenFields?.fieldIds?.some((id) =>
                ["recordnumber", "customerid", "contactid"].includes(id.toLowerCase())
              )
                ? "Warning: No recordnumber hidden field found — responses will sync but RECORD_NUMBER will be NULL unless contacts have this attribute"
                : "Automatically send each response to the Snowflake data warehouse"
            }
          />
          <AdvancedOptionToggle
            htmlId="captureIp"
            isChecked={captureIpToggle}
            onToggle={handleCaptureIpToggle}
            title={t("environments.surveys.edit.capture_ip_address")}
            description={t("environments.surveys.edit.capture_ip_address_description")}
          />
        </div>
      </Collapsible.CollapsibleContent>
    </Collapsible.Root>
  );
};
