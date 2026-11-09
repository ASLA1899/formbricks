import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { getIsContactsEnabled } from "@/modules/ee/license-check/lib/utils";
import { getInvitedContactId } from "./invited-contact";

vi.mock("server-only", () => ({}));

vi.mock("@formbricks/database", () => ({
  prisma: { surveyInvitation: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/utils/helper", () => ({
  getOrganizationIdFromWorkspaceId: vi.fn(async () => "org_1"),
}));

vi.mock("@/modules/ee/license-check/lib/utils", () => ({
  getIsContactsEnabled: vi.fn(),
}));

const workspaceId = "lygo31gfsexlr4lh6rq8dxyl";
const surveyId = "cgt5e6dw1vsf1bv2ki5gj845";
const contactId = "clh8ruz3w0000qa8h9x0bt9ry";

describe("getInvitedContactId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIsContactsEnabled).mockResolvedValue(false);
  });

  test("returns undefined when no contactId is sent", async () => {
    expect(await getInvitedContactId({ workspaceId, surveyId, contactId: null })).toBeUndefined();
    expect(prisma.surveyInvitation.findFirst).not.toHaveBeenCalled();
  });

  test("keeps the contactId when the contact is invited to this survey in this workspace", async () => {
    vi.mocked(prisma.surveyInvitation.findFirst).mockResolvedValue({ id: "inv_1" } as any);

    expect(await getInvitedContactId({ workspaceId, surveyId, contactId })).toBe(contactId);
    expect(prisma.surveyInvitation.findFirst).toHaveBeenCalledWith({
      where: { surveyId, contactId, survey: { workspaceId } },
      select: { id: true },
    });
  });

  test("drops the contactId when the contact has no invitation to this survey", async () => {
    vi.mocked(prisma.surveyInvitation.findFirst).mockResolvedValue(null);

    expect(await getInvitedContactId({ workspaceId, surveyId, contactId })).toBeUndefined();
  });

  test("keeps the contactId without a lookup when the Contacts license is active", async () => {
    vi.mocked(getIsContactsEnabled).mockResolvedValue(true);

    expect(await getInvitedContactId({ workspaceId, surveyId, contactId })).toBe(contactId);
    expect(prisma.surveyInvitation.findFirst).not.toHaveBeenCalled();
  });
});
