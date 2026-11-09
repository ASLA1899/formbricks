import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * ASLA (Must 2): the only tools `/api/mcp` exposes — the "Tools (v1)" table in
 * docs/specs/formbricks-mcp-librechat.md. Every other tool upstream registers (workflows, feedback
 * records, custom CSS, response writes, and whatever a later upgrade adds) is never registered, so it is
 * absent from `tools/list` and a call to it is refused as an unknown tool. This holds for every client,
 * not only the LibreChat config.
 *
 * Final v1 names. Some are not registered yet, and stay hidden until the ticket that adds them:
 * - `create_survey_draft` replaces upstream `create_survey` with the draft-only guard (2.3, ASL-1893).
 *   Upstream `create_survey` is deliberately absent, so creation is closed until then.
 * - `update_survey_settings` (2.4a), `prepare_status_change` and `apply_status_change` (2.4),
 *   `summarize_responses` (2.5) are new ASLA tools.
 *
 * Adding a name here exposes a tool. Do it only with the ticket that guards it.
 */
export const MCP_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
  "list_workspaces",
  "list_surveys",
  "get_survey",
  "validate_survey",
  "create_survey_draft",
  "edit_survey_blocks",
  "patch_survey",
  "set_survey_block_order",
  "delete_survey",
  "update_survey_settings",
  "prepare_status_change",
  "apply_status_change",
  "count_responses",
  "list_responses",
  "get_response",
  "summarize_responses",
]);

/**
 * Returned for a skipped tool so a module that chains `.disable()` / `.update()` on the result keeps
 * working instead of throwing inside the handler factory. Every method is a no-op; the tool never exists.
 */
const SKIPPED_TOOL = Object.freeze({
  enabled: false,
  enable: () => undefined,
  disable: () => undefined,
  update: () => undefined,
  remove: () => undefined,
  handler: () => {
    throw new Error("Tool is not on the MCP allowlist");
  },
});

/**
 * The server the tool modules register on. It exposes `registerTool` only, and that silently skips a
 * name outside the allowlist. Enforced here, at the server, rather than in `registerScopedTool`, because
 * a tool module receives the server and could always call `registerTool` on it directly.
 *
 * Any other member (`server.server` and its `setRequestHandler`, `registerResource`, `registerPrompt`, …)
 * throws, so an upstream module that reaches past `registerTool` fails loudly in the route tests instead
 * of quietly adding a handler the allowlist never saw. Symbol keys read as `undefined` so inspection and
 * logging of the proxy still work.
 */
export function withMcpToolAllowlist(
  server: McpServer,
  allowlist: ReadonlySet<string> = MCP_TOOL_ALLOWLIST
): McpServer {
  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") {
        return ((name: string, ...rest: unknown[]) =>
          allowlist.has(name)
            ? (target.registerTool as (...args: unknown[]) => unknown)(name, ...rest)
            : SKIPPED_TOOL) as McpServer["registerTool"];
      }
      if (typeof property === "symbol") return undefined;
      throw new Error(
        `MCP tool modules may only call registerTool; "${property}" is blocked by the tool allowlist`
      );
    },
    set() {
      throw new Error("MCP tool modules may not modify the server");
    },
  });
}
