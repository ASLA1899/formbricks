import { afterEach, describe, expect, test, vi } from "vitest";
import type { TAuthenticationApiKey } from "@formbricks/types/auth";
import { TOrganization } from "@formbricks/types/organizations";
import {
  TSurveyCreateInputWithEnvironmentId,
  TSurveyQuestionTypeEnum,
} from "@formbricks/types/surveys/types";
import { responses } from "@/app/lib/api/response";
import { getIsSpamProtectionEnabled, getMultiLanguagePermission } from "@/modules/ee/license-check/lib/utils";
import { getSurveyFollowUpsPermission } from "@/modules/survey/follow-ups/lib/utils";
import { getEnvironmentIdsByOrganizationId } from "./environment";
import { checkFeaturePermissions, getReadableEnvironmentIds } from "./utils";

// Mock dependencies
vi.mock("@/app/lib/api/response", () => ({
  responses: {
    forbiddenResponse: vi.fn((message) => new Response(message, { status: 403 })),
  },
}));

vi.mock("@/modules/ee/license-check/lib/utils", () => ({
  getIsSpamProtectionEnabled: vi.fn(),
  getMultiLanguagePermission: vi.fn(),
}));

vi.mock("@/modules/survey/follow-ups/lib/utils", () => ({
  getSurveyFollowUpsPermission: vi.fn(),
}));

vi.mock("./environment", () => ({
  getEnvironmentIdsByOrganizationId: vi.fn(),
}));

const mockOrganization: TOrganization = {
  id: "test-org",
  name: "Test Organization",
  createdAt: new Date(),
  updatedAt: new Date(),
  billing: {
    plan: "free",
    stripeCustomerId: null,
    period: "monthly",
    limits: {
      projects: 3,
      monthly: {
        responses: 1500,
        miu: 2000,
      },
    },
    periodStart: new Date(),
  },
  isAIEnabled: false,
};

const mockFollowUp: TSurveyCreateInputWithEnvironmentId["followUps"][number] = {
  id: "followup1",
  surveyId: "mockSurveyId",
  name: "Test Follow-up",
  trigger: {
    type: "response",
    properties: null,
  },
  action: {
    type: "send-email",
    properties: {
      to: "mockQuestion1Id",
      from: "noreply@example.com",
      replyTo: [],
      subject: "Follow-up Subject",
      body: "Follow-up Body",
      attachResponseData: false,
    },
  },
};

const mockLanguage: TSurveyCreateInputWithEnvironmentId["languages"][number] = {
  language: {
    id: "lang1",
    code: "en",
    alias: "English",
    createdAt: new Date(),
    projectId: "mockProjectId",
    updatedAt: new Date(),
  },
  default: true,
  enabled: true,
};

const baseSurveyData: TSurveyCreateInputWithEnvironmentId = {
  name: "Test Survey",
  environmentId: "test-env",
  questions: [
    {
      id: "q1",
      type: TSurveyQuestionTypeEnum.OpenText,
      headline: { default: "Q1" },
      required: false,
      charLimit: {},
      inputType: "text",
    },
  ],
  endings: [],
  languages: [],
  type: "link",
  welcomeCard: { enabled: false, showResponseCount: false, timeToFinish: false },
  followUps: [],
};

const baseAuthentication = {
  type: "apiKey" as const,
  apiKeyId: "api-key-id",
  organizationId: "org-id",
  organizationAccess: {
    accessControl: {
      read: false,
      write: false,
    },
  },
  environmentPermissions: [],
};

const environmentPermission = (
  environmentId: string,
  permission: "read" | "write" | "manage"
): TAuthenticationApiKey["environmentPermissions"][number] => ({
  environmentId,
  permission,
  environmentType: "development",
  projectId: `project-${environmentId}`,
  projectName: `Project ${environmentId}`,
});

describe("getReadableEnvironmentIds", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("returns all organization environments when API key has organization read access", async () => {
    vi.mocked(getEnvironmentIdsByOrganizationId).mockResolvedValue(["env-1", "env-2"]);

    const result = await getReadableEnvironmentIds({
      ...baseAuthentication,
      organizationAccess: {
        accessControl: {
          read: true,
          write: false,
        },
      },
    });

    expect(result).toEqual(["env-1", "env-2"]);
    expect(getEnvironmentIdsByOrganizationId).toHaveBeenCalledWith("org-id");
  });

  test("returns an empty list when an organization-read API key belongs to an organization without environments", async () => {
    vi.mocked(getEnvironmentIdsByOrganizationId).mockResolvedValue([]);

    const result = await getReadableEnvironmentIds({
      ...baseAuthentication,
      organizationAccess: {
        accessControl: {
          read: true,
          write: false,
        },
      },
    });

    expect(result).toEqual([]);
    expect(getEnvironmentIdsByOrganizationId).toHaveBeenCalledWith("org-id");
  });

  test("returns all organization environments when API key has organization write access", async () => {
    vi.mocked(getEnvironmentIdsByOrganizationId).mockResolvedValue(["env-1"]);

    const result = await getReadableEnvironmentIds({
      ...baseAuthentication,
      organizationAccess: {
        accessControl: {
          read: false,
          write: true,
        },
      },
    });

    expect(result).toEqual(["env-1"]);
    expect(getEnvironmentIdsByOrganizationId).toHaveBeenCalledWith("org-id");
  });

  test("returns de-duplicated environment permissions that allow GET without organization access", async () => {
    const result = await getReadableEnvironmentIds({
      ...baseAuthentication,
      environmentPermissions: [
        environmentPermission("env-1", "read"),
        environmentPermission("env-2", "write"),
        environmentPermission("env-3", "manage"),
        environmentPermission("env-1", "read"),
      ],
    });

    expect(result).toEqual(["env-1", "env-2", "env-3"]);
    expect(getEnvironmentIdsByOrganizationId).not.toHaveBeenCalled();
  });

  test("returns null when the API key has no readable access", async () => {
    const result = await getReadableEnvironmentIds(baseAuthentication);

    expect(result).toBeNull();
    expect(getEnvironmentIdsByOrganizationId).not.toHaveBeenCalled();
  });
});

