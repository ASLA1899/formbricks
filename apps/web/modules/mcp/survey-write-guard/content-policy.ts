import "server-only";

/**
 * ASLA (Must 5): what a survey written through MCP may contain. Pure, so the same rules serve every
 * write tool, `update_survey_settings` (2.4a) and the tests.
 *
 * Two rules:
 * - Element types: only the first-release list. `address` and `contactInfo` collect PII, `fileUpload`
 *   files can carry PII past the response projection, and `cal` needs a Cal.com account; those are added
 *   in the editor.
 * - URLs: deny by default. Respondents' browsers load a survey's images and videos, so every media URL
 *   must be Formbricks storage or an allowed host, or another host sees their IP addresses. A link a
 *   respondent clicks must be https. The payload is walked whole rather than field by field, so a field
 *   an upstream upgrade adds is checked by the same rules instead of slipping past a list.
 */

export const MCP_ALLOWED_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "openText",
  "multipleChoiceSingle",
  "multipleChoiceMulti",
  "rating",
  "nps",
  "matrix",
  "ranking",
  "consent",
  "date",
  "cta",
  "csat",
  "ces",
  "pictureSelection",
]);

export type TSurveyContentViolation = {
  /** Dotted path into the checked payload, e.g. `blocks.0.elements.1.imageUrl`. */
  path: string;
  reason: string;
};

export type TSurveyContentPolicy = {
  /** Hostnames besides Formbricks storage that media may load from (`MCP_ALLOWED_IMAGE_HOSTS`). */
  allowedMediaHosts: ReadonlySet<string>;
  /** Whether a URL is a file in this app's own storage. */
  isStorageUrl: (url: string) => boolean;
};

/** Keys whose string value a respondent's browser loads. */
const MEDIA_KEYS = new Set(["imageUrl", "videoUrl", "fileUrl", "ogImage", "logoUrl", "faviconUrl"]);

/** Keys whose string value is a link a respondent clicks. */
const LINK_KEYS = new Set(["buttonUrl", "buttonLink"]);

/**
 * A key that looks like it holds a URL but is on neither list is held to the media rule, the strict one:
 * an unknown field is assumed to load in the browser until someone lists it as a link.
 */
const URL_SHAPED_KEY = /(?:url|uri|src|image|link|href)$/i;

