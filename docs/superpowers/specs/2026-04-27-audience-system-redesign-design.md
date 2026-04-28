# Audience System Redesign

**Status:** Draft
**Date:** 2026-04-27
**Author:** Greg Cohen (with Claude)
**Beads issue:** TBD (will be created when plan is written)

## Problem

Today, "who gets a survey" + the underlying contact data has two compounding problems:

**Problem 1 — the four-way scatter.** Recipient definitions live in four loosely-coupled places:

1. **Contacts page** — environment-scoped people with key/value attributes.
2. **Segments page** — saved filters over Contact attributes.
3. **Survey audience config** (`invitationConfig.audience`) — per-survey blob holding either a segment reference, a Snowflake query reference, or an inline manual list.
4. **Snowflake query-config JSON** (`/api/member-lookup/query-config.json`) — separate registry of saved Snowflake queries.

These don't compose. Operators can't reuse a survey's recipient list across multiple surveys, send a follow-up to "people who responded" without ad-hoc DB work, or see "all the saved lists in this environment" in one place.

**Problem 2 — stale contact data.** Even when an operator picks a Snowflake query as an audience source, the resulting Contacts (lazily created at send time) capture only email + name. Demographics returned by the query are dropped. The Contact never refreshes when the Snowflake row changes. There's no notion of "Formbricks Contacts mirror our actual people" — Formbricks is just a thin opportunistic cache that ages out badly.

The user opened brainstorming with *"I'm confused how it all works together"* and later asked *"how do we keep this list updated? Maybe it's all our snowflake contacts?"* — both questions point at the same architectural gap. **Formbricks needs Snowflake to be the source of truth for contacts, with continuous mirroring — not lazy pulls per send.**

## Decisions Locked In During Brainstorming

