# PRD: Formbricks survey building and response analysis from ASLA Chat

Status: draft v5, 10/28/2026. gcohen answered rounds 1 and 2. Path decided: upgrade, then port our features, all in a sandbox first because live surveys are in the field. v5 applies the Copy Editor and feasibility reviews. Owner: Product Strategist. Source: ASL-1794 (Paperclip), ASL-1795 (Paperclip).

## Recommendation

**Upgrade our Formbricks fork to upstream 6.1.2 in a sandbox, port our features there, build and test the ASLA MCP guards there, and cut production over only after gcohen signs off. Then connect the MCP server that ships with Formbricks to ASLA Chat (LibreChat) as an opt-in OAuth connector, the same way Microsoft 365 is connected today.** The ASLA patches are a tool allowlist, a draft-only and publish-token guard, one PII projection for every response tool, a server-side `summarize_responses` tool, a v1 question-type allowlist, and restricting MCP sign-in to ASLA Chat. gcohen chose this path on 10/28/2026.

Production (`surveys.asla.org`) stays on 4.9 and keeps serving the surveys in the field until cutover. All upgrade, porting and MCP work happens on a separate sandbox copy (see "Sandbox and cutover"). Production's MCP endpoints stay blocked at the proxy until the guarded build passes in the sandbox.

Why: upstream Formbricks already has what we were going to build. Since 5.2.0 it serves `/api/mcp` over streamable HTTP. Each person signs in with their own Formbricks login (OAuth 2.1), and every call is checked against that person's workspace role. Survey and response tools are maintained upstream and aren't license-gated. A wrapper on 4.9 gets us there sooner, but it uses org-wide API keys with no per-user identity, and we would throw it away at the next upgrade.

**The upgrade keeps our fork's features, but it costs real work.** Git carries every fork commit forward; nothing is dropped automatically. Each feature has to be carried across and retested, and the sign-in code has to be rewritten. A trial merge of our `main` into 6.1.2 on 10/28/2026 conflicted in 220 files. That makes the upgrade a fork-migration project in its own right. It's worth doing anyway: every upstream security fix currently has to be backported by hand (about 45 of our 190 commits are backports), and the MCP server comes with it. Phase 0 is a time-boxed assessment that ends in an effort estimate and a go/no-go.

| Option | What it is | Pick it when |
| --- | --- | --- |
| **Best long-term (chosen 10/28/2026)** | Upgrade fork to 6.1.2 in a sandbox, port ASLA features, add ASLA guards, cut over, use built-in `/api/mcp` with per-user OAuth | Phase 0 says the effort is bounded |
| **Fastest (fallback)** | ASLA-built MCP container on nan01 over the fork's existing v1/v2 API. Entra sign-in, API keys held server-side, 14 tools (see "Tools"). The fork stays on 4.9 untouched | Phase 0 is no-go. Security backports continue one at a time |
| Other: wrapper now, upgrade later | Build Fastest now; retire it when the upgrade lands | We want the chat feature soon and still plan to upgrade. Costs the wrapper twice over (build, then retire) |
| Other: LibreChat Agent with OpenAPI actions | Point an Agent at the v1/v2 OpenAPI specs | Not recommended. Actions aren't configured in our LibreChat. They would need one shared key in the chat client, and they can't aggregate responses server-side |
| Other: third-party hosted MCP (Vinkius) | Hosted server; each user pastes a personal Formbricks API key | Not recommended. Survey data would pass through a vendor we haven't vetted, and our fork has no personal API keys |

## Problem and who it's for

ASLA staff build surveys in Formbricks (`surveys.asla.org`) by hand and read results in the Formbricks UI or exports. Turning a goal ("find out why chapter leaders skip the leadership summit") into good questions takes time, and so does analyzing open-text answers. Staff already work in ASLA Chat (`chat.aslalabs.org`, LibreChat v0.8.8), which has connectors for Metrics, Member Voices, Member Survey, DAM and Microsoft 365.

Users (decided 10/28/2026): ASLA staff who already have a Formbricks account. Their Formbricks role sets what they can see and change. ASLA Chat accepts only `@asla.org` Entra accounts, and members have no access (`~/dev/librechat/librechat.yaml:11-15`, `README.md:3`). No one is auto-provisioned.

## Evidence

Checked 10/28/2026. Research notes are attached to ASL-1795 (Paperclip) as `research-notes.md` and `research-addendum-fork-inventory.md`. Upstream facts below are pinned to the 6.1.2 tag (`edb0b66d4`); upstream `main` already has tools 6.1.2 lacks.

