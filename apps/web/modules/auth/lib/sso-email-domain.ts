/**
 * ASLA fork: optional allowlist of email domains permitted to sign in or auto-provision through SSO
 * (`AUTH_SSO_ALLOWED_EMAIL_DOMAINS`, e.g. "asla.org,aslafund.org").
 *
 * Why it exists: the ASLA Entra tenant contains external B2B guests whose addresses are not @asla.org.
 * Gating on tenant membership alone would let a guest sign in and be provisioned. An empty list (the
 * default) imposes no restriction.
 *
 * Deliberately dependency-free (no env, no Prisma) so it is exhaustively unit-testable and safe to
 * import from any hook.
 */

/** Parses the comma-separated env value into trimmed, lower-cased, non-empty domains. */
export const parseSsoAllowedEmailDomains = (raw: string | undefined | null): string[] =>
  (raw ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

/**
 * Whether `email` may sign in under `allowedDomains`. An empty allowlist allows everyone. The match is
 * exact on the part after the LAST `@` (no subdomain wildcarding: "evil.asla.org" does not match
 * "asla.org"). A value with no usable domain is refused whenever an allowlist is configured.
 */
export const isSsoEmailDomainAllowed = (
  email: string | null | undefined,
  allowedDomains: readonly string[]
): boolean => {
  if (allowedDomains.length === 0) return true;
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 && allowedDomains.includes(domain);
};
