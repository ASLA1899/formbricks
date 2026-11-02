import { describe, expect, test } from "vitest";
import { getResumeBlockId, resolveResumeBlockId } from "./resume";

const blocks = [
  { id: "b1", elements: [{ id: "q1" }, { id: "q2" }] },
  { id: "b2", elements: [{ id: "q3" }] },
];
const endings = [{ id: "end1" }];

describe("getResumeBlockId", () => {
  test("lands on the block after the last answered one", () => {
    expect(getResumeBlockId(blocks, endings, { q1: "a" })).toBe("b2");
    expect(getResumeBlockId(blocks, endings, { q1: "a", q2: "b" })).toBe("b2");
  });
  test("does not reopen skipped branches or optional questions passed over", () => {
    const wide = ["b1", "b2", "b3", "b4"].map((id, n) => ({ id, elements: [{ id: `q${n + 1}` }] }));
    expect(getResumeBlockId(wide, endings, { q1: 1, q3: 3 })).toBe("b4");
  });
  test("goes to the first ending after the last block", () => {
    expect(getResumeBlockId(blocks, endings, { q3: 3 })).toBe("end1");
  });
  test("returns undefined with nothing answered or no ending to reach", () => {
    expect(getResumeBlockId(blocks, endings, {})).toBeUndefined();
    expect(getResumeBlockId(blocks, [], { q3: 3 })).toBeUndefined();
  });
});

describe("resolveResumeBlockId", () => {
  const wide = ["b1", "b2", "b3", "b4"].map((id, n) => ({ id, elements: [{ id: `q${n + 1}` }] }));
  test("uses the saved block, so a jump from b1 to b3 resumes at b3", () => {
    expect(resolveResumeBlockId(wide, endings, { q1: 1 }, "b3")).toBe("b3");
  });
  test("keeps an optional block that was submitted empty as the position", () => {
    expect(resolveResumeBlockId(wide, endings, { q1: 1 }, "b3")).not.toBe("b2");
  });
  test("falls back to the last answer when the saved block is gone or missing", () => {
    expect(resolveResumeBlockId(wide, endings, { q1: 1 }, "removed")).toBe("b2");
    expect(resolveResumeBlockId(wide, endings, { q1: 1 }, null)).toBe("b2");
  });
});
