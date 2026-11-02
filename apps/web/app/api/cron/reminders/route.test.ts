import { headers } from "next/headers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";
import { POST } from "./route";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/constants", () => ({ CRON_SECRET: "test-secret" }));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/survey/invitations/lib/invitations", () => ({ runPendingInvitationSends: vi.fn() }));
vi.mock("@/modules/survey/invitations/lib/scheduled-reminders", () => ({ runScheduledReminders: vi.fn() }));

const makeReq = () => new Request("http://localhost/api/cron/reminders", { method: "POST" });
const withKey = (key: string | null) =>
  vi.mocked(headers).mockResolvedValue({ get: (k: string) => (k === "x-api-key" ? key : null) } as never);

describe("POST /api/cron/reminders", () => {
  beforeEach(() => {
    withKey("test-secret");
    vi.mocked(runPendingInvitationSends).mockResolvedValue({ sent: 3, failed: 0, remaining: 0 });
    vi.mocked(runScheduledReminders).mockResolvedValue({ surveysProcessed: 1, sent: 2, failed: 0 });
  });

  test("rejects a missing key and runs nothing", async () => {
    withKey(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(runPendingInvitationSends).not.toHaveBeenCalled();
    expect(runScheduledReminders).not.toHaveBeenCalled();
  });

  test("rejects a wrong key and runs nothing", async () => {
    withKey("wrong");
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(runPendingInvitationSends).not.toHaveBeenCalled();
  });

  test("drains invitations first, then reminders, and returns both counts", async () => {
    const order: string[] = [];
    vi.mocked(runPendingInvitationSends).mockImplementation(async () => {
      order.push("invitations");
      return { sent: 3, failed: 0, remaining: 0 };
    });
    vi.mocked(runScheduledReminders).mockImplementation(async () => {
      order.push("reminders");
      return { surveysProcessed: 1, sent: 2, failed: 0 };
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      invitations: { sent: 3, failed: 0, remaining: 0 },
      reminders: { surveysProcessed: 1, sent: 2, failed: 0 },
    });
    expect(order).toEqual(["invitations", "reminders"]);
  });

  test("returns 500 without leaking the error when a drain throws", async () => {
    vi.mocked(runScheduledReminders).mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "internal_server_error" });
  });
});
