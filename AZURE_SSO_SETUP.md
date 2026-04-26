# Microsoft Azure Setup — Formbricks SSO

**Prepared for:** ASLA IT Admin
**Purpose:** Register Formbricks as a **single-tenant** Azure app so ASLA staff can sign in to `https://surveys.asla.org` with their Microsoft 365 account.

This is an internal deployment for ASLA only — not a multi-tenant SaaS. Locking the app to ASLA's Entra directory is what prevents anyone outside ASLA from signing in or taking over an account by email collision.

---

## How It Works

```
User clicks "Sign in with Microsoft"
  → Redirect to login.microsoftonline.com/{ASLA_TENANT_ID}
  → User authenticates against ASLA's Azure AD
  → Microsoft redirects back to /api/auth/callback/azure-ad with a code
  → NextAuth exchanges the code for an ID token (email, name, oid)
  → handleMicrosoftCallback matches the user by email:
      • New user (no email match)        → create + add to first organization
      • Existing email/password user      → migrate to Microsoft sign-in (one time)
      • Existing Microsoft user           → sign in
      • Existing user under another SSO   → refused (different sign-in method)
  → User lands at /environments/.../surveys
```

---

## Prerequisites

- Global Administrator or Application Administrator access to **ASLA's** Azure portal (https://portal.azure.com)
- Formbricks deployed and running at https://surveys.asla.org (see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md))
- Existing ASLA staff already have email/password accounts in Formbricks (they'll be auto-migrated to Microsoft sign-in on their first M365 login — their password keeps working as a fallback)

---

## 1. Register the App in Microsoft Entra ID

1. Sign in to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** → **App registrations** → **New registration**
3. Configure the registration:

   | Field | Value |
   |---|---|
   | **Name** | `Formbricks Surveys` |
   | **Supported account types** | **Accounts in this organizational directory only (ASLA only — Single tenant)** |
   | **Redirect URI** | Web — `https://surveys.asla.org/api/auth/callback/azure-ad` |

   > **Single-tenant is critical.** Picking "Multitenant" would let any Microsoft user from any organization sign in. Combined with the email-matching login flow, that would let anyone with a Microsoft account whose email matches an ASLA staff email take over their Formbricks account. Single-tenant means only users in ASLA's directory can complete OAuth.

4. After creation, note the identifiers on the **Overview** page — you'll hand these to the developer (see the handoff table at the bottom).

---

## 2. Upload App Branding (Optional)

This makes Formbricks appear with its own identity in the Microsoft consent prompt and login screens.

1. In the app registration, click **Branding & Properties**
2. Upload a Formbricks logo (215×215 PNG, <100 KB)
3. Set **Home page URL** to `https://surveys.asla.org`
4. Click **Save**

---

## 3. Create a Client Secret

1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
2. Description: `Formbricks Production`
3. Expiration: **24 months** (Azure's max)
4. **Copy the secret Value immediately** — it's only shown once. Don't copy the Secret ID by mistake.
5. Save it in 1Password
6. Set a calendar reminder 30 days before expiration

---

## 4. Grant API Permissions

Formbricks only needs the basic OIDC permissions for sign-in.

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**
2. Add:

   | Permission | Purpose |
   |---|---|
   | `openid` | Required for OIDC sign-in |
   | `email` | Returns the user's email address in the ID token |
   | `profile` | Returns the user's display name |

3. Click **Grant admin consent for ASLA**. You should see green checkmarks next to each.

---

## 5. Configure Environment Variables

On the production VM (`/opt/formbricks/.env`), add:

```bash
# Microsoft Entra SSO (single-tenant — ASLA only)
AZUREAD_CLIENT_ID=<application-client-id>
AZUREAD_CLIENT_SECRET=<client-secret-value-from-1password>
AZUREAD_TENANT_ID=<asla-directory-tenant-id>
```

> **`AZUREAD_TENANT_ID` is required, not optional.** Leaving it blank or setting it to `common` would let any Microsoft tenant authenticate, which defeats the single-tenant lock. Use ASLA's Directory (tenant) ID — a UUID like `93c82f7f-a521-4771-b392-dc2fd726d446`. You can copy it from the app registration's **Overview** page.

The web app reads these at startup:
- `AZURE_OAUTH_ENABLED` becomes `true` automatically when `AZUREAD_CLIENT_ID` and `AZUREAD_CLIENT_SECRET` are both set (see `apps/web/lib/constants.ts:34`).
- The "Sign in with Microsoft" button only appears when both are set and Enterprise SSO is **not** licensed (which it isn't in this deployment).

### 5b. Wire the vars into `docker-compose.yml`

> ⚠️ **Easy to miss.** `/opt/formbricks/.env` provides values for variable substitution in the compose YAML, but **only env vars explicitly listed in the `formbricks` service's `environment:` block are passed into the container.** The compose file does not use `env_file:`, so adding to `.env` alone is not enough.

Add these three entries to the `environment:` block of the `formbricks` service in `/opt/formbricks/docker-compose.yml`:

```yaml
  formbricks:
    environment:
      # ... existing entries ...
      # Microsoft Entra SSO (single-tenant)
      AZUREAD_CLIENT_ID: ${AZUREAD_CLIENT_ID}
      AZUREAD_CLIENT_SECRET: ${AZUREAD_CLIENT_SECRET}
      AZUREAD_TENANT_ID: ${AZUREAD_TENANT_ID}
```

Validate before restart:

```bash
docker compose config --quiet  # silent on success; prints YAML errors otherwise
```

Without this step the vars sit unused in `.env`, the container starts with no `AZUREAD_*` in its environment, and the Microsoft button silently never renders — see Troubleshooting.

---

## 6. Restart the App

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 azureuser@20.185.219.8
cd /opt/formbricks
docker compose restart formbricks
docker compose logs --tail=50 formbricks | grep -i azure
```

You should see no errors. Then go to https://surveys.asla.org and confirm the **Sign in with Microsoft** button is visible below the email/password form.

---

## 7. Verify Sign-In

1. Open `https://surveys.asla.org` in a private/incognito window
2. Click **Sign in with Microsoft**
3. Authenticate with your ASLA M365 account
4. Expected outcome on first sign-in:
   - You land on the Formbricks dashboard
   - In the database, your user row's `identityProvider` flips from `email` to `azuread`, and `identityProviderAccountId` is populated with your Microsoft `oid`
5. Subsequent sign-ins go through the providerAccountId fast-path — no email-match check, no migration

To watch the migration happen in the DB:

```bash
docker compose exec postgres psql -U formbricks -d formbricks -c \
  "SELECT email, \"identityProvider\", \"identityProviderAccountId\" FROM users WHERE email = 'you@asla.org';"
```

---

## 8. SSO User Matching Behavior

This is what the non-EE Microsoft handler does — see `apps/web/modules/auth/lib/microsoft-handler.ts`.

| Scenario | Result |
|---|---|
| Microsoft `oid` already linked (returning user) | Signs in via providerAccountId fast-path |
| Microsoft email matches existing user, `identityProvider = "email"` (password account) | **First-time migration** — flips to `azuread` and stores the `oid`. Password remains valid as a fallback |
| Microsoft email matches existing user, `identityProvider = "azuread"` but different `oid` | Allowed — handles tenant rotation / re-created Microsoft accounts |
| Microsoft email matches existing user, `identityProvider = "google"` / `"github"` / `"openid"` / `"saml"` | **Refused** — "different sign-in method" error. Auto-linking across SSO providers is too strong a takeover surface |
| No matching user in Formbricks | New user created with locale auto-detected, added as `member` of the first organization (oldest by `createdAt`) |

**What makes the `email` → `azuread` migration safe:**
- `AZUREAD_TENANT_ID` is restricted to ASLA's directory, so only ASLA-authenticated users can reach this code.
- Microsoft only releases a user's email/UPN after they authenticate, so reaching the callback proves they own the mailbox at sign-in time.
- The migration is a one-shot — subsequent logins use the `oid` lookup, not the email match.

---

## 9. Client Secret Rotation

Azure caps secret lifetime at 24 months. Rotate with overlap to avoid an outage:

1. In Azure → **Certificates & secrets**, create a new client secret (don't delete the old one yet)
2. Copy the new value
3. Update `AZUREAD_CLIENT_SECRET` in `/opt/formbricks/.env` on the VM
4. `docker compose restart formbricks` and verify sign-in works
5. Delete the old secret in Azure
6. Update 1Password and reset the calendar reminder

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Sign in with Microsoft" button not visible | (1) `AZUREAD_*` vars not in the container — most often because they're in `.env` but never wired into the `environment:` block of `docker-compose.yml` (see step 5b). Verify with `docker exec formbricks env \| grep AZUREAD` — if empty, the vars never made it through. (2) Container wasn't restarted after the edit. (3) `AZUREAD_CLIENT_ID` or `AZUREAD_CLIENT_SECRET` is empty/unset in `.env`. |
| Microsoft login redirects but Formbricks shows "Invalid credentials" | `AZUREAD_TENANT_ID` mismatch, or `handleMicrosoftCallback` rejected the user — check `docker compose logs formbricks` for the exact error |
| `AADSTS50011` (redirect URI mismatch) | The redirect URI in Azure must be **exactly** `https://surveys.asla.org/api/auth/callback/azure-ad` — check trailing slashes, http vs https |
| `AADSTS7000215` (invalid client secret) | Wrong secret value, or you copied the Secret ID instead of the Value. Create a new secret. |
| `AADSTS700016` (app not found) | Wrong `AZUREAD_CLIENT_ID`, or the app registration was deleted |
| `AADSTS50020` (user from identity provider not in tenant) | `AZUREAD_TENANT_ID` doesn't match the user's home tenant. Make sure it's ASLA's directory ID, not "common". |
| "An account with this email already exists under a different sign-in method" | The Formbricks user was created via Google/GitHub/OIDC SSO, not email/password. The handler refuses to auto-link. **Resolve case by case after verifying the user's identity out-of-band** — confirm with the user that their original SSO provider is no longer in use, then update the DB row's `identityProvider` to `email` and retry. Do not perform this step in response to a help-desk ticket alone — it bypasses the cross-SSO safety check. |
| Sign-in works but user lands in the wrong organization | `prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })` picks the oldest org. If ASLA has multiple orgs, double-check ordering or assign membership manually before the user signs in. |
| All Microsoft sign-ins broken after adding an Enterprise license key | An invalid or expired `ENTERPRISE_LICENSE_KEY` causes Formbricks to skip both the non-EE Microsoft path **and** reject sign-in via the EE path (because `getIsSsoEnabled()` returns false for a non-validating license). Remove the env var entirely if you don't have a working EE license — the non-EE flow will resume. |

---

## Security Notes

- **Single-tenant lock** is the single most important control here. If anyone ever changes the app to "multi-tenant" or removes `AZUREAD_TENANT_ID`, the email-based migration becomes an account-takeover door for any Microsoft user worldwide.
- **Email/password fallback persists.** The migration flips `identityProvider` but doesn't clear the password column. If you want to fully retire password sign-in, run a separate migration to null out passwords after everyone has migrated.
- **No invite-token flow.** Unlike the Enterprise SSO handler, this non-EE flow doesn't require an invite token. Anyone with an ASLA M365 account who reaches the login page can sign in. If a new Microsoft user signs in who *isn't* in Formbricks yet, they'll be auto-created and added to the first organization — fine for a single-org ASLA deployment, would be a problem in multi-org.

---

## Handoff Table

Fill these in after creating the app, then paste into 1Password / share with the developer.

### Public identifiers (safe to commit)

| Item | Value |
|---|---|
| Display name | `Formbricks Surveys` |
| Application (client) ID | `11b61ed3-c1fd-4a34-b634-1d17f9189c64` |
| Object ID | `266996a9-72ba-4a05-9127-667d3e969338` |
| Directory (tenant) ID | `93c82f7f-a521-4771-b392-dc2fd726d446` |
| Supported account types | Single tenant (ASLA only) |
| Redirect URI | `https://surveys.asla.org/api/auth/callback/azure-ad` |

### Secrets (1Password only — never commit)

| Item | Value |
|---|---|
| Client secret value | *(stored in 1Password)* |
| Client secret expiry | *(set 30-day calendar reminder)* |

### `.env` block to add on the VM

```bash
AZUREAD_CLIENT_ID=11b61ed3-c1fd-4a34-b634-1d17f9189c64
AZUREAD_CLIENT_SECRET=<client-secret-value-from-1password>
AZUREAD_TENANT_ID=93c82f7f-a521-4771-b392-dc2fd726d446
```

---

## Important Notes

- **Single-tenant. Period.** This deployment is internal to ASLA. There is no scenario where Formbricks should be multi-tenant. If a future requirement comes up to let external survey respondents log in via Microsoft, that's a different problem with a different design.
- **Redirect URI is fixed by NextAuth.** It's always `/api/auth/callback/{provider-id}`, where the provider id is `azure-ad`. Don't try to override it.
- **The "Microsoft" button is non-EE.** It's gated by `AZURE_OAUTH_ENABLED && !ENTERPRISE_LICENSE_KEY` (`apps/web/modules/auth/login/components/login-form.tsx`). If an EE license key ever gets installed, the EE SSO flow takes over and the existing handler becomes inactive — the button disappears in favor of the EE SSO panel.
- **Existing users don't need to re-register.** First Microsoft sign-in for any existing email/password user auto-migrates them. They keep their organization memberships, surveys, and roles.
