import { describe, expect, test, vi } from "vitest";
import { backfillLegacySsoAccounts, normalizeLegacySsoProvider } from "./migration";

type TAccountRow = { id: string; provider: string; providerAccountId: string; userId: string };
type TUserRow = { id: string; identityProvider: string; identityProviderAccountId: string | null };

const sqlText = (strings: TemplateStringsArray): string => strings.join("?").replaceAll(/\s+/g, " ").trim();

/**
 * In-memory stand-in for the migration transaction, shaped like the ASLA fork's 4.9 data: NextAuth
 * wrote `Account.provider = 'azure-ad'` and the same oid into `User.identityProviderAccountId`.
 */
const createTx = (accounts: TAccountRow[], users: TUserRow[]) => {
  const writes: { sql: string; values: unknown[] }[] = [];
  return {
    writes,
    tx: {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = sqlText(strings);
        if (sql.includes(`FROM "Account" WHERE "provider" = 'azure-ad'`)) {
          return accounts.filter((a) => a.provider === "azure-ad");
        }
        if (sql.includes(`FROM "Account" WHERE "provider" IN`)) {
          return accounts.filter((a) =>
            ["google", "github", "azuread", "openid", "saml"].includes(a.provider)
          );
        }
        if (sql.includes(`FROM "User"`)) {
          const after = typeof values[0] === "string" ? values[0] : null; // else values[0] is the LIMIT
          return users.filter((u) => u.identityProvider !== "email" && (after === null || u.id > after));
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        writes.push({ sql: sqlText(strings), values });
        return 1;
      }),
    },
  };
};

describe("normalizeLegacySsoProvider", () => {
  test("maps the fork's NextAuth provider id azure-ad onto Better Auth's azuread", () => {
    expect(normalizeLegacySsoProvider("azure-ad")).toBe("azuread");
    expect(normalizeLegacySsoProvider("azuread")).toBe("azuread");
    expect(normalizeLegacySsoProvider("email")).toBeNull();
  });
});

describe("backfillLegacySsoAccounts with the ASLA fork's Azure rows", () => {
  test("renames an azure-ad Account row to azuread and does not insert a duplicate", async () => {
    const { tx, writes } = createTx(
      [{ id: "acc-1", provider: "azure-ad", providerAccountId: "oid-1", userId: "user-1" }],
      [{ id: "user-1", identityProvider: "azuread", identityProviderAccountId: "oid-1" }]
    );

    const stats = await backfillLegacySsoAccounts(tx as never);

    expect(stats).toMatchObject({ normalizedLegacyAccounts: 1, inserted: 0, skippedConflict: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain(`UPDATE "Account" SET "provider" = 'azuread'`);
    expect(writes[0].values).toEqual(["acc-1"]);
  });

  test("creates the missing Account for a user whose identity lives only on the User row", async () => {
    const { tx, writes } = createTx(
      [],
      [{ id: "user-2", identityProvider: "azuread", identityProviderAccountId: "oid-2" }]
    );

    const stats = await backfillLegacySsoAccounts(tx as never);

    expect(stats).toMatchObject({ inserted: 1, normalizedLegacyAccounts: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain(`INSERT INTO "Account"`);
    expect(writes[0].values).toEqual(expect.arrayContaining(["user-2", "azuread", "oid-2"]));
  });

  test("leaves a password user alone", async () => {
    const { tx, writes } = createTx(
      [],
      [{ id: "user-3", identityProvider: "email", identityProviderAccountId: null }]
    );

    const stats = await backfillLegacySsoAccounts(tx as never);

    expect(stats.scanned).toBe(0);
    expect(writes).toHaveLength(0);
  });

  test("is idempotent: a second run over already-migrated rows writes nothing", async () => {
    const { tx, writes } = createTx(
      [{ id: "acc-1", provider: "azuread", providerAccountId: "oid-1", userId: "user-1" }],
      [{ id: "user-1", identityProvider: "azuread", identityProviderAccountId: "oid-1" }]
    );

    const stats = await backfillLegacySsoAccounts(tx as never);

    expect(stats).toMatchObject({ inserted: 0, normalizedLegacyAccounts: 0, skippedExisting: 1 });
    expect(writes).toHaveLength(0);
  });

  test("never reassigns an oid that already belongs to a different user", async () => {
    const { tx, writes } = createTx(
      [
        { id: "acc-legacy", provider: "azure-ad", providerAccountId: "oid-9", userId: "user-a" },
        { id: "acc-canon", provider: "azuread", providerAccountId: "oid-9", userId: "user-b" },
      ],
      []
    );

    const stats = await backfillLegacySsoAccounts(tx as never);

    expect(stats.skippedConflict).toBe(1);
    expect(writes).toHaveLength(0);
  });
});
