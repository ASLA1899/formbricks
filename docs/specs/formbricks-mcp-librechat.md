# PRD: Formbricks survey building and response analysis from ASLA Chat

Status: draft v10, 10/28/2026. gcohen answered rounds 1, 2 and 3. Path decided: upgrade, then port our features, all in a sandbox first because live surveys are in the field. v5 through v7 applied three rounds of Copy Editor and feasibility review. v8 applies gcohen's round-3 answers. Chat can now change settings that send no email, and can pause, resume and close a live survey after a yes in chat. It can also build four more question types. Ported question fields join the API, and invitations and reminders stay in Formbricks. v8 also documents skip logic in the tool text and adds a branched-survey gate test. v9 applies the fifth review round: one private writer for status and schedule dates, a scheduled publish that opens the survey, and a reminder check that runs again when the change is applied. v10 applies the sixth: schedule dates are dates, not times, because upstream opens and closes surveys at one deployment-wide time. Owner: Product Strategist. Source: ASL-1794 (Paperclip), ASL-1795 (Paperclip).

## Recommendation

In this PRD, "v1" means the first release (as in "Tools (v1)"). The fork's REST API versions are written "API v1" and "API v1/v2".

**Upgrade our Formbricks fork to upstream 6.1.2 in a sandbox, port our features there, build and test the ASLA MCP guards there, and cut production over only after gcohen signs off. Then connect the MCP server that ships with Formbricks to ASLA Chat (LibreChat) as an opt-in OAuth connector, the same way Microsoft 365 is connected today.** The ASLA patches are:

- a tool allowlist
- a draft-only guard, with a single-use token for every status change
- a settings tool limited to settings that send no email
- one PII projection for every response tool
- a server-side `summarize_responses` tool
- question-type and image-host allowlists
- skip-logic documentation in the tool text
- the ported question fields added to the API
- MCP sign-in restricted to ASLA Chat

gcohen chose this path on 10/28/2026.

Production (`surveys.asla.org`) stays on 4.9 and keeps serving the surveys in the field until cutover. All upgrade, porting and MCP work happens on a separate sandbox copy (see "Sandbox and cutover"). Production's MCP endpoints stay blocked at the proxy until the guarded build passes in the sandbox.

