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
  const lastAnswered = blocks.findLastIndex((block) =>
    block.elements.some((element) => answeredIds.has(element.id))
  );
  if (lastAnswered === -1) return undefined;
  return blocks[lastAnswered + 1]?.id ?? endings[0]?.id;
};
