import { describe, expect, test, vi } from "vitest";
import type { TSurvey } from "@formbricks/types/surveys/types";
import { prepareV3SurveyPatchInput } from "./prepare";
import { serializeV3SurveyResource } from "./serializers";

// ASLA fork (PRD Must 13, ASL-1884): the question fields ported from 4.9 must survive the v3 API.
// A client that GETs a survey and PATCHes it straight back must not get a 400 for a fork field, and
// the stored survey must come back with every fork field intact.

vi.mock("server-only", () => ({}));

const TEST_VISIBILITY = {
  actorContext: { enforced: false, isOrganizationAdmin: false, kind: "user", userId: "user_1" },
  gates: { entitled: false, ready: false },
  ownerName: null,
} as const;

const workspaceId = "clxx1234567890123456789012";
const createdAt = new Date("2026-11-07T10:00:00.000Z");

const i18n = (en: string, de: string) => ({ default: en, "de-DE": de });
const toggle = (show: boolean, prefillFrom?: string) => ({
  show,
  required: false,
  placeholder: i18n("Placeholder", "Platzhalter"),
  ...(prefillFrom ? { prefillFrom } : {}),
});

const forkBlocks = [
  {
    id: "clbk1234567890123456789012",
    name: "Fork fields",
    elements: [
      {
        id: "ci",
        type: "contactInfo",
        headline: i18n("Your details", "Ihre Angaben"),
        required: false,
        firstName: toggle(true),
        lastName: toggle(true),
        email: toggle(true),
        phone: toggle(false),
        company: toggle(true, "member_org"),
        customFields: [
          {
            id: "cf_chapter",
            label: "Chapter",
            type: "dropdown",
            show: true,
            required: true,
            placeholder: i18n("Pick one", "Wählen"),
            options: [
              { id: "opt_ny", label: i18n("New York", "New York") },
              { id: "opt_tx", label: i18n("Texas", "Texas") },
            ],
            presetId: "asla_chapter",
          },
        ],
        fieldOrder: ["firstName", "lastName", "cf_chapter", "email", "company"],
      },
      {
        id: "addr",
        type: "address",
        headline: i18n("Mailing address", "Postanschrift"),
        required: false,
        name: toggle(true, "ci.firstName"),
        organization: toggle(true, "ci.company"),
        addressLine1: toggle(true),
        addressLine2: toggle(false),
        city: toggle(true),
        state: toggle(true),
        zip: toggle(true),
        country: toggle(false),
      },
    ],
  },
  {
    id: "clbk2234567890123456789012",
    name: "More fork fields",
    elements: [
      {
        id: "greeting",
        type: "openText",
        headline: i18n("Preferred name", "Bevorzugter Name"),
        required: false,
        inputType: "text",
        charLimit: { enabled: false },
        insightsEnabled: false,
        prefillFrom: "ci.firstName",
      },
      {
        id: "graduated",
        type: "date",
        headline: i18n("When did you graduate?", "Wann haben Sie abgeschlossen?"),
        required: false,
        format: "M-d-y",
        dateKind: "monthYear",
      },
      {
        id: "practice",
        type: "multipleChoiceSingle",
        headline: i18n("Practice area", "Tätigkeitsbereich"),
        required: false,
        choices: [
          { id: "ch_a", label: i18n("Parks", "Parks") },
          { id: "ch_b", label: i18n("Campus", "Campus") },
          { id: "ch_c", label: i18n("Residential", "Wohnen") },
        ],
        shuffleOption: "none",
        columns: "2",
      },
      {
        id: "grid",
        type: "matrix",
        headline: i18n("Rate each", "Bewerten"),
        required: false,
        rows: [
          { id: "row_a", label: i18n("Design", "Design") },
          { id: "row_other", label: i18n("Other", "Andere") },
        ],
        columns: [
          { id: "col_a", label: i18n("Good", "Gut") },
          { id: "col_b", label: i18n("Bad", "Schlecht") },
        ],
        shuffleOption: "none",
        otherOptionPlaceholder: i18n("Please specify", "Bitte angeben"),
      },
    ],
  },
];

const language = (code: string, isDefault: boolean) => ({
  language: {
    id: `cllang${code.replaceAll("-", "").toLowerCase()}000000000000000`,
    code,
    alias: null,
    workspaceId,
    createdAt,
    updatedAt: createdAt,
  },
  default: isDefault,
  enabled: true,
});

const survey = {
  id: "clsv1234567890123456789012",
  workspaceId,
  createdAt,
  updatedAt: createdAt,
  name: "Fork fields survey",
  type: "link",
  status: "draft",
  metadata: {},
  languages: [language("de-DE", false), language("en-US", true)],
  questions: [],
  welcomeCard: { enabled: false },
  blocks: forkBlocks,
  endings: [],
  hiddenFields: { enabled: true, fieldIds: ["member_org"] },
  variables: [],
} as unknown as TSurvey;

describe("v3 surveys: ASLA fork question fields (PRD Must 13)", () => {
  test("GET output exposes every fork field", () => {
    const resource = serializeV3SurveyResource(survey, TEST_VISIBILITY);
    const [first, second] = resource.blocks as Array<{ elements: Array<Record<string, unknown>> }>;
    const [ci, addr] = first.elements;
    const [greeting, graduated, practice, grid] = second.elements;

    expect(ci.customFields).toEqual([
      expect.objectContaining({
        id: "cf_chapter",
        placeholder: { "en-US": "Pick one", "de-DE": "Wählen" },
        options: [
          { id: "opt_ny", label: { "en-US": "New York", "de-DE": "New York" } },
          { id: "opt_tx", label: { "en-US": "Texas", "de-DE": "Texas" } },
        ],
      }),
    ]);
    expect(ci.fieldOrder).toEqual(["firstName", "lastName", "cf_chapter", "email", "company"]);
    expect(ci.company).toEqual(expect.objectContaining({ prefillFrom: "member_org" }));
    expect(addr.name).toEqual(expect.objectContaining({ show: true, prefillFrom: "ci.firstName" }));
    expect(addr.organization).toEqual(expect.objectContaining({ prefillFrom: "ci.company" }));
    expect(greeting.prefillFrom).toBe("ci.firstName");
    expect(graduated.dateKind).toBe("monthYear");
    expect(practice.columns).toBe("2");
    expect(grid.otherOptionPlaceholder).toEqual({ "en-US": "Please specify", "de-DE": "Bitte angeben" });
  });

  test("a GET body sent straight back is accepted and stores the fork fields unchanged", () => {
    const resource = serializeV3SurveyResource(survey, TEST_VISIBILITY);

    const preparation = prepareV3SurveyPatchInput(survey, JSON.parse(JSON.stringify(resource)), {
      reportedVisibility: resource,
    });

    if (!preparation.ok) {
      expect(preparation.validation.invalidParams).toEqual([]);
    }
    expect(preparation.ok).toBe(true);
    if (preparation.ok) {
      expect(preparation.document.blocks).toEqual(forkBlocks);
    }
  });

  test("rejects an unknown key inside a custom field", () => {
    const resource = serializeV3SurveyResource(survey, TEST_VISIBILITY);
    const body = JSON.parse(JSON.stringify(resource));
    body.blocks[0].elements[0].customFields[0].notAField = true;

    const preparation = prepareV3SurveyPatchInput(survey, body, { reportedVisibility: resource });

    expect(preparation.ok).toBe(false);
    if (!preparation.ok) {
      expect(preparation.validation.invalidParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining("customFields.0.notAField") }),
        ])
      );
    }
  });
});
