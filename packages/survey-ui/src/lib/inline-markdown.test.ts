import { describe, expect, test } from "vitest";
import { parseInlineMarkdown } from "./inline-markdown";

describe("parseInlineMarkdown", () => {
  test("returns empty array for empty input", () => {
    expect(parseInlineMarkdown("")).toEqual([]);
  });

  test("returns single text segment when no links", () => {
    expect(parseInlineMarkdown("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });

  test("parses a single https link", () => {
    expect(parseInlineMarkdown("see [docs](https://example.com)")).toEqual([
      { type: "text", value: "see " },
      { type: "link", label: "docs", url: "https://example.com" },
    ]);
  });

  test("parses link followed by trailing text", () => {
    expect(parseInlineMarkdown("[a](https://x.test) tail")).toEqual([
      { type: "link", label: "a", url: "https://x.test" },
      { type: "text", value: " tail" },
    ]);
  });

  test("parses multiple links", () => {
    expect(parseInlineMarkdown("[a](https://x.test) and [b](http://y.test)")).toEqual([
      { type: "link", label: "a", url: "https://x.test" },
      { type: "text", value: " and " },
      { type: "link", label: "b", url: "http://y.test" },
    ]);
  });

  test("allows mailto links", () => {
    expect(parseInlineMarkdown("[email](mailto:foo@bar.com)")).toEqual([
      { type: "link", label: "email", url: "mailto:foo@bar.com" },
    ]);
  });

  test("rejects javascript: URLs (no link segment produced)", () => {
    const segments = parseInlineMarkdown("[x](javascript:alert%201)");
    expect(segments.some((s) => s.type === "link")).toBe(false);
    expect(segments.map((s) => (s.type === "text" ? s.value : "")).join("")).toBe(
      "[x](javascript:alert%201)"
    );
  });

  test("rejects data: URLs as plain text", () => {
    expect(parseInlineMarkdown("[x](data:text/html,foo)")).toEqual([
      { type: "text", value: "[x](data:text/html,foo)" },
    ]);
  });

  test("rejects malformed URLs as plain text", () => {
    expect(parseInlineMarkdown("[x](not a url)")).toEqual([{ type: "text", value: "[x](not a url)" }]);
  });

  test("does not match across newlines in label", () => {
    expect(parseInlineMarkdown("[a\nb](https://x.test)")).toEqual([
      { type: "text", value: "[a\nb](https://x.test)" },
    ]);
  });
});
