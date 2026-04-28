import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { type TSurveyInvitationConfig, ZSurveyInvitationConfig } from "@formbricks/types/surveys/types";
import { EMAIL_SEND_CHUNK_SIZE, EMAIL_SEND_THROTTLE_MS } from "@/lib/constants";
import { getOrganizationByEnvironmentId } from "@/lib/organization/service";
import { getContactSurveyLink } from "@/modules/ee/contacts/lib/contact-survey-link";
import { sendSurveyInvitationEmail } from "@/modules/email";
import type { TContactInvitationRow, TInvitationRow, TInvitationSummary } from "../types/invitation";
import { type TAudienceMember, resolveAudience } from "./audience";
import { sleep } from "./send-queue";
import { renderSubject, renderTemplate } from "./template";

const DEFAULT_ATTRIBUTE_KEYS = ["email", "firstName", "lastName"] as const;

// Find-or-create a Contact row keyed on (environmentId, email).
//
// Lookup order:
//   1. Typed Contact.email column (post-Phase-1a, partial-unique indexed at
//      the DB layer — but Prisma can't express WHERE clauses on indexes, so
//      we use findFirst rather than findUnique).
//   2. Email-attribute fallback (catches legacy rows from before Phase 1a).
//      If matched here, backfill the typed column.
//   3. Create new Contact with both typed email AND email-attribute, plus
//      whatever extra attributes / externalId / source the caller supplied.
//
// We keep the email-attribute write so segments built on `attribute.email`
// continue to work without a Segment-side migration.
//
// Concurrency guard: on P2002 (raised by the partial-unique index when two
// writers race) we re-query the typed column and return the winner's id.
//
// Phase 1a Task 10: extra `attributes` (CSV-mapped to ContactAttributeKey ids)
// and `externalId` are written on CREATE only — we don't update existing
// Contacts here (the operator-attribute-update path is separate). `source`
// defaults to "manual"; on existing-contact match, the stored source is
// preserved (the Snowflake sync runner is the only path that converts a
// match into source="snowflake", and only for its own ingest).
export async function ensureContact(
  environmentId: string,
  email: string,
  firstName: string | null,
  lastName: string | null,
  options?: {
    externalId?: string;
    attributes?: { attributeKeyId: string; value: string }[];
    source?: "manual" | "csv" | "snowflake";
  }
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const source = options?.source ?? "manual";

  // Step 1: typed-column match.
  const byEmail = await prisma.contact.findFirst({
    where: { environmentId, email: normalizedEmail },
    select: { id: true },
  });
  if (byEmail) return byEmail.id;

  // Step 2: legacy email-attribute fallback. Backfills typed column on hit so
  // future lookups take the fast path above.
  const byAttribute = await prisma.contact.findFirst({
    where: {
      environmentId,
      email: null,
      attributes: { some: { attributeKey: { key: "email" }, value: normalizedEmail } },
    },
    select: { id: true },
  });
  if (byAttribute) {
    await prisma.contact.update({
      where: { id: byAttribute.id },
      data: { email: normalizedEmail },
    });
    return byAttribute.id;
  }

  // Step 3: create.
  const keys = await prisma.contactAttributeKey.findMany({
    where: { environmentId, key: { in: [...DEFAULT_ATTRIBUTE_KEYS] } },
    select: { id: true, key: true },
  });
  const keyByName = new Map(keys.map((k) => [k.key, k.id]));

  const createAttributes: { attributeKeyId: string; value: string }[] = [];
  const emailKeyId = keyByName.get("email");
  if (emailKeyId) createAttributes.push({ attributeKeyId: emailKeyId, value: normalizedEmail });
  const firstNameKeyId = keyByName.get("firstName");
  if (firstNameKeyId && firstName)
    createAttributes.push({ attributeKeyId: firstNameKeyId, value: firstName });
  const lastNameKeyId = keyByName.get("lastName");
  if (lastNameKeyId && lastName) createAttributes.push({ attributeKeyId: lastNameKeyId, value: lastName });

  // Append CSV-mapped attributes. Dedupe by attributeKeyId — if the caller
  // already passed firstName as both a typed param AND in attributes, the
  // first occurrence wins (we don't want Prisma's `create` array to violate
  // the (contactId, attributeKeyId) unique constraint).
  if (options?.attributes && options.attributes.length > 0) {
    const seen = new Set(createAttributes.map((a) => a.attributeKeyId));
    for (const attr of options.attributes) {
      if (seen.has(attr.attributeKeyId)) continue;
      seen.add(attr.attributeKeyId);
      createAttributes.push(attr);
    }
  }

  try {
    const created = await prisma.contact.create({
      data: {
        environmentId,
        email: normalizedEmail,
        source,
        ...(options?.externalId ? { externalId: options.externalId } : {}),
        attributes: { create: createAttributes },
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // P2002 = unique constraint violation. Another concurrent writer raced us
    // and inserted the same (environmentId, email) first; re-query the typed
    // column and return their id.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.contact.findFirst({
        where: { environmentId, email: normalizedEmail },
        select: { id: true },
      });
      if (retry) return retry.id;
    }
    throw error;
  }
}

