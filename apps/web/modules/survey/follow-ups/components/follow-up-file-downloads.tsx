"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTimeForDisplay } from "@/lib/utils/datetime";
import { getFollowUpFileLinksAction } from "@/modules/survey/follow-ups/actions";

type TFileLinkRow = {
  id: string;
  recipientEmail: string;
  createdAt: Date;
  firstDownloadedAt: Date | null;
  lastDownloadedAt: Date | null;
  downloadCount: number;
};

interface FollowUpFileDownloadsProps {
  surveyId: string;
  followUpId: string;
}

export const FollowUpFileDownloads = ({ surveyId, followUpId }: FollowUpFileDownloadsProps) => {
  const { t, i18n } = useTranslation();
  const formatDateTime = (value: Date | string | null): string =>
    value ? formatDateTimeForDisplay(new Date(value), i18n.resolvedLanguage) : "";
  const [rows, setRows] = useState<TFileLinkRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getFollowUpFileLinksAction({ surveyId, followUpId }).then((result) => {
      if (cancelled) return;
      if (result?.data) {
        setRows(result.data.links);
        setTotal(result.data.total);
      } else {
        setHasError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [surveyId, followUpId]);

  return (
    <div className="flex flex-col space-y-2 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-900">
        {t("environments.surveys.edit.follow_up_downloads_title")}
      </h3>

      {hasError ? (
        <p className="text-sm text-red-500">
          {t("environments.surveys.edit.follow_up_downloads_load_failed")}
        </p>
      ) : null}

      {rows && rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t("environments.surveys.edit.follow_up_downloads_empty")}</p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">
                  {t("environments.surveys.edit.follow_up_downloads_recipient")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("environments.surveys.edit.follow_up_downloads_sent")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("environments.surveys.edit.follow_up_downloads_first")}
                </th>
                <th className="py-1 pr-2 font-medium">
                  {t("environments.surveys.edit.follow_up_downloads_last")}
                </th>
                <th className="py-1 text-right font-medium">
                  {t("environments.surveys.edit.follow_up_downloads_count")}
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-900">
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{row.recipientEmail}</td>
                  <td className="py-1 pr-2">{formatDateTime(row.createdAt)}</td>
                  <td className="py-1 pr-2">
                    {formatDateTime(row.firstDownloadedAt) ||
                      t("environments.surveys.edit.follow_up_downloads_not_downloaded")}
                  </td>
                  <td className="py-1 pr-2">{formatDateTime(row.lastDownloadedAt)}</td>
                  <td className="py-1 text-right">{row.downloadCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length ? (
            <p className="mt-2 text-xs text-slate-500">
              {t("environments.surveys.edit.follow_up_downloads_more", { shown: rows.length, total })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
