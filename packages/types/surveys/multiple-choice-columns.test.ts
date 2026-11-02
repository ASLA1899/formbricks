import { describe, expect, test } from "vitest";
import {
  ZSurveyMultipleChoiceMultiElement,
  ZSurveyMultipleChoiceSingleElement,
} from "./elements";

const base = {
  id: "q1",
  headline: { default: "Pick" },
  required: false,
  choices: [
    { id: "a", label: { default: "A" } },
    { id: "b", label: { default: "B" } },
  ],
};

describe("multiple choice columns (ASLA fork)", () => {
  test.each([
    ["single", ZSurveyMultipleChoiceSingleElement, "multipleChoiceSingle"],
    ["multi", ZSurveyMultipleChoiceMultiElement, "multipleChoiceMulti"],
  ] as const)("%s keeps columns on parse, so a save does not drop it", (_name, schema, type) => {
    const parsed = schema.parse({ ...base, type, displayType: "list", columns: "2" });
    expect(parsed.columns).toBe("2");
  });

  test("columns stays optional", () => {
    const parsed = ZSurveyMultipleChoiceSingleElement.parse({ ...base, type: "multipleChoiceSingle" });
    expect(parsed.columns).toBeUndefined();
  });

  test("a value other than 1 or 2 is rejected", () => {
    expect(
      ZSurveyMultipleChoiceSingleElement.safeParse({ ...base, type: "multipleChoiceSingle", columns: "3" })
        .success
    ).toBe(false);
  });
});
