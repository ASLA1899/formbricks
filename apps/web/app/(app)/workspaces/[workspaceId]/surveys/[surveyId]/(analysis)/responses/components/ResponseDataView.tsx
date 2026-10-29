"use client";

import { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { getComputedEmbeddedFields, getIngestedStorageKeys } from "@formbricks/types/embedded-data-resolver";
import { TSurveyQuota } from "@formbricks/types/quota";
import { TResponseDataValue, TResponseTableData, TResponseWithQuotas } from "@formbricks/types/responses";
import { ADDRESS_FIELDS } from "@formbricks/types/surveys/compound-fields";
import type { TSurveyAddressElement } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { TTag } from "@formbricks/types/tags";
import { TUser, TUserLocale } from "@formbricks/types/user";
import { ResponseTable } from "@/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/responses/components/ResponseTable";
import { getReservedColumnValues } from "@/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/responses/lib/utils";
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";

interface ResponseDataViewProps {
  survey: TSurvey;
  responses: TResponseWithQuotas[];
  user?: TUser;
  environmentTags: TTag[];
  isReadOnly: boolean;
  fetchNextPage: () => void;
  hasMore: boolean;
  updateResponseList: (responseIds: string[]) => void;
  updateResponse: (responseId: string, updatedResponse: TResponseWithQuotas) => void;
  isFetchingFirstPage: boolean;
  locale: TUserLocale;
  isQuotasAllowed: boolean;
  quotas: TSurveyQuota[];
}

// Helper function to format array values to record with specified keys
const formatArrayToRecord = (responseValue: TResponseDataValue, keys: string[]): Record<string, string> => {
  if (!Array.isArray(responseValue)) return {};
  const result: Record<string, string> = {};
  for (let index = 0; index < responseValue.length; index++) {
    const curr = responseValue[index];
    result[keys[index]] = curr || "";
  }
  return result;
};

<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/responses/components/ResponseDataView.tsx
const formatAddressData = (responseValue: TResponseDataValue): Record<string, string> => {
  const addressKeys = ["addressLine1", "addressLine2", "city", "state", "zip", "country"];
  return formatArrayToRecord(responseValue, addressKeys);
};

const formatContactInfoData = (responseValue: TResponseDataValue): Record<string, string> => {
=======
// Export for testing
export const formatAddressData = (
  responseValue: TResponseDataValue,
  element?: TSurveyAddressElement
): Record<string, string> => {
  // Storage order; arrays from before name/organization existed are shorter and leave them unset.
  const result = formatArrayToRecord(responseValue, [...ADDRESS_FIELDS]);
  // These keys are flattened into one shared record, so only emit name/organization when the survey
  // shows them. Otherwise an empty value could shadow another element whose id is "name"/"organization".
  if (element) {
    if (!element.name?.show) delete result.name;
    if (!element.organization?.show) delete result.organization;
  }
  return result;
};

// Export for testing
export const formatContactInfoData = (responseValue: TResponseDataValue): Record<string, string> => {
  // Handle new object format (from custom fields feature)
  if (responseValue && typeof responseValue === "object" && !Array.isArray(responseValue)) {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(responseValue)) {
      result[key] = String(val || "");
    }
    return result;
  }
  // Handle legacy array format
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/responses/components/ResponseDataView.tsx
  const contactInfoKeys = ["firstName", "lastName", "email", "phone", "company"];
  return formatArrayToRecord(responseValue, contactInfoKeys);
};

const extractResponseData = (response: TResponseWithQuotas, survey: TSurvey): Record<string, any> => {
  const responseData: Record<string, any> = {};

  const elements = getElementsFromBlocks(survey.blocks);

  for (const element of elements) {
    const responseValue = response.data[element.id];
    switch (element.type) {
      case "matrix":
        if (typeof responseValue === "object") {
          Object.assign(responseData, responseValue);
        }
        break;
      case "address":
        Object.assign(responseData, formatAddressData(responseValue, element as TSurveyAddressElement));
        break;
      case "contactInfo":
        Object.assign(responseData, formatContactInfoData(responseValue));
        break;
      default:
        responseData[element.id] = responseValue;
    }
  }

  for (const fieldId of getIngestedStorageKeys(survey)) {
    responseData[fieldId] = response.data[fieldId];
  }

  return responseData;
};

// Export for testing
const mapResponsesToTableData = (
  responses: TResponseWithQuotas[],
  survey: TSurvey,
  t: TFunction
): TResponseTableData[] => {
  return responses.map((response) => ({
    responseData: extractResponseData(response, survey),
    createdAt: response.createdAt,
    completedAt: response.finished ? response.updatedAt : null,
    duration:
      typeof response.ttc?._total === "number" && response.ttc._total > 0 ? response.ttc._total : null,
    status: response.finished
      ? t("workspace.surveys.responses.completed")
      : t("workspace.surveys.responses.not_completed"),
    responseId: response.id,
    singleUseId: response.singleUseId,
    tags: response.tags,
    // The raw slot, uncoerced: a response predating a field has no key and the cell stays empty.
    variables: getComputedEmbeddedFields(survey).reduce(
      (acc, { link }) => {
        return Object.assign(acc, { [link.storageKey]: response.variables[link.storageKey] });
      },
      {} as Record<string, string | number>
    ),
    verifiedEmail: typeof response.data["verifiedEmail"] === "string" ? response.data["verifiedEmail"] : "",
    language: response.language,
    person: response.contact,
    contactAttributes: response.contactAttributes,
    meta: response.meta,
    // Resolved here, where the whole response is in hand, so the cells stay dumb lookups.
    reservedValues: getReservedColumnValues(response),
    quotas: response.quotas?.map((quota) => quota.name),
  }));
};

export const ResponseDataView: React.FC<ResponseDataViewProps> = ({
  survey,
  responses,
  user,
  environmentTags,
  isReadOnly,
  fetchNextPage,
  hasMore,
  updateResponseList,
  updateResponse,
  isFetchingFirstPage,
  locale,
  isQuotasAllowed,
  quotas,
}) => {
  const { t } = useTranslation();
  const [selectedResponseId, setSelectedResponseId] = React.useState<string | null>(null);
  const setSelectedResponseIdTransition = React.useCallback((id: string | null) => {
    React.startTransition(() => setSelectedResponseId(id));
  }, []);
  const data = mapResponsesToTableData(responses, survey, t);

  return (
    <div className="w-full">
      <ResponseTable
        data={data}
        survey={survey}
        responses={responses}
        user={user}
        environmentTags={environmentTags}
        isReadOnly={isReadOnly}
        fetchNextPage={fetchNextPage}
        hasMore={hasMore}
        updateResponseList={updateResponseList}
        updateResponse={updateResponse}
        isFetchingFirstPage={isFetchingFirstPage}
        locale={locale}
        isQuotasAllowed={isQuotasAllowed}
        quotas={quotas}
        selectedResponseId={selectedResponseId}
        setSelectedResponseId={setSelectedResponseIdTransition}
      />
    </div>
  );
};
