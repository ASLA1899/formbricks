# Audience System Redesign

**Status:** Draft
**Date:** 2026-04-27
**Author:** Greg Cohen (with Claude)
**Beads issue:** TBD (will be created when plan is written)

## Problem

Today, "who gets a survey" is defined in four loosely-coupled places:

1. **Contacts page** — environment-scoped people with key/value attributes.
2. **Segments page** — saved filters over Contact attributes.
3. **Survey audience config** (`invitationConfig.audience`) — per-survey blob holding either a segment reference, a Snowflake query reference, or an inline manual list.
4. **Snowflake query-config JSON** (`/api/member-lookup/query-config.json`) — separate registry of saved Snowflake queries.

These don't compose. Operators can't:

- Reuse a survey's recipient list across multiple surveys (e.g., a quarterly panel).
- Send a follow-up to "people who responded to last month's survey" or "people who didn't" without ad-hoc database work.
- Capture the demographics that came back from a Snowflake query alongside the resulting responses (the columns are dropped at send time; only email + name persist on the lazily-created Contact).
- See "all the saved lists in this environment" in one place.

The user opened the brainstorming with: *"I'm confused how it all works together."* That confusion is the symptom; the four-way scatter is the cause.

## Decisions Locked In During Brainstorming

| # | Question | Answer |
|---|---|---|
| Q1 | Where do recipients come from? | **C** — mix; most are in Snowflake but some live only in Formbricks (volunteers, board, vendors, ad-hoc). |
| Q2 | Identity key across sources? | **B** — email is the practical match key; member number is enrichment when present. |
| Q3 | Snowflake data freshness? | **A** — real-time pull-on-send is the default; segmentation lives upstream in the SQL query. |
| Q4 | Where does segmentation happen? | **C** — mostly Snowflake-SQL, *but* a few "evergreen" lists (e.g., "all active members") get materialized into Formbricks Contacts so they're sliceable in the UI without re-querying. |
| Q5 | What does "reuse a list" mean? | **D + E** — slice a prior survey's invitees by response status (D) **and** maintain reusable, named pools that survive across surveys for multi-survey panels (E). |

The Q3+Q4 combination is the most important: **transient pulls and materialized pools both have to be first-class** — neither one alone covers the workflows.

## Goals

1. **One concept, one place.** "Audience" becomes the single, named, reusable answer to "who gets this survey?" — replacing the scatter across Contacts/Segments/audience-config/Snowflake-config.
2. **All audience kinds compose.** Static lists, Snowflake-backed queries, segments-over-contacts, slices-of-prior-surveys all live in the same library and can all be picked from a single survey audience picker.
3. **Demographic provenance survives.** When an audience source carries demographics (Snowflake query columns, CSV columns), those values are captured on the resulting `SurveyInvitation` rows so analysts can join responses × demographics without back-tracking through Snowflake.
4. **Identity is canonical.** Email is the Contact match key; member number is stored as an attribute when known. Email-based dedupe is enforced at import and send time.
5. **Reuse is cheap.** "Send the next survey to everyone who responded to the last one" is a two-click operation, not a database query.

## Non-Goals (for the work scoped in this spec)

- Real-time bidirectional Snowflake↔Formbricks sync.
- Audience-level ACLs (Phase 4; v1 lets any environment member use any Audience).
- Cross-environment audience sharing.
- Programmatic audience composition (set unions/intersections in the UI).
- Replacement of the existing manual-list textarea / CSV upload UX in the Recipients card. That UX stays; it just optionally saves to an Audience now.

## Architectural Approach

**Approach 1 — first-class `Audience` primitive — chosen.**

Two alternatives were considered and rejected (full reasoning in the brainstorming transcript):

- *Approach 2 — extend `Segment` with new source types.* Stretches a filter-shaped concept into a static-list-shaped one; muddies existing Segment code paths.
- *Approach 3 — no new primitive; layer on top of Segments + add a "previous survey" audience source.* Cheapest short-term, but preserves the four-way scatter rather than fixing it. The user's stated goal is to fix the confusion, not patch around it.