// Find-or-create SurveyInvitation row. Idempotent on (surveyId, recipientEmail).
// Token generation is skipped for already-sent invitations to avoid N extra
// survey fetches per audience member on re-runs. Callers that specifically need
// a fresh token (e.g. reminder sends) pass `refreshToken: true`.
export async function upsertInvitation(args: {
  surveyId: string;
  member: TAudienceMember;
  environmentId: string;
  refreshToken?: boolean;
}): Promise<{ id: string; contactId: string | null; linkToken: string; created: boolean }> {
  const { surveyId, member, environmentId, refreshToken = false } = args;

  // Check idempotency first. For an already-sent invitation we can return the
  // stored token (or regenerate only if the caller explicitly asked to refresh),
  // avoiding the ~3 DB queries that a token regeneration requires.
  const existing = await prisma.surveyInvitation.findUnique({
    where: { surveyId_recipientEmail: { surveyId, recipientEmail: member.email } },
    select: { id: true, contactId: true, linkToken: true, sentAt: true },
  });

  if (existing && existing.sentAt && !refreshToken) {
    // Happy path on re-run: already sent, no need to rotate token or touch Contact.
    return {
      id: existing.id,
      contactId: existing.contactId,
      linkToken: existing.linkToken,
      created: false,
    };
  }

  // Either creating fresh, resuming an un-sent invitation, or explicit refresh:
  // resolve Contact (create for Snowflake / manual-list audiences) and generate a fresh link.
  const contactId =
    member.existingContactId ??
    (await ensureContact(environmentId, member.email, member.firstName, member.lastName, {
      externalId: member.externalId,
      attributes: member.attributes,
      source: member.source,
    }));

  const linkResult = await getContactSurveyLink(contactId, surveyId);
  if (!linkResult.ok) {
    throw new Error(`getContactSurveyLink failed: ${linkResult.error.type}`);
  }
  const linkToken = linkResult.data;

  if (existing) {
    await prisma.surveyInvitation.update({
      where: { id: existing.id },
      data: {
        linkToken,
        contactId,
        recipientName: member.name,
        recipientFirstName: member.firstName,
        recipientLastName: member.lastName,
      },
    });
    return { id: existing.id, contactId, linkToken, created: false };
  }

  const created = await prisma.surveyInvitation.create({
    data: {
      surveyId,
      contactId,
      recipientEmail: member.email,
      recipientName: member.name,
      recipientFirstName: member.firstName,
      recipientLastName: member.lastName,
      linkToken,
    },
    select: { id: true },
  });
  return { id: created.id, contactId, linkToken, created: true };
}

