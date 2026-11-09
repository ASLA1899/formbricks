import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test, vi } from "vitest";
import { MCP_TOOL_ALLOWLIST, withMcpToolAllowlist } from "./tool-allowlist";

vi.mock("server-only", () => ({}));

const fakeServer = () => {
  const registered = { name: "registered" };
  const registerTool = vi.fn(() => registered);
  const server = {
    registerTool,
    registerResource: vi.fn(),
    registerPrompt: vi.fn(),
    server: { setRequestHandler: vi.fn() },
  };
  return { server: server as unknown as McpServer, registerTool, registered, raw: server };
};

describe("withMcpToolAllowlist", () => {
  test("registers an allowlisted tool on the real server and returns its handle", () => {
    const { server, registerTool, registered } = fakeServer();
    const result = withMcpToolAllowlist(server).registerTool(
      "list_surveys",
      {} as never,
      (() => {}) as never
    );
    expect(registerTool).toHaveBeenCalledWith("list_surveys", {}, expect.any(Function));
    expect(result).toBe(registered);
  });

  test("skips a tool outside the allowlist and returns an inert handle that tolerates chaining", () => {
    const { server, registerTool } = fakeServer();
    const handle = withMcpToolAllowlist(server).registerTool(
      "delete_workflow",
      {} as never,
      (() => {}) as never
    );
    expect(registerTool).not.toHaveBeenCalled();
    expect(handle.enabled).toBe(false);
    expect(() => {
      handle.disable();
      handle.update({});
      handle.remove();
    }).not.toThrow();
  });

  test.each(["server", "registerResource", "registerPrompt", "connect", "tool"])(
    "blocks access to %s so a module cannot reach past registerTool",
    (member) => {
      const { server, raw } = fakeServer();
      const guarded = withMcpToolAllowlist(server) as unknown as Record<string, unknown>;
      expect(() => guarded[member]).toThrow(/only call registerTool/);
      expect(raw.server.setRequestHandler).not.toHaveBeenCalled();
    }
  );

  test("refuses writes to the server", () => {
    const { server } = fakeServer();
    const guarded = withMcpToolAllowlist(server) as unknown as Record<string, unknown>;
    expect(() => {
      guarded.registerTool = vi.fn();
    }).toThrow(/may not modify/);
  });

  test("reads symbol keys as undefined so the proxy can be inspected", () => {
    const { server } = fakeServer();
    const guarded = withMcpToolAllowlist(server) as unknown as Record<symbol, unknown>;
    expect(guarded[Symbol.toStringTag]).toBeUndefined();
  });

  test("does not expose upstream create_survey", () => {
    expect(MCP_TOOL_ALLOWLIST.has("create_survey")).toBe(false);
  });
});