Approach 1 is more upfront work but consolidates the mental model into a single Audience concept, leaves a stable home for future audience kinds (LDAP groups, panel rotations, suppression lists), and matches the industry-standard pattern from Mailchimp/HubSpot/Marketo, which most operators already have a mental model for.

## Key Concepts

```
┌─────────────┐                                   ┌──────────────────┐
│   Contact   │←──────────  membership  ─────────→│     Audience     │
│  (a person) │                                   │  (a saved set    │
└─────────────┘                                   │   of people)     │
       ▲                                          └──────────────────┘
       │ contactId                                          │
       │                                                    │ audienceId
       │                                                    ▼
┌─────────────┐                                   ┌──────────────────┐
│   Response  │←─────  responseId  ───────────────│ SurveyInvitation │
│             │                                   │  (sentAt, etc.   │
└─────────────┘                                   │   + demographics │
                                                  │     snapshot)    │
                                                  └──────────────────┘
                                                            ▲
                                                            │ surveyId
                                                            │
                                                  ┌──────────────────┐
                                                  │      Survey      │
                                                  │   audienceId ────┼──→ Audience
                                                  └──────────────────┘
```

### Contact (existing — minor changes)

- Stays as today: environment-scoped person with key/value attributes.
- **New:** add a unique index on `(environmentId, email-attribute-value)` enforced via the existing email-as-attribute pattern + a partial unique index, OR migrate to a typed `email` column on Contact. Decision deferred to plan-writing — the constraint matters more than the mechanism.
- **New:** member number stored as a standard attribute (key = `memberId`) when known.

### Segment (existing — unchanged)

- Stays as a saved filter over Contact attributes.
- Becomes one *kind* of Audience (`type=segment`); the Segment row remains the canonical filter definition. The Audience is a thin pointer to it with a name and description.

### Audience (NEW)

A named, environment-scoped, reusable definition of "a set of recipients."

```
model Audience {
  id              String         @id @default(cuid())
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  environmentId   String
  name            String         // "Active members - Q1 panel"
  description     String?
  type            AudienceType   // static | snowflakeQuery | segment | surveyDerived
  createdBy       String?

  // Type-specific config — exactly one of these is populated per row:
  staticMemberIds String[]                // type=static (Contact ids)
  snowflakeQueryId String?                // type=snowflakeQuery (refs query-config.json)
  segmentId       String?                 // type=segment
  surveyDerivedConfig Json?               // type=surveyDerived: {sourceSurveyId, status: "all"|"responded"|"notResponded"}

  surveys         Survey[]                // surveys using this audience

  @@index([environmentId])
}

enum AudienceType {
  static
  snowflakeQuery
  segment
  surveyDerived
}
```

A single table with a type discriminator and nullable type-specific columns. Polymorphism via separate child tables is over-engineering for four types.

