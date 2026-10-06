import { NextResponse } from "next/server";
import { TooManyRequestsError } from "@formbricks/types/errors";
import { getLocale } from "@/lingodotdev/language";
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

// Same masthead logo, background, and font stack as the follow-up email, so the page looks like it
// belongs to the email the recipient just clicked.
const LOGO_URL = "https://surveys.asla.org/asla-logo-email.png";
const FONT_STACK = "'Retina','Calibri','Helvetica Neue','Helvetica','Arial',sans-serif";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const brandedPage = async (title: string, inner: string, status: number): Promise<Response> => {
  const locale = await getLocale();
  const html = `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(
    title
  )}</title><style>body{margin:0;background:#FBF8F1;color:#1A1A1A;font-family:${FONT_STACK}}header{background:#003A49;padding:24px 36px}header img{display:block;max-width:100%;height:auto}main{box-sizing:border-box;max-width:640px;margin:0 auto;padding:40px 36px;background:#fff}h1{margin:0 0 16px;font-size:22px;font-weight:600}p{margin:0 0 8px;font-size:15px;line-height:1.5;word-break:break-word}.meta{font-size:13px;color:#4b5563}button{margin-top:24px;min-height:44px;padding:0 28px;border:0;border-radius:24px;background:#003A49;color:#fff;font:600 15px ${FONT_STACK};cursor:pointer}button:hover{background:#00546a}button:focus-visible{outline:3px solid #7fb4c2;outline-offset:2px}@media(max-width:480px){header{padding:20px}main{padding:28px 20px}}</style></head><body><header><img src="${LOGO_URL}" alt="American Society of Landscape Architects" width="220" height="56"></header><main>${inner}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
  });
};

const messagePage = async (message: string, status: number): Promise<Response> => {
  const t = await getTranslate();
  return brandedPage(t("common.follow_up_file_title"), `<p>${escapeHtml(message)}</p>`, status);
};

const applyLimit = async (
  config: (typeof rateLimitConfigs.followUpFile)[keyof typeof rateLimitConfigs.followUpFile]
): Promise<Response | null> => {
  try {
    await applyIPRateLimit(config);
    return null;
  } catch (error) {
    if (error instanceof TooManyRequestsError) {
      const t = await getTranslate();
      return messagePage(t("common.follow_up_file_too_many_requests"), 429);
    }
    throw error;
  }
};

const notFound = async (): Promise<Response> => {
  const t = await getTranslate();
  return messagePage(t("common.follow_up_file_not_found"), 404);
};

export const GET = async (
  _request: Request,
  props: { params: Promise<{ token: string }> }
): Promise<Response> => {
  const limited = await applyLimit(rateLimitConfigs.followUpFile.view);
  if (limited) return limited;

  const { token } = await props.params;
  const resolved = await resolveFollowUpFileLink(token);
  if (!resolved) return notFound();

  const t = await getTranslate();
  const { fileName, size } = resolved.attachment;

  return brandedPage(
    t("common.follow_up_file_title"),
    `<h1>${escapeHtml(t("common.follow_up_file_title"))}</h1><p>${escapeHtml(fileName)}</p><p class="meta">${formatSize(
      size
    )}</p><form method="POST" action="/f/${encodeURIComponent(token)}"><button type="submit">${escapeHtml(
      t("common.follow_up_file_download")
    )}</button></form>`,
    200
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
  if (!download) return notFound();

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
