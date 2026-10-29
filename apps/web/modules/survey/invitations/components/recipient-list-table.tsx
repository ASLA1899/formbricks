"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/ui/components/table";
import type { TInvitationRow } from "../types/invitation";

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type Status = "responded" | "sent" | "pending";

const statusOf = (row: TInvitationRow): Status => {
  if (row.respondedAt) return "responded";
  if (row.sentAt) return "sent";
  return "pending";
};

const StatusBadge = ({ status }: { status: Status }) => {
  const styles: Record<Status, string> = {
    responded: "bg-emerald-100 text-emerald-700",
    sent: "bg-sky-100 text-sky-700",
    pending: "bg-slate-100 text-slate-600",
  };
  const labels: Record<Status, string> = {
    responded: "Responded",
    sent: "Sent",
    pending: "Pending",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

export const RecipientListTable = ({ rows }: { rows: TInvitationRow[] }) => {
  const [filter, setFilter] = useState<"all" | Status>("all");

  const counts = useMemo(() => {
    const acc = { all: rows.length, responded: 0, sent: 0, pending: 0 };
    for (const row of rows) acc[statusOf(row)]++;
    return acc;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => statusOf(row) === filter)),
    [rows, filter]
  );

  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No invitations have been queued yet — pick an audience and click <em>Send invitations</em>.
      </p>
    );
  }

  const chip = (key: "all" | Status, label: string) => {
    const active = filter === key;
    return (
      <button
        type="button"
        onClick={() => setFilter(key)}
        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
          active
            ? "border-slate-800 bg-slate-800 text-white"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        }`}>
        {label} <span className="opacity-70">({counts[key]})</span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {chip("all", "All")}
        {chip("pending", "Pending")}
        {chip("sent", "Sent")}
        {chip("responded", "Responded")}
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Recipient</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Sent</TableHead>
              <TableHead className="text-xs">Responded</TableHead>
              <TableHead className="text-xs">Reminders</TableHead>
              <TableHead className="text-xs">Last reminder</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="py-2">
                  <div className="font-medium text-slate-800">{row.recipientName ?? row.recipientEmail}</div>
                  {row.recipientName && <div className="text-xs text-slate-500">{row.recipientEmail}</div>}
                </TableCell>
                <TableCell className="py-2">
                  <StatusBadge status={statusOf(row)} />
                </TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{formatDate(row.sentAt)}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{formatDate(row.respondedAt)}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{row.reminderCount}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">
                  {formatDate(row.lastReminderAt)}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-3 text-center text-xs text-slate-500">
                  No recipients in this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
