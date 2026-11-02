import { beforeEach, describe, expect, test, vi } from "vitest";
import { ResourceNotFoundError } from "@formbricks/types/errors";
import { assertCan } from "@/lib/authorization";
import {
  createOptionList,
  deleteOptionList,
  getOptionList,
  getOptionListsByWorkspaceId,
} from "@/modules/survey/editor/lib/option-list";
import { createOptionListAction, deleteOptionListAction, getOptionListsAction } from "./option-list-actions";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/utils/action-client", () => ({
  authenticatedActionClient: {
    inputSchema: vi.fn().mockReturnThis(),
    action: vi.fn((fn) => fn),
  },
}));
vi.mock("@/lib/authorization", () => ({ assertCan: vi.fn() }));
vi.mock("@/modules/core/rate-limit/helpers", () => ({ applyRateLimit: vi.fn() }));
vi.mock("@/modules/core/rate-limit/rate-limit-configs", () => ({
  rateLimitConfigs: { actions: { stateMutation: {} } },
}));
vi.mock("@/modules/survey/editor/lib/option-list", () => ({
  createOptionList: vi.fn(),
  deleteOptionList: vi.fn(),
  getOptionList: vi.fn(),
  getOptionListsByWorkspaceId: vi.fn(),
}));

const run = (action: unknown, parsedInput: object) =>
  (action as (args: object) => Promise<unknown>)({ ctx: { user: { id: "user1" } }, parsedInput });

const actor = { type: "user", id: "user1" };
const workspace = (id: string) => ({ type: "workspace", id });

describe("option list actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("reading needs workspace.read on the workspace", async () => {
    vi.mocked(getOptionListsByWorkspaceId).mockResolvedValue([]);

    await run(getOptionListsAction, { workspaceId: "ws1" });

    expect(assertCan).toHaveBeenCalledWith(actor, "workspace.read", workspace("ws1"));
    expect(getOptionListsByWorkspaceId).toHaveBeenCalledWith("ws1");
  });

  test("a denied read returns no lists", async () => {
    vi.mocked(assertCan).mockRejectedValue(new Error("forbidden"));

    await expect(run(getOptionListsAction, { workspaceId: "ws1" })).rejects.toThrow("forbidden");
    expect(getOptionListsByWorkspaceId).not.toHaveBeenCalled();
  });

  test("creating needs workspace.write and does not create when denied", async () => {
    vi.mocked(assertCan).mockRejectedValue(new Error("forbidden"));

    await expect(
      run(createOptionListAction, { workspaceId: "ws1", name: "Chapters", options: ["A"] })
    ).rejects.toThrow("forbidden");
    expect(assertCan).toHaveBeenCalledWith(actor, "workspace.write", workspace("ws1"));
    expect(createOptionList).not.toHaveBeenCalled();
  });

  test("creating writes to the authorized workspace", async () => {
    await run(createOptionListAction, { workspaceId: "ws1", name: "Chapters", options: ["A", "B"] });

    expect(createOptionList).toHaveBeenCalledWith("ws1", { name: "Chapters", options: ["A", "B"] });
  });

  test("deleting authorizes against the workspace that owns the list, not a caller-supplied one", async () => {
    vi.mocked(getOptionList).mockResolvedValue({ id: "list1", workspaceId: "wsOwner" } as never);

    await run(deleteOptionListAction, { optionListId: "list1" });

    expect(assertCan).toHaveBeenCalledWith(actor, "workspace.write", workspace("wsOwner"));
    expect(deleteOptionList).toHaveBeenCalledWith("list1");
  });

  test("deleting does nothing when the caller cannot write to the owning workspace", async () => {
    vi.mocked(getOptionList).mockResolvedValue({ id: "list1", workspaceId: "wsOwner" } as never);
    vi.mocked(assertCan).mockRejectedValue(new Error("forbidden"));

    await expect(run(deleteOptionListAction, { optionListId: "list1" })).rejects.toThrow("forbidden");
    expect(deleteOptionList).not.toHaveBeenCalled();
  });

  test("deleting an unknown list is a not-found error", async () => {
    vi.mocked(getOptionList).mockResolvedValue(null);

    await expect(run(deleteOptionListAction, { optionListId: "missing" })).rejects.toThrow(
      ResourceNotFoundError
    );
    expect(assertCan).not.toHaveBeenCalled();
  });
});
