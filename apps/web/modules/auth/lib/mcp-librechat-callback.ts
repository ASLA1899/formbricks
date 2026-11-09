import "server-only";
import { env } from "@/lib/env";

/**
 * ASLA (Must 1): the MCP server serves one OAuth client shape — ASLA Chat's LibreChat connector, whose
 * callback is fixed per deployment by `MCP_LIBRECHAT_CALLBACK_URI`. Every place that checks a callback
 * reads it here: dynamic client registration (`mcp-dcr-redirect-policy.ts`) and the per-request client
 * check on `/api/mcp` (`modules/mcp/auth.ts`). A server-created client must use the same value.
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
