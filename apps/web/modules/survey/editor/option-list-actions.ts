"use server";

import { z } from "zod";
import { ZId } from "@formbricks/types/common";
import { ResourceNotFoundError } from "@formbricks/types/errors";
import { ZOptionListInput } from "@formbricks/types/option-list";
import { assertCan } from "@/lib/authorization";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { applyRateLimit } from "@/modules/core/rate-limit/helpers";
import { rateLimitConfigs } from "@/modules/core/rate-limit/rate-limit-configs";
import {
  createOptionList,
  deleteOptionList,
  getOptionList,
  getOptionListsByWorkspaceId,
} from "@/modules/survey/editor/lib/option-list";

const ZGetOptionListsAction = z.object({
  workspaceId: ZId,
});

export const getOptionListsAction = authenticatedActionClient
  .inputSchema(ZGetOptionListsAction)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "workspace.read", {
      type: "workspace",
      id: parsedInput.workspaceId,
    });

    return await getOptionListsByWorkspaceId(parsedInput.workspaceId);
  });

const ZCreateOptionListAction = ZOptionListInput.extend({
  workspaceId: ZId,
});

export const createOptionListAction = authenticatedActionClient
  .inputSchema(ZCreateOptionListAction)
  .action(async ({ ctx, parsedInput }) => {
    await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
      type: "workspace",
      id: parsedInput.workspaceId,
    });
    await applyRateLimit(rateLimitConfigs.actions.stateMutation, parsedInput.workspaceId);

    return await createOptionList(parsedInput.workspaceId, {
      name: parsedInput.name,
      options: parsedInput.options,
    });
  });

const ZDeleteOptionListAction = z.object({
  optionListId: ZId,
});

export const deleteOptionListAction = authenticatedActionClient
  .inputSchema(ZDeleteOptionListAction)
  .action(async ({ ctx, parsedInput }) => {
    const optionList = await getOptionList(parsedInput.optionListId);
    if (!optionList) {
      throw new ResourceNotFoundError("OptionList", parsedInput.optionListId);
    }

    await assertCan({ type: "user", id: ctx.user.id }, "workspace.write", {
      type: "workspace",
      id: optionList.workspaceId,
    });
    await applyRateLimit(rateLimitConfigs.actions.stateMutation, optionList.workspaceId);

    await deleteOptionList(parsedInput.optionListId);
  });
