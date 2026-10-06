import { z } from "zod";

export const ZSurveyFollowUpTrigger = z
  .object({
    type: z.enum(["response", "endings"]),
    properties: z
      .object({
        endingIds: z.array(z.cuid2()),
      })
      .nullable(),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.type === "response") {
      if (trigger.properties) {
        ctx.addIssue({
          code: "custom",
          message: "Properties should be null for response type",
        });
      }
    }

    if (trigger.type === "endings") {
      if (!trigger.properties) {
        ctx.addIssue({
          code: "custom",
          message: "Properties must be defined for endings type",
        });
      }
    }
  });

export type TSurveyFollowUpTrigger = z.infer<typeof ZSurveyFollowUpTrigger>;

export const FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const FOLLOW_UP_ATTACHMENT_MAX_EMAIL_BYTES = 5 * 1024 * 1024;

// Storage keys look like `<environmentId>/private/<fileName>`; the environment prefix is verified against
// the survey's environment wherever the key is used.
export const ZSurveyFollowUpAttachment = z.object({
  storageKey: z
    .string()
    .regex(/^[A-Za-z0-9]+\/private\/[^/]+$/)
    .refine((key) => !key.includes("..")),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(FOLLOW_UP_ATTACHMENT_MAX_UPLOAD_BYTES),
  attachToEmail: z.boolean(),
});

export type TSurveyFollowUpAttachment = z.infer<typeof ZSurveyFollowUpAttachment>;

export const ZSurveyFollowUpAction = z.object({
  type: z.literal("send-email"),
  properties: z.object({
    to: z.string(),
    from: z.email(),
    replyTo: z.array(z.email()),
    subject: z.string(),
    body: z.string(),
    attachResponseData: z.boolean(),
    includeVariables: z.boolean().optional(),
    includeHiddenFields: z.boolean().optional(),
    attachment: ZSurveyFollowUpAttachment.optional(),
  }),
});

export type TSurveyFollowUpAction = z.infer<typeof ZSurveyFollowUpAction>;

export const ZSurveyFollowUp = z.object({
  id: z.cuid2(),
  createdAt: z.date(),
  updatedAt: z.date(),
  name: z.string(),
  trigger: ZSurveyFollowUpTrigger,
  action: ZSurveyFollowUpAction,
  surveyId: z.cuid2(),
});

export type TSurveyFollowUp = z.infer<typeof ZSurveyFollowUp>;
