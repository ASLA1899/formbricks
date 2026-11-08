"use client";

import { useTranslation } from "react-i18next";
import { TI18nString } from "@formbricks/types/i18n";
import { TSurveyElement } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { TUserLocale } from "@formbricks/types/user";
import { ElementFormInput } from "@/modules/survey/components/element-form-input";
import { PrefillFromSelect } from "@/modules/survey/editor/components/prefill-from-select";
import { Switch } from "@/modules/ui/components/switch";

interface ElementToggleTableProps {
  type: "address" | "contact";
  fields: {
    required: boolean;
    show: boolean;
    id: string;
    label: string;
    placeholder: TI18nString;
    prefillFrom?: string;
  }[];
  localSurvey: TSurvey;
  elementId: string;
  elementIdx: number;
  isInvalid: boolean;
  updateElement: (elementIdx: number, updatedAttributes: Partial<TSurveyElement>) => void;
  locale: TUserLocale;
  isStorageConfigured: boolean;
}

export const ElementToggleTable = ({
  type,
  fields,
  localSurvey,
  elementId,
  elementIdx,
  isInvalid,
  updateElement,
  locale,
  isStorageConfigured,
}: ElementToggleTableProps) => {
  const onShowToggle = (
    field: { id: string; show: boolean; required: boolean; placeholder: TI18nString; prefillFrom?: string },
    show: boolean
  ) => {
    updateElement(elementIdx, {
      [field.id]: {
        show,
        required: field.required,
        placeholder: field.placeholder,
        prefillFrom: field.prefillFrom,
      },
    });
  };

  const onRequiredToggle = (
    field: { id: string; show: boolean; required: boolean; placeholder: TI18nString; prefillFrom?: string },
    required: boolean
  ) => {
    updateElement(elementIdx, {
      [field.id]: {
        show: field.show,
        required,
        placeholder: field.placeholder,
        prefillFrom: field.prefillFrom,
      },
    });
  };

  const onPrefillFromChange = (
    field: { id: string; show: boolean; required: boolean; placeholder: TI18nString },
    prefillFrom: string | undefined
  ) => {
    updateElement(elementIdx, {
      [field.id]: {
        show: field.show,
        required: field.required,
        placeholder: field.placeholder,
        prefillFrom,
      },
    });
  };

  const { t } = useTranslation();
  return (
    <table className="mt-4 w-full table-fixed">
      <thead>
        <tr className="text-left text-slate-800">
          <th className="w-1/4 text-sm font-semibold">
            {type === "address"
              ? t("workspace.surveys.edit.address_fields")
              : t("workspace.surveys.edit.contact_fields")}
          </th>
          <th className="w-1/6 text-sm font-semibold">{t("common.show")}</th>
          <th className="w-1/6 text-sm font-semibold">{t("workspace.surveys.edit.required")}</th>
          <th className="text-sm font-semibold">{t("common.label")}</th>
          <th className="w-1/4 text-sm font-semibold">{t("workspace.surveys.edit.prefill_from")}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr className="text-slate-900" key={field.id}>
            <td className="py-2 text-sm">{field.label}</td>
            <td className="py-">
              <Switch
                checked={field.show}
                onCheckedChange={(show) => {
                  onShowToggle(field, show);
                }}
                disabled={
                  // if all the other fields are hidden, this should be disabled
                  fields.filter((currentField) => currentField.id !== field.id).every((field) => !field.show)
                }
              />
            </td>
            <td className="py-2">
              <Switch
                checked={field.required}
                onCheckedChange={(required) => {
                  onRequiredToggle(field, required);
                }}
                disabled={!field.show}
              />
            </td>
            <td className="py-2">
              <ElementFormInput
                id={`${field.id}.placeholder`}
                label={""}
                value={field.placeholder}
                localSurvey={localSurvey}
                elementIdx={elementIdx}
                isInvalid={isInvalid}
                updateElement={updateElement}
                locale={locale}
                isStorageConfigured={isStorageConfigured}
              />
            </td>
            <td className="py-2">
              {field.show ? (
                <PrefillFromSelect
                  localSurvey={localSurvey}
                  elementId={elementId}
                  value={field.prefillFrom}
                  onChange={(prefillFrom) => onPrefillFromChange(field, prefillFrom)}
                  className="h-8 text-xs"
                />
              ) : (
                <span className="text-xs text-slate-400">-</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
