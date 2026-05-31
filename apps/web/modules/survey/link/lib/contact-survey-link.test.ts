import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ENCRYPTION_KEY } from "@/lib/constants";
import { symmetricDecrypt, symmetricEncrypt } from "@/lib/crypto";
import { getPublicDomain } from "@/lib/getPublicUrl";
import { generateSurveySingleUseId } from "@/lib/utils/single-use-surveys";
import { getSurvey } from "@/modules/survey/lib/survey";
import { getContactSurveyLink, verifyContactSurveyToken } from "./contact-survey-link";

vi.mock("jsonwebtoken", () => {
  class TokenExpiredError extends Error {}
  const api = { sign: vi.fn(), verify: vi.fn(), TokenExpiredError };
  return { default: api, ...api };
});

vi.mock("@/lib/constants", () => ({ ENCRYPTION_KEY: "test-encryption-key" }));

vi.mock("@/lib/crypto", () => ({
  symmetricEncrypt: vi.fn((value: string) => `enc(${value})`),
  symmetricDecrypt: vi.fn((value: string) => value.replace(/^enc\((.*)\)$/, "$1")),
}));

vi.mock("@/lib/getPublicUrl", () => ({
  getPublicDomain: vi.fn(() => "https://surveys.asla.test"),
}));

vi.mock("@/lib/utils/single-use-surveys", () => ({
  generateSurveySingleUseId: vi.fn(() => "single-use-id"),
}));

vi.mock("@/modules/survey/lib/survey", () => ({ getSurvey: vi.fn() }));

const CONTACT_ID = "contact_abc";
const SURVEY_ID = "survey_xyz";
const TOKEN = "signed.jwt.token";

beforeEach(() => {
  vi.mocked(getSurvey).mockResolvedValue({ id: SURVEY_ID, singleUse: null } as any);
  vi.mocked(jwt.sign).mockReturnValue(TOKEN as any);
  vi.mocked(jwt.verify).mockReturnValue({
    contactId: `enc(${CONTACT_ID})`,
    surveyId: `enc(${SURVEY_ID})`,
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getContactSurveyLink", () => {
  test("encrypts both ids, signs with HS256, and returns a /c/<token> url", async () => {
    const result = await getContactSurveyLink(CONTACT_ID, SURVEY_ID);

    expect(symmetricEncrypt).toHaveBeenCalledWith(CONTACT_ID, ENCRYPTION_KEY);
    expect(symmetricEncrypt).toHaveBeenCalledWith(SURVEY_ID, ENCRYPTION_KEY);
    expect(jwt.sign).toHaveBeenCalledWith(
      { contactId: `enc(${CONTACT_ID})`, surveyId: `enc(${SURVEY_ID})` },
      ENCRYPTION_KEY,
      { algorithm: "HS256" }
    );
    expect(result).toEqual({ ok: true, data: `${getPublicDomain()}/c/${TOKEN}` });
    expect(generateSurveySingleUseId).not.toHaveBeenCalled();
  });

  test("passes an expiry of <days>d when expirationDays is positive", async () => {
    await getContactSurveyLink(CONTACT_ID, SURVEY_ID, 7);

    expect(jwt.sign).toHaveBeenCalledWith(expect.anything(), ENCRYPTION_KEY, {
      algorithm: "HS256",
      expiresIn: "7d",
    });
  });

  test("ignores a non-positive expirationDays", async () => {
    await getContactSurveyLink(CONTACT_ID, SURVEY_ID, 0);

    expect(jwt.sign).toHaveBeenCalledWith(expect.anything(), ENCRYPTION_KEY, { algorithm: "HS256" });
  });

  test("appends a single-use id when the survey is single-use", async () => {
    vi.mocked(getSurvey).mockResolvedValue({
      id: SURVEY_ID,
      singleUse: { enabled: true, isEncrypted: true },
    } as any);

    const result = await getContactSurveyLink(CONTACT_ID, SURVEY_ID);

    expect(generateSurveySingleUseId).toHaveBeenCalledWith(true);
    expect(result).toEqual({
      ok: true,
      data: `${getPublicDomain()}/c/${TOKEN}?suId=single-use-id`,
    });
  });

  test("returns not_found when the survey does not exist", async () => {
    vi.mocked(getSurvey).mockResolvedValue(null as any);

    const result = await getContactSurveyLink(CONTACT_ID, "missing");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("not_found");
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  test("returns internal_server_error when ENCRYPTION_KEY is absent", async () => {
    vi.resetModules();
    vi.doMock("@/lib/constants", () => ({ ENCRYPTION_KEY: undefined }));
    const { getContactSurveyLink: fn } = await import("./contact-survey-link");

    const result = await fn(CONTACT_ID, SURVEY_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("internal_server_error");
  });
});

describe("verifyContactSurveyToken", () => {
  test("verifies with the algorithm pinned to HS256 and decrypts the claims", () => {
    const result = verifyContactSurveyToken(TOKEN);

    expect(jwt.verify).toHaveBeenCalledWith(TOKEN, ENCRYPTION_KEY, { algorithms: ["HS256"] });
    expect(symmetricDecrypt).toHaveBeenCalledWith(`enc(${CONTACT_ID})`, ENCRYPTION_KEY);
    expect(result).toEqual({ ok: true, data: { contactId: CONTACT_ID, surveyId: SURVEY_ID } });
  });

  test("reports an expired link distinctly", () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new jwt.TokenExpiredError("jwt expired", new Date());
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = verifyContactSurveyToken(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("bad_request");
      expect(result.error.details?.[0]?.issue).toBe("token_expired");
    }
  });

  test("treats a payload missing claims as an invalid token", () => {
    vi.mocked(jwt.verify).mockReturnValue({ contactId: `enc(${CONTACT_ID})` } as any);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = verifyContactSurveyToken(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details?.[0]?.issue).toBe("invalid_token");
  });

  test("maps any other verification failure to an invalid token", () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error("signature mismatch");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = verifyContactSurveyToken(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("bad_request");
      expect(result.error.details?.[0]?.issue).toBe("invalid_token");
    }
  });

  test("returns internal_server_error when ENCRYPTION_KEY is absent", async () => {
    vi.resetModules();
    vi.doMock("@/lib/constants", () => ({ ENCRYPTION_KEY: undefined }));
    const { verifyContactSurveyToken: fn } = await import("./contact-survey-link");

    const result = fn(TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("internal_server_error");
  });
});
