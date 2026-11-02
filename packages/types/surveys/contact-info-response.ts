/**
 * Normalizes contact info response data from either array (legacy) or object (new) format
 * into a consistent Record<string, string>.
 */
export function normalizeContactInfoResponse(value: unknown): Record<string, string> | null {
  // New format: already an object
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  // Old format: convert positional array to named object
  if (Array.isArray(value)) {
    const [firstName, lastName, email, phone, company] = value as (string | undefined)[];
    return {
      firstName: firstName || "",
      lastName: lastName || "",
      email: email || "",
      phone: phone || "",
      company: company || "",
    };
  }
  return null;
}

const CONTACT_INFO_BUILTIN_FIELD_IDS = ["firstName", "lastName", "email", "phone", "company"];

/**
 * Resolves the display order of contact-info fields. Saved order comes first (unknown ids dropped);
 * any built-in or custom field missing from the saved order is appended, so fields added or
 * re-enabled after a reorder still appear.
 */
export function resolveContactInfoFieldOrder(
  fieldOrder: string[] | undefined,
  customFieldIds: string[]
): string[] {
  const known = [...CONTACT_INFO_BUILTIN_FIELD_IDS, ...customFieldIds];
  const saved = (fieldOrder ?? []).filter((id) => known.includes(id));
  const result = [...new Set(saved)];
  for (const id of known) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}
