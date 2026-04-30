import { Prisma } from "@prisma/client";
import { TContactAttributes } from "@formbricks/types/contact-attribute";
import { TContactWithAttributes, TTransformPersonInput } from "@/modules/ee/contacts/types/contact";

export const getContactIdentifier = (contactAttributes: TContactAttributes | null): string => {
  return contactAttributes?.email ?? contactAttributes?.userId ?? "";
};

export const convertPrismaContactAttributes = (
  prismaAttributes: Prisma.ContactAttributeGetPayload<{
    select: { value: true; attributeKey: { select: { key: true; name: true } } };
  }>[]
): TContactAttributes => {
  return prismaAttributes.reduce((acc, attr) => {
    acc[attr.attributeKey.key] = {
      name: attr.attributeKey.name,
      value: attr.value,
    };
    return acc;
  }, {});
};

export const transformPrismaContact = (person: TTransformPersonInput): TContactWithAttributes => {
  const attributes: Record<string, string> = person.attributes.reduce(
    (acc, attr) => {
      acc[attr.attributeKey.key] = attr.value;
      return acc;
    },
    {} as Record<string, string>
  );

  // Phase 1a: typed Contact.email is the source of truth post-Phase-1a.
  // Mirror it into the legacy flat-attributes view so consumers reading
  // `contact.attributes.email` (segment filters, CSV exports, contacts list,
  // analysis exports, etc.) keep working without each having to know about
  // the typed column. Sync-created contacts populate the typed column but
  // not the email-attribute, so without this merge they show up email-less
  // in every legacy consumer. Same treatment for externalId.
  if (person.email && !attributes.email) {
    attributes.email = person.email;
  }
  if (person.externalId && !attributes.externalId) {
    attributes.externalId = person.externalId;
  }

  return {
    id: person.id,
    attributes,
    environmentId: person.environmentId,
    email: person.email,
    externalId: person.externalId,
    source: person.source,
    inactive: person.inactive,
    inactiveAt: person.inactiveAt,
    createdAt: new Date(person.createdAt),
    updatedAt: new Date(person.updatedAt),
  };
};
