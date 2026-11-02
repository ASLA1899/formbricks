#!/usr/bin/env tsx
/**
 * ASLA fork (ASL-1883): prints the SQL that applies a team and role mapping. Does not touch a database.
 *
 *   tsx scripts/asla/apply-team-grants.ts mapping.json            # dry run (ends in ROLLBACK)
 *   tsx scripts/asla/apply-team-grants.ts mapping.json --apply    # saves (ends in COMMIT)
 *
 *   ... --preimage                  # read only: records roles and survey owners before --apply
 *   ... --rollback preimage.json [--apply]   # puts them back
 *
 * Run the output with psql on the target database, for example on nan01:
 *   ... | ssh <vm> 'docker exec -i formbricks-staging-postgres psql -U <user> -d formbricks -X -At'
 * See scripts/asla/team-grants.example.json for the file format. Keep real mapping files out of git.
 */
import { readFileSync } from "node:fs";
import { buildPreimageSql, buildRollbackSql, buildTeamGrantSql } from "../../apps/web/lib/asla/team-grants/build-sql";

const usage = () => {
  console.error(
    "usage: apply-team-grants.ts <mapping.json> [--apply]\n" +
      "       apply-team-grants.ts <mapping.json> --preimage            (read only; keep the output)\n" +
      "       apply-team-grants.ts <mapping.json> --rollback <preimage.json> [--apply]"
  );
  process.exit(2);
};
const [file, flag, extra, extra2] = process.argv.slice(2);
if (!file) usage();
const mapping = JSON.parse(readFileSync(file, "utf8"));
if (flag === "--preimage" && !extra) {
  process.stdout.write(buildPreimageSql(mapping));
} else if (flag === "--rollback" && extra && (extra2 === undefined || extra2 === "--apply")) {
  const pre = JSON.parse(readFileSync(extra, "utf8"));
  process.stdout.write(buildRollbackSql(mapping, pre, extra2 ? "apply" : "dry_run"));
} else if ((flag === undefined || flag === "--apply") && !extra) {
  process.stdout.write(buildTeamGrantSql(mapping, flag ? "apply" : "dry_run"));
} else usage();
