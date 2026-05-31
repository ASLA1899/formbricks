import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { validateWebhookUrl } from "@/lib/utils/validate-webhook-url";
import { testEndpoint } from "./webhook";

vi.mock("@formbricks/database", () => ({
  prisma: {
    webhook: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/utils/validate-webhook-url", () => ({
  validateWebhookUrl: vi.fn(),
}));

describe("testEndpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validateWebhookUrl).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // SSRF via redirect: validateWebhookUrl only checks the initial URL, so a webhook
  // host that 30x-redirects to a private/internal address (e.g. cloud metadata) would
  // bypass it unless redirects are disabled. We send `redirect: "manual"` and reject 30x.
  test.each([301, 302, 303, 307, 308])(
    "rejects %s redirects to prevent SSRF via redirect following",
    async (statusCode) => {
      const fetchMock = vi.fn(async () => ({ status: statusCode }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(testEndpoint("https://example.com/webhook")).rejects.toThrow(
        "Webhook endpoint returned a redirect, which is not allowed"
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({ redirect: "manual" })
      );
    }
  );

  test("returns true for a 2xx response and uses manual redirect mode", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testEndpoint("https://example.com/webhook")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  test("validates the URL against SSRF before fetching", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await testEndpoint("https://example.com/webhook");

    expect(validateWebhookUrl).toHaveBeenCalledWith("https://example.com/webhook");
  });
});
