import { beforeEach, describe, expect, test, vi } from "vitest";
import { AuthorizationError } from "@formbricks/types/errors";
import { getSurveyShareWorkspaceId } from "@/lib/survey/visibility/shares";
import { assertCan, can } from ".";
import type { TAuthorizationActor, TAuthorizationResource } from "./contract";
import { authorizationCoordinator } from "./coordinator";

// Stub the evaluator so these tests exercise only the public interface + selection point.
vi.mock("./coordinator", () => ({ authorizationCoordinator: { can: vi.fn() } }));
vi.mock("@/lib/survey/visibility/shares", () => ({
  SURVEY_SHARE_GRANTED_ACTIONS: new Set(["survey.read", "survey.response_read"]),
  getSurveyShareWorkspaceId: vi.fn().mockResolvedValue(null),
}));

const ACTOR: TAuthorizationActor = { type: "user", id: "user1" };
const RESOURCE: TAuthorizationResource = { type: "survey", id: "survey1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorization public interface", () => {
  test("can delegates to the selected evaluator and returns its decision", async () => {
    vi.mocked(authorizationCoordinator.can).mockResolvedValue(true);
    await expect(can(ACTOR, "survey.read", RESOURCE)).resolves.toBe(true);
    expect(authorizationCoordinator.can).toHaveBeenCalledWith(ACTOR, "survey.read", RESOURCE);
  });

  test("assertCan resolves when the evaluator allows", async () => {
    vi.mocked(authorizationCoordinator.can).mockResolvedValue(true);
    await expect(assertCan(ACTOR, "survey.read", RESOURCE)).resolves.toBeUndefined();
  });

  test("assertCan throws AuthorizationError when the evaluator denies", async () => {
    vi.mocked(authorizationCoordinator.can).mockResolvedValue(false);
    await expect(assertCan(ACTOR, "survey.read", RESOURCE)).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("assertCan propagates an evaluator failure without turning it into a denial", async () => {
    vi.mocked(authorizationCoordinator.can).mockRejectedValue(new Error("db down"));
    await expect(assertCan(ACTOR, "survey.read", RESOURCE)).rejects.toThrow("db down");
  });
});

describe("ASLA per-person survey shares (ASL-1880)", () => {
  const allowOnlyWorkspaceRead = () =>
    vi
      .mocked(authorizationCoordinator.can)
      .mockImplementation(async (_actor, action) => action === "workspace.read");

  test("a share grants read after the graph denied, when the user still reads the workspace", async () => {
    allowOnlyWorkspaceRead();
    vi.mocked(getSurveyShareWorkspaceId).mockResolvedValue("ws1");
    await expect(can(ACTOR, "survey.read", RESOURCE)).resolves.toBe(true);
    await expect(can(ACTOR, "survey.response_read", RESOURCE)).resolves.toBe(true);
  });

  test("a share never grants write, export or visibility", async () => {
    allowOnlyWorkspaceRead();
    vi.mocked(getSurveyShareWorkspaceId).mockResolvedValue("ws1");
    for (const action of [
      "survey.write",
      "survey.delete",
      "survey.response_export",
      "survey.change_visibility",
    ] as const) {
      await expect(can(ACTOR, action, RESOURCE)).resolves.toBe(false);
    }
  });

  test("a share does not cross a tenant boundary: no workspace read, no grant", async () => {
    vi.mocked(authorizationCoordinator.can).mockResolvedValue(false);
    vi.mocked(getSurveyShareWorkspaceId).mockResolvedValue("ws1");
    await expect(can(ACTOR, "survey.read", RESOURCE)).resolves.toBe(false);
  });

  test("no share row, no grant; API keys are never granted", async () => {
    allowOnlyWorkspaceRead();
    vi.mocked(getSurveyShareWorkspaceId).mockResolvedValue(null);
    await expect(can(ACTOR, "survey.read", RESOURCE)).resolves.toBe(false);
    vi.mocked(getSurveyShareWorkspaceId).mockResolvedValue("ws1");
    await expect(can({ type: "apiKey", id: "k" }, "survey.read", RESOURCE)).resolves.toBe(false);
  });
});
