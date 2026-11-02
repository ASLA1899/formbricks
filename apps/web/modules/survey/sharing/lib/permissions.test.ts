import { beforeEach, describe, expect, test, vi } from "vitest";
import { can } from "@/lib/authorization";
import { getSurveyEditorPermissions } from "./permissions";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authorization", () => ({ can: vi.fn() }));

const allow = (granted: string[]) =>
  vi.mocked(can).mockImplementation(async (_actor, action) => granted.includes(action));

describe("getSurveyEditorPermissions", () => {
  beforeEach(() => vi.clearAllMocks());

  test("an owner can write and manage sharing", async () => {
    allow(["survey.write", "survey.change_visibility"]);
    expect(await getSurveyEditorPermissions("u1", "s1")).toEqual({ canManageSharing: true, canWrite: true });
  });

  test("a person the survey is shared with (read only) gets neither", async () => {
    allow(["survey.read"]);
    expect(await getSurveyEditorPermissions("u1", "s1")).toEqual({
      canManageSharing: false,
      canWrite: false,
    });
  });

  test("a writer who is not allowed to change visibility cannot manage sharing", async () => {
    allow(["survey.write"]);
    expect(await getSurveyEditorPermissions("u1", "s1")).toEqual({ canManageSharing: false, canWrite: true });
  });

  test("asks the graph about this user and this survey", async () => {
    allow([]);
    await getSurveyEditorPermissions("u1", "s1");
    expect(can).toHaveBeenCalledWith({ id: "u1", type: "user" }, "survey.write", {
      id: "s1",
      type: "survey",
    });
    expect(can).toHaveBeenCalledWith({ id: "u1", type: "user" }, "survey.change_visibility", {
      id: "s1",
      type: "survey",
    });
  });
});
