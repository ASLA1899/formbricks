import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import {
  deleteSurveyResponseRows,
  deleteSurveyRows,
  insertSurveyResponseRows,
  isSnowflakeConfigured,
} from "./client";
import {
  deleteResponseFromSnowflake,
  deleteResponsesFromSnowflake,
  deleteSurveyFromSnowflake,
  syncResponseToSnowflake,
} from "./sync";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@formbricks/database", () => ({
  prisma: { survey: { findMany: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock("./client", () => ({
  deleteSurveyResponseRows: vi.fn(),
  deleteSurveyRows: vi.fn(),
  insertSurveyResponseRows: vi.fn(),
  isSnowflakeConfigured: vi.fn(),
}));

const survey = { id: "s1", name: "S", blocks: [], hiddenFields: { fieldIds: [] } };
const response = {
  id: "r1",
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  finished: true,
  language: null,
  meta: {},
  contactAttributes: null,
  data: { q1: "a" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSnowflakeConfigured).mockReturnValue(true);
});

describe("syncResponseToSnowflake", () => {
  test("replaces the response's rows: delete first, then insert", async () => {
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"]);
    expect(insertSurveyResponseRows).toHaveBeenCalledWith([expect.objectContaining({ QUESTION_ID: "q1" })]);
    expect(vi.mocked(deleteSurveyResponseRows).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(insertSurveyResponseRows).mock.invocationCallOrder[0]
    );
  });

  test("does nothing without credentials", async () => {
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    await syncResponseToSnowflake(survey, response);
    expect(insertSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("never throws when Snowflake fails", async () => {
    vi.mocked(insertSurveyResponseRows).mockRejectedValue(new Error("down"));
    await expect(syncResponseToSnowflake(survey, response)).resolves.toBeUndefined();
  });
});

describe("deleteResponsesFromSnowflake", () => {
  test("only deletes responses of surveys with the sync on", async () => {
    vi.mocked(prisma.survey.findMany).mockResolvedValue([{ id: "s1" }] as never);
    await deleteResponsesFromSnowflake([
      { id: "r1", surveyId: "s1" },
      { id: "r2", surveyId: "s2" },
    ]);
    expect(prisma.survey.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2"] }, snowflakeSync: true },
      select: { id: true },
    });
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"]);
  });

  test("skips the survey lookup when unconfigured or empty", async () => {
    await deleteResponsesFromSnowflake([]);
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    await deleteResponseFromSnowflake({ id: "r1", surveyId: "s1" });
    expect(prisma.survey.findMany).not.toHaveBeenCalled();
  });

  test("never throws", async () => {
    vi.mocked(prisma.survey.findMany).mockRejectedValue(new Error("db"));
    await expect(deleteResponseFromSnowflake({ id: "r1", surveyId: "s1" })).resolves.toBeUndefined();
  });
});

describe("deleteSurveyFromSnowflake", () => {
  test("deletes the survey's rows when the sync is on", async () => {
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({ snowflakeSync: true } as never);
    expect(await deleteSurveyFromSnowflake("s1")).toBe(true);
    expect(deleteSurveyRows).toHaveBeenCalledWith("s1");
  });

  test("does nothing when the sync is off", async () => {
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({ snowflakeSync: false } as never);
    expect(await deleteSurveyFromSnowflake("s1")).toBe(false);
    expect(deleteSurveyRows).not.toHaveBeenCalled();
  });

  test("reports false and does not throw on failure", async () => {
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({ snowflakeSync: true } as never);
    vi.mocked(deleteSurveyRows).mockRejectedValue(new Error("down"));
    expect(await deleteSurveyFromSnowflake("s1")).toBe(false);
  });
});
