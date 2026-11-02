import { describe, expect, test } from "vitest";
import { isSsoEmailDomainAllowed, parseSsoAllowedEmailDomains } from "./sso-email-domain";

describe("parseSsoAllowedEmailDomains", () => {
  test("trims, lower-cases and drops empty entries", () => {
    expect(parseSsoAllowedEmailDomains(" ASLA.org, aslafund.org ,, ")).toEqual(["asla.org", "aslafund.org"]);
  });

  test("returns an empty list for unset or blank input", () => {
    expect(parseSsoAllowedEmailDomains(undefined)).toEqual([]);
    expect(parseSsoAllowedEmailDomains(null)).toEqual([]);
    expect(parseSsoAllowedEmailDomains("  ")).toEqual([]);
  });
});

describe("isSsoEmailDomainAllowed", () => {
  const allowed = ["asla.org", "aslafund.org"];

  test("an empty allowlist imposes no restriction", () => {
    expect(isSsoEmailDomainAllowed("anyone@gmail.com", [])).toBe(true);
    expect(isSsoEmailDomainAllowed(undefined, [])).toBe(true);
  });

  test("admits an exact domain match, ignoring case", () => {
    expect(isSsoEmailDomainAllowed("jane@asla.org", allowed)).toBe(true);
    expect(isSsoEmailDomainAllowed("Jane@ASLAFUND.org", allowed)).toBe(true);
  });

  test("refuses a domain that is not listed", () => {
    expect(isSsoEmailDomainAllowed("guest@gmail.com", allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("guest@contractor.onmicrosoft.com", allowed)).toBe(false);
  });

  test("refuses subdomains and lookalikes", () => {
    expect(isSsoEmailDomainAllowed("a@evil.asla.org", allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("a@asla.org.evil.com", allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("a@notasla.org", allowed)).toBe(false);
  });

  test("uses the part after the last @, so a quoted local part cannot smuggle an allowed domain", () => {
    expect(isSsoEmailDomainAllowed('"x@asla.org"@evil.com', allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("evil@asla.org@evil.com", allowed)).toBe(false);
  });

  test("refuses a missing, malformed or domain-less address when an allowlist is configured", () => {
    expect(isSsoEmailDomainAllowed(undefined, allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed(null, allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("", allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("no-at-sign", allowed)).toBe(false);
    expect(isSsoEmailDomainAllowed("trailing@", allowed)).toBe(false);
  });
});
