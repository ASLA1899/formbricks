import { z } from "zod";
import { ZId } from "@formbricks/types/common";
import { ZDisplayCreateInput } from "@formbricks/types/displays";

export const ZDisplayCreateInputV2 = ZDisplayCreateInput.omit({ userId: true }).extend({
  contactId: ZId.optional(),
  // ASLA fork (ASL-1877): binds contactId to this survey; see modules/survey/link/lib/contact-binding.ts.
  contactToken: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

export type TDisplayCreateInputV2 = z.infer<typeof ZDisplayCreateInputV2>;
