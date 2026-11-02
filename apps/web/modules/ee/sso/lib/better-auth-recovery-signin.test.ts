import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { verifyToken } from "@/lib/jwt";
import { ssoRecoverySignInPlugin } from "./better-auth-recovery-signin";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/constants", () => ({
  WEBAPP_URL: "https://app.test",
  SSO_ALLOWED_EMAIL_DOMAINS: ["asla.org"],
}));
vi.mock("@/lib/jwt", () => ({ verifyToken: vi.fn() }));
vi.mock("@/lib/utils/url", () => ({ getValidatedCallbackUrl: vi.fn(() => null) }));
vi.mock("@/modules/ee/sso/lib/sso-recovery", () => ({
  getSsoRecoveryFailureRedirectUrl: vi.fn(() => "https://app.test/auth/login"),
}));
vi.mock("better-auth/cookies", () => ({ setSessionCookie: vi.fn() }));

const createSession = vi.fn();
const findUserById = vi.fn();
const redirect = vi.fn((url: string) => ({ redirectedTo: url }));

const redeem = () =>
  ssoRecoverySignInPlugin.endpoints.ssoRecoverySignIn({
    query: { token: "t" },
    context: { internalAdapter: { createSession, findUserById } },
    redirect,
  } as never);

beforeEach(() => {
  vi.resetAllMocks();
  redirect.mockImplementation((url: string) => ({ redirectedTo: url }));
  vi.mocked(verifyToken).mockResolvedValue({ id: "u1", purpose: "sso_recovery" } as never);
  findUserById.mockResolvedValue({ id: "u1" });
  createSession.mockResolvedValue({ token: "s" });
});

describe("SSO recovery redemption honors the current email-domain allowlist", () => {
  test("creates no session when the address was excluded after the link was issued", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isActive: true,
      email: "guest@external.test",
    } as never);

    await redeem().catch(() => undefined);

    expect(createSession).not.toHaveBeenCalled();
  });

  test("still creates a session for an allowed address", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true, email: "member@asla.org" } as never);

    await redeem().catch(() => undefined);

    expect(createSession).toHaveBeenCalledWith("u1", false);
  });
});
