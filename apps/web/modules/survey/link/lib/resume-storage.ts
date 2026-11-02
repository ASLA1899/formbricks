const RESUME_STORAGE_PREFIX = "formbricks-resume-";
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredResume {
  responseId: string;
  blockId: string | null;
  history: string[];
  variableStack: StoredVariableEntry[];
  /** Variable values at the saved position (Back rolls these back; the server only has the last forward submit). */
  variables: Record<string, string | number> | null;
  /** Questions made required by earlier blocks' logic, keyed by the block's first question id. */
  requiredByMap: Record<string, string[]>;
}

export interface StoredVariableEntry {
  /** Undefined when the block was submitted with no answers (an untouched optional block). */
  questionId?: string;
  variables: Record<string, string | number>;
}

const isVariableMap = (value: unknown): value is Record<string, string | number> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string" || typeof v === "number");

const isVariableEntry = (entry: unknown): entry is StoredVariableEntry => {
  if (!entry || typeof entry !== "object") return false;
  const { questionId, variables } = entry as Record<string, unknown>;
  if (questionId !== undefined && typeof questionId !== "string") return false;
  return isVariableMap(variables);
};

const isRequiredMap = (value: unknown): value is Record<string, string[]> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => Array.isArray(v) && v.every((id) => typeof id === "string"));

export const readStoredResume = (surveyId: string): StoredResume | null => {
  try {
    const raw = globalThis.localStorage?.getItem(RESUME_STORAGE_PREFIX + surveyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      responseId?: unknown;
      updatedAt?: unknown;
      blockId?: unknown;
      history?: unknown;
      variableStack?: unknown;
      variables?: unknown;
      requiredByMap?: unknown;
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
      // All or nothing: the stack lines up with the history by index, so a bad entry voids it.
      variableStack:
        Array.isArray(parsed.variableStack) && parsed.variableStack.every(isVariableEntry)
          ? parsed.variableStack
          : [],
      variables: isVariableMap(parsed.variables) ? parsed.variables : null,
      requiredByMap: isRequiredMap(parsed.requiredByMap) ? parsed.requiredByMap : {},
    };
  } catch {
    return null;
  }
};

export const readStoredResumeId = (surveyId: string): string | null =>
  readStoredResume(surveyId)?.responseId ?? null;

/** Records the block the respondent is on and the blocks they came through, so Back works after a resume. Only updates an existing record, so it never revives a cleared one. */
export const writeStoredResumeBlock = (
  surveyId: string,
  blockId: string,
  history: string[] = [],
  variableStack: StoredVariableEntry[] = [],
  variables?: Record<string, string | number>,
  requiredByMap: Record<string, string[]> = {}
): void => {
  try {
    const key = RESUME_STORAGE_PREFIX + surveyId;
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    globalThis.localStorage?.setItem(
      key,
      JSON.stringify({
        ...parsed,
        blockId,
        history,
        variableStack,
        variables,
        requiredByMap,
        updatedAt: Date.now(),
      })
    );
  } catch {
    // ignore
  }
};

// localStorage can be blocked (private mode, quota). Resume then degrades to a fresh start.
export const writeStoredResumeId = (
  surveyId: string,
  responseId: string,
  position?: {
    blockId: string;
    history: string[];
    variableStack: StoredVariableEntry[];
    variables?: Record<string, string | number>;
    requiredByMap?: Record<string, string[]>;
  }
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
