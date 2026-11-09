import { z } from "zod";

export type TManualRecipient = { email: string; firstName?: string; lastName?: string };

// Same check the saved config uses (ZInvitationAudience), so the count shown in the editor
// matches what the server accepts.
const ZEmail = z.email();
const isValidEmail = (value: string): boolean => ZEmail.safeParse(value).success;

export const MAX_CSV_BYTES = 512 * 1024;

// Minimal RFC-4180 parser: quoted fields with embedded commas, "" escapes and both \n and \r\n
// line endings. No library: invitation lists are small.
export const parseCsv = (text: string): string[][] => {
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

const normalizeHeader = (s: string): string => s.trim().toLowerCase().replaceAll(/[\s_-]/g, "");

const HEADER_ALIASES: Record<"email" | "firstName" | "lastName", string[]> = {
  email: ["email", "e-mail", "emailaddress", "email_address"].map(normalizeHeader),
  firstName: ["firstname", "first_name", "first", "givenname", "given_name", "fname"].map(normalizeHeader),
  lastName: ["lastname", "last_name", "last", "surname", "familyname", "family_name", "lname"].map(
    normalizeHeader
  ),
};

// Parses CSV text into recipients. A header row is detected when any cell in the first row matches
// a known alias; otherwise columns are positional: email, first name, last name. Rows without a
// valid email are dropped.
export const csvToRecipients = (csv: string): TManualRecipient[] => {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const firstRow = rows[0].map(normalizeHeader);
  const looksLikeHeader = firstRow.some((cell) =>
    Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(cell))
  );

  let emailIdx = 0;
  let firstIdx = 1;
  let lastIdx = 2;
  let dataStart = 0;

  if (looksLikeHeader) {
    dataStart = 1;
    const findIdx = (aliases: string[]) => firstRow.findIndex((cell) => aliases.includes(cell));
    emailIdx = findIdx(HEADER_ALIASES.email);
    firstIdx = findIdx(HEADER_ALIASES.firstName);
    lastIdx = findIdx(HEADER_ALIASES.lastName);
    // A header row with no email column has nothing to invite.
    if (emailIdx === -1) return [];
  }

  return rows
    .slice(dataStart)
    .map((cols) => ({
      email: (cols[emailIdx] ?? "").trim(),
      firstName: firstIdx >= 0 ? (cols[firstIdx] ?? "").trim() || undefined : undefined,
      lastName: lastIdx >= 0 ? (cols[lastIdx] ?? "").trim() || undefined : undefined,
    }))
    .filter((r) => isValidEmail(r.email));
};

// One recipient per line: "email, first, last". Lines whose email does not validate yet (the user
// is still typing) are skipped here; the editor keeps the raw text separately.
export const textToRecipients = (text: string): TManualRecipient[] =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      return { email: parts[0] ?? "", firstName: parts[1] || undefined, lastName: parts[2] || undefined };
    })
    .filter((r) => isValidEmail(r.email));

export const recipientsToText = (recipients: TManualRecipient[]): string =>
  recipients
    .map((r) => [r.email, r.firstName ?? "", r.lastName ?? ""].join(", ").replace(/(,\s*)+$/, ""))
    .join("\n");

// Merges an import into the current list. De-duplicates by email (case-insensitive); the import
// wins on the name fields. `added` counts new emails, `updated` counts emails already in the list.
export const mergeRecipients = (
  existing: TManualRecipient[],
  incoming: TManualRecipient[]
): { merged: TManualRecipient[]; added: number; updated: number } => {
  const byEmail = new Map<string, TManualRecipient>();
  for (const r of existing) byEmail.set(r.email.toLowerCase(), r);
  const existingKeys = new Set(byEmail.keys());
  const incomingKeys = new Set<string>();
  for (const r of incoming) {
    const key = r.email.toLowerCase();
    incomingKeys.add(key);
    byEmail.set(key, r);
  }
  let added = 0;
  for (const key of incomingKeys) if (!existingKeys.has(key)) added++;
  return { merged: [...byEmail.values()], added, updated: incomingKeys.size - added };
};
