import "server-only";
import { logger } from "@formbricks/logger";
import { env } from "@/lib/env";
import { getMcpLibreChatCallbackUri } from "./mcp-librechat-callback";

/**
 * Redirect-URI policy for the open Dynamic Client Registration endpoint (ENG-3086, ENG-3471; ASLA Must 1).
 *
 * Unauthenticated DCR (RFC 7591) at `/api/auth/oauth2/register` accepts a self-asserted
 * `redirect_uris` array. Upstream limits it to http loopback plus a list of hosted-connector callbacks
 * (claude.ai, ChatGPT). ASLA narrows that to one client: ASLA Chat's LibreChat connector, whose callback
 * is `MCP_LIBRECHAT_CALLBACK_URI`. Loopback and the hosted callbacks are refused, so no desktop client,
 * script or third-party connector can obtain a token for survey data.
 *
 * Matched by exact string (OAuth 2.1 / RFC 9700 §4.1): a lookalike host, another path, a trailing slash
 * or an added query string is a different URI and is refused. Anything else is rejected before it
 * reaches Better Auth, with the same `invalid_redirect_uri` the plugin itself would emit.
 */

const LOOPBACK_REDIRECT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a redirect URI is an http loopback address (RFC 8252 §7.3). No longer an allow rule (ASLA,
 * Must 1); kept because `withInferredApplicationType` still uses it to classify a registration body.
 */
export const isLoopbackRedirectUri = (uri: unknown): boolean => {
  if (typeof uri !== "string") return false;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_REDIRECT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

let warnedIgnoredOperatorUris = false;

/**
 * The redirect URIs registration may use: the LibreChat callback, or nothing when it is unset.
 * Registration itself needs the operator's initial access token (`mcp-oauth-provider-options.ts`).
 *
 * `MCP_DCR_ALLOWED_REDIRECT_URIS` is ignored. ASLA reads the callback from one variable so DCR, the
 * per-request client check and the registered client cannot drift apart; a second list an operator
 * has to keep in sync is exactly how they would. A non-empty value is logged once so it is noticed.
 */
export const getAllowedDcrRedirectUris = (): ReadonlySet<string> => {
  const operatorUris = env.MCP_DCR_ALLOWED_REDIRECT_URIS ?? [];
  if (operatorUris.length > 0 && !warnedIgnoredOperatorUris) {
    warnedIgnoredOperatorUris = true;
    logger.warn(
      { count: operatorUris.length },
      "MCP_DCR_ALLOWED_REDIRECT_URIS is ignored; dynamic client registration accepts only MCP_LIBRECHAT_CALLBACK_URI"
    );
  }
  const callbackUri = getMcpLibreChatCallbackUri();
  return new Set(callbackUri ? [callbackUri] : []);
};

/** Whether registration may use this `redirect_uris` entry: an exact allowlisted URI, nothing else. */
export const isAllowedDcrRedirectUri = (uri: unknown, allowed: ReadonlySet<string>): boolean =>
  typeof uri === "string" && allowed.has(uri);

type TRedirectUriField = "redirect_uris" | "post_logout_redirect_uris";

export type TDisallowedRedirectUri = {
  field: TRedirectUriField;
  /** The offending entry, or `null` when the field is missing, empty or malformed as a whole. */
  uri: string | null;
};

/**
 * Why a DCR body is refused, or `null` when it may go on to Better Auth. ASLA (Must 1) turns this from
 * "only tighten what upstream accepts" into an exact rule, so it now refuses shapes upstream would also
 * have refused rather than leaving them to it:
 *
 * - `redirect_uris` must be a JSON array of exactly one entry, and that entry must be allowlisted. The
 *   per-request check on `/api/mcp` accepts only a client whose stored list is exactly `[callback]`, so a
 *   registration with a duplicate or a second URI would only produce a client that can never be used.
 * - `post_logout_redirect_uris` must be absent or empty. LibreChat registers none, and every entry is
 *   another place a browser could be sent.
 * - A body that is not a JSON object is refused outright.
 */
export const findDisallowedRedirectUri = (
  body: string,
  allowed: ReadonlySet<string>
): TDisallowedRedirectUri | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { field: "redirect_uris", uri: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { field: "redirect_uris", uri: null };
  }

  const client = parsed as Record<string, unknown>;
  const redirectUris = client.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length !== 1) {
    return { field: "redirect_uris", uri: null };
  }
  const [redirectUri] = redirectUris;
  if (!isAllowedDcrRedirectUri(redirectUri, allowed)) {
    return { field: "redirect_uris", uri: typeof redirectUri === "string" ? redirectUri : null };
  }

  const postLogout = client.post_logout_redirect_uris;
  if (postLogout !== undefined && postLogout !== null) {
    if (!Array.isArray(postLogout)) return { field: "post_logout_redirect_uris", uri: null };
    if (postLogout.length > 0) {
      const [first] = postLogout;
      return { field: "post_logout_redirect_uris", uri: typeof first === "string" ? first : null };
    }
  }
  return null;
};
