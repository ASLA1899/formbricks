import { beforeEach, describe, expect, test, vi } from "vitest";
import { getResponseHandler } from "./get-response-handler";

const mocks = vi.hoisted(() => ({
  getResponse: vi.fn(),
  getSurvey: vi.fn(),
  resolveClientApiIds: vi.fn(),
  verifyLinkSurveyPinToken: vi.fn(),
}));

vi.mock("@/lib/response/service", () => ({ getResponse: mocks.getResponse }));
vi.mock("@/lib/survey/service", () => ({ getSurvey: mocks.getSurvey }));
vi.mock("@/lib/utils/resolve-client-id", () => ({ resolveClientApiIds: mocks.resolveClientApiIds }));
vi.mock("@/modules/survey/link/lib/pin-token", () => ({
  verifyLinkSurveyPinToken: mocks.verifyLinkSurveyPinToken,
}));

const call = async (query = "?surveyId=s1", headers: Record<string, string> = {}) => {
  const result = await getResponseHandler({
    req: new Request(`http://localhost/api/v2/client/w1/responses/r1${query}`, { headers }) as never,
    props: { params: Promise.resolve({ workspaceId: "w1", responseId: "r1" }) },
  } as never);
  return result.response;
};

const partial = {
  id: "r1",
  surveyId: "s1",
  finished: false,
  data: { q1: "a", verifiedEmail: "x@y.org" },
  ttc: { q1: 3 },
  variables: {},
  language: "en",
};

describe("getResponseHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveClientApiIds.mockResolvedValue({ workspaceId: "w1" });
    mocks.getResponse.mockResolvedValue(partial);
    mocks.getSurvey.mockResolvedValue({ id: "s1", workspaceId: "w1", status: "inProgress", type: "link" });
  });

  test("returns an unfinished response without the verified email", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.data).toEqual({ q1: "a" });
    expect(body.data.ttc).toEqual({ q1: 3 });
  });

  test("400 without surveyId", async () => {
    expect((await call("")).status).toBe(400);
  });

  test.each([
    ["finished response", () => mocks.getResponse.mockResolvedValue({ ...partial, finished: true })],
    ["missing response", () => mocks.getResponse.mockResolvedValue(null)],
    ["surveyId mismatch", () => mocks.getResponse.mockResolvedValue({ ...partial, surveyId: "other" })],
    ["contact response", () => mocks.getResponse.mockResolvedValue({ ...partial, contact: { id: "c1" } })],
    ["single-use response", () => mocks.getResponse.mockResolvedValue({ ...partial, singleUseId: "su" })],
    [
      "email-verified survey",
      () =>
        mocks.getSurvey.mockResolvedValue({
          id: "s1",
          workspaceId: "w1",
          status: "inProgress",
          type: "link",
          isVerifyEmailEnabled: true,
        }),
    ],
    ["unknown workspace", () => mocks.resolveClientApiIds.mockResolvedValue(null)],
    [
      "survey in another workspace",
      () =>
        mocks.getSurvey.mockResolvedValue({
          id: "s1",
          workspaceId: "w2",
          status: "inProgress",
          type: "link",
        }),
    ],
    [
      "survey not in progress",
      () =>
        mocks.getSurvey.mockResolvedValue({ id: "s1", workspaceId: "w1", status: "paused", type: "link" }),
    ],
    [
      "app survey",
      () =>
        mocks.getSurvey.mockResolvedValue({ id: "s1", workspaceId: "w1", status: "inProgress", type: "app" }),
    ],
  ])("404 for %s", async (_name, arrange) => {
    arrange();
    expect((await call()).status).toBe(404);
  });

  test("PIN survey needs a valid PIN token", async () => {
    mocks.getSurvey.mockResolvedValue({
      id: "s1",
      workspaceId: "w1",
      status: "inProgress",
      type: "link",
      pin: "1234",
    });
    mocks.verifyLinkSurveyPinToken.mockReturnValue(false);
    expect((await call()).status).toBe(404);
    mocks.verifyLinkSurveyPinToken.mockReturnValue(true);
    expect((await call("?surveyId=s1", { "x-pin-auth-token": "tok" })).status).toBe(200);
    expect(mocks.verifyLinkSurveyPinToken).toHaveBeenLastCalledWith("tok", "s1");
  });
});
