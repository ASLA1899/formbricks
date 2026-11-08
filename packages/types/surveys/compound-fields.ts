// Sub-field helpers for compound question types (ContactInfo, Address), used by answer piping
// (sub-field recall, `questionId.fieldName`) and configurable pre-fill (`prefillFrom`).
import { ADDRESS_FIELDS } from "./address-fields";
import { normalizeContactInfoResponse } from "./contact-info-response";

export const CONTACT_INFO_FIELDS = ["firstName", "lastName", "email", "phone", "company"] as const;
export { ADDRESS_FIELDS };

export type TContactInfoField = (typeof CONTACT_INFO_FIELDS)[number];

export const COMPOUND_FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  name: "Name",
  organization: "Organization",
  addressLine1: "Address Line 1",
  addressLine2: "Address Line 2",
  city: "City",
  state: "State",
  zip: "Zip",
  country: "Country",
};

export function getCompoundFields(elementType: string): readonly string[] | null {
  if (elementType === "contactInfo") return CONTACT_INFO_FIELDS;
  if (elementType === "address") return ADDRESS_FIELDS;
  return null;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * Reads one sub-field out of a stored compound answer.
 * - Contact info is an object keyed by field id (built-in or custom), or the legacy 5-slot array.
 * - Address is a positional array in storage order (`ADDRESS_FIELDS`); older answers have 6 slots.
 * Returns undefined for an empty, missing, or unknown sub-field.
 */
export function getCompoundSubFieldValue(value: unknown, fieldName: string): string | undefined {
  if (Array.isArray(value)) {
    const addressIdx = (ADDRESS_FIELDS as readonly string[]).indexOf(fieldName);
    const contactIdx = (CONTACT_INFO_FIELDS as readonly string[]).indexOf(fieldName);
    // Built-in contact and address field names are disjoint, so the name picks the array shape.
    if (addressIdx !== -1 && contactIdx === -1) return asString(value[addressIdx]);
    if (contactIdx !== -1) return asString(normalizeContactInfoResponse(value)?.[fieldName]);
    return undefined;
  }
  if (value && typeof value === "object") {
    return asString((value as Record<string, unknown>)[fieldName]);
  }
  return undefined;
}

/** True when the answer holds at least one non-empty sub-field. */
export function hasCompoundValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(Boolean);
  if (value && typeof value === "object") return Object.values(value).some(Boolean);
  return false;
}
