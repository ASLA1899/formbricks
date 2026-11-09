import { beforeEach, describe, expect, test, vi } from "vitest";

// Hoisted so the same objects survive `vi.resetModules()`, which each test uses to get a fresh module.
const { mockEnv, mockLogger } = vi.hoisted(() => ({
  mockEnv: {
    MCP_DCR_ALLOWED_REDIRECT_URIS: undefined as string[] | undefined,
    MCP_LIBRECHAT_CALLBACK_URI: undefined as string | undefined,
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@formbricks/logger", () => ({ logger: mockLogger }));

const loadPolicy = async () => {
  vi.resetModules();
  return import("./mcp-dcr-redirect-policy");
};

const LIBRECHAT = "https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback";
const LIBRECHAT_PRODUCTION = "https://chat.aslalabs.org/api/mcp/formbricks/oauth/callback";
const CLAUDE_AI = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
const LOOPBACK = "http://127.0.0.1:33418/callback";

beforeEach(() => {
  mockEnv.MCP_DCR_ALLOWED_REDIRECT_URIS = undefined;
  mockEnv.MCP_LIBRECHAT_CALLBACK_URI = LIBRECHAT;
  mockLogger.warn.mockClear();
});

describe("isLoopbackRedirectUri", () => {
  test.each(["http://localhost:8080/cb", "http://127.0.0.1:1/cb", "http://[::1]:9000/cb"])(
    "classifies %s as loopback",
    async (uri) => {
      const { isLoopbackRedirectUri } = await loadPolicy();
      expect(isLoopbackRedirectUri(uri)).toBe(true);
    }
  );

  test.each(["https://localhost:8080/cb", "http://evil.example.com/cb", "not a url", null, 42])(
    "does not classify %s as loopback",
    async (uri) => {
      const { isLoopbackRedirectUri } = await loadPolicy();
      expect(isLoopbackRedirectUri(uri)).toBe(false);
    }
  );
});

/** ASLA Must 1: the allowlist is the LibreChat callback and nothing else. */
describe("isAllowedDcrRedirectUri (ASLA Must 1)", () => {
  test("accepts the LibreChat callback", async () => {
    const { getAllowedDcrRedirectUris, isAllowedDcrRedirectUri } = await loadPolicy();
    expect(isAllowedDcrRedirectUri(LIBRECHAT, getAllowedDcrRedirectUris())).toBe(true);
  });

  test.each([
    LOOPBACK,
    "http://localhost:8080/cb",
    CLAUDE_AI,
    CHATGPT,
    LIBRECHAT_PRODUCTION,
    `${LIBRECHAT}/`,
    `${LIBRECHAT}?x=1`,
    LIBRECHAT.replace("https:", "http:"),
    LIBRECHAT.toUpperCase(),
    null,
  ])("refuses %s", async (uri) => {
    const { getAllowedDcrRedirectUris, isAllowedDcrRedirectUri } = await loadPolicy();
    expect(isAllowedDcrRedirectUri(uri, getAllowedDcrRedirectUris())).toBe(false);
  });

  test("allows nothing when MCP_LIBRECHAT_CALLBACK_URI is unset (fail closed)", async () => {
    mockEnv.MCP_LIBRECHAT_CALLBACK_URI = undefined;
    const { getAllowedDcrRedirectUris } = await loadPolicy();
    expect(getAllowedDcrRedirectUris().size).toBe(0);
  });

  test("ignores MCP_DCR_ALLOWED_REDIRECT_URIS, and warns once that it does", async () => {
    mockEnv.MCP_DCR_ALLOWED_REDIRECT_URIS = ["https://client.example.com/oauth/callback"];
    const { getAllowedDcrRedirectUris, isAllowedDcrRedirectUri } = await loadPolicy();

    expect(
      isAllowedDcrRedirectUri("https://client.example.com/oauth/callback", getAllowedDcrRedirectUris())
    ).toBe(false);
    getAllowedDcrRedirectUris();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("findDisallowedRedirectUri (ASLA Must 1)", () => {
  const find = async (client: unknown) => {
    const { findDisallowedRedirectUri, getAllowedDcrRedirectUris } = await loadPolicy();
    return findDisallowedRedirectUri(JSON.stringify(client), getAllowedDcrRedirectUris());
  };

  test("returns null for a LibreChat registration", async () => {
    expect(await find({ redirect_uris: [LIBRECHAT] })).toBeNull();
  });

  test("returns null when post_logout_redirect_uris is empty", async () => {
    expect(await find({ redirect_uris: [LIBRECHAT], post_logout_redirect_uris: [] })).toBeNull();
  });

  test.each([
    ["loopback", [LOOPBACK], LOOPBACK],
    ["claude.ai", [CLAUDE_AI], CLAUDE_AI],
    ["the other deployment's callback", [LIBRECHAT_PRODUCTION], LIBRECHAT_PRODUCTION],
  ])("flags a %s redirect_uri", async (_case, redirectUris, uri) => {
    expect(await find({ redirect_uris: redirectUris })).toEqual({ field: "redirect_uris", uri });
  });

  test.each([
    ["missing", {}],
    ["empty", { redirect_uris: [] }],
    ["not an array", { redirect_uris: LIBRECHAT }],
    ["the callback twice", { redirect_uris: [LIBRECHAT, LIBRECHAT] }],
    ["the callback plus another", { redirect_uris: [LIBRECHAT, LOOPBACK] }],
  ])("flags redirect_uris that is %s", async (_case, client) => {
    expect(await find(client)).toEqual({ field: "redirect_uris", uri: null });
  });

  test("flags any post_logout_redirect_uri, even the callback itself", async () => {
    expect(await find({ redirect_uris: [LIBRECHAT], post_logout_redirect_uris: [LIBRECHAT] })).toEqual({
      field: "post_logout_redirect_uris",
      uri: LIBRECHAT,
    });
  });

  test.each(["not json", "[]", "null", '"text"'])(
    "flags a body that is not a JSON object: %s",
    async (body) => {
      const { findDisallowedRedirectUri, getAllowedDcrRedirectUris } = await loadPolicy();
      expect(findDisallowedRedirectUri(body, getAllowedDcrRedirectUris())).toEqual({
        field: "redirect_uris",
        uri: null,
      });
    }
  );

  test("flags even the LibreChat callback when MCP_LIBRECHAT_CALLBACK_URI is unset", async () => {
    mockEnv.MCP_LIBRECHAT_CALLBACK_URI = undefined;
    expect(await find({ redirect_uris: [LIBRECHAT] })).toEqual({ field: "redirect_uris", uri: LIBRECHAT });
  });
});