| # | Question | Answer |
|---|---|---|
| Q1 | Where do recipients come from? | **C** — mix; most are in Snowflake but some live only in Formbricks (volunteers, board, vendors, ad-hoc). |
| Q2 | Identity key across sources? | **B** — email is the practical match key; member number is enrichment when present. |
| Q3 | Snowflake data freshness? | Originally **A** (real-time pull-on-send). **Revised to continuous Snowflake → Formbricks mirror** after Q7 below — pull-on-send becomes a rare edge case. |
| Q4 | Where does segmentation happen? | **C** — most slicing happens in Formbricks UI against continuously-synced contacts. SQL-driven slicing collapses into "the master sync's source query is itself a Snowflake view." Ad-hoc one-off Snowflake queries remain available as a transient audience source for rare edge cases. |
| Q5 | What does "reuse a list" mean? | **D + E** — slice a prior survey's invitees by response status (D) and maintain reusable, named pools that survive across surveys for multi-survey panels (E). |
| Q6 | Materialized Audience contact-list representation? | **(b)** — the Audience owns a contact-id list directly; user-built filters become Segments only when saved as such. (The "materialized" concept itself collapses into Z below.) |
| Q7 | Sync direction? | **Z** — Snowflake → Formbricks (continuous mirror). Formbricks remains transactional system of record (Postgres OLTP); reverse-ETL of survey responses to Snowflake is a Phase 2 candidate but not part of this design. |
| Q8 | Email uniqueness on Contact? | Phase 1 (typed `email` column with partial unique index, replacing today's email-as-attribute pattern). |
| Q9 | Auto-saved inline audiences? | Yes, with a `transient: boolean` flag to hide them from the main library list. |
| Q10 | `surveyDerived` audience resolution timing? | Resolve at send time (live), not pinned. |

The decisive one is Q7. Q7=Z reframes the whole architecture: instead of layering "fresh-data audiences" on top of a stale contact pool, we make the contact pool itself continuously fresh, and audiences become a thin presentation layer on top.

## Goals

1. **One concept, one place.** "Audience" becomes the single, named, reusable answer to "who gets this survey?"
2. **All audience kinds compose.** Static lists, segments-over-contacts, slices-of-prior-surveys, and (rarely) transient Snowflake queries all live in the same library.
3. **Demographic provenance survives.** SurveyInvitation rows snapshot the audience source's demographics at send time, so analysts can join responses × demographics.
4. **Identity is canonical.** Email is the Contact match key (typed column, unique per environment); member number is stored when known (typed column, unique per environment).
5. **Reuse is cheap.** Re-targeting prior survey's responders / non-responders is a two-click operation.
6. **No-SQL slicing.** Once data is in Formbricks (via sync, CSV, or response capture), operators slice by clicking through demographic filters — no SQL needed for everyday work.
7. **Contact data stays fresh automatically.** Snowflake-sourced contacts mirror Snowflake state continuously without operator intervention; manual-source contacts are independent and protected.

## Non-Goals (for the work scoped in this spec)

- Bidirectional Snowflake↔Formbricks sync. Sync is one-way: Snowflake → Formbricks. (Reverse-ETL of responses is a Phase 2 candidate, not part of this spec.)
- Multiple sync configs per environment. v1 supports one master sync per environment. (Phase 4.)
- Audience-level ACLs. (Phase 4.)
- Cross-environment audience sharing.
- Programmatic audience composition (set unions/intersections in the UI).

## Architectural Approach

The design has **two layers**:

```
┌────────────────────────────────────────────────────────────────┐
│  Audience layer                                                │
│  ─────────────                                                 │
│  - First-class Audience primitive (named, reusable)            │
│  - Types: static, segment, surveyDerived, snowflakeQuery       │
│  - Survey picks an audienceId; resolver hands back contact ids │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ resolves against fresh data
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Contact mirror layer                                          │
│  ────────────────────                                          │
│  - Postgres `Contact` rows are the source of truth at runtime  │
│  - ContactSync mirrors Snowflake into Postgres on a schedule   │
│  - Manual contacts (CSV / hand-entered) coexist, source-tagged │
│  - Segments evaluate against this layer (always fresh)         │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ scheduled background sync
                              ▼
                ┌──────────────────────────┐
                │  Snowflake (source of    │
                │  truth for "who exists") │
                └──────────────────────────┘
```

The bottom layer (Contact mirror) is the architectural pivot from the earlier draft. It addresses Problem 2 directly. Once it exists, the upper layer (Audience) becomes a relatively thin compositional concept.

Two alternatives were considered and rejected during brainstorming (full reasoning preserved in the conversation transcript):

- *Approach 2 — extend `Segment` with new source types.* Stretches a filter-shaped concept into a static-list-shaped one.
- *Approach 3 — no new primitive; layer on top of existing scatter.* Patches around the four-way confusion rather than fixing it.

A third option — *push Formbricks data into Snowflake instead of mirroring out* — was also considered and rejected: Snowflake is OLAP (multi-second latency, usage-priced) and Formbricks is OLTP (sub-100ms transactional reads/writes per response). Wrong tool. The standard OLTP-mirrors-from-OLAP-warehouse pattern is what we're implementing.

## Key Concepts

### Contact (existing — extended)

```prisma
model Contact {
  id              String              @id @default(cuid())
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  environmentId   String
  email           String              // NEW — typed column, replaces email-as-attribute
  externalId      String?             // NEW — member number for source=snowflake; nullable
  source          ContactSource       @default(manual)  // NEW
  inactive        Boolean             @default(false)   // NEW — set by sync when row drops out of source
  inactiveAt      DateTime?           // NEW
  responses       Response[]
  attributes      ContactAttribute[]
  displays        Display[]
  invitations     SurveyInvitation[]

  @@index([environmentId])
  @@index([environmentId, inactive])
  // Partial unique indices applied via raw SQL migration
  // (Prisma doesn't natively express partial-where indices):
  //   UNIQUE (environmentId, email)        WHERE email IS NOT NULL
  //   UNIQUE (environmentId, externalId)   WHERE externalId IS NOT NULL
}

enum ContactSource {
  snowflake
  manual
  csv
}
```

`email` migrates from the email-attribute pattern to a typed column with backfill. `externalId` holds member number (or whatever the canonical Snowflake identity column is). `source` discriminates whether a contact is sync-managed.

### ContactSync + ContactSyncRun (NEW)

Configures and tracks the Snowflake-to-Contacts mirror.

```prisma
model ContactSync {
  id              String              @id @default(cuid())
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  environmentId   String              @unique  // one sync per env in v1
  snowflakeQueryId String                       // refs query-config.json
  columnMapping   Json                          // header→attributeKey + special cases for email/externalId
  intervalMinutes Int                 @default(60)
  enabled         Boolean             @default(true)
  lastRunAt       DateTime?
  lastRunStatus   SyncStatus?
  runs            ContactSyncRun[]
  environment     Environment         @relation(...)
}

model ContactSyncRun {
  id              String              @id @default(cuid())
  syncId          String
  startedAt       DateTime            @default(now())
  finishedAt      DateTime?
  status          SyncStatus
  rowsProcessed   Int                 @default(0)
  rowsCreated     Int                 @default(0)
  rowsUpdated     Int                 @default(0)
  rowsDeactivated Int                 @default(0)
  errorMessage    String?
  sync            ContactSync         @relation(fields: [syncId], references: [id], onDelete: Cascade)

  @@index([syncId, startedAt])
}

enum SyncStatus {
  pending
  running
  succeeded
  failed
}
```

### Sync Algorithm (the heart of the architecture)

Runs on `intervalMinutes` schedule (default hourly) via the existing cron infrastructure used by the email drainer. Idempotent and re-runnable.

1. Mark a new `ContactSyncRun` as `running`.
2. Execute the configured Snowflake query.
3. For each result row:
   - **Match** by (environmentId, externalId) if externalId present in row.
   - **Fallback match** by (environmentId, email) if no externalId match.
   - **No match** → create new Contact with `source=snowflake`.
   - **Match found, source=snowflake** → update mapped attributes; clear `inactive` flag; update typed columns (email/externalId) if changed.
   - **Match found, source=manual or csv** → **do not update** (manual contacts are protected). Log a "would-promote" hint for operator visibility.
4. After processing all rows, find Contacts where `source=snowflake AND externalId NOT IN seen-set` → mark `inactive=true, inactiveAt=now()`. Never delete (response history must be preserved).
5. Update `ContactSyncRun` with summary; set `ContactSync.lastRunAt/lastRunStatus`.
6. On any unhandled error: catch, set status=`failed`, errorMessage, exit cleanly. Next run retries from scratch (idempotent).

**Conflict policy.** Snowflake wins on synced fields for `source=snowflake` contacts. Operators editing those fields in Formbricks UI will see edits overwritten on next sync — the UI displays sync-managed attributes as read-only with a "from Snowflake" badge to make this expectation explicit.

**Manual contacts are never touched by sync.** A separate operator action is required to promote a manual Contact to source=snowflake (Phase 4; out of scope for v1).

### Column Mapping (NEW shared module)

Used by both:
- `ContactSync` configuration (configured once at setup; persisted on the sync row).
- Manual CSV imports (per-upload interactive flow).

**Algorithm:**
1. Normalize source header: lowercase, strip whitespace/underscores/dashes/parens/non-alphanumerics.
2. Compare normalized header against normalized existing `ContactAttributeKey`s in environment.
3. Built-in alias seed (extends today's `recipients-card.tsx` aliases):

| Header variants | Maps to |
|---|---|
| email, e-mail, email_address, emailaddress | `email` (typed column) |
| memberid, member_id, member_number, membernum, customerid | `externalId` (typed column) |
| firstname, first_name, first, givenname, fname | `firstName` attribute |
| lastname, last_name, last, surname, fname | `lastName` attribute |

4. **Exact normalized match** → auto-map (default selection in UI; user can override).
5. **No match** → flag column as "new"; user picks: create new attribute key, map to existing, or skip.

For `ContactSync`: mapping is configured once at sync setup and persisted on `ContactSync.columnMapping`. Future syncs use the same mapping. Operator updates the mapping when source schema changes.

For CSV: mapping is interactive per-upload (modal step). Subsequent uploads remember the last mapping for the same column-set as a default suggestion.

### Segment (existing — UNCHANGED)

Continues to be a saved filter over Contact attributes. **Continuously fresh by virtue of Contacts being continuously fresh.** No code changes; behavioral upgrade comes for free.

By default, Segment evaluation excludes `inactive=true` contacts. A "include inactive contacts" toggle on the segment filter UI handles re-engagement campaigns (rare).

### Audience (NEW)

```prisma
model Audience {
  id                  String          @id @default(cuid())
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  environmentId       String
  name                String
  description         String?
  type                AudienceType
  createdBy           String?
  transient           Boolean         @default(false)  // hide auto-created from main library list
  staticContactIds    String[]                         // type=static
  segmentId           String?                          // type=segment
  surveyDerivedConfig Json?                            // type=surveyDerived: {sourceSurveyId, status}
  snowflakeQueryConfig Json?                           // type=snowflakeQuery: {queryId, columnMapping}
  surveys             Survey[]

  @@index([environmentId])
}

enum AudienceType {
  static          // explicit list of contact ids (e.g., from CSV)
  segment         // wraps a Segment filter; resolves over fresh Contacts
  surveyDerived   // slice of prior survey's invitees by response status
  snowflakeQuery  // transient one-off pull (rare; for queries that aren't the master sync)
}
```

The earlier `materializedSnowflake` type is gone — its use case (evergreen sliceable list) is now served natively by `segment`-type Audiences over the always-fresh Contact mirror.

`snowflakeQuery` type is preserved for the rare case where the master sync doesn't cover a specific slice (e.g., "all donors over $1K in 2025" — a different query that doesn't make sense to wire into the master sync).

### Resolution (replaces today's `apps/web/modules/survey/invitations/lib/audience.ts`)

| Type | Resolves to | Demographics carry-through |
|---|---|---|
| `static` | The listed Contact ids | Whatever attributes the Contacts have at send time (always fresh) |
| `segment` | Contacts matching the segment filter | Contact attributes (always fresh) |
| `surveyDerived` | Contacts who got `sourceSurveyId` matching the status filter | Whatever was snapshot on the prior `SurveyInvitation` rows |
| `snowflakeQuery` | Live query result (transient pull); upserts into Contacts as side-effect | Full row payload snapshot per invitation |

### SurveyInvitation (existing — extended)

Adds:
- `audienceId String?` — provenance, FK to `Audience`.
- `demographicsSnapshot Json?` — captures the audience-source row payload at send time. Important for `snowflakeQuery` audiences (where the row's data may differ from the Contact's stored attributes).

### Survey (existing — extended)

Adds:
- `audienceId String?` — replaces the `audience` field inside `invitationConfig` JSON.
- `invitationConfig` slims down to email templates + reminder schedule only.

## User Flows

### Flow 0 — Initial sync setup (one-time per environment)

1. Operator goes to Settings → **Snowflake Sync**.
2. Picks the master Snowflake query (registered in `query-config.json`) returning all current people: email, externalId, demographics.
3. Column mapping step: confirms how columns map to attribute keys / typed columns; creates new attribute keys for unmatched columns.
4. Picks sync interval (default 60 min). Saves config; first sync runs immediately.
5. Operator confirms by browsing Contacts page — should see synced people with their attributes; sync-managed fields show "from Snowflake" badge.

### Flow 1 — Build a segment from synced contacts and send

1. Sync has run; Contacts have current demographics.
2. Operator: Segments → New segment → "region = NE AND active = true".
3. Audiences → New audience from segment → wraps the segment, names it.
4. Survey: picks the Audience; sends.
5. Each `SurveyInvitation` row gets `audienceId` + `demographicsSnapshot` populated from the matched Contact's current attributes.

### Flow 2 — Multi-survey panel

1. Operator creates an Audience from a Segment ("Active California members").
2. Survey 1 picks it. Sends.
3. Survey 2 (a month later) picks the same Audience. Same recipients (well, current matches — sync may have moved people in or out). Demographics snapshot captures point-in-time state on each invitation row.

### Flow 3 — Follow-up to non-responders of prior survey

1. Audiences → New audience from previous survey → picks Survey A → status filter "Did not respond." Names it.
2. Survey B picks that Audience. Resolves at send time against current `SurveyInvitation` rows for Survey A.

### Flow 4 — Add non-Snowflake contacts via CSV

1. Audiences → New audience from CSV → upload file.
2. Column mapping step (same shared module).
3. Rows upsert as Contacts with `source=manual`. Audience type=`static`, listing those contact ids.
4. Manual contacts are never touched by sync.

### Flow 5 — One-off transient Snowflake send (rare)

For queries not covered by the master sync:
1. Audiences → New audience from Snowflake query → picks query + column mapping. Type=`snowflakeQuery`.
2. On send: query runs, results upsert into Contacts (creates Snowflake-sourced rows if new), demographics snapshot to invitations.
3. Audience persists; can be re-used.

## UI Changes

### New: Settings → Snowflake Sync

- Configure master Snowflake query, column mapping, interval.
- Sync status: last run timestamp, status, rows processed/created/updated/deactivated.
- Run history table (last 20 runs) for diagnostics.
- "Run sync now" button.
- Disable / re-enable toggle.

### New: Audiences page

- Lives at `/environments/[envId]/audiences`.
- Lists all non-transient Audiences with: name, type icon, member count (cached, refreshed lazily), last used, created-by.
- Filter: "Show transient" toggle (default off; reveals auto-created inline audiences).
- "New audience" button with type picker.
- Audience detail page: config + member preview + surveys-using-this-audience.

### Modified: Recipients & Reminders card on survey edit page

- Audience-source picker (3 options today) collapses to a single audience dropdown showing all environment Audiences, plus "Create new inline."
- Inline creation flow keeps the current CSV/manual/Snowflake UX; on first use auto-saves as `transient=true` Audience named `"<survey name> recipients"`. User can promote to permanent (clear transient flag, rename) anytime.
- Invitee list table from beads-nl9 keeps working.

### Modified: Contact detail page

- Source badge: "Synced from Snowflake — last updated 2026-04-27" or "Manually added by Greg on 2026-04-15".
- Sync-managed attributes show with a small "from Snowflake" badge and are read-only.
- Inactive contacts show an "Inactive (removed from source on 2026-04-20)" banner.
- Audience memberships section.

### Modified: Contacts list page

- New filter: source (all / Snowflake / manual / CSV).
- New filter: active / inactive (default active only).

### Existing: Segments page

- Stays as-is. (Segments remain the lower-level filter primitive.) Behavioral upgrade for free: filters now evaluate against fresh data.
- Adds an "Include inactive contacts" toggle to segment filter UI for re-engagement use cases.

## Migration Plan

Three migrations sequenced through Phase 1.

### Migration 1 — Contact schema additions (Phase 1a)

1. Add nullable `email` column to `Contact`.
2. Backfill `email` from existing email attribute (where present).
3. Add `externalId`, `source` (default=manual), `inactive`, `inactiveAt` columns.
4. Set `source=manual` for all existing contacts (default).
5. Apply partial unique indices via raw SQL: `(environmentId, email) WHERE email IS NOT NULL`, `(environmentId, externalId) WHERE externalId IS NOT NULL`.
6. Log contacts with no email attribute for manual cleanup; defer non-null enforcement on `email` until cleanup is complete.

### Migration 2 — ContactSync tables (Phase 1a)

1. Create `ContactSync`, `ContactSyncRun` tables + `SyncStatus` enum.
2. No backfill — operators configure sync on each environment as a deliberate setup step.

### Migration 3 — Audience schema additions (Phase 1b)

1. Create `Audience` table + `AudienceType` enum.
2. Add `audienceId` + `demographicsSnapshot` to `SurveyInvitation`.
3. Add `audienceId` to `Survey`.
4. Backfill: for each Survey with non-null `invitationConfig.audience`, create a corresponding `Audience` row (transient=false, name="Audience for <survey name>") and set the survey's `audienceId`.
5. Backfill: for each existing `SurveyInvitation`, set `audienceId` to the survey's new `audienceId` (best effort; demographics for pre-migration sends are not recoverable).
6. Leave `invitationConfig.audience` in place as a no-op fallback for two releases; remove in a follow-up migration.

All migrations are idempotent and re-runnable per the project's existing migration discipline.

## Phased Rollout

This spec covers the full vision. The implementation plan that follows will scope **Phase 1a + 1b**. Subsequent phases get their own spec/plan cycles when prioritized.

### Phase 1a — Contact mirror (foundation)

Standalone-shippable: delivers no-SQL slicing immediately via the existing Segments UI.

- Migration 1 (Contact schema additions).
- Migration 2 (ContactSync tables).
- Shared Column Mapping module (used by sync + CSV).
- Sync algorithm + cron integration.
- Settings → Snowflake Sync configuration UI.
- Sync status indicator + run history view.
- Contact detail page: source badge + sync-managed attribute markers.
- Contacts list page: source + active filters.
- CSV importer extended to capture arbitrary columns (creates source=manual contacts).

**User-visible value at this point:** contacts auto-update from Snowflake; segments built in the existing Segments UI are always fresh; existing audience picker on surveys still works (just with cleaner data underneath). No new audience concepts yet.

### Phase 1b — Audience primitive (unification)

Builds on 1a; delivers the unified UX.

- Migration 3 (Audience schema additions).
- Audiences page (CRUD; list / detail / create flows for all four types).
- Survey audience picker rewrite (single dropdown, inline-create flow with transient flag).
- Demographics snapshot on `SurveyInvitation` at send time.
- `surveyDerived` audience type + resolver.
- Audience memberships section on Contact detail page.
- Replace `apps/web/modules/survey/invitations/lib/audience.ts` per-source logic with the new resolver.

### Phase 2

- Reverse-ETL: nightly export of `Response` + `SurveyInvitation` to a Snowflake schema for analytics workflows.
- "Audiences using this contact" reverse lookup on Contact detail.
- Audience overlap detection ("these two share 800 people").
- Manual-to-Snowflake promotion action (operator-initiated; converts manual Contact to source=snowflake, starts being sync-managed).

### Phase 3

- Demographics-aware reporting joins (Response × SurveyInvitation.demographicsSnapshot in the analysis UI).
- Audiences-as-Segments-absorbed UI consolidation (if dual-page UX feels redundant in production use).

### Phase 4

- Audience-level ACLs.
- Multiple sync configs per environment (members + donors + staff as separate syncs).
- Scheduled audience refreshes (for `snowflakeQuery`-type Audiences that don't go through the master sync).
- Audience archival and retention rules.

## Open Questions

1. **Sync runner location.** Existing cron in this codebase, or new infra? *Defer to plan-writing — the codebase already runs the email drainer on a `*/5` cron, so the slot exists.*
2. **Initial sync size.** A first sync on 50K+ contacts may take minutes. Do we run synchronously on save, or kick off async with a progress UI? *Inclination: async, with a sync-status indicator that shows "first run in progress." Falls out naturally from the existing cron-driven model.*
3. **Conflict between manual edit and sync overwrite.** UI marks synced fields read-only — is that aggressive enough, or do we need a "manual override" flag per attribute (sync skips that field once overridden)? *Inclination: read-only is enough for v1. Per-attribute override is a Phase 4 nicety.*
4. **What happens to `linkToken` when an inactive contact's email later returns?** Inactive contacts retain their linkTokens; if the same person comes back to Snowflake, they're matched by externalId, marked active again, and their existing linkToken is preserved. Existing invitations remain valid. *No special handling needed; documenting for clarity.*
5. **Sync error alerting.** When a sync fails 3 times in a row, should the system email an operator? *Inclination: yes, but defer specific alerting to plan-writing — could piggyback on the existing email infrastructure.*

## Risks

- **Sync silently corrupting state.** Mitigated by idempotent algorithm (every run is full upsert), robust error capture in `ContactSyncRun`, and partial-unique constraints that guard against accidental duplicates. Worst-case recovery: clear `lastRunAt`, let next sync re-converge.
- **Conflict resolution surprising operators.** Manual edits to Snowflake-sourced fields silently overwritten on next sync. Mitigated by read-only UI markers + "from Snowflake" badge on every synced field. Open question (3) tracks possible Phase 2/4 refinement.
- **Initial sync of large populations slow.** A first sync of 50K+ contacts could take a while. Mitigated by chunked upsert (e.g., 1000 rows at a time), progress visibility, async background execution.
- **Existing contacts with no email attribute.** Migration backfill must handle rows where the email attribute is absent or non-string. Mitigated by logging + manual-cleanup flag; non-null `email` enforcement deferred until cleanup confirmed.
- **Snowflake schema drift breaking sync.** A column rename in Snowflake silently breaks ingest. Mitigated by validating mapped columns against query result on each run; surface "X mapped columns missing in source" as a sync error rather than a silent drop.
- **Phase 1 scope is large.** Splitting into 1a (sync) + 1b (audience UI) lets each ship and stabilize independently; 1a delivers concrete value (no-SQL slicing) on its own.
- **UX regression on the Recipients card audience picker** — most-touched UI in the survey editor. Single-dropdown replacing three radio buttons needs careful before/after testing with the operator before rollout.

## Success Criteria

After **Phase 1a**, an operator can:

- ✅ Configure a Snowflake query as the master contact source.
- ✅ See Contacts auto-update on a schedule.
- ✅ See sync run history + last-run status; trigger manual sync.
- ✅ Build segments over fresh contacts in the existing Segments UI.
- ✅ Send a survey to a segment without writing SQL.
- ✅ Upload a CSV with arbitrary demographic columns and segment over those fields.
- ✅ See "Synced from Snowflake" / "Manually added" provenance on each Contact.

After **Phase 1b**, an operator can additionally:

- ✅ See every saved audience in one place.
- ✅ Send a survey to a saved audience without re-entering recipients.
- ✅ Send a follow-up to non-responders of a prior survey in <30s.
- ✅ Run a multi-survey panel by reusing a single named audience.
- ✅ Look at any past response and see audience + demographic snapshot.
- ✅ Look at any contact and see which audiences they're in.
