import { prisma } from "@formbricks/database";
import { getResponsesByContactId } from "@/lib/response/service";
import { getTranslate } from "@/lingodotdev/server";
import { getContact } from "@/modules/ee/contacts/lib/contacts";
import { TContactSource } from "@/modules/ee/contacts/types/contact";
import { IdBadge } from "@/modules/ui/components/id-badge";

// Source labels are static (3 values) so we keep them inline; if more sources
// land later this would graduate to a small map module.
const sourceBadgeStyles: Record<TContactSource, { label: string; className: string }> = {
  snowflake: {
    label: "Synced from Snowflake",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  csv: {
    label: "Imported from CSV",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  manual: {
    label: "Manually added",
    className: "bg-slate-100 text-slate-700 ring-slate-200",
  },
};

const SourceBadge = ({ source }: { source: TContactSource }) => {
  const { label, className } = sourceBadgeStyles[source];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>
      {label}
    </span>
  );
};

const SyncManagedPill = () => (
  <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 ring-1 ring-inset ring-sky-200">
    from Snowflake
  </span>
);

export const AttributesSection = async ({ contactId }: { contactId: string }) => {
  const t = await getTranslate();
  const contact = await getContact(contactId);

  if (!contact) {
    throw new Error(t("environments.contacts.contact_not_found"));
  }

  const responses = await getResponsesByContactId(contactId);
  const numberOfResponses = responses?.length || 0;

  // Build the set of sync-managed attribute key ids (only meaningful for
  // snowflake-sourced contacts). columnMapping is JSON; we only use the
  // 'attribute' destination kind, ignoring 'typed' / 'skip'.
  const sync =
    contact.source === "snowflake"
      ? await prisma.contactSync.findUnique({
          where: { environmentId: contact.environmentId },
          select: { columnMapping: true },
        })
      : null;
  const syncManagedKeyIds = new Set<string>();
  if (sync?.columnMapping && typeof sync.columnMapping === "object") {
    for (const dest of Object.values(sync.columnMapping as Record<string, unknown>)) {
      if (
        dest &&
        typeof dest === "object" &&
        (dest as { kind?: unknown }).kind === "attribute" &&
        typeof (dest as { attributeKeyId?: unknown }).attributeKeyId === "string"
      ) {
        syncManagedKeyIds.add((dest as { attributeKeyId: string }).attributeKeyId);
      }
    }
  }

  // Fast lookup of attribute by key for the well-known special rows.
  const attrByKey = new Map<string, { value: string; attributeKey: { id: string; key: string } }>();
  for (const attr of contact.attributes) {
    attrByKey.set(attr.attributeKey.key, attr);
  }
  const legacyEmailAttr = attrByKey.get("email");
  const userIdAttr = attrByKey.get("userId");
  const languageAttr = attrByKey.get("language");

  // Remaining dynamic attributes (anything not rendered in the dedicated rows).
  const reservedKeys = new Set(["email", "userId", "language"]);
  const dynamicAttributes = contact.attributes.filter((attr) => !reservedKeys.has(attr.attributeKey.key));

  const inactiveSinceLabel =
    contact.inactiveAt && ` (since ${new Date(contact.inactiveAt).toLocaleDateString()})`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-700">{t("common.attributes")}</h2>
        <SourceBadge source={contact.source} />
      </div>

      {contact.inactive && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p className="font-medium">This contact is marked inactive{inactiveSinceLabel}.</p>
          <p className="mt-1 text-rose-700">
            They were dropped from the source query and won&apos;t be included in new sync runs.
          </p>
        </div>
      )}

      <div>
        <dt className="text-sm font-medium text-slate-500">email</dt>
        <dd className="ph-no-capture mt-1 text-sm text-slate-900">
          {contact.email ?? legacyEmailAttr?.value ?? (
            <span className="text-slate-300">{t("environments.contacts.not_provided")}</span>
          )}
        </dd>
      </div>

      {contact.externalId && (
        <div>
          <dt className="text-sm font-medium text-slate-500">externalId</dt>
          <dd className="ph-no-capture mt-1 text-sm text-slate-900">
            <IdBadge id={contact.externalId} />
          </dd>
        </div>
      )}

      <div>
        <dt className="text-sm font-medium text-slate-500">language</dt>
        <dd className="ph-no-capture mt-1 text-sm text-slate-900">
          {languageAttr?.value ? (
            <span>{languageAttr.value}</span>
          ) : (
            <span className="text-slate-300">{t("environments.contacts.not_provided")}</span>
          )}
        </dd>
      </div>

      <div>
        <dt className="text-sm font-medium text-slate-500">userId</dt>
        <dd className="ph-no-capture mt-1 text-sm text-slate-900">
          {userIdAttr?.value ? (
            <IdBadge id={userIdAttr.value} />
          ) : (
            <span className="text-slate-300">{t("environments.contacts.not_provided")}</span>
          )}
        </dd>
      </div>

      <div>
        <dt className="text-sm font-medium text-slate-500">contactId</dt>
        <dd className="ph-no-capture mt-1 text-sm text-slate-900">{contact.id}</dd>
      </div>

      {dynamicAttributes.map((attr) => {
        const isSyncManaged = syncManagedKeyIds.has(attr.attributeKey.id);
        return (
          <div key={attr.attributeKey.id}>
            <dt className="text-sm font-medium text-slate-500">{attr.attributeKey.key}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-900">
              <span>{attr.value}</span>
              {isSyncManaged && <SyncManagedPill />}
            </dd>
          </div>
        );
      })}
      <hr />

      <div>
        <dt className="text-sm font-medium text-slate-500">{t("common.responses")}</dt>
        <dd className="mt-1 text-sm text-slate-900">{numberOfResponses}</dd>
      </div>
    </div>
  );
};
