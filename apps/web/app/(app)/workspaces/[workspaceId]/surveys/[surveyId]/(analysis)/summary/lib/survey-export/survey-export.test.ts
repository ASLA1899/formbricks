import { describe, expect, test } from "vitest";
import { type TSurvey } from "@formbricks/types/surveys/types";
import { generateSurveyDocx } from "./generate-docx";
import { generateSurveyHtml } from "./generate-html";
import { getDocxFileName } from "./run-export";
import { surveyToExportable } from "./transform";

const t = (text: string) => ({ default: text });

const buildSurvey = (): TSurvey =>
  ({
    id: "survey1",
    name: "Member <Survey> & more",
    type: "link",
    status: "inProgress",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    welcomeCard: {
      enabled: true,
      headline: t("<p>Welcome <strong>friend</strong></p>"),
      buttonLabel: t("Go"),
    },
    questions: [],
    blocks: [
      {
        id: "block1",
        name: "Block 1",
        elements: [
          {
            id: "q1",
            type: "multipleChoiceSingle",
            headline: t("Pick one"),
            required: true,
            choices: [
              { id: "c1", label: t("Yes") },
              { id: "c2", label: t("No") },
            ],
          },
          {
            id: "q2",
            type: "openText",
            headline: t("Tell us <b>more</b>"),
            required: false,
            inputType: "text",
            charLimit: { enabled: false },
          },
          { id: "q3", type: "date", headline: t("When?"), required: false, format: "M-d-y" },
        ],
        logic: [
          {
            id: "l1",
            conditions: {
              id: "g1",
              connector: "and",
              conditions: [
                {
                  id: "cond1",
                  leftOperand: { type: "element", value: "q1" },
                  operator: "equals",
                  rightOperand: { type: "static", value: "c1" },
                },
              ],
            },
            actions: [{ id: "a1", objective: "jumpToBlock", target: "block2" }],
          },
        ],
      },
      { id: "block2", name: "Block 2", elements: [] },
    ],
    endings: [{ id: "e1", type: "endScreen", headline: t("Thanks") }],
    hiddenFields: { enabled: true, fieldIds: ["utm"] },
    variables: [{ id: "v1", name: "score", type: "number", value: 0 }],
  }) as unknown as TSurvey;

describe("surveyToExportable", () => {
  test("flattens blocks into numbered questions and strips rich text", () => {
    const data = surveyToExportable(buildSurvey());

    expect(data.name).toBe("Member <Survey> & more");
    expect(data.welcomeCard?.headline).toBe("Welcome friend");
    expect(data.sections.map((s) => s.name)).toEqual(["Block 1", "Block 2"]);
    expect(data.sections[0].questions.map((q) => [q.index, q.id])).toEqual([
      [1, "q1"],
      [2, "q2"],
      [3, "q3"],
    ]);
    expect(data.sections[0].questions[1].headline).toBe("Tell us more");
    expect(data.sections[0].questions[0].choices?.map((c) => c.label)).toEqual(["Yes", "No"]);
    expect(data.hiddenFields).toEqual(["utm"]);
    expect(data.variables).toEqual([{ name: "score", type: "number", value: 0 }]);
    expect(data.endings[0]).toMatchObject({ type: "endScreen", headline: "Thanks" });
  });

  test("shows choice labels, not choice ids, in the logic summary", () => {
    const data = surveyToExportable(buildSurvey());
    const summary = data.sections[0].logic?.[0].summary ?? "";

    expect(summary).toContain("Yes");
    expect(summary).not.toContain("c1");
  });

  test("notes a month-and-year date question when the survey carries the fork field", () => {
    const survey = buildSurvey();
    (survey.blocks[0].elements[2] as unknown as { dateKind: string }).dateKind = "monthYear";

    const date = surveyToExportable(survey).sections[0].questions[2];

    expect(date.details.some((d) => d.value === "Month & Year only")).toBe(true);
  });

  test("does not mention a date kind when the field is absent", () => {
    const date = surveyToExportable(buildSurvey()).sections[0].questions[2];

    expect(date.details.some((d) => d.label === "Date Kind")).toBe(false);
  });
});

describe("generateSurveyHtml", () => {
  test("escapes the survey name and includes the questions", () => {
    const html = generateSurveyHtml(surveyToExportable(buildSurvey()));

    expect(html).toContain("Member &lt;Survey&gt; &amp; more");
    expect(html).not.toContain("<Survey>");
    expect(html).toContain("Pick one");
    expect(html).toContain("Block 1");
  });
});

describe("generateSurveyDocx", () => {
  test("produces a non-empty zip document", async () => {
    const blob = await generateSurveyDocx(surveyToExportable(buildSurvey()));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(bytes.length).toBeGreaterThan(1000);
    // DOCX files are zip archives: they start with "PK".
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });
});

describe("getDocxFileName", () => {
  test("replaces characters that are unsafe in file names", () => {
    expect(getDocxFileName("Member Survey 2026 / Q&A")).toBe("Member_Survey_2026___Q_A_survey.docx");
  });
});
