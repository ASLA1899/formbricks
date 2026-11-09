import { z } from "zod";
import { ZId } from "@formbricks/types/common";
import { ZResponseInput } from "@formbricks/types/responses";

export const ZResponseInputV2 = ZResponseInput.omit({ userId: true }).extend({
  contactId: ZId.nullish(),
  // ASLA fork (ASL-1877): binds contactId to this survey; see modules/survey/link/lib/contact-binding.ts.
  // Only bounded here: a malformed token must record the answer anonymously, not reject it.
  contactToken: z.string().max(128).nullish(),
  recaptchaToken: z.string().nullish(),
});
export type TResponseInputV2 = z.infer<typeof ZResponseInputV2>;
