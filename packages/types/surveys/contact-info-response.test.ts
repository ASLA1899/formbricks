import { describe, expect, test } from "vitest";
import { normalizeContactInfoResponse } from "./contact-info-response";
import { resolveContactInfoFieldOrder } from "./contact-info-response";

describe("normalizeContactInfoResponse", () => {
  test("returns object-format responses unchanged, including custom field keys", () => {
    const value = { firstName: "Ada", cf_title: "Dr." };
    expect(normalizeContactInfoResponse(value)).toEqual(value);
  });

  test("converts legacy positional arrays to named fields", () => {
    expect(normalizeContactInfoResponse(["Ada", "Lovelace", "ada@example.com", "555", "ASLA"])).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "555",
      company: "ASLA",
    });
  });

  test("fills missing legacy positions with empty strings", () => {
    expect(normalizeContactInfoResponse(["Ada"])).toEqual({
      firstName: "Ada",
      lastName: "",
      email: "",
      phone: "",
      company: "",
    });
  });

  test.each([null, undefined, "text", 42])("returns null for %s", (value) => {
    expect(normalizeContactInfoResponse(value)).toBeNull();
  });
});

describe("resolveContactInfoFieldOrder", () => {
  test("defaults to built-ins then custom fields", () => {
    expect(resolveContactInfoFieldOrder(undefined, ["a"])).toEqual([
      "firstName",
      "lastName",
      "email",
      "phone",
      "company",
      "a",
    ]);
  });

  test("appends fields added after a reorder and drops unknown ids", () => {
    expect(resolveContactInfoFieldOrder(["email", "a", "gone", "firstName"], ["a", "b"])).toEqual([
      "email",
      "a",
      "firstName",
      "lastName",
      "phone",
      "company",
      "b",
    ]);
  });
});
