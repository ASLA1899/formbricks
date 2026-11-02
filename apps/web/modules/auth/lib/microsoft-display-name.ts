/**
 * ASLA fork: normalize the display name Microsoft Entra returns.
 *
 * Entra commonly returns "Last, First" (a directory-style name). We store "First Last" and never keep
 * a comma in the name. Anything that is not a single "Last, First" pair has its commas replaced with
 * spaces. Returns undefined when nothing is left, so callers can fall back to the email local part.
 * Character-set normalization for the rest of the name is still done by `normalizeUserName` in the
 * Better Auth user hooks.
 */
export const sanitizeMicrosoftDisplayName = (raw: string | null | undefined): string | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const parts = trimmed.split(",");
  const reordered =
    parts.length === 2 && parts[0].trim() && parts[1].trim()
      ? `${parts[1].trim()} ${parts[0].trim()}`
      : trimmed;
  const cleaned = reordered.replaceAll(",", " ").replaceAll(/\s+/g, " ").trim();
  return cleaned || undefined;
};