**Resolution behavior** (centralized in a new `resolveAudience(audienceId)` function — replaces today's per-source logic in `apps/web/modules/survey/invitations/lib/audience.ts`):

| Type | Resolves to | Demographics carry-through |
|---|---|---|
| `static` | The listed Contact ids | Whatever attributes the Contacts already have |
| `snowflakeQuery` | Live query result (transient pull) | Full row payload snapshot per invitation |
| `segment` | Contacts matching the segment filter | Contact attributes |
| `surveyDerived` | Contacts who got `sourceSurveyId` matching the status filter | Whatever demographics were snapshot on the prior `SurveyInvitation` rows |

### SurveyInvitation (existing — extended)

- **New column** `audienceId String?` — provenance, FK to `Audience`. Nullable for backward compatibility with rows created before the migration.
- **New column** `demographicsSnapshot Json?` — captures the full audience-source row payload at send time. Critical for the `snowflakeQuery` audience type, which is the only path that carries fields not already on the Contact.

These two columns make it possible to answer:

- *"Of the people from audience X who got the Q1 survey, what % responded?"* — group-by `audienceId`.
- *"Did Northeast members respond at higher rates than Midwest?"* — join `Response × SurveyInvitation.demographicsSnapshot` in reporting.

### Survey (existing — extended)

- **New column** `audienceId String?` — replaces the `audience` field inside `invitationConfig` JSON.
- `invitationConfig` slims down to email templates + reminder schedule only.
- Migration path: every existing survey with an audience gets one auto-created `Audience` row (named e.g. `"Audience for <survey name>"`); the survey is updated to point at it. Operators can rename later.

## User Flows

### Flow 1 — One-off transient send (most common, current behavior preserved)

1. Operator opens Recipients & Reminders card on a survey.
2. Picks audience: either an existing Audience (dropdown) or "Create new audience inline."
3. If inline: same UX as today (CSV upload / manual emails / pick a Snowflake query). On send, the inline audience is auto-saved as an `Audience` row named `"<survey name> recipients"` so it's reusable later. (No second click required to "save" — saved-by-default keeps the path frictionless.)
4. Send proceeds as today; SurveyInvitations get `audienceId` + `demographicsSnapshot` populated.

### Flow 2 — Panel (multi-survey reuse)

1. Operator goes to **Audiences** page → "New audience from Snowflake query" → picks `active-members-q1` query.
2. Names it "Q1 Member Panel."
3. Survey 1: picks "Q1 Member Panel" as audience. Sends.
4. Survey 2 (a month later): picks "Q1 Member Panel" again. Same recipients. Demographics snapshot at each send so attribute drift over time is traceable.

### Flow 3 — Follow-up to non-responders

1. Operator finishes Survey A. Wants to send a different survey only to people who didn't respond.
2. **Audiences** page → "New audience from previous survey" → picks Survey A → status filter "Did not respond."
3. Names it "Survey A non-responders."
4. Survey B picks that audience. Sends.

### Flow 4 — Evergreen materialized list (Q4-C use case) — **Phase 2**

This flow is the Q4-C answer (segment-in-Formbricks over Snowflake-sourced data) and depends on the Snowflake-to-Contacts materialization import. It is **not** in Phase 1; it's documented here so the Phase 1 schema is designed compatibly.

1. Operator goes to **Audiences** page → "New audience from Snowflake query" → picks `all-active-members` → toggles "Materialize into Contacts."
2. Behind the scenes: Snowflake query runs, results upsert into Contacts (matched by email), all returned columns become attributes (`memberId`, `region`, `tenure`, etc.).
3. The Audience now has type=`segment` (auto-generated segment "All members imported on 2026-04-27" matching the imported `memberId` set).
4. Operator can now build *new* segments in the existing Segments UI ("members in CA with tenure >5 years") and wrap them as new Audiences without touching Snowflake again until refresh time.
5. Refresh = manual "Re-import from source" button on the Audience detail page (Phase 2; v1 ships without refresh — re-import means new audience).

**Phase 1 fallback for this use case:** create a `snowflakeQuery`-type Audience pointing at `all-active-members` and just live with it being a transient pull-on-send (no in-Formbricks slicing). Phase 2 upgrades it to materialized.

## UI Changes

### New: Audiences page

- Lives at `/environments/[envId]/audiences`.
- Lists all Audiences for the environment with: name, type (icon), member count (cached snapshot, refreshed lazily), last used (most recent send), created-by.
- "New audience" button with type picker (static / Snowflake / segment / survey-derived).
- Audience detail page shows config + member preview + surveys-using-this-audience list.

### Existing: Segments page

- Stays as-is for v1. (Segments remain the lower-level filter primitive.)
- A nav-level link from Segments → Audiences ("Wrap this segment as an Audience") to keep the relationship visible.
- Phase 2: consider absorbing Segments into Audiences-as-segment-type if the dual-page UX feels redundant.

### Existing: Recipients & Reminders card on survey edit page

- Audience-source picker (3 options today) collapses to a **single audience dropdown** showing all environment Audiences, plus "Create new inline."
- Inline creation flow keeps the current CSV/manual/Snowflake UX; on first use it auto-saves the inline list as a named Audience.
- The newly-shipped invitee list table (beads-nl9) keeps working — it queries `SurveyInvitation` rows the same way.

### Existing: Contact detail page

- Already shows responses + invitations (beads-nl9).
- **New section:** "Audience memberships" — list of Audiences this contact is in (static lists, materialized segments). Helps answer "why is this person getting so many surveys?"

## Migration Plan

A single Prisma migration:

1. Create `Audience` table + `AudienceType` enum.
2. Add `audienceId` + `demographicsSnapshot` columns to `SurveyInvitation`.
3. Add `audienceId` column to `Survey`.
4. Backfill: for each `Survey` with a non-null `invitationConfig.audience`, create a corresponding `Audience` row and set the survey's `audienceId`.
5. Backfill: for each existing `SurveyInvitation`, set `audienceId` to the survey's new `audienceId` (best effort — doesn't recover demographics, those are forever lost for pre-migration sends).
6. Leave `invitationConfig.audience` in place for two releases as a no-op fallback for safety; remove in a follow-up migration.