/** HTML attributes that make a browser fetch (media) or navigate (link). */
const HTML_URL_ATTRIBUTE =
  /\b(src|srcset|poster|data|background|href|xlink:href|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const HTML_LINK_ATTRIBUTES = new Set(["href", "xlink:href", "action", "formaction"]);

/** A loaded resource inside markup that the attribute scan above cannot see. */
const CSS_RESOURCE = /url\s*\(|@import|image-set\s*\(/i;

const MAX_VIOLATIONS = 20;

const mediaReason = (url: string, policy: TSurveyContentPolicy): string | null => {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  if (policy.isStorageUrl(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Images and videos must be Formbricks storage files or on an allowed host.";
  }
  if (parsed.protocol !== "https:") {
    return "Images and videos must use https from Formbricks storage or an allowed host.";
  }
  if (parsed.username || parsed.password || parsed.port) {
    return "Image and video URLs may not carry credentials or a port.";
  }
  if (!policy.allowedMediaHosts.has(parsed.hostname.toLowerCase())) {
    return `Images and videos can't load from ${parsed.hostname}: respondents' browsers would contact it. Use Formbricks storage or an allowed host.`;
  }
  return null;
};

const linkReason = (url: string, { allowMailto }: { allowMailto: boolean }): string | null => {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Links must be absolute https URLs.";
  }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return null;
  if (allowMailto && parsed.protocol === "mailto:") return null;
  return "Links must use https.";
};

const htmlReasons = (html: string, policy: TSurveyContentPolicy): string[] => {
  if (!html.includes("<")) return [];
  const reasons: string[] = [];
  if (CSS_RESOURCE.test(html)) {
    reasons.push("Rich text can't load resources from CSS (url(), @import, image-set()).");
  }
  for (const match of html.matchAll(HTML_URL_ATTRIBUTE)) {
    const attribute = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (HTML_LINK_ATTRIBUTES.has(attribute)) {
      const reason = linkReason(value, { allowMailto: true });
      if (reason) reasons.push(`${attribute}: ${reason}`);
      continue;
    }
    // srcset is a comma-separated list of "url descriptor" candidates; every candidate loads.
    const urls =
      attribute === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0]) : [value];
    for (const url of urls) {
      const reason = mediaReason(url, policy);
      if (reason) reasons.push(`${attribute}: ${reason}`);
    }
  }
  return reasons;
};

/**
 * Whether a string under `key` is a link, given its parent object. A redirect ending's `url` is where the
 * respondent is sent; any other `url` (a styling logo, for one) is loaded, so it is media.
 */
const isLinkField = (key: string, parent: Record<string, unknown>): boolean =>
  LINK_KEYS.has(key) || (key === "url" && parent.type === "redirectToUrl");

/** A styling background is an image only when its type says so; a color `bg` is not a URL. */
const isMediaField = (key: string, parent: Record<string, unknown>): boolean =>
  MEDIA_KEYS.has(key) ||
  (key === "bg" && (parent.bgType === "image" || parent.bgType === "upload")) ||
  URL_SHAPED_KEY.test(key);

const walkUrls = (
  value: unknown,
  path: string[],
  policy: TSurveyContentPolicy,
  violations: TSurveyContentViolation[]
): void => {
  if (violations.length >= MAX_VIOLATIONS) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkUrls(item, [...path, String(index)], policy, violations));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      for (const reason of htmlReasons(value, policy)) violations.push({ path: path.join("."), reason });
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    const childPath = [...path, key];
    if (typeof child === "string") {
      let reason: string | null = null;
      if (isLinkField(key, record)) reason = linkReason(child, { allowMailto: false });
      else if (isMediaField(key, record)) reason = mediaReason(child, policy);
      if (reason) violations.push({ path: childPath.join("."), reason });
      for (const htmlReason of htmlReasons(child, policy)) {
        violations.push({ path: childPath.join("."), reason: htmlReason });
      }
      continue;
    }
    walkUrls(child, childPath, policy, violations);
  }
};

export type TSurveyBlockAt = { block: unknown; path: string[] };

const elementTypeViolations = (
  blocks: readonly TSurveyBlockAt[],
  violations: TSurveyContentViolation[]
): void => {
  for (const { block, path } of blocks) {
    const elements = (block as { elements?: unknown } | null)?.elements;
    if (!Array.isArray(elements)) continue;
    elements.forEach((element, elementIndex) => {
      const type = (element as { type?: unknown } | null)?.type;
      if (typeof type === "string" && MCP_ALLOWED_ELEMENT_TYPES.has(type)) return;
      violations.push({
        path: [...path, "elements", String(elementIndex), "type"].join("."),
        reason: `Question type ${typeof type === "string" ? `"${type}"` : "(missing)"} can't be added from chat. Add it in the Formbricks editor.`,
      });
    });
  }
};

/** A document's top-level `blocks`, each with its path, for `findSurveyContentViolations`. */
export const topLevelBlocks = (document: unknown): TSurveyBlockAt[] => {
  const blocks = (document as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks)
    ? blocks.map((block, index) => ({ block, path: ["blocks", String(index)] }))
    : [];
};

/**
 * Every Must 5 violation in a survey document or a part of one: element types in `blocks`, and every URL
 * anywhere in `document` (paths prefixed with `documentPath`). Returns at most 20, in payload order.
 */
export const findSurveyContentViolations = (
  {
    document,
    documentPath = [],
    blocks = [],
  }: { document: unknown; documentPath?: string[]; blocks?: readonly TSurveyBlockAt[] },
  policy: TSurveyContentPolicy
): TSurveyContentViolation[] => {
  const violations: TSurveyContentViolation[] = [];
  elementTypeViolations(blocks, violations);
  walkUrls(document, documentPath, policy, violations);
  return violations.slice(0, MAX_VIOLATIONS);
};
