import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";
import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/[[...resource]]/route";
import { AUTH_DISABLED_PATHS, OAUTH_CLIENT_MUTATION_PATHS } from "./auth-disabled-paths";
import { prepareDcrRequest, withInferredApplicationType } from "./mcp-dcr-application-type";
import { getMcpOauthProviderOptions } from "./mcp-oauth-provider-options";
import { getAuthIssuerUrl, getMcpResourceUrl, getOAuthUserInfoUrl } from "./oauth-urls";

// Env-dependent URL getters pinned; scope constants stay real — the whole point of this suite
// is to exercise the actual advertised-scope → DCR → authorize chain (ENG-1055).
vi.mock("@/lib/env", () => ({
  env: {
    WEBAPP_URL: "http://localhost:3000",
    BETTER_AUTH_URL: undefined,
    NEXTAUTH_URL: undefined,
    PUBLIC_URL: undefined,
    MCP_DCR_ALLOWED_REDIRECT_URIS: undefined,
    MCP_LIBRECHAT_CALLBACK_URI: "https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback",
    // Literal, not the constant below: vi.mock factories are hoisted above module scope.
    MCP_DCR_INITIAL_ACCESS_TOKEN: "mcp-dcr-test-initial-access-token-0123456789abcdef",
  },
}));

/**
 * ASLA (Must 1): registration needs the operator's RFC 7591 initial access token. Every registration in
 * this file sends it unless the test is about what happens without it.
 */
const INITIAL_ACCESS_TOKEN = "mcp-dcr-test-initial-access-token-0123456789abcdef";
const REGISTRATION_HEADERS = {
  "content-type": "application/json",
  authorization: `Bearer ${INITIAL_ACCESS_TOKEN}`,
};

const BASE_URL = "http://localhost:3000";
const REDIRECT_URI = "http://127.0.0.1:33418/callback";

/**
 * A registration exactly as an MCP client sends it: a loopback callback and no `application_type`.
 * Shared by the two suites below, which read it from opposite ends — one asks what upstream does with
 * it, the other that our own gate lets it through untouched.
 */
const LOOPBACK_REGISTRATION = JSON.stringify({
  client_name: "MCP DCR client that omits application_type",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: "surveys:read",
});

/**
 * Regression suite for the MCP OAuth handshake as REAL clients drive it (Claude Code, MCP
 * Inspector): they read `scopes_supported` from the RFC 9728 protected-resource metadata, do
 * Dynamic Client Registration with exactly those scopes, then request the same scopes at
 * /authorize. The oauth-provider plugin validates /authorize against the client's REGISTERED
 * scopes, so any advertised-but-not-registered scope aborts login with invalid_scope — which is
 * how the missing offline_access advertisement broke every MCP-client login. A pre-seeded
 * full-scope client would mask that bug, so this suite must register via DCR only.
 */
const createAuthInstance = ({
  withEmailPassword = false,
  disabledPaths,
}: { withEmailPassword?: boolean; disabledPaths?: string[] } = {}) => {
  // memoryAdapter needs every model it will touch declared up front — it does not create them
  // lazily. Better Auth 1.7 added the resource tables, and without them the plugin's boot-time
  // resource seeding logs `Model oauthResource not found in the DB` and every authorize fails.
  const db: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
    oauthResource: [],
    oauthClientResource: [],
    oauthClientAssertion: [],
  };
  return betterAuth({
    baseURL: BASE_URL,
    secret: "mcp-oauth-dcr-test-secret",
    database: memoryAdapter(db),
    // Only the end-to-end flow below needs a signed-in user; everything else stops at the login redirect.
    ...(withEmailPassword ? { emailAndPassword: { enabled: true } } : {}),
    ...(disabledPaths ? { disabledPaths } : {}),
    // jwt is a hard dependency of oauthProvider; configured as in production auth.ts.
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwt: { issuer: getAuthIssuerUrl(), audience: getMcpResourceUrl() },
      }),
      oauthProvider(getMcpOauthProviderOptions()),
    ],
  });
};

