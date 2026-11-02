import { describe, expect, test } from "vitest";
import { renderSubject, renderTemplate } from "./template";

describe("renderTemplate", () => {
  test("substitutes known merge fields, tolerating inner spaces", () => {
    expect(
      renderTemplate("Hi {{recipientFirstName}} and {{ surveyName }}", {
        recipientFirstName: "Ana",
        surveyName: "Pulse",
      })
    ).toBe("Hi Ana and Pulse");
  });

  test("renders a null or undefined value as empty", () => {
    expect(renderTemplate("Hi {{recipientName}}!", { recipientName: null })).toBe("Hi !");
    expect(renderTemplate("Hi {{recipientName}}!", {})).toBe("Hi !");
  });

  test("keeps unknown tokens so authoring typos stay visible", () => {
    expect(renderTemplate("Hi {{recipientNme}}", { recipientName: "x" })).toBe("Hi {{recipientNme}}");
  });

  test("does not HTML-escape values (the email renders the body as text)", () => {
    expect(renderTemplate("{{recipientName}}", { recipientName: "<b>A&B</b>" })).toBe("<b>A&B</b>");
  });

  test("renderSubject uses the same substitution", () => {
    expect(renderSubject("{{surveyName}}", { surveyName: "S" })).toBe("S");
  });
});
