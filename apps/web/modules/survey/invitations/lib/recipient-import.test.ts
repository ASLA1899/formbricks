import { describe, expect, test } from "vitest";
import {
  csvToRecipients,
  mergeRecipients,
  parseCsv,
  recipientsToText,
  textToRecipients,
} from "./recipient-import";

describe("parseCsv", () => {
  test("handles quoted commas, escaped quotes and CRLF", () => {
    expect(parseCsv('a@x.org,"Lee, Ana","say ""hi"""\r\nb@x.org,Bo,\r\n')).toEqual([
      ["a@x.org", "Lee, Ana", 'say "hi"'],
      ["b@x.org", "Bo", ""],
    ]);
  });

  test("skips blank lines", () => {
    expect(parseCsv("a@x.org\n\n  \nb@x.org")).toEqual([["a@x.org"], ["b@x.org"]]);
  });
});

describe("csvToRecipients", () => {
  test("detects a header row and column order", () => {
    const csv = "Last Name,E-mail,First_Name\nLee,ana@x.org,Ana\nRay,bo@x.org,";
    expect(csvToRecipients(csv)).toEqual([
      { email: "ana@x.org", firstName: "Ana", lastName: "Lee" },
      { email: "bo@x.org", firstName: undefined, lastName: "Ray" },
    ]);
  });

  test("reads columns by position when there is no header", () => {
    expect(csvToRecipients("ana@x.org,Ana,Lee")).toEqual([
      { email: "ana@x.org", firstName: "Ana", lastName: "Lee" },
    ]);
  });

  test("returns nothing when the header row has no email column", () => {
    expect(csvToRecipients("first,last\nana@x.org,Ana")).toEqual([]);
  });

  test("drops rows without a valid email", () => {
    expect(csvToRecipients("email\nnot-an-email\nok@x.org\na@b")).toEqual([
      { email: "ok@x.org", firstName: undefined, lastName: undefined },
    ]);
  });

  test("returns nothing for empty input", () => {
    expect(csvToRecipients("")).toEqual([]);
  });
});

describe("textToRecipients / recipientsToText", () => {
  test("parses one recipient per line and skips partial emails", () => {
    expect(textToRecipients("a@x.org\nb@x.org, Bo\nc@x.org, Cy, Day\nit@")).toEqual([
      { email: "a@x.org", firstName: undefined, lastName: undefined },
      { email: "b@x.org", firstName: "Bo", lastName: undefined },
      { email: "c@x.org", firstName: "Cy", lastName: "Day" },
    ]);
  });

  test("round-trips without trailing commas", () => {
    const text = "a@x.org\nb@x.org, Bo\nc@x.org, Cy, Day";
    expect(recipientsToText(textToRecipients(text))).toBe(text);
  });

  test("keeps a last name when the first name is missing", () => {
    expect(recipientsToText([{ email: "a@x.org", lastName: "Day" }])).toBe("a@x.org, , Day");
  });
});

describe("mergeRecipients", () => {
  test("de-duplicates case-insensitively, import wins on names, and counts", () => {
    const { merged, added, updated } = mergeRecipients(
      [
        { email: "A@x.org", firstName: "Old" },
        { email: "b@x.org" },
      ],
      [{ email: "a@X.org", firstName: "New" }, { email: "c@x.org" }]
    );
    expect(merged).toEqual([{ email: "a@X.org", firstName: "New" }, { email: "b@x.org" }, { email: "c@x.org" }]);
    expect(added).toBe(1);
    expect(updated).toBe(1);
  });

  test("counts a repeated email in the import once", () => {
    const { merged, added, updated } = mergeRecipients([], [{ email: "a@x.org" }, { email: "A@x.org" }]);
    expect(merged).toHaveLength(1);
    expect(added).toBe(1);
    expect(updated).toBe(0);
  });
});
