import { describe, expect, test } from "vitest";
import { buildTeamGrantSql } from "./build-sql";

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
    expect(sql).toContain("the organization would have no owner");
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
});
