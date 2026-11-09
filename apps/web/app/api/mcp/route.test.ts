import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { V3_REQUEST_ARRAY_MAX_ITEMS } from "@/app/api/v3/lib/array-budget";
import { buildV3AuditLog, queueV3AuditLog } from "@/app/api/v3/lib/audit";
import { problemBadRequest, successListResponse, successResponse } from "@/app/api/v3/lib/response";
import { getAuthorizedV3Survey } from "@/app/api/v3/surveys/authorization";
import {
  createV3SurveyResponseFromRawInput,
  deleteV3Survey,
  editV3SurveyBlocksResponse,
  listV3Surveys,
  patchV3SurveyResponse,
  setV3SurveyBlockOrderResponse,
  validateV3SurveyFromRawInput,
  withGeneratedInsertIds,
} from "@/app/api/v3/surveys/lib/operations";
import { DEFAULT_REQUEST_BODY_LIMIT_BYTES } from "@/app/lib/api/request-body";
import { applyIPRateLimit, applyRateLimit } from "@/modules/core/rate-limit/helpers";
import { POST } from "./route";

const { getJwksMock, verifyBearerTokenMock, userFindUniqueMock, oauthClientFindUniqueMock } = vi.hoisted(
  () => ({
    getJwksMock: vi.fn(),
    verifyBearerTokenMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    oauthClientFindUniqueMock: vi.fn(),
  })
);

// ASLA (Must 1): requests come from the LibreChat client, whose only callback is this one.
const LIBRECHAT_CALLBACK = "https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback";
vi.mock("@/modules/auth/lib/mcp-librechat-callback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/auth/lib/mcp-librechat-callback")>()),
  getMcpLibreChatCallbackUri: () => LIBRECHAT_CALLBACK,
  getMcpLibreChatClientId: () => "client_1",
}));

vi.mock("better-auth/oauth2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth/oauth2")>()),
  getJwks: getJwksMock,
}));

vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: vi.fn(() => ({
    getActions: () => ({
      verifyBearerToken: verifyBearerTokenMock,
    }),
  })),
}));

vi.mock("@/modules/auth/lib/auth", () => ({
  auth: {},
}));

vi.mock("@formbricks/database", () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
    oauthClient: {
      findUnique: oauthClientFindUniqueMock,
    },
  },
}));

// Only the env-dependent URL getters are mocked. The scope constants are the real ones: the route's
// minimum-scope gate and its WWW-Authenticate challenge are both derived from them, so literals here
// would test a world production doesn't have and mask scope drift (ENG-2175).
vi.mock("@/modules/auth/lib/oauth-urls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/auth/lib/oauth-urls")>()),
  getAuthIssuerUrl: () => "http://localhost/api/auth",
  getMcpOrigin: () => "http://localhost",
  getMcpOAuthJwksUrl: () => "http://formbricks:3000/api/auth/jwks",
  getMcpProtectedResourceMetadataUrl: () => "http://localhost/.well-known/oauth-protected-resource/api/mcp",
  getMcpResourceUrl: () => "http://localhost/api/mcp",
}));

const { MCP_CHALLENGE_SCOPE } = await import("@/modules/auth/lib/oauth-urls");
// The auth-params are comma-separated per RFC 9110 §11.6.1 (#8718): asserting the whole string is what
// keeps the separator from regressing, since a strict client parser needs it to read `resource_metadata`.
// The scope list interpolates the real constant, so this stays honest as the advertised scopes change.
// Real tokens always carry `aud`; the resource server rejects any token not minted for it, so the
// fixtures have to look like something the authorization server would actually issue.
const MCP_AUDIENCE = "http://localhost/api/mcp";

const EXPECTED_CHALLENGE = `Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp", scope="${MCP_CHALLENGE_SCOPE}"`;

vi.mock("@/modules/api/lib/api-key-auth", () => ({
  getBearerTokenFromHeaders: vi.fn((headers: Headers) => {
    const authorization = headers.get("authorization");
    return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  }),
}));

