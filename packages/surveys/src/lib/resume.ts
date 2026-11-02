import type { TResponseData } from "@formbricks/types/responses";

interface ResumeBlock {
  id: string;
  elements: { id: string }[];
}

/**
 * Where a respondent picking up a saved, unfinished response lands: the block after the last one
 * with an answer. That keeps branches the respondent skipped, and optional questions they passed
 * over, behind them. Branching logic is not replayed, so a jump past the next block can still show
 * it once; the runtime routes correctly on the next submit. Past the last block goes to the first
 * ending. Returns undefined when nothing is answered, so the caller keeps its normal start.
 */
export const getResumeBlockId = (
  blocks: ResumeBlock[],
  endings: { id: string }[],
  answered: TResponseData
): string | undefined => {
  const answeredIds = new Set(Object.keys(answered));
  let lastAnswered = -1;
  blocks.forEach((block, index) => {
    if (block.elements.some((element) => answeredIds.has(element.id))) lastAnswered = index;
  });
  if (lastAnswered === -1) return undefined;
  return blocks[lastAnswered + 1]?.id ?? endings[0]?.id;
};

/**
 * The block to reopen on. A saved block id (the block the respondent was on when they left) wins
 * when it still exists in the survey, since it is the exact position and honors every jump and
 * skipped optional question. Without one, or when the survey changed since, falls back to the block
 * after the last answered one.
 */
export const resolveResumeBlockId = (
  blocks: ResumeBlock[],
  endings: { id: string }[],
  answered: TResponseData,
  savedBlockId?: string | null
): string | undefined => {
  if (savedBlockId && blocks.some((block) => block.id === savedBlockId)) return savedBlockId;
  return getResumeBlockId(blocks, endings, answered);
};
