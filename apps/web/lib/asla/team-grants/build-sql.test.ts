import { describe, expect, test } from "vitest";
import { buildPreimageSql, buildRollbackSql, buildTeamGrantSql } from "./build-sql";

const base = {
  organizationName: "Example Organization",
  workspaceName: "Example Workspace",
  team: { name: "All staff", permission: "readWrite" },
  owners: ["Admin1@Example.org", "admin2@example.org"],
};

describe("buildTeamGrantSql", () => {
  test("a dry run ends in ROLLBACK and an apply ends in COMMIT", () => {
    expect(buildTeamGrantSql(base, "dry_run")).toMatch(/\nROLLBACK;/);
    expect(buildTeamGrantSql(base, "dry_run")).not.toMatch(/\nCOMMIT;/);
    expect(buildTeamGrantSql(base, "apply")).toMatch(/\nCOMMIT;\n$/);
    expect(buildTeamGrantSql(base, "apply")).not.toMatch(/\nROLLBACK;/);
  });

  test("emails are lower-cased and mapped to roles", () => {
    const sql = buildTeamGrantSql({ ...base, members: ["m@example.org"] }, "dry_run");
    expect(sql).toContain("('admin1@example.org', 'owner')");
    expect(sql).toContain("('m@example.org', 'member')");
  });

  test("defaultRole defaults to member and null leaves other users alone", () => {
    expect(buildTeamGrantSql(base, "dry_run")).toContain(`COALESCE(r.role, 'member'::"OrganizationRole")`);
    expect(buildTeamGrantSql({ ...base, defaultRole: null }, "dry_run")).toContain(
      `COALESCE(r.role, NULL::"OrganizationRole")`
    );
  });

  test("uses the requested workspace permission", () => {
    const sql = buildTeamGrantSql({ ...base, team: { name: "All staff", permission: "read" } }, "dry_run");
    expect(sql).toContain(`'read'::"WorkspaceTeamPermission"`);
  });

  test("has guards for unknown emails and for a missing owner", () => {
    const sql = buildTeamGrantSql(base, "dry_run");
    expect(sql).toContain("not accepted members of the organization");
    expect(sql).toContain("the organization would have no active owner");
    expect(sql).toContain(`u."isActive"`);
  });

  test("survey owners only fill an empty ownerId", () => {
    const sql = buildTeamGrantSql(
      { ...base, surveyOwners: [{ surveyId: "cmt0f60i500fcqo010fmhp635", ownerEmail: "A@example.org" }] },
      "dry_run"
    );
    expect(sql).toContain("('cmt0f60i500fcqo010fmhp635', 'a@example.org')");
    expect(sql).toContain(`s."ownerId" IS NULL`);
  });

  test.each([
    ["no owners", { ...base, owners: [] }],
    ["owner and member overlap", { ...base, members: ["admin2@example.org"] }],
    ["duplicate email", { ...base, owners: ["a@example.org", "A@example.org"] }],
    ["quote in an email", { ...base, owners: ["a'b@example.org"] }],
    ["quote in a name", { ...base, organizationName: "x'; DROP TABLE y;--" }],
    ["unknown permission", { ...base, team: { name: "t", permission: "root" } }],
    ["bad survey id", { ...base, surveyOwners: [{ surveyId: "1' OR '1", ownerEmail: "a@example.org" }] }],
  ])("rejects %s", (_label, input) => {
    expect(() => buildTeamGrantSql(input, "dry_run")).toThrow();
  });

  test("survey owner updates stay in the workspace and need an accepted org member", () => {
    const sql = buildTeamGrantSql(
      { ...base, surveyOwners: [{ surveyId: "cmt0f60i500fcqo010fmhp635", ownerEmail: "a@example.org" }] },
      "dry_run"
    );
    expect(sql).toContain(`s."workspaceId" = ws_id`);
    expect(sql).toContain(`ms."organizationId" = org_id AND ms.accepted`);
  });
});

describe("pre-image and rollback", () => {
  const input = {
    ...base,
    surveyOwners: [{ surveyId: "cmt0f60i500fcqo010fmhp635", ownerEmail: "a@example.org" }],
  };
  const pre = {
    organizationId: "org1",
    workspaceId: "ws1",
    teamId: null,
    grantPermission: null,
    teamUsers: [],
    memberships: [["user1", "owner"], ["user2", "owner"]],
    ownerlessSurveys: ["cmt0f60i500fcqo010fmhp635"],
  };

  test("the pre-image query is read only and holds ids, not emails", () => {
    const sql = buildPreimageSql(input);
    expect(sql).toMatch(/SELECT json_build_object/);
    expect(sql).not.toMatch(/UPDATE|DELETE|INSERT/);
    expect(sql).not.toContain("a@example.org");
  });

  test("rollback is bound to the pre-image organization and workspace", () => {
    const sql = buildRollbackSql(input, pre, "dry_run");
    expect(sql).toContain("'org1'");
    expect(sql).toContain("'ws1'");
    expect(sql).toContain("the pre-image is for another organization or workspace");
    expect(sql).toMatch(/\nROLLBACK;/);
    expect(buildRollbackSql(input, pre, "apply")).toMatch(/\nCOMMIT;\n$/);
  });

  test("rollback clears only owners the apply assigned, inside the workspace", () => {
    const sql = buildRollbackSql(input, pre, "apply");
    expect(sql).toContain(`s."workspaceId" = ws_id AND s."ownerId" = u.id`);
    expect(sql).not.toMatch(/SET "ownerId" = b\./);
  });

  test("rollback removes a team the apply created", () => {
    expect(buildRollbackSql(input, pre, "apply")).toContain(`DELETE FROM "Team" WHERE id = team_id`);
  });

  test("rollback restores an existing team's grant and members", () => {
    const sql = buildRollbackSql(
      input,
      { ...pre, teamId: "team1", grantPermission: "read", teamUsers: [["user1", "admin"]] },
      "apply"
    );
    expect(sql).not.toContain(`DELETE FROM "Team" WHERE id`);
    expect(sql).toContain("('user1', 'admin')");
    expect(sql).toContain("'read'::\"WorkspaceTeamPermission\"");
    expect(sql).toContain("'team1'");
  });

  test("rollback rejects a bad pre-image", () => {
    expect(() => buildRollbackSql(input, { ...pre, memberships: [["u'; DROP", "owner"]] }, "apply")).toThrow();
    expect(() => buildRollbackSql(input, { ...pre, memberships: [["user1", "root"]] }, "apply")).toThrow();
    expect(() => buildRollbackSql(input, { ...pre, organizationId: undefined }, "apply")).toThrow();
  });
});
