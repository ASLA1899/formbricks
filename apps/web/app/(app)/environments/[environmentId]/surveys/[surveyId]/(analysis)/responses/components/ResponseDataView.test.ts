import { describe, expect, test, vi } from "vitest";
import type { TResponseWithQuotas } from "@formbricks/types/responses";
import type { TSurveyAddressElement } from "@formbricks/types/surveys/elements";
import type { TSurvey } from "@formbricks/types/surveys/types";
import { extractResponseData, formatAddressData } from "./ResponseDataView";

vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/responses/components/ResponseTable",
  () => ({
    ResponseTable: () => null,
  })
);

const field = (show: boolean) => ({ show, required: false, placeholder: { default: "x" } });
const addressElement = (nameShown: boolean, orgShown: boolean) =>
  ({
    id: "addr",
    type: "address",
    headline: { default: "Address" },
    required: false,
    name: field(nameShown),
    organization: field(orgShown),
    addressLine1: field(true),
    addressLine2: field(false),
    city: field(true),
    state: field(true),
    zip: field(true),
    country: field(true),
  }) as unknown as TSurveyAddressElement;

const stored = ["1 Main St", "", "Austin", "TX", "78701", "USA", "Jane Doe", "ASLA"];

describe("formatAddressData", () => {
  test("includes name and organization when shown", () => {
    const result = formatAddressData(stored, addressElement(true, true));
    expect(result.name).toBe("Jane Doe");
    expect(result.organization).toBe("ASLA");
  });

  test("omits name and organization when hidden", () => {
    const result = formatAddressData(
      ["1 Main St", "", "Austin", "TX", "78701", "USA", "", ""],
      addressElement(false, false)
    );
    expect(result).not.toHaveProperty("name");
    expect(result).not.toHaveProperty("organization");
    expect(result.city).toBe("Austin");
  });

  test("legacy 6-element arrays leave name and organization unset", () => {
    const result = formatAddressData(stored.slice(0, 6), addressElement(true, true));
    expect(result.name).toBeUndefined();
  });
});

describe("extractResponseData", () => {
  test("hidden address lines do not shadow an open text element with id 'name'", () => {
    const survey = {
      hiddenFields: { enabled: false, fieldIds: [] },
      blocks: [
        {
          id: "b1",
          name: "B1",
          elements: [
            { id: "name", type: "openText", headline: { default: "Name" }, required: false },
            addressElement(false, false),
          ],
        },
      ],
    } as unknown as TSurvey;
    const response = {
      data: { name: "Open text value", addr: ["1 Main St", "", "Austin", "TX", "78701", "USA", "", ""] },
    } as unknown as TResponseWithQuotas;
    expect(extractResponseData(response, survey).name).toBe("Open text value");
  });
});