- **Upstream ships an MCP server.** Per-user OAuth needs 5.2.0 or later; 6.1.0 adds the redirect allowlist we would use for LibreChat. Code: `apps/web/modules/mcp` and `apps/web/app/api/mcp/route.ts` in `formbricks/formbricks`. Docs: `docs/platform/mcp/overview.mdx` and `docs/development/technical-handbook/mcp-server.mdx`.
  - API-key MCP arrived in 5.1.0 (#8144, 06/02/2026).
  - OAuth arrived in 5.2.0 (#8406, 07/02/2026), along with the NextAuth to Better Auth migration (#8384).
  - The DCR redirect allowlist and the `MCP_DCR_ALLOWED_REDIRECT_URIS` env var arrived in 6.1.0 (#9494, 10/06/2026). DCR is open to anonymous clients, and loopback and built-in hosted-client callbacks are accepted whatever the allowlist says (`modules/auth/lib/mcp-oauth-provider-options.ts:70-77`, `mcp-dcr-redirect-policy.ts:55-76,101-103`).
  - Latest release is 6.1.2 (10/27/2026). Survey and response tools have no license check; some other tools do.
  - The handler registers every tool group automatically: surveys, workflows, workspaces, feedback records and responses (`modules/mcp/server.ts:115-122`). Turning on `/api/mcp` exposes all of them to any client that can sign in.
  - 6.1.2 tools: `list_surveys`, `get_survey`, `create_survey`, `validate_survey`, `patch_survey`, `edit_survey_blocks`, `set_survey_block_order`, `delete_survey`; `list_responses`, `count_responses`, `get_response`, `validate_response`, `create_response`, `update_response`, `delete_response`, `batch_delete_responses`; `list_workspaces`, `get_workspace_custom_css`, `patch_workspace_custom_css`; 13 workflow tools; 10 feedback-record tools. Creative (website banner) and dashboard tools exist only on upstream `main`, after 6.1.2.
  - `list_surveys` allows up to 100 per page (`tools/schemas.ts:81-91`). `count_responses` defaults to `precision: "capped"`, a lower bound on large surveys; `"exact"` counts every row (`tools/response-schemas.ts:74-84`).
  - Deletes use a two-round confirmation (MCP elicitation, `request-state.ts`), with a `confirm` argument the model can set itself when the client can't show prompts (`tools/response-schemas.ts:91-102`). The signed request state lasts 5 minutes and isn't stored, so it can't serve as a single-use publish token.
  - Response tools return the v3 shape. List and detail both carry `answers`, `embeddedData` (named hidden fields plus reserved URL and device fields) and `unresolved[].rawValue` (answers to deleted elements). Detail adds raw `data` and `contact` (`apps/web/app/api/v3/responses/lib/serializers.ts:138-159,176-196`; `embedded-data.ts:123-182`; `answers.ts:569-617`).
  - Audit call sites exist, but nothing is recorded unless `AUDIT_LOG_ENABLED=1` (`modules/ee/audit-logs/lib/handler.ts:54-55`, `lib/constants.ts:336`). The sink is `logger.audit`, a log line, not a database record (`modules/ee/audit-logs/lib/service.ts:11-18`).
  - Migrations: 6.1.2 interleaves TypeScript data migrations with SQL ones. The supported runner is `node ./dist/scripts/apply-migrations.js` (`packages/database/package.json:54`, `src/scripts/migration-runner.ts:246-272`). Plain `prisma migrate deploy` skips the TypeScript backfills; for example, the embedded-data backfill must read `Survey.variables` and `hiddenFields` before they are dropped (`migration/20260928120000_eng_2404_backfill_remaining_embedded_data/migration.ts:21-36`).
  - Deleting a response derives a file key from its stored upload URL and deletes it from whatever bucket is configured (fork: `apps/web/lib/response/service.ts:561-581,638-641`, `packages/storage/src/service.ts:227-232`). `PUBLIC_URL` overrides `WEBAPP_URL` for generated links (`apps/web/lib/getPublicUrl.ts:21-22`).
- **Our fork is on 4.9.7.** The merge base with upstream is `322f0be19` (04/12/2026). Upstream `main` is 1,190 commits ahead. The fork has 190 commits of its own, not counting merges.
- **Fork inventory against 6.1.2 (first pass, by keyword search; a zero-hit search doesn't prove upstream lacks a feature):**
  - *Already upstream; take upstream's version:* about 45 security fixes, dependency bumps and backports. The dropdown display option for multiple choice (upstream has `displayType: list | dropdown`).
  - *Port (no upstream equivalent found):* per-survey access control (`surveyAdmin`), survey invitations and reminders, survey schedule window (upstream removed scheduling in 09/2025), contact-info custom fields and address Name/Organization lines, saved option lists, answer piping and prefill, month/year date, tall card and auto-advance, two-column choices, matrix "Other", markdown links in choice labels, custom block names, PDF/DOCX/HTML export, Started/Completed/Duration columns, Snowflake response sync, bulk personal links, follow-up file links, link-survey resume, ASLA-branded emails.
  - *Unresolved:* external API lookup. The fork has an editor test path and a survey-renderer HTTP client (`packages/surveys/src/lib/external-api-client.ts:140-163`, `docs/xm-and-surveys/surveys/advanced/external-api-lookup.mdx`), but no `externalDataSources` column in Prisma. Phase 0.1 finds where its configuration lives and whether it's in use.
  - *Rewrite:* Microsoft 365 sign-in without an EE license, SSO-only hardening, and the proxy JWT gate. These sit on NextAuth; upstream now uses Better Auth, and its own Entra sign-in lives under `ee/` (license-gated).
  - *Database:* 5 fork migrations (invitations, invitation names, survey ACL, schedule window, follow-up file link) plus a `schema.prisma` conflict. Production has been deployed with `prisma db push --accept-data-loss` (`~/dev/azure_vm/docs/apps/formbricks.md`), so its migration history table may not match the files.
- **Trial merge (10/28/2026):** merging fork `main` into the 6.1.2 tag conflicts in 220 files: 64 in `apps/web/modules`, 46 in `apps/web/app`, 34 in `packages/surveys`, 19 in `apps/web/lib`, 11 in `packages/survey-ui`, the rest spread out. About 32 are translation files and about 27 are tests. The Reviewer reproduced the count with `git merge-tree`.
- **The fork has no MCP code.** Its v3 API has only `GET /api/v3/surveys`, and v2 has no survey create. Creating a survey goes through v1 `POST /api/v1/management/surveys`, which accepts `blocks` and defaults status to `draft`. A caller can pass `status: "inProgress"` and publish (`packages/types/surveys/types.ts:4025-4033`, `apps/web/lib/survey/service.ts:634-638`).
- **API keys in the fork belong to the organization, not a person.** Only owners and managers can create them. They never expire. Each key is scoped per environment with read, write or manage permission (`packages/database/schema.prisma:842-886`, `apps/web/modules/organization/settings/api-keys/actions.ts:48-60`). Audit logs record the key, not a user.
- **Rate limit:** 100 requests per minute per key on each API version. Limiting is turned off when Redis is down (`apps/web/modules/core/rate-limit/rate-limit-configs.ts:11-15`).
- **The live chat stack is `~/dev/librechat`, deployed at `/opt/librechat` on nan01** (image `librechat:v0.8.8`, released 10/01/2026). `~/dev/asla_ai` is a January prototype that was never deployed; the issue named it by mistake.
  - LibreChat already runs six MCP servers over streamable HTTP with per-user OAuth (`librechat.yaml:172-266`).
  - Every host must be listed in `mcpSettings.allowedDomains`.
  - The config comment says MCP data may go only to Anthropic and OpenAI models. Models are reached through Ramp Router via the shared LiteLLM gateway, and prompts are redacted from LiteLLM spend logs (`librechat.yaml:105,116-118,144-153`).
- **LibreChat can't show an MCP server's confirmation prompt yet.** MCP elicitation support is an open request (LibreChat-AI/LibreChat#11526), and optional MCP tool-call confirmation is an open PR (#13304), both checked 10/28/2026. On v0.8.8, a server can't prove that a person, rather than the model, said yes.
- **ASLA precedent: the Member Survey MCP** (`membersurvey.aslalabs.org/mcp`) already sends 2026 member survey results to those same models.
- **Data catalog:** `~/dev/asla-metrics/DATA_SOURCES.md:321` lists `formbricks` as medium PII, not integrated, disposition TBD.
- **Member voice:** none gathered yet. This is a staff tool. A pilot with survey owners is in Phase 4 (4.4).

## Goals and success metrics

- Staff can go from "I need a survey about X" to a reviewable Formbricks draft in one chat, and publish it from chat after they say yes.
- Staff can ask questions of a survey's responses in chat and get counts, cross-tabs and open-text themes that match the Formbricks summary page.
- Success metric (decided 10/28/2026): no target for now. Report the number of surveys first drafted through the connector that are later published, over the first 90 days. gcohen sets a target after the pilot.

## Non-goals (v1)

- Members using it. LibreChat is staff-only.
- Pausing, closing, reopening or deleting a published survey from chat, or editing a survey once it's live. Those stay in the Formbricks UI.
- Sending invitations or reminders from chat. Publishing never triggers a send.
- App or website-intercept surveys, targeting, segments, actions, website banners (creatives), custom CSS. v1 covers link surveys only.
- Writing or deleting responses, contacts, webhooks, workflows, dashboards, or feedback records.
- Any MCP client other than ASLA Chat.
- Joining responses to member data (member type, chapter) inside the MCP server. That belongs in the existing Snowflake sync and `asla-metrics` (later phase, not v1).
- Any change to the LLM routing or provider list.

## Requirements

### Must

1. **Per-user identity, ASLA Chat only.** Every call runs as the signed-in ASLA staff member and is limited by their Formbricks role. No shared admin key is ever sent to or stored in LibreChat.
   - Best long-term: upstream OAuth 2.1, with the LibreChat callback `https://chat.aslalabs.org/api/mcp/formbricks/oauth/callback` as the only accepted redirect. An ASLA patch turns off the loopback and built-in hosted-client callbacks and API-key access on `/api/mcp`, so no other MCP client (a desktop app, a script) can reach survey data. If anonymous DCR can't be limited that way, use one admin-registered client for LibreChat and turn DCR off.
   - Fastest: Entra sign-in to the wrapper, using the same pattern as the ms365 connector.
2. **Tool allowlist.** `/api/mcp` exposes only the tools in the "Tools (v1)" table. Every other registered tool (workflow, feedback-record, custom-CSS, response-write tools, and any tool a later upgrade adds, such as creatives) is hidden from `tools/list` and refused if called. The allowlist applies on the server for every client, not only in the LibreChat config.
3. **Drafts by default; publish only after a yes in chat** (decided 10/28/2026).
   - Create a survey only with `status: "draft"`; reject any other status on create.
   - Edit, reorder and delete only surveys still in `draft`. Reject any status change through `patch_survey`. `delete_survey` keeps upstream's two-round confirmation; on LibreChat the model can set `confirm` itself, which is acceptable because only drafts can be deleted.
   - Publishing goes through one path: `prepare_publish`, then `publish_survey`.
     - `prepare_publish` checks the survey (draft, valid, link type, caller has write access) and returns a plain summary (name, question count, estimated minutes, editor and public links) plus a token.
     - The token is stored in the database, single-use, and expires in 10 minutes. It is bound to the user, the OAuth client, the survey and the survey's `updatedAt`, so any edit after `prepare_publish` invalidates it.
     - `publish_survey` takes that token, consumes it atomically, rechecks the caller's permission and the draft state, sets the survey to `inProgress` through the v3 update path with `expectedUpdatedAt` (`apps/web/app/api/v3/surveys/patch.ts:362-375`), and returns the public link. A missing, expired, reused or stale token is rejected. The model can't set a `confirm` flag to skip the step.
     - The tool description and server instructions require the model to show the summary and get an explicit yes before calling `publish_survey`.
     - Publishing never sends invitations or reminders and never starts a schedule window.
   - On LibreChat v0.8.8 the yes is enforced by the model, not proven by the server (see Evidence and Risks). When LibreChat ships MCP elicitation or tool-call confirmation, switch `publish_survey` to it.
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
5. **v1 question types:** `openText`, `multipleChoiceSingle`, `multipleChoiceMulti`, `rating`, `nps`, `matrix`, `ranking`, `consent`, `date`. Other types (`fileUpload`, `cal`, `pictureSelection`, `address`, `contactInfo`, `cta`, and upstream's `csat`/`ces`) are rejected with a message to add them in the editor. `address` and `contactInfo` collect PII, so they stay out on purpose.
6. **One PII-safe response projection** (decided 10/28/2026: answers, including open text, may go to the Anthropic and OpenAI models once PII is removed). Every tool that returns response data (`list_responses`, `get_response`, `summarize_responses` samples) goes through one ASLA output schema built by allowlist. It replaces upstream's v3 output schema for these tools and applies to both the text content and `structuredContent`.
   - Kept: response id, `finished`, `createdAt`, `updatedAt`, `language`, country, and answers to elements whose current type is on the v1 list.
   - Dropped: v3 `data`, `contact`, contact attributes, every `embeddedData` key (named hidden fields and reserved URL, device and identity fields), every `unresolved[].rawValue`, IP address, user agent and URL, and answers to `contactInfo`, `address` and `fileUpload` elements.
   - Answers whose element type can't be established (deleted or renamed elements) are dropped, not passed through.
   - Any field the schema doesn't name is dropped by default, so a later upgrade can't add a new path for PII.
7. **Server-side aggregation for analysis** (`summarize_responses`): per-question counts and percents, NPS score, rating mean and distribution, completion rate, and a cross-tab of any two closed questions. All of it is computed in the server with exact counts, not by paging raw responses into the model.
8. **Bounded payloads.** `list_responses` caps at 50 per page with a cursor (an ASLA cap below upstream's). Open-text sampling caps at 200 answers per call, each truncated to 1,000 characters, and reports the total so the model knows it is sampling.
9. **Connector setup.** The server is opt-in in LibreChat, like `ms365`, and not in every preset. Add its host to `mcpSettings.allowedDomains` and to the comment block that limits MCP data to Anthropic and OpenAI.
10. **Audit, recorded and kept.** `AUDIT_LOG_ENABLED=1` in sandbox and production. Audit lines go to a sink that is kept and searchable, not only to container stdout. Each write records the Formbricks user, OAuth client, tool, survey id and time. Publishes also record the `prepare_publish` token id. Verified with a real MCP write and publish in the deployed configuration.

### Should

11. `count_responses` (with `precision: "exact"` whenever the number is reported) so "how many" never pulls response data.
12. Filters on response tools: `finished`, date range, `language`, and the answer to one closed question.
13. A LibreChat "Survey builder" model spec or Agent that turns on only this connector and carries the interview instructions.

### Could

14. Open-text theme clustering in the server (embeddings via the existing OpenAI embeddings path) instead of model-side theming over samples.
15. Cross-tabs by member type or chapter through the Snowflake sync and `asla-metrics` (needs `DATA_SOURCES.md` disposition first).
16. Upstream PR for the allowlist, draft-only and publish-token guard as operator settings, so the patch drops out of our fork.

## Tools (v1)

These are the only tools `/api/mcp` exposes (Must 2). Names follow upstream 6.1.2 where it has the tool. Contracts are pinned to 6.1.2; recheck them at each upgrade. In the Fastest option, the wrapper implements all of them except `delete_survey` on the fork's v1/v2 API.

| Tool | Input | Output | Source |
| --- | --- | --- | --- |
| `list_workspaces` | none | workspaces the person can access: id, name, role | upstream |
| `list_surveys` | `workspaceId`, optional `filter.status`, `filter.name.contains`, `limit` (≤100, default 20), `cursor` | id, name, status, response count, updatedAt, `nextCursor` | upstream |
| `get_survey` | `surveyId` | blocks, elements (id, type, headline, choices), status, editor URL | upstream |
| `validate_survey` | survey document | ok, or errors by element position | upstream |
| `create_survey_draft` | `workspaceId`, `name`, `blocks[]` (v1 types only), optional `welcomeCard`, `endings`, `languages` | survey id, status `draft`, editor URL | upstream `create_survey` + ASLA guard (draft status and v1 types only) |
| `edit_survey_blocks`, `patch_survey`, `set_survey_block_order` | `surveyId`, changes | updated summary | upstream + ASLA guard (draft surveys only, no status change) |
| `delete_survey` | `surveyId`, `confirm` | deleted | upstream + ASLA guard (draft surveys only) |
| `prepare_publish` | `surveyId` | summary (name, question count, estimated minutes, editor and public links), single-use `publishToken` (10-minute expiry) | ASLA patch (new) |
| `publish_survey` | `publishToken` | survey id, status `inProgress`, public link | ASLA patch (new) |
| `count_responses` | `workspaceId`, `surveyId`, filters, `precision` (`exact` when the number is reported) | count, `relation` | upstream |
| `list_responses` | `workspaceId`, `surveyId`, filters, `limit` (≤50), `cursor` | responses in the Must 6 projection, `nextCursor` | upstream + ASLA projection and cap |
| `get_response` | `responseId` | one response in the Must 6 projection | upstream + ASLA projection |
| `summarize_responses` | `workspaceId`, `surveyId`, optional filters, optional `crossTab: {rowElementId, colElementId}`, optional `openTextElementId` + `sampleSize` (≤200) | per-element stats, NPS, completion rate, cross-tab table, open-text sample with total count | ASLA patch (new) |

That is 15 tools in the Best long-term option. The Fastest wrapper has 14; deleting a draft stays in the Formbricks UI.

Scopes requested by LibreChat: `surveys:read surveys:write responses:read offline_access`. Not requested: `responses:write`, `workflows:*`, `dashboards:*`, `feedbackRecords:*`. `surveys:write` also covers `patch_workspace_custom_css`, so the allowlist (Must 2), not the scope, keeps it out.

## User flows

**Create and publish**
1. The person turns on the Formbricks connector and clicks Connect. The first time, they sign in to Formbricks and approve the scopes.
2. They ask: "Help me write a survey for chapter presidents about the leadership summit."
3. The model interviews them (Must 4), one short round at a time, and picks the workspace with `list_workspaces`.
4. The model shows numbered draft questions with types and choices, and an estimated completion time. The person edits in chat.
5. On "create it," the model calls `validate_survey`, then `create_survey_draft`, and returns the editor link.
6. If the person asks to publish, the model calls `prepare_publish`, shows the summary, and asks "Publish this survey now?" Only on an explicit yes does it call `publish_survey` and return the public link. Distribution (sharing the link, invitations) stays with the person.

**Analyze**
1. "How is the summit survey doing?" The model calls `list_surveys`, then `count_responses` with `precision: "exact"`, then `summarize_responses`.
2. "Break satisfaction down by role." The model calls `summarize_responses` with a `crossTab`.
3. "What are people saying in the open comments?" The model calls `summarize_responses` with `openTextElementId`, themes the sample, and says it is a sample of N out of M.
4. Exact numbers come from the server's aggregation. The model doesn't recount them.

## Data, integrations and hosting

- **Best long-term:**
  - The MCP server runs inside the Formbricks container on nan01 at `https://surveys.asla.org/api/mcp`, over streamable HTTP. There is no new container.
  - Env: correct public `WEBAPP_URL` / `BETTER_AUTH_URL` / `PUBLIC_URL`, `MCP_DCR_ALLOWED_REDIRECT_URIS`, and `AUDIT_LOG_ENABLED=1`.
  - LibreChat sends the OAuth `resource` parameter. Don't copy ms365's `send_resource_parameter: false`, because upstream audience-binds tokens.
  - The publish token needs a new table and migration, applied through the Formbricks migration runner like every other migration.
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
- **Reminders and schedule windows.** `/api/cron/reminders` is not scheduled in the sandbox, and its `CRON_SECRET` differs from production. Schedule-window automation does not run.
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
- The MCP guards (Phase 2) are built and pass here before cutover. LibreChat reaches the sandbox through a temporary opt-in `formbricks-sandbox` connector over the private Docker network. It is removed at cutover.

**Cutover (gcohen's go required):**
- Prerequisites: sandbox sign-off (1.5) and the guard gate (2.6) have both passed.
- Freeze window agreed with survey owners, and a tested restore.
- **Quiesce before the snapshot.** Public survey traffic gets a maintenance page, and the reminder cron, invitation sends and Snowflake sync stop. Then take the backup. Nothing writes to production between the snapshot and the switch.
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
| Upgrading turns on every upstream MCP tool, open DCR, loopback callbacks and API-key access | Unguarded writes, or survey data reaching a client other than ASLA Chat | Tool allowlist and client restriction (Must 1, Must 2); guard gate before cutover; Caddy blocks MCP on production until the guards pass |
| Porting the fork to 6.1.2 is large: 220 conflicted files, ~20 features to carry across, 5 migrations | The upgrade runs long; a feature regresses | Time-boxed Phase 0 with a stop condition and a go/no-go; port feature by feature with tests; Fastest is the fallback |
| Our sign-in (Microsoft without EE, SSO-only, proxy JWT gate) is built on NextAuth; upstream moved to Better Auth | Staff can't sign in after the upgrade | Rewrite as its own Phase 1 issue; verify in the sandbox before cutover |
| Existing surveys store fork-only fields (custom contact fields, month/year dates, auto-advance, schedule window) | Upstream validators reject them and existing surveys break | Phase 0.4 loads every production survey through the 6.1.2 validators |
| Production schema was applied with `db push`, and 6.1.2 needs TypeScript data migrations in order | Migrations fail, or backfills are skipped and data is lost | Formbricks migration runner only; reconcile migration history in 0.4; compare data before and after |
| The v3 response shape carries PII in `embeddedData`, `unresolved`, `data` and `contact` | PII reaches the LLM provider | One allowlist projection for every response tool (Must 6), tested on both text and structured output |
| LibreChat v0.8.8 can't show a server's confirmation prompt | The model could publish without a real yes | Stored single-use publish token bound to user, survey and revision; no self-confirm flag; draft-only for everything else; audit log; switch to client confirmation when LibreChat ships it (#11526, #13304). A wrongly published link survey reaches no one until its link is shared, and can be closed in Formbricks |
| Audit is off unless `AUDIT_LOG_ENABLED=1`, and lines go only to the logger | No record of who published what | Must 10: enable it, ship lines to a kept sink, verify in the deployed configuration |
| LibreChat registers OAuth clients as confidential. Unverified whether Formbricks' anonymous DCR accepts that; asla-metrics did not | Connect fails | Phase 2 spike; fallback is an admin-registered confidential client, as done for asla-metrics |
| Rate limit is per key/user and turns off when Redis is down | Throttling or no limit | Aggregation tool avoids paging; confirm Redis on nan01 is healthy |
| Fork patches to the MCP module conflict with future upgrades | Merge pain later | Keep patches in one module; pin contracts per release; offer the guard upstream (Could 16) |

## Decisions and open questions

Decided by gcohen, 10/28/2026 (round 1):
- **Users:** staff with an existing Formbricks account; their role sets access.
- **Data to the LLM:** yes, with PII removed (Must 6).
- **Publishing:** the agent may publish after the person says yes in chat.
- **Success target:** none for now; report the count.

Decided by gcohen, 10/28/2026 (round 2):
- **Path:** upgrade to 6.1.x, then port our features, in a sandbox first because surveys are in the field. Fastest stays the fallback if Phase 0 is no-go.
- **Publish confirmation:** accept the two-step publish token for v1. The model gets the yes; the server can't prove a person gave it. Switch to client confirmation when LibreChat ships it.

Open, with the assumption this PRD makes:
1. **Production during the port.** *Assume:* security fixes still ship on 4.9; new fork features wait until cutover, or each is built on both branches.
2. **Sandbox data.** *Assume:* a full production copy (it includes response PII) on the same VM, IP-restricted, deleted after cutover. An anonymized copy is safer but can't prove every live survey still opens.
3. **Sandbox access.** *Assume:* the `staging-members` IP allowlist, and Infra Engineer adds the sandbox redirect URI to the Formbricks Entra app.
4. **nan01 capacity and sandbox storage.** *Assume:* nan01 can run a second Formbricks stack, and a second storage bucket costs little. Phase 0.3 checks RAM, disk and the bucket first; if a short-lived VM or new storage spend is needed, that is a separate decision for gcohen.
5. **Cutover timing.** *Assume:* a low-traffic window that survey owners agree to, after gcohen's go. The maintenance page during the window means respondents can't submit for its length.
6. **Phase 0 time-box.** *Assume:* the CEO sets the length when filing 0.2.
7. **Audit log retention.** *Assume:* Infra Engineer picks the sink and uses the retention ASLA applies to other app logs on nan01.
8. **Other MCP clients.** *Assume:* ASLA Chat is the only client (Must 1). Allowing, say, a desktop app would need its own data review.

## Phased breakdown (proposed Repo Worker / Infra issues)

Each is sized for one issue. The CEO files them after gcohen approves. Phases run in order; nothing reaches production until 1.6.

**Phase 0: Assessment (time-boxed go/no-go)**
- 0.1 Finish the fork inventory: confirm each feature is ported, upstreamed or obsolete, and estimate each port. Find where external API lookup is configured and whether it's in use. Flag auth and EE re-implementations. *Repo Worker*
- 0.2 Time-boxed conflict assessment: classify the 220 conflicts, check the toolchain and migration order, and stop when the time-box ends or every conflict has an estimate, whichever comes first. Not a complete merged build; that work goes into the Phase 1 port issues. *Repo Worker*
- 0.3 Stand up the sandbox on nan01 (check RAM, disk and the storage bucket first) and apply every sandbox rule before first boot. Restore the latest production backup into it. Document it in `~/dev/azure_vm/docs/apps/formbricks.md`. *Infra Engineer*
- 0.4 In the sandbox, on a clean upstream 6.1.2 image: reconcile production's migration history, run the Formbricks migration runner, load every survey through the 6.1.2 validators, compare stored data before and after, and list failures. *Repo Worker*
- 0.5 Go/no-go note with an effort estimate. *Repo Worker → CEO → gcohen*

**Phase 1: Upgrade in the sandbox (if go)**
- 1.1 Rewrite Microsoft sign-in, SSO-only hardening and the proxy JWT gate on Better Auth. *Repo Worker*
- 1.2 Merge and port fork features onto 6.1.2, one issue per feature group from 0.1. *Repo Worker*
- 1.3 Five issues, one per open security bead (`fb-bm6-7qz`, `-w14`, `-ud7`, `-7f9`, `-j9q`): fix on the upgrade branch, or confirm upstream fixed it. *Repo Worker*
- 1.4 Cutover runbook: freeze window, quiesce and snapshot, migration runner, validation with sends paused, Caddy block on MCP, reopen, rollback before and after reopening with reconciliation, and a rehearsal in the sandbox. *Infra Engineer*
- 1.5 Sandbox sign-off: every live survey, ported feature and the 1.4 rehearsal checked, and the guard gate (2.6) passed. Then gcohen's go. *Repo Worker → CEO → gcohen*
- 1.6 Cut production over per the runbook. *Infra Engineer*

**Phase 2: ASLA guards (fork patches; built and tested in the sandbox, before 1.5)**
- 2.1 Tool allowlist and MCP client restriction: only the v1 tools, LibreChat callback only, no loopback or hosted-client callbacks, no API-key access on `/api/mcp`; Vitest coverage. *Repo Worker*
- 2.2 Draft-only guard on `create_survey`, `patch_survey`, `edit_survey_blocks`, `set_survey_block_order` and `delete_survey`; v1 type allowlist; Vitest coverage. *Repo Worker*
- 2.3 `prepare_publish` and `publish_survey`: stored single-use token bound to user, client, survey and `updatedAt`, atomic consume, recheck at publish, its migration, no self-confirm path, no sends or schedules; Vitest coverage. *Repo Worker*
- 2.4 The Must 6 projection on `list_responses`, `get_response` and the summarize sample, with Vitest fixtures for embedded URL and identity fields, deleted PII elements, text output and `structuredContent`. *Repo Worker*
- 2.5 Audit: `AUDIT_LOG_ENABLED=1`, a kept sink, and a check that a real MCP write and publish token id reach it. *Infra Engineer*
- 2.6 Guard gate: in the sandbox, through the `formbricks-sandbox` connector, run every guard Done-when item. *Repo Worker*

**Phase 3: Connect production (after 1.6)**
- 3.1 Set `MCP_DCR_ALLOWED_REDIRECT_URIS`, verify `/.well-known` metadata on `surveys.asla.org`, then lift the Caddy block. *Infra Engineer*
- 3.2 Spike (run first in the sandbox, during Phase 2): LibreChat OAuth against Formbricks (DCR first, admin client fallback). *Repo Worker*
- 3.3 Add the `formbricks` entry to `librechat.yaml`: opt-in, scopes as above, allowedDomains, provider-rule comment. *Repo Worker*
- 3.4 Server instructions text for the interview and publish-confirmation flow (Must 3, Must 4). *Repo Worker; Copy Editor review*

**Phase 4: Analysis and pilot**
- 4.1 `summarize_responses` tool: exact stats, NPS, cross-tab, open-text sample through the Must 6 projection. *Repo Worker*
- 4.2 "Survey builder" model spec in LibreChat. *Repo Worker*
- 4.3 Remove the `formbricks-sandbox` connector and tear down the sandbox. *Infra Engineer*
- 4.4 Pilot with survey owners; check the numbers against the Formbricks summary page; collect feedback; report the published-survey count. *Product Strategist*

**Fastest path, if chosen or if Phase 0 is no-go:** F.1 wrapper skeleton with Entra OAuth and a private network; F.2 `list_workspaces`, `list_surveys`, `get_survey`; F.3 `validate_survey`, `create_survey_draft`, and draft editing (`edit_survey_blocks`, `patch_survey`, `set_survey_block_order`) on v1 with guards; F.4 `prepare_publish` and `publish_survey` on v1; F.5 `count_responses`, `list_responses` and `get_response` on v1/v2 with the Must 6 projection; F.6 `summarize_responses`; F.7 LibreChat config. Tasks 3.4, 4.2 and 4.4 carry over unchanged.

## Done when

- [ ] In ASLA Chat, a staff member with a Formbricks role connects with their own Formbricks login. A staff member with no role on a workspace gets an authorization error for it.
- [ ] `tools/list` on `/api/mcp` returns exactly the tools in the "Tools (v1)" table, and calling any other registered tool is refused, for every client.
- [ ] A DCR registration with a loopback or hosted-client callback, and a request to `/api/mcp` with an API key, are both refused.
- [ ] Following the interview, `create_survey_draft` creates a survey whose status is `draft` in Formbricks. Its editor link opens it.
- [ ] Calling create with `status: "inProgress"`, or patching any survey's status, is rejected by the server. Editing or deleting a published survey through MCP is rejected.
- [ ] `publish_survey` succeeds only with a valid token from `prepare_publish` for the same user, client and survey. A missing, expired (over 10 minutes), reused, or stale token (survey edited after `prepare_publish`) is rejected. No tool argument skips the token.
- [ ] Publishing sends no invitation or reminder email and doesn't start a schedule window (verified in the sandbox).
- [ ] With `AUDIT_LOG_ENABLED=1` in the deployed configuration, a real MCP write and a publish both appear in the kept audit sink with the Formbricks user, client, tool, survey id, time and, for the publish, the token id.
- [ ] Creating a survey with an element type outside the v1 list is rejected with a clear message.
- [ ] Neither the text output nor `structuredContent` of `list_responses`, `get_response` or the `summarize_responses` sample contains v3 `data`, `contact`, contact attributes, any `embeddedData` key, any `unresolved[].rawValue`, IP address, user agent, URL, answers to `contactInfo`, `address` or `fileUpload` elements, or answers to deleted elements (Vitest fixtures prove it, including a hidden field named `email` and a deleted `contactInfo` element).
- [ ] For a test survey with 500+ responses, `summarize_responses` counts and NPS match the Formbricks summary page exactly, and no single tool result exceeds 50 responses or 200 open-text answers of at most 1,000 characters each.
- [ ] The `librechat.yaml` change keeps the connector opt-in, lists the host in `allowedDomains`, and updates the provider-rule comment.
- [ ] No Formbricks API key appears in `librechat.yaml`, LibreChat's database, or the transcripts of the test sessions.
- [ ] Before the sandbox first boots, and again after every restore: SMTP goes to a sink, `/api/cron/reminders` is not scheduled, storage uses the sandbox bucket with no production storage credentials, Snowflake access is dev or read-only, webhook and integration rows are deleted, external API lookup (if in use) points at a stub, and `WEBAPP_URL` and `PUBLIC_URL` are the sandbox host or unset. A test invitation reaches no real inbox, and deleting a copied response leaves the production file in place.
- [ ] The sandbox answers only from the allowed IP addresses.
- [ ] In the sandbox, every fork feature on the Phase 0 list works, Microsoft sign-in works, and every in-progress or scheduled production survey opens in the editor and accepts a test response.
- [ ] In the sandbox, the Formbricks migration runner completes on restored production data, and per-survey response counts and sampled answers match before and after.
- [ ] Production stays on 4.9 until gcohen gives the cutover go, and the go comes only after the guard gate (2.6) passes.
- [ ] Until 3.1, `/api/mcp` and the MCP OAuth and DCR endpoints on `surveys.asla.org` return a block from Caddy.
- [ ] After cutover, with sends still paused: every survey that was in progress keeps its ID and public link and accepts a new response, a sent `/c/<token>` link and an encrypted single-use link still open, a link-resume partial response finishes, and historical response counts and sampled answers match the snapshot. After reopening, already-scheduled reminders fire exactly once.
- [ ] The cutover runbook includes the quiesced snapshot, rollback before and after reopening with reconciliation of responses and reminder claims, and a sandbox rehearsal of rollback after a test submission and a simulated send.
