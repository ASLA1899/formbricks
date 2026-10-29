"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { PlusIcon } from "lucide-react";
import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TSurveyContactInfoElement, TSurveyElement } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { TUserLocale } from "@formbricks/types/user";
import { createI18nString, extractLanguageCodes } from "@/lib/i18n/utils";
import { ElementFormInput } from "@/modules/survey/components/element-form-input";
import { ValidationRulesEditor } from "@/modules/survey/editor/components/validation-rules-editor";
import { Button } from "@/modules/ui/components/button";
import { ElementToggleTable } from "@/modules/ui/components/element-toggle-table";
import { CustomFieldsSection } from "./custom-fields-section";

interface ContactInfoElementFormProps {
  localSurvey: TSurvey;
  element: TSurveyContactInfoElement;
  elementIdx: number;
  updateElement: (elementIdx: number, updatedAttributes: Partial<TSurveyElement>) => void;
  lastElement: boolean;
  isInvalid: boolean;
  locale: TUserLocale;
  isStorageConfigured: boolean;
  isExternalUrlsAllowed?: boolean;
}

export const ContactInfoElementForm = ({
  element,
  elementIdx,
  updateElement,
  isInvalid,
  localSurvey,
  locale,
  isStorageConfigured = true,
  isExternalUrlsAllowed,
}: ContactInfoElementFormProps): JSX.Element => {
  const { t } = useTranslation();
  const surveyLanguageCodes = extractLanguageCodes(localSurvey.languages ?? []);

  const fields = [
    {
      id: "firstName",
      label: t("workspace.surveys.edit.first_name"),
      ...element.firstName,
      prefillFrom: element.firstName.prefillFrom,
    },
    {
      id: "lastName",
      label: t("workspace.surveys.edit.last_name"),
      ...element.lastName,
      prefillFrom: element.lastName.prefillFrom,
    },
    {
      id: "email",
      label: t("common.email"),
      ...element.email,
      prefillFrom: element.email.prefillFrom,
    },
    {
      id: "phone",
      label: t("common.phone"),
      ...element.phone,
      prefillFrom: element.phone.prefillFrom,
    },
    {
      id: "company",
      label: t("workspace.surveys.edit.company"),
      ...element.company,
      prefillFrom: element.company.prefillFrom,
    },
  ];

  useEffect(() => {
    const builtInAllOptional = [
      element.firstName,
      element.lastName,
      element.email,
      element.phone,
      element.company,
    ]
      .filter((field) => field.show)
      .every((field) => !field.required);

<<<<<<< HEAD
    updateElement(elementIdx, { required: !allFieldsAreOptional });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-only effect; adding updateElement/elementIdx would loop as it writes back into the survey
  }, [element.firstName, element.lastName, element.email, element.phone, element.company]);
=======
    const customHasRequired = (element.customFields ?? []).some((cf) => cf.show && cf.required);

    updateElement(elementIdx, { required: !builtInAllOptional || customHasRequired });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.firstName, element.lastName, element.email, element.phone, element.company, element.customFields]);
>>>>>>> origin/main

  const [parent] = useAutoAnimate();

  return (
    <form>
      <ElementFormInput
        id="headline"
        value={element.headline}
        label={t("workspace.surveys.edit.question") + "*"}
        localSurvey={localSurvey}
        elementIdx={elementIdx}
        isInvalid={isInvalid}
        updateElement={updateElement}
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
            className="mt-4"
            type="button"
            onClick={() => {
              updateElement(elementIdx, {
                subheader: createI18nString("", surveyLanguageCodes),
              });
            }}>
            <PlusIcon className="mr-1 size-4" />
            {t("workspace.surveys.edit.add_description")}
          </Button>
        )}

        <ElementToggleTable
          type="contact"
          fields={fields}
          localSurvey={localSurvey}
          elementIdx={elementIdx}
          isInvalid={isInvalid}
          updateElement={updateElement}
          locale={locale}
          isStorageConfigured={isStorageConfigured}
        />

        <CustomFieldsSection
          localSurvey={localSurvey}
          element={element}
          elementIdx={elementIdx}
          updateElement={updateElement}
          isInvalid={isInvalid}
          selectedLanguageCode={selectedLanguageCode}
          setSelectedLanguageCode={setSelectedLanguageCode}
          locale={locale}
          isStorageConfigured={isStorageConfigured}
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
      />
    </form>
  );
};
