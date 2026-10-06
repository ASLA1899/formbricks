import { beforeEach, describe, expect, test, vi } from "vitest";
import { TSurveyFollowUp } from "@formbricks/database/types/survey-follow-up";
import { renderFollowUpEmail } from "@formbricks/email";
import { getFileStream } from "@formbricks/storage";
import { TResponse } from "@formbricks/types/responses";
import { TSurvey } from "@formbricks/types/surveys/types";
import { sendEmail } from "@/modules/email";
import { sendFollowUpEmail } from "./email";
import { createFollowUpFileLink, deleteFollowUpFileLinkByToken } from "./file-links";

vi.mock("@formbricks/email", () => ({ renderFollowUpEmail: vi.fn() }));
vi.mock("@formbricks/storage", () => ({ getFileStream: vi.fn() }));
vi.mock("@/lib/constants", () => ({
  IMPRINT_ADDRESS: "",
  IMPRINT_URL: "",
  PRIVACY_URL: "",
  TERMS_URL: "",
}));
vi.mock("@/lib/getPublicUrl", () => ({ getPublicDomain: () => "https://forms.example.org" }));
vi.mock("@formbricks/database", () => ({ prisma: {} }));
vi.mock("@/lib/responses", () => ({ getElementResponseMapping: vi.fn(() => []) }));
vi.mock("@/lib/utils/recall", () => ({ parseRecallInfo: vi.fn((body: string) => body) }));
vi.mock("@/lingodotdev/server", () => ({ getTranslate: vi.fn(async () => (key: string) => key) }));
vi.mock("@/modules/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/modules/storage/utils", () => ({ resolveStorageUrl: vi.fn((url: string) => url) }));
vi.mock("./file-links", async () => {
  const actual = await vi.importActual<typeof import("./file-links")>("./file-links");
  return {
    ...actual,
    createFollowUpFileLink: vi.fn(),
    deleteFollowUpFileLinkByToken: vi.fn(),
    getFollowUpFileUrl: vi.fn((token: string) => `https://forms.example.org/f/${token}`),
  };
});

const ENV_ID = "clh3k2p0000001234abcdefgh";
const survey = {
  id: "s1",
  environmentId: ENV_ID,
  variables: [],
  hiddenFields: { fieldIds: [] },
} as unknown as TSurvey;
const response = { id: "r1", data: {}, variables: {} } as unknown as TResponse;

const buildFollowUp = (attachment?: Record<string, unknown>) =>
  ({
    id: "f1",
    action: {
      type: "send-email",
      properties: {
        to: "email",
        from: "no-reply@example.org",
        replyTo: ["help@example.org"],
        subject: "Thanks",
        body: "<p>Hi</p>",
        attachResponseData: false,
        ...(attachment && { attachment }),
      },
    },
  }) as unknown as TSurveyFollowUp;

const attachment = (overrides: Record<string, unknown> = {}) => ({
  storageKey: `${ENV_ID}/private/guide--fid--uuid.pdf`,
  fileName: "Guide.pdf",
  contentType: "application/pdf",
  size: 1000,
  attachToEmail: false,
  ...overrides,
});

const send = (followUp: TSurveyFollowUp) =>
  sendFollowUpEmail({
    followUp,
    to: "member@example.org",
    replyTo: ["help@example.org"],
    survey,
    response,
    attachResponseData: false,
  });

const streamOf = (bytes: number) => ({
  ok: true as const,
  data: {
    body: new Response(Buffer.alloc(bytes)).body as ReadableStream<Uint8Array>,
    contentType: "application/pdf",
    contentLength: bytes,
  },
});

describe("sendFollowUpEmail with a file", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(renderFollowUpEmail).mockResolvedValue("<html></html>");
    vi.mocked(sendEmail).mockResolvedValue(true);
    vi.mocked(createFollowUpFileLink).mockResolvedValue("tok-123");
  });

  test("sends without creating a link when the follow-up has no file", async () => {
    await send(buildFollowUp());
    expect(createFollowUpFileLink).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  test("creates one link per recipient and puts it in the email", async () => {
    await send(buildFollowUp(attachment()));

    expect(createFollowUpFileLink).toHaveBeenCalledWith({
      followUpId: "f1",
      responseId: "r1",
      recipientEmail: "member@example.org",
      attachment: expect.objectContaining({ fileName: "Guide.pdf", size: 1000 }),
    });
    expect(renderFollowUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fileLink: { url: "https://forms.example.org/f/tok-123", fileName: "Guide.pdf" },
      })
    );
    expect(getFileStream).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  test("also attaches the file when the toggle is on and it is within 5 MB", async () => {
    vi.mocked(getFileStream).mockResolvedValue(streamOf(1000) as never);
    await send(buildFollowUp(attachment({ attachToEmail: true })));

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments?.[0]).toMatchObject({ filename: "Guide.pdf", contentType: "application/pdf" });
    expect(call.attachments?.[0].content.byteLength).toBe(1000);
  });

  test("does not attach a file larger than 5 MB, even with the toggle on", async () => {
    await send(buildFollowUp(attachment({ attachToEmail: true, size: 5 * 1024 * 1024 + 1 })));
    expect(getFileStream).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  test("checks the real stored size, not the size reported by the editor", async () => {
    vi.mocked(getFileStream).mockResolvedValue(streamOf(6 * 1024 * 1024) as never);
    await send(buildFollowUp(attachment({ attachToEmail: true, size: 1000 })));
    expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  test("refuses a file from another environment", async () => {
    await expect(
      send(buildFollowUp(attachment({ storageKey: "otherenv/private/secret.pdf" })))
    ).rejects.toThrow();
    expect(createFollowUpFileLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("removes the link when nothing was sent", async () => {
    vi.mocked(sendEmail).mockResolvedValue(false);
    await send(buildFollowUp(attachment()));
    expect(deleteFollowUpFileLinkByToken).toHaveBeenCalledWith("tok-123");
  });

  test("removes the link when sending throws", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("smtp down"));
    await expect(send(buildFollowUp(attachment()))).rejects.toThrow("smtp down");
    expect(deleteFollowUpFileLinkByToken).toHaveBeenCalledWith("tok-123");
  });
});