Backfill is idempotent and re-runnable — schema-drift-tolerant per the project's existing migration discipline.

## Phased Rollout

This spec covers the full vision. The implementation plan that follows will scope **Phase 1 only** — the rest are sketched here for context and become their own spec/plan cycles when prioritized.

### Phase 1 (this implementation plan)

- `Audience` table + migration (incl. backfill of existing surveys' audience configs).
- `audienceId` + `demographicsSnapshot` on `SurveyInvitation`.
- `audienceId` on `Survey`.
- New audience resolver replacing `apps/web/modules/survey/invitations/lib/audience.ts`'s per-source logic.
- Audiences page (CRUD; list/detail/create flows for all four types).
- Survey audience picker rewrite (single dropdown, inline-create flow).
- Audience memberships section on Contact detail page.

### Phase 2

- Snowflake-to-Contacts materialization import flow (Q4-C use case at full fidelity).
- Audience refresh button + last-refreshed timestamp.
- "Audiences using this contact" reverse lookup on Contact detail.

### Phase 3

- Demographics-aware reporting joins (Response × SurveyInvitation.demographicsSnapshot in the analysis UI).
- Audience overlap detection ("these two audiences share 800 people").

### Phase 4

- Audience-level ACLs (analogous to today's `SurveyAccess` on Survey).
- Scheduled audience refreshes.
- Audience archival and retention rules.

## Open Questions

1. **Email uniqueness on Contact** — currently enforced only by application-level `ensureContact` retry-on-conflict. Should we add a partial unique index (or migrate to a typed `email` column) as part of Phase 1, or defer? *Inclination: do it in Phase 1 — concurrency races already bite us at scale and the migration is small.*
2. **Inline-audience-save naming** — auto-named as `"<survey name> recipients"` is fine, but it'll create a lot of low-value Audiences over time. Should there be a flag `Audience.transient: boolean` to hide auto-created ones from the main list unless promoted? *Inclination: yes, simple and reversible.*
3. **`survey_derived` audience resolution at send time** — when sending Survey B to "non-responders of Survey A," do we resolve at send time (live snapshot) or pin at audience-creation time (frozen list)? *Inclination: resolve at send time. Pinned would require yet another table for the membership snapshot, and the dynamic semantics are what operators actually want.*

## Risks

- **Migration backfill on production data** — existing `invitationConfig.audience` blobs vary in shape (especially the Snowflake-config edge cases). Backfill must handle missing/malformed config gracefully (create no Audience rather than crash; flag for manual review).
- **UX regression on the Recipients card** — the audience picker is the most-touched UI in the survey editor. The dropdown-replaces-three-radio-buttons change needs deliberate before/after testing with the operator (Greg) before rollout.
- **Segment ↔ Audience dual-concept confusion** — keeping both for v1 is the pragmatic choice but risks "do I make a Segment or an Audience?" hesitation. Mitigated by clear copy on each page ("Audiences are how surveys reach people; Segments are filters used inside Audiences").

## Success Criteria

After Phase 1, an operator can:

- ✅ See every saved audience in one place.
- ✅ Send a survey to a saved audience without re-entering recipients.
- ✅ Send a follow-up to non-responders of a prior survey in <30s without writing SQL.
- ✅ Run a multi-survey panel by reusing a single named audience.
- ✅ Look at any past response and see which audience the recipient came from + the demographic snapshot at send time.
- ✅ Look at any contact and see which audiences they're in.
