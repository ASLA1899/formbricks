import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (k: string) => (k === "x-api-key" ? "test-secret" : null) })),
}));
vi.mock("@/lib/constants", () => ({ CRON_SECRET: "test-secret" }));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/survey/invitations/lib/invitations", () => ({
  runPendingInvitationSends: vi.fn(),
}));
vi.mock("@/modules/survey/invitations/lib/scheduled-reminders", () => ({
  runScheduledReminders: vi.fn(),
}));
vi.mock("@/modules/survey/schedule/lib/run-due-schedules", () => ({
  runDueSchedules: vi.fn(),
}));

import { POST } from "./route";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";
import { runDueSchedules } from "@/modules/survey/schedule/lib/run-due-schedules";
import { headers } from "next/headers";

const makeReq = () =>
  new Request("http://localhost/api/cron/reminders", {
    method: "POST",
    headers: { "x-api-key": "test-secret" },
  });

describe("POST /api/cron/reminders — schedule drain wiring", () => {
  beforeEach(() => {
    // Re-apply implementations after vi.resetAllMocks() from vitestSetup
    (headers as any).mockResolvedValue({ get: (k: string) => (k === "x-api-key" ? "test-secret" : null) });
    (runPendingInvitationSends as any).mockResolvedValue({ sent: 0 });
    (runScheduledReminders as any).mockResolvedValue({ sent: 0 });
  });

  test("returns schedules counts on success", async () => {
    (runDueSchedules as any).mockResolvedValue({ opened: 2, closed: 1 });
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, schedules: { opened: 2, closed: 1 } });
    expect(body.invitations).toBeDefined();
    expect(body.reminders).toBeDefined();
  });

  test("isolates schedule-drain failure from invitations/reminders", async () => {
    (runDueSchedules as any).mockRejectedValue(new Error("boom"));
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.schedules).toEqual({ error: "schedule_drain_failed" });
    expect(body.invitations).toBeDefined();
    expect(body.reminders).toBeDefined();
  });
});
