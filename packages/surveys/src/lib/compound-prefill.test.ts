import { describe, expect, test } from "vitest";
import { TSurveyElement } from "@formbricks/types/surveys/elements";
import { computeConfiguredPrefill, getBlockPrefill, resolvePrefillSource } from "./compound-prefill";

const toggle = (prefillFrom?: string) => ({
  show: true,
  required: false,
  placeholder: { default: "" },
  prefillFrom,
});

const contactInfo = {
  id: "ci2",
  type: "contactInfo",
  headline: { default: "Contact" },
  firstName: toggle("ci1.firstName"),
  lastName: toggle(),
  email: toggle("hf_email"),
  phone: toggle(),
  company: toggle(),
  customFields: [
    {
      id: "cf_city",
      label: "City",
      type: "text",
      show: true,
      required: false,
      placeholder: { default: "" },
      prefillFrom: "ci1.cf_city",
    },
  ],
} as unknown as TSurveyElement;

const address = {
  id: "addr",
  type: "address",
  headline: { default: "Address" },
  name: toggle("ci1.firstName"),
  organization: toggle("ci1.company"),
  addressLine1: toggle(),
  addressLine2: toggle(),
  city: toggle("ci1.cf_city"),
  state: toggle(),
  zip: toggle(),
  country: toggle(),
} as unknown as TSurveyElement;

const openText = {
  id: "ot",
  type: "openText",
  headline: { default: "Name?" },
  prefillFrom: "ci1.lastName",
} as unknown as TSurveyElement;

const data = {
  ci1: { firstName: "Ada", lastName: "Lovelace", company: "ASLA", cf_city: "Chicago" },
  hf_email: "ada@example.org",
};

describe("resolvePrefillSource", () => {
  test("resolves sub-field and plain sources", () => {
    expect(resolvePrefillSource("ci1.firstName", data)).toBe("Ada");
    expect(resolvePrefillSource("hf_email", data)).toBe("ada@example.org");
    expect(resolvePrefillSource("ci1.missing", data)).toBeUndefined();
    expect(resolvePrefillSource("ci1", data)).toBeUndefined();
  });
});

describe("computeConfiguredPrefill", () => {
  test("contact info pre-fills built-in and custom fields as an object", () => {
    expect(computeConfiguredPrefill([contactInfo], data).ci2).toEqual({
      firstName: "Ada",
      email: "ada@example.org",
      cf_city: "Chicago",
    });
  });

  test("address pre-fills the storage-order array, including name and organization", () => {
    expect(computeConfiguredPrefill([address], data).addr).toEqual([
      "", // addressLine1
      "",
      "Chicago", // city
      "",
      "",
      "",
      "Ada", // name
      "ASLA", // organization
    ]);
  });

  test("open text pre-fills a string", () => {
    expect(computeConfiguredPrefill([openText], data).ot).toBe("Lovelace");
  });

  test("never overwrites an existing answer", () => {
    const answered = { ...data, ci2: { firstName: "Grace" }, ot: "Hopper" };
    expect(computeConfiguredPrefill([contactInfo, openText], answered)).toEqual({});
  });

  test("returns nothing when no source resolves", () => {
    expect(computeConfiguredPrefill([contactInfo, address, openText], {})).toEqual({});
  });
});

describe("getBlockPrefill", () => {
  test("URL pre-fill wins over configured pre-fill", () => {
    expect(getBlockPrefill([openText], data, { ot: "from-url" })).toEqual({ ot: "from-url" });
  });

  test("returns the URL pre-fill untouched when nothing is configured", () => {
    const url = { x: "1" };
    expect(getBlockPrefill([], data, url)).toBe(url);
    expect(getBlockPrefill([], data, undefined)).toBeUndefined();
  });
});
