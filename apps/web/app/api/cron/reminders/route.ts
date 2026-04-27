import { headers } from "next/headers";
import { logger } from "@formbricks/logger";
import { CRON_SECRET } from "@/lib/constants";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";

// POST /api/cron/reminders
// Auth: header `x-api-key: $CRON_SECRET` (same convention as /api/(internal)/pipeline).
// Drains pending survey invitations AND fires any eligible scheduled reminders.
// Both loops throttle per-send to stay under SMTP-provider rate limits, so this
// endpoint can be called as frequently as needed — recommended every 5 min so
// invitations queued by the user-triggered action go out promptly even if the
// background drainer crashes or hits the chunk cap.
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
