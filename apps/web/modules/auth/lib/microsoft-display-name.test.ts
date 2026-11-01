import { describe, expect, test } from "vitest";
import { sanitizeMicrosoftDisplayName } from "./microsoft-display-name";

describe("sanitizeMicrosoftDisplayName", () => {
  test("reorders Entra's 'Last, First' to 'First Last'", () => {
    expect(sanitizeMicrosoftDisplayName("Lovelace, Ada")).toBe("Ada Lovelace");
  });

  test("keeps a name without commas as is", () => {
    expect(sanitizeMicrosoftDisplayName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  test("replaces commas that are not a single Last, First pair with spaces", () => {
    expect(sanitizeMicrosoftDisplayName("Lovelace, Ada, Countess")).toBe("Lovelace Ada Countess");
    expect(sanitizeMicrosoftDisplayName(", Ada")).toBe("Ada");
    expect(sanitizeMicrosoftDisplayName("Ada,")).toBe("Ada");
  });

  test("collapses whitespace and trims", () => {
    expect(sanitizeMicrosoftDisplayName("  Lovelace ,   Ada  ")).toBe("Ada Lovelace");
  });

  test("returns undefined when nothing is left, so the caller can fall back to the email local part", () => {
    expect(sanitizeMicrosoftDisplayName(undefined)).toBeUndefined();
    expect(sanitizeMicrosoftDisplayName(null)).toBeUndefined();
    expect(sanitizeMicrosoftDisplayName("")).toBeUndefined();
    expect(sanitizeMicrosoftDisplayName(" , ")).toBeUndefined();
  });
});
