import { z } from "zod";

/**
 * ASLA fork (ASL-1883): turns a role mapping file into one idempotent SQL transaction that
 * - sets Membership.role to owner or member,
 * - keeps one team in sync with the members and gives it a WorkspaceTeam grant,
 * - assigns an owner to named surveys that have none.
 *
 * It writes only source tables. The authzed_projection_* triggers put every change into
 * AuthzedProjectionOutbox, and the outbox processor writes the SpiceDB relationships.
 * Do not write SpiceDB directly.
 */

const EMAIL_PATTERN = /^[^\s'";\\]+@[^\s'";\\]+$/;
const CUID_PATTERN = /^[a-z0-9]{20,40}$/;
// Names go into SQL string literals. Reject anything that could end a literal or a comment.
const NAME_PATTERN = /^[\p{L}\p{N} .,:()&_-]{1,100}$/u;

const emailSchema = z
  .string()
  .regex(EMAIL_PATTERN)
  .transform((value) => value.trim().toLowerCase());

export const ZTeamGrantMapping = z
  .object({
    organizationName: z.string().regex(NAME_PATTERN),
    workspaceName: z.string().regex(NAME_PATTERN),
    team: z.object({
      name: z.string().regex(NAME_PATTERN),
      permission: z.enum(["read", "readWrite", "manage"]).default("readWrite"),
    }),
    /** Emails that stay or become `owner`: they see every survey. */
    owners: z.array(emailSchema).min(1),
    /** Emails that become `member`. Optional: `defaultRole` covers everyone else. */
    members: z.array(emailSchema).default([]),
    /** Role for owner/member memberships that are in neither list. `null` leaves them alone. */
    defaultRole: z.enum(["member", "owner"]).nullable().default("member"),
    /** Owner for surveys that have `ownerId` NULL. Surveys that already have an owner are left alone. */
    surveyOwners: z
      .array(z.object({ surveyId: z.string().regex(CUID_PATTERN), ownerEmail: emailSchema }))
      .default([]),
  })
  .superRefine((value, ctx) => {
    const overlap = value.owners.filter((email) => value.members.includes(email));
    if (overlap.length > 0) {
      ctx.addIssue({ code: "custom", message: `listed as owner and member: ${overlap.join(", ")}` });
    }
    const dup = [...value.owners, ...value.members].filter((e, i, all) => all.indexOf(e) !== i);
    if (dup.length > 0) {
      ctx.addIssue({ code: "custom", message: `listed twice: ${dup.join(", ")}` });
    }
  });

export type TTeamGrantMapping = z.infer<typeof ZTeamGrantMapping>;

const lit = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const buildTeamGrantSql = (input: unknown, mode: "dry_run" | "apply"): string => {
  const m = ZTeamGrantMapping.parse(input);
  const rows = [
    ...m.owners.map((e) => `(${lit(e)}, 'owner')`),
    ...m.members.map((e) => `(${lit(e)}, 'member')`),
  ].join(",\n  ");
  const surveyRows = m.surveyOwners.map((s) => `(${lit(s.surveyId)}, ${lit(s.ownerEmail)})`).join(",\n  ");
  const defaultRole = m.defaultRole === null ? "NULL" : lit(m.defaultRole);

  return `-- ASLA fork (ASL-1883): team and role mapping. Mode: ${mode}. Generated; do not edit.
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE _asla_roles (email text PRIMARY KEY, role "OrganizationRole" NOT NULL) ON COMMIT DROP;
INSERT INTO _asla_roles (email, role) VALUES
  ${rows};
CREATE TEMP TABLE _asla_survey_owners (survey_id text PRIMARY KEY, email text NOT NULL) ON COMMIT DROP;
${surveyRows ? `INSERT INTO _asla_survey_owners (survey_id, email) VALUES\n  ${surveyRows};` : "-- no survey owners"}

DO $asla$
DECLARE
  org_id text;
  ws_id text;
  team_id text;
  problem text;
BEGIN
  SELECT id INTO STRICT org_id FROM "Organization" WHERE name = ${lit(m.organizationName)};
  SELECT id INTO STRICT ws_id FROM "Workspace" WHERE "organizationId" = org_id AND name = ${lit(m.workspaceName)};

  -- Every listed email must be an accepted member of this organization. Abort on a typo.
  SELECT string_agg(r.email, ', ') INTO problem FROM _asla_roles r
  WHERE NOT EXISTS (
    SELECT 1 FROM "User" u JOIN "Membership" ms ON ms."userId" = u.id
    WHERE lower(u.email) = r.email AND ms."organizationId" = org_id AND ms.accepted
  );
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'not accepted members of the organization: %', problem;
  END IF;

  -- Roles. Only owner and member memberships change; manager and billing stay as they are.
  UPDATE "Membership" ms
  SET role = COALESCE(r.role, ${defaultRole}::"OrganizationRole")
  FROM "User" u LEFT JOIN _asla_roles r ON r.email = lower(u.email)
  WHERE ms."userId" = u.id AND ms."organizationId" = org_id AND ms.accepted
    AND ms.role IN ('owner', 'member')
    AND ms.role IS DISTINCT FROM COALESCE(r.role, ${defaultRole}::"OrganizationRole")
    AND COALESCE(r.role, ${defaultRole}::"OrganizationRole") IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM "Membership" ms JOIN "User" u ON u.id = ms."userId"
    WHERE ms."organizationId" = org_id AND ms.role = 'owner' AND ms.accepted AND u."isActive"
  ) THEN
    RAISE EXCEPTION 'the organization would have no active owner';
  END IF;

  -- Team and workspace grant.
  SELECT id INTO team_id FROM "Team" WHERE "organizationId" = org_id AND name = ${lit(m.team.name)};
  IF team_id IS NULL THEN
    team_id := 'asla' || substr(md5(org_id || ${lit(m.team.name)}), 1, 21);
    INSERT INTO "Team" (id, name, "organizationId", updated_at) VALUES (team_id, ${lit(m.team.name)}, org_id, now());
  END IF;
  INSERT INTO "WorkspaceTeam" ("workspaceId", "teamId", permission, updated_at)
  VALUES (ws_id, team_id, ${lit(m.team.permission)}::"WorkspaceTeamPermission", now())
  ON CONFLICT ("workspaceId", "teamId") DO UPDATE
    SET permission = EXCLUDED.permission, updated_at = now()
    WHERE "WorkspaceTeam".permission IS DISTINCT FROM EXCLUDED.permission;

  -- Team members = accepted org members whose role is now member. Remove anyone else from this team.
  INSERT INTO "TeamUser" ("teamId", "userId", role, updated_at)
  SELECT team_id, ms."userId", 'contributor', now() FROM "Membership" ms
  WHERE ms."organizationId" = org_id AND ms.accepted AND ms.role = 'member'
  ON CONFLICT ("teamId", "userId") DO NOTHING;
  DELETE FROM "TeamUser" tu WHERE tu."teamId" = team_id AND NOT EXISTS (
    SELECT 1 FROM "Membership" ms
    WHERE ms."userId" = tu."userId" AND ms."organizationId" = org_id AND ms.accepted AND ms.role = 'member'
  );

  -- Survey owners, only where none is set.
  SELECT string_agg(o.survey_id, ', ') INTO problem FROM _asla_survey_owners o
  WHERE NOT EXISTS (SELECT 1 FROM "Survey" s WHERE s.id = o.survey_id AND s."workspaceId" = ws_id)
     OR NOT EXISTS (
       SELECT 1 FROM "User" u JOIN "Membership" ms ON ms."userId" = u.id
       WHERE lower(u.email) = o.email AND ms."organizationId" = org_id AND ms.accepted
     );
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'survey not in this workspace, or owner not an accepted member: %', problem;
  END IF;
  UPDATE "Survey" s SET "ownerId" = u.id, updated_at = now()
  FROM _asla_survey_owners o
  JOIN "User" u ON lower(u.email) = o.email
  JOIN "Membership" ms ON ms."userId" = u.id AND ms."organizationId" = org_id AND ms.accepted
  WHERE s.id = o.survey_id AND s."workspaceId" = ws_id AND s."ownerId" IS NULL;
END
$asla$;

SELECT 'roles' AS what, role::text AS key, count(*) AS n FROM "Membership" GROUP BY role
UNION ALL SELECT 'team', t.name, count(*) FROM "TeamUser" tu JOIN "Team" t ON t.id = tu."teamId" GROUP BY t.name
UNION ALL SELECT 'grant', t.name || ':' || wt.permission::text, 1 FROM "WorkspaceTeam" wt JOIN "Team" t ON t.id = wt."teamId"
UNION ALL SELECT 'surveys without owner', '', count(*) FROM "Survey" WHERE "ownerId" IS NULL
ORDER BY 1, 2;
${mode === "apply" ? "COMMIT;" : "ROLLBACK; -- dry run: nothing is saved. Generate with --apply to save."}
`;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(ID_PATTERN);

/**
 * What the mapping will change, recorded before `--apply`. Ids only, no emails.
 * It is bound to one organization and workspace; a rollback refuses any other.
 */
export const ZPreimage = z.object({
  organizationId: id,
  workspaceId: id,
  /** Id of the team if it existed before the apply, else null (the apply creates it). */
  teamId: id.nullable(),
  /** The team's workspace grant before the apply, else null. Only read when the team existed. */
  grantPermission: z.enum(["read", "readWrite", "manage"]).nullable(),
  /** The team's members before the apply. Only read when the team existed. */
  teamUsers: z.array(z.tuple([id, z.enum(["admin", "contributor"])])),
  memberships: z.array(z.tuple([id, z.enum(["owner", "manager", "member", "billing"])])),
  /** Mapped surveys in the workspace that had no owner before the apply. */
  ownerlessSurveys: z.array(id),
});
export type TPreimage = z.infer<typeof ZPreimage>;

/** SQL that prints the pre-image as one JSON line. Read only. Run it before `--apply` and keep the output. */
export const buildPreimageSql = (input: unknown): string => {
  const m = ZTeamGrantMapping.parse(input);
  const ids = m.surveyOwners.map((s) => lit(s.surveyId)).join(", ") || "NULL";
  return `WITH o AS (SELECT id FROM "Organization" WHERE name = ${lit(m.organizationName)}),
w AS (SELECT w.id FROM "Workspace" w JOIN o ON o.id = w."organizationId" WHERE w.name = ${lit(m.workspaceName)}),
t AS (SELECT t.id FROM "Team" t JOIN o ON o.id = t."organizationId" WHERE t.name = ${lit(m.team.name)})
SELECT json_build_object(
  'organizationId', (SELECT id FROM o),
  'workspaceId', (SELECT id FROM w),
  'teamId', (SELECT id FROM t),
  'grantPermission', (SELECT wt.permission::text FROM "WorkspaceTeam" wt, t, w WHERE wt."teamId" = t.id AND wt."workspaceId" = w.id),
  'teamUsers', COALESCE((SELECT json_agg(json_build_array(tu."userId", tu.role::text)) FROM "TeamUser" tu, t WHERE tu."teamId" = t.id), '[]'::json),
  'memberships', COALESCE((SELECT json_agg(json_build_array(ms."userId", ms.role::text)) FROM "Membership" ms, o WHERE ms."organizationId" = o.id AND ms.accepted), '[]'::json),
  'ownerlessSurveys', COALESCE((SELECT json_agg(s.id) FROM "Survey" s, w WHERE s."workspaceId" = w.id AND s.id IN (${ids}) AND s."ownerId" IS NULL), '[]'::json)
);
`;
};

/**
 * SQL that puts back what the pre-image recorded.
 * - Refuses a pre-image from another organization or workspace.
 * - Survey owners: clears only an owner the apply assigned (survey was ownerless and the owner is still the mapped one).
 * - Team: removes it if the apply created it; otherwise restores its members and workspace grant.
 */
export const buildRollbackSql = (input: unknown, preimageInput: unknown, mode: "dry_run" | "apply"): string => {
  const m = ZTeamGrantMapping.parse(input);
  const pre = ZPreimage.parse(preimageInput);
  const mRows = pre.memberships.map(([u, r]) => `(${lit(u)}, ${lit(r)})`).join(",\n  ");
  const tuRows = pre.teamUsers.map(([u, r]) => `(${lit(u)}, ${lit(r)})`).join(",\n  ");
  const sRows = pre.ownerlessSurveys.map((x) => `(${lit(x)})`).join(",\n  ");
  const emailRows = m.surveyOwners.map((s) => `(${lit(s.surveyId)}, ${lit(s.ownerEmail)})`).join(",\n  ");
  const teamPart =
    pre.teamId === null
      ? `DELETE FROM "Team" WHERE id = team_id; -- the apply created the team; this cascades to its members and grant`
      : `-- the team existed before the apply: restore its grant and members
  IF team_id IS DISTINCT FROM ${lit(pre.teamId)} THEN
    RAISE EXCEPTION 'the team is not the one in the pre-image';
  END IF;
  ${
    pre.grantPermission === null
      ? `DELETE FROM "WorkspaceTeam" WHERE "workspaceId" = ws_id AND "teamId" = team_id;`
      : `INSERT INTO "WorkspaceTeam" ("workspaceId", "teamId", permission, updated_at)
  VALUES (ws_id, team_id, ${lit(pre.grantPermission)}::"WorkspaceTeamPermission", now())
  ON CONFLICT ("workspaceId", "teamId") DO UPDATE SET permission = EXCLUDED.permission, updated_at = now()
    WHERE "WorkspaceTeam".permission IS DISTINCT FROM EXCLUDED.permission;`
  }
  DELETE FROM "TeamUser" tu WHERE tu."teamId" = team_id AND NOT EXISTS (
    SELECT 1 FROM _asla_before_team_users b WHERE b."userId" = tu."userId");
  INSERT INTO "TeamUser" ("teamId", "userId", role, updated_at)
  SELECT team_id, b."userId", b.role, now() FROM _asla_before_team_users b
  ON CONFLICT ("teamId", "userId") DO UPDATE SET role = EXCLUDED.role, updated_at = now()
    WHERE "TeamUser".role IS DISTINCT FROM EXCLUDED.role;`;
  return `-- ASLA fork (ASL-1883): rollback of the team and role mapping. Mode: ${mode}. Generated; do not edit.
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE _asla_before_roles ("userId" text PRIMARY KEY, role "OrganizationRole" NOT NULL) ON COMMIT DROP;
${mRows ? `INSERT INTO _asla_before_roles VALUES\n  ${mRows};` : "-- no memberships"}
CREATE TEMP TABLE _asla_before_team_users ("userId" text PRIMARY KEY, role "TeamUserRole" NOT NULL) ON COMMIT DROP;
${tuRows ? `INSERT INTO _asla_before_team_users VALUES\n  ${tuRows};` : "-- no team members"}
CREATE TEMP TABLE _asla_before_surveys (id text PRIMARY KEY) ON COMMIT DROP;
${sRows ? `INSERT INTO _asla_before_surveys VALUES\n  ${sRows};` : "-- no ownerless surveys"}
CREATE TEMP TABLE _asla_survey_owners (survey_id text PRIMARY KEY, email text NOT NULL) ON COMMIT DROP;
${emailRows ? `INSERT INTO _asla_survey_owners (survey_id, email) VALUES\n  ${emailRows};` : "-- no survey owners"}
DO $asla$
DECLARE
  org_id text;
  ws_id text;
  team_id text;
BEGIN
  SELECT id INTO STRICT org_id FROM "Organization" WHERE name = ${lit(m.organizationName)};
  SELECT id INTO STRICT ws_id FROM "Workspace" WHERE "organizationId" = org_id AND name = ${lit(m.workspaceName)};
  IF org_id IS DISTINCT FROM ${lit(pre.organizationId)} OR ws_id IS DISTINCT FROM ${lit(pre.workspaceId)} THEN
    RAISE EXCEPTION 'the pre-image is for another organization or workspace';
  END IF;
  SELECT id INTO team_id FROM "Team" WHERE "organizationId" = org_id AND name = ${lit(m.team.name)};

  UPDATE "Membership" ms SET role = b.role
  FROM _asla_before_roles b
  WHERE ms."userId" = b."userId" AND ms."organizationId" = org_id AND ms.role IS DISTINCT FROM b.role;

  IF team_id IS NOT NULL THEN
  ${teamPart}
  END IF;

  -- Clear only owners this apply assigned: the survey was ownerless before and still has the mapped owner.
  UPDATE "Survey" s SET "ownerId" = NULL, updated_at = now()
  FROM _asla_before_surveys b
  JOIN _asla_survey_owners o ON o.survey_id = b.id
  JOIN "User" u ON lower(u.email) = o.email
  WHERE s.id = b.id AND s."workspaceId" = ws_id AND s."ownerId" = u.id;
END
$asla$;
${mode === "apply" ? "COMMIT;" : "ROLLBACK; -- dry run: nothing is saved. Generate with --apply to save."}
`;
};
