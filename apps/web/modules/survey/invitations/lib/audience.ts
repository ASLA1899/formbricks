import "server-only";
import { OperationNotAllowedError } from "@formbricks/types/errors";
import type { TInvitationAudience } from "@formbricks/types/surveys/types";
import { getContactsInSegment } from "@/modules/ee/contacts/lib/contacts";

export type TAudienceMember = {
  email: string;
  // Full name for the `{{recipientName}}` merge field. Derived from first+last
  // when both are available, or null if neither is known.
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  // If the audience comes from a Formbricks segment, we already have a Contact row.
  // Snowflake-sourced members get a Contact row created lazily at invitation-send time.
  existingContactId: string | null;
};

// Resolves a survey's configured audience into a flat list of recipient candidates.
// Email-less rows are filtered out — we can't invite someone without an address.
// Duplicates by email are collapsed to the first occurrence.
export async function resolveAudience(audience: TInvitationAudience): Promise<TAudienceMember[]> {
  if (audience.source === "segment") {
    return resolveSegmentAudience(audience.segmentId);
  }
  if (audience.source === "manualList") {
    return resolveManualListAudience(audience.recipients);
  }
  return resolveSnowflakeAudience(audience);
}

function resolveManualListAudience(
  recipients: { email: string; firstName?: string; lastName?: string }[]
): TAudienceMember[] {
  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const r of recipients) {
    const email = r.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const firstName = r.firstName?.trim() || null;
    const lastName = r.lastName?.trim() || null;
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;
    out.push({ email, name, firstName, lastName, existingContactId: null });
  }
  return out;
}

async function resolveSegmentAudience(segmentId: string): Promise<TAudienceMember[]> {
  const contacts = await getContactsInSegment(segmentId);
  if (!contacts) return [];

  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const contact of contacts) {
    const email = (contact.attributes?.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const firstName = contact.attributes?.firstName?.trim() || null;
    const lastName = contact.attributes?.lastName?.trim() || null;
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;
    out.push({
      email,
      name,
      firstName,
      lastName,
      existingContactId: contact.contactId,
    });
  }
  return out;
}

// The Snowflake audience source lives in the member-lookup service, which is not part of this build. The
// source stays valid in the stored config so existing configs still parse; resolving one fails loudly
// rather than queueing nobody.
function resolveSnowflakeAudience(
  _audience: Extract<TInvitationAudience, { source: "snowflake" }>
): Promise<TAudienceMember[]> {
  return Promise.reject(
    new OperationNotAllowedError("Snowflake audiences are not available on this instance")
  );
}
