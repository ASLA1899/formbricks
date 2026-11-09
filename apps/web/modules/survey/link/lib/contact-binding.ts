import "server-only";
import { createHmac } from "node:crypto";
import { logger } from "@formbricks/logger";
import { ENCRYPTION_KEY } from "@/lib/constants";
import { constantTimeEqual } from "@/lib/crypto";
import { getOrganizationIdFromWorkspaceId } from "@/lib/utils/helper";
import { getIsContactsEnabled } from "@/modules/ee/license-check/lib/utils";

/**
 * Binding a contactId to the survey it was handed out for (ASLA fork, ASL-1877).
 *
 * The public client API is unauthenticated, and the contactId in a display or response body is whatever the
 * caller sends. Upstream only accepts one with an Enterprise Contacts license. Without that license the
 * `/c/<token>` page mints this token next to the contactId it hands the browser, and the client API keeps a
 * contactId only when the token matches the survey being answered. A contactId read off one invitation link
 * therefore cannot answer a different survey, mark the member as responded there, or stop their reminders.
 *
 * The token does not expire: every load of the same link mints the same value, and the link holder can
 * always reload, so an expiry would add nothing.
 */

// Distinct from the single-use HMAC payload ("formbricks.single-use.v1:…") and from any JWT signing input
// (base64url never contains ":"), so no other value signed with ENCRYPTION_KEY can stand in for this one.
// Both ids are cuids, which never contain ":", so joining them is unambiguous.
const CONTACT_BINDING_PAYLOAD_PREFIX = "asla.contact-binding.v1";

export const CONTACT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const getSigningKey = (): string => {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  return ENCRYPTION_KEY;
};

export const generateContactBindingToken = (surveyId: string, contactId: string): string =>
  createHmac("sha256", getSigningKey())
    .update(`${CONTACT_BINDING_PAYLOAD_PREFIX}:${surveyId}:${contactId}`)
    .digest("hex");

export const isValidContactBindingToken = (
  surveyId: string,
  contactId: string,
  token: string | null | undefined
): boolean => {
  if (!token || !CONTACT_TOKEN_PATTERN.test(token)) {
    return false;
  }
  return constantTimeEqual(generateContactBindingToken(surveyId, contactId), token, "hex");
};

/**
 * The contactId a public client display or response may carry, or `undefined` to record it anonymously.
 * Licensed installs keep upstream's behavior; otherwise the contactId needs this survey's binding token.
 */
export const getBoundContactId = async ({
  workspaceId,
  surveyId,
  contactId,
  contactToken,
}: {
  workspaceId: string;
  surveyId: string;
  contactId: string | null | undefined;
  contactToken: string | null | undefined;
}): Promise<string | undefined> => {
  if (!contactId) {
    return undefined;
  }

  const organizationId = await getOrganizationIdFromWorkspaceId(workspaceId);
  if (await getIsContactsEnabled(organizationId)) {
    return contactId;
  }

  if (isValidContactBindingToken(surveyId, contactId, contactToken)) {
    return contactId;
  }

  // A contactId without a valid token is either tampering or a browser still running a survey bundle from
  // before this check shipped. Either way it is recorded anonymously; the warning is how a stale bundle
  // shows up after a deploy. Never log the token.
  logger.warn(
    { surveyId, hasContactToken: Boolean(contactToken) },
    "Client contactId without a valid binding token; recording anonymously"
  );
  return undefined;
};
