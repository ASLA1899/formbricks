"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { TMember, TOrganizationRole } from "@formbricks/types/memberships";
import { TOrganization } from "@formbricks/types/organizations";
import { getAccessFlags } from "@/lib/membership/utils";
import { getFormattedDateTimeString } from "@/lib/utils/datetime";
import { EditMembershipRole } from "@/modules/ee/role-management/components/edit-membership-role";
import { setMembershipSurveyAdminAction } from "@/modules/organization/settings/teams/actions";
import { MemberActions } from "@/modules/organization/settings/teams/components/edit-memberships/member-actions";
import { isInviteExpired } from "@/modules/organization/settings/teams/lib/utils";
import { TInvite } from "@/modules/organization/settings/teams/types/invites";
import { Badge } from "@/modules/ui/components/badge";
import { Switch } from "@/modules/ui/components/switch";
import { TooltipRenderer } from "@/modules/ui/components/tooltip";

interface MembersInfoProps {
  organization: TOrganization;
  members: TMember[];
  invites: TInvite[];
  currentUserRole: TOrganizationRole;
  currentUserId: string;
  callerCanManageSurveyAdmin: boolean;
  isAccessControlAllowed: boolean;
  isFormbricksCloud: boolean;
  isUserManagementDisabledFromUi: boolean;
}

// Type guard to check if member is an invitee
const isInvitee = (member: TMember | TInvite): member is TInvite => {
  return (member as TInvite).expiresAt !== undefined;
};

export const MembersInfo = ({
  organization,
  invites,
  currentUserRole,
  members,
  currentUserId,
  callerCanManageSurveyAdmin,
  isAccessControlAllowed,
  isFormbricksCloud,
  isUserManagementDisabledFromUi,
}: MembersInfoProps) => {
  const allMembers = [...members, ...invites];
  const { t } = useTranslation();

  const [surveyAdminState, setSurveyAdminState] = useState<Record<string, boolean>>(
    Object.fromEntries(members.map((m) => [m.userId, m.surveyAdmin]))
  );

  const onToggleSurveyAdmin = async (userId: string, next: boolean) => {
    const prev = surveyAdminState[userId] ?? false;
    setSurveyAdminState({ ...surveyAdminState, [userId]: next });
    const res = await setMembershipSurveyAdminAction({
      organizationId: organization.id,
      userId,
      surveyAdmin: next,
    });
    if (res?.data) {
      toast.success(next ? "Granted survey admin" : "Revoked survey admin");
    } else {
      setSurveyAdminState((s) => ({ ...s, [userId]: prev }));
      toast.error("Failed to update survey admin");
    }
  };

  const getMembershipBadge = (member: TMember | TInvite) => {
    if (isInvitee(member)) {
      return isInviteExpired(member) ? (
        <Badge type="gray" text="Expired" size="tiny" data-testid="expired-badge" />
      ) : (
        <TooltipRenderer
          tooltipContent={`${t("environments.settings.general.invited_on", {
            date: getFormattedDateTimeString(member.createdAt),
          })}`}>
          <Badge type="warning" text="Pending" size="tiny" />
        </TooltipRenderer>
      );
    }

    if (!member.isActive) {
      return <Badge type="gray" text="Inactive" size="tiny" />;
    }

    return <Badge type="success" text="Active" size="tiny" />;
  };

  const { isOwner, isManager } = getAccessFlags(currentUserRole);
  const isOwnerOrManager = isOwner || isManager;

  const doesOrgHaveMoreThanOneOwner = allMembers.filter((member) => member.role === "owner").length > 1;

  const showDeleteButton = (member: TMember | TInvite) => {
    if (isInvitee(member)) {
      return isOwnerOrManager;
    }

    if (!isOwnerOrManager) {
      return false;
    }

    if (member.userId === currentUserId) {
      return false;
    }

    if (isManager) {
      return member.role !== "owner";
    }

    if (member.role === "owner") {
      return doesOrgHaveMoreThanOneOwner;
    }

    return true;
  };

  return (
    <div className="max-w-full space-y-4 px-4 py-3" id="membersInfoWrapper">
      {allMembers.map((member) => (
        <div
          id="singleMemberInfo"
          className="flex w-full max-w-full items-center gap-x-4 text-left text-sm text-slate-900"
          key={member.email}>
          <div className="ph-no-capture w-1/2 overflow-hidden">
            <p className="w-full truncate">{member.name}</p>
          </div>
          <div className="ph-no-capture w-1/2 overflow-hidden">
            <p className="w-full truncate"> {member.email}</p>
          </div>

          {isAccessControlAllowed && allMembers?.length > 0 && (
            <div className="ph-no-capture min-w-[100px]">
              <EditMembershipRole
                currentUserRole={currentUserRole}
                memberRole={member.role}
                memberId={!isInvitee(member) ? member.userId : ""}
                organizationId={organization.id}
                userId={currentUserId}
                memberAccepted={!isInvitee(member) ? member.accepted : undefined}
                inviteId={isInvitee(member) ? member.id : ""}
                doesOrgHaveMoreThanOneOwner={doesOrgHaveMoreThanOneOwner}
                isFormbricksCloud={isFormbricksCloud}
                isUserManagementDisabledFromUi={isUserManagementDisabledFromUi}
              />
            </div>
          )}

          <div className="min-w-[110px]">
            {isInvitee(member) ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              <Switch
                checked={surveyAdminState[member.userId] ?? false}
                onCheckedChange={(next) => void onToggleSurveyAdmin(member.userId, next)}
                disabled={!callerCanManageSurveyAdmin || member.userId === currentUserId}
                aria-label={`Toggle survey admin for ${member.name}`}
              />
            )}
          </div>

          <div className="min-w-[80px]">{getMembershipBadge(member)}</div>

          {!isUserManagementDisabledFromUi && (
            <MemberActions
              organization={organization}
              member={!isInvitee(member) ? member : undefined}
              invite={isInvitee(member) ? member : undefined}
              showDeleteButton={showDeleteButton(member)}
            />
          )}
        </div>
      ))}
    </div>
  );
};
