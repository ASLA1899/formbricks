import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { Prisma } from "@formbricks/database/prisma";
import { DatabaseError, UniqueConstraintError } from "@formbricks/types/errors";
import {
  createOptionList,
  deleteOptionList,
  getOptionList,
  getOptionListsByWorkspaceId,
} from "./option-list";

vi.mock("@formbricks/database", () => ({
  prisma: {
    optionList: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test" });

const row = {
  id: "list1",
  createdAt: new Date(),
  updatedAt: new Date(),
  name: "Chapters",
  options: ["A", "B"],
  workspaceId: "ws1",
};

describe("option-list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("lists a workspace's lists by name, scoped to that workspace", async () => {
    vi.mocked(prisma.optionList.findMany).mockResolvedValue([row]);

    await expect(getOptionListsByWorkspaceId("ws1")).resolves.toEqual([row]);
    expect(prisma.optionList.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws1" },
      orderBy: { name: "asc" },
    });
  });

  test("getOptionList returns null for an unknown id", async () => {
    vi.mocked(prisma.optionList.findUnique).mockResolvedValue(null);
    await expect(getOptionList("missing")).resolves.toBeNull();
  });

  test("creates a list in the given workspace", async () => {
    vi.mocked(prisma.optionList.create).mockResolvedValue(row);

    await expect(createOptionList("ws1", { name: "Chapters", options: ["A", "B"] })).resolves.toEqual(row);
    expect(prisma.optionList.create).toHaveBeenCalledWith({
      data: { workspaceId: "ws1", name: "Chapters", options: ["A", "B"] },
    });
  });

  test("a duplicate name in the workspace is a unique-constraint error", async () => {
    vi.mocked(prisma.optionList.create).mockRejectedValue(knownError("P2002"));

    await expect(createOptionList("ws1", { name: "Chapters", options: ["A"] })).rejects.toThrow(
      UniqueConstraintError
    );
  });

  test("other database errors become DatabaseError", async () => {
    vi.mocked(prisma.optionList.create).mockRejectedValue(knownError("P2003"));
    vi.mocked(prisma.optionList.delete).mockRejectedValue(knownError("P2025"));
    vi.mocked(prisma.optionList.findMany).mockRejectedValue(knownError("P1001"));

    await expect(createOptionList("ws1", { name: "x", options: ["A"] })).rejects.toThrow(DatabaseError);
    await expect(deleteOptionList("list1")).rejects.toThrow(DatabaseError);
    await expect(getOptionListsByWorkspaceId("ws1")).rejects.toThrow(DatabaseError);
  });

  test("unexpected errors are not swallowed", async () => {
    const error = new Error("network");
    vi.mocked(prisma.optionList.findUnique).mockRejectedValue(error);
    await expect(getOptionList("list1")).rejects.toBe(error);
  });
});
