import { describe, expect, test, vi } from "vitest";
import { getContactsInSegment } from "@/modules/ee/contacts/lib/contacts";
import { resolveAudience } from "./audience";

vi.mock("@/modules/ee/contacts/lib/contacts", () => ({ getContactsInSegment: vi.fn() }));

describe("resolveAudience", () => {
  test("segment: lowercases and de-duplicates emails, drops rows without one, keeps the contact id", async () => {
    vi.mocked(getContactsInSegment).mockResolvedValue([
      { contactId: "c1", attributes: { email: " Ana@Example.org ", firstName: "Ana", lastName: "Lee" } },
      { contactId: "c2", attributes: { email: "ana@example.org" } },
      { contactId: "c3", attributes: { firstName: "No Email" } },
    ] as never);

    expect(await resolveAudience({ source: "segment", segmentId: "seg" })).toEqual([
      {
        email: "ana@example.org",
        name: "Ana Lee",
        firstName: "Ana",
        lastName: "Lee",
        existingContactId: "c1",
      },
    ]);
  });

  test("segment: a missing segment gives an empty audience", async () => {
    vi.mocked(getContactsInSegment).mockResolvedValue(null as never);
    expect(await resolveAudience({ source: "segment", segmentId: "gone" })).toEqual([]);
  });

  test("manualList: normalizes, de-duplicates and builds the full name", async () => {
    const out = await resolveAudience({
      source: "manualList",
      recipients: [
        { email: "B@x.org", firstName: "Bo" },
        { email: "b@x.org", firstName: "Dup" },
        { email: "c@x.org" },
      ],
    });
    expect(out).toEqual([
      { email: "b@x.org", name: "Bo", firstName: "Bo", lastName: null, existingContactId: null },
      { email: "c@x.org", name: null, firstName: null, lastName: null, existingContactId: null },
    ]);
  });

  test("snowflake: fails loudly instead of queueing nobody", async () => {
    await expect(
      resolveAudience({ source: "snowflake", queryId: "q", emailColumn: "EMAIL" })
    ).rejects.toThrow(/not available/);
  });
});
