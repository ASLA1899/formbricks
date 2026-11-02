import { describe, expect, test } from "vitest";
import { ADDRESS_DISPLAY_FIELDS, ADDRESS_FIELDS, getAddressValuesInDisplayOrder } from "./address-fields";

describe("address fields", () => {
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
  });

  test("display order is mailing-label order and covers every stored field", () => {
    expect(ADDRESS_DISPLAY_FIELDS.slice(0, 3)).toEqual(["name", "organization", "addressLine1"]);
    expect([...ADDRESS_DISPLAY_FIELDS].sort()).toEqual([...ADDRESS_FIELDS].sort());
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
