const RESUME_STORAGE_PREFIX = "formbricks-resume-";
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredResume {
  responseId: string;
  blockId: string | null;
  history: string[];
}

export const readStoredResume = (surveyId: string): StoredResume | null => {
  try {
    const raw = globalThis.localStorage?.getItem(RESUME_STORAGE_PREFIX + surveyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      responseId?: unknown;
      updatedAt?: unknown;
      blockId?: unknown;
      history?: unknown;
    };
    if (typeof parsed.responseId !== "string" || !parsed.responseId) return null;
    if (typeof parsed.updatedAt !== "number" || Date.now() - parsed.updatedAt > RESUME_MAX_AGE_MS) {
      return null;
    }
    return {
      responseId: parsed.responseId,
      blockId: typeof parsed.blockId === "string" && parsed.blockId ? parsed.blockId : null,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return null;
  }
};

export const readStoredResumeId = (surveyId: string): string | null =>
  readStoredResume(surveyId)?.responseId ?? null;

/** Records the block the respondent is on and the blocks they came through, so Back works after a resume. Only updates an existing record, so it never revives a cleared one. */
export const writeStoredResumeBlock = (surveyId: string, blockId: string, history: string[] = []): void => {
  try {
    const key = RESUME_STORAGE_PREFIX + surveyId;
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    globalThis.localStorage?.setItem(key, JSON.stringify({ ...parsed, blockId, history, updatedAt: Date.now() }));
  } catch {
    // ignore
  }
};

// localStorage can be blocked (private mode, quota). Resume then degrades to a fresh start.
export const writeStoredResumeId = (
  surveyId: string,
  responseId: string,
  position?: { blockId: string; history: string[] }
): void => {
  try {
    globalThis.localStorage?.setItem(
      RESUME_STORAGE_PREFIX + surveyId,
      JSON.stringify({ responseId, ...position, updatedAt: Date.now() })
    );
  } catch {
    // ignore
  }
};

export const clearStoredResumeId = (surveyId: string): void => {
  try {
    globalThis.localStorage?.removeItem(RESUME_STORAGE_PREFIX + surveyId);
  } catch {
    // ignore
  }
};
