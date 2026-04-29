import { prisma } from "@formbricks/database";
import { listQueryConfigs } from "@/app/api/member-lookup/query-config-loader";
import { getEnvironmentAuth } from "@/modules/environments/lib/utils";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { PageHeader } from "@/modules/ui/components/page-header";
import { SyncConfigForm } from "./components/sync-config-form";
import { SyncStatusPanel } from "./components/sync-status-panel";

export default async function SnowflakeSyncSettingsPage(props: {
  params: Promise<{ environmentId: string }>;
}) {
  const { environmentId } = await props.params;
  await getEnvironmentAuth(environmentId);

  const [sync, attributeKeys] = await Promise.all([
    prisma.contactSync.findUnique({
      where: { environmentId },
      select: {
        id: true,
        snowflakeQueryId: true,
        columnMapping: true,
        intervalMinutes: true,
        enabled: true,
        lastRunAt: true,
        lastRunStatus: true,
        runs: {
          orderBy: { startedAt: "desc" },
          take: 20,
          select: {
            id: true,
            startedAt: true,
            finishedAt: true,
            status: true,
            rowsProcessed: true,
            rowsCreated: true,
            rowsUpdated: true,
            rowsDeactivated: true,
            errorMessage: true,
          },
        },
      },
    }),
    prisma.contactAttributeKey.findMany({
      where: { environmentId },
      select: { id: true, key: true },
      orderBy: { key: "asc" },
    }),
  ]);

  // Filter to parameter-less queries only — sync needs a master roster
  // query that returns ALL contacts in one shot, not a per-member lookup
  // (which is what the existing member-lookup queries take parameters for).
  // Parameterized queries can't be used as a sync source.
  const allQueryConfigs = listQueryConfigs();
  const queryConfigs = allQueryConfigs.filter((q) => q.parameters.length === 0);
  const hasParameterizedOnly = allQueryConfigs.length > 0 && queryConfigs.length === 0;

  // Narrow the form's prop to the config-only fields. The form doesn't read
  // lastRunAt / lastRunStatus / runs and shouldn't have to know about them.
  const formConfig = sync
    ? {
        id: sync.id,
        snowflakeQueryId: sync.snowflakeQueryId,
        columnMapping: sync.columnMapping,
        intervalMinutes: sync.intervalMinutes,
        enabled: sync.enabled,
      }
    : null;

  return (
    <PageContentWrapper>
      <PageHeader pageTitle="Snowflake Sync" />
      <div className="mx-auto max-w-4xl space-y-8">
        <p className="text-sm text-slate-600">
          Configure a Snowflake query to continuously mirror contacts into Formbricks. Synced contacts can be
          sliced in the Segments UI without writing SQL. Manual contacts (added by hand or via CSV import) are
          protected — sync never overwrites them.
        </p>

        {hasParameterizedOnly && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">No master sync query is configured.</p>
            <p className="mt-2">
              The existing Snowflake queries in <code className="font-mono">query-config.json</code> all take
              parameters (member ID, email, etc.) &mdash; they are per-record lookups, not sync sources. To enable
              the Snowflake → Contact mirror, add a parameter-less query that returns ALL contacts you want
              mirrored. Example:
            </p>
            <pre className="mt-2 overflow-auto rounded bg-amber-100 p-2 text-xs">
              {`"member-roster-sync": {
  "name": "Member Roster (Sync)",
  "description": "All active members for Phase 1a sync",
  "database": "{{SNOWFLAKE_DATABASE}}",
  "schema": "{{SNOWFLAKE_SCHEMA}}",
  "sql": "SELECT record_number, first_name, last_name, email FROM members",
  "parameters": [],
  "fields": {},
  "cache": { "enabled": false }
}`}
            </pre>
          </div>
        )}

        <SyncConfigForm
          environmentId={environmentId}
          existingConfig={formConfig}
          attributeKeys={attributeKeys}
          availableQueries={queryConfigs}
        />

        {sync && (
          <SyncStatusPanel
            environmentId={environmentId}
            lastRunAt={sync.lastRunAt}
            lastRunStatus={sync.lastRunStatus}
            runs={sync.runs}
          />
        )}
      </div>
    </PageContentWrapper>
  );
}