// Resolves the configured audience and upserts SurveyInvitation rows with
// `sentAt: null`. Does NOT send any emails — the drainer (`runPendingInvitationSends`)
// picks up unsent rows on its own throttle. Returns the number of rows newly
// queued vs already sent so the UI can give the user a useful summary.
//
// Decoupling enqueue from send means: (a) the user's "Send invitations" click
// returns instantly even for 1000-recipient audiences, and (b) the same
// throttle/rate-limit logic governs both manual sends and scheduled reminders.
export async function enqueueInvitationsForSurvey(args: {
  surveyId: string;
  environmentId: string;
  config: TSurveyInvitationConfig;
}): Promise<{ enqueued: number; alreadySent: number }> {
  const { surveyId, environmentId, config } = args;

  const members = await resolveAudience(config.audience);
  if (members.length === 0) {
    logger.warn({ surveyId }, "No audience members resolved for invitation enqueue");
    return { enqueued: 0, alreadySent: 0 };
  }

  let enqueued = 0;
  let alreadySent = 0;

  for (const member of members) {
    try {
      const existing = await prisma.surveyInvitation.findUnique({
        where: { surveyId_recipientEmail: { surveyId, recipientEmail: member.email } },
        select: { sentAt: true, respondedAt: true },
      });
      if (existing?.sentAt || existing?.respondedAt) {
        alreadySent++;
        continue;
      }

      // Either creates a new row or refreshes a previously-created-but-unsent
      // one — both count as enqueued for the user-facing summary.
      await upsertInvitation({ surveyId, member, environmentId });
      enqueued++;
    } catch (error) {
      logger.error({ error, email: member.email, surveyId }, "Invitation enqueue failed");
    }
  }

  return { enqueued, alreadySent };
}

// Atomically claim a single SurveyInvitation row by setting sentAt = NOW() iff
// it is currently null. Returns true if this caller won the claim (and is now
// responsible for sending), false if another worker claimed it first.
//
// We use a tentative claim (mark sent before send, roll back on failure) rather
// than a separate "claimedAt" column so we don't need a schema migration. The
// trade-off: a process crash between claim and SMTP success leaves the row
// marked sent without an email being delivered — the recipient is silently
// missed. The inverse design (mark sent after SMTP) risks double-sends on
// crash, which is worse for recipients. Missed sends can be recovered by
// manually clearing sentAt if needed.
async function claimInvitationForSend(invitationId: string): Promise<boolean> {
  const claimed = await prisma.$executeRaw<number>`
    UPDATE "SurveyInvitation"
    SET "sentAt" = NOW(), "updated_at" = NOW()
    WHERE id = ${invitationId} AND "sentAt" IS NULL
  `;
  return claimed > 0;
}

