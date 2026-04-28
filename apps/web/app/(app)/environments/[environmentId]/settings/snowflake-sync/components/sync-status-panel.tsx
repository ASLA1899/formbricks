"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import toast from "react-hot-toast";
import { getFormattedErrorMessage } from "@/lib/utils/helper";
import { Button } from "@/modules/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/ui/components/table";
import { runSyncNowAction } from "../actions";

type RunStatus = "pending" | "running" | "succeeded" | "failed";

interface Run {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsDeactivated: number;
  errorMessage: string | null;
}

interface Props {
  environmentId: string;
  lastRunAt: Date | null;
  lastRunStatus: RunStatus | null;
  runs: Run[];
}

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const StatusBadge = ({ status }: { status: RunStatus }) => {
  // Colors per the acceptance criteria: pending=slate, running=amber,
  // succeeded=emerald, failed=rose. Tailwind picks the foreground at a level
  // that contrasts on the matching pale-100 background.
  const styles: Record<RunStatus, string> = {
    pending: "bg-slate-100 text-slate-600",
    running: "bg-amber-100 text-amber-700",
    succeeded: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
};

export function SyncStatusPanel({ environmentId, lastRunAt, lastRunStatus, runs }: Props) {
  const router = useRouter();
  // useTransition pairs naturally with router.refresh(): the transition stays
  // pending until the server-side data refetch completes, so the button's
  // "Running…" label accurately reflects when the new run row is visible.
  const [isRunning, startRun] = useTransition();

  const handleRunNow = () => {
    startRun(async () => {
      const res = await runSyncNowAction({ environmentId });
      if (res?.data) {
        const { rowsProcessed, rowsCreated, rowsUpdated, rowsDeactivated } = res.data;
        toast.success(
          `Synced ${rowsProcessed} row(s): ${rowsCreated} created, ${rowsUpdated} updated, ${rowsDeactivated} deactivated`
        );
      } else {
        toast.error(getFormattedErrorMessage(res) || "Sync failed — see run history below");
      }
      // Refresh server-side data (last run timestamp, runs table) regardless
      // of success/failure so the operator sees the new run row immediately.
      router.refresh();
    });
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Status</h2>
        <Button onClick={handleRunNow} disabled={isRunning}>
          {isRunning ? "Running…" : "Run sync now"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">Last run</div>
          <div className="text-slate-800">{formatDate(lastRunAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Last status</div>
          <div>{lastRunStatus ? <StatusBadge status={lastRunStatus} /> : "—"}</div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">Recent runs</h3>
        <div className="overflow-auto rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Started</TableHead>
                <TableHead className="text-xs">Finished</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Processed</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs">Updated</TableHead>
                <TableHead className="text-xs">Deactivated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-3 text-center text-xs text-slate-500">
                    No runs yet — click &quot;Run sync now&quot; or wait for the next scheduled run.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-2 text-xs">{formatDate(r.startedAt)}</TableCell>
                    <TableCell className="py-2 text-xs">{formatDate(r.finishedAt)}</TableCell>
                    <TableCell className="py-2">
                      <StatusBadge status={r.status} />
                      {r.errorMessage && (
                        <div className="mt-1 max-w-xs truncate text-xs text-rose-700" title={r.errorMessage}>
                          {r.errorMessage}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsProcessed}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsCreated}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsUpdated}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsDeactivated}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
