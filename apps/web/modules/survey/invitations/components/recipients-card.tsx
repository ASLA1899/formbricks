"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { MailsIcon, SendIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { TSegment } from "@formbricks/types/segment";
import {
  type TReminderSchedule,
  type TSurvey,
  type TSurveyInvitationConfig,
  ZSurveyInvitationConfig,
} from "@formbricks/types/surveys/types";
import { cn } from "@/lib/cn";
import { getFormattedErrorMessage } from "@/lib/utils/helper";
import { listContactAttributeKeysAction } from "@/modules/contacts/actions";
import {
  type AttributeKeyOption,
  CsvColumnMappingModal,
} from "@/modules/contacts/components/csv-column-mapping-modal";
import {
  type ColumnMappingConfig,
  type ColumnMatch,
  matchColumns,
} from "@/modules/contacts/lib/column-mapping";
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
  getInvitationSummaryAction,
  listSurveyInvitationsAction,
  sendInvitationsAction,
  sendRemindersAction,
} from "../actions";
import {
  DEFAULT_INVITATION_BODY,
  DEFAULT_INVITATION_SUBJECT,
  DEFAULT_REMINDER_BODY,
  DEFAULT_REMINDER_SUBJECT,
  MERGE_FIELDS,
  type TInvitationRow,
  type TInvitationSummary,
} from "../types/invitation";
import { RecipientListTable } from "./recipient-list-table";

// Loose draft type for the editor state. The canonical `TSurveyInvitationConfig`
// requires a valid cuid2 segmentId and other non-empty fields, which the form
// only has once the user fills it in. We validate on send rather than forcing
// the editor to hold only canonical values (which would require `null`
// placeholders that complicate every render).
//
// Tier 2 (Task 10): `attributes` carries arbitrary CSV-mapped attributes through
// to the server, where ensureContact persists them on Contact create. `source`
// distinguishes CSV-uploaded recipients (vs. typed-into-textarea = "manual")
// so ContactSync's "preserve manual contacts" behavior knows which rows came
// from this side of the boundary.
type TManualRecipient = {
  email: string;
  firstName?: string;
  lastName?: string;
  externalId?: string;
  attributes?: { attributeKeyId: string; value: string }[];
  source?: "manual" | "csv";
};

type TInvitationAudienceDraft =
  | { source: "segment"; segmentId: string }
  | { source: "snowflake"; queryId: string; emailColumn: string; nameColumn?: string }
  | { source: "manualList"; recipients: TManualRecipient[] };

interface TInvitationConfigDraft {
  audience: TInvitationAudienceDraft;
  reminderSchedule: TReminderSchedule;
  emailTemplates: TSurveyInvitationConfig["emailTemplates"];
}

interface RecipientsCardProps {
  localSurvey: TSurvey;
  setLocalSurvey: (survey: TSurvey) => void;
  segments: TSegment[];
}

// Minimal RFC-4180-ish CSV parser. Handles quoted fields (with embedded commas
// and "" escapes), and both \n and \r\n line endings. We avoid a library dep
// because the input is small (invitation lists, not data warehouses).
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
};

// Detect whether the first row looks like a header — i.e. contains at least
// one cell that we recognize as a column name. We rely on `matchColumns` from
// the shared module to do the actual mapping, but the header-vs-data decision
// is local: a CSV with no header row should still be importable (positional
// email/firstName/lastName fallback for the legacy 3-column format).
const looksLikeHeaderRow = (firstRow: string[], attributeKeys: AttributeKeyOption[]): boolean => {
  const matches = matchColumns(firstRow, attributeKeys);
  return matches.some((m) => m.kind === "typed" || m.kind === "attribute");
};

