import { getIngestedEmbeddedFields } from "@formbricks/types/embedded-data-resolver";
import { COMPOUND_FIELD_LABELS, getCompoundFields } from "@formbricks/types/surveys/compound-fields";
import { TSurveyElement, TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getTextContent } from "@formbricks/types/surveys/validation";
import { getLocalizedValue } from "@/lib/i18n/utils";
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";

export interface TPrefillSource {
  id: string;
  label: string;
}

type TFieldConfig = { show?: boolean; label?: string; id?: string };

const headlineText = (element: TSurveyElement, languageCode: string): string => {
  const text = getTextContent(getLocalizedValue(element.headline, languageCode) ?? "");
  return text || element.id;
};

/**
 * The sources a field can pre-fill from: shown sub-fields (built-in and custom) of earlier contact
 * info and address questions, earlier open text questions, and the survey's hidden (ingested) fields.
 * Source ids use the recall convention: `questionId.fieldName`, `questionId`, or the storage key.
 */
export const getPrefillSources = (
  survey: TSurvey,
  currentElementId: string,
  languageCode: string,
  hiddenFieldLabel: (name: string) => string
): TPrefillSource[] => {
  const elements = getElementsFromBlocks(survey.blocks);
  const currentIdx = elements.findIndex((element) => element.id === currentElementId);
  const sources: TPrefillSource[] = [];

  for (const element of elements.slice(0, Math.max(currentIdx, 0))) {
    const headline = headlineText(element, languageCode);
    const compoundFields = getCompoundFields(element.type);
    if (compoundFields) {
      for (const fieldName of compoundFields) {
        const config = (element as unknown as Record<string, TFieldConfig | undefined>)[fieldName];
        if (config?.show) {
          sources.push({
            id: `${element.id}.${fieldName}`,
            label: `${headline} > ${COMPOUND_FIELD_LABELS[fieldName] ?? fieldName}`,
          });
        }
      }
      if (element.type === TSurveyElementTypeEnum.ContactInfo) {
        for (const customField of element.customFields ?? []) {
          if (customField.show) {
            sources.push({
              id: `${element.id}.${customField.id}`,
              label: `${headline} > ${customField.label}`,
            });
          }
        }
      }
    } else if (element.type === TSurveyElementTypeEnum.OpenText) {
      sources.push({ id: element.id, label: headline });
    }
  }

  for (const { field, link } of getIngestedEmbeddedFields(survey)) {
    sources.push({ id: link.storageKey, label: hiddenFieldLabel(field.name || link.storageKey) });
  }

  return sources;
};
