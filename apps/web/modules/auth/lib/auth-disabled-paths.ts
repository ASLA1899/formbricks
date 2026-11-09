/**
 * Better Auth routes served over HTTP for nobody. `disabledPaths` is applied in the router alone
 * (`better-auth/dist/api/index.mjs`), so every one of these stays callable in-process through
 * `auth.api.*`. Kept in its own module so tests drive the real list without importing auth.ts.
 *
 * `/update-user` is served over HTTP for nobody (ENG-3189). Better Auth mounts it beside our own
 * profile surface, and every field it can reach is one Formbricks does not let a client write there:
 *
 *  - `name` is the identity provider's for an SSO user — re-read on every sign-in
 *    (`overrideUserInfo`) and locked in `updateUserAction` — yet a raw POST landed the write anyway,
 *    unaudited, until the next sign-in silently reverted it.
 *  - `image` has no `User` column at all, so the write reached Prisma and threw an unhandled 500 —
 *    the same hazard `ssoProfileSyncUpdateBefore` and `user.create.before` strip on the SSO paths.
 *  - `email` the endpoint refuses itself, and our two `additionalFields` are `input: false`.
 *
 * So there is nothing left for it to legitimately do, and a 404 at the router is a smaller, more
 * complete answer than a `hooks.before` gate: profile writes go through `updateUserAction`, which
 * owns the SSO name lock, the verified email-change flow, rate limiting, and the audit entry. The
 * path is HTTP-only — `auth.api.updateUser` stays available to server code (`api/index.mjs` applies
 * `disabledPaths` in the router alone), which is what the SSO hooks and the service layer use.
 *
 * `/request-password-reset` (ENG-3639) for the same reason. It answered after the user lookup, token
 * write and SMTP send, so its response time told password accounts from everything else, and it
 * skipped the forgot-password flow's per-account mail limit (ENG-3640). Nothing calls it over HTTP:
 * forgotPasswordAction and the profile action both use `auth.api.requestPasswordReset` in-process.
 *
 * `/sign-up/email` (ENG-3988) too. Every check a credential sign-up has to pass lives in
 * `createUserAction`: Turnstile on Cloud, the invite and domain policy, `ZUserEmail`/`ZUserPassword`,
 * the app-level IP limit, org provisioning and the audit entry. A raw POST skipped all of them and
 * still created the account. The form, `/setup` included, calls `auth.api.signUpEmail` in-process, so
 * closing the route leaves the action as the only way in. `signupPolicyBeforeHandler` and the
 * `user.create.before` backstop stay as defence in depth for any other in-process caller.
 *
 * ASLA (Must 1): every HTTP route that creates or changes an OAuth client is closed, so the only ways to
 * get one are dynamic registration (held to the LibreChat callback by `mcp-dcr-redirect-policy.ts`) and
 * a server-side `auth.api.adminCreateOAuthClient`. Upstream 6.1 left these open to any signed-in user,
 * who could create a client with any callback, or move one to a loopback callback, and get an MCP token
 * for it (reproduced in ASL-1799). The admin routes are SERVER_ONLY in oauth-provider 1.7.0 and closed
 * here anyway, so a future release that exposes them stays closed. `mcp-oauth-dcr.test.ts` fails if a
 * new client-mutating route appears that is neither listed here nor SERVER_ONLY: recheck at every upgrade.
 */
export const OAUTH_CLIENT_MUTATION_PATHS = [
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/client/rotate-secret",
  "/oauth2/delete-client",
  "/admin/oauth2/create-client",
  "/admin/oauth2/update-client",
] as const;

export const AUTH_DISABLED_PATHS = [
  "/token",
  "/update-user",
  "/request-password-reset",
  "/sign-up/email",
  ...OAUTH_CLIENT_MUTATION_PATHS,
] as const;
