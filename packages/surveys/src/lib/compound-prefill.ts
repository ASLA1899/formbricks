import { type TResponseData } from "@formbricks/types/responses";
import {
  ADDRESS_FIELDS,
  getCompoundSubFieldValue,
  hasCompoundValue,
} from "@formbricks/types/surveys/compound-fields";
import { TSurveyElement, TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";

const ADDRESS_FIELD_KEYS = ADDRESS_FIELDS;

type TFieldConfigWithPrefill = { prefillFrom?: string } | undefined;

/**
 * Resolves a prefillFrom source ID to a value from response data.
 *
 * Supports:
 * - Sub-field references: "questionId.firstName" -> reads from a contact info or address answer
 * - Direct question/hidden field references: "questionId" -> string value
 */
export function resolvePrefillSource(sourceId: string, responseData: TResponseData): string | undefined {
  if (sourceId.includes(".")) {
    const [baseId, fieldName] = sourceId.split(".", 2);
    return getCompoundSubFieldValue(responseData[baseId], fieldName);
  }

  const value = responseData[sourceId];
  if (typeof value === "string") return value || undefined;
  return undefined;
}

/**
 * Computes pre-fill values for elements based on their `prefillFrom` configuration.
 *
 * Supports:
 * - Contact info: per-field prefillFrom on each built-in and custom field; answer is an object keyed by field id
 * - Address: per-field prefillFrom on each sub-field; answer is a positional array in storage order
 * - OpenText: single prefillFrom on the element itself
 *
 * An element that already has an answer is never overwritten.
 */
export function computeConfiguredPrefill(
  blockElements: TSurveyElement[],
  responseData: TResponseData
): TResponseData {
  const prefill: TResponseData = {};

  for (const element of blockElements) {
    if (hasCompoundValue(responseData[element.id]) || responseData[element.id]) continue;

    if (element.type === TSurveyElementTypeEnum.ContactInfo) {
      const fieldConfigs: [string, TFieldConfigWithPrefill][] = [
        ["firstName", element.firstName],
        ["lastName", element.lastName],
        ["email", element.email],
        ["phone", element.phone],
        ["company", element.company],
        ...(element.customFields ?? []).map((cf): [string, TFieldConfigWithPrefill] => [cf.id, cf]),
      ];
      const values: Record<string, string> = {};
      for (const [fieldId, config] of fieldConfigs) {
        if (!config?.prefillFrom) continue;
        const resolved = resolvePrefillSource(config.prefillFrom, responseData);
        if (resolved) values[fieldId] = resolved;
      }
      if (Object.keys(values).length > 0) prefill[element.id] = values;
    } else if (element.type === TSurveyElementTypeEnum.Address) {
      const addressArray = new Array<string>(ADDRESS_FIELD_KEYS.length).fill("");
      let hasPrefill = false;
      ADDRESS_FIELD_KEYS.forEach((fieldKey, i) => {
        const config = (element as Record<string, unknown>)[fieldKey] as TFieldConfigWithPrefill;
        if (!config?.prefillFrom) return;
        const resolved = resolvePrefillSource(config.prefillFrom, responseData);
        if (resolved) {
          addressArray[i] = resolved;
          hasPrefill = true;
        }
      });
      if (hasPrefill) prefill[element.id] = addressArray;
    } else if (element.type === TSurveyElementTypeEnum.OpenText && element.prefillFrom) {
      const resolved = resolvePrefillSource(element.prefillFrom, responseData);
      if (resolved) prefill[element.id] = resolved;
    }
  }

  return prefill;
}

/** Configured (survey-author) pre-fill first, then URL pre-fill on top so a link parameter wins. */
export function getBlockPrefill(
  blockElements: TSurveyElement[],
  responseData: TResponseData,
  urlPrefill: TResponseData | undefined
): TResponseData | undefined {
  const configured = computeConfiguredPrefill(blockElements, responseData);
  if (Object.keys(configured).length === 0) return urlPrefill;
  return { ...configured, ...urlPrefill };
}

/**
 * Whether every element in a block has a URL pre-fill value, which is what lets `skipPrefilled`
 * auto-submit the block. Configured (`prefillFrom`) values are deliberately not counted: they are
 * suggestions for the respondent to confirm, and counting them would skip required fields unseen.
 */
export function isBlockFullyUrlPrefilled(
  blockElements: TSurveyElement[],
  urlPrefill: TResponseData | undefined
): boolean {
  if (!urlPrefill || blockElements.length === 0) return false;
  return blockElements.every((element) => urlPrefill[element.id] !== undefined);
}
