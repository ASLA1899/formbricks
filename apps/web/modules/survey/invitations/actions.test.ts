import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { AuthorizationError, ResourceNotFoundError } from "@formbricks/types/errors";
import { assertCan } from "@/lib/authorization";
import { getSurvey } from "@/modules/survey/lib/survey";
import {
  getInvitationSummaryAction,
  listSurveyInvitationsAction,
  sendInvitationsAction,
  sendRemindersAction,
} from "./actions";
import {
  enqueueInvitationsForSurvey,
  getInvitationSummary,
  listInvitationsBySurveyId,
  runPendingInvitationSends,
} from "./lib/invitations";
import { sendManualReminders } from "./lib/reminders";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@formbricks/database", () => ({ prisma: { survey: { update: vi.fn() } } }));
vi.mock("@formbricks/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/authorization", () => ({ assertCan: vi.fn() }));
vi.mock("@/lib/utils/action-client", () => ({
  authenticatedActionClient: { inputSchema: vi.fn().mockReturnThis(), action: vi.fn((fn) => fn) },
}));
vi.mock("@/lib/organization/service", () => ({
  getOrganizationByWorkspaceId: vi.fn(async () => ({ name: "ASLA" })),
}));
vi.mock("@/modules/survey/lib/survey", () => ({ getSurvey: vi.fn() }));
vi.mock("./lib/invitations", () => ({
  enqueueInvitationsForSurvey: vi.fn(),
  getInvitationSummary: vi.fn(),
  listInvitationsBySurveyId: vi.fn(),
  runPendingInvitationSends: vi.fn(),
}));
vi.mock("./lib/reminders", () => ({ sendManualReminders: vi.fn() }));

const ctx = { user: { id: "user-1" } };
const surveyId = "clsurvey00000000000000000";
const config = {
  audience: { source: "segment", segmentId: "clsegment0000000000000000" },
  reminderSchedule: { enabled: false, daysAfterInvite: [], maxReminders: 0 },
  emailTemplates: { invitation: { subject: "s", body: "b" }, reminder: { subject: "s", body: "b" } },
};
type TAction = (args: { ctx: typeof ctx; parsedInput: Record<string, unknown> }) => Promise<unknown>;
const run = (action: unknown, parsedInput: Record<string, unknown>) =>
  (action as TAction)({ ctx, parsedInput });
const resource = { type: "survey", id: surveyId };

describe("invitation actions", () => {
  beforeEach(() => {
    vi.mocked(assertCan).mockResolvedValue(undefined);
    vi.mocked(getSurvey).mockResolvedValue({ id: surveyId, name: "Pulse", workspaceId: "w1" } as never);
    vi.mocked(enqueueInvitationsForSurvey).mockResolvedValue({ enqueued: 2, alreadySent: 0 });
    vi.mocked(runPendingInvitationSends).mockResolvedValue({ sent: 0, failed: 0, remaining: 0 });
    vi.mocked(sendManualReminders).mockResolvedValue({ sent: 1, skipped: 0, failed: 0 });
    vi.mocked(prisma.survey.update).mockResolvedValue({} as never);
  });

  test("read actions need survey.read", async () => {
    await run(getInvitationSummaryAction, { surveyId });
    await run(listSurveyInvitationsAction, { surveyId });
    expect(assertCan).toHaveBeenNthCalledWith(1, { type: "user", id: "user-1" }, "survey.read", resource);
    expect(assertCan).toHaveBeenNthCalledWith(2, { type: "user", id: "user-1" }, "survey.read", resource);
    expect(getInvitationSummary).toHaveBeenCalledWith(surveyId);
    expect(listInvitationsBySurveyId).toHaveBeenCalledWith(surveyId);
  });

  test("a denied read returns nothing", async () => {
    vi.mocked(assertCan).mockRejectedValue(new AuthorizationError("Not authorized"));
    await expect(run(getInvitationSummaryAction, { surveyId })).rejects.toThrow(AuthorizationError);
    expect(getInvitationSummary).not.toHaveBeenCalled();
  });

  test("send needs survey.write, saves the config, queues, and drains in the background", async () => {
    const res = await run(sendInvitationsAction, { surveyId, config });
    expect(assertCan).toHaveBeenCalledWith({ type: "user", id: "user-1" }, "survey.write", resource);
    expect(prisma.survey.update).toHaveBeenCalledWith({
      where: { id: surveyId },
      data: { invitationConfig: config },
    });
    expect(enqueueInvitationsForSurvey).toHaveBeenCalledWith({ surveyId, workspaceId: "w1", config });
    expect(runPendingInvitationSends).toHaveBeenCalledWith({ surveyId });
    expect(revalidatePath).toHaveBeenCalledWith(`/workspaces/w1/surveys/${surveyId}`);
    expect(res).toEqual({ enqueued: 2, alreadySent: 0 });
  });

  test("send does not start the drainer when nothing was queued", async () => {
    vi.mocked(enqueueInvitationsForSurvey).mockResolvedValue({ enqueued: 0, alreadySent: 3 });
    await run(sendInvitationsAction, { surveyId, config });
    expect(runPendingInvitationSends).not.toHaveBeenCalled();
  });

  test("a denied send writes nothing and queues nothing", async () => {
    vi.mocked(assertCan).mockRejectedValue(new AuthorizationError("Not authorized"));
    await expect(run(sendInvitationsAction, { surveyId, config })).rejects.toThrow(AuthorizationError);
    expect(prisma.survey.update).not.toHaveBeenCalled();
    expect(enqueueInvitationsForSurvey).not.toHaveBeenCalled();
  });

  test("remind needs survey.write and sends through the manual path", async () => {
    const res = await run(sendRemindersAction, { surveyId, config, minDaysSinceLast: 2 });
    expect(assertCan).toHaveBeenCalledWith({ type: "user", id: "user-1" }, "survey.write", resource);
    expect(sendManualReminders).toHaveBeenCalledWith({
      surveyId,
      organizationName: "ASLA",
      surveyName: "Pulse",
      config,
      minDaysSinceLast: 2,
    });
    expect(res).toEqual({ sent: 1, skipped: 0, failed: 0 });
  });

  test("an unknown survey is a not-found error and nothing is saved", async () => {
    vi.mocked(getSurvey).mockResolvedValue(null as never);
    await expect(run(sendInvitationsAction, { surveyId, config })).rejects.toThrow(ResourceNotFoundError);
    await expect(run(sendRemindersAction, { surveyId, config })).rejects.toThrow(ResourceNotFoundError);
    expect(prisma.survey.update).not.toHaveBeenCalled();
  });
});