const fetchAdvertisedScopes = async (): Promise<string[]> => {
  const response = await getProtectedResourceMetadata(
    new NextRequest(`${BASE_URL}/.well-known/oauth-protected-resource/api/mcp`),
    { params: Promise.resolve({ resource: ["api", "mcp"] }) }
  );
  const metadata = (await response.json()) as { scopes_supported: string[] };
  return metadata.scopes_supported;
};

const registerClient = async (auth: ReturnType<typeof createAuthInstance>, scopes: string[]) => {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/oauth2/register`, {
      method: "POST",
      headers: REGISTRATION_HEADERS,
      body: JSON.stringify({
        client_name: "MCP DCR test client",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        // Better Auth 1.7 validates redirect URIs against the OIDC application type, and DCR without
        // an explicit `application_type` defaults to "web" — for which ANY loopback redirect URI is
        // refused. MCP clients listen on a loopback port, so they are native clients and must say so.
        // See the sibling test below, which pins the refusal.
        application_type: "native",
        scope: scopes.join(" "),
      }),
    })
  );

  return { status: response.status, body: (await response.json()) as { client_id?: string; scope?: string } };
};

const requestAuthorize = async (
  auth: ReturnType<typeof createAuthInstance>,
  clientId: string,
  scopes: string[]
) => {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state: "test-state",
    // PKCE is mandatory for public clients and for offline_access requests.
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });

  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/oauth2/authorize?${query.toString()}`, { redirect: "manual" })
  );

  return { status: response.status, location: response.headers.get("location") ?? "" };
};

