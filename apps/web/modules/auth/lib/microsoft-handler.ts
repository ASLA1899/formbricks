import "server-only";
import type { Account } from "next-auth";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import type { TUser } from "@formbricks/types/user";
import { createAccount } from "@/lib/account/service";
import { createMembership } from "@/lib/membership/service";
import { findMatchingLocale } from "@/lib/utils/locale";
import { createBrevoCustomer } from "@/modules/auth/lib/brevo";
import { createUser, getUserByEmail, updateUser } from "@/modules/auth/lib/user";

// ZUserName allows letters, marks, whitespace, apostrophe, digits, hyphen.
// Microsoft Entra commonly returns names as "Last, First" or with periods
// (e.g. middle initials). Normalize before handing to createUser so
// validation doesn't reject and bounce the user back to the login page.
const sanitizeMicrosoftName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  // "Last, First" → "First Last" (single comma, both sides non-empty)
  const parts = trimmed.split(",");
  const reordered =
    parts.length === 2 && parts[0].trim() && parts[1].trim()
      ? `${parts[1].trim()} ${parts[0].trim()}`
      : trimmed;
  return reordered
    .replace(/[^\p{L}\p{M}\s'\d-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const handleMicrosoftCallback = async ({
  user,
  account,
}: {
  user: TUser;
  account: Account;
}): Promise<boolean> => {
  if (!user.email || account.provider !== "azure-ad") {
    return false;
  }

  const existingUserByProvider = await prisma.user.findFirst({
    where: {
      identityProvider: "azuread",
      identityProviderAccountId: account.providerAccountId,
    },
  });

  if (existingUserByProvider) {
    if (existingUserByProvider.email === user.email) {
      return true;
    }

    const conflict = await getUserByEmail(user.email);
    if (!conflict) {
      logger.info(
        { userId: existingUserByProvider.id, providerAccountId: account.providerAccountId },
        "Microsoft sign-in: rewriting user email after Azure UPN change"
      );
      await updateUser(existingUserByProvider.id, { email: user.email });
      return true;
    }

    throw new Error("Email conflict: another account already uses this email.");
  }

  const existingByEmail = await getUserByEmail(user.email);
  if (existingByEmail) {
    if (existingByEmail.identityProvider === "azuread") {
      // Same provider, unrecognized providerAccountId (e.g. tenant rotation
      // or app-registration switch). Persist the new oid so the next sign-in
      // hits the providerAccountId fast-path instead of falling through here.
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { identityProviderAccountId: account.providerAccountId },
      });
      return true;
    }
    if (existingByEmail.identityProvider === "email") {
      // First-time migration of a credentials user to Microsoft sign-in. Trusted
      // because Azure AD only releases a verified email after the user authenticates.
      // Admins must set AZUREAD_TENANT_ID to their tenant — leaving it as "common"
      // would let any tenant's user with this email take over the account.
      // Subsequent logins use the providerAccountId fast-path above.
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          identityProvider: "azuread",
          identityProviderAccountId: account.providerAccountId,
        },
      });
      return true;
    }
    throw new Error(
      "An account with this email already exists under a different sign-in method. Please sign in with your original method."
    );
  }

  const sanitizedName = sanitizeMicrosoftName(user.name);
  const newUser = await createUser({
    name: sanitizedName || user.email.split("@")[0],
    email: user.email,
    emailVerified: new Date(),
    identityProvider: "azuread",
    identityProviderAccountId: account.providerAccountId,
    locale: await findMatchingLocale(),
  });

  await createAccount({
    ...account,
    userId: newUser.id,
  });

  void createBrevoCustomer({ id: newUser.id, email: newUser.email });

  const firstOrg = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (firstOrg) {
    // Single-tenant ASLA deployment: staff are expected to receive org-level
    // notifications from the org they're auto-joined to. Intentionally diverges
    // from the EE SSO handler, which appends the org to
    // notificationSettings.unsubscribedOrganizationIds.
    await createMembership(firstOrg.id, newUser.id, { role: "member", accepted: true });
  }

  return true;
};
