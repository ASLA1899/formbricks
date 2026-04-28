import { z } from "zod";

// Shared column mapping for Contact ingest paths (Snowflake sync, CSV import).
//
// Source columns (from a CSV header row or a Snowflake result row) need to map
// onto either a typed Contact column (`email`, `externalId`) or a
// ContactAttributeKey. The matcher normalizes headers, checks built-in aliases,
// then falls back to fuzzy matching against existing attribute keys, and finally
// flags unmapped columns for user review.
//
// This module is consumed by:
//   - The Snowflake sync runner (config saved on ContactSync.columnMapping).
//   - The CSV importer in the Audiences UI / Recipients card.

// Header normalization: lowercase + strip non-alphanumeric characters.
// "Member ID" → "memberid"
// "member_id" → "memberid"
// "Member-ID (legal)" → "memberidlegal"
export const normalizeHeader = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");

// Built-in aliases — map normalized header strings to the canonical destination
// (a typed Contact column key). Extending this list adds smarter auto-detection
// without forcing operators to rename their CSV columns.
export const BUILTIN_ALIASES: Record<"email" | "externalId" | "firstName" | "lastName", string[]> = {
  email: ["email", "emailaddress", "emailaddr", "mail"],
  externalId: [
    "memberid",
    "membernumber",
    "membernum",
    "memberno",
    "customerid",
    "customernumber",
    "externalid",
    // NB: `id` was deliberately NOT included — it's too generic. ASLA's
    // Snowflake queries routinely select `member.id`, `organization.id`,
    // `survey.id`, etc. Auto-binding `id` to externalId would silently
    // misroute. Operators must explicitly map a literal `id` column.
  ],
  firstName: ["firstname", "first", "givenname", "fname"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
};

export type ColumnMatch =
  | { kind: "typed"; column: "email" | "externalId" | "firstName" | "lastName"; sourceHeader: string }
  | { kind: "attribute"; attributeKeyId: string; key: string; sourceHeader: string }
  | { kind: "unmapped"; sourceHeader: string };

// matchColumns returns one ColumnMatch per source header with the suggested
// destination. Caller is expected to render these in a UI step, allow user
// overrides, then persist the resolved mapping.
//
// Precedence:
//   1. Built-in typed aliases (email, externalId) — typed wins even if an
//      attribute key with the same normalized name exists. Post-Phase-1a we
//      want emails in the typed column, not as an attribute.
//   2. firstName / lastName aliases — prefer existing attribute key match if
//      one exists; otherwise unmapped (caller can create the key).
//   3. Direct attribute-key match (header normalizes to an existing key.key).
//   4. Unmapped.
export function matchColumns(
  sourceHeaders: string[],
  existingKeys: { id: string; key: string }[]
): ColumnMatch[] {
  const keysByNormalized = new Map(existingKeys.map((k) => [normalizeHeader(k.key), k]));

  return sourceHeaders.map((sourceHeader): ColumnMatch => {
    const normalized = normalizeHeader(sourceHeader);

    // Empty/whitespace-only headers can't safely match anything — bail out.
    // (Without this guard, an attribute key whose `.key` also normalizes to
    // empty would erroneously match.)
    if (normalized === "") {
      return { kind: "unmapped", sourceHeader };
    }

    if (BUILTIN_ALIASES.email.includes(normalized)) {
      return { kind: "typed", column: "email", sourceHeader };
    }
    if (BUILTIN_ALIASES.externalId.includes(normalized)) {
      return { kind: "typed", column: "externalId", sourceHeader };
    }
    // firstName / lastName: prefer attribute key match over typed (Phase 1a's
    // Contact has no typed firstName/lastName columns; those exist only via
    // attribute keys today).
    for (const [aliasGroup, aliases] of [
      ["firstName", BUILTIN_ALIASES.firstName] as const,
      ["lastName", BUILTIN_ALIASES.lastName] as const,
    ]) {
      if (aliases.includes(normalized)) {
        // Look up by the NORMALIZED form of the alias group name — the map is
        // keyed by normalized header strings, and `firstName` normalizes to
        // `firstname`.
        const existing = keysByNormalized.get(normalizeHeader(aliasGroup));
        if (existing) {
          return { kind: "attribute", attributeKeyId: existing.id, key: existing.key, sourceHeader };
        }
        return { kind: "unmapped", sourceHeader };
      }
    }

    // Direct attribute-key match (header normalizes to an existing key.key).
    const direct = keysByNormalized.get(normalized);
    if (direct) {
      return { kind: "attribute", attributeKeyId: direct.id, key: direct.key, sourceHeader };
    }

    return { kind: "unmapped", sourceHeader };
  });
}

// Persisted shape of a column mapping (stored as JSON on ContactSync.columnMapping
// or in audience CSV import config). Keys are SOURCE headers (preserving the
// raw header from the CSV / query), values describe the destination.
//
// We define this both as a TS type (for compile-time consumers) and as a Zod
// schema. Use `parseColumnMappingConfig(json)` at any persistence boundary
// where untyped JSON enters the system — silent misroutes are irreversible
// without a re-run from a corrected mapping, so a runtime parse is worth the
// few extra lines.
export const ZColumnMappingDest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("typed"),
    column: z.enum(["email", "externalId", "firstName", "lastName"]),
  }),
  z.object({
    kind: z.literal("attribute"),
    attributeKeyId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("skip"),
  }),
]);

export const ZColumnMappingConfig = z.record(z.string(), ZColumnMappingDest);

export type ColumnMappingConfig = z.infer<typeof ZColumnMappingConfig>;

// Parse a saved JSON mapping. Throws a descriptive ZodError if the shape is
// wrong (callers are expected to surface this clearly — a sync run with a
// broken mapping should fail loudly rather than silently no-op).
export function parseColumnMappingConfig(input: unknown): ColumnMappingConfig {
  return ZColumnMappingConfig.parse(input);
}
