import { describe, expect, test } from "vitest";
import { ZSurveyDateElement } from "./elements";

const baseDate = {
  id: "q1",
  type: "date",
  headline: { default: "When?" },
  required: false,
  format: "M-d-y",
};

describe("ZSurveyDateElement dateKind", () => {
  test("keeps monthYear through parsing", () => {
    expect(ZSurveyDateElement.parse({ ...baseDate, dateKind: "monthYear" }).dateKind).toBe("monthYear");
  });

  test("defaults to full", () => {
    expect(ZSurveyDateElement.parse(baseDate).dateKind).toBe("full");
  });

  test("rejects unknown kinds", () => {
    expect(ZSurveyDateElement.safeParse({ ...baseDate, dateKind: "year" }).success).toBe(false);
  });
});
