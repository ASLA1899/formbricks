import { type TSurvey } from "@formbricks/types/surveys/types";

export type TSurveyExportFormat = "html" | "docx" | "pdf";

export const getDocxFileName = (surveyName: string) =>
  `${surveyName.replace(/[^a-zA-Z0-9]/g, "_")}_survey.docx`;

/**
 * Builds the export in the browser. The generators are loaded on demand so the docx library stays out of
 * the page bundle until someone exports. HTML opens in a new tab, PDF opens the print dialog, DOCX downloads.
 */
export const runSurveyExport = async (
  survey: TSurvey,
  format: TSurveyExportFormat,
  locale = "en-US"
): Promise<void> => {
  const { surveyToExportable } = await import("./transform");
  const data = surveyToExportable(survey);

  if (format === "html") {
    const { generateSurveyHtml } = await import("./generate-html");
    const { openHtmlInNewTab } = await import("./download");
    openHtmlInNewTab(generateSurveyHtml(data, locale));
    return;
  }

  if (format === "pdf") {
    const { generateSurveyPdf } = await import("./generate-pdf");
    await generateSurveyPdf(data, locale);
    return;
  }

  const { generateSurveyDocx } = await import("./generate-docx");
  const { downloadBlob } = await import("./download");
  downloadBlob(await generateSurveyDocx(data, locale), getDocxFileName(survey.name));
};
