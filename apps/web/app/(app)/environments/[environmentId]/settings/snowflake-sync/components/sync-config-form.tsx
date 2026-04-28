"use client";

import { useMemo, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { getFormattedErrorMessage } from "@/lib/utils/helper";
import {
  type ColumnMappingConfig,
  matchColumns,
  parseColumnMappingConfig,
} from "@/modules/contacts/lib/column-mapping";
import { Button } from "@/modules/ui/components/button";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";
import { previewSnowflakeQueryAction, runSyncNowAction, saveSyncConfigAction } from "../actions";

// ---------------------------------------------------------------------------
// Encoding for the per-header destination Select.
//
// Persisted shape (ColumnMappingConfig in column-mapping.ts) uses a tagged
// union: `{ kind: "typed", column } | { kind: "attribute", attributeKeyId } |
// { kind: "skip" }`. The Select's `value` prop must be a single string, so
// we encode each destination as:
//   - "skip"
//   - "typed:email" / "typed:externalId"
//   - "attr:<attributeKeyId>"
//
// We deliberately do NOT offer "typed:firstName" / "typed:lastName" — the
// Phase 1a Contact model has no typed firstName/lastName columns. Operators
// must route those through attribute keys (or skip).
// ---------------------------------------------------------------------------

type AttributeKeyOption = { id: string; key: string };
type QueryConfigOption = { id: string; name: string; description?: string };

interface SyncConfigFormProps {
  environmentId: string;
  existingConfig: {
    id: string;
    snowflakeQueryId: string;
    columnMapping: unknown;
    intervalMinutes: number;
    enabled: boolean;
  } | null;
  attributeKeys: AttributeKeyOption[];
  availableQueries: QueryConfigOption[];
}

interface PreviewState {
  headers: string[];
  sample: Record<string, unknown>[];
  totalRows: number;
}

// Convert a saved/auto-detected mapping to the per-header string-encoded
// values the Select dropdowns hold.
function mappingToSelectValues(mapping: ColumnMappingConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, dest] of Object.entries(mapping)) {
    if (dest.kind === "skip") {
      out[header] = "skip";
    } else if (dest.kind === "typed") {
      // firstName/lastName legacy values get downgraded to "skip" — the form
      // no longer offers those typed targets, so we don't want them silently
      // round-tripping a value that can't be re-selected.
      if (dest.column === "email" || dest.column === "externalId") {
        out[header] = `typed:${dest.column}`;
      } else {
        out[header] = "skip";
      }
    } else {
      out[header] = `attr:${dest.attributeKeyId}`;
    }
  }
  return out;
}

// Reverse: take the per-header Select values and produce the persisted
// ColumnMappingConfig shape.
function selectValuesToMapping(values: Record<string, string>): ColumnMappingConfig {
  const out: ColumnMappingConfig = {};
  for (const [header, val] of Object.entries(values)) {
    if (val === "skip") {
      out[header] = { kind: "skip" };
    } else if (val === "typed:email") {
      out[header] = { kind: "typed", column: "email" };
    } else if (val === "typed:externalId") {
      out[header] = { kind: "typed", column: "externalId" };
    } else if (val.startsWith("attr:")) {
      out[header] = { kind: "attribute", attributeKeyId: val.slice("attr:".length) };
    } else {
      // Defensive fallback — should be unreachable since the Select only emits
      // values from the controlled option list above.
      out[header] = { kind: "skip" };
    }
  }
  return out;
}

