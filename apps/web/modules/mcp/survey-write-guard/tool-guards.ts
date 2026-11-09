import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { logger } from "@formbricks/logger";
import { buildV3AuditLog, queueV3AuditLog } from "@/app/api/v3/lib/audit";
import { problemConflict, problemUnprocessableContent } from "@/app/api/v3/lib/response";
import { getAuthorizedV3Survey } from "@/app/api/v3/surveys/authorization";
import { env } from "@/lib/env";
import { getMcpResourceUrl } from "@/modules/auth/lib/oauth-urls";
import type { TAuditAction, TAuditTarget } from "@/modules/ee/audit-logs/types/audit-log";
import { MCP_API_ROUTE } from "@/modules/mcp/constants";
import { isAppStorageFileUrl } from "@/modules/storage/utils";
import {
  type TMcpToolContext,
  getMcpAuthentication,
  getMcpRequestId,
  getMcpToolAuthInfo,
  hasMcpScopes,
} from "../auth";
import { responseToMcpToolResult } from "../errors";
import { ZMcpCreateSurveyInput } from "../tools/schemas";
import {
  type TSurveyBlockAt,
  type TSurveyContentPolicy,
  type TSurveyContentViolation,
  findSurveyContentViolations,
  topLevelBlocks,
} from "./content-policy";

/**
 * ASLA (Must 3 and Must 5): the draft-only guard on the MCP survey write tools.
 *
 * Upstream's tool modules stay untouched. Each guard below receives a tool's registration on its way to
 * the server (see `withMcpToolAllowlist`) and returns it with a wrapped handler, and sometimes a new name,
 * schema or description. The wrapped handler runs only for a caller that holds `surveys:write`; anyone
 * else goes straight to upstream's scope guard, so its refusal and audit event are unchanged. Then:
 *
 * - `create_survey` becomes `create_survey_draft`: always `status: "draft"`, link type, and no
 *   `customCss` or `metadata` (settings belong to `update_survey_settings`, Must 11).
 * - `patch_survey`, `edit_survey_blocks`, `set_survey_block_order` and `delete_survey` act only on a
 *   survey that is a draft right now, read through the same permission check v3 uses, so a survey the
 *   caller cannot reach gets v3's 403 rather than a hint about its status. `patch_survey` takes only
 *   content fields and never a status other than `draft`.
 * - The draft check is made atomic with the write: the `updatedAt` read alongside the status is sent as
 *   the v3 optimistic-concurrency precondition when the caller sent none, so a survey published between
 *   the check and the write fails with 409 instead of being edited. `delete_survey` has no precondition
 *   upstream; its window is the one documented gap.
 * - Every write is held to the Must 5 content rules (`content-policy.ts`).
 *
 * A refusal is a failed audit event, like a scope refusal.
 */

export type TMcpToolHandler = (input: unknown, ctx: TMcpToolContext) => Promise<CallToolResult>;

export type TMcpToolRegistration = {
  name: string;
  config: Record<string, unknown>;
  handler: TMcpToolHandler;
};

export type TMcpToolGuard = (registration: TMcpToolRegistration) => TMcpToolRegistration;

const WRITE_SCOPE = ["surveys:write"];

type TMcpToolAudit = { action: TAuditAction; targetType: TAuditTarget; targetIdArg?: string };

/**
 * A refusal as a failed audit event, built the way `registerScopedTool` records a scope refusal (whose
 * helper stays private to that module, ENG-2119): the caller is known, the event starts as a failure.
 */
const auditRefusal = async (
  toolName: string,
  audit: TMcpToolAudit,
  input: unknown,
  ctx: TMcpToolContext
): Promise<void> => {
  const authInfo = getMcpToolAuthInfo(ctx);
  const requestId = getMcpRequestId(authInfo);
  const auditLog = buildV3AuditLog(
    getMcpAuthentication(authInfo),
    audit.action,
    audit.targetType,
    getMcpResourceUrl()
  );
  if (!auditLog) return;
  auditLog.eventId = requestId;
  const targetId = audit.targetIdArg
    ? (input as Record<string, unknown> | null)?.[audit.targetIdArg]
    : undefined;
  if (typeof targetId === "string") auditLog.targetId = targetId;
  await queueV3AuditLog(auditLog, requestId, logger.withContext({ requestId, tool: toolName }));
};

