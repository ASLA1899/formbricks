export const FALLBACK_SCHEDULE_TIME_ZONE = "America/New_York";
const DATE_ONLY_UTC_HOUR = 12;

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Upstream stores a scheduled day as noon UTC of that calendar date (`toDateOnlySelection`), and its
 * reconciler fires at the deployment's configured local time on that day. The fork stored a UTC
 * instant plus a display time zone, so the day the survey owner picked is the instant's calendar date
 * in that zone. Returns that day as noon UTC.
 */
export const toUpstreamScheduleDate = (instant: Date, timeZone: string): Date => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "", 10);

  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), DATE_ONLY_UTC_HOUR, 0, 0, 0));
};

export interface ForkScheduleRow {
  id: string;
  status: string;
  runOnDate: Date | null;
  closeOnDate: Date | null;
  scheduleTimezone: string | null;
  publishOn: Date | null;
  closeOn: Date | null;
}

export interface ScheduleUpdate {
  id: string;
  publishOn: Date | null;
  closeOn: Date | null;
  /** True when a draft with a pending run date becomes paused. */
  pause: boolean;
  /** Set when the stored zone was missing or invalid and the fallback was used. */
  timeZoneFallback: boolean;
}

/**
 * Decides what a fork schedule maps to. Only dates still in the future are carried: upstream clears a
 * date once it fires, and a past date left in place would fire on the next reconcile (closing a
 * survey the fork had already reopened, say). Existing `publishOn` / `closeOn` values win, so a rerun
 * or a survey already scheduled on 6.1.2 is never overwritten.
 */
export const planScheduleUpdate = (
  row: ForkScheduleRow,
  now: Date,
  defaultTimeZone: string
): ScheduleUpdate | null => {
  const zoneIsUsable = row.scheduleTimezone !== null && isValidTimeZone(row.scheduleTimezone);
  const timeZone = zoneIsUsable && row.scheduleTimezone ? row.scheduleTimezone : defaultTimeZone;

  const runPending =
    row.runOnDate !== null &&
    row.runOnDate.getTime() > now.getTime() &&
    row.publishOn === null &&
    (row.status === "draft" || row.status === "paused");
  const closePending =
    row.closeOnDate !== null &&
    row.closeOnDate.getTime() > now.getTime() &&
    row.closeOn === null &&
    row.status !== "completed";

  if (!runPending && !closePending) return null;

  return {
    id: row.id,
    publishOn: runPending && row.runOnDate ? toUpstreamScheduleDate(row.runOnDate, timeZone) : null,
    closeOn: closePending && row.closeOnDate ? toUpstreamScheduleDate(row.closeOnDate, timeZone) : null,
    pause: runPending && row.status === "draft",
    timeZoneFallback: row.scheduleTimezone !== null && !zoneIsUsable,
  };
};