vi.mock("@/modules/core/rate-limit/helpers", () => ({
  applyIPRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  applyRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/app/api/v3/surveys/lib/operations", () => ({
  createV3SurveyResponseFromRawInput: vi.fn(),
  deleteV3Survey: vi.fn(),
  editV3SurveyBlocksResponse: vi.fn(),
  getV3Survey: vi.fn(),
  listV3Surveys: vi.fn(),
  patchV3SurveyResponse: vi.fn(),
  setV3SurveyBlockOrderResponse: vi.fn(),
  validateV3SurveyFromRawInput: vi.fn(),
  withGeneratedInsertIds: vi.fn(),
}));

// ASLA draft guard (2.3): the permission-checked read it takes the survey's status from.
vi.mock("@/app/api/v3/surveys/authorization", () => ({
  getAuthorizedV3Survey: vi.fn(),
}));

/**
 * Mocked for the same reason the survey operations above are: this file tests the route, not the
 * operations behind it. It is also load-bearing — the real module reaches `@/app/lib/pipelines` and
 * so `@formbricks/jobs`, which does not load under this config, exactly as every other test whose
 * graph touches the pipeline mocks it out.
 */
vi.mock("@/app/api/v3/responses/lib/operations", () => ({
  batchDeleteV3Responses: vi.fn(),
  countV3ResponsesOperation: vi.fn(),
  createV3ResponseFromRawInput: vi.fn(),
  deleteV3Response: vi.fn(),
  getV3Response: vi.fn(),
  listV3Responses: vi.fn(),
  updateV3ResponseFromRawInput: vi.fn(),
}));

vi.mock("@/app/api/v3/responses/lib/validate-operations", () => ({
  validateV3ResponseFromRawInput: vi.fn(),
}));

