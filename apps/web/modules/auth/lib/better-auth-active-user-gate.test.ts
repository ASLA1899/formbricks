import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import {
  rejectDisallowedSsoDomainOnSessionCreate,
  rejectInactiveUserOnSessionCreate,
} from "./better-auth-active-user-gate";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({ prisma: { user: { findUnique: vi.fn() } } }));

const session = { userId: "u1" } as never;
const allowed = ["asla.org"];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("rejectDisallowedSsoDomainOnSessionCreate", () => {
  test("refuses an existing user whose email domain is not allowed, before any session is written", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: "guest@external.com" } as never);

    await expect(rejectDisallowedSsoDomainOnSessionCreate(session, true, allowed)).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { code: "sso_email_domain_not_permitted" },
    });
  });

  test("lets an allowed domain through", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: "Jane@ASLA.org" } as never);

    await expect(rejectDisallowedSsoDomainOnSessionCreate(session, true, allowed)).resolves.toBeUndefined();
  });

  test("fails closed when the user row cannot be found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(rejectDisallowedSsoDomainOnSessionCreate(session, true, allowed)).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  test("does nothing, and reads nothing, when the allowlist is empty", async () => {
    await rejectDisallowedSsoDomainOnSessionCreate(session, true, []);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test("does not apply to non-SSO sessions such as password sign-in", async () => {
    await rejectDisallowedSsoDomainOnSessionCreate(session, false, allowed);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("rejectInactiveUserOnSessionCreate", () => {
  test("refuses a deactivated user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: false } as never);
    await expect(rejectInactiveUserOnSessionCreate(session, null)).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  test("allows an active user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as never);
    await expect(rejectInactiveUserOnSessionCreate(session, null)).resolves.toBeUndefined();
  });
});
