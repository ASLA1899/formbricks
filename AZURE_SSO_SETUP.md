# Microsoft (Entra) sign-in on the ASLA fork (6.1.x, Better Auth)

Microsoft sign-in works **without** an enterprise license. The license check is bypassed for the
`azuread` provider only; Google, GitHub, OIDC, and SAML still need the license.

## Environment

| Variable | Purpose |
| --- | --- |
| `AZUREAD_CLIENT_ID`, `AZUREAD_CLIENT_SECRET` | Entra app registration. Both are required to enable the button. |
| `AZUREAD_TENANT_ID` | Directory (tenant) ID. Set it to your tenant GUID for full id_token verification. |
| `AUTH_SSO_ALLOWED_EMAIL_DOMAINS` | Comma-separated domains allowed to sign in or be provisioned (exact match, case-insensitive). Empty = no restriction. Set it: the ASLA tenant has external B2B guests. |
| `EMAIL_AUTH_DISABLED=1` | SSO-only. Switches off the email/password endpoints and hides the form. |
| `AUTH_SSO_DEFAULT_ORGANIZATION_ID` | Organization every new SSO user joins without an invite. |
| `AUTH_SSO_DEFAULT_ORGANIZATION_ROLE=member` | Role for new users after the first. Most users are `member`; keep `owner` only for people who must see every survey. |

Docker Compose only passes variables that the compose file lists, so uncomment each one there.

## Entra redirect URI

Register this redirect URI on the app registration (Web platform):

```
<AUTH_URL or WEBAPP_URL>/api/auth/oauth2/callback/azuread
```

This is the pinned v5.2+ path. The 4.9 fork used `/api/auth/callback/azure-ad`; that URI is not used
any more and the old one can be removed after cutover.

## What the fork adds on top of 6.1.x

- License bypass for `azuread` (provider registration, the per-callback license hook, and the login
  and signup SSO block).
- Entra display names in "Last, First" form are stored as "First Last" with no comma.
- `AUTH_SSO_ALLOWED_EMAIL_DOMAINS` is enforced three times: when provisioning a new user
  (`gateSsoProvisioning`), when an existing user signs in (session-create hook), and before the
  verify-before-link recovery flow starts. A refused domain never gets a session.
- The proxy session gate is Better Auth's own (`modules/auth/lib/proxy-session.ts`: signed cookie,
  `Session` row lookup, `isActive`). The 4.9 JWT gate and its redirect-loop fix are not needed.

## Existing 4.9 users

Migration `20260416110000_backfill_legacy_sso_accounts` renames `Account.provider = 'azure-ad'` rows
to `azuread` and creates a missing `Account` row from `User.identityProviderAccountId`. It is covered
by `packages/database/migration/20260416110000_backfill_legacy_sso_accounts/migration.test.ts`.
