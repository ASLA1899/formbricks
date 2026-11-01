import { describe, expect, test } from "vitest";
import { resolveSurveyCreationFacts } from "./creation";

const user = { id: "user-1", type: "user" } as const;
const apiKey = { id: "key-1", type: "apiKey" } as const;

describe("resolveSurveyCreationFacts", () => {
  test("a signed-in user creates a private (restricted) survey they own", async () => {
    await expect(resolveSurveyCreationFacts({ actor: user, organizationId: "org-1" })).resolves.toEqual({
      ownerId: "user-1",
      visibility: "restricted",
    });
  });

  test("a signed-in creation needs the target organization", async () => {
    await expect(resolveSurveyCreationFacts({ actor: user, organizationId: null })).rejects.toThrow();
  });

  test("an API key always creates a workspace-visible survey with no owner", async () => {
    await expect(resolveSurveyCreationFacts({ actor: apiKey, organizationId: "org-1" })).resolves.toEqual({
      ownerId: null,
      visibility: "workspace",
    });
  });

  test("no principal at all creates the conservative default", async () => {
    await expect(resolveSurveyCreationFacts({ actor: null, organizationId: null })).resolves.toEqual({
      ownerId: null,
      visibility: "workspace",
    });
  });
});
