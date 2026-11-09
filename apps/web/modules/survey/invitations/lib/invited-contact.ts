import "server-only";
import { prisma } from "@formbricks/database";
import { getOrganizationIdFromWorkspaceId } from "@/lib/utils/helper";
import { getIsContactsEnabled } from "@/modules/ee/license-check/lib/utils";

/**
 * The contactId a public client display or response may carry, or `undefined` to record it anonymously.
 *
 * ASLA fork (ASL-1877): the client API is unauthenticated and the contactId in the body is whatever the
 * caller sends. Upstream only accepts one with an Enterprise Contacts license. Without that license this
 * install accepts it only when the contact holds an invitation to *this* survey, which is how the
 * `/c/<token>` page got it. Anyone who could forge a response here could already open the invitee's link
 * and answer, so the check adds no new capability; it stops a known contactId from being used to answer
 * other surveys in the workspace, mark the member as responded, and stop their reminders.
 */
export const getInvitedContactId = async ({
  workspaceId,
  surveyId,
  contactId,
}: {
  workspaceId: string;
  surveyId: string;
  contactId: string | null | undefined;
}): Promise<string | undefined> => {
  if (!contactId) {
    return undefined;
  }

  const organizationId = await getOrganizationIdFromWorkspaceId(workspaceId);
  if (await getIsContactsEnabled(organizationId)) {
    return contactId;
  }

  const invitation = await prisma.surveyInvitation.findFirst({
    where: { surveyId, contactId, survey: { workspaceId } },
    select: { id: true },
  });

  return invitation ? contactId : undefined;
};
