import "server-only";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { prisma } from "@formbricks/database";
import { isSsoEmailDomainAllowed } from "./sso-email-domain";

type SessionDatabaseHook = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>;

type SessionCreateHook = NonNullable<NonNullable<SessionDatabaseHook["create"]>["before"]>;

/**
 * ASLA fork: enforce `AUTH_SSO_ALLOWED_EMAIL_DOMAINS` for sign-ins by EXISTING users, who skip
 * `user.create` (and so the provisioning gate). Runs on session creation, the one choke point every
 * SSO callback passes through, and throws BEFORE the `Session` row is written. Scoped to SSO callbacks
 * (`isSsoCallback`) so password and magic-link sessions are not affected. New users are refused earlier
 * by `gateSsoProvisioning`, so no orphan user row is left behind.
 */
export const rejectDisallowedSsoDomainOnSessionCreate = async (
  session: Parameters<SessionCreateHook>[0],
  isSsoCallback: boolean,
  allowedDomains: readonly string[]
): Promise<void> => {
  if (!isSsoCallback || allowedDomains.length === 0) return;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true },
  });
  if (!user || !isSsoEmailDomainAllowed(user.email, allowedDomains)) {
    throw new APIError("FORBIDDEN", {
      message: "Your email domain is not permitted to sign in.",
      code: "sso_email_domain_not_permitted",
    });
  }
};

/**
 * `databaseHooks.session.create.before` gate (ENG-1054) — preserves the NextAuth
 * `user.isActive === false` sign-in rejection (authOptions.ts credential + email-verification paths)
 * that Better Auth otherwise drops.
 *
 * The credential-account backfill migrates EVERY user with `User.password IS NOT NULL`, deactivated
 * ones included, and Better Auth's email/password (and SSO / recovery) sign-in would mint a session
 * from valid credentials with no isActive check. This runs on every session creation — the single
 * choke point covering credential, SSO, and the recovery magic-link — and throws BEFORE the `Session`
 * row is written, so a deactivated user can neither sign in nor leave an orphaned session behind.
 * Session *refresh* goes through `updateSession` (not create), so live sessions of still-active users
 * are unaffected. The message mirrors authOptions for parity.
 */
export const rejectInactiveUserOnSessionCreate: NonNullable<
  NonNullable<SessionDatabaseHook["create"]>["before"]
> = async (session) => {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true },
  });
  if (user?.isActive === false) {
    throw new APIError("FORBIDDEN", {
      message: "Your account is currently inactive. Please contact the organization admin.",
    });
  }
};
