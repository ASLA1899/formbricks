import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { SURVEY_SHARE_GRANTED_ACTIONS, getSurveyShareWorkspaceId } from "./shares";

vi.mock("server-only", () => ({}));
vi.mock("@formbricks/database", () => ({ prisma: { surveyAccess: { findUnique: vi.fn() } } }));

describe("survey shares", () => {
  beforeEach(() => vi.clearAllMocks());

  test("grants read actions only", () => {
    expect([...SURVEY_SHARE_GRANTED_ACTIONS].sort()).toEqual(["survey.read", "survey.response_read"]);
    for (const denied of [
      "survey.write",
      "survey.delete",
      "survey.response_export",
      "survey.change_visibility",
    ]) {
      expect(SURVEY_SHARE_GRANTED_ACTIONS.has(denied)).toBe(false);
    }
  });

  test("returns the workspace of a shared survey", async () => {
    vi.mocked(prisma.surveyAccess.findUnique).mockResolvedValue({ survey: { workspaceId: "w1" } } as never);
    await expect(getSurveyShareWorkspaceId("u1", "s1")).resolves.toBe("w1");
    expect(prisma.surveyAccess.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surveyId_userId: { surveyId: "s1", userId: "u1" } } })
    );
  });

  test("returns null without a share", async () => {
    vi.mocked(prisma.surveyAccess.findUnique).mockResolvedValue(null);
    await expect(getSurveyShareWorkspaceId("u1", "s1")).resolves.toBeNull();
  });
});
