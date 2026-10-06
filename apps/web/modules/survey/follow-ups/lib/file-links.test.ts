import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { getFileStream } from "@formbricks/storage";
import {
  buildContentDisposition,
  canAttachFileToEmail,
  generateFileLinkToken,
  isAttachmentKeyInEnvironment,
  isValidFileLinkToken,
  registerFollowUpFileDownload,
  resolveFollowUpFileLink,
} from "./file-links";

vi.mock("@formbricks/database", () => ({
  prisma: {
    surveyFollowUpFileLink: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@formbricks/storage", () => ({
  getFileStream: vi.fn(),
}));

vi.mock("@/lib/getPublicUrl", () => ({
  getPublicDomain: () => "https://forms.example.org",
}));

const ENV_ID = "clh3k2p0000001234abcdefgh";
const TOKEN = generateFileLinkToken();

const buildLinkRow = (storageKey = `${ENV_ID}/private/guide--fid--uuid.pdf`) => ({
  storageKey,
  fileName: "Guide.pdf",
  contentType: "application/pdf",
  fileSize: 1000,
  followUp: { survey: { environmentId: ENV_ID } },
});

describe("follow-up file link helpers", () => {
  test("generates URL-safe tokens with at least 128 bits", () => {
    const token = generateFileLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidFileLinkToken(token)).toBe(true);
    expect(generateFileLinkToken()).not.toBe(token);
  });

  test("rejects malformed tokens", () => {
    expect(isValidFileLinkToken("short")).toBe(false);
    expect(isValidFileLinkToken(`${"a".repeat(42)}!`)).toBe(false);
  });

  test("only accepts private keys inside the survey's own environment", () => {
    expect(isAttachmentKeyInEnvironment(`${ENV_ID}/private/a.pdf`, ENV_ID)).toBe(true);
    expect(isAttachmentKeyInEnvironment(`otherenv/private/a.pdf`, ENV_ID)).toBe(false);
    expect(isAttachmentKeyInEnvironment(`${ENV_ID}/public/a.pdf`, ENV_ID)).toBe(false);
    expect(isAttachmentKeyInEnvironment(`${ENV_ID}/private/../x.pdf`, ENV_ID)).toBe(false);
  });

  test("attachment size gate: only files up to 5 MB with the toggle on are attached", () => {
    const base = {
      storageKey: `${ENV_ID}/private/a.pdf`,
      fileName: "a.pdf",
      contentType: "application/pdf",
    };
    expect(canAttachFileToEmail(undefined)).toBe(false);
    expect(canAttachFileToEmail({ ...base, size: 1024, attachToEmail: true })).toBe(true);
    expect(canAttachFileToEmail({ ...base, size: 5 * 1024 * 1024, attachToEmail: true })).toBe(true);
    expect(canAttachFileToEmail({ ...base, size: 5 * 1024 * 1024 + 1, attachToEmail: true })).toBe(false);
    expect(canAttachFileToEmail({ ...base, size: 1024, attachToEmail: false })).toBe(false);
  });

  test("builds a safe attachment Content-Disposition", () => {
    const header = buildContentDisposition('Re"port\r\névil.pdf');
    expect(header.startsWith("attachment; filename=")).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''");
    expect(header.split('filename="')[1].split('"')[0]).not.toContain('"');
  });
});

describe("resolveFollowUpFileLink / registerFollowUpFileDownload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
  });

  test("returns null for an unknown token without counting", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(null);
    expect(await registerFollowUpFileDownload(TOKEN)).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("returns null for a malformed token without touching the database", async () => {
    expect(await resolveFollowUpFileLink("nope")).toBeNull();
    expect(prisma.surveyFollowUpFileLink.findUnique).not.toHaveBeenCalled();
  });

  test("resolving (the GET path) never counts a download", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(buildLinkRow() as never);
    const resolved = await resolveFollowUpFileLink(TOKEN);
    expect(resolved?.attachment.fileName).toBe("Guide.pdf");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.surveyFollowUpFileLink.update).not.toHaveBeenCalled();
    expect(getFileStream).not.toHaveBeenCalled();
  });

  test("refuses keys outside the survey's environment", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(
      buildLinkRow("otherenv/private/secret.pdf") as never
    );
    expect(await resolveFollowUpFileLink(TOKEN)).toBeNull();
    expect(await registerFollowUpFileDownload(TOKEN)).toBeNull();
    expect(getFileStream).not.toHaveBeenCalled();
  });

  test("POST path opens the file, then counts", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(buildLinkRow() as never);
    const body = new Response("pdf").body as ReadableStream<Uint8Array>;
    vi.mocked(getFileStream).mockResolvedValue({
      ok: true,
      data: { body, contentType: "application/octet-stream", contentLength: 3 },
    });

    const download = await registerFollowUpFileDownload(TOKEN);

    expect(download).toMatchObject({
      body,
      contentType: "application/pdf",
      contentLength: 3,
      contentDisposition: expect.stringMatching(/^attachment; filename="Guide.pdf"/),
    });
    expect(getFileStream).toHaveBeenCalledWith(`${ENV_ID}/private/guide--fid--uuid.pdf`);
    expect(prisma.surveyFollowUpFileLink.updateMany).toHaveBeenCalledWith({
      where: { token: TOKEN, firstDownloadedAt: null },
      data: { firstDownloadedAt: expect.any(Date) },
    });
    expect(prisma.surveyFollowUpFileLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: TOKEN },
        data: { lastDownloadedAt: expect.any(Date), downloadCount: { increment: 1 } },
      })
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test("serves the file snapshotted on the link, not whatever the follow-up has now", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(buildLinkRow() as never);
    const resolved = await resolveFollowUpFileLink(TOKEN);
    expect(resolved?.attachment).toEqual({
      storageKey: `${ENV_ID}/private/guide--fid--uuid.pdf`,
      fileName: "Guide.pdf",
      contentType: "application/pdf",
      size: 1000,
    });
  });

  test("cancels the open stream and returns null when counting fails", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(buildLinkRow() as never);
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getFileStream).mockResolvedValue({
      ok: true,
      data: { body: { cancel } as unknown as ReadableStream<Uint8Array>, contentType: "x", contentLength: 3 },
    });
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("P2025"));

    expect(await registerFollowUpFileDownload(TOKEN)).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  test("does not count when the file cannot be opened", async () => {
    vi.mocked(prisma.surveyFollowUpFileLink.findUnique).mockResolvedValue(buildLinkRow() as never);
    vi.mocked(getFileStream).mockResolvedValue({
      ok: false,
      error: { code: "file_not_found_error" },
    } as never);

    expect(await registerFollowUpFileDownload(TOKEN)).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
