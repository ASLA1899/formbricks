import { describe, expect, test } from "vitest";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getPrefillSources } from "./prefill-sources";

const toggle = (show: boolean) => ({ show, required: false, placeholder: { default: "" } });

const survey = {
  blocks: [
    {
      id: "b1",
      name: "b1",
      elements: [
        {
          id: "ci1",
          type: "contactInfo",
          headline: { default: "<p>Contact</p>" },
          firstName: toggle(true),
          lastName: toggle(false),
          email: toggle(true),
          phone: toggle(false),
          company: toggle(false),
          customFields: [
            { id: "cf_city", label: "City", type: "text", show: true, required: false, placeholder: {} },
            {
              id: "cf_hidden",
              label: "Hidden one",
              type: "text",
              show: false,
              required: false,
              placeholder: {},
            },
          ],
        },
        { id: "ot1", type: "openText", headline: { default: "Why?" } },
        { id: "rating", type: "rating", headline: { default: "Rate" } },
      ],
    },
    {
      id: "b2",
      name: "b2",
      elements: [{ id: "ot2", type: "openText", headline: { default: "Later" } }],
    },
  ],
  embeddedFields: [
    {
      field: { name: "member_id", source: "ingested", dataType: "string" },
      link: { storageKey: "member_id" },
    },
    {
      field: { name: "score", source: "computed", dataType: "number" },
      link: { storageKey: "score" },
    },
  ],
} as unknown as TSurvey;

describe("getPrefillSources", () => {
  const sources = getPrefillSources(survey, "ot2", "default", (name) => `Hidden: ${name}`);

  test("offers shown sub-fields, including custom fields, with HTML stripped", () => {
    expect(sources).toContainEqual({ id: "ci1.firstName", label: "Contact > First Name" });
    expect(sources).toContainEqual({ id: "ci1.email", label: "Contact > Email" });
    expect(sources).toContainEqual({ id: "ci1.cf_city", label: "Contact > City" });
  });

  test("leaves out hidden sub-fields, non-text questions, and computed fields", () => {
    const ids = sources.map((source) => source.id);
    expect(ids).not.toContain("ci1.lastName");
    expect(ids).not.toContain("ci1.cf_hidden");
    expect(ids).not.toContain("rating");
    expect(ids).not.toContain("score");
  });

  test("offers earlier open text questions and hidden fields", () => {
    expect(sources).toContainEqual({ id: "ot1", label: "Why?" });
    expect(sources).toContainEqual({ id: "member_id", label: "Hidden: member_id" });
  });

  test("offers only earlier questions", () => {
    const early = getPrefillSources(survey, "ot1", "default", (name) => name).map((source) => source.id);
    expect(early).not.toContain("ot2");
    expect(early).not.toContain("ot1");
  });
});
