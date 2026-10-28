# PRD: Formbricks survey building and response analysis from LibreChat

Status: draft v4, 10/28/2026. gcohen answered rounds 1 and 2. Path decided: upgrade, then port our features, all in a sandbox first because live surveys are in the field. Owner: Product Strategist. Source: ASL-1794 (Paperclip), ASL-1795 (Paperclip).

## Recommendation

**Upgrade our Formbricks fork to upstream 6.1.x in a sandbox, port our features there, and cut production over only after gcohen signs off. Then turn on the MCP server that ships with Formbricks and add four small ASLA patches: a publish-with-confirmation guard, PII stripping on response tools, a server-side `summarize_responses` tool, and a v1 question-type allowlist.** Connect it to ASLA Chat (LibreChat) as an opt-in OAuth connector, the same way Microsoft 365 is connected today. gcohen chose this path on 10/28/2026.

Production (`surveys.asla.org`) stays on 4.9 and keeps serving the surveys in the field until cutover. All upgrade, porting and MCP work happens on a separate sandbox copy (see "Sandbox and cutover").

Why: upstream Formbricks already has what we were going to build. Since 5.2.0 it serves `/api/mcp` over streamable HTTP. Each person signs in with their own Formbricks login (OAuth 2.1), and every call is checked against that person's workspace role. It has about 20 survey and response tools that upstream maintains, and it isn't license-gated. A wrapper on 4.9 gets us there sooner, but it uses org-wide API keys with no per-user identity, and we would throw it away at the next upgrade.

**The upgrade keeps our fork's features, but it costs real work.** Git carries every fork commit forward; nothing is dropped automatically. Each feature has to be carried across and retested, and the sign-in code has to be rewritten. A trial merge of our `main` into 6.1.2 on 10/28/2026 conflicted in 220 files. That makes the upgrade a fork-migration project in its own right. It's worth doing anyway: every upstream security fix currently has to be backported by hand (about 45 of our 190 commits are backports), and the MCP server comes with it. Phase 0 turns the trial merge into an effort estimate and a go/no-go.

| Option | What it is | Pick it when |
| --- | --- | --- |
| **Best long-term (chosen 10/28/2026)** | Upgrade fork to 6.1.x in a sandbox, port ASLA features, cut over, use built-in `/api/mcp` with per-user OAuth, add ASLA guard patches | Phase 0 says the effort is bounded |
| **Fastest (fallback)** | ASLA-built MCP container on nan01 over the fork's existing v1/v2 API. Entra sign-in, API keys held server-side, 8 tools. The fork stays on 4.9 untouched | Phase 0 is no-go. Security backports continue one at a time |
| Other: wrapper now, upgrade later | Build Fastest now; retire it when the upgrade lands | We want the chat feature soon and still plan to upgrade. Costs the wrapper twice over (build, then retire) |
| Other: LibreChat Agent with OpenAPI actions | Point an Agent at the v1/v2 OpenAPI specs | Not recommended. Actions aren't configured in our LibreChat. They would need one shared key in the chat client, and they can't aggregate responses server-side |
| Other: third-party hosted MCP (Vinkius) | Hosted server; each user pastes a personal Formbricks API key | Not recommended. Survey data would pass through a vendor we haven't vetted, and our fork has no personal API keys |

## Problem and who it's for

ASLA staff build surveys in Formbricks (`surveys.asla.org`) by hand and read results in the Formbricks UI or exports. Turning a goal ("find out why chapter leaders skip the leadership summit") into good questions takes time, and so does analyzing open-text answers. Staff already work in ASLA Chat (`chat.aslalabs.org`, LibreChat v0.8.8), which has connectors for Metrics, Member Voices, Member Survey, DAM and Microsoft 365.

Users (decided 10/28/2026): ASLA staff who already have a Formbricks account. Their Formbricks role sets what they can see and change. ASLA Chat accepts only `@asla.org` Entra accounts, and members have no access (`~/dev/librechat/librechat.yaml:11-15`, `README.md:3`). No one is auto-provisioned.

## Evidence

Checked 10/28/2026. Research notes are attached to ASL-1795 (Paperclip) as `research-notes.md`.

