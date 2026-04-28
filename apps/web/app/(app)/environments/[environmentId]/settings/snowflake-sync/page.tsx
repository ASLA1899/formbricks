import { prisma } from "@formbricks/database";
import { listQueryConfigs } from "@/app/api/member-lookup/query-config-loader";
import { getEnvironmentAuth } from "@/modules/environments/lib/utils";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { PageHeader } from "@/modules/ui/components/page-header";
import { SyncConfigForm } from "./components/sync-config-form";

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
      },
    }),
    prisma.contactAttributeKey.findMany({
      where: { environmentId },
      select: { id: true, key: true },
      orderBy: { key: "asc" },
    }),
  ]);

  const queryConfigs = listQueryConfigs();

  return (
    <PageContentWrapper>
      <PageHeader pageTitle="Snowflake Sync" />
      <div className="mx-auto max-w-4xl space-y-8">
        <p className="text-sm text-slate-600">
          Configure a Snowflake query to continuously mirror contacts into Formbricks. Synced contacts can be
          sliced in the Segments UI without writing SQL. Manual contacts (added by hand or via CSV import) are
          protected — sync never overwrites them.
        </p>

        <SyncConfigForm
          environmentId={environmentId}
          existingConfig={sync}
          attributeKeys={attributeKeys}
          availableQueries={queryConfigs}
        />
      </div>
    </PageContentWrapper>
  );
}
