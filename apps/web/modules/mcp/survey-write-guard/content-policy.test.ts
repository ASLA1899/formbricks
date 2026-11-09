import { describe, expect, test, vi } from "vitest";
import {
  MCP_ALLOWED_ELEMENT_TYPES,
  type TSurveyContentPolicy,
  findSurveyContentViolations,
  topLevelBlocks,
} from "./content-policy";

vi.mock("server-only", () => ({}));

const POLICY: TSurveyContentPolicy = {
  allowedMediaHosts: new Set(["assets.aslalabs.org"]),
  isStorageUrl: (url) =>
    url.startsWith("/storage/") || url.startsWith("https://surveys.example.org/storage/"),
};

const check = (document: unknown) =>
  findSurveyContentViolations({ document, blocks: topLevelBlocks(document) }, POLICY);

const withElement = (element: Record<string, unknown>) => ({
  blocks: [{ name: "B", elements: [{ id: "e", type: "openText", ...element }] }],
});

describe("element types (Must 5)", () => {
  test("accepts every first-release type", () => {
    const document = {
      blocks: [
        { elements: [...MCP_ALLOWED_ELEMENT_TYPES].map((type, index) => ({ id: `e${index}`, type })) },
      ],
    };
    expect(check(document)).toEqual([]);
  });

  test.each(["fileUpload", "cal", "address", "contactInfo", "somethingNew"])("refuses %s", (type) => {
    expect(check({ blocks: [{ elements: [{ id: "e", type }] }] })).toEqual([
      expect.objectContaining({ path: "blocks.0.elements.0.type" }),
    ]);
  });

  test("refuses an element with no type", () => {
    expect(check({ blocks: [{ elements: [{ id: "e" }] }] })).toHaveLength(1);
  });
});

describe("media URLs (Must 5)", () => {
  test.each([
    ["a storage path", "/storage/ws/public/a.png"],
    ["an absolute storage URL", "https://surveys.example.org/storage/ws/public/a.png"],
    ["the allowed host", "https://assets.aslalabs.org/x/a.png"],
    ["an empty value", ""],
  ])("accepts %s", (_label, imageUrl) => {
    expect(check(withElement({ imageUrl }))).toEqual([]);
  });

  test.each([
    ["another host", "https://example.com/a.png"],
    ["an allowed host over http", "http://assets.aslalabs.org/a.png"],
    ["a lookalike subdomain", "https://assets.aslalabs.org.evil.com/a.png"],
    ["a port", "https://assets.aslalabs.org:8443/a.png"],
    ["credentials", "https://user:pw@assets.aslalabs.org/a.png"],
    ["a data URI", "data:image/png;base64,AAAA"],
    ["a non-storage relative path", "/images/a.png"],
  ])("refuses %s", (_label, imageUrl) => {
    expect(check(withElement({ imageUrl }))).toEqual([
      expect.objectContaining({ path: "blocks.0.elements.0.imageUrl" }),
    ]);
  });

  test("checks picture choices, welcome card, endings, video and metadata", () => {
    const outside = "https://example.com/x";
    const violations = check({
      blocks: [
        { elements: [{ id: "p", type: "pictureSelection", choices: [{ id: "c", imageUrl: outside }] }] },
      ],
      welcomeCard: { fileUrl: outside, videoUrl: outside },
      endings: [{ type: "endScreen", imageUrl: outside }],
      metadata: { ogImage: outside },
    });
    expect(violations.map(({ path }) => path)).toEqual([
      "blocks.0.elements.0.choices.0.imageUrl",
      "welcomeCard.fileUrl",
      "welcomeCard.videoUrl",
      "endings.0.imageUrl",
      "metadata.ogImage",
    ]);
  });

  test("a URL-shaped field nobody listed is held to the media rule", () => {
    expect(check({ welcomeCard: { someFutureImage: "https://example.com/a.png" } })).toHaveLength(1);
  });

  test("a styling logo url and an image background are media, a color background is not", () => {
    expect(
      check({
        styling: {
          logo: { url: "https://example.com/logo.png" },
          background: { bgType: "image", bg: "https://example.com/bg.png" },
          cardBackground: { bgType: "color", bg: "#ffffff" },
        },
      }).map(({ path }) => path)
    ).toEqual(["styling.logo.url", "styling.background.bg"]);
  });
});

describe("links (Must 5)", () => {
  test("a CTA button URL must be https", () => {
    expect(check(withElement({ type: "cta", buttonUrl: "https://asla.org" }))).toEqual([]);
    expect(check(withElement({ type: "cta", buttonUrl: "http://asla.org" }))).toHaveLength(1);
    expect(check(withElement({ type: "cta", buttonUrl: "javascript:alert(1)" }))).toHaveLength(1);
  });

  test("an ending button link and a redirect ending must be https, to any host", () => {
    expect(
      check({
        endings: [
          { type: "endScreen", buttonLink: "https://asla.org/thanks" },
          { type: "redirectToUrl", url: "https://asla.org/next" },
        ],
      })
    ).toEqual([]);
    expect(check({ endings: [{ type: "redirectToUrl", url: "http://asla.org" }] })).toHaveLength(1);
  });
});

describe("rich text (Must 5)", () => {
  const headline = (html: string) => withElement({ headline: { default: html } });

  test("plain text with a URL in it is not a load", () => {
    expect(check(headline("Read more at https://example.com"))).toEqual([]);
  });

  test.each([
    ['<img src="https://example.com/a.png">'],
    ["<img src='https://example.com/a.png'>"],
    ["<img src=https://example.com/a.png>"],
    ['<img srcset="/storage/ws/public/a.png 1x, https://example.com/b.png 2x">'],
    ['<video poster="https://example.com/p.png"></video>'],
    ['<p style="background:url(https://example.com/t.png)">x</p>'],
    ['<a href="http://asla.org">link</a>'],
  ])("refuses %s", (html) => {
    expect(check(headline(html)).length).toBeGreaterThan(0);
  });

  test.each([
    ['<p><img src="/storage/ws/public/a.png" alt=""></p>'],
    ['<img src="https://assets.aslalabs.org/a.png">'],
    ['<a href="https://asla.org">link</a>'],
    ['<a href="mailto:info@asla.org">mail</a>'],
  ])("accepts %s", (html) => {
    expect(check(headline(html))).toEqual([]);
  });
});

test("reports at most 20 violations", () => {
  const blocks = Array.from({ length: 30 }, (_, index) => ({ elements: [{ id: `e${index}`, type: "cal" }] }));
  expect(check({ blocks })).toHaveLength(20);
});
