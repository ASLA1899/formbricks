import { TOrganizationRole } from "@formbricks/types/memberships";
import { TOrganization } from "@formbricks/types/organizations";
import { IS_FORMBRICKS_CLOUD } from "@/lib/constants";
<<<<<<< HEAD
import { getAccessFlags } from "@/lib/membership/utils";
=======
import { getSurveyAccessMembership } from "@/lib/survey/access";
import { getTranslate } from "@/lingodotdev/server";
>>>>>>> origin/main
import { MembersInfo } from "@/modules/organization/settings/teams/components/edit-memberships/members-info";
import { getInvitesByOrganizationId } from "@/modules/organization/settings/teams/lib/invite";
import { getMembershipByOrganizationId } from "@/modules/organization/settings/teams/lib/membership";

interface EditMembershipsProps {
  organization: TOrganization;
  currentUserId: string;
  role: TOrganizationRole;
  isAccessControlAllowed: boolean;
  isUserManagementDisabledFromUi: boolean;
}

/**
 * The column headers used to live here, hand-rolled as a `grid-cols-12` of divs, while the rows lived in
 * `MembersInfo` — two files repeating the same `col-span-*` sequence and the same two feature flags. They
 * are now one column array in `MembersInfo`, which is where the flags already were.
 */
export const EditMemberships = async ({
  organization,
  currentUserId,
  role,
  isAccessControlAllowed,
  isUserManagementDisabledFromUi,
}: EditMembershipsProps) => {
  const members = await getMembershipByOrganizationId(organization.id);
  const invites = await getInvitesByOrganizationId(organization.id);
<<<<<<< HEAD

  if (!role) return null;

  // Last sign-in is for Owners and Managers only (ENG-3317). Strip it here rather than hiding a column, so
  // it never reaches anyone else's page payload.
  const { isOwner, isManager } = getAccessFlags(role);
  const visibleMembers =
    isOwner || isManager ? members : members.map((member) => ({ ...member, lastLoginAt: undefined }));

  return (
    <MembersInfo
      organization={organization}
      currentUserId={currentUserId}
      invites={invites ?? []}
      members={visibleMembers}
      currentUserRole={role}
      isAccessControlAllowed={isAccessControlAllowed}
      isFormbricksCloud={IS_FORMBRICKS_CLOUD}
      isUserManagementDisabledFromUi={isUserManagementDisabledFromUi}
    />
=======
  const callerSurveyAdminRow = await getSurveyAccessMembership(currentUserId, organization.id);
  // OrganizationRole is unreliable in non-EE (every member defaults to "owner"),
  // so only existing surveyAdmins can promote/demote others. Bootstrap is via SQL.
  const callerCanManageSurveyAdmin = callerSurveyAdminRow?.surveyAdmin === true;
  const t = await getTranslate();

  return (
    <div>
      <div className="rounded-lg border border-slate-200">
        <div className="grid h-12 w-full max-w-full grid-cols-12 items-center gap-x-4 rounded-t-lg bg-slate-100 px-4 text-left text-sm font-semibold text-slate-900">
          <div className="col-span-2 overflow-hidden">{t("common.full_name")}</div>
          <div className="col-span-3 overflow-hidden">{t("common.email")}</div>

          {isAccessControlAllowed && <div className="col-span-2 whitespace-nowrap">{t("common.role")}</div>}

          <div className="col-span-2 whitespace-nowrap">Survey Admin</div>

          <div className="col-span-2 whitespace-nowrap">{t("common.status")}</div>

          {!isUserManagementDisabledFromUi && (
            <div className="col-span-3 whitespace-nowrap text-center">{t("common.actions")}</div>
          )}
        </div>

        {role && (
          <MembersInfo
            organization={organization}
            currentUserId={currentUserId}
            invites={invites ?? []}
            members={members ?? []}
            currentUserRole={role}
            callerCanManageSurveyAdmin={callerCanManageSurveyAdmin}
            isAccessControlAllowed={isAccessControlAllowed}
            isFormbricksCloud={IS_FORMBRICKS_CLOUD}
            isUserManagementDisabledFromUi={isUserManagementDisabledFromUi}
          />
        )}
      </div>
    </div>
>>>>>>> origin/main
  );
};
