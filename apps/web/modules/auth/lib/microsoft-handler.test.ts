import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { createAccount } from "@/lib/account/service";
import { createMembership } from "@/lib/membership/service";
import { findMatchingLocale } from "@/lib/utils/locale";
import { createBrevoCustomer } from "@/modules/auth/lib/brevo";
import { createUser, getUserByEmail, updateUser } from "@/modules/auth/lib/user";
import { handleMicrosoftCallback } from "./microsoft-handler";
import { mockUser } from "./mock-data";

vi.mock("@formbricks/database", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/modules/auth/lib/user", () => ({
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/account/service", () => ({
  createAccount: vi.fn(),
}));

vi.mock("@/lib/membership/service", () => ({
  createMembership: vi.fn(),
}));

vi.mock("@/lib/utils/locale", () => ({
  findMatchingLocale: vi.fn(),
}));

vi.mock("@/modules/auth/lib/brevo", () => ({
  createBrevoCustomer: vi.fn(),
}));

describe("handleMicrosoftCallback", () => {
  const account = {
    provider: "azure-ad",
    providerAccountId: "azure-account-id",
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findMatchingLocale).mockResolvedValue("en-US");
  });

  test("returns false when provider is not azure-ad", async () => {
    const result = await handleMicrosoftCallback({
      user: mockUser,
      account: { ...account, provider: "google" },
    });
    expect(result).toBe(false);
  });

  test("returns true when user with same azure provider account already exists", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1", email: mockUser.email } as any);

    const result = await handleMicrosoftCallback({ user: mockUser, account });

    expect(result).toBe(true);
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("updates email when azure account exists and email changed without conflict", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1", email: "old@example.com" } as any);
    vi.mocked(getUserByEmail).mockResolvedValueOnce(null);

    const result = await handleMicrosoftCallback({ user: mockUser, account });

    expect(result).toBe(true);
    expect(updateUser).toHaveBeenCalledWith("u1", { email: mockUser.email });
  });

  test("throws on email conflict when azure account exists with different email", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1", email: "old@example.com" } as any);
    vi.mocked(getUserByEmail).mockResolvedValueOnce({ id: "u2", email: mockUser.email } as any);

    await expect(handleMicrosoftCallback({ user: mockUser, account })).rejects.toThrow(
      "Email conflict: another account already uses this email."
    );
  });

  test("returns false when user has no email", async () => {
    const result = await handleMicrosoftCallback({
      user: { ...mockUser, email: "" } as any,
      account,
    });
    expect(result).toBe(false);
  });

  test("updates providerAccountId when existing email user is azuread but oid changed", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      id: "u2",
      email: mockUser.email,
      identityProvider: "azuread",
    } as any);

    const result = await handleMicrosoftCallback({ user: mockUser, account });

    expect(result).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { identityProviderAccountId: "azure-account-id" },
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
  });

  test("migrates an existing credentials (email) user on first Microsoft sign-in", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      id: "u2",
      email: mockUser.email,
      identityProvider: "email",
    } as any);

    const result = await handleMicrosoftCallback({ user: mockUser, account });

    expect(result).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { identityProvider: "azuread", identityProviderAccountId: "azure-account-id" },
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  test("refuses login when existing email user used a different SSO provider", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      id: "u2",
      email: mockUser.email,
      identityProvider: "google",
    } as any);

    await expect(handleMicrosoftCallback({ user: mockUser, account })).rejects.toThrow(
      "different sign-in method"
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  test("creates user, account, brevo customer, and default organization membership for new users", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce(null);
    vi.mocked(createUser).mockResolvedValueOnce({ id: "new-user-id", email: mockUser.email } as any);
    vi.mocked(prisma.organization.findFirst).mockResolvedValueOnce({ id: "org-1" } as any);

    const result = await handleMicrosoftCallback({ user: mockUser, account });

    expect(result).toBe(true);
    expect(createUser).toHaveBeenCalledWith({
      name: mockUser.name,
      email: mockUser.email,
      emailVerified: expect.any(Date),
      identityProvider: "azuread",
      identityProviderAccountId: "azure-account-id",
      locale: "en-US",
    });
    expect(createAccount).toHaveBeenCalledWith({ ...account, userId: "new-user-id" });
    expect(createBrevoCustomer).toHaveBeenCalledWith({ id: "new-user-id", email: mockUser.email });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({ orderBy: { createdAt: "asc" } });
    expect(createMembership).toHaveBeenCalledWith("org-1", "new-user-id", { role: "member", accepted: true });
  });

  test.each([
    ["SAIH, AYA", "AYA SAIH"],
    ["Cohen, Greg", "Greg Cohen"],
    ["  O'Brien,  Patrick  ", "Patrick O'Brien"],
    ["John A. Smith", "John A Smith"],
    ["Plain Name", "Plain Name"],
    ["Anne-Marie Dupont", "Anne-Marie Dupont"],
  ])("sanitizes Microsoft display name %j into %j", async (raw, expected) => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce(null);
    vi.mocked(createUser).mockResolvedValueOnce({ id: "new-user-id", email: mockUser.email } as any);
    vi.mocked(prisma.organization.findFirst).mockResolvedValueOnce({ id: "org-1" } as any);

    await handleMicrosoftCallback({ user: { ...mockUser, name: raw }, account });

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ name: expected }));
  });

  test("falls back to email local-part when Microsoft sends an empty or all-invalid name", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getUserByEmail).mockResolvedValueOnce(null);
    vi.mocked(createUser).mockResolvedValueOnce({ id: "new-user-id", email: mockUser.email } as any);
    vi.mocked(prisma.organization.findFirst).mockResolvedValueOnce({ id: "org-1" } as any);

    await handleMicrosoftCallback({ user: { ...mockUser, name: ",,," } as any, account });

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ name: mockUser.email.split("@")[0] }));
  });
});
