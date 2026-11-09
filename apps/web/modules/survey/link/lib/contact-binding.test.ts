import { beforeEach, describe, expect, test, vi } from "vitest";
import { getIsContactsEnabled } from "@/modules/ee/license-check/lib/utils";
import {
  generateContactBindingToken,
  getBoundContactId,
  isValidContactBindingToken,
} from "./contact-binding";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/constants", () => ({ ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" }));

vi.mock("@/lib/utils/helper", () => ({
  getOrganizationIdFromWorkspaceId: vi.fn(async () => "org_1"),
}));

vi.mock("@/modules/ee/license-check/lib/utils", () => ({
  getIsContactsEnabled: vi.fn(),
}));

const workspaceId = "lygo31gfsexlr4lh6rq8dxyl";
const surveyA = "cgt5e6dw1vsf1bv2ki5gj845";
const surveyB = "cmor8y52a0000qa8h9x0bt9ry";
const contactId = "clh8ruz3w0000qa8h9x0bt9ry";
const otherContact = "cm8f4x9mm0001gx9h5b7d7h3q";

describe("contact binding token", () => {
  test("is 64 hex chars and stable for the same survey and contact", () => {
    const token = generateContactBindingToken(surveyA, contactId);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateContactBindingToken(surveyA, contactId)).toBe(token);
  });

  test("validates only for the survey and contact it was minted for", () => {
    const token = generateContactBindingToken(surveyA, contactId);
    expect(isValidContactBindingToken(surveyA, contactId, token)).toBe(true);
    expect(isValidContactBindingToken(surveyB, contactId, token)).toBe(false);
    expect(isValidContactBindingToken(surveyA, otherContact, token)).toBe(false);
  });

  test("rejects a tampered, malformed or missing token", () => {
    const token = generateContactBindingToken(surveyA, contactId);
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(isValidContactBindingToken(surveyA, contactId, tampered)).toBe(false);
    expect(isValidContactBindingToken(surveyA, contactId, token.toUpperCase())).toBe(false);
    expect(isValidContactBindingToken(surveyA, contactId, "zz")).toBe(false);
    expect(isValidContactBindingToken(surveyA, contactId, null)).toBe(false);
    expect(isValidContactBindingToken(surveyA, contactId, undefined)).toBe(false);
  });
});

describe("getBoundContactId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIsContactsEnabled).mockResolvedValue(false);
  });

  test("returns undefined when no contactId is sent", async () => {
    expect(
      await getBoundContactId({ workspaceId, surveyId: surveyA, contactId: null, contactToken: null })
    ).toBeUndefined();
  });

  test("keeps the contactId with this survey's token", async () => {
    const contactToken = generateContactBindingToken(surveyA, contactId);
    expect(await getBoundContactId({ workspaceId, surveyId: surveyA, contactId, contactToken })).toBe(
      contactId
    );
  });

  test("drops the contactId when the token was minted for another survey", async () => {
    const contactToken = generateContactBindingToken(surveyA, contactId);
    expect(
      await getBoundContactId({ workspaceId, surveyId: surveyB, contactId, contactToken })
    ).toBeUndefined();
  });

  test("drops the contactId when no token is sent", async () => {
    expect(
      await getBoundContactId({ workspaceId, surveyId: surveyA, contactId, contactToken: undefined })
    ).toBeUndefined();
  });

  test("keeps the contactId without a token when the Contacts license is active", async () => {
    vi.mocked(getIsContactsEnabled).mockResolvedValue(true);
    expect(
      await getBoundContactId({ workspaceId, surveyId: surveyB, contactId, contactToken: undefined })
    ).toBe(contactId);
  });
});
