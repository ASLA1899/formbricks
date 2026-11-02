import { describe, expect, test } from "vitest";
import { type TSnowflakeSurvey, buildSnowflakeRows, resolveRecordNumber } from "./response-rows";

const survey: TSnowflakeSurvey = {
  id: "survey1",
  name: "Member survey",
  blocks: [
    {
      elements: [
        { id: "q1", type: "openText", headline: { default: "Your name?" } },
        { id: "q2", type: "rating", headline: { de: "Bewertung" } },
      ],
    },
  ],
  hiddenFields: { fieldIds: ["RecordNumber", "source"] },
};

const response = {
  id: "resp1",
  createdAt: new Date("2026-11-01T10:00:00.000Z"),
  finished: true,
  language: "en",
  meta: { url: "https://example.org/s/1" },
  contactAttributes: { email: "a@example.org" },
  data: {
    q1: "Ada",
    q2: 5,
    RecordNumber: " 12345 ",
    source: "mail",
    stray: ["x", "y"],
    skipped: undefined,
  },
};

describe("buildSnowflakeRows", () => {
  const rows = buildSnowflakeRows(survey, response);
  const byId = Object.fromEntries(rows.map((row) => [row.QUESTION_ID, row]));

  test("one row per answer, hidden field and contact attribute; nulls are skipped", () => {
    expect(rows.map((row) => row.QUESTION_ID).sort()).toEqual(
      ["RecordNumber", "contact_email", "q1", "q2", "source", "stray"].sort()
    );
  });

  test("questions carry their headline and type; falls back to the first language", () => {
    expect(byId.q1).toMatchObject({ QUESTION_TEXT: "Your name?", QUESTION_TYPE: "openText", ANSWER: "Ada" });
    expect(byId.q2).toMatchObject({ QUESTION_TEXT: "Bewertung", QUESTION_TYPE: "rating", ANSWER: "5" });
  });

  test("hidden fields, unknown keys and contact attributes are typed", () => {
    expect(byId.source.QUESTION_TYPE).toBe("hiddenField");
    expect(byId.stray).toMatchObject({ QUESTION_TYPE: "unknown", ANSWER: '["x","y"]' });
    expect(byId.contact_email).toMatchObject({ QUESTION_TYPE: "contactAttribute", ANSWER: "a@example.org" });
  });

  test("every row carries the response-level columns", () => {
    for (const row of rows) {
      expect(row).toMatchObject({
        RESPONSE_ID: "resp1",
        SURVEY_ID: "survey1",
        SURVEY_NAME: "Member survey",
        RECORD_NUMBER: "12345",
        CREATED_AT: "2026-11-01T10:00:00.000Z",
        FINISHED: true,
        LANGUAGE: "en",
        SOURCE_URL: "https://example.org/s/1",
      });
    }
  });

  test("a response with no data and no attributes yields no rows", () => {
    expect(buildSnowflakeRows(survey, { ...response, data: {}, contactAttributes: null })).toEqual([]);
  });
});

describe("resolveRecordNumber", () => {
  test("response data wins over contact attributes, and the key order is recordnumber, customerid, contactid", () => {
    expect(resolveRecordNumber({ ContactId: "c", CustomerID: "b" }, { recordnumber: "a" })).toBe("b");
  });

  test("falls back to contact attributes, skipping blank values", () => {
    expect(resolveRecordNumber({ recordnumber: "  " }, { RecordNumber: "77" })).toBe("77");
  });

  test("returns null when nothing matches", () => {
    expect(resolveRecordNumber({ other: "x" }, null)).toBeNull();
  });
});
