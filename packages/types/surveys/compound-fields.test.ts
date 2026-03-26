import { describe, expect, test } from "vitest";
import { getCompoundFields, getCompoundSubFieldValue, hasCompoundValue } from "./compound-fields";

describe("getCompoundSubFieldValue", () => {
  test("reads built-in and custom fields from the object contact-info format", () => {
    const answer = { firstName: "Ada", email: "ada@example.org", cf_1: "Chicago" };
    expect(getCompoundSubFieldValue(answer, "firstName")).toBe("Ada");
    expect(getCompoundSubFieldValue(answer, "cf_1")).toBe("Chicago");
    expect(getCompoundSubFieldValue(answer, "lastName")).toBeUndefined();
  });

  test("reads the legacy 5-slot contact-info array", () => {
    const answer = ["Ada", "Lovelace", "ada@example.org", "", "ASLA"];
    expect(getCompoundSubFieldValue(answer, "lastName")).toBe("Lovelace");
    expect(getCompoundSubFieldValue(answer, "company")).toBe("ASLA");
    expect(getCompoundSubFieldValue(answer, "phone")).toBeUndefined();
  });

  test("reads the address array in storage order, with name and organization last", () => {
    const answer = ["1 Main St", "", "Denver", "CO", "80202", "US", "Ada", "ASLA"];
    expect(getCompoundSubFieldValue(answer, "addressLine1")).toBe("1 Main St");
    expect(getCompoundSubFieldValue(answer, "city")).toBe("Denver");
    expect(getCompoundSubFieldValue(answer, "name")).toBe("Ada");
    expect(getCompoundSubFieldValue(answer, "organization")).toBe("ASLA");
  });

  test("an older 6-slot address has no name or organization", () => {
    expect(
      getCompoundSubFieldValue(["1 Main St", "", "Denver", "CO", "80202", "US"], "name")
    ).toBeUndefined();
  });

  test("returns undefined for strings, nullish values and unknown fields", () => {
    expect(getCompoundSubFieldValue("text", "firstName")).toBeUndefined();
    expect(getCompoundSubFieldValue(undefined, "firstName")).toBeUndefined();
    expect(getCompoundSubFieldValue(["a"], "nope")).toBeUndefined();
  });
});

describe("hasCompoundValue / getCompoundFields", () => {
  test("detects any non-empty sub-field", () => {
    expect(hasCompoundValue(["", ""])).toBe(false);
    expect(hasCompoundValue({ firstName: "", email: "" })).toBe(false);
    expect(hasCompoundValue({ firstName: "Ada" })).toBe(true);
    expect(hasCompoundValue(["", "x"])).toBe(true);
  });

  test("lists fields only for compound types", () => {
    expect(getCompoundFields("contactInfo")).toContain("company");
    expect(getCompoundFields("address")).toContain("organization");
    expect(getCompoundFields("openText")).toBeNull();
  });
});