- **Upstream ships an MCP server.** Per-user OAuth needs 5.2.0 or later; 6.1.0 adds the redirect allowlist we would use for LibreChat. Code: `apps/web/modules/mcp` and `apps/web/app/api/mcp/route.ts` in `formbricks/formbricks`. Docs: `docs/platform/mcp/overview.mdx` and `docs/development/technical-handbook/mcp-server.mdx`.
  - API-key MCP arrived in 5.1.0 (#8144, 06/02/2026).
  - OAuth arrived in 5.2.0 (#8406, 07/02/2026), along with the NextAuth to Better Auth migration (#8384).
  - The DCR redirect allowlist and the `MCP_DCR_ALLOWED_REDIRECT_URIS` env var arrived in 6.1.0 (#9494, 10/06/2026).
  - Latest release is 6.1.2 (10/27/2026). No license check in `apps/web/modules/mcp`.
  - Deletes use a two-round confirmation (MCP elicitation, `request-state.ts`), with a `confirm` argument the model can set itself when the client can't show prompts (`tools/response-schemas.ts:91-102`).
- **Our fork is on 4.9.7.** The merge base with upstream is `322f0be19` (04/12/2026). Upstream `main` is 1,190 commits ahead. The fork has 190 commits of its own, not counting merges.
- **Fork inventory against 6.1.2 (first pass, by keyword search; a zero-hit search doesn't prove upstream lacks a feature):**
  - *Already upstream; take upstream's version:* about 45 security fixes, dependency bumps and backports. The dropdown display option for multiple choice (upstream has `displayType: list | dropdown`).
  - *Port (no upstream equivalent found):* per-survey access control (`surveyAdmin`), survey invitations and reminders, survey schedule window (upstream removed scheduling in 09/2025), contact-info custom fields and address Name/Organization lines, saved option lists, answer piping and prefill, month/year date, tall card and auto-advance, two-column choices, matrix "Other", markdown links in choice labels, custom block names, PDF/DOCX/HTML export, Started/Completed/Duration columns, Snowflake response sync, bulk personal links, follow-up file links, link-survey resume, ASLA-branded emails.
  - *Rewrite:* Microsoft 365 sign-in without an EE license, SSO-only hardening, and the proxy JWT gate. These sit on NextAuth; upstream now uses Better Auth, and its own Entra sign-in lives under `ee/` (license-gated).
  - *Database:* 5 fork migrations (invitations, invitation names, survey ACL, schedule window, follow-up file link) plus a `schema.prisma` conflict.
- **Trial merge (10/28/2026):** merging fork `main` into the 6.1.2 tag conflicts in 220 files: 64 in `apps/web/modules`, 46 in `apps/web/app`, 34 in `packages/surveys`, 19 in `apps/web/lib`, 11 in `packages/survey-ui`, the rest spread out. About 32 are translation files and about 27 are tests.
- **The fork has no MCP code.** Its v3 API has only `GET /api/v3/surveys`, and v2 has no survey create. Creating a survey goes through v1 `POST /api/v1/management/surveys`, which accepts `blocks` and defaults status to `draft`. A caller can pass `status: "inProgress"` and publish (`packages/types/surveys/types.ts:4026-4033`, `apps/web/lib/survey/service.ts:634-638`).
- **API keys in the fork belong to the organization, not a person.** Only owners and managers can create them. They never expire. Each key is scoped per environment with read, write or manage permission (`packages/database/schema.prisma:842-886`, `apps/web/modules/organization/settings/api-keys/actions.ts:48-60`). Audit logs record the key, not a user.
- **Rate limit:** 100 requests per minute per key on each API version. Limiting is turned off when Redis is down (`apps/web/modules/core/rate-limit/rate-limit-configs.ts:11-15`).
- **The live chat stack is `~/dev/librechat`, deployed at `/opt/librechat` on nan01** (image `librechat:v0.8.8`, released 10/01/2026). `~/dev/asla_ai` is a January prototype that was never deployed; the issue named it by mistake.
  - LibreChat already runs six MCP servers over streamable HTTP with per-user OAuth (`librechat.yaml:172-266`).
  - Every host must be listed in `mcpSettings.allowedDomains`.
  - The config comment says MCP data may go only to Anthropic and OpenAI models. Models are reached through Ramp Router via the shared LiteLLM gateway, and prompts are redacted from LiteLLM spend logs (`librechat.yaml:105,116-118,144-153`).
- **LibreChat can't show an MCP server's confirmation prompt yet.** MCP elicitation support is an open request (LibreChat-AI/LibreChat#11526), and optional MCP tool-call confirmation is an open PR (#13304), both checked 10/28/2026. On v0.8.8, a server can't prove that a person, rather than the model, said yes.
- **ASLA precedent: the Member Survey MCP** (`membersurvey.aslalabs.org/mcp`) already sends 2026 member survey results to those same models.
- **Data catalog:** `~/dev/asla-metrics/DATA_SOURCES.md:321` lists `formbricks` as medium PII, not integrated, disposition TBD.
- **Member voice:** none gathered yet. This is a staff tool. A pilot interview with 3 survey owners is in Phase 4.

## Goals and success metrics

- Staff can go from "I need a survey about X" to a reviewable Formbricks draft in one chat, and publish it from chat after they say yes.
- Staff can ask questions of a survey's responses in chat and get counts, cross-tabs and open-text themes that match the Formbricks summary page.
- Success metric (decided 10/28/2026): no target for now. Report the number of surveys first drafted through the connector that are later published, over the first 90 days. gcohen sets a target after the pilot.

## Non-goals (v1)

- Members using it. LibreChat is staff-only.
- Pausing, closing, reopening or deleting a published survey from chat, or editing a survey once it's live. Those stay in the Formbricks UI.
- Sending invitations or reminders from chat. Publishing never triggers a send.
- App or website-intercept surveys, targeting, segments, actions, website banners (creatives), custom CSS. v1 covers link surveys only.
- Writing or deleting responses, contacts, webhooks, workflows, dashboards, or Unify Feedback records.
- Joining responses to member data (member type, chapter) inside the MCP server. That belongs in the existing Snowflake sync and `asla-metrics` (later phase, not v1).
- Any change to the LLM routing or provider list.

## Requirements

### Must

1. **Per-user identity.** Every call runs as the signed-in ASLA staff member and is limited by their Formbricks role. No shared admin key is ever sent to or stored in LibreChat.
   - Best long-term: upstream OAuth 2.1. The LibreChat callback `https://chat.aslalabs.org/api/mcp/formbricks/oauth/callback` goes in `MCP_DCR_ALLOWED_REDIRECT_URIS`, or we use an admin-registered client.
   - Fastest: Entra sign-in to the wrapper, using the same pattern as the ms365 connector.
2. **Drafts by default; publish only after a yes in chat** (decided 10/28/2026).
   - Create a survey only with `status: "draft"`; reject any other status on create.
   - Edit, reorder (`set_survey_block_order`) and delete only surveys still in `draft`. Reject any status change through patch.
   - Publishing goes through one path: `prepare_publish`, then `publish_survey`.
     - `prepare_publish` checks the survey (draft, valid, link type, caller has write access) and returns a plain summary (name, question count, estimated minutes, editor and public links) plus a single-use token that expires in 10 minutes.
     - `publish_survey` takes that token, sets the survey to `inProgress`, and returns the public link. A missing, expired or reused token is rejected. The model can't set a `confirm` flag to skip the step.
     - The tool description and server instructions require the model to show the summary and get an explicit yes before calling `publish_survey`.
     - Publishing never sends invitations or reminders and never starts a schedule window.
   - On LibreChat v0.8.8 the yes is enforced by the model, not proven by the server (see Evidence and Risks). When LibreChat ships MCP elicitation or tool-call confirmation, switch `publish_survey` to it.
   - Reject or hide the creative tools (`create_creative`, `patch_creative`, `duplicate_creative`, `archive_creative`, `restore_creative`, `delete_creative`) and `patch_workspace_custom_css`. Upstream puts them under `surveys:write`, and a creative set to `inProgress` is a live website banner or feedback button.
   - Enforce all of this on the server, not in the prompt.
3. **Interview first.** The connector's server instructions tell the model to interview the person before drafting:
   - goal and decision the survey informs
   - audience and how they'll get the link
   - length budget (target minutes)
   - must-ask topics
   - anything off-limits
   - language
   - deadline

   After the interview, the model shows the draft questions in chat. It calls `create_survey_draft` only after the person says yes.
4. **v1 question types:** `openText`, `multipleChoiceSingle`, `multipleChoiceMulti`, `rating`, `nps`, `matrix`, `ranking`, `consent`, `date`. Other types (`fileUpload`, `cal`, `pictureSelection`, `address`, `contactInfo`, `cta`, and upstream's `csat`/`ces`) are rejected with a message to add them in the editor. `address` and `contactInfo` collect PII, so they stay out on purpose.
5. **PII stripping on response tools** (decided 10/28/2026: answers, including open text, may go to the Anthropic and OpenAI models once these are removed). Remove these by default:
   - `meta.ipAddress`, `meta.userAgent`, `meta.url`
   - `contactAttributes` and `contact`
   - answers to `contactInfo`, `address` and `fileUpload` elements
   - hidden fields named like `email`, `recordnumber`, `customerid` or `contactid`

   Keep `meta.country` and `language`. Strip the same fields whatever path the data takes.
6. **Server-side aggregation for analysis** (`summarize_responses`): per-question counts and percents, NPS score, rating mean and distribution, completion rate, and a cross-tab of any two closed questions. All of it is computed in the server, not by paging raw responses into the model.
7. **Bounded payloads.** Raw response listing caps at 50 per page with a cursor. Open-text sampling caps at 200 answers per call, each truncated to 1,000 characters, and reports the total so the model knows it is sampling.
8. **Connector setup.** The server is opt-in in LibreChat, like `ms365`, and not in every preset. Add its host to `mcpSettings.allowedDomains` and to the comment block that limits MCP data to Anthropic and OpenAI.
9. **Audit.** Each write logs the Formbricks user, tool, survey id, and time. Publishes also log the `prepare_publish` token id. Upstream logs writes already; the wrapper must add it.

### Should

10. `count_responses` so "how many" never pulls response data.
11. Filters on response tools: `finished`, date range, `language`, and the answer to one closed question.
12. A LibreChat "Survey builder" model spec or Agent that turns on only this connector and carries the interview instructions.

### Could

13. Open-text theme clustering in the server (embeddings via the existing OpenAI embeddings path) instead of model-side theming over samples.
14. Cross-tabs by member type or chapter through the Snowflake sync and `asla-metrics` (needs `DATA_SOURCES.md` disposition first).
15. Upstream PR for the draft-only and publish-token guard as an operator setting, so the patch drops out of our fork.

## Tools (v1)

Names follow upstream where it already has the tool. In the Best long-term option, items marked *upstream* exist today and the rest are ASLA patches. In the Fastest option, the wrapper implements the eight tools on the v1/v2 API.

| Tool | Input | Output | Source |
| --- | --- | --- | --- |
| `list_workspaces` | none | workspaces the person can access: id, name, role | upstream |
| `list_surveys` | `workspaceId`, optional `filter.status`, `filter.name.contains`, `limit` (≤50), `cursor` | id, name, status, response count, updatedAt, `nextCursor` | upstream |
| `get_survey` | `surveyId` | blocks, elements (id, type, headline, choices), status, editor URL | upstream |
| `validate_survey` | survey document | ok, or errors by element position | upstream |
| `create_survey_draft` | `workspaceId`, `name`, `blocks[]` (v1 types only), optional `welcomeCard`, `endings`, `languages` | survey id, status `draft`, editor URL | upstream `create_survey` + ASLA guard (rejects non-draft status and non-v1 types) |
| `edit_survey_blocks` / `patch_survey` / `set_survey_block_order` | `surveyId`, changes | updated summary | upstream + ASLA guard (draft surveys only, no status change) |
| `prepare_publish` | `surveyId` | summary (name, question count, estimated minutes, editor and public links), single-use `publishToken` (10-minute expiry) | ASLA patch (new) |
| `publish_survey` | `publishToken` | survey id, status `inProgress`, public link | ASLA patch (new) |
| `count_responses` | `workspaceId`, `surveyId`, filters | count | upstream |
| `list_responses` | `workspaceId`, `surveyId`, filters, `limit` (≤50), `cursor` | stripped responses (answers keyed by element id, finished, createdAt, language, country), `nextCursor` | upstream + ASLA PII strip |
| `summarize_responses` | `surveyId`, optional filters, optional `crossTab: {rowElementId, colElementId}`, optional `openTextElementId` + `sampleSize` (≤200) | per-element stats, NPS, completion rate, cross-tab table, open-text sample with total count | ASLA patch (new) |

Scopes requested by LibreChat: `surveys:read surveys:write responses:read offline_access`. Not requested: `responses:write`, `workflows:*`, `dashboards:*`, `feedbackRecords:*`. `surveys:write` also covers the creative tools and `patch_workspace_custom_css`, so the ASLA guard (Must 2), not the scope, keeps those out.

## User flows

**Create and publish**
1. The person turns on the Formbricks connector and clicks Connect. The first time, they sign in to Formbricks and approve the scopes.
2. They ask: "Help me write a survey for chapter presidents about the leadership summit."
3. The model interviews them (Must 3), one short round at a time, and picks the workspace with `list_workspaces`.
4. The model shows numbered draft questions with types and choices, and an estimated completion time. The person edits in chat.
5. On "create it," the model calls `validate_survey`, then `create_survey_draft`, and returns the editor link.
6. If the person asks to publish, the model calls `prepare_publish`, shows the summary, and asks "Publish this survey now?" Only on an explicit yes does it call `publish_survey` and return the public link. Distribution (sharing the link, invitations) stays with the person.

**Analyze**
1. "How is the summit survey doing?" The model calls `list_surveys`, then `count_responses`, then `summarize_responses`.
2. "Break satisfaction down by role." The model calls `summarize_responses` with a `crossTab`.
3. "What are people saying in the open comments?" The model calls `summarize_responses` with `openTextElementId`, themes the sample, and says it is a sample of N out of M.
4. Exact numbers come from the server's aggregation. The model doesn't recount them.

## Data, integrations and hosting

- **Best long-term:**
  - The MCP server runs inside the Formbricks container on nan01 at `https://surveys.asla.org/api/mcp`, over streamable HTTP. There is no new container.
  - Env: correct public `WEBAPP_URL` / `BETTER_AUTH_URL`, plus `MCP_DCR_ALLOWED_REDIRECT_URIS`.
  - LibreChat sends the OAuth `resource` parameter. Don't copy ms365's `send_resource_parameter: false`, because upstream audience-binds tokens.
- **Fastest:**
  - A Node MCP container next to LibreChat on nan01, on its own private compose network that only `librechat-api` joins (the `librechat-ms365-mcp` pattern), listed in `mcpSettings.allowedAddresses`.
  - Transport: streamable HTTP. stdio is ruled out because LibreChat runs in Docker and stdio gives no per-user auth.
  - The container holds one Formbricks API key per environment in nan01 secrets (Key Vault, per existing practice). It validates the person's Entra token, maps their email to their Formbricks user and role through a read-only database role, and refuses anyone without a role on the target environment.
- **LLM residency** (decided 10/28/2026): stripped answers, including open text, go to whichever Anthropic or OpenAI model the person picked, through Ramp Router. This matches the current rule for every ASLA MCP server.

## Sandbox and cutover

gcohen's condition (10/28/2026): do the upgrade in a sandbox, because surveys are live. Production is not touched until cutover, and cutover needs his go.

**Sandbox setup** (follows the `staging-members.aslalabs.org` precedent in `~/dev/azure_vm/docs/apps/member-directory.md`):
- Its own compose project on nan01 (for example `/opt/formbricks-staging`), with its own Postgres and Redis. It never shares a database, volume or Redis with production.
- Its own hostname behind Caddy, IP-restricted to the two addresses already allowed for `staging-members`. Working name: `staging-surveys.aslalabs.org`.
- Its own Microsoft sign-in redirect URI on the Formbricks Entra app.
- Data: a restore of the latest production backup, so every real survey can be tested.
- Built from the upgrade branch. Production keeps deploying from `main`.

**Sandbox rules (non-negotiable).** A restored production database carries live side effects. Each one is turned off before the sandbox first boots:
- **Email.** SMTP points at a mail sink that delivers nothing. No invitation, reminder, follow-up or notification email can reach a real person.
- **Reminders and schedule windows.** `/api/cron/reminders` is not scheduled in the sandbox, and its `CRON_SECRET` differs from production. Schedule-window automation does not run.
- **Snowflake.** Member lookup and response sync use a dev schema or a read-only role. The sandbox never writes to production Snowflake tables.
- **Webhooks and integrations.** After restore, webhook rows and stored integration credentials (Slack, Google Sheets, Notion, Airtable and similar) are deleted, so a test response can't reach a production endpoint.
- **Links.** `WEBAPP_URL` is the sandbox hostname, so no sandbox link points at production.
- **Teardown.** The sandbox database is deleted after cutover, or refreshed from a new backup before each round of testing.

**Testing in the sandbox:**
- Every in-progress and scheduled production survey opens in the editor, renders, and accepts a test response.
- Every ported fork feature works (the Phase 0 list).
- Microsoft sign-in and SSO-only mode work.
- The MCP connector (Phases 2 and 3) is built and tested here first. LibreChat reaches the sandbox through a temporary opt-in `formbricks-staging` connector over the private Docker network. It is removed at cutover.

**Cutover (gcohen's go required):**
- Freeze window agreed with survey owners, a fresh backup, and a tested restore.
- Database migrations run with reviewed `prisma migrate deploy`, not `db push --accept-data-loss`.
- Every in-progress survey keeps its ID and public link, keeps accepting responses, and lets a partial response resumed through link resume finish.
- Reminders already scheduled fire once: not skipped, not sent twice.
- Rollback: restore the backup and redeploy the 4.9 image tag recorded before cutover.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| The sandbox runs on a copy of production data with live side effects (email, reminders, Snowflake, webhooks) | Real respondents get test email, or production data changes | Sandbox rules above, checked before first boot (Done when) |
| Cutover breaks a survey in the field | Respondents can't finish; responses are lost | Sandbox test of every live survey; freeze window; backup, tested restore and rollback; gcohen's go |
| Porting the fork to 6.1.x is large: 220 conflicted files, ~20 features to carry across, 5 migrations | The upgrade runs long; a feature regresses | Phase 0 turns the trial merge into a per-feature estimate and a go/no-go; port feature by feature with tests; Fastest is the fallback |
| Our sign-in (Microsoft without EE, SSO-only, proxy JWT gate) is built on NextAuth; upstream moved to Better Auth | Staff can't sign in after the upgrade | Rewrite as its own Phase 1 issue; verify in the sandbox before cutover |
| Existing surveys store fork-only fields (custom contact fields, month/year dates, auto-advance, schedule window) | Upstream validators reject them and existing surveys break | Phase 0 loads every prod survey in the sandbox through the 6.1.2 validators |
| Deploy applies schema with `prisma db push --accept-data-loss` (`~/dev/azure_vm/docs/apps/formbricks.md`) | A major upgrade could drop data | Cutover uses reviewed `prisma migrate deploy` and a tested restore from backup |
| LibreChat v0.8.8 can't show a server's confirmation prompt | The model could publish without a real yes | Two-step publish token; no self-confirm flag; draft-only for everything else; audit log; switch to client confirmation when LibreChat ships it (#11526, #13304). A wrongly published link survey reaches no one until its link is shared, and can be closed in Formbricks |
| LibreChat registers OAuth clients as confidential. Unverified whether Formbricks' anonymous DCR accepts that; asla-metrics did not | Connect fails | Phase 2 spike; fallback is an admin-registered confidential client, as done for asla-metrics |
| Open-text answers contain personal details | PII reaches the LLM provider | Field stripping (Must 5); the provider rule |
| Rate limit is per key/user and turns off when Redis is down | Throttling or no limit | Aggregation tool avoids paging; confirm Redis on nan01 is healthy |
| Fork patches to the MCP module conflict with future upgrades | Merge pain later | Keep patches in one module; offer the guard upstream (Could 15) |

## Decisions and open questions

Decided by gcohen, 10/28/2026 (round 1):
- **Users:** staff with an existing Formbricks account; their role sets access.
- **Data to the LLM:** yes, with the Must 5 fields removed.
- **Publishing:** the agent may publish after the person says yes in chat.
- **Success target:** none for now; report the count.

Decided by gcohen, 10/28/2026 (round 2):
- **Path:** upgrade to 6.1.x, then port our features, in a sandbox first because surveys are in the field. Fastest stays the fallback if Phase 0 is no-go.
- **Publish confirmation:** accept the two-step publish token for v1. The model gets the yes; the server can't prove a person gave it. Switch to client confirmation when LibreChat ships it.

Open, with the assumption this PRD makes:
1. **Production during the port.** *Assume:* security fixes still ship on 4.9; new fork features wait until cutover, or each is built on both branches.
2. **Sandbox data.** *Assume:* a full production copy (it includes response PII) on the same VM, IP-restricted, deleted after cutover. An anonymized copy is safer but can't prove every live survey still opens.
3. **Sandbox access.** *Assume:* the `staging-members` IP allowlist, and Infra Engineer adds the sandbox redirect URI to the Formbricks Entra app.
4. **nan01 capacity.** *Assume:* nan01 can run a second Formbricks stack. Phase 0.3 checks RAM and disk first; if not, a short-lived VM is a separate spend decision for gcohen.
5. **Cutover timing.** *Assume:* a low-traffic window that survey owners agree to, after gcohen's go.

## Phased breakdown (proposed Repo Worker / Infra issues)

Each is sized for one issue. The CEO files them after gcohen approves.

**Phase 0: Upgrade spike (go/no-go)**
- 0.1 Finish the fork inventory started in this PRD: confirm each feature is ported, upstreamed or obsolete, and estimate each port. Flag auth and EE re-implementations. *Repo Worker*
- 0.2 Trial-merge 6.1.2 onto a branch; get it building; list test failures. *Repo Worker*
- 0.3 Stand up the sandbox on nan01 (check RAM and disk first) and apply every sandbox rule before first boot. Restore the latest production backup into it. Document it in `~/dev/azure_vm/docs/apps/formbricks.md`. *Infra Engineer*
- 0.4 In the sandbox, run the upstream and fork migrations, load every survey through the 6.1.2 validators, and list failures. *Repo Worker*
- 0.5 Go/no-go note with an effort estimate. *Repo Worker → CEO → gcohen*

**Phase 1: Upgrade in the sandbox (if go)**
- 1.1 Rewrite Microsoft sign-in, SSO-only hardening and the proxy JWT gate on Better Auth. *Repo Worker*
- 1.2 Port fork features onto 6.1.2, one issue per feature group from 0.1. *Repo Worker*
- 1.3 Close the five open security beads (`fb-bm6-7qz`, `-w14`, `-ud7`, `-7f9`, `-j9q`), or confirm upstream fixed them. *Repo Worker*
- 1.4 Cutover runbook: freeze window, backup and tested restore, `prisma migrate deploy` in place of `db push --accept-data-loss`, rollback to the recorded 4.9 tag, and the in-field survey checks. *Infra Engineer*
- 1.5 Sandbox sign-off: every live survey and ported feature checked. Then gcohen's go. *Repo Worker → CEO → gcohen*
- 1.6 Cut production over per the runbook and run the in-field survey checks. *Infra Engineer*

**Phase 2: Connect** (sandbox first through the temporary `formbricks-staging` connector, then production after cutover)
- 2.1 Set `MCP_DCR_ALLOWED_REDIRECT_URIS` and verify `/.well-known` metadata on `surveys.asla.org`. *Infra Engineer*
- 2.2 Spike: LibreChat OAuth against Formbricks (DCR first, admin client fallback). *Repo Worker*
- 2.3 Add the `formbricks` entry to `librechat.yaml`: opt-in, scopes as above, allowedDomains, provider-rule comment. *Repo Worker*

**Phase 3: ASLA guards (fork patches; built and tested in the sandbox)**
- 3.1 Draft-only guard on create, patch, edit-blocks, block-order and delete; block the creative and custom-CSS tools; v1 type allowlist; Vitest coverage. *Repo Worker*
- 3.2 `prepare_publish` and `publish_survey` with single-use, 10-minute tokens; no self-confirm path; publish never triggers invitations or schedules; Vitest coverage. *Repo Worker*
- 3.3 PII stripping on `list_responses` and `get_response`, with Vitest coverage. *Repo Worker*
- 3.4 Server instructions text for the interview and publish-confirmation flow (Must 2, Must 3). *Repo Worker; Copy Editor review*

**Phase 4: Analysis and pilot**
- 4.1 `summarize_responses` tool: stats, NPS, cross-tab, open-text sample. *Repo Worker*
- 4.2 "Survey builder" model spec in LibreChat. *Repo Worker*
- 4.3 Pilot with 3 survey owners; check the numbers against the Formbricks summary page; collect feedback; report the published-survey count. *Product Strategist*

**Fastest path, if chosen or if Phase 0 is no-go:** F.1 wrapper skeleton with Entra OAuth and a private network; F.2 `list_workspaces`, `list_surveys`, `get_survey`; F.3 `create_survey_draft` on v1 with guards; F.4 `prepare_publish` and `publish_survey` on v1; F.5 `list_responses` and `count_responses` on v2 with stripping; F.6 `summarize_responses`; F.7 LibreChat config. Tasks 3.4, 4.2 and 4.3 carry over unchanged.

## Done when

- [ ] In ASLA Chat, a staff member with a Formbricks role connects with their own Formbricks login. A staff member with no role on a workspace gets an authorization error for it.
- [ ] Following the interview, `create_survey_draft` creates a survey whose status is `draft` in Formbricks. Its editor link opens it.
- [ ] Calling create with `status: "inProgress"`, or patching any survey's status, is rejected by the server. Editing or deleting a published survey through MCP is rejected.
- [ ] `publish_survey` succeeds only with a valid token from `prepare_publish` for the same survey and user. A missing, expired (over 10 minutes) or reused token is rejected. No tool argument skips the token.
- [ ] Publishing sends no invitation or reminder email and doesn't start a schedule window (verified on staging).
- [ ] Every publish appears in the audit log with the Formbricks user, survey id, time and token id.
- [ ] Creating a survey with an element type outside the v1 list is rejected with a clear message.
- [ ] Every creative tool and `patch_workspace_custom_css` is rejected or absent for the ASLA Chat connector.
- [ ] `list_responses` and `get_response` output contain no `meta.ipAddress`, `meta.userAgent`, `meta.url`, `contactAttributes`, or contactInfo/address/fileUpload answers (Vitest fixtures prove it).
- [ ] For a test survey with 500+ responses, `summarize_responses` counts and NPS match the Formbricks summary page exactly, and no single tool result exceeds 50 responses or 200 open-text answers.
- [ ] The `librechat.yaml` change keeps the connector opt-in, lists the host in `allowedDomains`, and updates the provider-rule comment.
- [ ] No Formbricks API key appears in `librechat.yaml`, LibreChat's database, or any chat transcript.
- [ ] Before the sandbox first boots: SMTP goes to a sink, `/api/cron/reminders` is not scheduled, Snowflake access is dev or read-only, webhook and integration rows are deleted, and `WEBAPP_URL` is the sandbox host. A test invitation sent in the sandbox reaches no real inbox.
- [ ] The sandbox answers only from the allowed IP addresses.
- [ ] In the sandbox, every fork feature on the Phase 0 list works, Microsoft sign-in works, and every in-progress or scheduled production survey opens in the editor and accepts a test response.
- [ ] Production stays on 4.9 until gcohen gives the cutover go.
- [ ] After cutover, every survey that was in progress keeps its ID and public link and accepts a new response, a link-resume partial response finishes, and already-scheduled reminders fire exactly once.
- [ ] The cutover runbook includes a restore tested in the sandbox and a rollback to the recorded 4.9 image tag.

