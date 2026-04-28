import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { ensureContact } from "./invitations";

vi.mock("@formbricks/database", () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contactAttributeKey: {
      findMany: vi.fn(),
    },
  },
}));

// Stub out heavy modules that invitations.ts imports at the top level so the
// test file only needs to load ensureContact's actual dependencies. None of
// these are exercised by the ensureContact tests themselves.
vi.mock("@/modules/email", () => ({
  sendSurveyInvitationEmail: vi.fn(),
}));
vi.mock("@/lib/organization/service", () => ({
  getOrganizationByEnvironmentId: vi.fn(),
}));
vi.mock("@/modules/ee/contacts/lib/contact-survey-link", () => ({
  getContactSurveyLink: vi.fn(),
}));
vi.mock("./audience", () => ({
  resolveAudience: vi.fn(),
}));
vi.mock("./send-queue", () => ({
  sleep: vi.fn(),
}));
vi.mock("./template", () => ({
  renderSubject: vi.fn(),
  renderTemplate: vi.fn(),
}));

describe("ensureContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns existing contact id when matched by typed email column", async () => {
    (prisma.contact.findFirst as any).mockResolvedValueOnce({ id: "c1" });

    const id = await ensureContact("env1", "Alice@Example.com", "Alice", null);

    expect(id).toBe("c1");
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { environmentId: "env1", email: "alice@example.com" },
      select: { id: true },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  test("falls back to email-attribute lookup and backfills typed column on hit", async () => {
    (prisma.contact.findFirst as any)
      .mockResolvedValueOnce(null) // step 1: typed-column miss
      .mockResolvedValueOnce({ id: "c2" }); // step 2: attribute-match hit
    (prisma.contact.update as any).mockResolvedValue({ id: "c2" });

    const id = await ensureContact("env1", "bob@example.com", null, null);

    expect(id).toBe("c2");
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c2" },
      data: { email: "bob@example.com" },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  test("creates new contact with typed email + email-attribute + source=manual", async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    (prisma.contactAttributeKey.findMany as any).mockResolvedValue([
      { id: "k1", key: "email" },
      { id: "k2", key: "firstName" },
    ]);
    (prisma.contact.create as any).mockResolvedValue({ id: "c3" });

    const id = await ensureContact("env1", "  New@Example.com  ", "New", null);

    expect(id).toBe("c3");
    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          environmentId: "env1",
          email: "new@example.com",
          source: "manual",
          attributes: {
            create: expect.arrayContaining([
              { attributeKeyId: "k1", value: "new@example.com" },
              { attributeKeyId: "k2", value: "New" },
            ]),
          },
        }),
        select: { id: true },
      })
    );
  });
});