Why: upstream Formbricks already has what we were going to build. Since 5.2.0 it serves `/api/mcp` over streamable HTTP. Each person signs in with their own Formbricks login (OAuth 2.1), and every call is checked against that person's workspace role. Survey and response tools are maintained upstream and aren't license-gated. (Upstream calls the unit a *workspace*; the fork calls the same thing an *environment*. This PRD says workspace except where it means the fork's API keys.) A wrapper on 4.9 gets us there sooner, but it uses org-wide API keys with no per-user identity inside Formbricks, and we would throw it away at the next upgrade.

**The upgrade keeps our fork's features, but it costs real work.** Git carries every fork commit forward; nothing is dropped automatically. Each feature has to be carried across and retested, and the sign-in code has to be rewritten. A trial merge of our `main` into 6.1.2 on 10/28/2026 conflicted in 220 files. That makes the upgrade a fork-migration project in its own right. It's worth doing anyway: every upstream security fix currently has to be backported by hand (about 45 of our 190 commits are backports), and the MCP server comes with it. Phase 0 is a time-boxed assessment that ends in an effort estimate and a go/no-go.

| Option | What it is | Pick it when |
| --- | --- | --- |
| **Best long-term (chosen 10/28/2026)** | Upgrade fork to 6.1.2 in a sandbox, port ASLA features, add ASLA guards, cut over, use built-in `/api/mcp` with per-user OAuth | Phase 0 says the effort is bounded |
| **Fastest (fallback)** | ASLA-built MCP container on nan01 over the fork's existing API v1/v2. Entra sign-in, API keys held server-side, 15 tools (see "Tools (v1)"). The fork stays on 4.9 untouched | Phase 0 is no-go. Security backports continue one at a time |
| Other: wrapper now, upgrade later | Build Fastest now; retire it when the upgrade lands | We want the chat feature soon and still plan to upgrade. Costs the wrapper twice over (build, then retire) |
| Other: LibreChat Agent with OpenAPI actions | Point an Agent at the API v1/v2 OpenAPI specs | Not recommended. Actions aren't configured in our LibreChat. They would need one shared key in the chat client, and they can't aggregate responses server-side |
| Other: third-party hosted MCP (Vinkius) | Hosted server; each user pastes a personal Formbricks API key | Not recommended. Survey data would pass through a vendor we haven't vetted, and our fork has no personal API keys |

## Problem and who it's for

ASLA staff build surveys in Formbricks (`surveys.asla.org`) by hand and read results in the Formbricks UI or exports. Turning a goal ("find out why chapter leaders skip the leadership summit") into good questions takes time, and so does analyzing open-text answers. Staff already work in ASLA Chat (`chat.aslalabs.org`, LibreChat v0.8.8), which has connectors for Metrics, Member Voices, Member Survey, DAM and Microsoft 365.

Users (decided 10/28/2026): ASLA staff who already have a Formbricks account. Their Formbricks role sets what they can see and change. ASLA Chat accepts only `@asla.org` Entra accounts, and members have no access (`~/dev/librechat/librechat.yaml:11-15`, `README.md:3`). No one is auto-provisioned.

## Evidence

Checked 10/28/2026. Research notes are attached to ASL-1795 (Paperclip) as `research-notes.md` and `research-addendum-fork-inventory.md`. Upstream facts below are pinned to the 6.1.2 tag (`edb0b66d4`); upstream `main` already has tools 6.1.2 lacks.

- **Upstream ships an MCP server.** Per-user OAuth needs 5.2.0 or later; 6.1.0 adds the redirect allowlist we would use for LibreChat. Code: `apps/web/modules/mcp` and `apps/web/app/api/mcp/route.ts` in `formbricks/formbricks`. Docs: `docs/platform/mcp/overview.mdx` and `docs/development/technical-handbook/mcp-server.mdx`.
  - API-key MCP arrived in 5.1.0 (#8144, 06/02/2026).
  - OAuth arrived in 5.2.0 (#8406, 07/02/2026), along with the NextAuth to Better Auth migration (#8384).
  - The redirect allowlist for dynamic client registration (DCR) and the `MCP_DCR_ALLOWED_REDIRECT_URIS` env var arrived in 6.1.0 (#9494, 10/06/2026). DCR is open to anonymous clients, and loopback and built-in hosted-client callbacks are accepted whatever the allowlist says (`modules/auth/lib/mcp-oauth-provider-options.ts:70-77`, `mcp-dcr-redirect-policy.ts:55-76,101-103`).
  - DCR is not the only way to create an OAuth client. Better Auth's oauth-provider 1.7.0 also mounts signed-in client-management routes: `/oauth2/create-client`, `/oauth2/update-client`, `/oauth2/client/rotate-secret` and `/oauth2/delete-client`. Formbricks' DCR check covers only `/oauth2/register` (`mcp-dcr-application-type.ts:45-51,87-91`), sets no `clientPrivileges` hook and disables none of those routes (`modules/auth/lib/auth.ts:128,456`). The MCP bearer check verifies issuer, audience, user and scopes but not which OAuth client the token was issued to (`modules/mcp/auth.ts:472-610`), and `/api/mcp` also accepts API keys through `x-api-key` or `Authorization: Bearer` (`modules/mcp/auth.ts:675-693`). The Reviewer confirmed this in an isolated harness (ASL-1799): with both DCR flags off, register returned 403, but a signed-in user created a client with an unrelated callback (201), moved it to a loopback callback (200) and got an MCP token for it (200). Adding the managed routes to `disabledPaths` returned 404 for both, while server-side `adminCreateOAuthClient` still worked (201).
  - Latest release is 6.1.2 (10/27/2026). Survey and response tools have no license check; some other tools do.
  - The handler registers every tool group automatically: surveys, workflows, workspaces, feedback records and responses (`modules/mcp/server.ts:115-122`). Turning on `/api/mcp` exposes all of them to any client that can sign in.
  - 6.1.2 tools: `list_surveys`, `get_survey`, `create_survey`, `validate_survey`, `patch_survey`, `edit_survey_blocks`, `set_survey_block_order`, `delete_survey`; `list_responses`, `count_responses`, `get_response`, `validate_response`, `create_response`, `update_response`, `delete_response`, `batch_delete_responses`; `list_workspaces`, `get_workspace_custom_css`, `patch_workspace_custom_css`; 13 workflow tools; 10 feedback-record tools. Creative (website banner) and dashboard tools exist only on upstream `main`, after 6.1.2.
  - **Survey writes cover content, not settings.** The v3 patch writes name, status, metadata, the language-switch settings, welcome card, blocks, endings, languages and custom CSS. It carries `publishOn` and `closeOn` forward from the stored survey rather than from the request (`apps/web/app/api/v3/surveys/patch.ts:333-353`). `styling`, `surveyClosedMessage`, `isBackButtonHidden`, `isAutoProgressingEnabled`, `singleUse`, `pin`, `isVerifyEmailEnabled`, `recaptcha`, follow-ups and quotas have no MCP or v3 write path.
  - **Status changes reset schedule dates.** Statuses are `draft`, `inProgress`, `paused` and `completed` (`packages/types/surveys/types.ts:901`). `normalizeSurveyScheduling` clears `publishOn` on a manual change to `inProgress`, clears `closeOn` on a manual pause when no publish date is set, and clears both on `completed` (`modules/survey/scheduling/lib/survey-scheduling.ts:272-299`).
  - **A scheduled publish starts from `paused`, not `draft`.** The scheduler publishes only `paused` surveys whose `publishOn` has passed (`getTransitionConfig`, `survey-scheduling.ts:57-63,173-179`), and the editor schedules a survey by saving `status: "paused"` together with the dates (`apps/web/modules/survey/editor/components/survey-menu-bar.tsx:819-850`). A draft with a `publishOn` is never published. The Reviewer confirmed this with the selector on mocked rows (ASL-1805).
  - **Schedule dates are dates, not times.** `normalizeSurveyScheduling` passes both dates through a date-only helper (`survey-scheduling.ts:283-284`, `modules/survey/scheduling/lib/date-utils.ts:153-160`). It keeps the calendar date and replaces the clock time with one deployment-wide setting: `SURVEY_SCHEDULING_TIME_ZONE`, `SURVEY_SCHEDULING_LOCAL_HOUR` and `SURVEY_SCHEDULING_LOCAL_MINUTE`, default Europe/Berlin at 00:00 (`apps/web/lib/env.ts:790-792`). The Reviewer ran the pinned functions (ASL-1807): at 07:00 UTC on 11/02/2026, a publish requested for 08:00 UTC that day was stored as 23:00 UTC on 11/01, already due. A 9 a.m. publish and a 6 p.m. close on the same day became equal and were rejected.
  - **Skip logic is in the write API but not in the tool text.** A block accepts `id`, `name`, `elements`, `logic`, `logicFallback`, `buttonLabel` and `backButtonLabel` (`apps/web/app/api/v3/surveys/schemas.ts:452-460`), and the server rejects a logic target that doesn't exist. The tool description shows a block only as `{ name, elements[], id? }` (`modules/mcp/tools/schemas.ts:197-207`), so a model reading it wouldn't know it can send logic.
  - **Unknown fields are refused.** Each element key is checked against a per-type list and refused as `unsupported_field` (`apps/web/app/api/v3/surveys/schemas.ts:530-650`). A block edit replaces the whole block. Upstream already accepts block `name`, date `format` and `displayType`. Fork-only fields such as `dateKind` (month/year date) and `prefillFrom` (answer piping and prefill) aren't on the list, so a chat edit to a survey that uses them would be refused.
  - **Image URLs can be any web address.** `ZStorageUrl` accepts a Formbricks `/storage/` path or any http(s) URL (`packages/types/common.ts:14-30`). Image fields: element `imageUrl`, picture-choice images, welcome-card `fileUrl`, ending `imageUrl`, `styling.logo.url` and an image or upload `styling.background.bg`. Rich-text (HTML) fields can also carry images. All of them load in the respondent's browser from their host.
  - 6.1.2 adds the `csat` and `ces` element types; the fork on 4.9 has neither. `cta` takes `buttonExternal`, `buttonUrl` and `ctaButtonLabel` (`apps/web/app/api/v3/surveys/schemas.ts:542-554`).
  - `list_surveys` allows up to 100 per page (`tools/schemas.ts:81-91`). `count_responses` defaults to `precision: "capped"`, a lower bound on large surveys; `"exact"` counts every row (`tools/response-schemas.ts:74-84`).
  - Deletes use a two-round confirmation (MCP elicitation, where the server asks the client to prompt the person; `request-state.ts`), with a `confirm` argument the model can set itself when the client can't show prompts (`tools/response-schemas.ts:91-102`). The signed request state lasts 5 minutes and isn't stored, so it can't serve as a single-use status-change token.
  - Response tools return the v3 shape. List and detail both carry `answers`, `embeddedData` (named hidden fields plus reserved URL and device fields) and `unresolved[].rawValue` (answers to deleted elements). Detail adds raw `data` and `contact` (`apps/web/app/api/v3/responses/lib/serializers.ts:138-159,176-196`; `embedded-data.ts:123-182`; `answers.ts:569-617`).
  - Audit call sites exist, but nothing is recorded unless `AUDIT_LOG_ENABLED=1` (`modules/ee/audit-logs/lib/handler.ts:54-55`, `lib/constants.ts:336`). The sink is `logger.audit`, a log line, not a database record (`modules/ee/audit-logs/lib/service.ts:11-18`).
  - Migrations: 6.1.2 interleaves TypeScript data migrations with SQL ones. The supported runner is `node ./dist/scripts/apply-migrations.js` (`packages/database/package.json:54`, `src/scripts/migration-runner.ts:246-272`). Plain `prisma migrate deploy` skips the TypeScript backfills; for example, the embedded-data backfill must read `Survey.variables` and `hiddenFields` before they are dropped (`migration/20260928120000_eng_2404_backfill_remaining_embedded_data/migration.ts:21-36`).
  - Deleting a response derives a file key from its stored upload URL and deletes it from whatever bucket is configured (fork: `apps/web/lib/response/service.ts:561-581,638-641`, `packages/storage/src/service.ts:227-232`). `PUBLIC_URL` overrides `WEBAPP_URL` for generated links (`apps/web/lib/getPublicUrl.ts:21-22`).
- **Our fork is on 4.9.7.** The merge base with upstream is `322f0be19` (04/12/2026). Upstream `main` is 1,190 commits ahead. The fork has 190 commits of its own, not counting merges.
- **Fork inventory against 6.1.2 (first pass, by keyword search; a zero-hit search doesn't prove upstream lacks a feature):**
  - *Already upstream; take upstream's version:* about 45 security fixes, dependency bumps and backports. The dropdown display option for multiple choice (upstream has `displayType: list | dropdown`).
  - *Port (no upstream equivalent found):* per-survey access control (`surveyAdmin`; 6.1.2 has a per-survey `visibility` setting, which may overlap), survey invitations and reminders, survey schedule window (`runOnDate`, `closeOnDate`, `scheduleTimezone`; 6.1.2 has its own `publishOn` and `closeOn`, which may overlap), contact-info custom fields and address Name/Organization lines, saved option lists, answer piping and prefill, month/year date, tall card, auto-advance (fork `autoAdvance`; 6.1.2 has `isAutoProgressingEnabled`, which may overlap), two-column choices, matrix "Other", markdown links in choice labels, custom block names, PDF/DOCX/HTML export, Started/Completed/Duration columns, Snowflake response sync, bulk personal links, follow-up file links, link-survey resume, ASLA-branded emails.
  - *Correction (round 3):* v7 listed the schedule window, per-survey access control and auto-advance as having no upstream equivalent. 6.1.2 has at least partial equivalents (above). Phase 0.1 compares each one before anything is estimated.
  - *Unresolved:* external API lookup. The fork has an editor test path and a survey-renderer HTTP client (`packages/surveys/src/lib/external-api-client.ts:140-163`, `docs/xm-and-surveys/surveys/advanced/external-api-lookup.mdx`), but no `externalDataSources` column in Prisma. Phase 0.1 finds where its configuration lives and whether it's in use.
  - *Rewrite:* Microsoft 365 sign-in without an Enterprise Edition (EE) license, SSO-only hardening, and the proxy JWT gate. These sit on NextAuth; upstream now uses Better Auth, and its own Entra sign-in lives under `ee/` (license-gated).
  - *Database:* 5 fork migrations (invitations, invitation names, survey ACL, schedule window, follow-up file link) plus a `schema.prisma` conflict. Production has been deployed with `prisma db push --accept-data-loss` (`~/dev/azure_vm/docs/apps/formbricks.md`), so its migration history table may not match the files.
- **Trial merge (10/28/2026):** merging fork `main` into the 6.1.2 tag conflicts in 220 files: 64 in `apps/web/modules`, 46 in `apps/web/app`, 34 in `packages/surveys`, 19 in `apps/web/lib`, 11 in `packages/survey-ui`, the rest spread out. About 32 are translation files and about 27 are tests. The Reviewer reproduced the count with `git merge-tree`.
- **The fork has no MCP code.** Its v3 API has only `GET /api/v3/surveys`, and v2 has no survey create. Creating a survey goes through API v1 `POST /api/v1/management/surveys`, which accepts `blocks` and defaults status to `draft`. A caller can pass `status: "inProgress"` and publish (`packages/types/surveys/types.ts:4025-4033`, `apps/web/lib/survey/service.ts:634-638`).
- **API keys in the fork belong to the organization, not a person.** Only owners and managers can create them. They never expire. Each key is scoped per environment with read, write or manage permission (`packages/database/schema.prisma:842-886`, `apps/web/modules/organization/settings/api-keys/actions.ts:48-60`). Audit logs record the key, not a user.
- **The fork's reminder cron sends whatever has come due.** It picks every `inProgress` survey with reminders turned on, then sends each reminder offset that has passed and hasn't gone out yet (`apps/web/modules/survey/invitations/lib/scheduled-reminders.ts:28-58`). A paused survey gets none, so resuming one sends every reminder that came due during the pause at the next cron run. Eligibility per invitation: sent, not responded, under the survey's `maxReminders`, and the offset not yet sent (lines 49-58). The send path claims each offset and emails in the same loop (lines 79-125), and the cron uses its own run time (line 21) on an external schedule described only as roughly daily (line 15). Eligibility changes with time and with invitation rows, not with the survey's `updatedAt`.
- **Invitations can be sent from a survey in any status.** `sendInvitationsAction` and `sendRemindersAction` check that the survey exists, not its status (`apps/web/modules/survey/invitations/actions.ts:67-85,126-144`). A draft or paused survey can already have sent invitations, so publishing it can trigger reminders too.
- **Rate limit:** 100 requests per minute per key on each API version. Limiting is turned off when Redis is down (`apps/web/modules/core/rate-limit/rate-limit-configs.ts:11-15`).
- **The live chat stack is `~/dev/librechat`, deployed at `/opt/librechat` on nan01** (image `librechat:v0.8.8`, released 10/01/2026). `~/dev/asla_ai` is a January prototype that was never deployed; the issue named it by mistake.
  - LibreChat already runs six MCP servers over streamable HTTP with per-user OAuth (`librechat.yaml:172-266`).
  - Every host must be listed in `mcpSettings.allowedDomains`.
  - The config comment says MCP data may go only to Anthropic and OpenAI models. Models are reached through Ramp Router via the shared LiteLLM gateway, and prompts are redacted from LiteLLM spend logs (`librechat.yaml:105,116-118,144-153`).
- **LibreChat can't show an MCP server's confirmation prompt yet.** MCP elicitation support is an open request (LibreChat-AI/LibreChat#11526), and optional MCP tool-call confirmation is an open PR (#13304), both checked 10/28/2026. On v0.8.8, a server can't prove that a person, rather than the model, said yes.
- **ASLA precedent: the Member Survey MCP** (`membersurvey.aslalabs.org/mcp`) already sends 2026 member survey results to those same models.
- **Data catalog:** `~/dev/asla-metrics/DATA_SOURCES.md:321` lists `formbricks` as medium PII, not integrated, disposition TBD.
- **Member voice:** none gathered yet. This is a staff tool. A pilot with survey owners is in Phase 4 (4.3).

## Goals and success metrics

- Staff can go from "I need a survey about X" to a reviewable Formbricks draft in one chat, and publish, pause, resume or close it from chat after they say yes.
- Staff can ask questions of a survey's responses in chat and get counts, cross-tabs and open-text themes that match the Formbricks summary page.
- Success metric (decided 10/28/2026): no target for now. Report the number of surveys first drafted through the connector that are later published. gcohen sets a target, and the period it covers, after the pilot.

## Non-goals (first release)

- Members using it. LibreChat is staff-only.
- Editing the questions of a published or scheduled survey, or deleting it, from chat. Changing questions mid-field splits the results. Those stay in the Formbricks UI.
- Sending invitations or reminders from chat (decided 10/28/2026, round 3; revisit after the pilot). No chat action sends email: status changes never trigger a send, and chat refuses a publish, resume or scheduled publish that would trigger reminders (Must 3).
- Settings that send email, control who can respond, or collect respondent data: follow-up emails, PIN, email verification, single-use links, reCAPTCHA, quotas, IP capture, survey visibility and a custom link slug.
- App or website-intercept surveys, targeting, segments, actions, website banners (creatives), custom CSS. The first release covers link surveys only.
- Writing or deleting responses, contacts, webhooks, workflows, dashboards, or feedback records.
- Any MCP client other than ASLA Chat.
- Joining responses to member data (member type, chapter) inside the MCP server. That belongs in the existing Snowflake sync and `asla-metrics` (later phase, not the first release).
- Any change to the LLM routing or provider list.

## Requirements

### Must

1. **Per-user identity, ASLA Chat only.** Every call runs as the signed-in ASLA staff member and is limited by their Formbricks role. No shared admin key is ever sent to or stored in LibreChat.
   - Best long-term: upstream OAuth 2.1, with one exact LibreChat callback per deployment as the only accepted redirect, so no other MCP client (a desktop app, a script) can reach survey data. "The LibreChat callback" below means that deployment's callback:
     - **One callback per deployment, set by `MCP_LIBRECHAT_CALLBACK_URI`** and used everywhere this Must checks a callback: DCR, the admin client and the per-request check. If DCR stays, upstream's `MCP_DCR_ALLOWED_REDIRECT_URIS` is set to the same value. LibreChat v0.8.8 builds the callback from the connector name and has no override, so each Formbricks deployment pairs with one connector name. Production: `https://chat.aslalabs.org/api/mcp/formbricks/oauth/callback`. Sandbox: `https://chat.aslalabs.org/api/mcp/formbricks-sandbox/oauth/callback`. Neither deployment accepts the other's callback.
   - The ASLA patch closes every path to another client:
     - **Every HTTP route that creates or changes an OAuth client** either is disabled or accepts only the exact LibreChat callback. In 6.1.2 with Better Auth's oauth-provider 1.7.0 that is `/oauth2/register` (DCR), `/oauth2/create-client`, `/oauth2/update-client`, `/oauth2/client/rotate-secret`, `/oauth2/delete-client`, and `/admin/oauth2/create-client` and `/admin/oauth2/update-client` if they are reachable over HTTP. Default: add the client-management routes to Better Auth's `disabledPaths`. The route list is rechecked at every upgrade.
     - **DCR**, if spike 2.1 keeps it, accepts only the LibreChat callback. The loopback and built-in hosted-client callbacks are removed. If DCR can't be limited that way, it is turned off and LibreChat uses one client created server-side (`adminCreateOAuthClient`).
     - **`/api/mcp` checks the client on every request.** It accepts a token only if the token's OAuth client currently has exactly the LibreChat callback registered (read at request time, so a client changed after the token was issued is refused). After bearer verification in `modules/mcp/auth.ts`, take the client id from the token (`azp`, falling back to `client_id`), read that client's `redirectUris` with no cross-request cache, and refuse a missing client id, a missing client, or a client whose `redirectUris` are anything other than exactly the configured callback. Don't require the client's creator to be the token's user: one server-created client serves every staff member.
     - **No API keys on `/api/mcp`**, through either `x-api-key` or `Authorization: Bearer`.
   - Fastest: Entra sign-in to the wrapper, using the same pattern as the ms365 connector.
2. **Tool allowlist.** `/api/mcp` exposes only the tools in the "Tools (v1)" table (the first-release tool set). Every other registered tool (workflow, feedback-record, custom-CSS, response-write tools, and any tool a later upgrade adds, such as creatives) is hidden from `tools/list` and refused if called. The allowlist applies on the server for every client, not only in the LibreChat config.
3. **Drafts by default; every status change only after a yes in chat** (decided 10/28/2026, rounds 1 and 3).
   - Create a survey only with `status: "draft"`; reject any other status on create.
   - Edit questions, reorder blocks and delete only surveys still in `draft`. Reject any status change through `patch_survey`. `delete_survey` keeps upstream's two-round confirmation; on LibreChat the model can set `confirm` itself, which is acceptable because only drafts can be deleted.
   - Every status change goes through one path: `prepare_status_change`, then `apply_status_change`. The actions:
     - `publish`: `draft` to `inProgress`. It also publishes a scheduled survey now (`paused` with a publish date) and clears the publish date.
     - `schedule_publish`: give a `draft` a future publish date. It opens at the deployment's scheduling time on that date (see `at` below). The survey moves to `paused` with `publishOn` set, the state upstream's scheduler picks up. When the date passes, the scheduler moves it to `inProgress` with no sends. Any close date is kept and must be after the publish date. Once scheduled, the survey's questions can't be edited from chat. Cancelling a scheduled publish stays in Formbricks.
     - `pause`: `inProgress` to `paused`.
     - `resume`: `paused` to `inProgress`, for a survey with no publish date. A scheduled survey that was never published is refused with a pointer to `publish`.
     - `close`: `inProgress` or `paused` to `completed`.
     - `set_close_date`: set, move or clear the close date of an `inProgress` or `paused` survey. A draft's close date is set with `update_survey_settings` (Must 11).
   - `at` is a calendar date, `YYYY-MM-DD`, not a time. 6.1.2 stores only the date and opens or closes every survey at one deployment-wide time and zone (see Evidence; open question 12).
     - An `at` with a time or offset is refused, with a message that only the date can be set. The model can't promise a time the server won't keep.
     - The server turns `at` into a `Date` at 12:00 UTC on that date, as upstream's editor does (`toDateOnlySelection`, `modules/survey/scheduling/lib/date-utils.ts:23-25`). It then resolves it with the same helper the writer uses, which reads the calendar date in the scheduling zone (lines 153-160). Midnight UTC would read as the day before in America/New_York and open the survey a day early. The summary and the stored value come from the same resolution, so they always match.
     - The resolved instant must be in the future, using upstream's earliest-date rule (`getMinimumSurveySchedulingCalendarDate`, lines 135-150). With a 00:00 scheduling time, today's date has already passed and is refused.
     - A close date must resolve to a later instant than the publish date, so the same date for both is refused.
     - `schedule_publish` requires `at`. `set_close_date` takes a date, or `null` to clear the close date. Other actions refuse `at`.
   - `prepare_status_change` checks the survey: the current status allows the action, the survey is valid and a link survey, and the caller has write access. It returns a plain summary and a token. The summary gives the name, current and new status, response count, and editor and public links. It also says what the change does:
     - publish: question count and estimated minutes; a publish date, if set, is cleared.
     - schedule_publish: the survey publishes on `<date>` at `<time and zone>` and shows as paused until then; no email is sent; its questions can't be edited from chat after this.
     - pause: the link stops taking responses, and the close date is cleared if no publish date is set.
     - resume: the link takes responses again; a close date cleared by the pause isn't restored.
     - close: the survey stops taking responses, and both dates are cleared.
     - set_close_date: the survey closes on `<date>` at `<time and zone>`, or the close date is cleared.
   - **No reminder sends from a status change.** Invitations can be sent from a survey in any status (see Evidence), so any survey that becomes `inProgress` can trigger the reminder cron.
     - For `publish` and `resume`, the server runs a reminder check. It is a new function with no side effects, built from the cron's eligibility rules (sent, not responded, under `maxReminders`, offset not yet sent). It is not the cron function with a flag, because that function claims offsets and sends in one loop. It claims nothing and never calls the email sender. It counts invitations with a reminder already due or due within the next 25 hours, a lookahead longer than the roughly daily cron interval (proposed default; open question 9). An invitation counts once, however many offsets are due, and not at all once it has reached `maxReminders`. Above zero, the action is refused and the person is told to make the change in Formbricks, where the reminder schedule is visible (open question 10).
     - For `schedule_publish`, nobody is in chat when the survey goes live, so the check can't run at the right moment. The action is refused if reminders are turned on and any sent invitation still has a reminder left to send.
     - `apply_status_change` runs the same check again, at its own current time, before it consumes the token or changes anything. A survey that passed at prepare and fails at apply is refused. Eligibility changes with time and with invitation rows, which the token's `updatedAt` binding doesn't cover.
     - Invitations someone sends in Formbricks after a survey is scheduled are their action, not chat's.
   - The token is stored in the database, single-use, and expires in 10 minutes (proposed default; open question 9). It is bound to the user, the OAuth client, the survey, the action, the resolved instant of `at` (for `schedule_publish` and `set_close_date`) and the survey's `updatedAt`. An edit after `prepare_status_change` invalidates it, and a token can't be used for a different action.
   - **One private writer for status and schedule dates.** `apply_status_change` takes the token, reruns the reminder check, consumes the token atomically, and rechecks the caller's permission and the survey's current status. It then writes through a private status-and-schedule writer that no public tool exposes. The writer:
     - has its own table of allowed actions, from-statuses and fields, separate from the `update_survey_settings` field allowlist;
     - writes status and dates together in one compare-and-set on `updatedAt`, like the v3 patch's `expectedUpdatedAt` (`apps/web/app/api/v3/surveys/patch.ts:362-375`);
     - applies upstream's date rules (`normalizeSurveyScheduling`) to the result;
     - rechecks, at its own current time, that the resolved instant is still in the future and that a close date is still after the publish date. A date that passed while the person was deciding is refused;
     - targets whichever schedule model Phase 0.1 keeps. If the fork's window wins, the same behavior holds: a scheduled survey opens on its date with no sends, and each summary names the dates its action clears. `at` stays date-only either way; the resolved time follows the kept model's rules, and the summary states it.

     `apply_status_change` returns the new status, any scheduled dates and the public link. A missing, expired, reused or stale token is rejected. The model can't set a `confirm` flag to skip the step.
   - The tool description and server instructions require the model to show the summary and get an explicit yes before calling `apply_status_change`.
   - No status change sends invitations, and the reminder check above keeps one from triggering reminders.
   - On LibreChat v0.8.8 the yes is enforced by the model, not proven by the server (see Evidence and Risks). When LibreChat ships MCP elicitation or tool-call confirmation, switch `apply_status_change` to it.
   - Enforce all of this on the server, not in the prompt.
4. **Interview first.** The connector's server instructions tell the model to interview the person before drafting:
   - goal and decision the survey informs
   - audience and how they'll get the link
   - length budget (target minutes)
   - must-ask topics
   - anything off-limits
   - language
   - deadline

   After the interview, the model shows the draft questions in chat. It calls `create_survey_draft` only after the person says yes.
5. **First-release question types** (decided 10/28/2026, round 3): `openText`, `multipleChoiceSingle`, `multipleChoiceMulti`, `rating`, `nps`, `matrix`, `ranking`, `consent`, `date`, `cta`, `csat`, `ces` and `pictureSelection` (the Fastest option can't offer `csat` or `ces`, which the fork on 4.9 lacks). Other types are rejected with a message to add them in the editor. `address` and `contactInfo` collect PII. `fileUpload` files can carry PII past the response projection. `cal` needs a Cal.com account.
   - **Image hosts.** Every image a survey carries must be a Formbricks storage path or on an allowed host: element `imageUrl`, picture-choice images, welcome-card `fileUrl`, ending `imageUrl`, `styling.logo.url`, an image or upload `styling.background.bg`, and any image inside a rich-text (HTML) field. Respondents' browsers load these images, so any other host would see their IP addresses. Proposed default: Formbricks storage and the ASLA DAM host, which Phase 0.3 records (open question 11).
   - A `cta` button URL must be https.
6. **One PII-safe response projection** (decided 10/28/2026: answers, including open text, may go to the Anthropic and OpenAI models once PII is removed). Every tool that returns response data (`list_responses`, `get_response`, `summarize_responses` samples) goes through one ASLA output schema built by allowlist. It replaces upstream's v3 output schema for these tools and applies to both the text content and `structuredContent`.
   - Kept: response id, `finished`, `createdAt`, `updatedAt`, `language`, country, and answers to elements whose current type is on the Must 5 list.
   - Dropped: v3 `data`, `contact`, contact attributes, every `embeddedData` key (named hidden fields and reserved URL, device and identity fields), every `unresolved[].rawValue`, IP address, user agent and URL, and answers to `contactInfo`, `address` and `fileUpload` elements.
   - Answers whose element type can't be established (deleted or renamed elements) are dropped, not passed through.
   - Any field the schema doesn't name is dropped by default, so a later upgrade can't add a new path for PII.
7. **Server-side aggregation for analysis** (`summarize_responses`): per-question counts and percents, NPS score, rating, CSAT and CES mean and distribution, picture-choice counts, CTA click rate, completion rate, and a cross-tab of any two closed questions. All of it is computed in the server with exact counts, not by paging raw responses into the model.
8. **Bounded payloads.** `list_responses` caps at 50 per page with a cursor (an ASLA cap below upstream's). Open-text sampling caps at 200 answers per call, each truncated to 1,000 characters, and reports the total so the model knows it is sampling. All three numbers are proposed defaults (open question 9).
9. **Connector setup.** The server is opt-in in LibreChat, like `ms365`, and not in every preset. Add its host to `mcpSettings.allowedDomains` and to the comment block that limits MCP data to Anthropic and OpenAI.
10. **Audit, recorded and kept.** `AUDIT_LOG_ENABLED=1` in sandbox and production. Audit lines go to a sink that is kept and searchable, not only to container stdout. Each write records the Formbricks user, OAuth client, tool, survey id and time. Status changes also record the token id. Verified with a real MCP write, settings change and status change in the sandbox at the guard gate (2.8) and again in production after 3.1.

11. **Survey settings that send no email** (decided 10/28/2026, round 3). A new ASLA tool, `update_survey_settings`, writes only these fields, through its own path with `expectedUpdatedAt` and the Must 10 audit:
    - `surveyClosedMessage` (heading and subheading)
    - `isBackButtonHidden`
    - auto-advance, as upstream's `isAutoProgressingEnabled` (Phase 0.1 decides how the fork's `autoAdvance` maps to it)
    - `styling`, with image URLs held to the Must 5 host list
    - the close date, on a draft only, as a date under the Must 3 `at` rules (date only, resolved, in the future), written through the Must 3 private writer. The result gives the resolved date, time and zone. On an `inProgress` or `paused` survey the close date goes through `set_close_date` (Must 3).

    `update_survey_settings` works on `draft`, `inProgress` and `paused` surveys the caller can write, and refuses `completed` ones. It refuses `status` and `publishOn`: the publish date is written only by `apply_status_change` with `schedule_publish`. It refuses every other field by default. That includes `customCss`, `isCaptureIpEnabled`, `pin`, `singleUse`, `isVerifyEmailEnabled`, `isSingleResponsePerEmailEnabled`, `recaptcha`, follow-ups, quotas, `visibility`, the link slug and targeting. Besides status changes, it is the only write chat can make to a published survey. It changes how the survey looks and behaves, not what it asks.
12. **Skip logic and branching from chat.** The descriptions of `create_survey_draft` and `edit_survey_blocks` document the block `logic` and `logicFallback` format:
    - conditions: and/or groups over answers, hidden fields and variables
    - actions: jump to a block or ending, require an answer, calculate a variable
    - a worked example

    Like upstream's element-type list, the description is derived from the schema, so it can't drift from what the server accepts. The worked example is tested against the create schema.
13. **Ported question fields in the API** (decided 10/28/2026, round 3). Every field the port adds to a block or element goes into upstream's per-type key lists (`ELEMENT_KEYS_BY_TYPE` and `BLOCK_KEYS`) and into the read serializer. Fields that hold translated text also go into the translatable-key lists; others don't. Chat can then read and set it, and no edit drops or refuses it. Phase 1 derives the list by diffing the ported element and block schemas against 6.1.2; this PRD's examples aren't the list. Known examples: `dateKind` (month/year date) and `prefillFrom` (answer piping and prefill). Matrix "Other" and two-column choices are checked the same way. Upstream already accepts block `name`.

### Should

14. `count_responses` (with `precision: "exact"` whenever the number is reported) so "how many" never pulls response data.
15. Filters on response tools: `finished`, date range, `language`, and the answer to one closed question.
16. A LibreChat "Survey builder" model spec or Agent that turns on only this connector and carries the interview instructions.

### Could

17. Open-text theme clustering in the server (embeddings via the existing OpenAI embeddings path) instead of model-side theming over samples.
18. Cross-tabs by member type or chapter through the Snowflake sync and `asla-metrics` (needs `DATA_SOURCES.md` disposition first).
19. Upstream PR for the allowlist, draft-only and status-token guard as operator settings, so the patch drops out of our fork.

## Tools (v1)

These are the only tools `/api/mcp` exposes (Must 2). Names follow upstream 6.1.2 where it has the tool. Contracts are pinned to 6.1.2; recheck them at each upgrade. In the Fastest option, the wrapper implements all of them except `delete_survey` on the fork's API v1/v2.

| Tool | Input | Output | Source |
| --- | --- | --- | --- |
| `list_workspaces` | none | workspaces the person can access: id, name, role | upstream |
| `list_surveys` | `workspaceId`, optional `filter.status`, `filter.name.contains`, `limit` (≤100, default 20), `cursor` | id, name, status, response count, updatedAt, `nextCursor` | upstream |
| `get_survey` | `surveyId` | blocks, elements (id, type, headline, choices), status, editor URL | upstream |
| `validate_survey` | survey document | ok, or errors by element position | upstream |
| `create_survey_draft` | `workspaceId`, `name`, `blocks[]` (Must 5 types only; blocks may carry `logic` and `logicFallback`, Must 12), optional `welcomeCard`, `endings`, `hiddenFields`, `variables`, `languages` | survey id, status `draft`, editor URL | upstream `create_survey` + ASLA guard (draft status and Must 5 types only) |
| `edit_survey_blocks`, `patch_survey`, `set_survey_block_order` | `surveyId`, changes | updated summary | upstream + ASLA guard (draft surveys only, no status change; logic documented, Must 12) |
| `delete_survey` | `surveyId`, `confirm` | deleted | upstream + ASLA guard (draft surveys only) |
| `update_survey_settings` | `surveyId`, `expectedUpdatedAt`, any of `surveyClosedMessage`, `isBackButtonHidden`, `isAutoProgressingEnabled`, `styling`, close date (drafts only; `YYYY-MM-DD`, no time; never `publishOn` or `status`) | updated settings, resolved close date and time, `updatedAt` | ASLA patch (new; Must 11) |
| `prepare_status_change` | `surveyId`, `action` (`publish`, `schedule_publish`, `pause`, `resume`, `close`, `set_close_date`), `at` (`YYYY-MM-DD`, no time; resolves to a future instant at the deployment's scheduling time; required for `schedule_publish` and `set_close_date`; `null` clears the close date for `set_close_date`) | summary of the change (Must 3, with the resolved date, time and zone), single-use `statusToken` (10-minute expiry, proposed default) | ASLA patch (new) |
| `apply_status_change` | `statusToken` | survey id, new status, scheduled dates, public link | ASLA patch (new; reruns the reminder check, then writes through the Must 3 private writer) |
| `count_responses` | `workspaceId`, `surveyId`, filters, `precision` (`exact` when the number is reported) | count, and whether it is exact or a lower bound (`relation`) | upstream |
| `list_responses` | `workspaceId`, `surveyId`, filters, `limit` (≤50), `cursor` | responses in the Must 6 projection, `nextCursor` | upstream + ASLA projection and cap |
| `get_response` | `responseId` | one response in the Must 6 projection | upstream + ASLA projection |
| `summarize_responses` | `workspaceId`, `surveyId`, optional filters, optional `crossTab: {rowElementId, colElementId}`, optional `openTextElementId` + `sampleSize` (≤200) | per-element stats, NPS, completion rate, cross-tab table, open-text sample with total count | ASLA patch (new) |

The `limit` (≤50) and `sampleSize` (≤200) caps are proposed defaults (Must 8; open question 9). That is 16 tools in the Best long-term option. The Fastest wrapper has 15; deleting a draft stays in the Formbricks UI, and it can't offer `csat` or `ces`, which the fork on 4.9 lacks.

Scopes requested by LibreChat: `surveys:read surveys:write responses:read offline_access`. Not requested: `responses:write`, `workflows:*`, `dashboards:*`, `feedbackRecords:*`. `surveys:write` also covers `patch_workspace_custom_css`, so the allowlist (Must 2), not the scope, keeps it out.

## User flows

**Create and publish**
1. The person turns on the Formbricks connector and clicks Connect. The first time, they sign in to Formbricks and approve the scopes.
2. They ask: "Help me write a survey for chapter presidents about the leadership summit."
3. The model interviews them (Must 4), one short round at a time, and picks the workspace with `list_workspaces`.
4. The model shows numbered draft questions with types and choices, and an estimated completion time. The person edits in chat.
5. If the person wants branching ("skip the travel questions for anyone who didn't attend"), the model adds `logic` to the blocks and restates each rule in plain words.
6. On "create it," the model calls `validate_survey`, then `create_survey_draft`, and returns the editor link.
7. If the person asks to publish, the model calls `prepare_status_change` with `publish`, shows the summary, and asks "Publish this survey now?" Only on an explicit yes does it call `apply_status_change` and return the public link. Distribution (sharing the link, invitations) stays with the person.
8. Instead of publishing now, the person says "Publish it on Monday." The model calls `prepare_status_change` with `schedule_publish` and that date as `at`. The summary gives the date and the time and zone the survey opens at (open question 12). If the person asks for a time of day, the model says only the date can be set. The summary also says the survey shows as paused until then, no email is sent, and its questions can't be edited from chat after this. It calls `apply_status_change` only on an explicit yes.

**Change a live survey**
1. "Change the closed message and hide the back button." The model calls `update_survey_settings`. No token is needed, because no email goes out and the status doesn't change.
2. "Pause the summit survey." The model calls `prepare_status_change` with `pause`. It shows the summary, including whether the close date will be cleared, and calls `apply_status_change` only on an explicit yes.
3. "Resume it." If any reminder is due within the next 25 hours, the server refuses, at prepare or again at apply, and the model tells the person to resume in Formbricks. Otherwise it follows the same summary-and-yes step.
4. "Close it." Same step; the summary says the survey stops taking responses.

**Analyze**
1. "How is the summit survey doing?" The model calls `list_surveys`, then `count_responses` with `precision: "exact"`, then `summarize_responses`.
2. "Break satisfaction down by role." The model calls `summarize_responses` with a `crossTab`.
3. "What are people saying in the open comments?" The model calls `summarize_responses` with `openTextElementId`, themes the sample, and says it is a sample of N out of M.
4. Exact numbers come from the server's aggregation. The model doesn't recount them.

## Data, integrations and hosting

- **Best long-term:**
  - The MCP server runs inside the Formbricks container on nan01 at `https://surveys.asla.org/api/mcp`, over streamable HTTP. There is no new container.
  - Env: correct public `WEBAPP_URL` / `BETTER_AUTH_URL` / `PUBLIC_URL`, `MCP_LIBRECHAT_CALLBACK_URI` (and `MCP_DCR_ALLOWED_REDIRECT_URIS` set to the same single value, if DCR stays), and `AUDIT_LOG_ENABLED=1`.
  - LibreChat sends the OAuth `resource` parameter. Don't copy ms365's `send_resource_parameter: false`, because upstream audience-binds tokens.
  - The status-change token needs a new table and migration, applied through the Formbricks migration runner like every other migration.
- **Fastest:**
  - A Node MCP container next to LibreChat on nan01, on its own private compose network that only `librechat-api` joins (the `librechat-ms365-mcp` pattern), listed in `mcpSettings.allowedAddresses`.
  - Transport: streamable HTTP. stdio is ruled out because LibreChat runs in Docker and stdio gives no per-user auth.
  - The container holds one Formbricks API key per environment in nan01 secrets (Key Vault, per existing practice). It validates the person's Entra token, maps their email to their Formbricks user and role through a read-only database role, and refuses anyone without a role on the target environment.
- **LLM residency** (decided 10/28/2026): answers in the Must 6 projection, including open text, go to whichever Anthropic or OpenAI model the person picked, through Ramp Router. This matches the current rule for every ASLA MCP server.

## Sandbox and cutover

gcohen's condition (10/28/2026): do the upgrade in a sandbox, because surveys are live. Production is not touched until cutover, and cutover needs his go.

**Sandbox setup** (follows the `staging-members.aslalabs.org` precedent in `~/dev/azure_vm/docs/apps/member-directory.md`):
- Its own compose project on nan01 (for example `/opt/formbricks-staging`), with its own Postgres and Redis. It never shares a database, volume or Redis with production.
- Its own hostname behind Caddy, IP-restricted to the two addresses already allowed for `staging-members`. Working name: `staging-surveys.aslalabs.org`.
- Its own Microsoft sign-in redirect URI on the Formbricks Entra app.
- Data: a restore of the latest production backup, so every real survey can be tested.
- Built from the upgrade branch. Production keeps deploying from `main`.

**Sandbox rules.** A restored production database carries live side effects. Each one is turned off before the sandbox first boots, and the checks run again after every restore, before the sandbox serves a request:
- **Email.** SMTP points at a mail sink that delivers nothing. No invitation, reminder, follow-up or notification email can reach a real person.
- **Reminders and schedule windows.** `/api/cron/reminders` is not scheduled in the sandbox, and its `CRON_SECRET` differs from production. Schedule-window automation does not run on its own; the guard gate triggers the scheduler by hand to test `schedule_publish`.
- **File storage.** The sandbox has its own storage bucket and credentials, with copies of the production files it needs. It holds no production storage credentials, so deleting a copied response or upload can't remove a production file.
- **Snowflake.** Member lookup and response sync use a dev schema or a read-only role. The sandbox never writes to production Snowflake tables.
- **Webhooks, integrations and external API lookup.** After restore, webhook rows and stored integration credentials (Slack, Google Sheets, Notion, Airtable and similar) are deleted, so a test response can't reach a production endpoint. If 0.1 finds external API lookup in use, its endpoints point at a stub and any stored credentials are removed.
- **Links.** `WEBAPP_URL` and `PUBLIC_URL` are both the sandbox hostname (or `PUBLIC_URL` is unset), so no generated link points at production.
- **Teardown.** The sandbox database and bucket are deleted after cutover, or refreshed from a new backup before each round of testing.

**Testing in the sandbox:**
- Every in-progress and scheduled production survey opens in the editor, renders, and accepts a test response.
- Every ported fork feature works (the Phase 0 list).
- Microsoft sign-in and SSO-only mode work.
- Migrations run through the Formbricks runner, and stored surveys and responses match before and after (counts per survey, and a sample of answers compared field by field).
- The MCP guards (Phase 2) are built and pass here before cutover. LibreChat reaches the sandbox through a temporary opt-in `formbricks-sandbox` connector over the private Docker network. Task 2.1 adds it; task 4.2 removes it after cutover. The sandbox's `MCP_LIBRECHAT_CALLBACK_URI` is the `formbricks-sandbox` callback (Must 1), so the guards are tested with the same code and only the env value differs from production.

**Cutover (gcohen's go required):**
- Prerequisites: sandbox sign-off (1.5) and the guard gate (2.8) have both passed.
- Freeze window agreed with survey owners, and a tested restore.
- **Pause writes before the snapshot.** Public survey traffic gets a maintenance page, and the reminder cron, invitation sends and Snowflake sync stop. Then take the backup. Nothing writes to production between the snapshot and the switch.
- **Migrate.** Run the Formbricks migration runner (`apply-migrations.js`), never `prisma migrate deploy` alone or `db push --accept-data-loss`. Phase 0.4 reconciles production's `db push` history with the migration files before cutover.
- **Validate with sends paused.** Every in-progress survey keeps its ID and public link and accepts a test response. Personal `/c/<token>` links and encrypted single-use links already sent still open (same `ENCRYPTION_KEY`). A partial response resumed through link resume finishes. Historical response counts and sampled answers match the snapshot.
- **MCP stays closed.** Caddy blocks `/api/mcp` and the MCP OAuth and DCR endpoints on `surveys.asla.org` until 3.1 opens them.
- **Reopen.** Remove the maintenance page, then turn reminders and sends back on. Reminders already scheduled fire once: not skipped, not sent twice.
- **Rollback.** Before reopening, rollback is restore the snapshot plus redeploy the recorded 4.9 image tag, and loses nothing. After reopening, a restore would lose new responses and rewind the reminder ledger (claims are stored before the email goes out, `modules/survey/invitations/lib/scheduled-reminders.ts:52-59,79-89,125-133`), so a reminder could go out twice. Rolling back after reopening therefore means: pause sends, export responses and reminder claims created since reopening, restore, re-import them into 4.9, check them, then resume sends. The runbook rehearses this in the sandbox after a test submission and a simulated send.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| The sandbox runs on a copy of production data with live side effects (email, reminders, storage, Snowflake, webhooks, links) | Real respondents get test email, production files are deleted, or production data changes | Sandbox rules above, checked before first boot and after every restore (Done when) |
| Cutover breaks a survey in the field | Respondents can't finish; responses are lost | Sandbox test of every live survey; quiesced snapshot; validation with sends paused; rollback with a reconciliation path; gcohen's go |
| Upgrading turns on every upstream MCP tool, open DCR, signed-in client-management routes, loopback callbacks and API-key access | Unguarded writes, or survey data reaching a client other than ASLA Chat | Tool allowlist (Must 2); every client-mutation route disabled or held to the LibreChat callback, plus a per-request client check on `/api/mcp` (Must 1); guard gate before cutover; Caddy blocks MCP on production until the guards pass |
| Porting the fork to 6.1.2 is large: 220 conflicted files, ~20 features to carry across, 5 migrations | The upgrade runs long; a feature regresses | Time-boxed Phase 0 with a stop condition and a go/no-go; port feature by feature with tests; Fastest is the fallback |
| Our sign-in (Microsoft without EE, SSO-only, proxy JWT gate) is built on NextAuth; upstream moved to Better Auth | Staff can't sign in after the upgrade | Rewrite as its own Phase 1 issue; verify in the sandbox before cutover |
| Existing surveys store fork-only fields (custom contact fields, month/year dates, auto-advance, schedule window) | Upstream validators reject them and existing surveys break | Phase 0.4 loads every production survey through the 6.1.2 validators |
| Production schema was applied with `db push`, and 6.1.2 needs TypeScript data migrations in order | Migrations fail, or backfills are skipped and data is lost | Formbricks migration runner only; reconcile migration history in 0.4; compare data before and after |
| The v3 response shape carries PII in `embeddedData`, `unresolved`, `data` and `contact` | PII reaches the LLM provider | One allowlist projection for every response tool (Must 6), tested on both text and structured output |
| LibreChat v0.8.8 can't show a server's confirmation prompt | The model could publish, pause, resume or close without a real yes | Stored single-use token bound to user, OAuth client, survey, action, resolved date and revision; no self-confirm flag; draft-only for question edits; audit log; switch to client confirmation when LibreChat ships it (#11526, #13304). A wrongly published link survey reaches no one until its link is shared. A wrong pause or close can be reversed in Formbricks, though cleared dates must be set again |
| Resuming or publishing a survey with sent invitations triggers reminders that came due while it wasn't live | Members get a burst of reminder email from a chat action | Must 3: a reminder check with no side effects, run at prepare and again at apply, refuses `publish` or `resume` when any reminder is due within the lookahead, and refuses `schedule_publish` when any reminder is left to send. Those changes happen in Formbricks |
| A draft given only a publish date is never published (6.1.2 publishes scheduled surveys from `paused`) | A survey scheduled from chat silently stays closed | Must 3: `schedule_publish` moves the draft to `paused` with the date, through the private writer; a gate item proves it opens |
| Schedule dates keep only the date; the time comes from one deployment-wide setting (default Europe/Berlin, 00:00) | A survey opens or closes at a different hour than the person expects, or a same-day date is already past when stored | Must 3: `at` is date-only and a time is refused; the summary shows the resolved date, time and zone; the token binds that instant, and apply checks it is still in the future; open question 12 sets the zone |
| A status change resets schedule dates (6.1.2 rules) | A pause or close silently removes a planned close or publish date | The summary states which dates are cleared before the person says yes |
| The model sends wrong logic or none | Respondents see questions meant for others, or skip ones they should answer | Must 12 tool text; branched-survey gate test; logic is edited only on drafts, which the person can check in the editor before publishing |
| A chat edit reaches a ported field upstream's API doesn't know | The edit is refused, or the field is lost | Must 13: add ported fields to the API in Phase 1; round-trip gate test |
| The model picks image hosts | Respondents' IP addresses go to an outside host | Must 5 image-host list |
| Audit is off unless `AUDIT_LOG_ENABLED=1`, and lines go only to the logger | No record of who changed what | Must 10: enable it, ship lines to a kept sink, verify in the deployed configuration |
| LibreChat registers OAuth clients as confidential. Unverified whether Formbricks' anonymous DCR accepts that; asla-metrics did not | Connect fails | Spike 2.1, first task in Phase 2; fallback is an admin-registered confidential client, as done for asla-metrics |
| Rate limit is per key/user and turns off when Redis is down | Throttling or no limit | Aggregation tool avoids paging; confirm Redis on nan01 is healthy |
| Fork patches to the MCP module conflict with future upgrades | Merge pain later | Keep patches in one module; pin contracts per release; offer the guard upstream (Could 19) |

## Decisions and open questions

Decided by gcohen, 10/28/2026 (round 1):
- **Users:** staff with an existing Formbricks account; their role sets access.
- **Data to the LLM:** yes, with PII removed (Must 6).
- **Publishing:** the agent may publish after the person says yes in chat.
- **Success target:** none for now; report the count.

Decided by gcohen, 10/28/2026 (round 2):
- **Path:** upgrade to 6.1.x, then port our features, in a sandbox first because surveys are in the field. Fastest stays the fallback if Phase 0 is no-go.
- **Publish confirmation:** accept the two-step publish token for v1. The model gets the yes; the server can't prove a person gave it. Switch to client confirmation when LibreChat ships it. Round 3 extends the same token to every status change.

Decided by gcohen, 10/28/2026 (round 3):
- **Settings:** chat changes the settings that send no email (Must 11). Email, access and anti-abuse settings stay in Formbricks.
- **Ported fields:** add them to the API during the port, so chat can read and set them (Must 13).
- **Live surveys:** pause, resume and close from chat after a yes, through the token (Must 3). Question edits on a published or scheduled survey stay in Formbricks.
- **Invitations and reminders:** stay in Formbricks for the first release; revisit after the pilot.
- **Question types:** add `cta`, `csat`, `ces` and `pictureSelection` (Must 5).

Open, with the assumption this PRD makes:
1. **Production during the port.** *Assume:* security fixes still ship on 4.9; new fork features wait until cutover, or each is built on both branches.
2. **Sandbox data.** *Assume:* a full production copy (it includes response PII) on the same VM, IP-restricted, deleted after cutover. An anonymized copy is safer but can't prove every live survey still opens.
3. **Sandbox access.** *Assume:* the `staging-members` IP allowlist, and Infra Engineer adds the sandbox redirect URI to the Formbricks Entra app.
4. **nan01 capacity and sandbox storage.** *Assume:* nan01 can run a second Formbricks stack, and a second storage bucket costs little. Phase 0.3 checks RAM, disk and the bucket first; if a short-lived VM or new storage spend is needed, that is a separate decision for gcohen.
5. **Cutover timing.** *Assume:* a low-traffic window that survey owners agree to, after gcohen's go. The maintenance page during the window means respondents can't submit for its length.
6. **Phase 0 time-box.** *Assume:* the CEO sets the length when filing 0.2.
7. **Audit log retention.** *Assume:* Infra Engineer picks the sink and uses the retention ASLA applies to other app logs on nan01.
8. **Other MCP clients.** *Assume:* ASLA Chat is the only client (Must 1). Allowing, say, a desktop app would need its own data review.
9. **Limits gcohen hasn't set.** *Proposed defaults:* the status-change token expires in 10 minutes; the reminder check looks 25 hours ahead (Phase 0.3 records the real cron time, and the window must stay longer than the cron interval); `list_responses` returns at most 50 per page; open-text samples hold at most 200 answers of at most 1,000 characters each; the aggregation accuracy test uses a survey with 500+ responses. Any can change before build without changing the design.
10. **Publish or resume when reminders are due.** *Assume:* chat refuses `publish` or `resume` when any reminder is due within the lookahead, and refuses `schedule_publish` when any reminder is left to send, and points to Formbricks. It checks again when the change is applied. The alternative, going ahead and showing the count in the summary, would let a yes in chat send member email, which the round-3 decision on reminders rules out.
11. **Image hosts.** *Assume:* Formbricks storage and the ASLA DAM host only. Infra Engineer records the DAM's public image hostname in Phase 0.3, and the Must 5 list and the gate test use it. Each added host would see respondents' IP addresses.
12. **Scheduling time zone and hour.** *Assume:* `SURVEY_SCHEDULING_TIME_ZONE` is America/New_York (ASLA's office time zone), and the time stays at upstream's 00:00. Upstream's default zone is Europe/Berlin. The setting is deployment-wide: it also sets when surveys scheduled in the Formbricks editor open and close. Infra Engineer sets it in the sandbox in Phase 0.3, and the cutover runbook (1.4) carries the same values to production. Per-survey times of day would mean patching upstream's normalizer and every path that saves a survey; not proposed for the first release.

## Phased breakdown (proposed Repo Worker / Infra issues)

Each is sized for one issue. The CEO files them after gcohen approves. Phases run in order, except that Phase 2 runs in the sandbox alongside Phase 1 and must finish before sign-off (1.5). Nothing reaches production until 1.6.

**Phase 0: Assessment (time-boxed go/no-go)**
- 0.1 Finish the fork inventory: confirm each feature is ported, upstreamed or obsolete, and estimate each port. Find where external API lookup is configured and whether it's in use. Compare the fork's schedule window, per-survey access control and auto-advance with 6.1.2's `publishOn`/`closeOn`, `visibility` and `isAutoProgressingEnabled`, and pick one for each: keep the fork's, take upstream's, or merge. Flag auth and EE re-implementations. *Repo Worker*
- 0.2 Time-boxed conflict assessment: classify the 220 conflicts, check the toolchain and migration order, and stop when the time-box ends or every conflict has an estimate, whichever comes first. Not a complete merged build; that work goes into the Phase 1 port issues. *Repo Worker*
- 0.3 Stand up the sandbox on nan01 (check RAM, disk and the storage bucket first) and apply every sandbox rule before first boot. Restore the latest production backup into it. Record the production reminder cron's schedule and the DAM's public image hostname (open questions 9 and 11). Set `SURVEY_SCHEDULING_TIME_ZONE`, `SURVEY_SCHEDULING_LOCAL_HOUR` and `SURVEY_SCHEDULING_LOCAL_MINUTE` (open question 12). Document it in `~/dev/azure_vm/docs/apps/formbricks.md`. *Infra Engineer*
- 0.4 In the sandbox, on a clean upstream 6.1.2 image: reconcile production's migration history, run the Formbricks migration runner, load every survey through the 6.1.2 validators, compare stored data before and after, and list failures. *Repo Worker*
- 0.5 Go/no-go note with an effort estimate. *Repo Worker → CEO → gcohen*

**Phase 1: Upgrade in the sandbox (if go)**
- 1.1 Rewrite Microsoft sign-in, SSO-only hardening and the proxy JWT gate on Better Auth. *Repo Worker*
- 1.2 Merge and port fork features onto 6.1.2, one issue per feature group from 0.1. *Repo Worker*
- 1.2a Ported fields in the API (Must 13): diff the ported element and block schemas against 6.1.2, add each field to the v3 key lists and the read serializer, and test a round trip. Runs after the 1.2 ports it depends on. *Repo Worker*
- 1.3 Five issues, one per open security bead (`fb-bm6-7qz`, `-w14`, `-ud7`, `-7f9`, `-j9q`): fix on the upgrade branch, or confirm upstream fixed it. *Repo Worker*
- 1.4 Cutover runbook: the 0.3 scheduling settings in production, freeze window, quiesce and snapshot, migration runner, validation with sends paused, Caddy block on MCP, reopen, rollback before and after reopening with reconciliation, and a rehearsal in the sandbox. *Infra Engineer*
- 1.5 Sandbox sign-off: every live survey, ported feature and the 1.4 rehearsal checked, and the guard gate (2.8) passed. Then gcohen's go. *Repo Worker → CEO → gcohen*
- 1.6 Cut production over per the runbook. *Infra Engineer*

**Phase 2: ASLA guards and analysis (fork patches; built and tested in the sandbox, before 1.5)**
- 2.1 Spike, first: LibreChat OAuth against the sandbox. Add the temporary opt-in `formbricks-sandbox` connector to LibreChat over the private Docker network, try DCR limited to the LibreChat callback, and fall back to a server-side admin client. The outcome decides how 2.2 registers LibreChat. *Repo Worker*
- 2.2 Tool allowlist and MCP client restriction (Must 1, Must 2): only the Tools (v1) table; `MCP_LIBRECHAT_CALLBACK_URI` read once and used by DCR, the admin client and the request check; every HTTP client-mutation route disabled or held to that callback; per-request client check on `/api/mcp`; no API keys through `x-api-key` or `Authorization: Bearer`; Vitest coverage of each route. *Repo Worker*
- 2.3 Draft-only guard on `create_survey`, `patch_survey`, `edit_survey_blocks`, `set_survey_block_order` and `delete_survey`; Must 5 type allowlist, image-host list and https CTA links; Vitest coverage. *Repo Worker*
- 2.4 `prepare_status_change` and `apply_status_change` (Must 3): every action; a stored single-use token bound to user, client, survey, action, the resolved `at` and `updatedAt`; `at` as a date only, resolved by the writer's helper and rechecked at apply; the reminder check with no side effects (per invitation, under the cap, 25-hour lookahead) at prepare and again at apply before the token is consumed; the `schedule_publish` refusal; the private status-and-schedule writer (compare-and-set on `updatedAt`, `normalizeSurveyScheduling`, `schedule_publish` as draft to `paused` plus `publishOn`); atomic consume; permission and status recheck at apply; the token migration; no self-confirm path; no sends. Vitest coverage of each action from each status, a token used for the wrong action, reminder eligibility that changes between prepare and apply with no survey edit, a check that claims no offset and calls no sender, an invitation with several overdue offsets counted once, an `at` with a time or offset refused, the resolved local date in America/New_York equal to `at`, today's date refused under a 00:00 scheduling time, a close date on the publish date refused, a summary time equal to the stored value, and a date that passes between prepare and apply refused. *Repo Worker*
- 2.4a `update_survey_settings` (Must 11): field allowlist, status rules, the draft-only close date (date only, under the Must 3 `at` rules) through the private writer, image-host check and audit; Vitest coverage, including each refused field, `publishOn` and `status`. *Repo Worker*
- 2.4b Logic in the tool text (Must 12): document `logic` and `logicFallback` in the create and block-edit descriptions, derived from the schema, with a worked example tested against the create schema. *Repo Worker*
- 2.5 The Must 6 projection on `list_responses` and `get_response`, with Vitest fixtures for embedded URL and identity fields, deleted PII elements, text output and `structuredContent`. *Repo Worker*
- 2.6 `summarize_responses` (Must 7, Must 8): exact stats for every Must 5 type, NPS, completion rate, cross-tab, and an open-text sample through the Must 6 projection, with the same Vitest fixtures as 2.5. *Repo Worker*
- 2.7 Audit: `AUDIT_LOG_ENABLED=1` and a kept, searchable sink, in the sandbox now and in production at cutover. *Infra Engineer*
- 2.8 Guard gate: in the sandbox, through the `formbricks-sandbox` connector, every item under "Done when: guard gate" passes. *Repo Worker*

**Phase 3: Connect production (after 1.6)**
- 3.1 Set production's `MCP_LIBRECHAT_CALLBACK_URI` to the `formbricks` callback, and `MCP_DCR_ALLOWED_REDIRECT_URIS` to the same value (or create the admin client, per 2.1). Verify `/.well-known` metadata on `surveys.asla.org`, then lift the Caddy block. Rerun the client-restriction, cross-deployment and audit gate items against production. *Infra Engineer*
- 3.2 Add the `formbricks` entry to `librechat.yaml`: opt-in, scopes as above, allowedDomains, provider-rule comment. *Repo Worker*
- 3.3 Server instructions text for the interview, logic and status-change confirmation flows (Must 3, Must 4, Must 12). *Repo Worker; Copy Editor review*

**Phase 4: Pilot and cleanup**
- 4.1 "Survey builder" model spec in LibreChat. *Repo Worker*
- 4.2 Remove the `formbricks-sandbox` connector and tear down the sandbox. *Infra Engineer*
- 4.3 Pilot with survey owners; check `summarize_responses` numbers against the Formbricks summary page on live surveys; collect feedback; report the published-survey count. *Product Strategist*

**Fastest path, if chosen or if Phase 0 is no-go:** F.1 wrapper skeleton with Entra OAuth and a private network; F.2 `list_workspaces`, `list_surveys`, `get_survey`; F.3 `validate_survey`, `create_survey_draft`, and draft editing (`edit_survey_blocks`, `patch_survey`, `set_survey_block_order`) on API v1 with guards; F.4 `update_survey_settings`, `prepare_status_change` and `apply_status_change` on API v1, with the Must 3 reminder check at prepare and apply, the same date-only `at`, and the same writer rules on the fork's schedule window, which resolves and states the time by its own rules; F.5 `count_responses`, `list_responses` and `get_response` on API v1/v2 with the Must 6 projection; F.6 `summarize_responses`; F.7 LibreChat config. Tasks 3.3, 4.1 and 4.3 carry over unchanged.

## Done when

### Guard gate (checked in the sandbox at 2.8, before sign-off)

- [ ] In ASLA Chat, a staff member with a Formbricks role connects with their own Formbricks login. A staff member with no role on a workspace gets an authorization error for it.
- [ ] `tools/list` on `/api/mcp` returns exactly the 16 tools in the "Tools (v1)" table, and calling any other registered tool is refused, for every client.
- [ ] A DCR registration with a loopback, hosted-client or any non-LibreChat callback is refused (or DCR returns 403 if 2.1 turned it off).
- [ ] As a signed-in Formbricks user, `/oauth2/create-client`, `/oauth2/update-client`, `/oauth2/client/rotate-secret` and `/oauth2/delete-client` (and `/admin/oauth2/create-client` and `/admin/oauth2/update-client`, if reachable over HTTP) are disabled or refuse any callback other than the LibreChat one.
- [ ] A token issued to a client whose redirect URIs are not exactly the LibreChat callback, including a client changed after the token was issued, is refused by `/api/mcp`.
- [ ] Cross-deployment refusal: on the sandbox, registering a client with the production callback (`/api/mcp/formbricks/oauth/callback`) is refused, and so is an authorization request that uses it. After cutover (3.1), production refuses the `formbricks-sandbox` callback (`/api/mcp/formbricks-sandbox/oauth/callback`) the same way.
- [ ] A request to `/api/mcp` with an API key in `x-api-key` is refused, and so is one with an API key in `Authorization: Bearer`.
- [ ] `create_survey_draft` creates a survey whose status is `draft` in Formbricks. Its editor link opens it.
- [ ] Calling create with `status: "inProgress"`, or patching any survey's status, is rejected by the server. Editing the questions of a published or scheduled survey, or deleting it, through MCP is rejected.
- [ ] Creating a survey with an element type outside the Must 5 list is rejected with a message that says to add that question in the editor.
- [ ] An element image, picture-choice image, welcome-card image, ending image, `styling.logo.url` or styling background on a host outside the Must 5 list (Formbricks storage and the DAM hostname recorded in 0.3) is rejected, and so is a `cta` button URL that isn't https.
- [ ] A draft with one question of each type (`cta`, `csat`, `ces`, `pictureSelection`) is created from chat. On a restored survey with each of those types, `summarize_responses` returns counts, CSAT and CES means and distributions, and the CTA click rate, and they match the Formbricks summary page.
- [ ] Branching from chat: in a test chat, the person describes a survey with at least one jump to a block, one jump to an ending, one required-answer rule, one calculated variable and a fallback. The model creates it as a draft with no hand edits. A scripted run in the editor's survey preview (the draft's public link is closed) takes every path, and each one reaches the block or ending the person described. A rule that points to a missing block or ending is refused by the server.
- [ ] Ported-field round trip: on a restored survey that uses each field from 1.2a, `get_survey` returns the field, an unchanged `edit_survey_blocks` leaves the survey identical, and a chat edit can set the field.
- [ ] `update_survey_settings` changes the closed message, back button, auto-advance, styling and a draft's close date. It refuses every other field (including `customCss`, `isCaptureIpEnabled`, `pin`, `singleUse`, `isVerifyEmailEnabled` and `recaptcha`), a close date on an `inProgress` or `paused` survey, and any `completed` survey.
- [ ] `apply_status_change` succeeds only with a valid token from `prepare_status_change` for the same user, client, survey and action. It rejects a missing, expired, reused or stale token (survey edited after `prepare_status_change`), and a token used for a different action. No tool argument skips the token.
- [ ] Each action (`publish`, `schedule_publish`, `pause`, `resume`, `close`, `set_close_date`) works from the statuses Must 3 allows and is refused from the others, and each summary carries its Must 3 line, including the dates the change clears. `set_close_date` with `at: null` clears the close date.
- [ ] A draft scheduled with `schedule_publish` is `paused` with `publishOn` set. When the scheduler is run by hand in the sandbox after that date, the survey is `inProgress` and its public link takes a response. `resume` on that survey before the date is refused and points to `publish`.
- [ ] `at` with a time or offset is refused by `prepare_status_change` and `update_survey_settings`. With the sandbox's scheduling settings, a date whose scheduling time has passed (today, at 00:00) is refused, and so is a close date on the same date as the publish date. The date, time and zone in the summary equal the stored `publishOn` or `closeOn`. With the sandbox zone set to America/New_York, the stored instant falls on the `at` date in that zone. A token whose resolved date passes before apply is refused.
- [ ] A close date on an `inProgress` or `paused` survey changes only through `apply_status_change` with a valid `set_close_date` token; `update_survey_settings` refuses it, and refuses `publishOn` on any survey.
- [ ] No status change sends an invitation or reminder email. On a paused survey with a reminder due, `resume` is refused and points to Formbricks; so is `publish` on a draft with a sent invitation and a reminder due, and `schedule_publish` on a draft with any reminder left to send. With none due, `resume` and `publish` work and the next cron run sends nothing.
- [ ] Reminder eligibility that changes during the confirmation window, with no survey edit (for example, an invitation's offset comes due between prepare and apply), makes `apply_status_change` refuse. The reminder check claims no offset and calls no email sender.
- [ ] With `AUDIT_LOG_ENABLED=1`, a real MCP write, a settings change and a status change all appear in the kept audit sink with the Formbricks user, client, tool, survey id, time and, for the status change, the token id.
- [ ] Neither the text output nor `structuredContent` of `list_responses`, `get_response` or the `summarize_responses` sample contains v3 `data`, `contact`, contact attributes, any `embeddedData` key, any `unresolved[].rawValue`, IP address, user agent, URL, answers to `contactInfo`, `address` or `fileUpload` elements, or answers to deleted elements (Vitest fixtures prove it, including a hidden field named `email` and a deleted `contactInfo` element).
- [ ] On a restored survey with 500+ responses (proposed default; open question 9), `summarize_responses` counts and NPS match the Formbricks summary page exactly, and no single tool result exceeds the Must 8 caps.
- [ ] No Formbricks API key appears in the `formbricks-sandbox` connector config, LibreChat's database, or the transcripts of the test sessions.

### Sandbox

- [ ] Before first boot and after every restore, SMTP goes to a sink, and a test invitation reaches no real inbox.
- [ ] Before first boot and after every restore, `/api/cron/reminders` is not scheduled, and the sandbox `CRON_SECRET` differs from production.
- [ ] Before first boot and after every restore, storage uses the sandbox bucket and the sandbox holds no production storage credentials. Deleting a copied response leaves the production file in place.
- [ ] Before first boot and after every restore, Snowflake access is a dev schema or a read-only role.
- [ ] Before first boot and after every restore, webhook and integration rows are deleted, and external API lookup (if in use) points at a stub.
- [ ] Before first boot and after every restore, `WEBAPP_URL` and `PUBLIC_URL` are the sandbox host (or `PUBLIC_URL` is unset).
- [ ] The sandbox answers only from the allowed IP addresses.
- [ ] Every fork feature on the Phase 0 list works, Microsoft sign-in works, and every in-progress or scheduled production survey opens in the editor and accepts a test response.
- [ ] The Formbricks migration runner completes on restored production data, and per-survey response counts and sampled answers match before and after.

### Cutover and production

- [ ] Production stays on 4.9 until gcohen gives the cutover go, and the go comes only after sign-off (1.5), which includes the guard gate (2.8).
- [ ] The cutover runbook includes the quiesced snapshot, rollback before and after reopening with reconciliation of responses and reminder claims, and a sandbox rehearsal of rollback after a test submission and a simulated send.
- [ ] Until 3.1, `/api/mcp` and the MCP OAuth and DCR endpoints on `surveys.asla.org` return a block from Caddy.
- [ ] After cutover, with sends still paused: every survey that was in progress keeps its ID and public link and accepts a new response, a sent `/c/<token>` link and an encrypted single-use link still open, a link-resume partial response finishes, and historical response counts and sampled answers match the snapshot. After reopening, already-scheduled reminders fire exactly once.
- [ ] After 3.1, the client-restriction items and the audit item from the guard gate pass again against `surveys.asla.org`.
- [ ] After 3.3, in a test chat the model interviews the person (Must 4) before calling `create_survey_draft`, and shows the `prepare_status_change` summary and gets an explicit yes before calling `apply_status_change`.
- [ ] The production `librechat.yaml` change keeps the connector opt-in, lists the host in `allowedDomains`, updates the provider-rule comment, and contains no Formbricks API key.
