import "server-only";
import { constantTimeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * ASLA (Must 1): the MCP server serves one OAuth client shape — ASLA Chat's LibreChat connector, whose
 * callback is fixed per deployment by `MCP_LIBRECHAT_CALLBACK_URI`. Every place that checks a callback
 * reads it here: dynamic client registration (`mcp-dcr-redirect-policy.ts`) and the per-request client
 * check on `/api/mcp` (`modules/mcp/auth.ts`).
 *
 * Unset fails closed: `null` here means no client can register and no token is accepted.
 */
export const getMcpLibreChatCallbackUri = (): string | null => env.MCP_LIBRECHAT_CALLBACK_URI ?? null;

/**
 * Whether a client's registered redirect URIs are exactly the LibreChat callback: one entry, equal by
 * exact string (no prefix, host or normalization). A client with the callback plus anything else is
 * refused, because the extra URI is somewhere an authorization code could be delivered.
 */
export const isLibreChatOnlyRedirectUris = (
  redirectUris: readonly unknown[] | null | undefined,
  callbackUri: string | null
): boolean =>
  callbackUri !== null &&
  Array.isArray(redirectUris) &&
  redirectUris.length === 1 &&
  redirectUris[0] === callbackUri;

/**
 * ASLA (Must 1): the one client allowed to use `/api/mcp`, by client ID. A redirect-URI match alone is
 * not enough, because before registration was closed anyone could register a client with the callback.
 * Unset fails closed: no token is accepted.
 */
export const getMcpLibreChatClientId = (): string | null => env.MCP_LIBRECHAT_CLIENT_ID ?? null;

/**
 * Whether a bearer presented to `/oauth2/register` is the operator's RFC 7591 initial access token.
 * Compared in constant time; only a length mismatch returns early, and a random token's length is not
 * the secret. Unset rejects every token, so registration is closed except during the one-time setup.
 */
export const isMcpDcrInitialAccessToken = (presented: string): boolean => {
  const expected = env.MCP_DCR_INITIAL_ACCESS_TOKEN;
  if (!expected) return false;
  return constantTimeEqual(presented, expected);
};
