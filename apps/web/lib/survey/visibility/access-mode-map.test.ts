import { describe, expect, test } from "vitest";
import { accessModeForVisibility, visibilityForAccessMode } from "./access-mode-map";

describe("access mode <-> visibility", () => {
  test("private is restricted and public is workspace", () => {
    expect(visibilityForAccessMode("private")).toBe("restricted");
    expect(visibilityForAccessMode("public")).toBe("workspace");
  });

  test("the two mappings are inverses", () => {
    for (const mode of ["private", "public"] as const) {
      expect(accessModeForVisibility(visibilityForAccessMode(mode))).toBe(mode);
    }
  });
});
