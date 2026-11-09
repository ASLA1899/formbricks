import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { sendSurveyInvitationEmail } from "@/modules/email";
import { getContactSurveyLink } from "@/modules/survey/link/lib/contact-survey-link";
import { resolveAudience } from "./audience";
import {
  enqueueInvitationsForSurvey,
  linkResponseToInvitation,
  runPendingInvitationSends,
  upsertInvitation,
} from "./invitations";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({
  prisma: {
    survey: { findUnique: vi.fn() },
    surveyInvitation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    response: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn() },
    contactAttributeKey: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@formbricks/database/prisma", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code = "P2002";
    },
  },
}));
vi.mock("@formbricks/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/constants", () => ({ EMAIL_SEND_CHUNK_SIZE: 500, EMAIL_SEND_THROTTLE_MS: 0 }));
vi.mock("@/lib/organization/service", () => ({
  getOrganizationByWorkspaceId: vi.fn(async () => ({ name: "ASLA" })),
}));
vi.mock("@/modules/email", () => ({ sendSurveyInvitationEmail: vi.fn() }));
vi.mock("@/modules/survey/link/lib/contact-survey-link", () => ({ getContactSurveyLink: vi.fn() }));
vi.mock("./audience", () => ({ resolveAudience: vi.fn() }));

const config = {
  audience: { source: "segment", segmentId: "seg" },
  reminderSchedule: { enabled: false, daysAfterInvite: [], maxReminders: 0 },
  emailTemplates: {
    invitation: {
      subject: "You're invited to {{surveyName}}",
      body: "Hi {{recipientFirstName}}",
      buttonLabel: "Go",
    },
    reminder: { subject: "r", body: "r" },
  },
};

const row = {
  id: "inv1",
  surveyId: "s1",
  recipientEmail: "a@x.org",
  recipientName: "Ana",
  recipientFirstName: "Ana",
  recipientLastName: null,
  contactId: "c1",
  linkToken: "stored",
};

describe("runPendingInvitationSends", () => {
  beforeEach(() => {
    vi.mocked(prisma.surveyInvitation.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.surveyInvitation.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.surveyInvitation.update).mockResolvedValue({} as never);
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({
      id: "s1",
      name: "Pulse",
      workspaceId: "w1",
      invitationConfig: config,
    } as never);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
    vi.mocked(getContactSurveyLink).mockResolvedValue({ ok: true, data: "fresh" } as never);
    vi.mocked(sendSurveyInvitationEmail).mockResolvedValue(true);
  });

  test("returns zeros when nothing is pending", async () => {
    vi.mocked(prisma.surveyInvitation.findMany).mockResolvedValue([] as never);
    expect(await runPendingInvitationSends({})).toEqual({ sent: 0, failed: 0, remaining: 0 });
  });

  test("scopes the pending query to unsent, unanswered rows and the given survey", async () => {
    await runPendingInvitationSends({ surveyId: "s1", chunkSize: 10 });
    expect(prisma.surveyInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sentAt: null, respondedAt: null, surveyId: "s1" },
        take: 10,
        orderBy: { createdAt: "asc" },
      })
    );
  });

  test("claims the row, then sends the rendered email", async () => {
    const order: string[] = [];
    vi.mocked(prisma.$executeRaw).mockImplementation((async () => {
      order.push("claim");
      return 1;
    }) as never);
    vi.mocked(sendSurveyInvitationEmail).mockImplementation(async () => {
      order.push("send");
      return true;
    });
    const res = await runPendingInvitationSends({});
    expect(order).toEqual(["claim", "send"]);
    expect(res.sent).toBe(1);
    expect(sendSurveyInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@x.org",
        subject: "You're invited to Pulse",
        body: "Hi Ana",
        surveyLink: "fresh",
        buttonLabel: "Go",
      })
    );
  });

  test("a lost claim sends nothing", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never);
    const res = await runPendingInvitationSends({});
    expect(sendSurveyInvitationEmail).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
  });

  test("a skipped delivery (sender returns false) clears sentAt and does not count as sent", async () => {
    vi.mocked(sendSurveyInvitationEmail).mockResolvedValue(false);
    const res = await runPendingInvitationSends({});
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { sentAt: null },
    });
  });

  test("a failed send clears sentAt so the next tick retries the invitation", async () => {
    vi.mocked(sendSurveyInvitationEmail).mockRejectedValue(new Error("smtp down"));
    const res = await runPendingInvitationSends({});
    expect(res.failed).toBe(1);
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { sentAt: null },
    });
  });

  test("skips a survey whose config no longer parses, without claiming", async () => {
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({
      id: "s1",
      name: "Pulse",
      workspaceId: "w1",
      invitationConfig: { broken: true },
    } as never);
    const res = await runPendingInvitationSends({});
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
  });
});

