import { describe, expect, test } from "vitest";
import { canAccessSurvey, getSurveyAccessWhere } from "./access";

const baseSurvey = {
  id: "s1",
  visibility: "private" as const,
  createdBy: "creator-id",
  surveyAccess: [] as Array<{ userId: string }>,
};

const baseMembership = {
  userId: "u1",
  surveyAdmin: false,
};

describe("canAccessSurvey", () => {
  test("returns false when user has no membership", () => {
    expect(canAccessSurvey({ userId: "u1", survey: baseSurvey, membership: null })).toBe(false);
  });

  test("returns true when membership.surveyAdmin is true (bypass)", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: baseSurvey,
        membership: { ...baseMembership, surveyAdmin: true },
      })
    ).toBe(true);
  });

  test("returns true when survey is public", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, visibility: "public" },
        membership: baseMembership,
      })
    ).toBe(true);
  });

  test("returns true when user is the creator", () => {
    expect(
      canAccessSurvey({
        userId: "creator-id",
        survey: baseSurvey,
        membership: { ...baseMembership, userId: "creator-id" },
      })
    ).toBe(true);
  });

  test("returns true when SurveyAccess row exists for the user", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, surveyAccess: [{ userId: "u1" }] },
        membership: baseMembership,
      })
    ).toBe(true);
  });

  test("returns false for a private survey when user is not creator/admin/listed", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: baseSurvey,
        membership: baseMembership,
      })
    ).toBe(false);
  });

  test("ignores other users' SurveyAccess rows", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, surveyAccess: [{ userId: "u2" }] },
        membership: baseMembership,
      })
    ).toBe(false);
  });
});

describe("getSurveyAccessWhere", () => {
  test("returns impossible filter for no membership", () => {
    const where = getSurveyAccessWhere({ userId: "u1", membership: null });
    expect(where).toEqual({ id: "__no_access__" });
  });

  test("returns empty (no filter) for surveyAdmin", () => {
    const where = getSurveyAccessWhere({
      userId: "u1",
      membership: { userId: "u1", surveyAdmin: true },
    });
    expect(where).toEqual({});
  });

  test("returns OR(public, creator, access list) for normal user", () => {
    const where = getSurveyAccessWhere({
      userId: "u1",
      membership: { userId: "u1", surveyAdmin: false },
    });
    expect(where).toEqual({
      OR: [{ visibility: "public" }, { createdBy: "u1" }, { surveyAccess: { some: { userId: "u1" } } }],
    });
  });
});