export function SyncConfigForm({
  environmentId,
  existingConfig,
  attributeKeys,
  availableQueries,
}: SyncConfigFormProps) {
  const initialMapping = useMemo<ColumnMappingConfig>(() => {
    if (!existingConfig) return {};
    try {
      return parseColumnMappingConfig(existingConfig.columnMapping);
    } catch {
      // Stored JSON is malformed (unexpected — DB-level guard exists). Don't
      // crash the page; let the operator re-map from scratch.
      return {};
    }
  }, [existingConfig]);

  const [snowflakeQueryId, setSnowflakeQueryId] = useState<string>(existingConfig?.snowflakeQueryId ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(existingConfig?.intervalMinutes ?? 60);
  const [enabled, setEnabled] = useState<boolean>(existingConfig?.enabled ?? true);

  // Per-header Select values. Keys are SOURCE headers; values are encoded as
  // documented at the top of the file ("skip" / "typed:email" / "attr:<id>").
  const [mappingValues, setMappingValues] = useState<Record<string, string>>(() =>
    mappingToSelectValues(initialMapping)
  );

  const [headers, setHeaders] = useState<string[]>(() => Object.keys(initialMapping));
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const [isPreviewPending, startPreview] = useTransition();
  const [isSavePending, startSave] = useTransition();
  const [isRunPending, startRun] = useTransition();

  const handlePreview = () => {
    if (!snowflakeQueryId) {
      toast.error("Pick a Snowflake query first");
      return;
    }
    startPreview(async () => {
      const res = await previewSnowflakeQueryAction({ snowflakeQueryId });
      if (!res?.data) {
        toast.error(getFormattedErrorMessage(res) || "Preview failed");
        return;
      }
      const { headers: previewHeaders, sample, totalRows } = res.data;
      setPreview({ headers: previewHeaders, sample, totalRows });
      setHeaders(previewHeaders);

      // Auto-detect mappings — but DON'T overwrite headers the operator has
      // already set manually. (If they've previewed once, tweaked, then
      // previewed again, we'd otherwise erase their work.)
      const matches = matchColumns(previewHeaders, attributeKeys);
      setMappingValues((prev) => {
        const next: Record<string, string> = {};
        for (const match of matches) {
          if (prev[match.sourceHeader] !== undefined) {
            // Preserve operator override.
            next[match.sourceHeader] = prev[match.sourceHeader];
            continue;
          }
          if (match.kind === "typed") {
            // Auto-detect may match firstName/lastName, but those aren't
            // selectable typed targets in this form — fall back to skip
            // (user can manually pick an attribute key).
            if (match.column === "email" || match.column === "externalId") {
              next[match.sourceHeader] = `typed:${match.column}`;
            } else {
              next[match.sourceHeader] = "skip";
            }
          } else if (match.kind === "attribute") {
            next[match.sourceHeader] = `attr:${match.attributeKeyId}`;
          } else {
            next[match.sourceHeader] = "skip";
          }
        }
        return next;
      });
      toast.success(`Preview loaded: ${totalRows} row(s)`);
    });
  };

  const handleSave = () => {
    if (!snowflakeQueryId) {
      toast.error("Pick a Snowflake query first");
      return;
    }
    if (headers.length === 0) {
      toast.error("Run Preview first to detect columns");
      return;
    }
    const columnMapping = selectValuesToMapping(mappingValues);
    startSave(async () => {
      const res = await saveSyncConfigAction({
        environmentId,
        snowflakeQueryId,
        columnMapping,
        intervalMinutes,
        enabled,
      });
      if (res?.data?.ok) {
        toast.success("Sync configuration saved");
      } else {
        toast.error(getFormattedErrorMessage(res) || "Save failed");
      }
    });
  };

  const handleRunNow = () => {
    if (!existingConfig) {
      toast.error("Save the configuration first");
      return;
    }
    startRun(async () => {
      const res = await runSyncNowAction({ environmentId });
      if (!res?.data) {
        toast.error(getFormattedErrorMessage(res) || "Sync run failed");
        return;
      }
      const s = res.data;
      toast.success(
        `Synced: ${s.rowsProcessed} processed, ${s.rowsCreated} created, ${s.rowsUpdated} updated, ${s.rowsDeactivated} deactivated`
      );
    });
  };

  return (
    <div className="space-y-8">
      {/* Step 1 — Pick the source query */}
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-800">1. Source Query</h2>
        <div className="space-y-2">
          <Label htmlFor="snowflake-query">Snowflake query</Label>
          <Select value={snowflakeQueryId} onValueChange={setSnowflakeQueryId}>
            <SelectTrigger id="snowflake-query">
              <SelectValue placeholder="Pick a query…" />
            </SelectTrigger>
            <SelectContent>
              {availableQueries.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.name}
                  {q.description ? ` — ${q.description}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            Queries are defined in <code className="rounded bg-slate-100 px-1">query-config.json</code>.
          </p>
        </div>
        <Button variant="secondary" onClick={handlePreview} disabled={isPreviewPending || !snowflakeQueryId}>
          {isPreviewPending ? "Loading…" : "Preview rows + detect columns"}
        </Button>
      </section>

      {/* Step 2 — Sample preview */}
      {preview && preview.sample.length > 0 && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">2. Sample Rows</h2>
          <p className="text-xs text-slate-500">
            Showing {preview.sample.length} of {preview.totalRows} row(s).
          </p>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-slate-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.sample.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => (
                      <td key={h} className="px-3 py-2 font-mono text-slate-700">
                        {row[h] === null || row[h] === undefined ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          String(row[h])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Step 3 — Column mapping */}
      {headers.length > 0 && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">3. Column Mapping</h2>
          <p className="text-xs text-slate-500">
            For each Snowflake column, pick where the value should land in Formbricks. Unmapped columns can be
            left as <em>Skip</em>. firstName / lastName must be routed through an attribute key (no typed
            columns in Phase 1a).
          </p>
          <div className="space-y-2">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-3 rounded border border-slate-200 px-3 py-2">
                <code className="min-w-[180px] flex-shrink-0 font-mono text-xs text-slate-700">{header}</code>
                <span className="text-slate-400">→</span>
                <div className="flex-1">
                  <Select
                    value={mappingValues[header] ?? "skip"}
                    onValueChange={(v) => setMappingValues((prev) => ({ ...prev, [header]: v }))}>
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
            ))}
          </div>
        </section>
      )}

      {/* Step 4 — Schedule + enabled */}
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-800">4. Schedule</h2>
        <div className="space-y-2">
          <Label htmlFor="interval-minutes">Sync interval (minutes)</Label>
          <Input
            id="interval-minutes"
            type="number"
            min={5}
            max={1440}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            className="w-32"
          />
          <p className="text-xs text-slate-500">
            Between 5 and 1440 minutes. The cron checks every minute and runs eligible syncs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <Label htmlFor="enabled" className="cursor-pointer">
            Enabled (sync will run on schedule)
          </Label>
        </div>
      </section>

      {/* Save + run-now */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSavePending}>
          {isSavePending ? "Saving…" : "Save configuration"}
        </Button>
        {existingConfig ? (
          <Button variant="secondary" onClick={handleRunNow} disabled={isRunPending}>
            {isRunPending ? "Running…" : "Run sync now"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
