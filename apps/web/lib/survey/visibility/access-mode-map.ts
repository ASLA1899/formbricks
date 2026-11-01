export type TSurveyAccessMode = "private" | "public";

/**
 * ASLA fork (ASL-1880): the fork's access mode as upstream's visibility. `private` is `restricted`,
 * `public` is `workspace`; the outbox trigger and the projector then write the matching SpiceDB edges
 * (`survey#private_owner` / `survey#shared_workspace`) from the row, exactly as for any visibility change.
 */
export const visibilityForAccessMode = (mode: TSurveyAccessMode): "restricted" | "workspace" =>
  mode === "private" ? "restricted" : "workspace";

export const accessModeForVisibility = (visibility: "restricted" | "workspace"): TSurveyAccessMode =>
  visibility === "restricted" ? "private" : "public";
