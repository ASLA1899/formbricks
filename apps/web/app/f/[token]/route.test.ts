import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooManyRequestsError } from "@formbricks/types/errors";
import { applyIPRateLimit } from "@/modules/core/rate-limit/helpers";
import {
  registerFollowUpFileDownload,
  resolveFollowUpFileLink,
} from "@/modules/survey/follow-ups/lib/file-links";
import { GET, POST } from "./route";

vi.mock("@/modules/core/rate-limit/helpers", () => ({ applyIPRateLimit: vi.fn() }));
vi.mock("@/lingodotdev/language", () => ({ getLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lingodotdev/server", () => ({
  getTranslate: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/modules/survey/follow-ups/lib/file-links", () => ({
  registerFollowUpFileDownload: vi.fn(),
  resolveFollowUpFileLink: vi.fn(),
}));

const TOKEN = "known-token";
const request = (method: string) => new Request(`https://forms.example.org/f/${TOKEN}`, { method });
const props = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

describe("GET /f/[token]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("returns 404 for an unknown token", async () => {
    vi.mocked(resolveFollowUpFileLink).mockResolvedValue(null);
    const response = await GET(request("GET"), props("unknown"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("common.follow_up_file_not_found");
  });

  test("shows the file page without counting a download", async () => {
    vi.mocked(resolveFollowUpFileLink).mockResolvedValue({
      environmentId: "env1",
      attachment: {
        storageKey: "env1/private/a.pdf",
        fileName: "<b>Guide</b>.pdf",
        contentType: "application/pdf",
        size: 2048,
      },
    });

    const response = await GET(request("GET"), props());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("&#60;b&#62;Guide&#60;/b&#62;.pdf");
    expect(html).not.toContain("<b>Guide</b>");
    expect(html).toContain('method="POST"');
    expect(html).toContain('<html lang="en-US">');
    expect(registerFollowUpFileDownload).not.toHaveBeenCalled();
  });

  test("returns 429 when rate limited", async () => {
    vi.mocked(applyIPRateLimit).mockRejectedValue(new TooManyRequestsError("slow down"));
    const response = await GET(request("GET"), props());
    expect(response.status).toBe(429);
    expect(await response.text()).toContain("common.follow_up_file_too_many_requests");
    expect(resolveFollowUpFileLink).not.toHaveBeenCalled();
  });
});

describe("POST /f/[token]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("returns 404 for an unknown token", async () => {
    vi.mocked(registerFollowUpFileDownload).mockResolvedValue(null);
    expect((await POST(request("POST"), props("unknown"))).status).toBe(404);
  });

  test("counts the download and streams the file as an attachment", async () => {
    vi.mocked(registerFollowUpFileDownload).mockResolvedValue({
      body: new Response("pdf-bytes").body as ReadableStream<Uint8Array>,
      contentType: "application/pdf",
      contentLength: 9,
      contentDisposition: 'attachment; filename="Guide.pdf"',
    });

    const response = await POST(request("POST"), props());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Guide.pdf"');
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("pdf-bytes");
    expect(registerFollowUpFileDownload).toHaveBeenCalledWith(TOKEN);
  });

  test("returns 429 when rate limited, without counting", async () => {
    vi.mocked(applyIPRateLimit).mockRejectedValue(new TooManyRequestsError("slow down"));
    expect((await POST(request("POST"), props())).status).toBe(429);
    expect(registerFollowUpFileDownload).not.toHaveBeenCalled();
  });
});
