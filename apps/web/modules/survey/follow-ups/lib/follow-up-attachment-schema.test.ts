import { describe, expect, test } from "vitest";
import {
  ZSurveyFollowUpAction,
  ZSurveyFollowUpAttachment,
} from "@formbricks/database/types/survey-follow-up";

const baseProperties = {
  to: "email",
  from: "no-reply@example.org",
  replyTo: ["help@example.org"],
  subject: "Thanks",
  body: "<p>Hi</p>",
  attachResponseData: false,
};

const attachment = {
  storageKey: "clh3k2p0000001234abcdefgh/private/guide--fid--uuid.pdf",
  fileName: "Guide.pdf",
  contentType: "application/pdf",
  size: 2048,
  attachToEmail: false,
};

describe("follow-up attachment schema", () => {
  test("existing follow-ups without an attachment still validate", () => {
    expect(ZSurveyFollowUpAction.safeParse({ type: "send-email", properties: baseProperties }).success).toBe(
      true
    );
  });

  test("accepts a follow-up with an attachment", () => {
    const result = ZSurveyFollowUpAction.safeParse({
      type: "send-email",
      properties: { ...baseProperties, attachment },
    });
    expect(result.success).toBe(true);
  });

  test("rejects keys outside private storage or with path traversal", () => {
    expect(
      ZSurveyFollowUpAttachment.safeParse({ ...attachment, storageKey: "env/public/a.pdf" }).success
    ).toBe(false);
    expect(
      ZSurveyFollowUpAttachment.safeParse({ ...attachment, storageKey: "env/private/../a.pdf" }).success
    ).toBe(false);
    expect(
      ZSurveyFollowUpAttachment.safeParse({ ...attachment, storageKey: "a/b/private/c.pdf" }).success
    ).toBe(false);
  });

  test("rejects files above the upload cap", () => {
    expect(ZSurveyFollowUpAttachment.safeParse({ ...attachment, size: 21 * 1024 * 1024 }).success).toBe(
      false
    );
  });
});
