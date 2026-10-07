import { describe, expect, test } from "vitest";
import {
  ADDRESS_DISPLAY_FIELDS,
  ADDRESS_FIELDS,
  ALL_COMPOUND_FIELD_INDICES,
  getAddressValuesInDisplayOrder,
  getCompoundFields,
} from "@formbricks/types/surveys/compound-fields";

describe("address compound fields", () => {
  test("storage order keeps the original six fields first and appends name and organization", () => {
    expect(ADDRESS_FIELDS).toEqual([
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "zip",
      "country",
      "name",
      "organization",
    ]);
    expect(ALL_COMPOUND_FIELD_INDICES.addressLine1).toBe(0);
    expect(ALL_COMPOUND_FIELD_INDICES.country).toBe(5);
    expect(ALL_COMPOUND_FIELD_INDICES.name).toBe(6);
    expect(ALL_COMPOUND_FIELD_INDICES.organization).toBe(7);
  });

  test("indices match storage order", () => {
    ADDRESS_FIELDS.forEach((field, index) => {
      expect(ALL_COMPOUND_FIELD_INDICES[field]).toBe(index);
    });
  });

  test("display order is mailing-label order and covers every stored field", () => {
    expect(ADDRESS_DISPLAY_FIELDS.slice(0, 3)).toEqual(["name", "organization", "addressLine1"]);
    expect([...ADDRESS_DISPLAY_FIELDS].sort()).toEqual([...ADDRESS_FIELDS].sort());
    expect(getCompoundFields("address")).toEqual(ADDRESS_DISPLAY_FIELDS);
  });

  describe("getAddressValuesInDisplayOrder", () => {
    test("moves name and organization to the front", () => {
      const stored = ["1 Main St", "Suite 2", "Austin", "TX", "78701", "USA", "Jane Doe", "ASLA"];
      expect(getAddressValuesInDisplayOrder(stored)).toEqual([
        "Jane Doe",
        "ASLA",
        "1 Main St",
        "Suite 2",
        "Austin",
        "TX",
        "78701",
        "USA",
      ]);
    });

    test("treats legacy 6-element arrays as having empty name and organization", () => {
      const legacy = ["1 Main St", "", "Austin", "TX", "78701", "USA"];
      expect(getAddressValuesInDisplayOrder(legacy)).toEqual([
        "",
        "",
        "1 Main St",
        "",
        "Austin",
        "TX",
        "78701",
        "USA",
      ]);
    });

    test("coerces non-string entries to empty strings", () => {
      expect(getAddressValuesInDisplayOrder([null, undefined, 5])).toEqual(
        Array.from({ length: ADDRESS_DISPLAY_FIELDS.length }, () => "")
      );
    });
  });
});
