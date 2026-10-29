import { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthenticationError } from "@formbricks/types/errors";
<<<<<<< HEAD
import { IS_FORMBRICKS_CLOUD } from "@/lib/constants";
import { getHasNoOrganizations } from "@/lib/instance/service";
=======
import { DISABLE_ACCOUNT_DELETION_SSO_CONFIRMATION, IS_FORMBRICKS_CLOUD } from "@/lib/constants";
import { gethasNoOrganizations } from "@/lib/instance/service";
>>>>>>> origin/main
import { getOrganizationsByUserId } from "@/lib/organization/service";
import { getUser } from "@/lib/user/service";
import { getTranslate } from "@/lingodotdev/server";
import { requiresPasswordConfirmationForAccountDeletion } from "@/modules/account/lib/account-deletion-auth";
<<<<<<< HEAD
import { getSession } from "@/modules/auth/lib/session";
=======
import { authOptions } from "@/modules/auth/lib/authOptions";
>>>>>>> origin/main
import { getIsMultiOrgEnabled } from "@/modules/ee/license-check/lib/utils";
import { RemovedFromOrganization } from "@/modules/setup/organization/create/components/removed-from-organization";
import { ClientLogout } from "@/modules/ui/components/client-logout";
import { CreateOrganization } from "./components/create-organization";

export const metadata: Metadata = {
  title: "Create Organization",
  description: "Open-source Experience Management. Free & open source.",
};

export const CreateOrganizationPage = async () => {
  const t = await getTranslate();
  const session = await getSession();

  if (!session) throw new AuthenticationError(t("common.session_not_found"));

  const user = await getUser(session.user.id);
  if (!user) {
    return <ClientLogout />;
  }

  const hasNoOrganizations = await getHasNoOrganizations();
  const isMultiOrgEnabled = await getIsMultiOrgEnabled();
  const userOrganizations = await getOrganizationsByUserId(session.user.id);

  if (hasNoOrganizations || isMultiOrgEnabled) {
    return <CreateOrganization />;
  }

  if (userOrganizations.length === 0) {
    return (
      <RemovedFromOrganization
        user={user}
        isFormbricksCloud={IS_FORMBRICKS_CLOUD}
<<<<<<< HEAD
=======
        isSsoIdentityConfirmationDisabled={DISABLE_ACCOUNT_DELETION_SSO_CONFIRMATION}
>>>>>>> origin/main
        requiresPasswordConfirmation={requiresPasswordConfirmationForAccountDeletion(user)}
      />
    );
  }

  return notFound();
};
