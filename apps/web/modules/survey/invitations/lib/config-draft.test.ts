import { describe, expect, test } from "vitest";
import {
  clampMaxReminders,
  createEmptyDraft,
  deriveHeadingMode,
  headingTextForMode,
  isAudienceComplete,
  parseReminderDays,
  validateDraft,
} from "./config-draft";

describe("createEmptyDraft", () => {
  test("starts with an empty manual list and the default templates", () => {
    const draft = createEmptyDraft();
    expect(draft.audience).toEqual({ source: "manualList", recipients: [] });
    expect(draft.reminderSchedule.enabled).toBe(false);
    expect(draft.emailTemplates.invitation.subject).not.toBe("");
    expect(draft.emailTemplates.reminder.subject).not.toBe("");
  });

  test("returns a fresh object each time", () => {
    const a = createEmptyDraft();
    a.reminderSchedule.daysAfterInvite.push(30);
    expect(createEmptyDraft().reminderSchedule.daysAfterInvite).toEqual([3, 7]);
  });
});

describe("isAudienceComplete", () => {
  test("segment needs an id", () => {
    expect(isAudienceComplete({ source: "segment", segmentId: "" })).toBe(false);
    expect(isAudienceComplete({ source: "segment", segmentId: "abc" })).toBe(true);
  });

  test("snowflake needs a query and an email column", () => {
    expect(isAudienceComplete({ source: "snowflake", queryId: "", emailColumn: "email" })).toBe(false);
    expect(isAudienceComplete({ source: "snowflake", queryId: "q", emailColumn: "" })).toBe(false);
    expect(isAudienceComplete({ source: "snowflake", queryId: "q", emailColumn: "email" })).toBe(true);
  });

  test("manual list needs a recipient", () => {
    expect(isAudienceComplete({ source: "manualList", recipients: [] })).toBe(false);
    expect(isAudienceComplete({ source: "manualList", recipients: [{ email: "a@example.com" }] })).toBe(true);
  });
});

describe("validateDraft", () => {
  test("accepts a complete manual-list draft with names and overrides", () => {
    const draft = createEmptyDraft();
    draft.audience = { source: "manualList", recipients: [{ email: "a@example.com", firstName: "A" }] };
    draft.fromName = "ASLA";
    draft.emailTemplates.invitation.buttonLabel = "Start";
    draft.emailTemplates.invitation.headingText = "";
    const result = validateDraft(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.emailTemplates.invitation.headingText).toBe("");
      expect(result.config.fromName).toBe("ASLA");
    }
  });

  test("refuses an empty list and names the field", () => {
    const result = validateDraft(createEmptyDraft());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("audience");
  });

  test("refuses a segment id that is not a cuid2", () => {
    const draft = createEmptyDraft();
    draft.audience = { source: "segment", segmentId: "not a cuid" };
    expect(validateDraft(draft).ok).toBe(false);
  });

  test("refuses an empty subject", () => {
    const draft = createEmptyDraft();
    draft.audience = { source: "manualList", recipients: [{ email: "a@example.com" }] };
    draft.emailTemplates.reminder.subject = "";
    const result = validateDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("reminder");
  });
});

describe("heading mode", () => {
  test("derives the mode from the stored value", () => {
    expect(deriveHeadingMode(undefined)).toBe("default");
    expect(deriveHeadingMode("")).toBe("none");
    expect(deriveHeadingMode("Hello")).toBe("custom");
  });

  test("maps each mode back to the stored value", () => {
    expect(headingTextForMode("default", "Hello")).toBeUndefined();
    expect(headingTextForMode("none", "Hello")).toBe("");
    expect(headingTextForMode("custom", "Hello")).toBe("Hello");
    expect(headingTextForMode("custom", undefined)).toBe("");
  });
});

describe("parseReminderDays", () => {
  test("parses a comma list", () => {
    expect(parseReminderDays("3, 7,14")).toEqual([3, 7, 14]);
  });

  test("drops out-of-range, fractional, negative and junk entries and repeats", () => {
    expect(parseReminderDays("0, 366, 2.5, -1, abc, , 7, 7")).toEqual([0, 7]);
  });
});

describe("clampMaxReminders", () => {
  test("clamps to 0..20 and treats junk as 0", () => {
    expect(clampMaxReminders("5")).toBe(5);
    expect(clampMaxReminders("25")).toBe(20);
    expect(clampMaxReminders("-3")).toBe(0);
    expect(clampMaxReminders("")).toBe(0);
  });
});
