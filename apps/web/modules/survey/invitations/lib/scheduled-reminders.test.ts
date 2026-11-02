import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { getContactSurveyLink } from "@/modules/ee/contacts/lib/contact-survey-link";
import { sendSurveyInvitationEmail } from "@/modules/email";
import { runScheduledReminders } from "./scheduled-reminders";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({
  prisma: {
    survey: { findMany: vi.fn() },
    surveyInvitation: { findMany: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@formbricks/database/prisma", () => ({ Prisma: { DbNull: Symbol("DbNull") } }));
vi.mock("@formbricks/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/constants", () => ({ EMAIL_SEND_THROTTLE_MS: 0 }));
vi.mock("@/lib/organization/service", () => ({
  getOrganizationByWorkspaceId: vi.fn(async () => ({ name: "ASLA" })),
}));
vi.mock("@/modules/email", () => ({ sendSurveyInvitationEmail: vi.fn() }));
vi.mock("@/modules/ee/contacts/lib/contact-survey-link", () => ({ getContactSurveyLink: vi.fn() }));

const config = (over: Record<string, unknown> = {}) => ({
  audience: { source: "segment", segmentId: "seg" },
  reminderSchedule: { enabled: true, daysAfterInvite: [3, 7], maxReminders: 2, ...over },
  emailTemplates: {
    invitation: { subject: "Hi", body: "b" },
    reminder: { subject: "Remind {{surveyName}}", body: "Hello {{recipientFirstName}}", headingText: "" },
  },
  fromName: "ASLA Surveys",
});

const invitation = {
  id: "inv1",
  recipientEmail: "a@x.org",
  recipientName: "Ana Lee",
  recipientFirstName: "Ana",
  recipientLastName: "Lee",
  contactId: "c1",
  linkToken: "stored-link",
  sentOffsetDays: [],
};

describe("runScheduledReminders", () => {
  beforeEach(() => {
    vi.mocked(prisma.survey.findMany).mockResolvedValue([
      { id: "s1", name: "Pulse", workspaceId: "w1", invitationConfig: config() },
    ] as never);
    vi.mocked(prisma.surveyInvitation.findMany).mockResolvedValue([invitation] as never);
    vi.mocked(prisma.surveyInvitation.update).mockResolvedValue({} as never);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
    vi.mocked(getContactSurveyLink).mockResolvedValue({ ok: true, data: "fresh-link" } as never);
    vi.mocked(sendSurveyInvitationEmail).mockResolvedValue(true);
  });

  test("only looks at in-progress surveys that have a config", async () => {
    await runScheduledReminders();
    const arg = vi.mocked(prisma.survey.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.status).toBe("inProgress");
    expect(arg.where.invitationConfig).toBeDefined();
  });

  test("claims each offset before the email goes out", async () => {
    const order: string[] = [];
    vi.mocked(prisma.$executeRaw).mockImplementation((async () => {
      order.push("claim");
      return 1;
    }) as never);
    vi.mocked(sendSurveyInvitationEmail).mockImplementation(async () => {
      order.push("send");
      return true;
    });

    const res = await runScheduledReminders();

    // Two offsets (3 and 7 days), each claimed and then sent.
    expect(order).toEqual(["claim", "send", "claim", "send"]);
    expect(res).toEqual({ surveysProcessed: 1, sent: 2, failed: 0 });
  });

  test("selects only sent, unanswered, under-cap invitations that have not had this offset", async () => {
    await runScheduledReminders();
    const where = (vi.mocked(prisma.surveyInvitation.findMany).mock.calls[0][0] as { where: any }).where;
    expect(where.surveyId).toBe("s1");
    expect(where.respondedAt).toBeNull();
    expect(where.reminderCount).toEqual({ lt: 2 });
    expect(where.sentAt.not).toBeNull();
    expect(where.NOT).toEqual({ sentOffsetDays: { has: 3 } });
  });

  test("a lost claim sends nothing", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never);
    const res = await runScheduledReminders();
    expect(sendSurveyInvitationEmail).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
  });

  test("a failed send keeps the claim: no rollback and no retry of that offset", async () => {
    vi.mocked(sendSurveyInvitationEmail).mockRejectedValue(new Error("smtp down"));
    const res = await runScheduledReminders();
    expect(res.failed).toBe(2);
    expect(res.sent).toBe(0);
    // The only raw statement is the claim itself. Nothing undoes it.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.surveyInvitation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sentOffsetDays: expect.anything() }) })
    );
  });

  test("sends the refreshed link and the configured sender and heading", async () => {
    await runScheduledReminders();
    expect(sendSurveyInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@x.org",
        subject: "Remind Pulse",
        body: "Hello Ana",
        surveyLink: "fresh-link",
        heading: "",
        fromName: "ASLA Surveys",
      })
    );
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { linkToken: "fresh-link" },
    });
  });

  test("falls back to the stored link when the refresh fails", async () => {
    vi.mocked(getContactSurveyLink).mockResolvedValue({ ok: false, error: { type: "not_found" } } as never);
    await runScheduledReminders();
    expect(sendSurveyInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ surveyLink: "stored-link" })
    );
  });

  test("skips surveys whose schedule is off, empty or unparseable", async () => {
    vi.mocked(prisma.survey.findMany).mockResolvedValue([
      { id: "a", name: "A", workspaceId: "w", invitationConfig: config({ enabled: false }) },
      { id: "b", name: "B", workspaceId: "w", invitationConfig: config({ daysAfterInvite: [] }) },
      { id: "c", name: "C", workspaceId: "w", invitationConfig: { nonsense: true } },
    ] as never);
    const res = await runScheduledReminders();
    expect(res.surveysProcessed).toBe(0);
    expect(prisma.surveyInvitation.findMany).not.toHaveBeenCalled();
  });
});
