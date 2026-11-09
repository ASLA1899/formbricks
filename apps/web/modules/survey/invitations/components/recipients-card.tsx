"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { MailsIcon, SaveIcon, SendIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { TSegment } from "@formbricks/types/segment";
import type { TSurveyInvitationConfig } from "@formbricks/types/surveys/types";
import { cn } from "@/lib/cn";
import { getFormattedErrorMessage } from "@/lib/utils/error-message";
import { Button } from "@/modules/ui/components/button";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";
import {
  getInvitationConfigAction,
  getInvitationSummaryAction,
  listSurveyInvitationsAction,
  saveInvitationConfigAction,
  sendInvitationsAction,
  sendRemindersAction,
} from "../actions";
import {
  type THeadingMode,
  type TInvitationAudienceDraft,
  type TInvitationConfigDraft,
  clampMaxReminders,
  createEmptyDraft,
  deriveHeadingMode,
  headingTextForMode,
  isAudienceComplete,
  parseReminderDays,
  validateDraft,
} from "../lib/config-draft";
import {
  MAX_CSV_BYTES,
  csvToRecipients,
  mergeRecipients,
  recipientsToText,
  textToRecipients,
} from "../lib/recipient-import";
import { MERGE_FIELDS, type TInvitationRow, type TInvitationSummary } from "../types/invitation";
import { RecipientListTable } from "./recipient-list-table";

type TTemplateKey = keyof TSurveyInvitationConfig["emailTemplates"];
type TTemplate = TSurveyInvitationConfig["emailTemplates"][TTemplateKey];

interface RecipientsCardProps {
  surveyId: string;
  segments: TSegment[];
}

