<<<<<<< HEAD
import { prisma } from "@formbricks/database";
import { getSessionTokenFromCookieHeader, getSessionTokenFromCookieStore } from "./session-cookie";
=======
import { getToken } from "next-auth/jwt";

const NEXT_AUTH_SESSION_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;
>>>>>>> origin/main

type TCookieStore = {
  get: (name: string) => { value: string } | undefined;
};

type TRequestWithCookies = {
  cookies: TCookieStore;
};

export const getSessionTokenFromRequest = (request: TRequestWithCookies): string | null => {
  return getSessionTokenFromCookieStore(request.cookies);
};

<<<<<<< HEAD
const getActiveSessionByToken = async (sessionToken: string | null) => {
  if (!sessionToken) {
=======
/**
 * Validate the request's auth session for the edge `proxy.ts` gate.
 *
 * ASLA fork keeps JWT sessions (`strategy:"jwt"`, no PrismaAdapter) — see
 * FORK_DIVERGENCE Auth §1. Upstream #7594 migrated this gate to a database
 * `Session`-table lookup (`prisma.session.findUnique`). Our fork never writes
 * `Session` rows, so that lookup always returned `null`, which made the proxy
 * bounce every auth-protected route to `/auth/login` — the M365/credentials SSO
 * redirect loop (fb-bm6.12). The session cookie holds an encrypted JWT, not a DB
 * session id, so validate it by decrypting the JWT, mirroring the pre-merge
 * middleware's `getToken()` gate (which is what proved working in prod).
 */
export const getProxySession = async (request: TRequestWithCookies) => {
  // Fast path: no next-auth session cookie at all → unauthenticated.
  if (!getSessionTokenFromRequest(request)) {
>>>>>>> origin/main
    return null;
  }

  // getToken decrypts the JWE session cookie with NEXTAUTH_SECRET and derives the
  // secure cookie name from NEXTAUTH_URL (https → `__Secure-` prefix), so it works
  // behind the TLS-terminating proxy exactly as the old middleware did.
  const token = await getToken({ req: request as never });

  if (!token) {
    return null;
  }

  // The `jwt` callback stamps `isActive` onto the token; treat an explicit false
  // as logged-out so deactivated users cannot pass the gate.
  if (token.isActive === false) {
    return null;
  }

  return token;
};

export const getProxySession = async (request: TRequestWithCookies) => {
  return getActiveSessionByToken(getSessionTokenFromRequest(request));
};

/** Same lookup as `getProxySession`, for callers that only hold the raw `Cookie` header. */
export const getProxySessionFromCookieHeader = async (cookieHeader: string | null) => {
  return getActiveSessionByToken(getSessionTokenFromCookieHeader(cookieHeader));
};
