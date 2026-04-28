"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnMappingConfig, ColumnMatch } from "@/modules/contacts/lib/column-mapping";
import { Button } from "@/modules/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

// CSV column mapping modal — appears during CSV upload in the Recipients card
// when the auto-detect from `matchColumns` produced unmapped headers (or the
// CSV had columns beyond the obvious email/firstName/lastName trio). Lets the
// operator pick a destination per source header.
//
// Encoding mirrors the Snowflake sync-config-form (Task 8) so the two surfaces
// stay consistent:
//   "skip"               – ignore this column
//   "typed:email"        – Contact.email typed column
//   "typed:externalId"   – Contact.externalId typed column
//   "attr:<keyId>"       – ContactAttribute on the chosen ContactAttributeKey
//
// firstName/lastName are deliberately NOT typed targets — Phase 1a's Contact
// model has no typed firstName/lastName columns. The matcher already maps
// first/last header aliases to existing attribute keys when possible; if
// there's no matching key the column lands as `unmapped` and the operator can
// pick another attribute or skip.

export type AttributeKeyOption = { id: string; key: string };

interface CsvColumnMappingModalProps {
  headers: string[];
  initialMatches: ColumnMatch[];
  attributeKeys: AttributeKeyOption[];
  onConfirm: (mapping: ColumnMappingConfig) => void;
  onCancel: () => void;
}

// Convert auto-detect matches into the per-header Select string values.
function matchesToSelectValues(matches: ColumnMatch[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of matches) {
    if (m.kind === "typed") {
      // Phase 1a only routes email + externalId to typed columns. firstName/
      // lastName auto-detect hits arrive as `attribute` (via the matcher) when
      // a key exists; if no key exists the matcher returns `unmapped`. So a
      // `typed` match for first/lastName is unreachable in the current matcher,
      // but we defensively skip it to keep the Select coherent.
      if (m.column === "email" || m.column === "externalId") {
        out[m.sourceHeader] = `typed:${m.column}`;
      } else {
        out[m.sourceHeader] = "skip";
      }
    } else if (m.kind === "attribute") {
      out[m.sourceHeader] = `attr:${m.attributeKeyId}`;
    } else {
      out[m.sourceHeader] = "skip";
    }
  }
  return out;
}

// Reverse: per-header Select values → ColumnMappingConfig (the persisted shape).
function selectValuesToMapping(values: Record<string, string>): ColumnMappingConfig {
  const out: ColumnMappingConfig = {};
  for (const [header, val] of Object.entries(values)) {
    if (val === "typed:email") {
      out[header] = { kind: "typed", column: "email" };
    } else if (val === "typed:externalId") {
      out[header] = { kind: "typed", column: "externalId" };
    } else if (val.startsWith("attr:")) {
      out[header] = { kind: "attribute", attributeKeyId: val.slice("attr:".length) };
    } else {
      out[header] = { kind: "skip" };
    }
  }
  return out;
}

export function CsvColumnMappingModal({
  headers,
  initialMatches,
  attributeKeys,
  onConfirm,
  onCancel,
}: CsvColumnMappingModalProps) {
  const initialValues = useMemo(() => matchesToSelectValues(initialMatches), [initialMatches]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  // Highlight which headers came in unmapped from auto-detect — the operator's
  // attention should land on these first (they're the rows where they need to
  // make a real decision, vs. confirming an obvious match).
  const unmappedSet = useMemo(
    () => new Set(initialMatches.filter((m) => m.kind === "unmapped").map((m) => m.sourceHeader)),
    [initialMatches]
  );

  const handleConfirm = () => {
    onConfirm(selectValuesToMapping(values));
  };

  // Escape closes the modal — the inline overlay doesn't get this for free
  // (radix Dialog would, but we deliberately avoided it to keep focus
  // semantics simple inside the survey-editor form context).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    // Inline overlay rather than the radix Dialog component — the Recipients
    // card lives inside a Collapsible+form context where focus traps from the
    // dialog primitive can fight the parent's keyboard handlers. A simple
    // fixed overlay with backdrop click-to-cancel is enough for this flow.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Map CSV columns">
      <div
        className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">Map CSV columns</h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick where each CSV column should land. Headers we couldn&apos;t auto-match are highlighted.
          Anything left as <em>Skip</em> won&apos;t be imported.
        </p>

        <div className="mt-4 space-y-2">
          {headers.map((header) => {
            const isUnmapped = unmappedSet.has(header);
            return (
              <div
                key={header}
                className={
                  "flex items-center gap-3 rounded border px-3 py-2 " +
                  (isUnmapped ? "border-amber-300 bg-amber-50" : "border-slate-200")
                }>
                <code className="min-w-[160px] flex-shrink-0 truncate font-mono text-xs text-slate-700">
                  {header}
                </code>
                <span className="text-slate-400">→</span>
                <div className="flex-1">
                  <Select
                    value={values[header] ?? "skip"}
                    onValueChange={(v) => setValues((prev) => ({ ...prev, [header]: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Skip" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip (don&apos;t import)</SelectItem>
                      <SelectItem value="typed:email">email (typed column)</SelectItem>
                      <SelectItem value="typed:externalId">externalId (typed column)</SelectItem>
                      {attributeKeys.map((k) => (
                        <SelectItem key={k.id} value={`attr:${k.id}`}>
                          attribute: {k.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Import with this mapping
          </Button>
        </div>
      </div>
    </div>
  );
}