// Drains pending SurveyInvitation rows (sentAt IS NULL) up to a chunk cap,
// throttling between sends to stay under SMTP-provider rate limits. Optionally
// scoped to a single surveyId — the user-triggered fire-and-forget path uses
// this to drain only the survey just enqueued; the cron path drains globally.
//
// Idempotent and safe to run concurrently with itself: each row is claimed
// atomically before the SMTP call. Designed to be invoked both from the
// post-enqueue fire-and-forget hook (so users see emails go out immediately
// rather than waiting for the next cron tick) and from the periodic cron.
export async function runPendingInvitationSends(args: {
  surveyId?: string;
  chunkSize?: number;
  throttleMs?: number;
}): Promise<{ sent: number; failed: number; remaining: number }> {
  const { surveyId, chunkSize = EMAIL_SEND_CHUNK_SIZE, throttleMs = EMAIL_SEND_THROTTLE_MS } = args;

  const pendingRows = await prisma.surveyInvitation.findMany({
    where: {
      sentAt: null,
      respondedAt: null,
      ...(surveyId ? { surveyId } : {}),
    },
    select: {
      id: true,
      surveyId: true,
      recipientEmail: true,
      recipientName: true,
      recipientFirstName: true,
      recipientLastName: true,
      contactId: true,
      linkToken: true,
    },
    orderBy: { createdAt: "asc" },
    take: chunkSize,
  });

  if (pendingRows.length === 0) {
    return { sent: 0, failed: 0, remaining: 0 };
  }

  // Group by surveyId so we look up survey + config + org name once per survey
  // rather than once per recipient.
  const bySurvey = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const list = bySurvey.get(row.surveyId);
    if (list) list.push(row);
    else bySurvey.set(row.surveyId, [row]);
  }

  let sent = 0;
  let failed = 0;

  for (const [sId, rows] of bySurvey.entries()) {
    const survey = await prisma.survey.findUnique({
      where: { id: sId },
      select: { id: true, name: true, environmentId: true, invitationConfig: true },
    });
    if (!survey) {
      logger.warn({ surveyId: sId, count: rows.length }, "Survey vanished while draining invitations");
      continue;
    }

    const parsed = ZSurveyInvitationConfig.safeParse(survey.invitationConfig);
    if (!parsed.success) {
      logger.warn(
        { surveyId: sId, count: rows.length },
        "invitationConfig invalid/missing during drain — skipping"
      );
      continue;
    }
    const config = parsed.data;

    const org = await getOrganizationByEnvironmentId(survey.environmentId);
    const organizationName = org?.name ?? "";

    for (const inv of rows) {
      // Atomic claim. If another drainer beat us here, claimed === false and we
      // skip silently — no log spam.
      const claimed = await claimInvitationForSend(inv.id);
      if (!claimed) continue;

      try {
        let surveyLink = inv.linkToken;
        if (inv.contactId) {
          const fresh = await getContactSurveyLink(inv.contactId, survey.id);
          if (fresh.ok) surveyLink = fresh.data;
        }

        const vars = {
          recipientName: inv.recipientName ?? "",
          recipientFirstName: inv.recipientFirstName ?? "",
          recipientLastName: inv.recipientLastName ?? "",
          recipientEmail: inv.recipientEmail,
          surveyName: survey.name,
          surveyLink,
          organizationName,
        };
        const subject = renderSubject(config.emailTemplates.invitation.subject, vars);
        const body = renderTemplate(config.emailTemplates.invitation.body, vars);

        await sendSurveyInvitationEmail({
          to: inv.recipientEmail,
          subject,
          body,
          surveyLink,
        });
        sent++;
      } catch (error) {
        // Roll back the claim so the next drainer tick retries this row. Any
        // permanent failure (bad address, etc.) will keep cycling — acceptable
        // for the current scale; can be capped with a sendAttempts column later.
        logger.error(
          { error, invitationId: inv.id, surveyId: sId },
          "Invitation send failed; rolling back claim"
        );
        try {
          await prisma.surveyInvitation.update({
            where: { id: inv.id },
            data: { sentAt: null },
          });
        } catch (rollbackError) {
          logger.error(
            { rollbackError, invitationId: inv.id },
            "Failed to roll back sentAt after send failure"
          );
        }
        failed++;
      }

      await sleep(throttleMs);
    }
  }

  // Approximate `remaining` — anything still unsent for the same scope.
  const remaining = await prisma.surveyInvitation.count({
    where: {
      sentAt: null,
      respondedAt: null,
      ...(surveyId ? { surveyId } : {}),
    },
  });

  return { sent, failed, remaining };
}