describe("MCP OAuth Dynamic Client Registration → authorize (real-client shape)", () => {
  test("limits access tokens to the single MCP resource audience", () => {
    const { resources } = getMcpOauthProviderOptions();

    expect(resources).toHaveLength(1);
    expect(resources?.[0]).toMatchObject({ identifier: getMcpResourceUrl() });
  });

  /**
   * The MCP resource server allow-lists the AS's UserInfo endpoint as a second acceptable audience,
   * because the provider appends it to `aud` whenever `openid` is in the granted scopes. Every other
   * test compares our derivation of that URL to our own derivation, which would hold for any string
   * — including a wrong one. Asserting against the instance's own discovery document is what pins the
   * equality the allow-list actually depends on: the provider builds `userinfo_endpoint` and the
   * appended audience from the same `${baseURL}/oauth2/userinfo` expression.
   */
  test("the UserInfo audience we allow-list is the one the provider stamps", async () => {
    const auth = createAuthInstance();

    const response = await auth.handler(new Request(`${BASE_URL}/api/auth/.well-known/openid-configuration`));
    const { userinfo_endpoint: userinfoEndpoint } = (await response.json()) as {
      userinfo_endpoint: string;
    };

    expect(userinfoEndpoint).toBe(getOAuthUserInfoUrl());
  });

  /**
   * The 1.7 redirect-URI rules (ENG-2343), and the fix for them.
   *
   * An MCP client registers a loopback callback such as http://127.0.0.1:PORT/callback. Under 1.7 that
   * is legal only for a *native* client: DCR hardcodes the `application_type` default to "web", and
   * `validateClientRedirectUri` refuses every loopback URI for web clients — so a client that omits the
   * field is rejected before the user ever sees a consent screen. 1.6 had no such validation, so this
   * regressed working clients, and neither the default (a literal at the call site, not an option) nor
   * the clients are ours to change.
   *
   * These two tests are a pair: the first pins what upstream does, which is why the normalizer exists;
   * the second proves the normalizer actually resolves it against that same real validator. Note the
   * body is IDENTICAL in both — only `withInferredApplicationType` is applied.
   */
  const register = (auth: ReturnType<typeof createAuthInstance>, body: string) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/register`, {
        method: "POST",
        headers: REGISTRATION_HEADERS,
        body,
      })
    );

  test("upstream refuses a loopback redirect URI when the client does not declare itself native", async () => {
    const response = await register(createAuthInstance(), LOOPBACK_REGISTRATION);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });

  test("the inferred application_type makes that same registration succeed", async () => {
    const response = await register(createAuthInstance(), withInferredApplicationType(LOOPBACK_REGISTRATION));
    const body = (await response.json()) as { client_id?: string; application_type?: string; error?: string };

    expect(body.error).toBeUndefined();
    expect(response.status).toBeLessThan(300);
    expect(body.client_id).toBeTruthy();
  });

  /**
   * The security boundary the inference leans on. It fires whenever ANY redirect URI is http loopback,
   * which is deliberately wider than "all of them" — a native client may legitimately pair a loopback
   * URI with an https one. That widening is only safe because `native` does not relax the rule for a
   * non-loopback http URI, so being labelled native can never be a route to registering one. Asserted
   * against the real validator rather than reasoned about, because the whole class of bug here is
   * upstream changing a rule we assumed.
   */
  test("being labelled native does not let a non-loopback http redirect register", async () => {
    const payload = JSON.stringify({
      client_name: "Mixed Client",
      redirect_uris: ["http://127.0.0.1:9999/callback", "http://evil.example.com/callback"],
      token_endpoint_auth_method: "none",
    });
    const inferred = withInferredApplicationType(payload);

    // The inference does fire on this shape …
    expect(JSON.parse(inferred).application_type).toBe("native");

    // … and upstream still refuses the registration.
    const response = await register(createAuthInstance(), inferred);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });

  test("PRM-advertised scopes register verbatim, including offline_access", async () => {
    const auth = createAuthInstance();
    const advertisedScopes = await fetchAdvertisedScopes();

    expect(advertisedScopes).toContain("offline_access");

    const registration = await registerClient(auth, advertisedScopes);

    // 201 Created since 1.7 (RFC 7591 §3.2.1).
    expect(registration.status).toBe(201);
    expect(registration.body.client_id).toBeTruthy();
    // The registered scope set is what /authorize validates against — offline_access must survive.
    expect(registration.body.scope?.split(" ")).toEqual(expect.arrayContaining(advertisedScopes));
  });

  test("default registration (no scope requested) grants read + write", async () => {
    const auth = createAuthInstance();

    // A client that registers without an explicit scope must receive write by default — otherwise the
    // consent screen only offers "Read surveys" and every write tool 403s (the ENG-1055 QA regression:
    // clients that key off the challenge/defaults rather than the PRM never requested write).
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/register`, {
        method: "POST",
        headers: REGISTRATION_HEADERS,
        body: JSON.stringify({
          client_name: "MCP DCR default-scope client",
          redirect_uris: [REDIRECT_URI],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          application_type: "native",
        }),
      })
    );
    const body = (await response.json()) as { scope?: string };

    // Better Auth 1.7 returns 201 Created here, per RFC 7591 §3.2.1; 1.6 answered 200.
    expect(response.status).toBe(201);
    expect(body.scope?.split(" ")).toEqual(
      expect.arrayContaining([
        "surveys:read",
        "surveys:write",
        "workflows:read",
        "workflows:write",
        "offline_access",
      ])
    );
  });

  test("authorize accepts the PRM-advertised scopes for a DCR client (no invalid_scope)", async () => {
    const auth = createAuthInstance();
    const advertisedScopes = await fetchAdvertisedScopes();
    const registration = await registerClient(auth, advertisedScopes);
    const clientId = registration.body.client_id;
    expect(clientId).toBeTruthy();

    // Real clients (Claude Code, MCP Inspector) request offline_access at /authorize regardless
    // of the advertisement — they want a refresh token. Model that exactly: registered scopes
    // came from the PRM, authorize adds offline_access on top.
    const authorizeScopes = Array.from(new Set([...advertisedScopes, "offline_access"]));
    const authorize = await requestAuthorize(auth, clientId as string, authorizeScopes);

    // Scope validation happens before the session check, so a passing request redirects to the
    // login page — NOT back to redirect_uri with error=invalid_scope (the ENG-1055 failure mode).
    expect(authorize.location).not.toContain("error=invalid_scope");
    expect(authorize.location).toContain("/auth/login");
  });

  /**
   * ENG-3470. A spec-following client — the MCP SDK takes its scope from the 401 challenge, then the
   * protected-resource metadata — only ever requests what is advertised. While `responses:*` were held
   * back from that list, such a client was never offered them and every response tool answered 403,
   * even though the scopes were grantable. Asserted on what reaches the consent step (the login
   * redirect carries the requested scope), not on the constant, so it fails the way a real client
   * failed.
   */
  test("a spec client that authorizes with the advertised scopes is offered the response scopes", async () => {
    const auth = createAuthInstance();
    const advertisedScopes = await fetchAdvertisedScopes();
    const registration = await registerClient(auth, advertisedScopes);

    const authorize = await requestAuthorize(auth, registration.body.client_id as string, advertisedScopes);
    const requested = (new URLSearchParams(authorize.location.split("?")[1] ?? "").get("scope") ?? "").split(
      " "
    );

    expect(authorize.location).toContain("/auth/login");
    expect(authorize.location).not.toContain("error=");
    expect(requested).toEqual(expect.arrayContaining(["responses:read", "responses:write"]));
  });

  /**
   * Behaviour change in Better Auth 1.7, pinned deliberately (ENG-2343).
   *
   * In 1.6 a client was registered with exactly the scopes it asked for, so a client that requested
   * `surveys:read` could not later authorize `offline_access` — authorize answered `invalid_scope`.
   * In 1.7 `clientRegistrationDefaultScopes` is applied regardless of what the client requested, so
   * every DCR client is registered with the full advertised set and a narrower request no longer
   * constrains it.
   *
   * That removes a boundary: a client can no longer self-limit at registration. It does NOT grant
   * anything by itself — the token still only carries the scopes the user approves at consent, the
   * per-tool guards check the token's scopes, and workspace permissions bound what those can reach.
   * But "registered read-only" is no longer a thing, so it is asserted here rather than assumed.
   */
  test("registration grants the full default scope set even when the client asks for less", async () => {
    const auth = createAuthInstance();

    const registration = await registerClient(auth, ["surveys:read"]);
    const clientId = registration.body.client_id;
    expect(clientId).toBeTruthy();

    expect(registration.body.scope?.split(" ")).toEqual(expect.arrayContaining(["surveys:write"]));

    // Consequence: a scope the client never requested is now accepted at authorize.
    //
    // Asserted as a positive outcome, not as the absence of one error string. `requestAuthorize`
    // defaults `location` to "" when the header is missing, and "" satisfies every `not.toContain` —
    // so a negative assertion here would also pass if authorize returned a different error, or no
    // redirect at all. What an accepted request actually does, unauthenticated, is bounce to the
    // configured loginPage carrying no `error`.
    const authorize = await requestAuthorize(auth, clientId as string, ["surveys:read", "offline_access"]);
    expect(authorize.location).toBeTruthy();

    const location = new URL(authorize.location, BASE_URL);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("error")).toBeNull();
  });

  test("authorize still rejects a scope outside the advertised set entirely", async () => {
    const auth = createAuthInstance();
    const registration = await registerClient(auth, ["surveys:read"]);

    const authorize = await requestAuthorize(auth, registration.body.client_id as string, [
      "surveys:read",
      "billing:admin",
    ]);

    expect(authorize.location).toContain("error=invalid_scope");
  });
});

