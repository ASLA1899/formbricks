"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { PlusIcon } from "lucide-react";
import { type JSX, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { COMPOUND_FIELD_LABELS, getCompoundFields } from "@formbricks/types/surveys/compound-fields";
import {
  type TSurveyElement,
  TSurveyElementTypeEnum,
  type TSurveyOpenTextElement,
  type TSurveyOpenTextElementInputType,
} from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getTextContent } from "@formbricks/types/surveys/validation";
import { TUserLocale } from "@formbricks/types/user";
import { createI18nString, extractLanguageCodes } from "@/lib/i18n/utils";
import { ElementFormInput } from "@/modules/survey/components/element-form-input";
import { ValidationRulesEditor } from "@/modules/survey/editor/components/validation-rules-editor";
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";
import { AdvancedOptionToggle } from "@/modules/ui/components/advanced-option-toggle";
import { Button } from "@/modules/ui/components/button";
import { Label } from "@/modules/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

interface OpenElementFormProps {
  localSurvey: TSurvey;
  element: TSurveyOpenTextElement;
  elementIdx: number;
  updateElement: (elementIdx: number, updatedAttributes: Partial<TSurveyElement>) => void;
  lastElement: boolean;
  selectedLanguageCode: string;
  setSelectedLanguageCode: (language: string) => void;
  isInvalid: boolean;
  locale: TUserLocale;
  isStorageConfigured: boolean;
  isExternalUrlsAllowed?: boolean;
}

export const OpenElementForm = ({
  element,
  elementIdx,
  updateElement,
  isInvalid,
  localSurvey,
  selectedLanguageCode,
  setSelectedLanguageCode,
  locale,
  isStorageConfigured = true,
  isExternalUrlsAllowed,
}: OpenElementFormProps): JSX.Element => {
  const { t } = useTranslation();
  const defaultPlaceholder = getPlaceholderByInputType(element.inputType ?? "text");
  const surveyLanguageCodes = extractLanguageCodes(localSurvey.languages ?? []);

  const allElements = useMemo(() => getElementsFromBlocks(localSurvey.blocks), [localSurvey.blocks]);

  // Build available pre-fill sources from earlier questions and hidden fields
  const prefillSources = useMemo(() => {
    const sources: { id: string; label: string }[] = [];
    const currentIdx = allElements.findIndex((e) => e.id === element.id);

    for (let i = 0; i < currentIdx; i++) {
      const el = allElements[i];
      const compoundFields = getCompoundFields(el.type);
      if (compoundFields) {
        const headline = getTextContent(el.headline[selectedLanguageCode] || el.id);
        for (const fieldName of compoundFields) {
          const fieldConfig = (el as Record<string, any>)[fieldName];
          if (fieldConfig?.show) {
            sources.push({
              id: `${el.id}.${fieldName}`,
              label: `${headline} > ${COMPOUND_FIELD_LABELS[fieldName] || fieldName}`,
            });
          }
        }
      }
      if (el.type === TSurveyElementTypeEnum.OpenText) {
        const headline = getTextContent(el.headline[selectedLanguageCode] || el.id);
        sources.push({ id: el.id, label: headline });
      }
    }

    if (localSurvey.hiddenFields.fieldIds) {
      for (const fieldId of localSurvey.hiddenFields.fieldIds) {
        sources.push({ id: fieldId, label: `Hidden: ${fieldId}` });
      }
    }

    return sources;
  }, [allElements, element.id, localSurvey.hiddenFields, selectedLanguageCode]);

  const [parent] = useAutoAnimate();

  return (
    <form>
      <ElementFormInput
        id="headline"
        value={element.headline}
        label={t("environments.surveys.edit.question") + "*"}
        localSurvey={localSurvey}
        elementIdx={elementIdx}
        isInvalid={isInvalid}
        updateElement={updateElement}
        selectedLanguageCode={selectedLanguageCode}
        setSelectedLanguageCode={setSelectedLanguageCode}
        locale={locale}
        isStorageConfigured={isStorageConfigured}
        autoFocus={!element.headline?.default || element.headline.default.trim() === ""}
        isExternalUrlsAllowed={isExternalUrlsAllowed}
      />

      <div ref={parent}>
        {element.subheader !== undefined && (
          <div className="inline-flex w-full items-center">
            <div className="w-full">
              <ElementFormInput
                id="subheader"
                value={element.subheader}
                label={t("common.description")}
                localSurvey={localSurvey}
                elementIdx={elementIdx}
                isInvalid={isInvalid}
                updateElement={updateElement}
                selectedLanguageCode={selectedLanguageCode}
                setSelectedLanguageCode={setSelectedLanguageCode}
                locale={locale}
                isStorageConfigured={isStorageConfigured}
                autoFocus={!element.subheader?.default || element.subheader.default.trim() === ""}
                isExternalUrlsAllowed={isExternalUrlsAllowed}
              />
            </div>
          </div>
        )}
        {element.subheader === undefined && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            type="button"
            onClick={() => {
              updateElement(elementIdx, {
                subheader: createI18nString("", surveyLanguageCodes),
              });
            }}>
            <PlusIcon className="mr-1 h-4 w-4" />
            {t("environments.surveys.edit.add_description")}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <ElementFormInput
          id="placeholder"
          value={
            element.placeholder
              ? element.placeholder
              : createI18nString(defaultPlaceholder, surveyLanguageCodes)
          }
          localSurvey={localSurvey}
          elementIdx={elementIdx}
          isInvalid={isInvalid}
          updateElement={updateElement}
          selectedLanguageCode={selectedLanguageCode}
          setSelectedLanguageCode={setSelectedLanguageCode}
          label={t("common.placeholder")}
          locale={locale}
          isStorageConfigured={isStorageConfigured}
        />
      </div>

      {/* Pre-fill from source (ASLA recall/prefill — fork-local) */}
      {prefillSources.length > 0 && (
        <div className="mt-3">
          <Label htmlFor="prefillFrom">Pre-fill from</Label>
          <Select
            value={element.prefillFrom || "none"}
            onValueChange={(val) =>
              updateElement(elementIdx, { prefillFrom: val === "none" ? undefined : val })
            }>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {prefillSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mt-6 space-y-6">
        <div className="mt-4">
          <AdvancedOptionToggle
            isChecked={element.longAnswer !== false}
            onToggle={(checked: boolean) => {
              updateElement(elementIdx, {
                longAnswer: checked,
              });
            }}
            htmlId={`longAnswer-${element.id}`}
            title={t("environments.surveys.edit.long_answer")}
            description={t("environments.surveys.edit.long_answer_toggle_description")}
            disabled={element.inputType !== "text"}
            customContainerClass="p-0"
          />
        </div>

        <ValidationRulesEditor
          elementType={element.type}
          validation={element.validation}
          onUpdateValidation={(validation) => {
            updateElement(elementIdx, {
              validation,
            });
          }}
          inputType={element.inputType ?? "text"}
          onUpdateInputType={(newInputType) => {
            updateElement(elementIdx, {
              inputType: newInputType,
              longAnswer: newInputType === "text",
            });
          }}
        />
      </div>
    </form>
  );
};

const getPlaceholderByInputType = (inputType: TSurveyOpenTextElementInputType) => {
  switch (inputType) {
    case "email":
      return "example@email.com";
    case "url":
      return "https://...";
    case "number":
      return "42";
    case "phone":
      return "+1 123 456 789";
    default:
      return "Type your answer here...";
  }
};
