import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { prisma } from "@formbricks/database";
import { test } from "./lib/fixtures";

const newToken = () => randomBytes(32).toString("base64url");

const SHOTS_DIR = process.env.FOLLOW_UP_SHOTS_DIR;

// Minimal valid PDF (one blank page)
const PDF_BYTES = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
);

test.describe("Survey follow-up file", () => {
  test.setTimeout(1000 * 60 * 4);

  const token = newToken();

  test("upload a file, save the follow-up, and download it through the tracked link", async ({
    page,
    users,
  }) => {
    const user = await users.create();
    await user.login();
    await page.waitForURL(/\/environments\/[^/]+\/surveys/);

    await test.step("Create a survey and open Follow-ups", async () => {
      await page.getByText("Start from scratch").click();
      await page.getByRole("button", { name: "Create survey", exact: true }).click();
      await page.waitForURL(/\/environments\/[^/]+\/surveys\/[^/]+\/edit$/);
      await page.getByText("Follow-ups").click();
      await page.getByRole("button", { name: "New follow-up" }).click();
      await expect(page.getByText("Create a new follow-up")).toBeVisible();
      await page.getByPlaceholder("Name your follow-up").fill("Thank you with guide");
    });

    await test.step("Upload a file and enable the email attachment", async () => {
      await page.getByTestId("follow-up-attachment-input").setInputFiles({
        name: "Resource guide.pdf",
        mimeType: "application/pdf",
        buffer: PDF_BYTES,
      });
      await expect(page.getByText("Resource guide.pdf")).toBeVisible();
      await page.locator("#attachFileToEmail").click();
      await expect(page.locator("#attachFileToEmail")).toBeChecked();
      if (SHOTS_DIR) {
        await page.getByText("Resource guide.pdf").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS_DIR}/editor-upload.png` });
      }
      await page.getByRole("button", { name: "Save" }).click();
      await page.waitForSelector(".formbricks__toast__success", { timeout: 5000 });
    });

    await test.step("Persist the survey and reopen the follow-up", async () => {
      const surveyId = page.url().match(/surveys\/([^/]+)\/edit/)?.[1];
      expect(surveyId).toBeTruthy();
      await page.getByRole("button", { name: "Publish" }).click();
      await page.waitForURL(/\/surveys\/[^/]+\/summary/, { timeout: 60000 });

      const followUp = await prisma.surveyFollowUp.findFirstOrThrow({ where: { surveyId } });
      const attachment = (followUp.action as { properties: { attachment?: Record<string, unknown> } })
        .properties.attachment;
      expect(attachment).toMatchObject({
        fileName: "Resource guide.pdf",
        contentType: "application/pdf",
        attachToEmail: true,
      });
      expect(String(attachment?.storageKey)).toContain("/private/");

      const response = await prisma.response.create({
        data: { surveyId: surveyId!, finished: true, data: {} },
      });
      await prisma.surveyFollowUpFileLink.create({
        data: {
          token,
          followUpId: followUp.id,
          responseId: response.id,
          recipientEmail: "member@example.org",
          storageKey: String(attachment?.storageKey),
          fileName: "Resource guide.pdf",
          contentType: "application/pdf",
          fileSize: PDF_BYTES.length,
        },
      });

      await page.goto(
        `/environments/${page.url().match(/environments\/([^/]+)/)?.[1]}/surveys/${surveyId}/edit`
      );
      await page.getByText("Follow-ups").click();
      await page.getByText("Thank you with guide").click();
      await expect(page.getByText("File downloads")).toBeVisible();
      await expect(page.getByText("member@example.org")).toBeVisible();
      await expect(page.getByText("Not downloaded")).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("GET does not count; the button does", async () => {
      const link = await prisma.surveyFollowUpFileLink.findUniqueOrThrow({
        where: { token },
      });

      const prefetch = await page.context().request.get(`/f/${token}`);
      expect(prefetch.status()).toBe(200);
      expect(
        (await prisma.surveyFollowUpFileLink.findUniqueOrThrow({ where: { id: link.id } })).downloadCount
      ).toBe(0);

      await page.goto(`/f/${token}`);
      await expect(page.getByText("Resource guide.pdf")).toBeVisible();
      if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/download-page.png` });

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("Resource guide.pdf");

      const counted = await prisma.surveyFollowUpFileLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(counted.downloadCount).toBe(1);
      expect(counted.firstDownloadedAt).not.toBeNull();
    });

    await test.step("The editor shows the counted download", async () => {
      await page.goBack();
      await page.getByText("Follow-ups").click();
      await page.getByText("Thank you with guide").click();
      const row = page.getByRole("row", { name: /member@example\.org/ });
      await expect(row).toBeVisible();
      await expect(row.getByRole("cell").last()).toHaveText("1");
      if (SHOTS_DIR) {
        await page.getByText("File downloads").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS_DIR}/editor-downloads.png` });
      }
    });

    await test.step("Unknown tokens return 404", async () => {
      const response = await page.context().request.get(`/f/${newToken()}`);
      expect(response.status()).toBe(404);
    });
  });
});