vi.mock("@/app/api/v3/lib/audit", () => ({
  buildV3AuditLog: vi.fn(),
  queueV3AuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@formbricks/logger", () => ({
  logger: {
    withContext: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

/** What the v3 operations receive for the default OAuth token below: the person, not an API key. */
const oauthAuthentication = {
  user: { id: "user_1", email: "person@example.com", name: "Person" },
  expires: expect.any(String),
};

function createMcpRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      authorization: "Bearer oauth_access_token",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readMcpResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  const dataLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  return JSON.parse(dataLine ? dataLine.slice("data:".length).trim() : text);
}

describe("POST /api/mcp", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(applyRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(applyIPRateLimit).mockResolvedValue({ allowed: true });
    userFindUniqueMock.mockResolvedValue({ isActive: true });
    oauthClientFindUniqueMock.mockResolvedValue({ redirectUris: [LIBRECHAT_CALLBACK], disabled: false });
    getJwksMock.mockResolvedValue({ keys: [] });
    verifyBearerTokenMock.mockResolvedValue({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      email: "person@example.com",
      name: "Person",
      scope: "openid profile email surveys:read surveys:write",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "client_1",
    });
    vi.mocked(listV3Surveys).mockResolvedValue(
      successListResponse([], { limit: 20, nextCursor: null, totalCount: 0 }, { requestId: "req_mcp" })
    );
  });

  /**
   * `subscriptions/listen` exists only in 2026-07-28 and became reachable with the SDK v2 migration: under
   * v1's `disableSse: true` there was no long-lived path at all. We register no resources and emit no
   * list-changed notifications, so an accepted stream can never deliver anything — it would just hold a
   * connection and a keepalive timer per caller, 1024 of them per process on the SDK's default.
   *
   * Driven through the real route rather than asserted on the handler options, so it also covers the option
   * actually reaching the SDK.
   *
   * The request is a fully valid one — 2026 `_meta` envelope, `Mcp-Method` header, and a real
   * `notifications` filter — so the refusal can only come from the subscription cap. That completeness is
   * load-bearing, not tidiness: the cap is checked *before* param validation, so with a half-built payload
   * this test passes even with the cap removed. Verified by removing `maxSubscriptions` — with a valid
   * payload the stream is then accepted and held open, and this test fails on a timeout rather than an
   * assertion (slower, but red either way).
   */
  test("refuses a subscriptions/listen stream instead of holding it open", async () => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "subscriptions/listen",
          // 2026-07-28 is sessionless, so what `initialize` used to carry once per session now rides on
          // every request's `_meta`. The SDK rejects the call with -32602 if any part is missing.
          params: {
            notifications: { toolsListChanged: true },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": { name: "route-test", version: "1.0.0" },
            },
          },
        },
        {
          "mcp-protocol-version": "2026-07-28",
          // 2026-07-28 requires the method in a header as well, and rejects the call if the two disagree.
          "mcp-method": "subscriptions/listen",
          "x-request-id": "req_listen",
        }
      )
    );
    const body = await readMcpResponse(response);

    expect(body.error).toMatchObject({
      code: -32603,
      message: expect.stringContaining("Subscription limit"),
    });
  });

  test("returns 401 before MCP handling when authentication fails", async () => {
    verifyBearerTokenMock.mockRejectedValueOnce(new Error("invalid token"));

    const response = await POST(
      createMcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("WWW-Authenticate")).toBe(EXPECTED_CHALLENGE);
    expect(applyIPRateLimit).toHaveBeenCalled();
  });

  test("returns 413 before MCP handling when content-length exceeds the v3 body limit", async () => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        },
        {
          "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1),
          "x-request-id": "req_large",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("X-Request-Id")).toBe("req_large");
  });

  test("returns 413 for a body without content-length that exceeds the limit (ENG-3384)", async () => {
    // A chunked upload carries no Content-Length, so the header check passes and the SDK's own
    // `req.json()` would read the whole body. The route reads it itself, bounded, after authentication.
    const oversized = new TextEncoder().encode("x".repeat(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1));
    const response = await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
          authorization: "Bearer oauth_access_token",
          "x-request-id": "req_chunked",
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1])
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("X-Request-Id")).toBe("req_chunked");
    expect(verifyBearerTokenMock).toHaveBeenCalled();
    expect(listV3Surveys).not.toHaveBeenCalled();
  });

  test("refuses an oversized array argument before the SDK validates it (ENG-3384)", async () => {
    // The SDK validates arguments with Zod's `~standard.validate` ahead of the scope gate, one issue
    // per element; the route checks the array budget on the raw body first.
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "create_survey",
            arguments: {
              workspaceId: "clxx1234567890123456789012",
              name: "Junk",
              blocks: Array.from({ length: V3_REQUEST_ARRAY_MAX_ITEMS + 1 }, () => ({})),
            },
          },
        },
        { "x-request-id": "req_budget" }
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Request-Id")).toBe("req_budget");
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32602,
        message: expect.stringContaining("params.arguments.blocks"),
        data: {
          invalid_params: [
            {
              name: "params.arguments.blocks",
              reason: `Too big: expected array to have <=${V3_REQUEST_ARRAY_MAX_ITEMS} items`,
            },
          ],
        },
      },
    });
    expect(createV3SurveyResponseFromRawInput).not.toHaveBeenCalled();
  });

  test("lists only the allowlisted v1 tools (ASLA Must 2)", async () => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        },
        {
          "x-request-id": "req_tools",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBe("req_tools");
    const message = await readMcpResponse(response);
    // Every upstream tool in "Tools (v1)" that 6.1.4 registers, in registration order. Exact, so an
    // upstream rename that silently drops a v1 tool fails here as surely as a leaked tool does.
    expect(message.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_surveys",
      "get_survey",
      "create_survey_draft",
      "validate_survey",
      "patch_survey",
      "edit_survey_blocks",
      "set_survey_block_order",
      "delete_survey",
      "list_workspaces",
      "list_responses",
      "count_responses",
      "get_response",
    ]);
    const tools = new Map(message.result.tools.map((tool: { name: string }) => [tool.name, tool]));
    expect(Object.keys((tools.get("validate_survey") as any).inputSchema.properties)).toEqual(
      expect.arrayContaining(["operation", "surveyId", "data"])
    );
    expect(Object.keys((tools.get("patch_survey") as any).inputSchema.properties)).toEqual(
      expect.arrayContaining(["surveyId", "data"])
    );
    expect(message.result.tools.find((tool: { name: string }) => tool.name === "list_surveys")).toMatchObject(
      {
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }
    );
    expect(message.result.tools.find((tool: { name: string }) => tool.name === "patch_survey")).toMatchObject(
      {
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      }
    );
    expect(
      message.result.tools.find((tool: { name: string }) => tool.name === "delete_survey")
    ).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    });
  });

  test("calls list_surveys through the MCP route", async () => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "list_surveys",
            arguments: {
              workspaceId: "clxx1234567890123456789012",
              limit: 20,
              includeTotalCount: true,
            },
          },
        },
        {
          "x-request-id": "req_mcp",
        }
      )
    );

    expect(response.status).toBe(200);
    const message = await readMcpResponse(response);
    expect(message.result.structuredContent).toEqual({
      data: [],
      meta: { limit: 20, nextCursor: null, totalCount: 0 },
      requestId: "req_mcp",
    });
    expect(listV3Surveys).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication: oauthAuthentication,
        requestId: "req_mcp",
        instance: "/api/mcp",
      })
    );
  });

  // ASLA (Must 1): no API keys on /api/mcp, through either header.
  test.each([
    ["Authorization: Bearer", { authorization: "Bearer fbk_secret-with-hyphens" }],
    ["x-api-key", { "x-api-key": "fbk_test" }],
  ])("refuses an API key sent as %s before MCP handling", async (_case, headers) => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_surveys", arguments: { workspaceId: "clxx1234567890123456789012" } },
        },
        headers
      )
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(EXPECTED_CHALLENGE);
    expect(verifyBearerTokenMock).not.toHaveBeenCalled();
    expect(listV3Surveys).not.toHaveBeenCalled();
  });

  test("refuses a token from a client other than LibreChat before MCP handling (ASLA Must 1)", async () => {
    verifyBearerTokenMock.mockResolvedValue({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      scope: "surveys:read",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "self_registered_client",
    });

    const response = await POST(
      createMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    );

    expect(response.status).toBe(403);
    expect(oauthClientFindUniqueMock).not.toHaveBeenCalled();
  });

  test("refuses the pinned client once its callback no longer matches (ASLA Must 1)", async () => {
    oauthClientFindUniqueMock.mockResolvedValue({
      redirectUris: ["http://127.0.0.1:33418/callback"],
      disabled: false,
    });

    const response = await POST(
      createMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    );

    expect(response.status).toBe(403);
    expect(oauthClientFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "client_1" } })
    );
  });

  test("authenticates OAuth bearer tokens", async () => {
    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "list_surveys",
            arguments: {
              workspaceId: "clxx1234567890123456789012",
              limit: 20,
              includeTotalCount: true,
            },
          },
        },
        {
          authorization: "Bearer eyJhbGciOiJFZERTQSJ9.payload.signature",
          "x-request-id": "req_oauth",
        }
      )
    );

    expect(response.status).toBe(200);
    // The key set is pre-loaded from the same URL verification reads, so both share Better Auth's cache.
    expect(getJwksMock).toHaveBeenCalledWith("eyJhbGciOiJFZERTQSJ9.payload.signature", {
      jwksFetch: "http://formbricks:3000/api/auth/jwks",
    });
    expect(verifyBearerTokenMock).toHaveBeenCalledWith(
      "eyJhbGciOiJFZERTQSJ9.payload.signature",
      expect.objectContaining({
        jwksUrl: "http://formbricks:3000/api/auth/jwks",
        verifyOptions: expect.objectContaining({
          audience: "http://localhost/api/mcp",
          issuer: "http://localhost/api/auth",
        }),
      })
    );
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Object), "oauth:user_1:client_1");
    await readMcpResponse(response);
    expect(listV3Surveys).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication: {
          user: {
            id: "user_1",
            email: "person@example.com",
            name: "Person",
          },
          expires: expect.any(String),
        },
        requestId: "req_oauth",
        instance: "/api/mcp",
      })
    );
  });

  test("rejects invalid OAuth bearer tokens with an OAuth challenge", async () => {
    verifyBearerTokenMock.mockRejectedValueOnce(new Error("invalid token"));

    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/list",
          params: {},
        },
        {
          authorization: "Bearer eyJhbGciOiJFZERTQSJ9.invalid.signature",
          "x-request-id": "req_invalid_oauth",
        }
      )
    );

    expect(response.status).toBe(401);
    expect(applyIPRateLimit).toHaveBeenCalled();
    expect(response.headers.get("WWW-Authenticate")).toBe(EXPECTED_CHALLENGE);
  });

  test("blocks write tools for read-only OAuth tokens", async () => {
    verifyBearerTokenMock.mockResolvedValueOnce({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      email: "person@example.com",
      scope: "openid profile email surveys:read",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "client_1",
    });

    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "delete_survey",
            arguments: {
              surveyId: "clsv1234567890123456789012",
            },
          },
        },
        {
          authorization: "Bearer eyJhbGciOiJFZERTQSJ9.readonly.signature",
          "x-request-id": "req_read_only",
        }
      )
    );

    expect(response.status).toBe(200);
    const message = await readMcpResponse(response);
    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent.error).toMatchObject({
      status: 403,
      code: "forbidden",
      // Names the scope this specific call needed, not just that some scope was missing — that is
      // the only thing the client can act on.
      detail: "OAuth token does not include the required MCP scope: surveys:write",
      requestId: "req_read_only",
    });
  });

  test("audits a refused mutation by a token without surveys:write", async () => {
    // A write-capable user whose OAuth token was only granted read scopes must not reach a mutation — the
    // ENG-1967 token-scope boundary. (Upstream drove this with delete_workflow; workflow tools are outside
    // the ASLA allowlist, so delete_survey carries the same check.)
    verifyBearerTokenMock.mockResolvedValueOnce({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      email: "person@example.com",
      scope: "openid profile email surveys:read",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "client_1",
    });
    // The module mock returns nothing by default; the guard only queues what the builder hands back.
    vi.mocked(buildV3AuditLog).mockReturnValue({ status: "failure" } as never);

    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "delete_survey",
            arguments: {
              surveyId: "clsv1234567890123456789012",
            },
          },
        },
        {
          authorization: "Bearer eyJhbGciOiJFZERTQSJ9.wfreadonly.signature",
          "x-request-id": "req_wf_read_only",
        }
      )
    );

    expect(response.status).toBe(200);
    const message = await readMcpResponse(response);
    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent.error).toMatchObject({
      status: 403,
      code: "forbidden",
      // The refusal names the scope the client must obtain, since a JSON-RPC tool result carries no
      // WWW-Authenticate header for it to read.
      detail: "OAuth token does not include the required MCP scope: surveys:write",
      requestId: "req_wf_read_only",
    });
    // The scope gate fires BEFORE any mutation side effect — the workflow handler never runs — but the
    // refusal itself is written down as a failed attempt by the caller (ENG-2872): a read-only token
    // reaching for `delete_survey` is exactly the event an audit reviewer wants to see.
    expect(buildV3AuditLog).toHaveBeenCalledTimes(1);
    expect(buildV3AuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: "user_1" }) }),
      "deleted",
      "survey",
      expect.any(String)
    );
    expect(queueV3AuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueV3AuditLog).mock.calls[0][0]).toMatchObject({
      status: "failure",
      eventId: "req_wf_read_only",
      targetId: "clsv1234567890123456789012",
    });
  });

  // ASLA (Must 2): a tool outside the allowlist is not registered, so a call is refused as an unknown
  // tool before any scope gate or handler — for every token, including one holding every scope.
  test.each([
    "create_survey",
    "delete_workflow",
    "patch_workspace_custom_css",
    "create_feedback_record",
    "create_response",
    "delete_response",
    "batch_delete_responses",
  ])("refuses %s, which is outside the allowlist", async (name) => {
    verifyBearerTokenMock.mockResolvedValueOnce({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      scope:
        "surveys:read surveys:write workflows:read workflows:write feedbackRecords:read feedbackRecords:write responses:read responses:write",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "client_1",
    });

    const response = await POST(
      createMcpRequest({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name, arguments: {} } })
    );
    const message = await readMcpResponse(response);

    // The SDK's own unknown-tool refusal: a JSON-RPC Invalid Params error, not a tool result.
    expect(message.result).toBeUndefined();
    expect(message.error).toMatchObject({ code: -32602, message: `Tool ${name} not found` });
    expect(createV3SurveyResponseFromRawInput).not.toHaveBeenCalled();
    expect(buildV3AuditLog).not.toHaveBeenCalled();
  });

  test("calls validate_survey patch through the MCP route", async () => {
    vi.mocked(validateV3SurveyFromRawInput).mockResolvedValue(
      successResponse({ valid: true, operation: "patch", invalid_params: [] }, { requestId: "req_validate" })
    );

    const response = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "validate_survey",
            arguments: {
              operation: "patch",
              surveyId: "clsv1234567890123456789012",
              data: { name: "Updated survey" },
            },
          },
        },
        {
          "x-request-id": "req_validate",
        }
      )
    );

    expect(response.status).toBe(200);
    const message = await readMcpResponse(response);
    expect(message.result.structuredContent).toEqual({
      data: { valid: true, operation: "patch", invalid_params: [] },
      requestId: "req_validate",
    });
    expect(validateV3SurveyFromRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          operation: "patch",
          surveyId: "clsv1234567890123456789012",
          data: { name: "Updated survey" },
        },
        authentication: oauthAuthentication,
        requestId: "req_validate",
        instance: "/api/mcp",
      })
    );
  });

  test("maps v3 validate bad requests to MCP tool errors", async () => {
    vi.mocked(validateV3SurveyFromRawInput).mockResolvedValueOnce(
      problemBadRequest("req_validate_invalid", "Invalid survey validation request", {
        instance: "/api/mcp",
        invalid_params: [{ name: "surveyId", reason: "Required" }],
      })
    );

    const validateResponse = await POST(
      createMcpRequest(
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "validate_survey",
            arguments: {
              operation: "patch",
              data: {},
            },
          },
        },
        { "x-request-id": "req_validate_invalid" }
      )
    );

    expect((await readMcpResponse(validateResponse)).result.structuredContent.error).toMatchObject({
      status: 400,
      detail: "Invalid survey validation request",
      invalid_params: [{ name: "surveyId", reason: "Required" }],
    });
  });
});

