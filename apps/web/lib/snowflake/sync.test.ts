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
  prisma: { response: { findUnique: vi.fn() } },
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
  vi.mocked(prisma.response.findUnique).mockResolvedValue({ id: "r1" } as never);
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
  test("deletes the rows of every response, whatever the survey's sync flag", async () => {
    await deleteResponsesFromSnowflake([
      { id: "r1", surveyId: "s1" },
      { id: "r2", surveyId: "s2" },
    ]);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1", "r2"]);
  });

  test("does nothing when unconfigured or empty", async () => {
    await deleteResponsesFromSnowflake([]);
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    await deleteResponseFromSnowflake({ id: "r1", surveyId: "s1" });
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("never throws", async () => {
    vi.mocked(deleteSurveyResponseRows).mockRejectedValue(new Error("down"));
    await expect(deleteResponseFromSnowflake({ id: "r1", surveyId: "s1" })).resolves.toBeUndefined();
  });
});

describe("deleteSurveyFromSnowflake", () => {
  test("deletes the survey's rows", async () => {
    expect(await deleteSurveyFromSnowflake("s1")).toBe(true);
    expect(deleteSurveyRows).toHaveBeenCalledWith("s1");
  });

  test("does nothing when unconfigured", async () => {
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    expect(await deleteSurveyFromSnowflake("s1")).toBe(false);
    expect(deleteSurveyRows).not.toHaveBeenCalled();
  });

  test("reports false and does not throw on failure", async () => {
    vi.mocked(deleteSurveyRows).mockRejectedValue(new Error("down"));
    expect(await deleteSurveyFromSnowflake("s1")).toBe(false);
  });
});

describe("ordering and deleted responses", () => {
  test("skips the write when the response was deleted after the job was queued", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue(null);
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
    expect(insertSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("removes the rows again when the response is deleted during the write", async () => {
    vi.mocked(prisma.response.findUnique)
      .mockResolvedValueOnce({ id: "r1" } as never)
      .mockResolvedValueOnce(null);
    await syncResponseToSnowflake(survey, response);
    expect(insertSurveyResponseRows).toHaveBeenCalledTimes(1);
    expect(deleteSurveyResponseRows).toHaveBeenCalledTimes(2);
  });

  test("runs two syncs of one response one after the other", async () => {
    const events: string[] = [];
    vi.mocked(deleteSurveyResponseRows).mockImplementation(async () => {
      events.push("delete");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    vi.mocked(insertSurveyResponseRows).mockImplementation(async () => {
      events.push("insert");
    });
    await Promise.all([syncResponseToSnowflake(survey, response), syncResponseToSnowflake(survey, response)]);
    expect(events).toEqual(["delete", "insert", "delete", "insert"]);
  });
});
