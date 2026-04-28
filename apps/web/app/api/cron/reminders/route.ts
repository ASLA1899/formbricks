import { headers } from "next/headers";
import { logger } from "@formbricks/logger";
import { CRON_SECRET } from "@/lib/constants";
import { runDueSyncs } from "@/modules/contacts/lib/sync-runner";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";

// POST /api/cron/reminders
// Auth: header `x-api-key: $CRON_SECRET` (same convention as /api/(internal)/pipeline).
// Drains pending survey invitations, fires any eligible scheduled reminders, and
// runs any due Contact syncs. Each sub-task is independent: failure in one is
// logged but doesn't fail the rest. Recommended cadence: every 5 min.
export const POST = async (request: Request) => {
  const requestHeaders = await headers();
  if (!CRON_SECRET || requestHeaders.get("x-api-key") !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};
  try {
    result.invitations = await runPendingInvitationSends({});
  } catch (error) {
    logger.error({ error, url: request.url }, "invitation drain failed");
    result.invitations = { error: "failed" };
  }
  try {
    result.reminders = await runScheduledReminders();
  } catch (error) {
    logger.error({ error, url: request.url }, "reminder drain failed");
    result.reminders = { error: "failed" };
  }
  try {
    result.syncs = await runDueSyncs();
  } catch (error) {
    logger.error({ error, url: request.url }, "sync runner failed");
    result.syncs = { error: "failed" };
  }

  return Response.json({ ok: true, ...result });
};