// Project CSV rows + a resolved column mapping into TManualRecipient shape.
// Headers in the mapping that resolve to `skip` are ignored; attribute mappings
// produce entries in `attributes`; typed mappings populate the corresponding
// top-level field.
//
// Each row is filtered out unless it has an email — invitations need an
// address; everything else (firstName, externalId, attributes) is optional.
const projectRowsToRecipients = (
  rows: string[][],
  headers: string[],
  mapping: ColumnMappingConfig
): TManualRecipient[] => {
  const result: TManualRecipient[] = [];
  for (const cols of rows) {
    const recipient: TManualRecipient = { email: "", source: "csv" };
    const attributes: { attributeKeyId: string; value: string }[] = [];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const dest = mapping[header];
      if (!dest || dest.kind === "skip") continue;
      const raw = (cols[i] ?? "").trim();
      if (!raw) continue;

      if (dest.kind === "typed") {
        if (dest.column === "email") recipient.email = raw;
        else if (dest.column === "externalId") recipient.externalId = raw;
        else if (dest.column === "firstName") recipient.firstName = raw;
        else if (dest.column === "lastName") recipient.lastName = raw;
      } else if (dest.kind === "attribute") {
        attributes.push({ attributeKeyId: dest.attributeKeyId, value: raw });
      }
    }

    if (attributes.length > 0) recipient.attributes = attributes;
    if (/.+@.+\..+/.test(recipient.email)) result.push(recipient);
  }
  return result;
};

// Build a mapping from auto-detected matches that can be used directly
// (modal skipped). firstName/lastName auto-detect handles route-via-attribute
// when a key exists; otherwise that header lands as `unmapped` and the operator
// has to confirm in the modal.
const matchesToAutoMapping = (matches: ColumnMatch[]): ColumnMappingConfig => {
  const out: ColumnMappingConfig = {};
  for (const m of matches) {
    if (m.kind === "typed") {
      out[m.sourceHeader] = { kind: "typed", column: m.column };
    } else if (m.kind === "attribute") {
      out[m.sourceHeader] = { kind: "attribute", attributeKeyId: m.attributeKeyId };
    } else {
      out[m.sourceHeader] = { kind: "skip" };
    }
  }
  return out;
};

const recipientsToTextarea = (recipients: TManualRecipient[]): string =>
  recipients
    .map((r) => [r.email, r.firstName ?? "", r.lastName ?? ""].join(", ").replace(/(,\s*)+$/, ""))
    .join("\n");

const emptyDraft: TInvitationConfigDraft = {
  audience: { source: "segment", segmentId: "" },
  reminderSchedule: { enabled: false, daysAfterInvite: [3, 7], maxReminders: 2 },
  emailTemplates: {
    invitation: { subject: DEFAULT_INVITATION_SUBJECT, body: DEFAULT_INVITATION_BODY },
    reminder: { subject: DEFAULT_REMINDER_SUBJECT, body: DEFAULT_REMINDER_BODY },
  },
};

