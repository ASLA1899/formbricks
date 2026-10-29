// Sub-field definitions for compound question types (ContactInfo, Address).
// CONTACT_INFO_FIELDS and ADDRESS_FIELDS are in STORAGE order: they match the positional array
// format used in response data. Address display order differs (see ADDRESS_DISPLAY_FIELDS).

export const CONTACT_INFO_FIELDS = ["firstName", "lastName", "email", "phone", "company"] as const;
export const ADDRESS_FIELDS = [
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zip",
  "country",
  // Appended after the original six so existing responses keep their meaning.
  "name",
  "organization",
] as const;

// Address fields in the order shown to respondents and editors (mailing-label order).
// Decoupled from storage order: name/organization display first but are stored last.
export const ADDRESS_DISPLAY_FIELDS = [
  "name",
  "organization",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zip",
  "country",
] as const;

export type TContactInfoField = (typeof CONTACT_INFO_FIELDS)[number];
export type TAddressField = (typeof ADDRESS_FIELDS)[number];

export const COMPOUND_FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  addressLine1: "Address Line 1",
  addressLine2: "Address Line 2",
  city: "City",
  state: "State",
  zip: "Zip",
  country: "Country",
  name: "Name",
  organization: "Organization",
};

// Combined index lookup — field names are globally unique across compound types,
// so we can resolve sub-field values without knowing the element type.
export const ALL_COMPOUND_FIELD_INDICES: Record<string, number> = {
  // ContactInfo fields
  firstName: 0,
  lastName: 1,
  email: 2,
  phone: 3,
  company: 4,
  // Address fields
  addressLine1: 0,
  addressLine2: 1,
  city: 2,
  state: 3,
  zip: 4,
  country: 5,
  name: 6,
  organization: 7,
};

export function getCompoundFields(elementType: string): readonly string[] | null {
  if (elementType === "contactInfo") return CONTACT_INFO_FIELDS;
  if (elementType === "address") return ADDRESS_DISPLAY_FIELDS;
  return null;
}

/**
 * Reorders a positional address response array (storage order) into display order.
 * Older responses have only 6 entries; missing entries come back as empty strings.
 */
export function getAddressValuesInDisplayOrder(value: readonly unknown[]): string[] {
  return ADDRESS_DISPLAY_FIELDS.map((field) => {
    const item = value[ALL_COMPOUND_FIELD_INDICES[field]];
    return typeof item === "string" ? item : "";
  });
}

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
    return {
      firstName: value[0] || "",
      lastName: value[1] || "",
      email: value[2] || "",
      phone: value[3] || "",
      company: value[4] || "",
    };
  }
  return null;
}