describe("enqueueInvitationsForSurvey / upsertInvitation", () => {
  beforeEach(() => {
    vi.mocked(getContactSurveyLink).mockResolvedValue({ ok: true, data: "link" } as never);
    vi.mocked(prisma.surveyInvitation.create).mockResolvedValue({ id: "new" } as never);
  });

  test("queues new recipients, counts already-sent ones, and never sends", async () => {
    vi.mocked(resolveAudience).mockResolvedValue([
      { email: "new@x.org", name: null, firstName: null, lastName: null, existingContactId: "c1" },
      { email: "old@x.org", name: null, firstName: null, lastName: null, existingContactId: "c2" },
    ]);
    vi.mocked(prisma.surveyInvitation.findUnique).mockImplementation((async (args: any) => {
      const email = args.where.surveyId_recipientEmail.recipientEmail;
      return email === "old@x.org" ? { sentAt: new Date(), respondedAt: null } : null;
    }) as never);

    const res = await enqueueInvitationsForSurvey({
      surveyId: "s1",
      workspaceId: "w1",
      config: config as never,
    });

    expect(res).toEqual({ enqueued: 1, alreadySent: 1 });
    expect(resolveAudience).toHaveBeenCalledWith(config.audience, "w1");
    expect(prisma.surveyInvitation.create).toHaveBeenCalledTimes(1);
    expect(sendSurveyInvitationEmail).not.toHaveBeenCalled();
  });

  test("creates a missing contact in the workspace, not an environment", async () => {
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.contactAttributeKey.findMany).mockResolvedValue([{ id: "k1", key: "email" }] as never);
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "newc" } as never);

    await upsertInvitation({
      surveyId: "s1",
      workspaceId: "w1",
      member: { email: "n@x.org", name: null, firstName: null, lastName: null, existingContactId: null },
    });

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: { workspaceId: "w1", attributes: { create: [{ attributeKeyId: "k1", value: "n@x.org" }] } },
      select: { id: true },
    });
    expect(prisma.contactAttributeKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: "w1" }) })
    );
  });

  test("an already-sent invitation keeps its stored link and is not touched", async () => {
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValue({
      id: "inv1",
      contactId: "c1",
      linkToken: "stored",
      sentAt: new Date(),
    } as never);
    const res = await upsertInvitation({
      surveyId: "s1",
      workspaceId: "w1",
      member: { email: "a@x.org", name: null, firstName: null, lastName: null, existingContactId: "c1" },
    });
    expect(res).toEqual({ id: "inv1", contactId: "c1", linkToken: "stored", created: false });
    expect(getContactSurveyLink).not.toHaveBeenCalled();
  });
});

describe("linkResponseToInvitation", () => {
  const response = { id: "r1", surveyId: "s1", contactId: "c1", contactAttributes: null };

  test("marks the contact's open invitation as responded", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue(response as never);
    vi.mocked(prisma.surveyInvitation.findFirst).mockResolvedValue({ id: "inv1" } as never);
    await linkResponseToInvitation("r1");
    expect(prisma.surveyInvitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surveyId: "s1", contactId: "c1", respondedAt: null } })
    );
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { respondedAt: expect.any(Date), responseId: "r1" },
    });
  });

  test("with no contact, falls back to the email in the response attributes", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue({
      ...response,
      contactId: null,
      contactAttributes: { email: " Ana@X.org " },
    } as never);
    vi.mocked(prisma.surveyInvitation.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValue({ id: "inv9" } as never);
    await linkResponseToInvitation("r1");
    expect(prisma.surveyInvitation.findUnique).toHaveBeenCalledWith({
      where: { surveyId_recipientEmail: { surveyId: "s1", recipientEmail: "ana@x.org" } },
      select: { id: true },
    });
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv9" } })
    );
  });

  test("with no contact, matches on response.data.verifiedEmail", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue({
      ...response,
      contactId: null,
      contactAttributes: null,
      data: { verifiedEmail: " Bo@X.org " },
    } as never);
    vi.mocked(prisma.surveyInvitation.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValue({ id: "inv8" } as never);
    await linkResponseToInvitation("r1");
    expect(prisma.surveyInvitation.findUnique).toHaveBeenCalledWith({
      where: { surveyId_recipientEmail: { surveyId: "s1", recipientEmail: "bo@x.org" } },
      select: { id: true },
    });
    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv8" } })
    );
  });

  test("does nothing when the response is unknown or no invitation matches", async () => {
    vi.mocked(prisma.response.findUnique).mockResolvedValue(null as never);
    await linkResponseToInvitation("nope");
    vi.mocked(prisma.response.findUnique).mockResolvedValue(response as never);
    vi.mocked(prisma.surveyInvitation.findFirst).mockResolvedValue(null as never);
    await linkResponseToInvitation("r1");
    expect(prisma.surveyInvitation.update).not.toHaveBeenCalled();
  });
});