/**
 * ASLA (Must 3 and Must 5): the draft-only guard on the write tools, through the real route. The v3
 * operations are mocked, so each test asserts whether the write was reached and with what.
 */
describe("POST /api/mcp — draft-only guard (ASL-1893)", () => {
  const SURVEY_ID = "clsv1234567890123456789012";
  const WORKSPACE_ID = "clws1234567890123456789012";
  const UPDATED_AT = new Date("2026-11-01T12:00:00.000Z");
  const OPEN_TEXT_BLOCK = {
    name: "Block 1",
    elements: [{ id: "q1", type: "openText", headline: { default: "What did you think?" }, required: true }],
  };

  const draftSurvey = (status = "draft") =>
    vi.mocked(getAuthorizedV3Survey).mockResolvedValue({
      survey: { id: SURVEY_ID, status, updatedAt: UPDATED_AT },
      authResult: {},
      response: null,
    } as never);

  const callTool = async (name: string, args: Record<string, unknown>, scope?: string) => {
    if (scope) {
      verifyBearerTokenMock.mockResolvedValueOnce({
        aud: MCP_AUDIENCE,
        sub: "user_1",
        scope,
        exp: Math.floor(Date.now() / 1000) + 900,
        azp: "client_1",
      });
    }
    const response = await POST(
      createMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    );
    expect(response.status).toBe(200);
    return readMcpResponse(response);
  };

  const ok = () => successResponse({ id: SURVEY_ID }, { requestId: "req_ok" });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(applyRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(applyIPRateLimit).mockResolvedValue({ allowed: true });
    userFindUniqueMock.mockResolvedValue({ isActive: true });
    oauthClientFindUniqueMock.mockResolvedValue({ redirectUris: [LIBRECHAT_CALLBACK], disabled: false });
    getJwksMock.mockResolvedValue({ keys: [] });
    verifyBearerTokenMock.mockResolvedValue({
      aud: MCP_AUDIENCE,
      sub: "user_1",
      scope: "surveys:read surveys:write",
      exp: Math.floor(Date.now() / 1000) + 900,
      azp: "client_1",
    });
    vi.mocked(buildV3AuditLog).mockReturnValue({ status: "failure" } as never);
    vi.mocked(withGeneratedInsertIds).mockImplementation((ops) => ops as never);
    for (const operation of [
      createV3SurveyResponseFromRawInput,
      patchV3SurveyResponse,
      editV3SurveyBlocksResponse,
      setV3SurveyBlockOrderResponse,
      deleteV3Survey,
    ]) {
      vi.mocked(operation).mockResolvedValue(ok());
    }
    draftSurvey();
  });

  test("create_survey_draft always creates a link draft", async () => {
    await callTool("create_survey_draft", {
      workspaceId: WORKSPACE_ID,
      name: "Pulse",
      blocks: [OPEN_TEXT_BLOCK],
    });

    expect(createV3SurveyResponseFromRawInput).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ status: "draft", type: "link" }) })
    );
  });

  test.each([
    ["status", "inProgress"],
    ["customCss", { light: "", dark: "" }],
    ["metadata", {}],
  ])("create_survey_draft does not accept %s", async (key, value) => {
    const message = await callTool("create_survey_draft", {
      workspaceId: WORKSPACE_ID,
      name: "Pulse",
      blocks: [OPEN_TEXT_BLOCK],
      [key]: value,
    });

    expect(message.result?.isError ?? Boolean(message.error)).toBe(true);
    expect(createV3SurveyResponseFromRawInput).not.toHaveBeenCalled();
  });

  test.each([
    ["a fileUpload question", { ...OPEN_TEXT_BLOCK, elements: [{ id: "f1", type: "fileUpload" }] }],
    ["a contactInfo question", { ...OPEN_TEXT_BLOCK, elements: [{ id: "c1", type: "contactInfo" }] }],
    [
      "an image from another host",
      {
        ...OPEN_TEXT_BLOCK,
        elements: [{ ...OPEN_TEXT_BLOCK.elements[0], imageUrl: "https://example.com/a.png" }],
      },
    ],
    [
      "an embedded video",
      {
        ...OPEN_TEXT_BLOCK,
        elements: [{ ...OPEN_TEXT_BLOCK.elements[0], videoUrl: "https://www.youtube.com/embed/x" }],
      },
    ],
    [
      "an http CTA link",
      {
        ...OPEN_TEXT_BLOCK,
        elements: [{ id: "c1", type: "cta", buttonExternal: true, buttonUrl: "http://asla.org" }],
      },
    ],
  ])("create_survey_draft refuses %s, audited, without writing", async (_label, block) => {
    const message = await callTool("create_survey_draft", {
      workspaceId: WORKSPACE_ID,
      name: "Pulse",
      blocks: [block],
    });

    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent.error).toMatchObject({ status: 422 });
    expect(createV3SurveyResponseFromRawInput).not.toHaveBeenCalled();
    expect(queueV3AuditLog).toHaveBeenCalledTimes(1);
  });

  test("create_survey_draft accepts a Formbricks storage image", async () => {
    const block = {
      ...OPEN_TEXT_BLOCK,
      elements: [{ ...OPEN_TEXT_BLOCK.elements[0], imageUrl: "/storage/clws1/public/logo.png" }],
    };
    const message = await callTool("create_survey_draft", {
      workspaceId: WORKSPACE_ID,
      name: "Pulse",
      blocks: [block],
    });

    expect(message.result.isError).toBeFalsy();
    expect(createV3SurveyResponseFromRawInput).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["patch_survey", { surveyId: SURVEY_ID, data: { name: "New" } }, patchV3SurveyResponse],
    [
      "edit_survey_blocks",
      { surveyId: SURVEY_ID, ops: [{ op: "remove", id: "b1" }] },
      editV3SurveyBlocksResponse,
    ],
    ["set_survey_block_order", { surveyId: SURVEY_ID, order: ["b1"] }, setV3SurveyBlockOrderResponse],
    ["delete_survey", { surveyId: SURVEY_ID }, deleteV3Survey],
  ] as const)("%s refuses a survey that is not a draft, audited", async (name, args, operation) => {
    draftSurvey("inProgress");

    const message = await callTool(name, args);

    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent.error).toMatchObject({ status: 409 });
    expect(operation).not.toHaveBeenCalled();
    expect(queueV3AuditLog).toHaveBeenCalledTimes(1);
  });

  test("a survey the caller cannot write gets v3's own refusal, not its status", async () => {
    vi.mocked(getAuthorizedV3Survey).mockResolvedValue({
      survey: null,
      authResult: null,
      response: problemBadRequest("req_forbidden", "stand-in for the v3 403"),
    } as never);

    const message = await callTool("delete_survey", { surveyId: SURVEY_ID });

    expect(message.result.structuredContent.error).toMatchObject({ detail: "stand-in for the v3 403" });
    expect(deleteV3Survey).not.toHaveBeenCalled();
  });

  test("a token without surveys:write gets the scope refusal before any survey is read", async () => {
    const message = await callTool("delete_survey", { surveyId: SURVEY_ID }, "surveys:read");

    expect(message.result.structuredContent.error).toMatchObject({ status: 403 });
    expect(getAuthorizedV3Survey).not.toHaveBeenCalled();
  });

  test.each([["inProgress"], ["paused"], ["completed"]])(
    "patch_survey refuses status %s without reading the survey",
    async (status) => {
      const message = await callTool("patch_survey", { surveyId: SURVEY_ID, data: { status } });

      expect(message.result.structuredContent.error).toMatchObject({ status: 422 });
      expect(patchV3SurveyResponse).not.toHaveBeenCalled();
    }
  );

  test.each([["customCss"], ["distribution"], ["targeting"], ["metadata"]])(
    "patch_survey refuses the settings field %s",
    async (key) => {
      const message = await callTool("patch_survey", { surveyId: SURVEY_ID, data: { [key]: null } });

      expect(message.result.structuredContent.error).toMatchObject({ status: 422 });
      expect(patchV3SurveyResponse).not.toHaveBeenCalled();
    }
  );

  test("patch_survey sends the read updatedAt as its precondition", async () => {
    await callTool("patch_survey", { surveyId: SURVEY_ID, data: { name: "New", status: "draft" } });

    expect(patchV3SurveyResponse).toHaveBeenCalledWith(
      expect.objectContaining({ body: { name: "New", status: "draft", updatedAt: UPDATED_AT.toISOString() } })
    );
  });

  test("edit_survey_blocks and set_survey_block_order send the read updatedAt as expectedUpdatedAt", async () => {
    await callTool("edit_survey_blocks", { surveyId: SURVEY_ID, ops: [{ op: "remove", id: "b1" }] });
    await callTool("set_survey_block_order", { surveyId: SURVEY_ID, order: ["b1"] });

    expect(editV3SurveyBlocksResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ expectedUpdatedAt: UPDATED_AT.toISOString() }),
      })
    );
    expect(setV3SurveyBlockOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ expectedUpdatedAt: UPDATED_AT.toISOString() }),
      })
    );
  });

  test("a caller's own expectedUpdatedAt is kept", async () => {
    const own = "2026-10-01T00:00:00.000Z";
    await callTool("set_survey_block_order", { surveyId: SURVEY_ID, order: ["b1"], expectedUpdatedAt: own });

    expect(setV3SurveyBlockOrderResponse).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ expectedUpdatedAt: own }) })
    );
  });

  test("edit_survey_blocks refuses an inserted block with a disallowed question type", async () => {
    const message = await callTool("edit_survey_blocks", {
      surveyId: SURVEY_ID,
      ops: [
        {
          op: "insert",
          position: { type: "end" },
          block: { name: "B", elements: [{ id: "a", type: "address" }] },
        },
      ],
    });

    expect(message.result.structuredContent.error).toMatchObject({
      status: 422,
      invalid_params: [expect.objectContaining({ name: "ops.0.block.elements.0.type" })],
    });
    expect(editV3SurveyBlocksResponse).not.toHaveBeenCalled();
  });

  // Tripwire: a write tool exposed without a draft guard is the hole this ticket closes. An upgrade that
  // adds one to the allowlist, or a guard that stops matching an upstream name, fails here.
  test("every write tool listed is draft-guarded", async () => {
    const response = await POST(
      createMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    );
    const { result } = await readMcpResponse(response);
    const writeTools = (result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[])
      .filter((tool) => tool.annotations?.readOnlyHint !== true)
      .map((tool) => tool.name)
      .sort();

    expect(writeTools).toEqual(
      [
        "create_survey_draft",
        "delete_survey",
        "edit_survey_blocks",
        "patch_survey",
        "set_survey_block_order",
      ].sort()
    );
  });
});