// Invitation settings for one survey: who to invite, the invitation and reminder emails, and the
// reminder schedule. 6.1 keeps the config off the survey object, so this card loads and saves it
// itself; the editor's own Save button does not save it.
export const RecipientsCard = ({ surveyId, segments }: Readonly<RecipientsCardProps>) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Set when the saved config could not be read. The card then offers a retry rather than an editable
  // default draft, whose Save would overwrite the stored templates and schedule.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<TInvitationConfigDraft>(createEmptyDraft);
  // The textarea keeps the raw text so a half-typed line ("it@") stays visible while the parsed
  // recipient list only holds lines that validate.
  const [manualListRaw, setManualListRaw] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [summary, setSummary] = useState<TInvitationSummary | null>(null);
  const [invitationRows, setInvitationRows] = useState<TInvitationRow[]>([]);
  const [busy, setBusy] = useState<"save" | "send" | "remind" | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const refreshInvitations = async () => {
    const [nextSummary, nextRows] = await Promise.all([
      getInvitationSummaryAction({ surveyId }),
      listSurveyInvitationsAction({ surveyId }),
    ]);
    if (nextSummary?.data) setSummary(nextSummary.data);
    if (nextRows?.data) setInvitationRows(nextRows.data);
  };

  // Load once, the first time the card opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    const load = async () => {
      setLoadError(null);
      try {
        const [configResult] = await Promise.all([
          getInvitationConfigAction({ surveyId }),
          refreshInvitations(),
        ]);
        if (cancelled) return;
        // A null config (nothing saved yet) is normal; an error is not.
        const message = configResult ? getFormattedErrorMessage(configResult) : "";
        if (!configResult || message) {
          setLoadError(message || t("workspace.surveys.invitations.load_failed"));
          return;
        }
        if (configResult.data) {
          setDraft(configResult.data);
          if (configResult.data.audience.source === "manualList") {
            setManualListRaw(recipientsToText(configResult.data.audience.recipients));
          }
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setLoadError(t("workspace.surveys.invitations.load_failed"));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // refreshInvitations and t are stable for this card; loadAttempt re-runs the load on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, surveyId, loadAttempt]);

  const updateDraft = (patch: Partial<TInvitationConfigDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setIsDirty(true);
  };
  const updateAudience = (audience: TInvitationAudienceDraft) => updateDraft({ audience });
  const updateTemplate = (key: TTemplateKey, patch: Partial<TTemplate>) =>
    updateDraft({
      emailTemplates: { ...draft.emailTemplates, [key]: { ...draft.emailTemplates[key], ...patch } },
    });

  const { audience } = draft;
  const audienceComplete = isAudienceComplete(audience);
  // Segments need the Contacts feature this fork does not ship; offer them only where they exist.
  const showSegmentSource = segments.length > 0 || audience.source === "segment";
  // Snowflake audiences are switched off on this instance (resolveSnowflakeAudience refuses them);
  // the option stays only so a config saved with it can still be viewed and changed.
  const showSnowflakeSource = audience.source === "snowflake";

  const handleCsvFile = async (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      toast.error(t("workspace.surveys.invitations.csv_too_large"));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.error(t("workspace.surveys.invitations.csv_unreadable"));
      return;
    }
    // Excel's "CSV UTF-8" starts with a byte-order mark that would corrupt the first email.
    const parsed = csvToRecipients(text.replace(/^\uFEFF/, ""));
    if (parsed.length === 0) {
      toast.error(t("workspace.surveys.invitations.csv_no_valid_emails"));
      return;
    }
    const existing = audience.source === "manualList" ? audience.recipients : [];
    const { merged, added, updated } = mergeRecipients(existing, parsed);
    setManualListRaw(recipientsToText(merged));
    updateAudience({ source: "manualList", recipients: merged });
    toast.success(t("workspace.surveys.invitations.csv_imported", { added, updated }));
  };

  // Returns the canonical config, or null after telling the user what is missing.
  const validatedConfig = (): TSurveyInvitationConfig | null => {
    const result = validateDraft(draft);
    if (result.ok) return result.config;
    toast.error(t("workspace.surveys.invitations.config_incomplete", { detail: result.message }));
    return null;
  };

  const save = async () => {
    const config = validatedConfig();
    if (!config) return;
    setBusy("save");
    const res = await saveInvitationConfigAction({ surveyId, config });
    setBusy(null);
    if (res?.data) {
      setIsDirty(false);
      toast.success(t("workspace.surveys.invitations.saved"));
    } else {
      toast.error(getFormattedErrorMessage(res) || t("workspace.surveys.invitations.save_failed"));
    }
  };

  const sendNow = async () => {
    const config = validatedConfig();
    if (!config) return;
    setBusy("send");
    const res = await sendInvitationsAction({ surveyId, config });
    setBusy(null);
    if (!res?.data) {
      toast.error(getFormattedErrorMessage(res) || t("workspace.surveys.invitations.send_failed"));
      return;
    }
    // The action saves the config it sent.
    setIsDirty(false);
    const { enqueued, alreadySent } = res.data;
    if (enqueued > 0) {
      toast.success(t("workspace.surveys.invitations.send_queued", { enqueued, alreadySent }));
    } else if (alreadySent > 0) {
      toast.success(t("workspace.surveys.invitations.send_nothing_new", { alreadySent }));
    } else {
      toast.success(t("workspace.surveys.invitations.send_no_recipients"));
    }
    await refreshInvitations();
  };

  const remindNow = async () => {
    const config = validatedConfig();
    if (!config) return;
    setBusy("remind");
    const res = await sendRemindersAction({ surveyId, config });
    setBusy(null);
    if (!res?.data) {
      toast.error(getFormattedErrorMessage(res) || t("workspace.surveys.invitations.remind_failed"));
      return;
    }
    setIsDirty(false);
    toast.success(
      t("workspace.surveys.invitations.reminders_sent", { sent: res.data.sent, failed: res.data.failed })
    );
    await refreshInvitations();
  };

  const changeSource = (source: TInvitationAudienceDraft["source"]) => {
    if (source === "segment") updateAudience({ source: "segment", segmentId: "" });
    else if (source === "snowflake")
      updateAudience({ source: "snowflake", queryId: "", emailColumn: "email" });
    else {
      updateAudience({ source: "manualList", recipients: [] });
      setManualListRaw("");
    }
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
            <MailsIcon className="h-7 w-7 rounded-full border border-slate-300 bg-slate-100 p-1.5 text-slate-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-800">{t("workspace.surveys.invitations.card_title")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("workspace.surveys.invitations.card_description")}
            </p>
          </div>
        </div>
      </Collapsible.CollapsibleTrigger>
      <Collapsible.CollapsibleContent className="flex flex-col">
        <hr className="py-1 text-slate-600" />
        {loaded ? (
          // Locked while a save, send or remind is in flight, so an edit made then cannot be marked
          // saved by the response.
          <fieldset disabled={busy !== null} className="space-y-6 p-4">
            {summary && summary.total > 0 && (
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat label={t("workspace.surveys.invitations.stat_invited")} value={summary.total} />
                <Stat label={t("workspace.surveys.invitations.status_sent")} value={summary.sent} />
                <Stat label={t("workspace.surveys.invitations.status_responded")} value={summary.responded} />
                <Stat label={t("workspace.surveys.invitations.status_pending")} value={summary.pending} />
              </div>
            )}

            {invitationRows.length > 0 && (
              <section className="space-y-2">
                <Label>{t("workspace.surveys.invitations.invitees")}</Label>
                <RecipientListTable rows={invitationRows} />
              </section>
            )}

            <section className="space-y-2">
              <Label htmlFor="invitationAudienceSource">
                {t("workspace.surveys.invitations.audience_source")}
              </Label>
              <Select
                value={audience.source}
                onValueChange={(value) => changeSource(value as TInvitationAudienceDraft["source"])}>
                <SelectTrigger id="invitationAudienceSource">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manualList">
                    {t("workspace.surveys.invitations.source_manual")}
                  </SelectItem>
                  {showSegmentSource && (
                    <SelectItem value="segment">
                      {t("workspace.surveys.invitations.source_segment")}
                    </SelectItem>
                  )}
                  {showSnowflakeSource && (
                    <SelectItem value="snowflake">
                      {t("workspace.surveys.invitations.source_snowflake")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>

              {audience.source === "segment" && (
                <Select
                  value={audience.segmentId}
                  onValueChange={(segmentId) => updateAudience({ source: "segment", segmentId })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("workspace.surveys.invitations.choose_segment")} />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((segment) => (
                      <SelectItem key={segment.id} value={segment.id}>
                        {segment.title || segment.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {audience.source === "manualList" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="invitationManualList">
                      {t("workspace.surveys.invitations.manual_list_label")}
                    </Label>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleCsvFile(file);
                        // Reset so choosing the same file again fires another change.
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => csvInputRef.current?.click()}>
                      <UploadIcon className="mr-1 h-3 w-3" />
                      {t("workspace.surveys.invitations.upload_csv")}
                    </Button>
                  </div>
                  <textarea
                    id="invitationManualList"
                    className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-sm"
                    value={manualListRaw}
                    onChange={(e) => {
                      setManualListRaw(e.target.value);
                      updateAudience({ source: "manualList", recipients: textToRecipients(e.target.value) });
                    }}
                    placeholder={"alice@example.com\nbob@example.com, Bob\ncarol@example.com, Carol, Smith"}
                  />
                  <p className="text-xs text-slate-500">
                    {t("workspace.surveys.invitations.manual_list_help", {
                      count: audience.recipients.length,
                    })}
                  </p>
                </div>
              )}

              {audience.source === "snowflake" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    {t("workspace.surveys.invitations.snowflake_no_parameters")}
                  </p>
                  <LabeledInput
                    id="invitationQueryId"
                    label={t("workspace.surveys.invitations.snowflake_query_id")}
                    value={audience.queryId}
                    placeholder="active-members"
                    onChange={(value) => updateAudience({ ...audience, queryId: value.trim() })}
                  />
                  <LabeledInput
                    id="invitationEmailColumn"
                    label={t("workspace.surveys.invitations.snowflake_email_column")}
                    value={audience.emailColumn}
                    onChange={(value) => updateAudience({ ...audience, emailColumn: value.trim() })}
                  />
                  <LabeledInput
                    id="invitationNameColumn"
                    label={t("workspace.surveys.invitations.snowflake_name_column")}
                    value={audience.nameColumn ?? ""}
                    onChange={(value) =>
                      updateAudience({ ...audience, nameColumn: value.trim() || undefined })
                    }
                  />
                </div>
              )}
            </section>

            <section className="space-y-2">
              <LabeledInput
                id="invitationFromName"
                label={t("workspace.surveys.invitations.from_name")}
                value={draft.fromName ?? ""}
                placeholder={t("workspace.surveys.invitations.from_name_placeholder")}
                onChange={(value) => updateDraft({ fromName: value })}
              />
              <p className="text-xs text-slate-500">{t("workspace.surveys.invitations.from_name_help")}</p>
            </section>

            <EmailTemplateFields
              title={t("workspace.surveys.invitations.invitation_email")}
              template={draft.emailTemplates.invitation}
              onChange={(patch) => updateTemplate("invitation", patch)}
            />

            <section className="space-y-2">
              <Label>{t("workspace.surveys.invitations.scheduled_reminders")}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="invitationReminderScheduleEnabled"
                  type="checkbox"
                  checked={draft.reminderSchedule.enabled}
                  onChange={(e) =>
                    updateDraft({
                      reminderSchedule: { ...draft.reminderSchedule, enabled: e.target.checked },
                    })
                  }
                />
                <label htmlFor="invitationReminderScheduleEnabled" className="text-sm">
                  {t("workspace.surveys.invitations.scheduled_reminders_enable")}
                </label>
              </div>
              {draft.reminderSchedule.enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <ReminderDaysInput
                    days={draft.reminderSchedule.daysAfterInvite}
                    onChange={(daysAfterInvite) =>
                      updateDraft({ reminderSchedule: { ...draft.reminderSchedule, daysAfterInvite } })
                    }
                  />
                  <div>
                    <Label htmlFor="invitationMaxReminders">
                      {t("workspace.surveys.invitations.max_reminders")}
                    </Label>
                    <Input
                      id="invitationMaxReminders"
                      type="number"
                      min={0}
                      max={20}
                      value={draft.reminderSchedule.maxReminders}
                      onChange={(e) =>
                        updateDraft({
                          reminderSchedule: {
                            ...draft.reminderSchedule,
                            maxReminders: clampMaxReminders(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            <EmailTemplateFields
              title={t("workspace.surveys.invitations.reminder_email")}
              template={draft.emailTemplates.reminder}
              onChange={(patch) => updateTemplate("reminder", patch)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!isDirty || busy !== null} onClick={save}>
                <SaveIcon className="mr-2 h-4 w-4" />
                {busy === "save" ? t("common.saving") : t("common.save")}
              </Button>
              <Button disabled={!audienceComplete || busy !== null} onClick={sendNow}>
                <SendIcon className="mr-2 h-4 w-4" />
                {busy === "send"
                  ? t("workspace.surveys.invitations.sending")
                  : t("workspace.surveys.invitations.send_invitations")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null || !summary || summary.pending === 0}
                onClick={remindNow}>
                {busy === "remind"
                  ? t("workspace.surveys.invitations.reminding")
                  : t("workspace.surveys.invitations.send_reminders")}
              </Button>
              <p className="text-xs text-slate-500">
                {isDirty
                  ? t("workspace.surveys.invitations.unsaved_changes")
                  : t("workspace.surveys.invitations.saves_separately")}
              </p>
            </div>
          </fieldset>
        ) : (
          <div className="flex items-center gap-3 p-4 text-sm text-slate-500">
            {loadError ? (
              <>
                <span role="alert">{loadError}</span>
                <Button variant="secondary" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>
                  {t("common.try_again")}
                </Button>
              </>
            ) : (
              t("common.loading")
            )}
          </div>
        )}
      </Collapsible.CollapsibleContent>
    </Collapsible.Root>
  );
};

const Stat = ({ label, value }: Readonly<{ label: string; value: number }>) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
    <div className="text-xl font-semibold text-slate-800">{value}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </div>
);

const LabeledInput = ({
  id,
  label,
  value,
  placeholder,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}>) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </div>
);

// Holds the typed text so "3, " can be typed on the way to "3, 7"; the parsed days go up on each change.
const ReminderDaysInput = ({
  days,
  onChange,
}: Readonly<{ days: number[]; onChange: (days: number[]) => void }>) => {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(() => days.join(", "));
  return (
    <div>
      <Label htmlFor="invitationReminderDays">{t("workspace.surveys.invitations.reminder_days")}</Label>
      <Input
        id="invitationReminderDays"
        value={raw}
        placeholder="3, 7, 14"
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(parseReminderDays(e.target.value));
        }}
      />
    </div>
  );
};

const EmailTemplateFields = ({
  title,
  template,
  onChange,
}: Readonly<{ title: string; template: TTemplate; onChange: (patch: Partial<TTemplate>) => void }>) => {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <Label>{title}</Label>
      <Input
        aria-label={t("workspace.surveys.invitations.subject")}
        value={template.subject}
        placeholder={t("workspace.surveys.invitations.subject")}
        onChange={(e) => onChange({ subject: e.target.value })}
      />
      <textarea
        aria-label={t("workspace.surveys.invitations.body")}
        className="min-h-32 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        value={template.body}
        onChange={(e) => onChange({ body: e.target.value })}
      />
      <Input
        aria-label={t("workspace.surveys.invitations.button_text")}
        value={template.buttonLabel ?? ""}
        placeholder={t("workspace.surveys.invitations.button_text_placeholder")}
        onChange={(e) => onChange({ buttonLabel: e.target.value || undefined })}
      />
      <HeadingControl value={template.headingText} onChange={(headingText) => onChange({ headingText })} />
      <p className="text-xs text-slate-500">
        {t("workspace.surveys.invitations.merge_fields")}{" "}
        {MERGE_FIELDS.map((field, i) => (
          <span key={field}>
            {i > 0 ? ", " : ""}
            <code className="rounded bg-slate-100 px-1 py-0.5">{`{{${field}}}`}</code>
          </span>
        ))}
      </p>
    </section>
  );
};

// The mode lives in local state: choosing "custom" before typing stores "", which would otherwise read
// back as "none".
const HeadingControl = ({
  value,
  onChange,
}: Readonly<{ value: string | undefined; onChange: (next: string | undefined) => void }>) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<THeadingMode>(() => deriveHeadingMode(value));
  return (
    <div className="space-y-2">
      <Label>{t("workspace.surveys.invitations.heading")}</Label>
      <Select
        value={mode}
        onValueChange={(next) => {
          setMode(next as THeadingMode);
          onChange(headingTextForMode(next as THeadingMode, value));
        }}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("workspace.surveys.invitations.heading_default")}</SelectItem>
          <SelectItem value="custom">{t("workspace.surveys.invitations.heading_custom")}</SelectItem>
          <SelectItem value="none">{t("workspace.surveys.invitations.heading_none")}</SelectItem>
        </SelectContent>
      </Select>
      {mode === "custom" && (
        <Input
          aria-label={t("workspace.surveys.invitations.heading_custom")}
          value={value ?? ""}
          placeholder={t("workspace.surveys.invitations.heading_custom_placeholder")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
};
