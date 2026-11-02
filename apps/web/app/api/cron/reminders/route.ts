import { headers } from "next/headers";
import { logger } from "@formbricks/logger";
import { CRON_SECRET } from "@/lib/constants";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";

// POST /api/cron/reminders (ASLA fork; upstream 6.x moved its scheduled work to BullMQ)
// Auth: header `x-api-key: $CRON_SECRET`.
// Drains pending survey invitations AND fires any eligible scheduled reminders. Both loops throttle
// per send to stay under SMTP-provider rate limits, so this endpoint can be called as often as needed;
// every 5 minutes is the production cadence, so invitations queued by the user-triggered action go out
// promptly even if the background drainer crashes or hits the chunk cap.
// Survey publish and close dates are NOT handled here: 6.x runs them as a BullMQ job.
export const POST = async (request: Request) => {
  const requestHeaders = await headers();
  if (!CRON_SECRET || requestHeaders.get("x-api-key") !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const invitations = await runPendingInvitationSends({});
    const reminders = await runScheduledReminders();
    return Response.json({ ok: true, invitations, reminders });
  } catch (error) {
    logger.error({ error, url: request.url }, "cron drain failed");
    return Response.json({ ok: false, error: "internal_server_error" }, { status: 500 });
  }
};
