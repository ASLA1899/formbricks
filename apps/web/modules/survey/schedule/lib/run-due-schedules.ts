import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { getSurvey, updateSurvey } from "@/lib/survey/service";
import { queueAuditEvent } from "@/modules/ee/audit-logs/lib/handler";
import { UNKNOWN_DATA } from "@/modules/ee/audit-logs/types/audit-log";

type Reason = "scheduled-open" | "scheduled-close";

async function transition(
  candidate: { id: string; environmentId: string },
  newStatus: "inProgress" | "completed",
  reason: Reason
): Promise<boolean> {
  // Fetch the full TSurvey via the canonical helper. Re-checks eligibility
  // against the live status so a race where the user manually changed status
  // between the findMany and now is handled correctly.
  const fresh = await getSurvey(candidate.id);
  if (!fresh) return false;

  const eligibleOpen =
    newStatus === "inProgress" && (fresh.status === "draft" || fresh.status === "paused");
  const eligibleClose =
    newStatus === "completed" && (fresh.status === "inProgress" || fresh.status === "paused");
  if (!eligibleOpen && !eligibleClose) return false;

  // Audit emit needs the organizationId for this survey's environment/project.
  const orgRow = await prisma.environment.findUnique({
    where: { id: fresh.environmentId },
    select: { project: { select: { organizationId: true } } },
  });
  const organizationId = orgRow?.project?.organizationId ?? UNKNOWN_DATA;

  let logStatus: "success" | "failure" = "success";
  try {
    await updateSurvey({ ...fresh, status: newStatus });
  } catch (error) {
    logStatus = "failure";
    logger.error(
      { error, surveyId: fresh.id, fromStatus: fresh.status, toStatus: newStatus, reason },
      "schedule transition failed"
    );
  } finally {
    await queueAuditEvent({
      status: logStatus,
      action: "updated",
      targetType: "survey",
      userId: UNKNOWN_DATA,
      userType: "system",
      targetId: fresh.id,
      organizationId,
      newObject: { status: newStatus, reason },
    });
  }

  return logStatus === "success";
}

export async function runDueSchedules(): Promise<{ opened: number; closed: number }> {
  const now = new Date();

  // Cast where clause to any because the Prisma client types may not yet reflect
  // the runOnDate/closeOnDate fields added to schema.prisma — they exist in the DB.
  const opens = await (prisma.survey.findMany as any)({
    where: { runOnDate: { lte: now }, status: { in: ["draft", "paused"] } },
    select: { id: true, environmentId: true },
  });

  const closes = await (prisma.survey.findMany as any)({
    where: { closeOnDate: { lte: now }, status: { in: ["inProgress", "paused"] } },
    select: { id: true, environmentId: true },
  });

  let opened = 0;
  let closed = 0;

  for (const s of opens) {
    if (await transition(s, "inProgress", "scheduled-open")) opened++;
  }
  for (const s of closes) {
    if (await transition(s, "completed", "scheduled-close")) closed++;
  }

  return { opened, closed };
}
