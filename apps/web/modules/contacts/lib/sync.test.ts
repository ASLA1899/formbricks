import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import { runContactSync } from "./sync";

vi.mock("@formbricks/database", () => ({
  prisma: {
    contactSync: { findUnique: vi.fn(), update: vi.fn() },
    contactSyncRun: { create: vi.fn(), update: vi.fn() },
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    contactAttribute: { upsert: vi.fn() },
  },
}));

vi.mock("@/app/api/member-lookup/configurable-query-service", () => ({
  executeConfiguredQueryAllRows: vi.fn(),
}));

vi.mock("@formbricks/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const baseSync = {
  id: "sync1",
  environmentId: "env1",
  snowflakeQueryId: "members",
  columnMapping: {
    EMAIL: { kind: "typed", column: "email" },
    MEMBER_ID: { kind: "typed", column: "externalId" },
    REGION: { kind: "attribute", attributeKeyId: "k_region" },
  },
  intervalMinutes: 60,
  enabled: true,
  lastRunAt: null,
  lastRunStatus: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.contactSync.findUnique as any).mockResolvedValue(baseSync);
  (prisma.contactSyncRun.create as any).mockResolvedValue({ id: "run1" });
  (prisma.contactSyncRun.update as any).mockResolvedValue({});
  (prisma.contactSync.update as any).mockResolvedValue({});
  (prisma.contact.updateMany as any).mockResolvedValue({ count: 0 });
});

describe("runContactSync", () => {
  test("creates new contact when no match by externalId or email", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "alice@example.com", MEMBER_ID: "M1", REGION: "NE" },
    ]);
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    (prisma.contact.create as any).mockResolvedValue({ id: "c1" });

    const result = await runContactSync("sync1");

    expect(result.rowsCreated).toBe(1);
    expect(result.rowsProcessed).toBe(1);
    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          environmentId: "env1",
          email: "alice@example.com",
          externalId: "M1",
          source: "snowflake",
        }),
      })
    );
  });

  test("updates existing snowflake contact and clears inactive flag", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "bob@example.com", MEMBER_ID: "M2", REGION: "MW" },
    ]);
    (prisma.contact.findFirst as any).mockResolvedValueOnce({
      id: "c2",
      source: "snowflake",
      inactive: true,
    });

    const result = await runContactSync("sync1");

    expect(result.rowsUpdated).toBe(1);
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c2" },
        data: expect.objectContaining({ inactive: false, inactiveAt: null }),
      })
    );
  });

  test("skips manual contacts (does not update)", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "carol@example.com", MEMBER_ID: "M3", REGION: "S" },
    ]);
    // First findFirst (by externalId) returns null; second (by email) returns the manual contact.
    (prisma.contact.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "c3", source: "manual", inactive: false });

    const result = await runContactSync("sync1");

    expect(result.rowsUpdated).toBe(0);
    expect(result.rowsCreated).toBe(0);
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  test("deactivates snowflake contacts whose externalId is not in the result set", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "alice@example.com", MEMBER_ID: "M1", REGION: "NE" },
    ]);
    (prisma.contact.findFirst as any).mockResolvedValue({
      id: "c1",
      source: "snowflake",
      inactive: false,
    });
    (prisma.contact.updateMany as any).mockResolvedValue({ count: 5 });

    const result = await runContactSync("sync1");

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        environmentId: "env1",
        source: "snowflake",
        externalId: { notIn: ["M1"] },
        inactive: false,
      },
      data: expect.objectContaining({ inactive: true }),
    });
    expect(result.rowsDeactivated).toBe(5);
  });

  test("marks run as failed on error", async () => {
    (executeConfiguredQueryAllRows as any).mockRejectedValue(new Error("Snowflake timeout"));

    await expect(runContactSync("sync1")).rejects.toThrow("Snowflake timeout");

    expect(prisma.contactSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run1" },
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "Snowflake timeout",
        }),
      })
    );
    expect(prisma.contactSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sync1" },
        data: expect.objectContaining({ lastRunStatus: "failed" }),
      })
    );
  });
});
