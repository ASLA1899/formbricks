import { useMemo, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { Matrix, type MatrixOption } from "@formbricks/survey-ui";
import { type TResponseData, type TResponseTtc } from "@formbricks/types/responses";
import type { TSurveyMatrixElement } from "@formbricks/types/surveys/elements";
import { htmlToPlainText } from "@/lib/html-utils";
import { getLocalizedValue } from "@/lib/i18n";
import { getUpdatedTtc, useTtc } from "@/lib/ttc";
import { getShuffledRowIndices } from "@/lib/utils";

interface MatrixElementProps {
  element: TSurveyMatrixElement;
  value: Record<string, string>;
  onChange: (responseData: TResponseData) => void;
  languageCode: string;
  ttc: TResponseTtc;
  setTtc: (ttc: TResponseTtc) => void;
  currentElementId: string;
  errorMessage?: string;
  dir?: "ltr" | "rtl" | "auto";
}

export function MatrixElement({
  element,
  value,
  onChange,
  languageCode,
  ttc,
  setTtc,
  currentElementId,
  errorMessage,
  dir = "auto",
}: Readonly<MatrixElementProps>) {
  const [startTime, setStartTime] = useState(performance.now());
  const isCurrent = element.id === currentElementId;
  const isRequired = element.required;
  const { t } = useTranslation();
  useTtc(element.id, ttc, setTtc, startTime, setStartTime, isCurrent);

  // Separate "other" row from regular rows
  const otherRow = useMemo(() => element.rows.find((r) => r.id === "other"), [element.rows]);
  const regularRows = useMemo(() => element.rows.filter((r) => r.id !== "other"), [element.rows]);

  const rowShuffleIdx = useMemo(() => {
    if (element.shuffleOption !== "none") {
      return getShuffledRowIndices(regularRows.length, element.shuffleOption);
    }
    return regularRows.map((_, id) => id);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- We only want to recompute when the shuffleOption changes
  }, [element.shuffleOption, regularRows.length]);

  const elementRows = useMemo(() => {
    if (!regularRows.length) {
      return [];
    }
    if (element.shuffleOption === "none") {
      return regularRows;
    }
    return rowShuffleIdx.map((shuffledIdx) => {
      return regularRows[shuffledIdx];
    });
  }, [element.shuffleOption, regularRows, rowShuffleIdx]);

  // Convert rows to MatrixOption format
  const rows: MatrixOption[] = useMemo(() => {
    return elementRows.map((row, index) => ({
      id: `row-${index}`,
      label: getLocalizedValue(row.label, languageCode),
    }));
  }, [elementRows, languageCode]);

  // Convert columns to MatrixOption format
  const columns: MatrixOption[] = useMemo(() => {
    return element.columns.map((column, index) => ({
      id: `col-${index}`,
      label: getLocalizedValue(column.label, languageCode),
    }));
  }, [element.columns, languageCode]);

  // Set of known regular row labels for detecting "other" responses
  const knownRowLabels = useMemo(() => {
    return new Set(rows.map((r) => r.label));
  }, [rows]);

  // Recover the "other" row's typed text and column from a stored response (hydration only)
  const recoverOther = (valueObj: Record<string, string>) => {
    if (otherRow) {
      for (const [rowLabel, columnLabel] of Object.entries(valueObj)) {
        if (columnLabel && rowLabel && !knownRowLabels.has(rowLabel)) {
          return { text: rowLabel, columnId: columns.find((col) => col.label === columnLabel)?.id };
        }
      }
    }
    return { text: "", columnId: undefined as string | undefined };
  };

  const [otherValue, setOtherValue] = useState(() => recoverOther(value).text);
  // The "other" row's selected column is tracked locally so the selection survives while the text is empty
  const [otherColumnId, setOtherColumnId] = useState<string | undefined>(() => recoverOther(value).columnId);

  // Convert value from row label -> column label mapping to row id -> column id mapping
  const convertValueToIds = (valueObj: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};

    Object.entries(valueObj).forEach(([rowLabel, columnLabel]) => {
      const rowId = rows.find((row) => row.label === rowLabel)?.id;
      const columnId = columns.find((col) => col.label === columnLabel)?.id;
      if (rowId && columnId) {
        result[rowId] = columnId;
      }
    });

    if (otherRow && otherColumnId) {
      result["other"] = otherColumnId;
    }

    return result;
  };

  // Build the row label -> column label response. The "other" row is only emitted when it has text that
  // does not collide with a regular row label.
  const buildLabelValue = (idValue: Record<string, string>, text: string): Record<string, string> => {
    const result: Record<string, string> = {};

    Object.entries(idValue).forEach(([rowId, columnId]) => {
      const columnLabel = columns.find((col) => col.id === columnId)?.label;
      if (!columnLabel) return;
      if (rowId === "other") {
        const trimmed = text.trim();
        if (trimmed && !knownRowLabels.has(trimmed)) {
          result[trimmed] = columnLabel;
        }
        return;
      }
      const rowLabel = rows.find((row) => row.id === rowId)?.label;
      if (rowLabel) result[rowLabel] = columnLabel;
    });

    return result;
  };

  const handleChange = (newValue: Record<string, string>) => {
    setOtherColumnId(newValue["other"]);
    onChange({ [element.id]: buildLabelValue(newValue, otherValue) });
  };

  const handleOtherValueChange = (newText: string) => {
    setOtherValue(newText);
    onChange({ [element.id]: buildLabelValue(convertValueToIds(value), newText) });
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    // Update TTC when form is submitted (for TTC collection)
    const updatedTtc = getUpdatedTtc(ttc, element.id, performance.now() - startTime);
    setTtc(updatedTtc);
  };

  const otherRowLabel = otherRow ? getLocalizedValue(otherRow.label, languageCode) : undefined;
  const otherRowPlaceholder = element.otherOptionPlaceholder
    ? getLocalizedValue(element.otherOptionPlaceholder, languageCode)
    : undefined;

  return (
    <form
      key={element.id}
      onSubmit={handleSubmit}
      className="w-full"
      aria-label={htmlToPlainText(getLocalizedValue(element.headline, languageCode))}>
      <Matrix
        dir={dir}
        elementId={element.id}
        inputId={element.id}
        headline={getLocalizedValue(element.headline, languageCode)}
        description={getLocalizedValue(element.subheader, languageCode)}
        rows={rows}
        columns={columns}
        value={convertValueToIds(value)}
        onChange={handleChange}
        required={isRequired}
        requiredLabel={t("common.required")}
        errorMessage={errorMessage}
        imageUrl={element.imageUrl}
        imageAltText={getLocalizedValue(element.imageAltText, languageCode)}
        videoUrl={element.videoUrl}
        otherRowId={otherRow ? "other" : undefined}
        otherRowLabel={otherRowLabel}
        otherRowPlaceholder={otherRowPlaceholder}
        otherRowValue={otherValue}
        onOtherRowValueChange={handleOtherValueChange}
      />
    </form>
  );
}
