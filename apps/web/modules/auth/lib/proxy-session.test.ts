import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getProxySession,
  getProxySessionFromCookieHeader,
  getSessionTokenFromRequest,
} from "./proxy-session";

<<<<<<< HEAD
const { TEST_SECRET, mockFindUnique } = vi.hoisted(() => ({
  TEST_SECRET: "proxy-session-test-secret-at-least-32-characters",
  mockFindUnique: vi.fn(),
=======
const { mockGetToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
>>>>>>> origin/main
}));

// ASLA fork uses JWT sessions: the proxy gate validates the encrypted JWT cookie
// via next-auth's getToken, NOT a DB Session-table lookup (see fb-bm6.12).
vi.mock("next-auth/jwt", () => ({
  getToken: mockGetToken,
}));

vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_SECRET: TEST_SECRET },
}));

// Mirror better-call's serializeSignedCookie: `${token}.${base64(HMAC-SHA256(token, secret))}`.
const sign = (token: string, secret = TEST_SECRET): string =>
  `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;

const SELECT = {
  userId: true,
  expires: true,
  user: { select: { isActive: true } },
};

const createRequest = (cookies: Record<string, string> = {}) => ({
  cookies: {
    get: (name: string) => {
      const value = cookies[name];
      return value ? { value } : undefined;
    },
  },
});

describe("proxy-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("extracts the verified session token from a signed Better Auth cookie", () => {
    const request = createRequest({ "__Secure-formbricks.session_token": sign("secure-token") });
    expect(getSessionTokenFromRequest(request)).toBe("secure-token");
  });

<<<<<<< HEAD
  test("rejects a tampered cookie signature without hitting the database", async () => {
    const request = createRequest({
      "__Secure-formbricks.session_token": "valid-token.not-a-valid-signature",
    });
    expect(getSessionTokenFromRequest(request)).toBeNull();
    expect(await getProxySession(request)).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test("returns null when no session cookie is present", async () => {
    const session = await getProxySession(createRequest());
=======
  test("reads the non-secure session cookie when present", () => {
    const request = createRequest({
      "next-auth.session-token": "plain-token",
    });

    expect(getSessionTokenFromRequest(request)).toBe("plain-token");
  });

  test("returns null when no session cookie is present (without decoding a JWT)", async () => {
    const request = createRequest();

    const session = await getProxySession(request);

>>>>>>> origin/main
    expect(session).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

<<<<<<< HEAD
  test("returns null when the session is expired", async () => {
    mockFindUnique.mockResolvedValue({
      userId: "user-1",
      expires: new Date(Date.now() - 60_000),
      user: { isActive: true },
=======
  test("returns null when the JWT cannot be decoded", async () => {
    mockGetToken.mockResolvedValue(null);

    const request = createRequest({
      "__Secure-next-auth.session-token": "garbage",
>>>>>>> origin/main
    });

    const request = createRequest({ "formbricks.session_token": sign("expired-token") });
    const session = await getProxySession(request);

    expect(session).toBeNull();
<<<<<<< HEAD
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { sessionToken: "expired-token" }, select: SELECT });
  });

  test("returns null when the session belongs to an inactive user", async () => {
    mockFindUnique.mockResolvedValue({
      userId: "user-1",
      expires: new Date(Date.now() + 60_000),
      user: { isActive: false },
=======
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  test("returns null when the session belongs to an inactive user", async () => {
    mockGetToken.mockResolvedValue({
      profile: { id: "user-1" },
      isActive: false,
>>>>>>> origin/main
    });

    const request = createRequest({ "formbricks.session_token": sign("inactive-user-token") });
    expect(await getProxySession(request)).toBeNull();
  });

<<<<<<< HEAD
  test("returns the session when the signed cookie maps to a valid session", async () => {
    const validSession = {
      userId: "user-1",
      expires: new Date(Date.now() + 60_000),
      user: { isActive: true },
=======
  test("returns the decoded token when the JWT cookie is valid", async () => {
    const token = {
      profile: { id: "user-1" },
      isActive: true,
      email: "repro@asla.org",
>>>>>>> origin/main
    };
    mockGetToken.mockResolvedValue(token);

<<<<<<< HEAD
    const request = createRequest({ "__Secure-formbricks.session_token": sign("valid-token") });
    const session = await getProxySession(request);

    expect(session).toEqual(validSession);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { sessionToken: "valid-token" }, select: SELECT });
  });

  test("resolves the same active session from a raw Cookie header", async () => {
    const validSession = {
      userId: "user-1",
      expires: new Date(Date.now() + 60_000),
      user: { isActive: true },
    };
    mockFindUnique.mockResolvedValue(validSession);

    const cookieHeader = `other=1; formbricks.session_token=${encodeURIComponent(sign("header-token"))}`;

    expect(await getProxySessionFromCookieHeader(cookieHeader)).toEqual(validSession);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { sessionToken: "header-token" }, select: SELECT });
  });

  test("returns null from a Cookie header without a verified session cookie, without a query", async () => {
    expect(await getProxySessionFromCookieHeader(null)).toBeNull();
    expect(await getProxySessionFromCookieHeader("formbricks.session_token=forged.signature")).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
=======
    const request = createRequest({
      "__Secure-next-auth.session-token": "valid-jwt",
    });

    const session = await getProxySession(request);

    expect(session).toEqual(token);
  });

  test("returns the token when isActive is undefined (older tokens)", async () => {
    const token = { profile: { id: "user-1" } };
    mockGetToken.mockResolvedValue(token);

    const request = createRequest({
      "__Secure-next-auth.session-token": "valid-jwt",
    });

    const session = await getProxySession(request);

    expect(session).toEqual(token);
>>>>>>> origin/main
  });
});
