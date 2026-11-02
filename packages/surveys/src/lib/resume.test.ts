import { describe, expect, test } from "vitest";
import { getResumeBlockId } from "./resume";

const blocks = [
  { id: "b1", elements: [{ id: "q1" }, { id: "q2" }] },
  { id: "b2", elements: [{ id: "q3" }] },
];
const endings = [{ id: "end1" }];

describe("getResumeBlockId", () => {
  test("lands on the first block with an unanswered element", () => {
    expect(getResumeBlockId(blocks, endings, { q1: "a" })).toBe("b1");
    expect(getResumeBlockId(blocks, endings, { q1: "a", q2: "b" })).toBe("b2");
  });
  test("goes to the first ending when everything is answered", () => {
    expect(getResumeBlockId(blocks, endings, { q1: 1, q2: 2, q3: 3 })).toBe("end1");
  });
  test("returns undefined with nothing to jump to", () => {
    expect(getResumeBlockId(blocks, [], { q1: 1, q2: 2, q3: 3 })).toBeUndefined();
  });
});
