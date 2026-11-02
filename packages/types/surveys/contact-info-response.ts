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
