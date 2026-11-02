import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    SNOWFLAKE_ACCOUNT: "a",
    SNOWFLAKE_USERNAME: "u",
    SNOWFLAKE_PASSWORD: "p",
    SNOWFLAKE_DATABASE: "d",
    SNOWFLAKE_WAREHOUSE: "w",
    SNOWFLAKE_SCHEMA: "s",
  },
}));

const statements: { sqlText: string; binds?: unknown[] }[] = [];
const fakeConnection = {
  isUp: () => true,
  connect: (cb: (error?: Error) => void) => cb(),
  destroy: vi.fn(),
  execute: (options: { sqlText: string; binds?: unknown[]; complete: (error?: Error) => void }) => {
    if (!options.sqlText.startsWith("ALTER SESSION")) {
      statements.push({ sqlText: options.sqlText, binds: options.binds });
    }
    options.complete();
  },
};
vi.mock("snowflake-sdk", () => ({
  default: { configure: vi.fn(), createConnection: () => fakeConnection },
}));

const row = (questionId: string) => ({
  RESPONSE_ID: "r1",
  SURVEY_ID: "s1",
  SURVEY_NAME: "S",
  RECORD_NUMBER: null,
  CREATED_AT: "2026-11-01T00:00:00.000Z",
  FINISHED: true,
  QUESTION_ID: questionId,
  QUESTION_TEXT: "Q",
  QUESTION_TYPE: "openText",
  ANSWER: "a",
  LANGUAGE: null,
  SOURCE_URL: null,
});

beforeEach(() => {
  statements.length = 0;
});

describe("upsertSurveyResponseRows", () => {
  test("merges on response and question, so a repeated or late run cannot duplicate rows", async () => {
    const { upsertSurveyResponseRows } = await import("./client");
    await upsertSurveyResponseRows("r1", [row("q1"), row("q2")]);
    const [merge, prune] = statements;
    expect(merge.sqlText).toContain("MERGE INTO SURVEY_RESPONSES");
    expect(merge.sqlText).toContain("t.RESPONSE_ID = s.RESPONSE_ID AND t.QUESTION_ID = s.QUESTION_ID");
    expect(merge.sqlText).toContain("WHEN MATCHED THEN UPDATE SET");
    expect(merge.sqlText).toContain("WHEN NOT MATCHED THEN INSERT");
    expect(merge.sqlText).not.toMatch(/t\.(RESPONSE_ID|QUESTION_ID) = s\.(?!RESPONSE_ID|QUESTION_ID)/);
    expect(merge.binds).toHaveLength(24);
    expect(prune.sqlText).toContain("QUESTION_ID NOT IN (?, ?)");
    expect(prune.binds).toEqual(["r1", "q1", "q2"]);
  });

  test("a response with no rows is removed", async () => {
    const { upsertSurveyResponseRows } = await import("./client");
    await upsertSurveyResponseRows("r1", []);
    expect(statements).toHaveLength(1);
    expect(statements[0].sqlText).toContain("DELETE FROM SURVEY_RESPONSES WHERE RESPONSE_ID IN (?)");
  });
});