// Called from the pipeline when a response finishes — marks the matching
// invitation (if any) as responded so reminders won't target the person again.
// Primary match is by contactId (set by the /c/<token> flow). If contactId is
// null but the survey has outstanding invitations, we attempt a best-effort
// fallback match by email taken from the verified-email response metadata.
// This covers the edge case where ENCRYPTION_KEY rotates between invitation
// send and response submission, invalidating the token and leaving contactId
// null on the response.
export async function linkResponseToInvitation(responseId: string): Promise<void> {
  const response = await prisma.response.findUnique({
    where: { id: responseId },
    select: {
      id: true,
      surveyId: true,
      contactId: true,
      contactAttributes: true,
    },
  });
  if (!response) return;

  let invitation = response.contactId
    ? await prisma.surveyInvitation.findFirst({
        where: {
          surveyId: response.surveyId,
          contactId: response.contactId,
          respondedAt: null,
        },
        select: { id: true },
      })
    : null;

  // Fallback: if no contactId match, try matching by email from contactAttributes
  // (populated by the verify-email flow) or a `verifiedEmail` meta key. This is
  // best-effort — we only fall back when pending invitations actually exist for
  // this survey, to keep the lookup narrow.
  if (!invitation && !response.contactId) {
    const pendingCount = await prisma.surveyInvitation.count({
      where: { surveyId: response.surveyId, respondedAt: null, sentAt: { not: null } },
    });
    if (pendingCount === 0) return;

    const attrs = (response.contactAttributes ?? {}) as Record<string, unknown>;
    const rawEmail = attrs.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : undefined;

    if (!email) {
      logger.warn(
        { responseId, surveyId: response.surveyId, pendingCount },
        "Response has no contactId and no identifying email — invitation linking skipped; reminders may continue to target this respondent"
      );
      return;
    }

    invitation = await prisma.surveyInvitation.findUnique({
      where: { surveyId_recipientEmail: { surveyId: response.surveyId, recipientEmail: email } },
      select: { id: true },
    });
  }

  if (!invitation) return;

  await prisma.surveyInvitation.update({
    where: { id: invitation.id },
    data: { respondedAt: new Date(), responseId: response.id },
  });
}

// Lists SurveyInvitation rows by surveyId or contactId. Caller MUST have already
// authorized the predicate (this function is a thin DB query — auth lives in
// the action layer or the server-component page that owns the predicate).
// Returns rows with Date fields serialized to ISO strings so they can cross
// the server-action boundary without further plumbing.
export async function listInvitations(predicate: {
  surveyId?: string;
  contactId?: string;
}): Promise<TContactInvitationRow[]> {
  const { surveyId, contactId } = predicate;
  if (!surveyId && !contactId) return [];

  const rows = await prisma.surveyInvitation.findMany({
    where: {
      ...(surveyId ? { surveyId } : {}),
      ...(contactId ? { contactId } : {}),
    },
    select: {
      id: true,
      surveyId: true,
      survey: { select: { name: true } },
      recipientEmail: true,
      recipientName: true,
      contactId: true,
      sentAt: true,
      respondedAt: true,
      lastReminderAt: true,
      reminderCount: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    surveyId: row.surveyId,
    surveyName: row.survey.name,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    contactId: row.contactId,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    lastReminderAt: row.lastReminderAt ? row.lastReminderAt.toISOString() : null,
    reminderCount: row.reminderCount,
  }));
}

// Survey-side view doesn't need the survey identity columns (the surveyId is
// the predicate). Strip them so the type matches the existing TInvitationRow
// scaffold.
export async function listInvitationsBySurveyId(surveyId: string): Promise<TInvitationRow[]> {
  const rows = await listInvitations({ surveyId });
  return rows.map((row) => ({
    id: row.id,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    contactId: row.contactId,
    sentAt: row.sentAt,
    respondedAt: row.respondedAt,
    lastReminderAt: row.lastReminderAt,
    reminderCount: row.reminderCount,
  }));
}

export async function getInvitationSummary(surveyId: string): Promise<TInvitationSummary> {
  // Compute `pending` with its own query rather than subtracting counts — a
  // response recorded before `sentAt` gets set (e.g. someone had a link from
  // a prior run) would otherwise drive the count negative.
  const [total, sent, responded, pending] = await Promise.all([
    prisma.surveyInvitation.count({ where: { surveyId } }),
    prisma.surveyInvitation.count({ where: { surveyId, sentAt: { not: null } } }),
    prisma.surveyInvitation.count({ where: { surveyId, respondedAt: { not: null } } }),
    prisma.surveyInvitation.count({
      where: { surveyId, sentAt: { not: null }, respondedAt: null },
    }),
  ]);
  return { total, sent, pending, responded };
}