/** Root keys `patch_survey` may set from chat. Settings go through `update_survey_settings` (Must 11). */
const PATCH_CONTENT_KEYS = new Set([
  "name",
  "languages",
  "showLanguageSwitch",
  "autoSelectLanguage",
  "welcomeCard",
  "blocks",
  "endings",
  "hiddenFields",
  "variables",
]);

/**
 * Read-only keys v3 accepts on a patch when unchanged, so `get_survey` output can be sent back as is.
 * `status` is handled separately: only `draft` is accepted.
 */
const PATCH_READ_ONLY_KEYS = new Set([
  "id",
  "workspaceId",
  "type",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "defaultLanguage",
]);

export const getMcpSurveyContentPolicy = (): TSurveyContentPolicy => ({
  allowedMediaHosts: new Set(env.MCP_ALLOWED_IMAGE_HOSTS ?? []),
  isStorageUrl: isAppStorageFileUrl,
});

type TGuardContext = {
  toolName: string;
  audit: TMcpToolAudit;
  input: unknown;
  ctx: TMcpToolContext;
};

const refuse = async (
  { toolName, audit, input, ctx }: TGuardContext,
  response: Response,
  reason: string
): Promise<CallToolResult> => {
  const authInfo = getMcpToolAuthInfo(ctx);
  const requestId = getMcpRequestId(authInfo);
  const surveyId = (input as { surveyId?: unknown } | null)?.surveyId;
  logger
    .withContext({ requestId, tool: toolName })
    .warn(
      { reason, surveyId: typeof surveyId === "string" ? surveyId : undefined },
      "MCP draft guard refused"
    );
  await auditRefusal(toolName, audit, input, ctx);
  return await responseToMcpToolResult(response, requestId);
};

const refuseContent = (
  guard: TGuardContext,
  violations: TSurveyContentViolation[]
): Promise<CallToolResult> => {
  const requestId = getMcpRequestId(getMcpToolAuthInfo(guard.ctx));
  return refuse(
    guard,
    problemUnprocessableContent(
      requestId,
      "The survey contains content that can't be written from chat. Fix the listed fields and retry.",
      {
        instance: MCP_API_ROUTE,
        invalid_params: violations.map(({ path, reason }) => ({ name: path, reason })),
      }
    ),
    "content_policy"
  );
};

/**
 * The survey's current status and `updatedAt`, read with v3's write-permission check. Returns the v3
 * refusal unchanged when the caller cannot write the survey.
 */
const readDraftState = async (
  guard: TGuardContext,
  surveyId: string
): Promise<{ refusal: CallToolResult } | { updatedAt: string }> => {
  const authInfo = getMcpToolAuthInfo(guard.ctx);
  const requestId = getMcpRequestId(authInfo);
  const { survey, response } = await getAuthorizedV3Survey({
    surveyId,
    authentication: getMcpAuthentication(authInfo),
    access: "readWrite",
    requestId,
    instance: MCP_API_ROUTE,
  });
  if (response) return { refusal: await responseToMcpToolResult(response, requestId) };
  if (survey.status !== "draft") {
    return {
      refusal: await refuse(
        guard,
        problemConflict(
          requestId,
          `This survey is ${survey.status}, not a draft. Chat can change only draft surveys; use prepare_status_change for its status, or edit it in Formbricks.`,
          MCP_API_ROUTE
        ),
        "not_draft"
      ),
    };
  }
  return { updatedAt: survey.updatedAt.toISOString() };
};

/**
 * Wrap a write tool's handler. `check` returns the input to forward (possibly amended) or a refusal.
 * A caller without `surveys:write` skips the check: upstream's scope guard refuses and audits it.
 */
