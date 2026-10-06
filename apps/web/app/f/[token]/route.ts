import { NextResponse } from "next/server";
import { TooManyRequestsError } from "@formbricks/types/errors";
import { getTranslate } from "@/lingodotdev/server";
import { applyIPRateLimit } from "@/modules/core/rate-limit/helpers";
import { rateLimitConfigs } from "@/modules/core/rate-limit/rate-limit-configs";
import {
  registerFollowUpFileDownload,
  resolveFollowUpFileLink,
} from "@/modules/survey/follow-ups/lib/file-links";

// Public, tokenized download link for a follow-up email file.
//   GET  renders a confirmation page and never counts a download, so link scanners and previews
//        (Outlook Safe Links, Mimecast, ...) cannot fake clicks.
//   POST (the page's button) counts the download and streams the file as an attachment.
// This is a route handler rather than a page so unknown tokens get a real 404 status.

const NO_STORE = { "Cache-Control": "no-store" };

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const htmlResponse = (title: string, body: string): Response =>
  new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:Calibri,'Helvetica Neue',Arial,sans-serif;color:#0f172a">${body}</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } }
  );

const applyLimit = async (
  config: (typeof rateLimitConfigs.followUpFile)[keyof typeof rateLimitConfigs.followUpFile]
) => {
  try {
    await applyIPRateLimit(config);
    return null;
  } catch (error) {
    if (error instanceof TooManyRequestsError) {
      return new NextResponse("Too many requests", { status: 429, headers: NO_STORE });
    }
    throw error;
  }
};

export const GET = async (
  _request: Request,
  props: { params: Promise<{ token: string }> }
): Promise<Response> => {
  const limited = await applyLimit(rateLimitConfigs.followUpFile.view);
  if (limited) return limited;

  const { token } = await props.params;
  const resolved = await resolveFollowUpFileLink(token);
  if (!resolved) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  const t = await getTranslate();
  const { fileName, size } = resolved.attachment;

  return htmlResponse(
    t("common.follow_up_file_title"),
    `<main style="width:100%;max-width:28rem;margin:1.5rem;padding:2rem;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:0.5rem"><h1 style="margin:0;font-size:1.125rem">${escapeHtml(
      t("common.follow_up_file_title")
    )}</h1><p style="margin:0.75rem 0 0;font-size:0.875rem;word-break:break-word">${escapeHtml(
      fileName
    )}</p><p style="margin:0.25rem 0 0;font-size:0.75rem;color:#64748b">${formatSize(
      size
    )}</p><form method="POST" action="/f/${encodeURIComponent(
      token
    )}" style="margin-top:1.5rem"><button type="submit" style="background:#003A49;color:#fff;border:0;border-radius:0.375rem;padding:0.625rem 1.25rem;font-size:0.875rem;font-weight:600;cursor:pointer">${escapeHtml(
      t("common.download")
    )}</button></form></main>`
  );
};

export const POST = async (
  _request: Request,
  props: { params: Promise<{ token: string }> }
): Promise<Response> => {
  const limited = await applyLimit(rateLimitConfigs.followUpFile.download);
  if (limited) return limited;

  const { token } = await props.params;
  const download = await registerFollowUpFileDownload(token);
  if (!download) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  return new NextResponse(download.body, {
    status: 200,
    headers: {
      "Content-Type": download.contentType,
      "Content-Disposition": download.contentDisposition,
      ...(download.contentLength > 0 && { "Content-Length": String(download.contentLength) }),
      "X-Content-Type-Options": "nosniff",
      ...NO_STORE,
    },
  });
};
