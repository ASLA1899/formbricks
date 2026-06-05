import { beforeEach, describe, expect, test, vi } from "vitest";
import { getProxySession, getSessionTokenFromRequest } from "./proxy-session";

const { mockGetToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
}));

// ASLA fork uses JWT sessions: the proxy gate validates the encrypted JWT cookie
// via next-auth's getToken, NOT a DB Session-table lookup (see fb-bm6.12).
vi.mock("next-auth/jwt", () => ({
  getToken: mockGetToken,
}));

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

  test("reads the secure session cookie when present", () => {
    const request = createRequest({
      "__Secure-next-auth.session-token": "secure-token",
    });

    expect(getSessionTokenFromRequest(request)).toBe("secure-token");
  });

  test("reads the non-secure session cookie when present", () => {
    const request = createRequest({
      "next-auth.session-token": "plain-token",
    });

    expect(getSessionTokenFromRequest(request)).toBe("plain-token");
  });

  test("returns null when no session cookie is present (without decoding a JWT)", async () => {
    const request = createRequest();

    const session = await getProxySession(request);

    expect(session).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test("returns null when the JWT cannot be decoded", async () => {
    mockGetToken.mockResolvedValue(null);

    const request = createRequest({
      "__Secure-next-auth.session-token": "garbage",
    });

    const session = await getProxySession(request);

    expect(session).toBeNull();
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  test("returns null when the session belongs to an inactive user", async () => {
    mockGetToken.mockResolvedValue({
      profile: { id: "user-1" },
      isActive: false,
    });

    const request = createRequest({
      "next-auth.session-token": "inactive-user-token",
    });

    const session = await getProxySession(request);

    expect(session).toBeNull();
  });

  test("returns the decoded token when the JWT cookie is valid", async () => {
    const token = {
      profile: { id: "user-1" },
      isActive: true,
      email: "repro@asla.org",
    };
    mockGetToken.mockResolvedValue(token);

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
  });
});
