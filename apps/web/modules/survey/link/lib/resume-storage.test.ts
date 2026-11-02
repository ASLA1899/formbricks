import { beforeEach, describe, expect, test } from "vitest";
import { clearStoredResumeId, readStoredResumeId, writeStoredResumeId } from "./resume-storage";

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
  test("ignores corrupt values", () => {
    store.set("formbricks-resume-s1", "{not json");
    expect(readStoredResumeId("s1")).toBeNull();
    store.set("formbricks-resume-s1", JSON.stringify({ responseId: 5 }));
    expect(readStoredResumeId("s1")).toBeNull();
  });
});
