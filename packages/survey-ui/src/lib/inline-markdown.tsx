import * as React from "react";

export type InlineSegment = { type: "text"; value: string } | { type: "link"; label: string; url: string };

// Matches [label](url): label has no `]` or newline; url has no whitespace or `)`.
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Split a string into text + link segments using markdown link syntax `[label](url)`.
 * URLs that are not http(s) or mailto fall back to plain text.
 */
export function parseInlineMarkdown(text: string): InlineSegment[] {
  if (!text) return [];
  const segments: InlineSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MD_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    const [full, label, url] = match;
    if (isSafeUrl(url)) {
      segments.push({ type: "link", label, url });
    } else {
      segments.push({ type: "text", value: full });
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Render a string with inline `[label](url)` links. Anchor clicks call stopPropagation
 * so they don't toggle the surrounding radio/checkbox or close a dropdown.
 */
export function renderInlineMarkdown(text: string | undefined): React.ReactNode {
  if (!text) return text;
  if (!text.includes("](")) return text;

  const segments = parseInlineMarkdown(text);
  if (!segments.some((s) => s.type === "link")) return text;

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "link" ? (
          <a
            key={`md-link-${i.toString()}`}
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            onClick={(e) => {
              e.stopPropagation();
            }}>
            {seg.label}
          </a>
        ) : (
          <React.Fragment key={`md-text-${i.toString()}`}>{seg.value}</React.Fragment>
        )
      )}
    </>
  );
}
