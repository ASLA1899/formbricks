import { beforeEach, describe, expect, test } from "vitest";
import {
  RESUME_MAX_AGE_MS,
  clearStoredResumeId,
  readStoredResume,
  readStoredResumeId,
  writeStoredResumeBlock,
  writeStoredResumeId,
} from "./resume-storage";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

describe("resume-storage", () => {
  test("round-trips and clears a response id per survey", () => {
    writeStoredResumeId("s1", "r1");
    expect(readStoredResumeId("s1")).toBe("r1");
    expect(readStoredResumeId("s2")).toBeNull();
    clearStoredResumeId("s1");
    expect(readStoredResumeId("s1")).toBeNull();
  });
  test("ignores entries older than the max age", () => {
    store.set(
      "formbricks-resume-s1",
      JSON.stringify({ responseId: "r1", updatedAt: Date.now() - RESUME_MAX_AGE_MS - 1000 })
    );
    expect(readStoredResumeId("s1")).toBeNull();
  });
  test("ignores corrupt values", () => {
    store.set("formbricks-resume-s1", "{not json");
    expect(readStoredResumeId("s1")).toBeNull();
    store.set("formbricks-resume-s1", JSON.stringify({ responseId: 5 }));
    expect(readStoredResumeId("s1")).toBeNull();
  });

  test("keeps the current block with the response id, and never revives a cleared record", () => {
    writeStoredResumeBlock("s1", "b2");
    expect(readStoredResume("s1")).toBeNull();
    writeStoredResumeId("s1", "r1");
    writeStoredResumeBlock("s1", "b3", ["b1"]);
    expect(readStoredResume("s1")).toEqual({
      responseId: "r1",
      blockId: "b3",
      history: ["b1"],
      variableStack: [],
      variables: null,
    });
  });

  test("saves the id together with the latest position when the first acknowledgment is late", () => {
    // The respondent jumped b1 -> b3 before the create call returned: no record existed to take it.
    writeStoredResumeBlock("s1", "b3", ["b1"]);
    expect(readStoredResume("s1")).toBeNull();
    writeStoredResumeId("s1", "r1", {
      blockId: "b3",
      history: ["b1"],
      variableStack: [{ questionId: "q1", variables: { score: 1 } }],
    });
    expect(readStoredResume("s1")).toEqual({
      responseId: "r1",
      blockId: "b3",
      history: ["b1"],
      variableStack: [{ questionId: "q1", variables: { score: 1 } }],
      variables: null,
    });
  });

  test("a record without history reads as an empty path", () => {
    writeStoredResumeId("s1", "r1");
    expect(readStoredResume("s1")).toEqual({
      responseId: "r1",
      blockId: null,
      history: [],
      variableStack: [],
      variables: null,
    });
  });

  test("stores the variable stack with the history and drops malformed entries", () => {
    writeStoredResumeId("s1", "r1");
    writeStoredResumeBlock("s1", "b3", ["b1"], [{ questionId: "q1", variables: { score: 0 } }]);
    expect(readStoredResume("s1")?.variableStack).toEqual([{ questionId: "q1", variables: { score: 0 } }]);
    store.set(
      "formbricks-resume-s1",
      JSON.stringify({
        responseId: "r1",
        updatedAt: Date.now(),
        variableStack: [
          { questionId: "q1", variables: { score: {} } },
          "x",
          { questionId: "q2", variables: { a: "b" } },
        ],
      })
    );
    // One bad entry voids the stack: it lines up with the history by index.
    expect(readStoredResume("s1")?.variableStack).toEqual([]);
  });

  test("keeps snapshots of blocks submitted empty and the current variables", () => {
    writeStoredResumeId("s1", "r1");
    writeStoredResumeBlock(
      "s1",
      "b3",
      ["b1", "b2"],
      [{ questionId: "q1", variables: { score: 0 } }, { variables: { score: 5 } }],
      { score: 0 }
    );
    const stored = readStoredResume("s1");
    expect(stored?.variableStack).toEqual([
      { questionId: "q1", variables: { score: 0 } },
      { variables: { score: 5 } },
    ]);
    expect(stored?.variables).toEqual({ score: 0 });
  });
});
