const RESUME_STORAGE_PREFIX = "formbricks-resume-";

export const readStoredResumeId = (surveyId: string): string | null => {
  try {
    const raw = globalThis.localStorage?.getItem(RESUME_STORAGE_PREFIX + surveyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { responseId?: unknown };
    return typeof parsed.responseId === "string" && parsed.responseId ? parsed.responseId : null;
  } catch {
    return null;
  }
};

// localStorage can be blocked (private mode, quota). Resume then degrades to a fresh start.
export const writeStoredResumeId = (surveyId: string, responseId: string): void => {
  try {
    globalThis.localStorage?.setItem(
      RESUME_STORAGE_PREFIX + surveyId,
      JSON.stringify({ responseId, updatedAt: Date.now() })
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
