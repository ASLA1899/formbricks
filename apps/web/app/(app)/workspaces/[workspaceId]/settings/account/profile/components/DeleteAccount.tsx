"use client";

<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/settings/account/profile/components/DeleteAccount.tsx
import { useState } from "react";
=======
import type { Session } from "next-auth";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/settings/(account)/profile/components/DeleteAccount.tsx
import { useTranslation } from "react-i18next";
import type { Session } from "@formbricks/types/auth";
import { TOrganization } from "@formbricks/types/organizations";
import { TUser } from "@formbricks/types/user";
import { DeleteAccountModal } from "@/modules/account/components/DeleteAccountModal";
import {
  ACCOUNT_DELETION_SSO_REAUTH_ERROR_QUERY_PARAM,
  ACCOUNT_DELETION_SSO_REAUTH_FAILED_ERROR_CODE,
} from "@/modules/account/constants";
import { Button } from "@/modules/ui/components/button";
import { TooltipRenderer } from "@/modules/ui/components/tooltip";

interface DeleteAccountProps {
  session: Session | null;
  IS_FORMBRICKS_CLOUD: boolean;
  user: TUser;
  organizationsWithSingleOwner: TOrganization[];
<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/settings/account/profile/components/DeleteAccount.tsx
  isMultiOrgEnabled: boolean;
  requiresPasswordConfirmation: boolean;
=======
  accountDeletionError?: string | string[];
  isMultiOrgEnabled: boolean;
  requiresPasswordConfirmation: boolean;
  isSsoIdentityConfirmationDisabled: boolean;
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/settings/(account)/profile/components/DeleteAccount.tsx
}

export const DeleteAccount = ({
  session,
  IS_FORMBRICKS_CLOUD,
  user,
  organizationsWithSingleOwner,
  accountDeletionError,
  isMultiOrgEnabled,
  requiresPasswordConfirmation,
<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/settings/account/profile/components/DeleteAccount.tsx
=======
  isSsoIdentityConfirmationDisabled,
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/settings/(account)/profile/components/DeleteAccount.tsx
}: Readonly<DeleteAccountProps>) => {
  const [isModalOpen, setModalOpen] = useState(false);
  const isDeleteDisabled = !isMultiOrgEnabled && organizationsWithSingleOwner.length > 0;
  const { t } = useTranslation();
<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/settings/account/profile/components/DeleteAccount.tsx
=======
  const accountDeletionErrorCode = Array.isArray(accountDeletionError)
    ? accountDeletionError[0]
    : accountDeletionError;
  const hasShownAccountDeletionError = useRef(false);

  useEffect(() => {
    if (
      accountDeletionErrorCode !== ACCOUNT_DELETION_SSO_REAUTH_FAILED_ERROR_CODE ||
      hasShownAccountDeletionError.current
    ) {
      return;
    }

    hasShownAccountDeletionError.current = true;

    toast.error(t("environments.settings.profile.sso_identity_confirmation_failed"), {
      id: "account-deletion-sso-confirmation-error",
    });

    const url = new URL(globalThis.location.href);
    url.searchParams.delete(ACCOUNT_DELETION_SSO_REAUTH_ERROR_QUERY_PARAM);
    globalThis.history.replaceState(null, "", url.toString());
  }, [accountDeletionErrorCode, t]);
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/settings/(account)/profile/components/DeleteAccount.tsx

  if (!session) {
    return null;
  }

  return (
    <div>
      <DeleteAccountModal
        requiresPasswordConfirmation={requiresPasswordConfirmation}
        open={isModalOpen}
        setOpen={setModalOpen}
        user={user}
        isFormbricksCloud={IS_FORMBRICKS_CLOUD}
        organizationsWithSingleOwner={organizationsWithSingleOwner}
        isSsoIdentityConfirmationDisabled={isSsoIdentityConfirmationDisabled}
      />
      <p className="text-sm text-slate-700">
        <strong>{t("workspace.settings.profile.warning_cannot_undo")}</strong>
      </p>
      <TooltipRenderer
        shouldRender={isDeleteDisabled}
        tooltipContent={t("workspace.settings.profile.warning_cannot_delete_account")}>
        <Button
          className="mt-4"
          variant="destructive"
          size="sm"
          onClick={() => setModalOpen(!isModalOpen)}
          disabled={isDeleteDisabled}>
          {t("workspace.settings.profile.confirm_delete_my_account")}
        </Button>
      </TooltipRenderer>
    </div>
  );
};
