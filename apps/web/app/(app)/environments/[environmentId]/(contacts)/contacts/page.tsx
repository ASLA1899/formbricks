import Link from "next/link";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { getTranslate } from "@/lingodotdev/server";
import { UploadContactsCSVButton } from "@/modules/contacts/components/upload-contacts-button";
import { ContactDataView } from "@/modules/ee/contacts/components/contact-data-view";
import { ContactsSecondaryNavigation } from "@/modules/ee/contacts/components/contacts-secondary-navigation";
import { getContactAttributeKeys } from "@/modules/ee/contacts/lib/contact-attribute-keys";
import { getContacts } from "@/modules/ee/contacts/lib/contacts";
import { getIsQuotasEnabled } from "@/modules/ee/license-check/lib/utils";
import { getEnvironmentAuth } from "@/modules/environments/lib/utils";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { PageHeader } from "@/modules/ui/components/page-header";

type ContactSource = "snowflake" | "manual" | "csv";
// Status param values: "true" (active only, default), "false" (inactive only),
// "all" (both). Encoded in the URL as ?active=<value>.
type StatusParam = "true" | "false" | "all";

const buildHref = (
  environmentId: string,
  source: ContactSource | undefined,
  status: StatusParam | undefined
) => {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (status && status !== "true") params.set("active", status);
  const qs = params.toString();
  return `/environments/${environmentId}/contacts${qs ? `?${qs}` : ""}`;
};

const FilterChip = ({ label, isActive, href }: { label: string; isActive: boolean; href: string }) => (
  <Link
    href={href}
    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
      isActive
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    }`}>
    {label}
  </Link>
);

const ContactsPage = async ({
  params: paramsProps,
  searchParams: searchParamsProps,
}: {
  params: Promise<{ environmentId: string }>;
  searchParams: Promise<{ source?: string; active?: string }>;
}) => {
  const params = await paramsProps;
  const searchParams = await searchParamsProps;

  const { environment, isReadOnly, organization } = await getEnvironmentAuth(params.environmentId);

  const t = await getTranslate();

  const isQuotasAllowed = await getIsQuotasEnabled(organization.billing.plan);

  // Parse filters from search params; invalid values fall back to undefined.
  const source: ContactSource | undefined =
    searchParams.source === "snowflake" ||
    searchParams.source === "manual" ||
    searchParams.source === "csv"
      ? searchParams.source
      : undefined;

  // ?active=true (or no param) -> active only (default).
  // ?active=false -> inactive only.
  // ?active=all -> show both. Anything else is treated as the default.
  const statusParam: StatusParam =
    searchParams.active === "false"
      ? "false"
      : searchParams.active === "all"
        ? "all"
        : "true";

  // Translate the URL token to the lib-level filter shape:
  //   true  -> only active   (inactive: false)
  //   false -> only inactive (inactive: true)
  //   undef -> both           (no inactive filter)
  const active: boolean | undefined =
    statusParam === "all" ? undefined : statusParam === "true";

  const contactAttributeKeys = await getContactAttributeKeys(params.environmentId);
  const initialContacts = await getContacts(params.environmentId, 0, undefined, { source, active });

  const AddContactsButton = <UploadContactsCSVButton environmentId={environment.id} />;

  return (
    <PageContentWrapper>
      <PageHeader pageTitle={t("common.contacts")} cta={!isReadOnly ? AddContactsButton : undefined}>
        <ContactsSecondaryNavigation activeId="contacts" environmentId={params.environmentId} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Source</span>
          <FilterChip
            label="All"
            isActive={source === undefined}
            href={buildHref(params.environmentId, undefined, statusParam)}
          />
          <FilterChip
            label="Snowflake"
            isActive={source === "snowflake"}
            href={buildHref(params.environmentId, "snowflake", statusParam)}
          />
          <FilterChip
            label="Manual"
            isActive={source === "manual"}
            href={buildHref(params.environmentId, "manual", statusParam)}
          />
          <FilterChip
            label="CSV"
            isActive={source === "csv"}
            href={buildHref(params.environmentId, "csv", statusParam)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
          <FilterChip
            label="Active only"
            isActive={statusParam === "true"}
            href={buildHref(params.environmentId, source, "true")}
          />
          <FilterChip
            label="Inactive only"
            isActive={statusParam === "false"}
            href={buildHref(params.environmentId, source, "false")}
          />
          <FilterChip
            label="All"
            isActive={statusParam === "all"}
            href={buildHref(params.environmentId, source, "all")}
          />
        </div>
      </div>

      <ContactDataView
        key={`${initialContacts.length}-${contactAttributeKeys.length}-${source ?? "all"}-${
          active === undefined ? "all" : String(active)
        }`}
        environment={environment}
        itemsPerPage={ITEMS_PER_PAGE}
        contactAttributeKeys={contactAttributeKeys}
        isReadOnly={isReadOnly}
        initialContacts={initialContacts}
        hasMore={initialContacts.length >= ITEMS_PER_PAGE}
        isQuotasAllowed={isQuotasAllowed}
      />
    </PageContentWrapper>
  );
};

export default ContactsPage;
