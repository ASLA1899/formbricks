import {
  type TReminderSchedule,
  type TSurveyInvitationConfig,
  ZSurveyInvitationConfig,
} from "@formbricks/types/surveys/types";
import {
  DEFAULT_INVITATION_BODY,
  DEFAULT_INVITATION_SUBJECT,
  DEFAULT_REMINDER_BODY,
  DEFAULT_REMINDER_SUBJECT,
} from "../types/invitation";
import type { TManualRecipient } from "./recipient-import";

// Editor-side draft of a survey's invitation config. The canonical TSurveyInvitationConfig needs a
// valid segment id, at least one recipient and non-empty subjects, which the form only has once the
// user fills it in, so the editor holds this looser shape and validates on save or send.
export type TInvitationAudienceDraft =
  | { source: "segment"; segmentId: string }
  | { source: "snowflake"; queryId: string; emailColumn: string; nameColumn?: string }
  | { source: "manualList"; recipients: TManualRecipient[] };

export interface TInvitationConfigDraft {
  audience: TInvitationAudienceDraft;
  reminderSchedule: TReminderSchedule;
  emailTemplates: TSurveyInvitationConfig["emailTemplates"];
  fromName?: string;
}

// A manual list is the default audience: segments need the Contacts feature, which this fork does
// not ship, and Snowflake needs a saved query.
export const createEmptyDraft = (): TInvitationConfigDraft => ({
  audience: { source: "manualList", recipients: [] },
  reminderSchedule: { enabled: false, daysAfterInvite: [3, 7], maxReminders: 2 },
  emailTemplates: {
    invitation: { subject: DEFAULT_INVITATION_SUBJECT, body: DEFAULT_INVITATION_BODY },
    reminder: { subject: DEFAULT_REMINDER_SUBJECT, body: DEFAULT_REMINDER_BODY },
  },
});

export const isAudienceComplete = (audience: TInvitationAudienceDraft): boolean => {
  if (audience.source === "segment") return audience.segmentId !== "";
  if (audience.source === "snowflake") return audience.queryId !== "" && audience.emailColumn !== "";
  return audience.recipients.length > 0;
};

export type TDraftValidation = { ok: true; config: TSurveyInvitationConfig } | { ok: false; message: string };

export const validateDraft = (draft: TInvitationConfigDraft): TDraftValidation => {
  const parsed = ZSurveyInvitationConfig.safeParse(draft);
  if (parsed.success) return { ok: true, config: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, message: `${where}${issue?.message ?? "invalid"}` };
};

// The email heading has three states, stored in one optional field:
//   default → undefined (the template's built-in heading)
//   custom  → the text
//   none    → "" (no heading)
export type THeadingMode = "default" | "custom" | "none";

export const deriveHeadingMode = (headingText: string | undefined): THeadingMode => {
  if (headingText === undefined) return "default";
  if (headingText === "") return "none";
  return "custom";
};

// Switching to "custom" keeps any text already typed; an empty custom heading is stored as "" until
// the user types, which reads back as "none", so the editor keeps the mode in its own state.
export const headingTextForMode = (mode: THeadingMode, current: string | undefined): string | undefined => {
  if (mode === "default") return undefined;
  if (mode === "none") return "";
  return current ?? "";
};

// "3, 7, 14" → [3, 7, 14]. Drops anything that is not a whole number from 0 to 365, the range the
// schedule schema accepts, and repeated days.
export const parseReminderDays = (input: string): number[] => {
  const days = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => n <= 365);
  return [...new Set(days)];
};

export const clampMaxReminders = (input: string): number => {
  const n = Number.parseInt(input, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(20, n));
};
