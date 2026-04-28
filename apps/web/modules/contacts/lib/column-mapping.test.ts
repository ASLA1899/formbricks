import { describe, expect, test } from "vitest";
import { BUILTIN_ALIASES, type ColumnMatch, matchColumns, normalizeHeader } from "./column-mapping";

describe("normalizeHeader", () => {
  test("lowercases and strips non-alphanumerics", () => {
    expect(normalizeHeader("Member ID")).toBe("memberid");
    expect(normalizeHeader("member_id")).toBe("memberid");
    expect(normalizeHeader("MemberID")).toBe("memberid");
    expect(normalizeHeader("E-Mail")).toBe("email");
    expect(normalizeHeader("First Name (legal)")).toBe("firstnamelegal");
  });

  test("preserves existing alphanumeric content", () => {
    expect(normalizeHeader("custom_field_42")).toBe("customfield42");
  });
});

describe("BUILTIN_ALIASES", () => {
  test("recognizes common email variants", () => {
    expect(BUILTIN_ALIASES.email).toContain("email");
    expect(BUILTIN_ALIASES.email).toContain("emailaddress");
  });

  test("recognizes common externalId variants", () => {
    expect(BUILTIN_ALIASES.externalId).toContain("memberid");
    expect(BUILTIN_ALIASES.externalId).toContain("membernumber");
  });
});

describe("matchColumns", () => {
  const existingKeys = [
    { id: "k1", key: "email" },
    { id: "k2", key: "firstName" },
    { id: "k3", key: "memberId" },
    { id: "k4", key: "region" },
  ];

  test("auto-maps exact normalized matches against existing keys", () => {
    const matches: ColumnMatch[] = matchColumns(["region", "Region", "REGION"], existingKeys);
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      expect(m.kind).toBe("attribute");
      if (m.kind === "attribute") expect(m.attributeKeyId).toBe("k4");
    }
  });

  test("auto-maps via builtin aliases for typed columns (email)", () => {
    const matches = matchColumns(["E-Mail Address"], existingKeys);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("typed");
    if (matches[0].kind === "typed") expect(matches[0].column).toBe("email");
  });

  test("auto-maps via builtin aliases for typed columns (externalId)", () => {
    const matches = matchColumns(["Member Number"], existingKeys);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("typed");
    if (matches[0].kind === "typed") expect(matches[0].column).toBe("externalId");
  });

  test("flags unmapped columns as 'unmapped'", () => {
    const matches = matchColumns(["UnknownField"], existingKeys);
    expect(matches[0].kind).toBe("unmapped");
    expect(matches[0].sourceHeader).toBe("UnknownField");
  });

  test("preserves source header casing in result", () => {
    const matches = matchColumns(["Region"], existingKeys);
    expect(matches[0].sourceHeader).toBe("Region");
  });

  test("firstName alias prefers existing attribute key match", () => {
    const matches = matchColumns(["First Name"], existingKeys);
    expect(matches[0].kind).toBe("attribute");
    if (matches[0].kind === "attribute") {
      expect(matches[0].attributeKeyId).toBe("k2");
      expect(matches[0].key).toBe("firstName");
    }
  });

  test("typed-column aliases win over a same-name attribute key", () => {
    // If an environment has an attribute key called "email", typed column
    // should still win — we want emails in the typed column, not as an
    // attribute, post-Phase-1a.
    const matches = matchColumns(["email"], existingKeys);
    expect(matches[0].kind).toBe("typed");
    if (matches[0].kind === "typed") expect(matches[0].column).toBe("email");
  });
});