export const RecipientsCard = ({ localSurvey, setLocalSurvey, segments }: RecipientsCardProps) => {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<TInvitationSummary | null>(null);
  const [invitationRows, setInvitationRows] = useState<TInvitationRow[] | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isReminding, setIsReminding] = useState(false);

  // Draft state lives separately from the survey object. We only mirror a
  // *validated* config into `localSurvey.invitationConfig` (or null if the
  // draft is incomplete), so an in-progress edit can't cause an otherwise-valid
  // survey save to fail Zod on the whole survey.
  const [draft, setDraft] = useState<TInvitationConfigDraft>(() => {
    const existing = localSurvey.invitationConfig as TInvitationConfigDraft | null | undefined;
    return existing ?? emptyDraft;
  });

  // Raw textarea content for manualList. Kept separately so partial lines
  // (e.g. "it@") while the user is mid-typing aren't filtered out of view.
  // We re-parse to `recipients` on every change, but the textarea renders
  // from this raw string so every keystroke is preserved.
  const [manualListRaw, setManualListRaw] = useState<string>(() => {
    const existing = localSurvey.invitationConfig as TInvitationConfigDraft | null | undefined;
    if (existing?.audience.source !== "manualList") return "";
    return recipientsToTextarea(existing.audience.recipients);
  });

  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // Loaded lazily on first CSV upload — the recipients-card lives in the
  // survey editor where most users never touch CSV import, so we don't
  // pre-fetch on mount. `null` means "not loaded yet"; `[]` is a valid empty.
  const [attributeKeys, setAttributeKeys] = useState<AttributeKeyOption[] | null>(null);

  // CSV-import state machine. While `pendingCsv` is set we show the column-
  // mapping modal; on confirm we apply the mapping and clear it.
  const [pendingCsv, setPendingCsv] = useState<{
    headers: string[];
    rows: string[][];
    matches: ColumnMatch[];
  } | null>(null);

  const ensureAttributeKeys = async (): Promise<AttributeKeyOption[]> => {
    if (attributeKeys) return attributeKeys;
    try {
      const res = await listContactAttributeKeysAction({ environmentId: localSurvey.environmentId });
      const keys = res?.data ?? [];
      setAttributeKeys(keys);
      return keys;
    } catch {
      // Fall through with empty list — the matcher still works against
      // built-in typed aliases, just without attribute auto-detect.
      setAttributeKeys([]);
      return [];
    }
  };

  // Apply a finalized column mapping to the staged CSV rows: produce
  // TManualRecipient[], merge with any existing typed-into-textarea recipients,
  // and update state + textarea preview.
  const applyCsvMapping = (
    headers: string[],
    rows: string[][],
    mapping: ColumnMappingConfig
  ) => {
    const parsed = projectRowsToRecipients(rows, headers, mapping);
    if (parsed.length === 0) {
      toast.error("No valid emails found in CSV");
      return;
    }
    // Merge with whatever is already in the textarea, dedupe by email
    // (case-insensitive). For overlapping rows we shallow-merge: CSV-supplied
    // fields win, but EMPTY CSV fields don't clobber existing typed values
    // (e.g. uploading a CSV without firstName shouldn't erase a manually-typed
    // firstName). Attributes are concatenated and deduped by attributeKeyId
    // with the CSV value winning on collision.
    const existing = audience.source === "manualList" ? audience.recipients : [];
    const existingEmails = new Set(existing.map((r) => r.email.toLowerCase()));
    const byEmail = new Map<string, TManualRecipient>();
    for (const r of existing) byEmail.set(r.email.toLowerCase(), r);
    for (const r of parsed) {
      const key = r.email.toLowerCase();
      const prev = byEmail.get(key);
      if (!prev) {
        byEmail.set(key, r);
        continue;
      }
      // Build the merged attributes list: existing first, then CSV overrides.
      const attrMap = new Map<string, { attributeKeyId: string; value: string }>();
      for (const a of prev.attributes ?? []) attrMap.set(a.attributeKeyId, a);
      for (const a of r.attributes ?? []) attrMap.set(a.attributeKeyId, a);
      const mergedAttrs = Array.from(attrMap.values());
      byEmail.set(key, {
        email: r.email,
        firstName: r.firstName || prev.firstName,
        lastName: r.lastName || prev.lastName,
        externalId: r.externalId || prev.externalId,
        source: r.source ?? prev.source,
        attributes: mergedAttrs.length > 0 ? mergedAttrs : undefined,
      });
    }
    const merged = Array.from(byEmail.values());
    const added = parsed.filter((r) => !existingEmails.has(r.email.toLowerCase())).length;
    const updated = parsed.length - added;

    setManualListRaw(recipientsToTextarea(merged));
    updateAudience({ source: "manualList", recipients: merged });
    toast.success(
      updated > 0
        ? `Imported ${parsed.length} from CSV (${added} new, ${updated} updated)`
        : `Imported ${added} recipient${added === 1 ? "" : "s"} from CSV`
    );
  };

  const handleCsvFile = async (file: File) => {
    if (file.size > 512 * 1024) {
      toast.error("CSV must be under 512 KB");
      return;
    }
    try {
      // Strip UTF-8 BOM (Excel "Save As CSV UTF-8" prepends U+FEFF, which
      // would otherwise corrupt the first email and silently drop the row).
      const text = (await file.text()).replace(/^﻿/, "");
      const allRows = parseCsv(text);
      if (allRows.length === 0) {
        toast.error("CSV is empty");
        return;
      }

      // Fetch attribute keys lazily — needed both for the auto-detect and for
      // the modal's dropdown options.
      const keys = await ensureAttributeKeys();

      // Decide whether the first row is a header. If not, fall back to the
      // legacy positional layout (email, firstName, lastName) and use
      // synthetic header names so the rest of the pipeline can stay uniform.
      const firstRow = allRows[0];
      const isHeader = looksLikeHeaderRow(firstRow, keys);

      let headers: string[];
      let rows: string[][];
      if (isHeader) {
        headers = firstRow;
        rows = allRows.slice(1);
      } else {
        // Synthesize headers using the canonical aliases the matcher knows
        // about — auto-detect will pick up `email`/`firstName`/`lastName` and
        // route them to the right typed/attribute targets without prompting.
        const synth = ["email", "firstName", "lastName"];
        headers = firstRow.map((_, i) => synth[i] ?? `col${i + 1}`);
        rows = allRows;
      }

      const matches = matchColumns(headers, keys);

      // Auto-skip the modal when the auto-detect is unambiguous:
      //   - At least one column maps to typed:email (we have to be able to
      //     invite somebody) — required.
      //   - Every other column is either typed (email/externalId), attribute,
      //     OR a firstName/lastName that landed `unmapped` because no
      //     attribute key exists. We treat first/last unmapped as "fine, we
      //     just won't persist them as attributes" — preserves the legacy
      //     3-column UX.
      const hasEmail = matches.some((m) => m.kind === "typed" && m.column === "email");
      const allClean = matches.every((m) => {
        if (m.kind === "typed" || m.kind === "attribute") return true;
        // Unmapped is OK iff the source header is firstName/lastName — those
        // are the "soft" auto-detect cases the matcher emits when no
        // attribute key exists. Any other unmapped column means the operator
        // has columns we don't recognize and should explicitly map.
        const normalized = m.sourceHeader.toLowerCase().replace(/[^a-z0-9]/g, "");
        return ["firstname", "first", "givenname", "fname", "lastname", "last", "surname", "lname"].includes(
          normalized
        );
      });

      if (hasEmail && allClean) {
        applyCsvMapping(headers, rows, matchesToAutoMapping(matches));
        return;
      }

      // Otherwise stage for the modal. The user must confirm/override.
      setPendingCsv({ headers, rows, matches });
    } catch (e) {
      // Log so a real bug (encoding / parser exception) is visible in
      // production via the user's devtools — the toast alone is opaque.
      console.error("CSV read/parse failed", e);
      toast.error("Could not read CSV file");
    }
  };

  useEffect(() => {
    if (!open) return;
    getInvitationSummaryAction({ surveyId: localSurvey.id })
      .then((res) => {
        if (res?.data) setSummary(res.data);
      })
      .catch(() => {
        /* first-run before save: no invitations yet — ignore */
      });
    listSurveyInvitationsAction({ surveyId: localSurvey.id })
      .then((res) => {
        if (res?.data) setInvitationRows(res.data);
      })
      .catch(() => {
        /* first-run: ignore — table just stays empty */
      });
  }, [open, localSurvey.id]);

  // Refresh both summary and invitee list. Used after manual sends/reminders so
  // the user sees the new state without a page reload.
  const refreshInvitations = async () => {
    const [nextSummary, nextRows] = await Promise.all([
      getInvitationSummaryAction({ surveyId: localSurvey.id }).catch(() => null),
      listSurveyInvitationsAction({ surveyId: localSurvey.id }).catch(() => null),
    ]);
    if (nextSummary?.data) setSummary(nextSummary.data);
    if (nextRows?.data) setInvitationRows(nextRows.data);
  };

  const mirrorToSurvey = (nextDraft: TInvitationConfigDraft) => {
    const parsed = ZSurveyInvitationConfig.safeParse(nextDraft);
    setLocalSurvey({
      ...localSurvey,
      invitationConfig: parsed.success ? parsed.data : null,
    });
  };

  const updateConfig = (patch: Partial<TInvitationConfigDraft>) => {
    const next: TInvitationConfigDraft = { ...draft, ...patch };
    setDraft(next);
    mirrorToSurvey(next);
  };

  const updateAudience = (audience: TInvitationAudienceDraft) => updateConfig({ audience });
  const updateTemplates = (templates: TSurveyInvitationConfig["emailTemplates"]) =>
    updateConfig({ emailTemplates: templates });

  const config = draft;
  const audience = draft.audience;

  const audienceIsValid =
    (audience.source === "segment" && Boolean(audience.segmentId)) ||
    (audience.source === "snowflake" && Boolean(audience.queryId && audience.emailColumn)) ||
    (audience.source === "manualList" && audience.recipients.length > 0);

  // Build a canonical, validated config for server dispatch. Returns null (and
  // shows a toast) if the draft fails schema validation — this is a belt-and-
  // braces check on top of `audienceIsValid`.
  const toValidatedConfig = (): TSurveyInvitationConfig | null => {
    const parsed = ZSurveyInvitationConfig.safeParse(draft);
    if (parsed.success) return parsed.data;
    toast.error(`Invitation config is incomplete: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return null;
  };

  const sendNow = async () => {
    if (!audienceIsValid) {
      toast.error("Pick a segment or configure a Snowflake query first");
      return;
    }
    const validated = toValidatedConfig();
    if (!validated) return;

    setIsSending(true);
    const res = await sendInvitationsAction({ surveyId: localSurvey.id, config: validated });
    setIsSending(false);
    if (res?.data) {
      const { enqueued, alreadySent } = res.data;
      if (enqueued > 0) {
        toast.success(
          `Queued ${enqueued} invitation${enqueued === 1 ? "" : "s"}` +
            (alreadySent ? ` (${alreadySent} already sent)` : "") +
            ` — sending in background`
        );
      } else if (alreadySent > 0) {
        toast.success(`No new recipients — ${alreadySent} already sent`);
      } else {
        toast.success("No recipients found in audience");
      }
      await refreshInvitations();
    } else {
      toast.error(getFormattedErrorMessage(res) || "Failed to send invitations");
    }
  };

  const remindNow = async () => {
    const validated = toValidatedConfig();
    if (!validated) return;
    setIsReminding(true);
    const res = await sendRemindersAction({ surveyId: localSurvey.id, config: validated });
    setIsReminding(false);
    if (res?.data) {
      toast.success(`Reminded ${res.data.sent} (${res.data.failed} failed)`);
      await refreshInvitations();
    } else {
      toast.error(getFormattedErrorMessage(res) || "Failed to send reminders");
    }
  };

  return (
    <>
      {pendingCsv && (
        <CsvColumnMappingModal
          headers={pendingCsv.headers}
          initialMatches={pendingCsv.matches}
          attributeKeys={attributeKeys ?? []}
          onConfirm={(mapping) => {
            applyCsvMapping(pendingCsv.headers, pendingCsv.rows, mapping);
            setPendingCsv(null);
          }}
          onCancel={() => setPendingCsv(null)}
        />
      )}
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
            <p className="font-semibold text-slate-800">Recipients & reminders</p>
            <p className="mt-1 text-sm text-slate-500">Invite a list of people and chase non-responders.</p>
          </div>
        </div>
      </Collapsible.CollapsibleTrigger>
      <Collapsible.CollapsibleContent className="flex flex-col">
        <hr className="py-1 text-slate-600" />
        <div className="space-y-6 p-4">
          {summary && (
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Invited" value={summary.total} />
              <Stat label="Sent" value={summary.sent} />
              <Stat label="Responded" value={summary.responded} />
              <Stat label="Pending" value={summary.pending} />
            </div>
          )}

          {invitationRows && invitationRows.length > 0 && (
            <section className="space-y-2">
              <Label>Invitees</Label>
              <RecipientListTable rows={invitationRows} />
            </section>
          )}

          <section className="space-y-2">
            <Label>Audience source</Label>
            <Select
              value={audience.source}
              onValueChange={(value: "segment" | "snowflake" | "manualList") => {
                if (value === "segment") {
                  updateAudience({ source: "segment", segmentId: "" });
                } else if (value === "snowflake") {
                  updateAudience({ source: "snowflake", queryId: "", emailColumn: "email" });
                } else {
                  updateAudience({ source: "manualList", recipients: [] });
                  setManualListRaw("");
                }
              }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manualList">Manual email list</SelectItem>
                <SelectItem value="segment">Formbricks segment</SelectItem>
                <SelectItem value="snowflake">Snowflake query</SelectItem>
              </SelectContent>
            </Select>

            {audience.source === "segment" && (
              <Select
                value={audience.segmentId || ""}
                onValueChange={(segmentId) => updateAudience({ source: "segment", segmentId })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a segment…" />
                </SelectTrigger>
                <SelectContent>
                  {segments.length === 0 ? (
                    <div className="p-2 text-sm text-slate-500">
                      No segments yet — create one under Contacts.
                    </div>
                  ) : (
                    segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title || s.id}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}

            {audience.source === "manualList" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="manualEmails">Recipients (email, first name, last name)</Label>
                  <div>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCsvFile(file);
                        // Reset so selecting the same file again re-triggers change.
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => csvInputRef.current?.click()}>
                      <UploadIcon className="mr-1 h-3 w-3" />
                      Upload CSV
                    </Button>
                  </div>
                </div>
                <textarea
                  id="manualEmails"
                  className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-sm"
                  value={manualListRaw}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setManualListRaw(raw);
                    // Parse only the lines that look like valid emails.
                    // Partial/in-progress lines stay in the textarea via the
                    // raw-string state above, but they don't get stored as
                    // recipients until they parse cleanly.
                    const recipients: TManualRecipient[] = raw
                      .split(/\n/)
                      .map((line) => {
                        const parts = line.split(",").map((s) => s.trim());
                        const email = parts[0] ?? "";
                        const firstName = parts[1] || undefined;
                        const lastName = parts[2] || undefined;
                        return { email, firstName, lastName };
                      })
                      .filter((r) => /.+@.+\..+/.test(r.email));
                    updateAudience({ source: "manualList", recipients });
                  }}
                  placeholder={"alice@example.com\nbob@example.com, Bob\ncarol@example.com, Carol, Smith"}
                />
                <p className="text-xs text-slate-500">
                  Type one recipient per line (<code>email, firstName, lastName</code>) or upload a CSV with
                  columns like <code>email, firstName, lastName</code> (header row optional; column order
                  auto-detected). {audience.recipients.length} valid recipient
                  {audience.recipients.length === 1 ? "" : "s"}.
                </p>
              </div>
            )}

            {audience.source === "snowflake" && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">
                  The query must accept <strong>no parameters</strong> — it should return all recipients in a
                  single call. Parameterized queries are not yet supported.
                </p>
                <div>
                  <Label htmlFor="queryId">Query ID</Label>
                  <Input
                    id="queryId"
                    value={audience.queryId}
                    onChange={(e) => updateAudience({ ...audience, queryId: e.target.value.trim() })}
                    placeholder="e.g. active-members"
                  />
                </div>
                <div>
                  <Label htmlFor="emailColumn">Email column</Label>
                  <Input
                    id="emailColumn"
                    value={audience.emailColumn}
                    onChange={(e) => updateAudience({ ...audience, emailColumn: e.target.value.trim() })}
                  />
                </div>
                <div>
                  <Label htmlFor="nameColumn">Name column (optional)</Label>
                  <Input
                    id="nameColumn"
                    value={audience.nameColumn ?? ""}
                    onChange={(e) =>
                      updateAudience({
                        ...audience,
                        nameColumn: e.target.value.trim() || undefined,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label>Invitation email</Label>
            <Input
              value={config.emailTemplates.invitation.subject}
              onChange={(e) =>
                updateTemplates({
                  ...config.emailTemplates,
                  invitation: { ...config.emailTemplates.invitation, subject: e.target.value },
                })
              }
              placeholder="Subject"
            />
            <textarea
              className="min-h-32 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
              value={config.emailTemplates.invitation.body}
              onChange={(e) =>
                updateTemplates({
                  ...config.emailTemplates,
                  invitation: { ...config.emailTemplates.invitation, body: e.target.value },
                })
              }
            />
            <MergeFieldHints />
          </section>

          <section className="space-y-2">
            <Label>Scheduled reminders</Label>
            <div className="flex items-center gap-2">
              <input
                id="reminderScheduleEnabled"
                type="checkbox"
                checked={config.reminderSchedule.enabled}
                onChange={(e) =>
                  updateConfig({
                    reminderSchedule: { ...config.reminderSchedule, enabled: e.target.checked },
                  })
                }
              />
              <label htmlFor="reminderScheduleEnabled" className="text-sm">
                Auto-send reminders on a schedule (requires cron)
              </label>
            </div>
            {config.reminderSchedule.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="daysAfter">Days after invite (comma-separated)</Label>
                  <Input
                    id="daysAfter"
                    value={config.reminderSchedule.daysAfterInvite.join(", ")}
                    onChange={(e) => {
                      const parsed = e.target.value
                        .split(",")
                        .map((s) => parseInt(s.trim(), 10))
                        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
                      updateConfig({
                        reminderSchedule: {
                          ...config.reminderSchedule,
                          daysAfterInvite: parsed,
                        },
                      });
                    }}
                    placeholder="3, 7, 14"
                  />
                </div>
                <div>
                  <Label htmlFor="maxReminders">Max reminders per person</Label>
                  <Input
                    id="maxReminders"
                    type="number"
                    min={0}
                    max={20}
                    value={config.reminderSchedule.maxReminders}
                    onChange={(e) =>
                      updateConfig({
                        reminderSchedule: {
                          ...config.reminderSchedule,
                          maxReminders: Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)),
                        },
                      })
                    }
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label>Reminder email (used by manual & scheduled reminders)</Label>
            <Input
              value={config.emailTemplates.reminder.subject}
              onChange={(e) =>
                updateTemplates({
                  ...config.emailTemplates,
                  reminder: { ...config.emailTemplates.reminder, subject: e.target.value },
                })
              }
              placeholder="Subject"
            />
            <textarea
              className="min-h-32 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
              value={config.emailTemplates.reminder.body}
              onChange={(e) =>
                updateTemplates({
                  ...config.emailTemplates,
                  reminder: { ...config.emailTemplates.reminder, body: e.target.value },
                })
              }
            />
          </section>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!audienceIsValid || isSending} onClick={sendNow}>
              <SendIcon className="mr-2 h-4 w-4" />
              {isSending ? "Sending…" : "Send invitations"}
            </Button>
            <Button
              variant="secondary"
              disabled={isReminding || !summary || summary.pending === 0}
              onClick={remindNow}>
              {isReminding ? "Reminding…" : "Send reminders to non-responders"}
            </Button>
            <p className="self-center text-xs text-slate-500">
              Save the survey first so config changes are persisted before sending.
            </p>
          </div>
        </div>
        </Collapsible.CollapsibleContent>
      </Collapsible.Root>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
    <div className="text-xl font-semibold text-slate-800">{value}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </div>
);

const MergeFieldHints = () => (
  <p className="text-xs text-slate-500">
    Available merge fields:{" "}
    {MERGE_FIELDS.map((f, i) => (
      <span key={f}>
        {i > 0 ? ", " : ""}
        <code className="rounded bg-slate-100 px-1 py-0.5">{`{{${f}}}`}</code>
      </span>
    ))}
  </p>
);
