import "server-only";
import { can } from "@/lib/authorization";

/**
 * ASLA fork (ASL-1881): what the editor may offer this user for a survey. Both answers come from the
 * graph (`can()`), never from a role or a flag on the membership, so the page and the server actions
 * (`survey.change_visibility`, `survey.write`) cannot disagree. A person a survey is only shared with
 * holds `survey.read` alone: they get neither the editor nor the sharing panel.
 */
export const getSurveyEditorPermissions = async (
  userId: string,
  surveyId: string
): Promise<Readonly<{ canManageSharing: boolean; canWrite: boolean }>> => {
  const actor = { id: userId, type: "user" } as const;
  const resource = { id: surveyId, type: "survey" } as const;
  const [canWrite, canManageSharing] = await Promise.all([
    can(actor, "survey.write", resource),
    can(actor, "survey.change_visibility", resource),
  ]);
  return { canManageSharing, canWrite };
};
