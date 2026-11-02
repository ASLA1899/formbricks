import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { deleteSurveyResponseRows, insertSurveyResponseRows, isSnowflakeConfigured } from "./client";
import { deleteResponseFromSnowflake, deleteResponsesFromSnowflake, syncResponseToSnowflake } from "./sync";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@formbricks/database", () => ({
  prisma: { $transaction: vi.fn(), response: { findUnique: vi.fn() } },
}));
vi.mock("./client", () => ({
  deleteSurveyResponseRows: vi.fn(),
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

const tx = { $executeRaw: vi.fn(), response: prisma.response };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSnowflakeConfigured).mockReturnValue(true);
  vi.mocked(prisma.response.findUnique).mockResolvedValue({ id: "r1" } as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(tx)) as never);
});

describe("syncResponseToSnowflake", () => {
  test("replaces the response's rows: delete first, then insert", async () => {
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).toHaveBeenCalledWith(["r1"], expect.any(Number));
    expect(insertSurveyResponseRows).toHaveBeenCalledWith(
      [expect.objectContaining({ QUESTION_ID: "q1" })],
      expect.any(Number)
    );
    expect(vi.mocked(deleteSurveyResponseRows).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(insertSurveyResponseRows).mock.invocationCallOrder[0]
    );
  });

  test("takes the per-response advisory lock before touching Snowflake, in one transaction", async () => {
    await syncResponseToSnowflake(survey, response);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(tx.$executeRaw.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteSurveyResponseRows).mock.invocationCallOrder[0]
    );
  });

  test("two workers on one response run one after the other (lock stands in for the database)", async () => {
    // Model pg_advisory_xact_lock across processes: the second transaction waits for the first to end.
    let held: Promise<void> = Promise.resolve();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      const previous = held;
      let release!: () => void;
      held = new Promise<void>((resolve) => (release = resolve));
      await previous;
      try {
        return await fn(tx);
      } finally {
        release();
      }
    }) as never);
    const events: string[] = [];
    vi.mocked(deleteSurveyResponseRows).mockImplementation(async () => {
      events.push("delete");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    vi.mocked(insertSurveyResponseRows).mockImplementation(async () => {
      events.push("insert");
    });
    // A second copy of the module has its own in-process queue, like a second web process or replica.
    vi.resetModules();
    const otherProcess = await import("./sync");
    await Promise.all([
      syncResponseToSnowflake(survey, response),
      otherProcess.syncResponseToSnowflake(survey, response),
    ]);
    expect(events).toEqual(["delete", "insert", "delete", "insert"]);
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

  test("reports whether the cleanup ran", async () => {
    expect(await deleteResponsesFromSnowflake([{ id: "r1" }])).toBe(true);
    vi.mocked(deleteSurveyResponseRows).mockRejectedValue(new Error("down"));
    expect(await deleteResponsesFromSnowflake([{ id: "r1" }])).toBe(false);
    expect(await deleteResponsesFromSnowflake([])).toBe(false);
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

  test("still removes the rows when the transaction fails after the write (for example it expired)", async () => {
    // Inside the transaction the final check throws (like Prisma P2028); outside it the response is gone.
    vi.mocked(prisma.response.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn({
        $executeRaw: vi.fn(),
        response: { findUnique: vi.fn().mockResolvedValueOnce({ id: "r1" }) },
      });
      throw new Error("Transaction already closed (P2028)");
    }) as never);
    await expect(syncResponseToSnowflake(survey, response)).resolves.toBeUndefined();
    expect(insertSurveyResponseRows).toHaveBeenCalledTimes(1);
    expect(deleteSurveyResponseRows).toHaveBeenLastCalledWith(["r1"]);
  });

  test("keeps the rows when the transaction fails but the response still exists", async () => {
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(tx);
      throw new Error("Transaction already closed (P2028)");
    }) as never);
    await syncResponseToSnowflake(survey, response);
    expect(deleteSurveyResponseRows).toHaveBeenCalledTimes(1);
  });

  test("gives every Snowflake write one deadline that ends before the transaction can expire", async () => {
    await syncResponseToSnowflake(survey, response);
    const [, deleteDeadline] = vi.mocked(deleteSurveyResponseRows).mock.calls[0];
    const [, insertDeadline] = vi.mocked(insertSurveyResponseRows).mock.calls[0];
    expect(deleteDeadline).toBe(insertDeadline);
    // budget (480s) + one statement deadline (45s) is under the 600s transaction timeout.
    expect((deleteDeadline as number) - Date.now()).toBeLessThanOrEqual(480_000);
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
