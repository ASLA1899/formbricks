import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { AuthorizationError } from "@formbricks/types/errors";
import { assertCan } from "@/lib/authorization";
import { setSurveyAccessMode } from "@/lib/survey/access-mode";
import { getOrganizationIdFromSurveyId } from "@/lib/utils/helper";
import {
  addSurveyAccessAction,
  getSurveySharingStateAction,
  removeSurveyAccessAction,
  setSurveyAccessModeAction,
} from "./actions";
import {
  addSurveyAccess,
  listShareableMembers,
  listSurveyAccess,
  removeSurveyAccess,
} from "./lib/survey-access";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({
  prisma: { survey: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/authorization", () => ({ assertCan: vi.fn() }));
vi.mock("@/lib/survey/access-mode", () => ({ setSurveyAccessMode: vi.fn() }));
vi.mock("@/lib/utils/helper", () => ({ getOrganizationIdFromSurveyId: vi.fn().mockResolvedValue("org1") }));
vi.mock("./lib/survey-access", () => ({
  addSurveyAccess: vi.fn(),
  listShareableMembers: vi.fn().mockResolvedValue([{ user: { id: "u2", name: "B", email: "b@x" } }]),
  listSurveyAccess: vi.fn().mockResolvedValue([{ user: { id: "u3", name: "C", email: "c@x" } }]),
  removeSurveyAccess: vi.fn(),
}));
vi.mock("@/lib/utils/action-client", () => {
  const client = {
    inputSchema: (schema: { parse: (v: unknown) => unknown }) => ({
      action: (fn: (a: { ctx: unknown; parsedInput: unknown }) => unknown) => (input: unknown) =>
        fn({ ctx: { user: { id: "u1" } }, parsedInput: schema.parse(input) }),
    }),
  };
  return { authenticatedActionClient: client };
});

const surveyId = "clh2k8x0z0000a1b2c3d4e5f6";
const userId = "clh2k8x0z0001a1b2c3d4e5f6";

describe("survey sharing actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationIdFromSurveyId).mockResolvedValue("org1");
    vi.mocked(listShareableMembers).mockResolvedValue([
      { user: { id: "u2", name: "B", email: "b@x" } },
    ] as never);
    vi.mocked(listSurveyAccess).mockResolvedValue([{ user: { id: "u3", name: "C", email: "c@x" } }] as never);
  });

  test("every action asks the graph for survey.change_visibility first and stops on denial", async () => {
    vi.mocked(assertCan).mockRejectedValue(new AuthorizationError("Not authorized"));
    const calls = [
      () => (getSurveySharingStateAction as never as (i: unknown) => Promise<unknown>)({ surveyId }),
      () =>
        (setSurveyAccessModeAction as never as (i: unknown) => Promise<unknown>)({
          accessMode: "public",
          surveyId,
        }),
      () =>
        (addSurveyAccessAction as never as (i: unknown) => Promise<unknown>)({ surveyId, userIds: [userId] }),
      () => (removeSurveyAccessAction as never as (i: unknown) => Promise<unknown>)({ surveyId, userId }),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(AuthorizationError);
    expect(assertCan).toHaveBeenCalledWith({ id: "u1", type: "user" }, "survey.change_visibility", {
      id: surveyId,
      type: "survey",
    });
    expect(setSurveyAccessMode).not.toHaveBeenCalled();
    expect(addSurveyAccess).not.toHaveBeenCalled();
    expect(removeSurveyAccess).not.toHaveBeenCalled();
  });

  test("state returns the mode, the shares and the shareable members", async () => {
    vi.mocked(assertCan).mockResolvedValue(undefined);
    vi.mocked(prisma.survey.findUnique).mockResolvedValue({ accessMode: "private" } as never);
    await expect(
      (getSurveySharingStateAction as never as (i: unknown) => Promise<unknown>)({ surveyId })
    ).resolves.toEqual({
      access: [{ id: "u3", name: "C", email: "c@x" }],
      accessMode: "private",
      orgMembers: [{ id: "u2", name: "B", email: "b@x" }],
    });
  });

  test("set mode, add and remove delegate with the caller and organization", async () => {
    vi.mocked(assertCan).mockResolvedValue(undefined);
    await (setSurveyAccessModeAction as never as (i: unknown) => Promise<unknown>)({
      accessMode: "public",
      surveyId,
    });
    expect(setSurveyAccessMode).toHaveBeenCalledWith(surveyId, "public", "u1");
    await (addSurveyAccessAction as never as (i: unknown) => Promise<unknown>)({
      surveyId,
      userIds: [userId],
    });
    expect(addSurveyAccess).toHaveBeenCalledWith(surveyId, "org1", [userId]);
    await (removeSurveyAccessAction as never as (i: unknown) => Promise<unknown>)({ surveyId, userId });
    expect(removeSurveyAccess).toHaveBeenCalledWith(surveyId, userId);
  });
});