const guardHandler =
  (
    toolName: string,
    audit: TMcpToolAudit,
    handler: TMcpToolHandler,
    check: (guard: TGuardContext) => Promise<{ refusal: CallToolResult } | { input: unknown }>
  ): TMcpToolHandler =>
  async (input, ctx) => {
    if (!hasMcpScopes(getMcpToolAuthInfo(ctx), WRITE_SCOPE)) return handler(input, ctx);
    const outcome = await check({ toolName, audit, input, ctx });
    return "refusal" in outcome ? outcome.refusal : handler(outcome.input, ctx);
  };

const SURVEY_UPDATED: TMcpToolAudit = { action: "updated", targetType: "survey", targetIdArg: "surveyId" };

export const ZMcpCreateSurveyDraftInput = ZMcpCreateSurveyInput.omit({
  status: true,
  type: true,
  customCss: true,
  metadata: true,
});

const CONTENT_RULES =
  "Question types: openText, multipleChoiceSingle, multipleChoiceMulti, rating, nps, matrix, ranking, consent, date, cta, csat, ces, pictureSelection; other types are added in the Formbricks editor. Images and videos must be Formbricks storage files or on an allowed host, and links must be https.";

const guardCreate: TMcpToolGuard = ({ config, handler }) => {
  const audit: TMcpToolAudit = { action: "created", targetType: "survey" };
  return {
    name: "create_survey_draft",
    config: {
      ...config,
      title: "Create survey draft",
      description: [
        "Create a Formbricks link survey as a draft, using the v3 Surveys API contract. It is never published here: status changes go through prepare_status_change and apply_status_change after the person says yes.",
        "Show the person the draft questions and get a yes before calling this.",
        CONTENT_RULES,
      ].join(" "),
      inputSchema: ZMcpCreateSurveyDraftInput,
    },
    handler: guardHandler("create_survey_draft", audit, handler, async (guard) => {
      const violations = findSurveyContentViolations(
        { document: guard.input, blocks: topLevelBlocks(guard.input) },
        getMcpSurveyContentPolicy()
      );
      if (violations.length > 0) return { refusal: await refuseContent(guard, violations) };
      return { input: { ...(guard.input as Record<string, unknown>), status: "draft", type: "link" } };
    }),
  };
};

const guardPatch: TMcpToolGuard = ({ name, config, handler }) => ({
  name,
  config: {
    ...config,
    description: [
      "Update a draft survey's content fields — name, languages, showLanguageSwitch, autoSelectLanguage, welcomeCard, blocks, endings, hiddenFields, variables — using the v3 Surveys API patch contract. Only draft surveys can be changed, and status can't be changed here (use prepare_status_change).",
      "For block changes prefer edit_survey_blocks (update, insert, remove) or set_survey_block_order (reorder): they address blocks by id and cannot drop a block by omission.",
      "Provided top-level arrays and objects replace that whole subtree, so a partial `blocks` array deletes every block it leaves out.",
      "The full get_survey output can be sent back unchanged; `updatedAt` is then an optimistic-concurrency precondition and a mismatch returns 409.",
      CONTENT_RULES,
    ].join(" "),
  },
  handler: guardHandler(name, SURVEY_UPDATED, handler, async (guard) => {
    const { surveyId, data } = guard.input as { surveyId: string; data: Record<string, unknown> };
    const requestId = getMcpRequestId(getMcpToolAuthInfo(guard.ctx));

    const refusedKeys = Object.keys(data).filter(
      (key) =>
        !PATCH_CONTENT_KEYS.has(key) &&
        !PATCH_READ_ONLY_KEYS.has(key) &&
        !(key === "status" && data.status === "draft")
    );
    if (refusedKeys.length > 0) {
      return {
        refusal: await refuse(
          guard,
          problemUnprocessableContent(
            requestId,
            "patch_survey changes only a draft's content. Status goes through prepare_status_change; settings through update_survey_settings.",
            {
              instance: MCP_API_ROUTE,
              invalid_params: refusedKeys.map((key) => ({
                name: `data.${key}`,
                reason:
                  key === "status"
                    ? "Status can't be changed with patch_survey. Use prepare_status_change."
                    : "This field can't be changed with patch_survey.",
              })),
            }
          ),
          "patch_field"
        ),
      };
    }

    const violations = findSurveyContentViolations(
      {
        document: data,
        documentPath: ["data"],
        blocks: topLevelBlocks(data).map(({ block, path }) => ({ block, path: ["data", ...path] })),
      },
      getMcpSurveyContentPolicy()
    );
    if (violations.length > 0) return { refusal: await refuseContent(guard, violations) };

    const state = await readDraftState(guard, surveyId);
    if ("refusal" in state) return state;
    return { input: { surveyId, data: { ...data, updatedAt: data.updatedAt ?? state.updatedAt } } };
  }),
});

