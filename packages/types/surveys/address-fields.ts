// Sub-field definitions for the Address element.
// ADDRESS_FIELDS is in STORAGE order: it matches the positional array format used in response data.
// ADDRESS_DISPLAY_FIELDS is the order shown to respondents and editors (mailing-label order).

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

// Name and organization display first but are stored last.
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

export type TAddressStorageField = (typeof ADDRESS_FIELDS)[number];

/**
 * Reorders a positional address response array (storage order) into display order.
 * Older responses have only 6 entries; missing entries come back as empty strings.
 */
export function getAddressValuesInDisplayOrder(value: readonly unknown[]): string[] {
  return ADDRESS_DISPLAY_FIELDS.map((field) => {
    const item = value[ADDRESS_FIELDS.indexOf(field)];
    return typeof item === "string" ? item : "";
  });
}
