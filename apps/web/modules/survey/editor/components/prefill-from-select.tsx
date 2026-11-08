"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getPrefillSources } from "@/modules/survey/editor/lib/prefill-sources";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

const NONE_VALUE = "none";

interface PrefillFromSelectProps {
  localSurvey: TSurvey;
  elementId: string;
  value: string | undefined;
  onChange: (prefillFrom: string | undefined) => void;
  className?: string;
  id?: string;
}

/** Picks the earlier answer or hidden field that pre-populates a field. `undefined` means no pre-fill. */
export const PrefillFromSelect = ({
  localSurvey,
  elementId,
  value,
  onChange,
  className,
  id,
}: Readonly<PrefillFromSelectProps>) => {
  const { t } = useTranslation();
  const sources = useMemo(
    () =>
      getPrefillSources(localSurvey, elementId, "default", (name) =>
        t("workspace.surveys.edit.prefill_hidden_field_source", { name })
      ),
    [localSurvey, elementId, t]
  );
  // Keep a saved source selectable even when it can no longer be offered (e.g. its question moved
  // after this one), so opening the editor never silently drops it.
  const options =
    value && !sources.some((source) => source.id === value)
      ? [...sources, { id: value, label: value }]
      : sources;

  return (
    <Select
      value={value || NONE_VALUE}
      onValueChange={(next) => onChange(next === NONE_VALUE ? undefined : next)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={t("workspace.surveys.edit.prefill_from_none")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>{t("workspace.surveys.edit.prefill_from_none")}</SelectItem>
        {options.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            <span className="truncate text-xs">{source.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
