import type { TResponseData } from "@formbricks/types/responses";

interface ResumeBlock {
  id: string;
  elements: { id: string }[];
}

/**
 * Where a respondent picking up a saved, unfinished response lands: the first block with an
 * unanswered element. Branching logic is not replayed, so a skipped block can show briefly; the
 * runtime routes correctly on the next submit. Everything answered goes to the first ending.
 * Returns undefined when there is nothing to jump to, so the caller keeps its normal start.
 */
export const getResumeBlockId = (
  blocks: ResumeBlock[],
  endings: { id: string }[],
  answered: TResponseData
): string | undefined => {
  const answeredIds = new Set(Object.keys(answered));
  const next = blocks.find((block) => block.elements.some((element) => !answeredIds.has(element.id)));
  if (next) return next.id;
  return endings[0]?.id;
};
