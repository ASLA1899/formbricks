"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatDateTimeForDisplay } from "@/lib/utils/datetime";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/ui/components/table";
import {
  type TInviteeFilter,
  type TInviteeStatus,
  countInviteeStatuses,
  filterInvitees,
  inviteeStatus,
} from "../lib/invitee-status";
import type { TInvitationRow } from "../types/invitation";

const STATUS_STYLES: Record<TInviteeStatus, string> = {
  responded: "bg-emerald-100 text-emerald-700",
  sent: "bg-sky-100 text-sky-700",
  pending: "bg-slate-100 text-slate-600",
};

const FILTERS: TInviteeFilter[] = ["all", "pending", "sent", "responded"];

export const RecipientListTable = ({ rows }: Readonly<{ rows: TInvitationRow[] }>) => {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<TInviteeFilter>("all");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en-US";

  const counts = countInviteeStatuses(rows);
  const filtered = filterInvitees(rows, filter);

  const filterLabel: Record<TInviteeFilter, string> = {
    all: t("workspace.surveys.invitations.filter_all"),
    pending: t("workspace.surveys.invitations.status_pending"),
    sent: t("workspace.surveys.invitations.status_sent"),
    responded: t("workspace.surveys.invitations.status_responded"),
  };

  const formatWhen = (iso: string | null): string => {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "—" : formatDateTimeForDisplay(date, locale);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              filter === key
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            )}>
            {filterLabel[key]} <span className="opacity-70">({counts[key]})</span>
          </button>
        ))}
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{t("workspace.surveys.invitations.column_recipient")}</TableHead>
              <TableHead className="text-xs">{t("workspace.surveys.invitations.column_status")}</TableHead>
              <TableHead className="text-xs">{t("workspace.surveys.invitations.column_sent")}</TableHead>
              <TableHead className="text-xs">{t("workspace.surveys.invitations.column_responded")}</TableHead>
              <TableHead className="text-xs">{t("workspace.surveys.invitations.column_reminders")}</TableHead>
              <TableHead className="text-xs">
                {t("workspace.surveys.invitations.column_last_reminder")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => {
              const status = inviteeStatus(row);
              return (
                <TableRow key={row.id}>
                  <TableCell className="py-2">
                    <div className="font-medium text-slate-800">
                      {row.recipientName ?? row.recipientEmail}
                    </div>
                    {row.recipientName && <div className="text-xs text-slate-500">{row.recipientEmail}</div>}
                  </TableCell>
                  <TableCell className="py-2">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[status]
                      )}>
                      {filterLabel[status]}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-xs text-slate-600">{formatWhen(row.sentAt)}</TableCell>
                  <TableCell className="py-2 text-xs text-slate-600">{formatWhen(row.respondedAt)}</TableCell>
                  <TableCell className="py-2 text-xs text-slate-600">{row.reminderCount}</TableCell>
                  <TableCell className="py-2 text-xs text-slate-600">
                    {formatWhen(row.lastReminderAt)}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-3 text-center text-xs text-slate-500">
                  {t("workspace.surveys.invitations.no_recipients_in_filter")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
