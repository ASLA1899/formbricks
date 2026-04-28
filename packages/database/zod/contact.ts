import type { Contact } from "@prisma/client";
import { z } from "zod";
import { extendZodWithOpenApi } from "zod-openapi";

extendZodWithOpenApi(z);

export const ZContact = z.object({
  id: z.string().cuid2().openapi({
    description: "Unique identifier for the contact",
  }),
  userId: z.string().nullable().openapi({
    description: "Optional external user identifier",
  }),
  createdAt: z.coerce.date().openapi({
    description: "When the contact was created",
    example: "2021-01-01T00:00:00.000Z",
  }),
  updatedAt: z.coerce.date().openapi({
    description: "When the contact was last updated",
    example: "2021-01-01T00:00:00.000Z",
  }),
  environmentId: z.string().openapi({
    description: "The environment this contact belongs to",
  }),
  email: z.string().nullable().openapi({
    description: "The contact's email address (post-Phase-1a typed column)",
  }),
  externalId: z.string().nullable().openapi({
    description: "Canonical identifier from the source system (e.g. Snowflake member number)",
  }),
  source: z.enum(["snowflake", "manual", "csv"]).openapi({
    description: "How this contact entered Formbricks",
  }),
  inactive: z.boolean().openapi({
    description: "Set when a Snowflake-source contact drops out of the source query",
  }),
  inactiveAt: z.coerce.date().nullable().openapi({
    description: "When the contact was marked inactive",
  }),
}) satisfies z.ZodType<Contact>;

ZContact.openapi({
  ref: "contact",
  description: "A person or user who can receive and respond to surveys",
});