const REGISTER_PATH = "/api/auth/oauth2/register";

const registrationRequest = (
  path: string,
  body: string,
  contentType = "application/json",
  authorization: string | null = `Bearer ${INITIAL_ACCESS_TOKEN}`
) =>
  new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": contentType, ...(authorization ? { authorization } : {}) },
    body,
  });

/** The route's real pipeline: the gate first, then Better Auth for whatever it lets through. */
const throughRoute = async (auth: ReturnType<typeof createAuthInstance>, request: Request) => {
  const prepared = await prepareDcrRequest(request);
  return prepared instanceof Response ? prepared : auth.handler(prepared);
};

/**
 * The DCR redirect-URI allowlist (ENG-3086) against the REAL plugin, which is the only place its two
 * load-bearing assumptions can be checked. The allowlist is a pre-handler gate keyed on the request
 * path, so it is only complete while upstream agrees with it about (a) which paths reach
 * `/oauth2/register` and (b) which bodies that endpoint will parse. Either could change under a
 * version bump, and either changing silently reopens the hole — a path upstream routes but the gate
 * does not match is a bypass, not a 404. So both are asserted here rather than reasoned about, the
 * same discipline as the `application_type` pair above.
 */
describe("DCR redirect-URI allowlist vs. the real plugin (ENG-3086)", () => {
  /** The pentest report's payload, byte for byte (ENG-3086). */
  const REPORTED_REGISTRATION = JSON.stringify({
    client_name: "SecurityResearchVerify1",
    redirect_uris: ["https://attacker-controlled-test.example.org/cb"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  test("upstream alone registers the reported attacker client", async () => {
    const response = await createAuthInstance().handler(
      registrationRequest(REGISTER_PATH, REPORTED_REGISTRATION)
    );
    const body = (await response.json()) as { client_id?: string };

    // The vulnerability itself: an anonymous caller, an attacker-controlled https redirect, a
    // client_id back. This is what the gate below has to be measured against.
    expect(response.status).toBe(201);
    expect(body.client_id).toBeTruthy();
  });

  test("the gate rejects that same registration before upstream sees it", async () => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(REGISTER_PATH, REPORTED_REGISTRATION)
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });

  test("ASLA: the gate refuses a loopback MCP registration (desktop clients are not allowed)", async () => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(REGISTER_PATH, LOOPBACK_REGISTRATION)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  // Paths the gate matches. `..` and a query string are the two that would slip past a naive
  // pathname comparison, so they are pinned as matched rather than left to the router.
  test.each([REGISTER_PATH, `${REGISTER_PATH}?x=1`, "/api/auth/x/../oauth2/register"])(
    "the gate matches %s",
    async (path) => {
      const response = await throughRoute(
        createAuthInstance(),
        registrationRequest(path, REPORTED_REGISTRATION)
      );

      expect(response.status).toBe(400);
    }
  );

  // …and the mirror image: every near-miss spelling the gate does NOT match must be a path upstream
  // does not route either. A 201 here would mean the allowlist can be walked around by rewriting the
  // URL, which is the failure mode a pre-handler gate has and a plugin-level hook would not.
  test.each([
    `${REGISTER_PATH}/`,
    "/api/auth/oauth2/REGISTER",
    "/api/auth/oauth2/regis%74er",
    "/api/auth//oauth2/register",
    `${REGISTER_PATH}.`,
    `${REGISTER_PATH};x`,
    `${REGISTER_PATH}%20`,
  ])("upstream does not route %s, which the gate deliberately ignores", async (path) => {
    // Returned as the very same object: the gate does not read this request at all, let alone judge it.
    const probe = registrationRequest(path, REPORTED_REGISTRATION);
    expect(await prepareDcrRequest(probe)).toBe(probe);

    const response = await createAuthInstance().handler(registrationRequest(path, REPORTED_REGISTRATION));

    expect(response.status).toBe(404);
  });

  // The other half of the same question: the gate reads the body as JSON, so a content type upstream
  // would parse some other way would be a bypass. Upstream accepts application/json only.
  test("upstream refuses a form-encoded registration outright", async () => {
    const response = await createAuthInstance().handler(
      registrationRequest(
        REGISTER_PATH,
        `redirect_uris[]=${encodeURIComponent("https://attacker-controlled-test.example.org/cb")}`,
        "application/x-www-form-urlencoded"
      )
    );

    expect(response.status).toBe(415);
  });
});

/**
 * ASLA Must 1 (ENG-3471 upstream). Only ASLA Chat's LibreChat connector may register: its exact callback
 * (`MCP_LIBRECHAT_CALLBACK_URI`, pinned to the sandbox value in the env mock above) passes the gate, and
 * the upstream hosted connectors (claude.ai, ChatGPT) that 6.1 allows are refused. The suite proves the
 * LibreChat client reaches a token for the MCP resource, and pins the upstream behaviour the design rests
 * on: Better Auth matches the redirect URI exactly at `/authorize`, so a registered callback cannot be
 * widened to another path or query later.
 */
describe("LibreChat connector registration vs. the real plugin (ASLA Must 1)", () => {
  const LIBRECHAT = "https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback";
  const LIBRECHAT_PRODUCTION = "https://chat.aslalabs.org/api/mcp/formbricks/oauth/callback";
  const CLAUDE_AI = "https://claude.ai/api/mcp/auth_callback";
  const CLAUDE_COM = "https://claude.com/api/mcp/auth_callback";
  const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

  const LIBRECHAT_REGISTRATION = JSON.stringify({
    client_name: "ASLA Chat",
    redirect_uris: [LIBRECHAT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  // claude.ai lists both callbacks in one body and sends no application_type.
  const CLAUDE_REGISTRATION = JSON.stringify({
    client_name: "Claude",
    redirect_uris: [CLAUDE_AI, CLAUDE_COM],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  const CHATGPT_REGISTRATION = JSON.stringify({
    client_name: "ChatGPT",
    redirect_uris: [CHATGPT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  // `vitestSetup.ts` stubs node:crypto's createHash, so PKCE is computed with WebCrypto.
  const createPkcePair = async () => {
    const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: Buffer.from(digest).toString("base64url") };
  };

  test("a LibreChat registration passes the gate and registers with exactly its callback", async () => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(REGISTER_PATH, LIBRECHAT_REGISTRATION)
    );
    const registered = (await response.json()) as { client_id?: string; redirect_uris?: string[] };

    expect(response.status).toBe(201);
    // The operator pins this value as MCP_LIBRECHAT_CLIENT_ID, so a generated ID must pass the same
    // format rule `lib/env.ts` enforces, or the app refuses to boot with it.
    expect(registered.client_id).toMatch(/^[\w-]{8,128}$/);
    expect(registered.redirect_uris).toEqual([LIBRECHAT]);
  });

  test.each([
    ["claude.ai", CLAUDE_REGISTRATION],
    ["ChatGPT", CHATGPT_REGISTRATION],
  ])("ASLA: the gate refuses a %s registration that upstream would accept", async (_client, body) => {
    const response = await throughRoute(createAuthInstance(), registrationRequest(REGISTER_PATH, body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  test.each([
    ["the production callback on the sandbox", [LIBRECHAT_PRODUCTION]],
    ["the callback plus a second URI", [LIBRECHAT, "https://attacker-controlled-test.example.org/cb"]],
    ["the callback twice", [LIBRECHAT, LIBRECHAT]],
    ["no redirect URI", []],
  ])("ASLA: the gate refuses %s", async (_case, redirectUris) => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(
        REGISTER_PATH,
        JSON.stringify({ ...JSON.parse(LIBRECHAT_REGISTRATION), redirect_uris: redirectUris })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  test("a lookalike of the LibreChat callback is refused by the gate", async () => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(
        REGISTER_PATH,
        JSON.stringify({ ...JSON.parse(LIBRECHAT_REGISTRATION), redirect_uris: [`${LIBRECHAT}/`] })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  test("a registered LibreChat client completes consent → code → token for the MCP resource", async () => {
    const auth = createAuthInstance({ withEmailPassword: true });
    const registration = await throughRoute(auth, registrationRequest(REGISTER_PATH, LIBRECHAT_REGISTRATION));
    const { client_id: clientId } = (await registration.json()) as { client_id: string };

    const signUp = await auth.api.signUpEmail({
      body: { email: "connector-user@example.com", password: "a-long-test-password-1", name: "User" },
      asResponse: true,
    });
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    const { verifier, challenge } = await createPkcePair();
    const resource = getMcpResourceUrl();
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: LIBRECHAT,
      scope: "surveys:read offline_access",
      state: "librechat-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    });
    const authorize = await auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/authorize?${query.toString()}`, {
        headers: { cookie },
        redirect: "manual",
      })
    );
    const consentLocation = new URL(authorize.headers.get("location") ?? "", BASE_URL);
    // Consent is never skipped for a dynamically registered client.
    expect(consentLocation.pathname).toBe("/account/authorize");

    const consent = await auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: BASE_URL },
        body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) }),
      })
    );
    const { url: callbackUrl } = (await consent.json()) as { url: string };
    const callback = new URL(callbackUrl);

    expect(`${callback.origin}${callback.pathname}`).toBe(LIBRECHAT);
    expect(callback.searchParams.get("state")).toBe("librechat-state");
    // RFC 9207: ChatGPT only uses its stable callback when the AS returns `iss`.
    expect(callback.searchParams.get("iss")).toBe(getAuthIssuerUrl());

    const token = await auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: callback.searchParams.get("code") ?? "",
          redirect_uri: LIBRECHAT,
          client_id: clientId,
          code_verifier: verifier,
          resource,
        }),
      })
    );
    const tokens = (await token.json()) as { access_token: string; refresh_token?: string };

    expect(token.status).toBe(200);
    expect(tokens.refresh_token).toBeTruthy();
    const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url").toString()) as {
      aud: string | string[];
    };
    expect([claims.aud].flat()).toContain(resource);
  });

  test.each([
    `${LIBRECHAT}?next=https://evil.example.com`,
    `${LIBRECHAT}/`,
    "https://chat.aslalabs.org/api/mcp/other/oauth/callback",
  ])("upstream refuses to redirect a registered LibreChat client to %s", async (redirectUri) => {
    const auth = createAuthInstance();
    const registration = await throughRoute(auth, registrationRequest(REGISTER_PATH, LIBRECHAT_REGISTRATION));
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    const { challenge } = await createPkcePair();

    const authorize = await auth.handler(
      new Request(
        `${BASE_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: "surveys:read",
          state: "s",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString()}`,
        { redirect: "manual" }
      )
    );
    const location = authorize.headers.get("location") ?? "";

    // Upstream answers on its own error page and never sends the browser to the unregistered URI.
    expect(location).not.toContain("chat.aslalabs.org");
    expect(location).toContain("invalid_redirect");
  });
});

/**
 * ASLA Must 1: the signed-in client-management routes. Upstream 6.1 leaves them open to any signed-in
 * user, which bypasses the DCR gate entirely (ASL-1799). Each is driven against the real plugin twice:
 * open without `disabledPaths` (so the 404 below is proof of the closure, not of a wrong path), and
 * closed with the production list.
 */
describe("OAuth client-management routes (ASLA Must 1)", () => {
  const LIBRECHAT_ONLY_REGISTRATION = JSON.stringify({
    client_name: "ASLA Chat",
    redirect_uris: ["https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });

  const signedInCookie = async (auth: ReturnType<typeof createAuthInstance>) => {
    const signUp = await auth.api.signUpEmail({
      body: { email: "client-admin@example.com", password: "a-long-test-password-1", name: "User" },
      asResponse: true,
    });
    return signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const createClientRequest = (path: string, cookie: string) =>
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: BASE_URL },
      body: JSON.stringify({
        client_name: "Signed-in client",
        redirect_uris: ["http://127.0.0.1:33418/callback"],
        application_type: "native",
        token_endpoint_auth_method: "none",
      }),
    });

  // `clientPrivileges` denies `create` to sessions, so this is closed even before disabledPaths 404s it.
  test("a signed-in user cannot create a client even where the route is mounted", async () => {
    const auth = createAuthInstance({ withEmailPassword: true });
    const response = await auth.handler(
      createClientRequest("/oauth2/create-client", await signedInCookie(auth))
    );

    expect(response.status).toBe(401);
  });

  test.each([
    "/oauth2/create-client",
    "/oauth2/create-client?x=1",
    "/oauth2/update-client",
    "/oauth2/client/rotate-secret",
    "/oauth2/delete-client",
    "/admin/oauth2/create-client",
    "/admin/oauth2/update-client",
  ])("the production disabledPaths answer %s with 404", async (path) => {
    const auth = createAuthInstance({ withEmailPassword: true, disabledPaths: [...AUTH_DISABLED_PATHS] });
    const response = await auth.handler(createClientRequest(path, await signedInCookie(auth)));

    expect(response.status).toBe(404);
  });

  // Near-miss spellings must be paths upstream does not route either, or the closure can be walked around.
  test.each([
    "/oauth2/create-client/",
    "/oauth2/CREATE-CLIENT",
    "//oauth2/create-client",
    "/oauth2/create%2Dclient",
  ])("upstream does not route %s", async (path) => {
    const auth = createAuthInstance({ withEmailPassword: true, disabledPaths: [...AUTH_DISABLED_PATHS] });
    const response = await auth.handler(createClientRequest(path, await signedInCookie(auth)));

    expect(response.status).toBe(404);
  });

  // Nor in-process: the admin endpoint takes a session, and sessions may not create clients. The only way
  // to create one is registration with the initial access token.
  test("a session cannot create a client through the admin endpoint in-process", async () => {
    const auth = createAuthInstance({ withEmailPassword: true, disabledPaths: [...AUTH_DISABLED_PATHS] });

    await expect(
      auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: await signedInCookie(auth) }),
        body: {
          client_name: "ASLA Chat",
          redirect_uris: ["https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        },
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  test.each([
    ["no token", null],
    ["a wrong token", "Bearer not-the-operator-token-but-just-as-long-0123456"],
    ["a prefix of the token", `Bearer ${INITIAL_ACCESS_TOKEN.slice(0, -1)}`],
  ])("registration with %s is refused, even for the LibreChat callback", async (_label, authorization) => {
    const response = await throughRoute(
      createAuthInstance(),
      registrationRequest(REGISTER_PATH, LIBRECHAT_ONLY_REGISTRATION, "application/json", authorization)
    );

    expect(response.status).toBe(401);
  });

  test("a signed-in session cannot register a client, even with the right token alongside", async () => {
    const auth = createAuthInstance({ withEmailPassword: true });
    const request = registrationRequest(REGISTER_PATH, LIBRECHAT_ONLY_REGISTRATION);
    request.headers.set("cookie", await signedInCookie(auth));

    const response = await throughRoute(auth, request);

    expect(response.status).toBe(401);
  });

  test("registration is closed entirely while MCP_DCR_INITIAL_ACCESS_TOKEN is unset", async () => {
    const { env } = await import("@/lib/env");
    const mutableEnv = env as { MCP_DCR_INITIAL_ACCESS_TOKEN?: string };
    mutableEnv.MCP_DCR_INITIAL_ACCESS_TOKEN = undefined;
    try {
      const response = await throughRoute(
        createAuthInstance(),
        registrationRequest(REGISTER_PATH, LIBRECHAT_ONLY_REGISTRATION)
      );
      expect(response.status).toBe(401);
    } finally {
      mutableEnv.MCP_DCR_INITIAL_ACCESS_TOKEN = INITIAL_ACCESS_TOKEN;
    }
  });

  // Upgrade tripwire: a route that can create, change, rotate or delete a client must be either closed
  // here or SERVER_ONLY. A new one in a later oauth-provider release fails this test until it is.
  test("every client-mutating endpoint the plugin mounts is closed or SERVER_ONLY", () => {
    const endpoints = Object.values(oauthProvider(getMcpOauthProviderOptions()).endpoints) as {
      path: string;
      options?: { metadata?: { SERVER_ONLY?: boolean } };
    }[];
    const mutating = endpoints.filter(
      ({ path }) => /client/.test(path) && /(create|update|delete|rotate|register)/.test(path)
    );

    expect(mutating.length).toBeGreaterThan(0);
    const open = mutating.filter(
      ({ path, options }) =>
        path !== "/oauth2/register" &&
        !options?.metadata?.SERVER_ONLY &&
        !(OAUTH_CLIENT_MUTATION_PATHS as readonly string[]).includes(path)
    );
    expect(open.map(({ path }) => path)).toEqual([]);
  });
});
