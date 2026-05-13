import { OrganizationAccessType } from "@formbricks/types/api-key";
import type { TAuthenticationApiKey } from "@formbricks/types/auth";
import { TOrganization } from "@formbricks/types/organizations";
import { TSurveyCreateInputWithEnvironmentId } from "@formbricks/types/surveys/types";
import { responses } from "@/app/lib/api/response";
import { getIsSpamProtectionEnabled, getMultiLanguagePermission } from "@/modules/ee/license-check/lib/utils";
import { hasOrganizationAccess, hasPermission } from "@/modules/organization/settings/api-keys/lib/utils";
import { getSurveyFollowUpsPermission } from "@/modules/survey/follow-ups/lib/utils";
import { getEnvironmentIdsByOrganizationId } from "./environment";

export const getReadableEnvironmentIds = async (
  authentication: TAuthenticationApiKey
): Promise<string[] | null> => {
  if (hasOrganizationAccess(authentication, OrganizationAccessType.Read)) {
    return getEnvironmentIdsByOrganizationId(authentication.organizationId);
  }

  const environmentIds = authentication.environmentPermissions
    .filter((permission) =>
      hasPermission(authentication.environmentPermissions, permission.environmentId, "GET")
    )
    .map((permission) => permission.environmentId);

  const readableEnvironmentIds = Array.from(new Set(environmentIds));

  return readableEnvironmentIds.length > 0 ? readableEnvironmentIds : null;
};

export const checkFeaturePermissions = async (
  surveyData: TSurveyCreateInputWithEnvironmentId,
  organization: TOrganization
): Promise<Response | null> => {
  if (surveyData.recaptcha?.enabled) {
    const isSpamProtectionEnabled = await getIsSpamProtectionEnabled(organization.billing.plan);
    if (!isSpamProtectionEnabled) {
      return responses.forbiddenResponse("Spam protection is not enabled for this organization");
    }
  }

  if (surveyData.followUps?.length) {
    const isSurveyFollowUpsEnabled = await getSurveyFollowUpsPermission(organization.billing.plan);
    if (!isSurveyFollowUpsEnabled) {
      return responses.forbiddenResponse("Survey follow ups are not allowed for this organization");
    }
  }

  if (surveyData.languages?.length) {
    const isMultiLanguageEnabled = await getMultiLanguagePermission(organization.billing.plan);
    if (!isMultiLanguageEnabled) {
      return responses.forbiddenResponse("Multi language is not enabled for this organization");
    }
  }

  return null;
};
