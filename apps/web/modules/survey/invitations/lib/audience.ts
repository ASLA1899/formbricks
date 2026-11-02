import "server-only";
import { prisma } from "@formbricks/database";
import { AuthorizationError, OperationNotAllowedError } from "@formbricks/types/errors";
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
//
// `workspaceId` is the survey's workspace. A segment must belong to it: the config is client-supplied, and
// without the check a survey owner could name another workspace's segment and invite its contacts.
export async function resolveAudience(
  audience: TInvitationAudience,
  workspaceId: string
): Promise<TAudienceMember[]> {
  if (audience.source === "segment") {
    return resolveSegmentAudience(audience.segmentId, workspaceId);
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

async function resolveSegmentAudience(segmentId: string, workspaceId: string): Promise<TAudienceMember[]> {
  const segment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { workspaceId: true },
  });
  if (segment && segment.workspaceId !== workspaceId) {
    throw new AuthorizationError("Segment is not in this survey's workspace");
  }
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
