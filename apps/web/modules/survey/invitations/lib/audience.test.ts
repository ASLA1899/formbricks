import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { AuthorizationError } from "@formbricks/types/errors";
import { getContactsInSegment } from "@/modules/ee/contacts/lib/contacts";
import { resolveAudience } from "./audience";

vi.mock("@formbricks/database", () => ({ prisma: { segment: { findUnique: vi.fn() } } }));
vi.mock("@/modules/ee/contacts/lib/contacts", () => ({ getContactsInSegment: vi.fn() }));

describe("resolveAudience", () => {
  beforeEach(() => {
    vi.mocked(prisma.segment.findUnique).mockResolvedValue({ workspaceId: "w1" } as never);
  });

  test("segment: lowercases and de-duplicates emails, drops rows without one, keeps the contact id", async () => {
    vi.mocked(getContactsInSegment).mockResolvedValue([
      { contactId: "c1", attributes: { email: " Ana@Example.org ", firstName: "Ana", lastName: "Lee" } },
      { contactId: "c2", attributes: { email: "ana@example.org" } },
      { contactId: "c3", attributes: { firstName: "No Email" } },
    ] as never);

    expect(await resolveAudience({ source: "segment", segmentId: "seg" }, "w1")).toEqual([
      {
        email: "ana@example.org",
        name: "Ana Lee",
        firstName: "Ana",
        lastName: "Lee",
        existingContactId: "c1",
      },
    ]);
  });

  test("segment: a segment from another workspace is refused and no contact is read", async () => {
    vi.mocked(prisma.segment.findUnique).mockResolvedValue({ workspaceId: "other" } as never);
    await expect(resolveAudience({ source: "segment", segmentId: "seg" }, "w1")).rejects.toThrow(
      AuthorizationError
    );
    expect(getContactsInSegment).not.toHaveBeenCalled();
  });

  test("segment: a missing segment gives an empty audience", async () => {
    vi.mocked(getContactsInSegment).mockResolvedValue(null as never);
    expect(await resolveAudience({ source: "segment", segmentId: "gone" }, "w1")).toEqual([]);
  });

  test("manualList: normalizes, de-duplicates and builds the full name", async () => {
    const out = await resolveAudience(
      {
        source: "manualList",
        recipients: [
          { email: "B@x.org", firstName: "Bo" },
          { email: "b@x.org", firstName: "Dup" },
          { email: "c@x.org" },
        ],
      },
      "w1"
    );
    expect(out).toEqual([
      { email: "b@x.org", name: "Bo", firstName: "Bo", lastName: null, existingContactId: null },
      { email: "c@x.org", name: null, firstName: null, lastName: null, existingContactId: null },
    ]);
  });

  test("snowflake: fails loudly instead of queueing nobody", async () => {
    await expect(
      resolveAudience({ source: "snowflake", queryId: "q", emailColumn: "EMAIL" }, "w1")
    ).rejects.toThrow(/not available/);
  });
});
