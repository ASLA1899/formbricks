import { describe, expect, test, vi, beforeEach } from "vitest";
import { runDueSchedules } from "./run-due-schedules";

vi.mock("@formbricks/database", () => ({
  prisma: {
    survey: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/survey/service", () => ({ updateSurvey: vi.fn() }));
vi.mock("@/modules/ee/audit-logs/lib/handler", () => ({ queueAuditEvent: vi.fn() }));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/ee/audit-logs/types/audit-log", () => ({ UNKNOWN_DATA: "unknown" }));

import { prisma } from "@formbricks/database";
import { updateSurvey } from "@/lib/survey/service";
import { queueAuditEvent } from "@/modules/ee/audit-logs/lib/handler";

const baseSurvey = {
  id: "svr_1",
  environmentId: "env_1",
  status: "draft",
  runOnDate: new Date(Date.now() - 60_000),
  closeOnDate: null,
  environment: { project: { organizationId: "org_1" } },
};

const mockTransaction = (freshSurvey: any, throwOnUpdate = false) => {
  if (throwOnUpdate) (updateSurvey as any).mockRejectedValueOnce(new Error("boom"));
  (prisma.$transaction as any).mockImplementationOnce(async (fn: any) =>
    fn({ survey: { findUnique: vi.fn().mockResolvedValue(freshSurvey) } }),
  );
};

beforeEach(() => vi.clearAllMocks());

describe("runDueSchedules", () => {
  test("opens a draft survey whose runOnDate is past", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([baseSurvey]).mockResolvedValueOnce([]);
    mockTransaction(baseSurvey);
    const r = await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ id: "svr_1", status: "inProgress" }));
    expect(r).toEqual({ opened: 1, closed: 0 });
  });

  test("opens a paused survey whose runOnDate is past", async () => {
    const s = { ...baseSurvey, status: "paused" };
    (prisma.survey.findMany as any).mockResolvedValueOnce([s]).mockResolvedValueOnce([]);
    mockTransaction(s);
    await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "inProgress" }));
  });

  test("returns 0 when nothing is due (Prisma WHERE filter)", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const r = await runDueSchedules();
    expect(updateSurvey).not.toHaveBeenCalled();
    expect(r).toEqual({ opened: 0, closed: 0 });
  });

  test("skips when re-read shows status changed (race)", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([baseSurvey]).mockResolvedValueOnce([]);
    mockTransaction({ ...baseSurvey, status: "completed" });
    const r = await runDueSchedules();
    expect(updateSurvey).not.toHaveBeenCalled();
    expect(r).toEqual({ opened: 0, closed: 0 });
  });

  test("closes an inProgress survey whose closeOnDate is past", async () => {
    const s = { id: "svr_2", environmentId: "env_1", status: "inProgress",
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000),
                environment: { project: { organizationId: "org_1" } } };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    mockTransaction(s);
    const r = await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(r).toEqual({ opened: 0, closed: 1 });
  });

  test("closes a paused survey whose closeOnDate is past", async () => {
    const s = { id: "svr_3", environmentId: "env_1", status: "paused",
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000),
                environment: { project: { organizationId: "org_1" } } };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    mockTransaction(s);
    await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  test("isolates per-survey failures", async () => {
    const a = baseSurvey;
    const b = { ...baseSurvey, id: "svr_b" };
    (prisma.survey.findMany as any).mockResolvedValueOnce([a, b]).mockResolvedValueOnce([]);
    // first transaction: updateSurvey throws
    mockTransaction(a, true);
    // second transaction: success
    mockTransaction(b);
    const r = await runDueSchedules();
    expect(r.opened).toBe(1);  // only b succeeded
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", targetId: "svr_1" }));
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ status: "success", targetId: "svr_b" }));
  });

  test("audit reason is 'scheduled-open' for opens", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([baseSurvey]).mockResolvedValueOnce([]);
    mockTransaction(baseSurvey);
    await runDueSchedules();
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      newObject: expect.objectContaining({ reason: "scheduled-open" }),
    }));
  });

  test("audit reason is 'scheduled-close' for closes", async () => {
    const s = { id: "svr_4", environmentId: "env_1", status: "inProgress",
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000),
                environment: { project: { organizationId: "org_1" } } };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    mockTransaction(s);
    await runDueSchedules();
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      newObject: expect.objectContaining({ reason: "scheduled-close" }),
    }));
  });
});
