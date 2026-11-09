import { describe, expect, test } from "vitest";
import { countInviteeStatuses, filterInvitees, inviteeStatus } from "./invitee-status";

const pending = { sentAt: null, respondedAt: null };
const sent = { sentAt: "2026-11-01T00:00:00.000Z", respondedAt: null };
const responded = { sentAt: "2026-11-01T00:00:00.000Z", respondedAt: "2026-11-02T00:00:00.000Z" };
// Possible when a response is matched by email before the queued send went out.
const respondedUnsent = { sentAt: null, respondedAt: "2026-11-02T00:00:00.000Z" };

describe("inviteeStatus", () => {
  test("a response wins over a send", () => {
    expect(inviteeStatus(pending)).toBe("pending");
    expect(inviteeStatus(sent)).toBe("sent");
    expect(inviteeStatus(responded)).toBe("responded");
    expect(inviteeStatus(respondedUnsent)).toBe("responded");
  });
});

describe("countInviteeStatuses", () => {
  test("counts each status and the total", () => {
    expect(countInviteeStatuses([pending, sent, sent, responded, respondedUnsent])).toEqual({
      all: 5,
      pending: 1,
      sent: 2,
      responded: 2,
    });
  });

  test("handles an empty list", () => {
    expect(countInviteeStatuses([])).toEqual({ all: 0, pending: 0, sent: 0, responded: 0 });
  });
});

describe("filterInvitees", () => {
  test("all returns every row; a status returns only its rows", () => {
    const rows = [pending, sent, responded];
    expect(filterInvitees(rows, "all")).toEqual(rows);
    expect(filterInvitees(rows, "sent")).toEqual([sent]);
    expect(filterInvitees(rows, "pending")).toEqual([pending]);
  });
});