describe("checkFeaturePermissions", () => {
  test("should return null if no restricted features are used", async () => {
    const surveyData = { ...baseSurveyData };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeNull();
  });

  // Recaptcha tests
  test("should return forbiddenResponse if recaptcha is enabled but permission denied", async () => {
    vi.mocked(getIsSpamProtectionEnabled).mockResolvedValue(false);
    const surveyData = { ...baseSurveyData, recaptcha: { enabled: true, threshold: 0.5 } };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(403);
    expect(responses.forbiddenResponse).toHaveBeenCalledWith(
      "Spam protection is not enabled for this organization"
    );
  });

  test("should return null if recaptcha is enabled and permission granted", async () => {
    vi.mocked(getIsSpamProtectionEnabled).mockResolvedValue(true);
    const surveyData: TSurveyCreateInputWithEnvironmentId = {
      ...baseSurveyData,
      recaptcha: { enabled: true, threshold: 0.5 },
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeNull();
  });

  // Follow-ups tests
  test("should return forbiddenResponse if follow-ups are used but permission denied", async () => {
    vi.mocked(getSurveyFollowUpsPermission).mockResolvedValue(false);
    const surveyData = {
      ...baseSurveyData,
      followUps: [mockFollowUp],
    }; // Add minimal follow-up data
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(403);
    expect(responses.forbiddenResponse).toHaveBeenCalledWith(
      "Survey follow ups are not allowed for this organization"
    );
  });

  test("should return null if follow-ups are used and permission granted", async () => {
    vi.mocked(getSurveyFollowUpsPermission).mockResolvedValue(true);
    const surveyData = { ...baseSurveyData, followUps: [mockFollowUp] }; // Add minimal follow-up data
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeNull();
  });

  // Multi-language tests
  test("should return forbiddenResponse if multi-language is used but permission denied", async () => {
    vi.mocked(getMultiLanguagePermission).mockResolvedValue(false);
    const surveyData: TSurveyCreateInputWithEnvironmentId = {
      ...baseSurveyData,
      languages: [mockLanguage],
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(403);
    expect(responses.forbiddenResponse).toHaveBeenCalledWith(
      "Multi language is not enabled for this organization"
    );
  });

  test("should return null if multi-language is used and permission granted", async () => {
    vi.mocked(getMultiLanguagePermission).mockResolvedValue(true);
    const surveyData = {
      ...baseSurveyData,
      languages: [mockLanguage],
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeNull();
  });

  // Combined tests
  test("should return null if multiple features are used and all permissions granted", async () => {
    vi.mocked(getIsSpamProtectionEnabled).mockResolvedValue(true);
    vi.mocked(getSurveyFollowUpsPermission).mockResolvedValue(true);
    vi.mocked(getMultiLanguagePermission).mockResolvedValue(true);
    const surveyData = {
      ...baseSurveyData,
      recaptcha: { enabled: true, threshold: 0.5 },
      followUps: [mockFollowUp],
      languages: [mockLanguage],
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeNull();
  });

  test("should return forbiddenResponse for the first denied feature (recaptcha)", async () => {
    vi.mocked(getIsSpamProtectionEnabled).mockResolvedValue(false); // Denied
    vi.mocked(getSurveyFollowUpsPermission).mockResolvedValue(true);
    vi.mocked(getMultiLanguagePermission).mockResolvedValue(true);
    const surveyData = {
      ...baseSurveyData,
      recaptcha: { enabled: true, threshold: 0.5 },
      followUps: [mockFollowUp],
      languages: [mockLanguage],
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(403);
    expect(responses.forbiddenResponse).toHaveBeenCalledWith(
      "Spam protection is not enabled for this organization"
    );
    expect(responses.forbiddenResponse).toHaveBeenCalledTimes(1); // Ensure it stops at the first failure
  });

  test("should return forbiddenResponse for the first denied feature (follow-ups)", async () => {
    vi.mocked(getIsSpamProtectionEnabled).mockResolvedValue(true);
    vi.mocked(getSurveyFollowUpsPermission).mockResolvedValue(false); // Denied
    vi.mocked(getMultiLanguagePermission).mockResolvedValue(true);
    const surveyData = {
      ...baseSurveyData,
      recaptcha: { enabled: true, threshold: 0.5 },
      followUps: [mockFollowUp],
      languages: [mockLanguage],
    };
    const result = await checkFeaturePermissions(surveyData, mockOrganization);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(403);
    expect(responses.forbiddenResponse).toHaveBeenCalledWith(
      "Survey follow ups are not allowed for this organization"
    );
    expect(responses.forbiddenResponse).toHaveBeenCalledTimes(1); // Ensure it stops at the first failure
  });
});
