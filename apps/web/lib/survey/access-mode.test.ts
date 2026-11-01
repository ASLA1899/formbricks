import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { reconcileSurveyRelationships } from "@/lib/authzed/survey";
import { setSurveyAccessMode } from "./access-mode";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/lib/authzed/survey", () => ({
  lockSurveyVisibility: vi.fn(),
  reconcileSurveyRelationships: vi.fn(),
}));

const mockTx = (changedRows: number) => {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(changedRows) };
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => fn(tx)) as never);
  return tx;
};

describe("setSurveyAccessMode", () => {
  beforeEach(() => vi.clearAllMocks());

  test("a real change stores mode and visibility together, then projects to SpiceDB", async () => {
    const tx = mockTx(1);
    vi.mocked(reconcileSurveyRelationships).mockResolvedValue({ passes: 1, status: "projected" });

    await expect(setSurveyAccessMode("s1", "private", "u1")).resolves.toEqual({
      accessMode: "private",
      id: "s1",
      projection: "projected",
    });
    const values = tx.$executeRaw.mock.calls[0].slice(1);
    expect(values).toEqual(["private", "restricted", "u1", "s1", "private", "restricted"]);
    expect(reconcileSurveyRelationships).toHaveBeenCalledWith(["s1"]);
  });

  test("public maps to workspace", async () => {
    const tx = mockTx(1);
    vi.mocked(reconcileSurveyRelationships).mockResolvedValue({ passes: 1, status: "projected" });
    await setSurveyAccessMode("s1", "public", "u1");
    expect(tx.$executeRaw.mock.calls[0].slice(1)[1]).toBe("workspace");
  });

  test("a no-op writes nothing new and does not project", async () => {
    mockTx(0);
    await setSurveyAccessMode("s1", "private", "u1");
    expect(reconcileSurveyRelationships).not.toHaveBeenCalled();
  });

  test("a failed projection is reported, not thrown (the outbox finishes it)", async () => {
    mockTx(1);
    vi.mocked(reconcileSurveyRelationships).mockResolvedValue({ status: "failed" } as never);
    await expect(setSurveyAccessMode("s1", "private", "u1")).resolves.toMatchObject({ projection: "failed" });
  });
});
