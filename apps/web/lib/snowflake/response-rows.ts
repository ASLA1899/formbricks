import type { TResponse } from "@formbricks/types/responses";

/** One row of `SURVEY_RESPONSES`: a tall table, one row per answered question, hidden field or attribute. */
export type TSnowflakeResponseRow = {
  RESPONSE_ID: string;
  SURVEY_ID: string;
  SURVEY_NAME: string;
  RECORD_NUMBER: string | null;
  CREATED_AT: string;
  FINISHED: boolean;
  QUESTION_ID: string;
  QUESTION_TEXT: string;
  QUESTION_TYPE: string;
  ANSWER: string;
  LANGUAGE: string | null;
  SOURCE_URL: string | null;
};

/** The survey fields the row builder reads. Narrow on purpose, so the pipeline survey fits as is. */
export type TSnowflakeSurvey = {
  id: string;
  name: string;
  blocks?: { elements: { id: string; type: string; headline?: Record<string, string> }[] }[] | null;
  hiddenFields?: { fieldIds?: string[] | null } | null;
};

const RECORD_NUMBER_KEYS = ["recordnumber", "customerid", "contactid"];

const toText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const findByLowerKey = (source: Record<string, unknown>, key: string): string | null => {
  for (const [name, value] of Object.entries(source)) {
    if (name.toLowerCase() !== key || value == null) continue;
    const text = (typeof value === "string" ? value : String(value)).trim();
    if (text) return text;
  }
  return null;
};

/**
 * RECORD_NUMBER comes from the first of recordnumber, customerid, contactid (case-insensitive) found in
 * the response data (hidden fields), then in the contact attributes.
 */
export const resolveRecordNumber = (
  data: TResponse["data"],
  contactAttributes: Record<string, string> | null
): string | null => {
  for (const source of [data, contactAttributes ?? {}]) {
    for (const key of RECORD_NUMBER_KEYS) {
      const found = findByLowerKey(source, key);
      if (found) return found;
    }
  }
  return null;
};

const headlineText = (headline: Record<string, string> | undefined): string =>
  headline?.default || Object.values(headline ?? {})[0] || "";

/** Builds the Snowflake rows for one response. Pure: no I/O. */
export const buildSnowflakeRows = (
  survey: TSnowflakeSurvey,
  response: Pick<
    TResponse,
    "id" | "createdAt" | "finished" | "language" | "meta" | "data" | "contactAttributes"
  >
): TSnowflakeResponseRow[] => {
  const elements = new Map<string, { headline: string; type: string }>();
  for (const block of survey.blocks ?? []) {
    for (const element of block.elements) {
      elements.set(element.id, { headline: headlineText(element.headline), type: element.type });
    }
  }
  const hiddenFieldIds = new Set((survey.hiddenFields?.fieldIds ?? []).map((id) => id.toLowerCase()));
  const contactAttributes = response.contactAttributes ?? null;

  const base = {
    RESPONSE_ID: response.id,
    SURVEY_ID: survey.id,
    SURVEY_NAME: survey.name,
    RECORD_NUMBER: resolveRecordNumber(response.data, contactAttributes),
    CREATED_AT: response.createdAt.toISOString(),
    FINISHED: response.finished,
    LANGUAGE: response.language ?? null,
    SOURCE_URL: response.meta?.url ?? null,
  };

  const rows: TSnowflakeResponseRow[] = [];
  for (const [key, value] of Object.entries(response.data)) {
    if (value == null) continue;
    const element = elements.get(key);
    let described = { QUESTION_TEXT: key, QUESTION_TYPE: "unknown" };
    if (element) described = { QUESTION_TEXT: element.headline, QUESTION_TYPE: element.type };
    else if (hiddenFieldIds.has(key.toLowerCase()))
      described = { QUESTION_TEXT: key, QUESTION_TYPE: "hiddenField" };
    rows.push({ ...base, QUESTION_ID: key, ...described, ANSWER: toText(value) });
  }

  // QUESTION_ID is half of the MERGE key, so it must be unique per response. A hidden field named
  // "contact_email" would collide with the "email" contact attribute; the response data wins.
  const usedIds = new Set(rows.map((row) => row.QUESTION_ID));
  for (const [key, value] of Object.entries(contactAttributes ?? {})) {
    const questionId = `contact_${key}`;
    if (value == null || usedIds.has(questionId)) continue;
    usedIds.add(questionId);
    rows.push({
      ...base,
      QUESTION_ID: questionId,
      QUESTION_TEXT: key,
      QUESTION_TYPE: "contactAttribute",
      ANSWER: String(value),
    });
  }

  return rows;
};
