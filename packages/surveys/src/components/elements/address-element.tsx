import { useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { FormField, type FormFieldConfig } from "@formbricks/survey-ui";
import { type TResponseData, type TResponseTtc } from "@formbricks/types/responses";
import { ADDRESS_DISPLAY_FIELDS, ADDRESS_FIELDS } from "@formbricks/types/surveys/compound-fields";
import type { TSurveyAddressElement } from "@formbricks/types/surveys/elements";
import { getLocalizedValue } from "@/lib/i18n";
import { getUpdatedTtc, useTtc } from "@/lib/ttc";

interface AddressElementProps {
  element: TSurveyAddressElement;
  value?: string[];
  onChange: (responseData: TResponseData) => void;
  languageCode: string;
  ttc: TResponseTtc;
  setTtc: (ttc: TResponseTtc) => void;
  currentElementId: string;
  autoFocusEnabled: boolean;
  dir?: "ltr" | "rtl" | "auto";
  errorMessage?: string;
}

export function AddressElement({
  element,
  value,
  onChange,
  languageCode,
  ttc,
  setTtc,
  currentElementId,
  dir = "auto",
  errorMessage,
}: Readonly<AddressElementProps>) {
  const [startTime, setStartTime] = useState(performance.now());
  const isCurrent = element.id === currentElementId;
  const isRequired = element.required;
  const { t } = useTranslation();

  useTtc(element.id, ttc, setTtc, startTime, setStartTime, isCurrent);

  // Convert array value to object for FormField
  const convertToValueObject = (arrayValue: string[] | undefined): Record<string, string> => {
    if (!Array.isArray(arrayValue)) return {};

    const result: Record<string, string> = {};

    // Storage order (ADDRESS_FIELDS); older responses may be shorter, missing entries are empty.
    ADDRESS_FIELDS.forEach((fieldId, index) => {
      result[fieldId] = arrayValue[index] || "";
    });

    return result;
  };

  // Convert object value back to array for onChange
  const convertToValueArray = (objectValue: Record<string, string>): string[] => {
    return ADDRESS_FIELDS.map((fieldId) => objectValue[fieldId] || "");
  };

  const handleChange = (newValue: Record<string, string>) => {
    onChange({ [element.id]: convertToValueArray(newValue) });
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const updatedTtc = getUpdatedTtc(ttc, element.id, performance.now() - startTime);
    setTtc(updatedTtc);
  };

  // Convert element fields to FormFieldConfig, in display order (not storage order).
  // name/organization are absent on surveys created before they existed: treat as hidden.
  const formFields: FormFieldConfig[] = ADDRESS_DISPLAY_FIELDS.map((fieldId) => {
    const config = element[fieldId];
    return {
      id: fieldId,
      label: config?.placeholder[languageCode] ?? "",
      placeholder: config ? getLocalizedValue(config.placeholder, languageCode) : "",
      required: config?.required ?? false,
      show: config?.show ?? false,
    };
  });

  return (
    <form key={element.id} onSubmit={handleSubmit} className="w-full">
      <FormField
        elementId={element.id}
        headline={getLocalizedValue(element.headline, languageCode)}
        description={element.subheader ? getLocalizedValue(element.subheader, languageCode) : undefined}
        fields={formFields}
        value={convertToValueObject(value)}
        onChange={handleChange}
        required={isRequired}
        requiredLabel={t("common.required")}
        dir={dir}
        imageUrl={element.imageUrl}
        videoUrl={element.videoUrl}
        errorMessage={errorMessage}
      />
    </form>
  );
}