const guardEditBlocks: TMcpToolGuard = ({ name, config, handler }) => ({
  name,
  config: {
    ...config,
    description: [
      "Preferred tool for changing a draft survey's questions: update, insert or remove whole blocks by id without resending the others. Only draft surveys can be changed.",
      "Operations apply in order and atomically — either all of them land or none do.",
      "Call get_survey first and pass its `updatedAt` as `expectedUpdatedAt`; on a 409 re-read and retry.",
      "An `update` replaces the whole block, so build it from a fresh read — anything you omit is dropped, and block content must carry every configured language.",
      "An inserted block gets an id automatically; supply your own only if a later op in the same request needs to anchor after it.",
      CONTENT_RULES,
    ].join(" "),
  },
  handler: guardHandler(name, SURVEY_UPDATED, handler, async (guard) => {
    const input = guard.input as {
      surveyId: string;
      ops: { op: string; block?: unknown }[];
      expectedUpdatedAt?: string;
    };
    const blocks: TSurveyBlockAt[] = input.ops.flatMap((op, index) =>
      op.block === undefined ? [] : [{ block: op.block, path: ["ops", String(index), "block"] }]
    );
    const violations = findSurveyContentViolations(
      { document: input.ops, documentPath: ["ops"], blocks },
      getMcpSurveyContentPolicy()
    );
    if (violations.length > 0) return { refusal: await refuseContent(guard, violations) };

    const state = await readDraftState(guard, input.surveyId);
    if ("refusal" in state) return state;
    return { input: { ...input, expectedUpdatedAt: input.expectedUpdatedAt ?? state.updatedAt } };
  }),
});

const guardBlockOrder: TMcpToolGuard = ({ name, config, handler }) => ({
  name,
  config: {
    ...config,
    description: `${String(config.description ?? "")} Only draft surveys can be reordered.`,
  },
  handler: guardHandler(name, SURVEY_UPDATED, handler, async (guard) => {
    const input = guard.input as { surveyId: string; expectedUpdatedAt?: string };
    const state = await readDraftState(guard, input.surveyId);
    if ("refusal" in state) return state;
    return { input: { ...input, expectedUpdatedAt: input.expectedUpdatedAt ?? state.updatedAt } };
  }),
});

const guardDelete: TMcpToolGuard = ({ name, config, handler }) => ({
  name,
  config: {
    ...config,
    description:
      "Delete a draft Formbricks survey using the v3 Surveys API contract. Only draft surveys can be deleted from chat; confirm with the person first.",
  },
  handler: guardHandler(
    name,
    { action: "deleted", targetType: "survey", targetIdArg: "surveyId" },
    handler,
    async (guard) => {
      const input = guard.input as { surveyId: string };
      const state = await readDraftState(guard, input.surveyId);
      return "refusal" in state ? state : { input };
    }
  ),
});

/**
 * Keyed by the upstream name a tool module registers. Every write tool `MCP_TOOL_ALLOWLIST` exposes must
 * have a guard here or be an ASLA tool that enforces the rules itself; `route.test.ts` fails otherwise.
 */
export const MCP_TOOL_GUARDS: Readonly<Record<string, TMcpToolGuard>> = {
  create_survey: guardCreate,
  patch_survey: guardPatch,
  edit_survey_blocks: guardEditBlocks,
  set_survey_block_order: guardBlockOrder,
  delete_survey: guardDelete,
};
