#!/usr/bin/env tsx
/**
 * ASLA fork (ASL-1883): prints the SQL that applies a team and role mapping. Does not touch a database.
 *
 *   tsx scripts/asla/apply-team-grants.ts mapping.json            # dry run (ends in ROLLBACK)
 *   tsx scripts/asla/apply-team-grants.ts mapping.json --apply    # saves (ends in COMMIT)
 *
 * Run the output with psql on the target database, for example on nan01:
 *   ... | ssh <vm> 'docker exec -i formbricks-staging-postgres psql -U <user> -d formbricks -X -At'
 * See scripts/asla/team-grants.example.json for the file format. Keep real mapping files out of git.
 */
import { readFileSync } from "node:fs";
import { buildTeamGrantSql } from "../../apps/web/lib/asla/team-grants/build-sql";

const [file, flag] = process.argv.slice(2);
if (!file || (flag !== undefined && flag !== "--apply")) {
  console.error("usage: apply-team-grants.ts <mapping.json> [--apply]");
  process.exit(2);
}
process.stdout.write(buildTeamGrantSql(JSON.parse(readFileSync(file, "utf8")), flag ? "apply" : "dry_run"));
