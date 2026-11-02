import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { deleteSurveyResponseRows, isSnowflakeConfigured, upsertSurveyResponseRows } from "./client";
import {
  RECONCILE_DELAY_MS,
  deleteResponseFromSnowflake,
  deleteResponsesFromSnowflake,
  reconcileResponses,
  syncResponseToSnowflake,
} from "./sync";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@formbricks/database", () => ({
  prisma: { response: { findUnique: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("./client", () => ({
  deleteSurveyResponseRows: vi.fn(),
  upsertSurveyResponseRows: vi.fn(),
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

const currentRow = (overrides: Record<string, unknown> = {}) => ({
  ...response,
  survey: {
    ...survey,
    snowflakeSync: true,
    visibility: "workspace",
    visibilityProjectedVersion: 1,
    visibilityVersion: 1,
  },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSnowflakeConfigured).mockReturnValue(true);
  vi.mocked(prisma.response.findUnique).mockResolvedValue({ id: "r1" } as never);
  vi.mocked(prisma.response.findMany).mockResolvedValue([currentRow()] as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reconcileResponses", () => {
  test("writes a surviving response again from its current local data", async () => {
    vi.mocked(prisma.response.findMany).mockResolvedValue([currentRow({ data: { q1: "newer" } })] as never);
    await reconcileResponses(["r1"]);
    expect(upsertSurveyResponseRows).toHaveBeenCalledWith("r1", [
      expect.objectContaining({ QUESTION_ID: "q1", ANSWER: "newer" }),
    ]);
  });

  test("does not rewrite when the survey stopped syncing, the response is unfinished, or the survey is restricted", async () => {
    vi.mocked(prisma.response.findMany).mockResolvedValue([
      currentRow({ survey: { ...survey, snowflakeSync: false } }),
      currentRow({ id: "r2", finished: false }),
      currentRow({
        id: "r3",
        survey: {
          ...survey,
          snowflakeSync: true,
          visibility: "restricted",
          visibilityProjectedVersion: 1,
          visibilityVersion: 1,
        },
      }),
    ] as never);
    await reconcileResponses(["r1", "r2", "r3"]);
    expect(upsertSurveyResponseRows).not.toHaveBeenCalled();
  });
});

describe("syncResponseToSnowflake", () => {
  test("upserts the response's rows by response id", async () => {
    await syncResponseToSnowflake(survey, response);
    expect(upsertSurveyResponseRows).toHaveBeenCalledWith("r1", [
      expect.objectContaining({ RESPONSE_ID: "r1", QUESTION_ID: "q1" }),
    ]);
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("does nothing without credentials", async () => {
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    await syncResponseToSnowflake(survey, response);
    expect(upsertSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("skips the write when the response was deleted after the job was queued", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue(null);
    await syncResponseToSnowflake(survey, response);
    expect(upsertSurveyResponseRows).not.toHaveBeenCalled();
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("never throws when Snowflake fails", async () => {
    vi.mocked(upsertSurveyResponseRows).mockRejectedValue(new Error("down"));
    await expect(syncResponseToSnowflake(survey, response)).resolves.toBeUndefined();
  });

  test("removes the rows at once when the response was deleted during the write", async () => {
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"]);
  });

  test("keeps the rows when the response still exists", async () => {
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("reconciles even when the write failed, because a failed statement may still have run", async () => {
    vi.mocked(upsertSurveyResponseRows).mockRejectedValue(new Error("deadline"));
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"]);
  });

  test("reconciles again after the delay, which removes a late write for a deleted response", async () => {
    vi.useFakeTimers();
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
    // The response is deleted later, and a delayed write lands in the meantime.
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(RECONCILE_DELAY_MS + 1);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"]);
  });

  test("two syncs of one response run one after the other", async () => {
    const events: string[] = [];
    vi.mocked(upsertSurveyResponseRows).mockImplementation(async () => {
      events.push("start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push("end");
    });
    await Promise.all([syncResponseToSnowflake(survey, response), syncResponseToSnowflake(survey, response)]);
    // The reconcile after each sync adds further writes; none may overlap.
    expect(events.length % 2).toBe(0);
    events.forEach((event, i) => expect(event).toBe(i % 2 === 0 ? "start" : "end"));
  });
});

describe("deleteResponsesFromSnowflake", () => {
  test("deletes the rows of every response, whatever the survey's sync flag", async () => {
    await deleteResponsesFromSnowflake([{ id: "r1" }, { id: "r2" }]);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1", "r2"]);
  });

  test("reports whether the cleanup ran", async () => {
    expect(await deleteResponsesFromSnowflake([{ id: "r1" }])).toBe(true);
    vi.mocked(deleteSurveyResponseRows).mockRejectedValue(new Error("down"));
    expect(await deleteResponsesFromSnowflake([{ id: "r1" }])).toBe(false);
    expect(await deleteResponsesFromSnowflake([])).toBe(false);
  });

  test("does nothing when unconfigured or empty", async () => {
    await deleteResponsesFromSnowflake([]);
    vi.mocked(isSnowflakeConfigured).mockReturnValue(false);
    await deleteResponseFromSnowflake({ id: "r1" });
    expect(deleteSurveyResponseRows).not.toHaveBeenCalled();
  });

  test("never throws", async () => {
    vi.mocked(deleteSurveyResponseRows).mockRejectedValue(new Error("down"));
    await expect(deleteResponseFromSnowflake({ id: "r1" })).resolves.toBeUndefined();
  });

  test("deletes again after the delay, even when the first delete failed", async () => {
    vi.useFakeTimers();
    vi.mocked(deleteSurveyResponseRows).mockRejectedValueOnce(new Error("down"));
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);
    await deleteResponsesFromSnowflake([{ id: "r9" }]);
    expect(deleteSurveyResponseRows).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECONCILE_DELAY_MS + 1);
    expect(deleteSurveyResponseRows).toHaveBeenCalledTimes(2);
  });
});
