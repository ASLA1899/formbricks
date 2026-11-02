export const FALLBACK_SCHEDULE_TIME_ZONE = "America/New_York";

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

export interface SchedulingConfig {
  timeZone: string;
  localHour: number;
  localMinute: number;
}

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  timeZone: "Europe/Berlin",
  localHour: 0,
  localMinute: 0,
};

/** Reads the same three env vars as `apps/web/lib/env.ts`, with the same defaults. Invalid values fall back. */
export const readSchedulingConfig = (env: Record<string, string | undefined>): SchedulingConfig => {
  const zone = env.SURVEY_SCHEDULING_TIME_ZONE?.trim();
  const hour = Number.parseInt(env.SURVEY_SCHEDULING_LOCAL_HOUR ?? "", 10);
  const minute = Number.parseInt(env.SURVEY_SCHEDULING_LOCAL_MINUTE ?? "", 10);
  return {
    timeZone: zone && isValidTimeZone(zone) ? zone : DEFAULT_SCHEDULING_CONFIG.timeZone,
    localHour: hour >= 0 && hour <= 23 ? hour : DEFAULT_SCHEDULING_CONFIG.localHour,
    localMinute: minute >= 0 && minute <= 59 ? minute : DEFAULT_SCHEDULING_CONFIG.localMinute,
  };
};

const getZoneDateParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
};

const getZoneOffsetMs = (date: Date, timeZone: string): number => {
  const value = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!value || value === "GMT") return 0;
  const match = /^GMT(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?$/.exec(value);
  if (!match?.groups) throw new Error(`Unsupported time zone offset: ${value}`);
  const sign = match.groups.sign === "+" ? 1 : -1;
  return (
    sign *
    ((Number.parseInt(match.groups.hours, 10) * 60 + Number.parseInt(match.groups.minutes || "0", 10)) *
      60000)
  );
};

/**
 * Port of the app's `createSurveySchedulingDateTime` (apps/web/modules/survey/scheduling/lib/date-utils.ts):
 * the instant at which `year-month-day` (month is 0-based) reaches the configured local time in the
 * deployment's scheduling zone. DST-safe.
 */
export const createSchedulingDateTime = (
  year: number,
  month: number,
  day: number,
  config: SchedulingConfig
): Date => {
  const guessMs = Date.UTC(year, month, day, config.localHour, config.localMinute, 0, 0);
  let candidate = new Date(guessMs);
  for (let attempt = 0; attempt < 3; attempt++) {
    candidate = new Date(guessMs - getZoneOffsetMs(candidate, config.timeZone));
    const p = getZoneDateParts(candidate, config.timeZone);
    if (
      p.year === year &&
      p.month === month + 1 &&
      p.day === day &&
      p.hour === config.localHour &&
      p.minute === config.localMinute
    ) {
      return candidate;
    }
  }
  return candidate;
};

/**
 * The fork stored a UTC instant plus a display zone, so the day the survey owner picked is the
 * instant's calendar date in that zone. Upstream stores that day as the deployment's scheduling
 * time (e.g. 00:00 in SURVEY_SCHEDULING_TIME_ZONE) and its reconciler compares the stored instant with
 * now, so this returns exactly what the app would persist for that day.
 */
export const toUpstreamScheduleDate = (instant: Date, timeZone: string, config: SchedulingConfig): Date => {
  const { year, month, day } = getZoneDateParts(instant, timeZone);
  return createSchedulingDateTime(year, month - 1, day, config);
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
  defaultTimeZone: string,
  config: SchedulingConfig
): ScheduleUpdate | null => {
  const zoneIsUsable = row.scheduleTimezone !== null && isValidTimeZone(row.scheduleTimezone);
  const timeZone = zoneIsUsable && row.scheduleTimezone ? row.scheduleTimezone : defaultTimeZone;

  const publishOn =
    row.runOnDate !== null && row.publishOn === null && (row.status === "draft" || row.status === "paused")
      ? toUpstreamScheduleDate(row.runOnDate, timeZone, config)
      : null;
  // Completed surveys keep a future close date too, so reopening one does not lose the deadline.
  const closeOn =
    row.closeOnDate !== null && row.closeOn === null
      ? toUpstreamScheduleDate(row.closeOnDate, timeZone, config)
      : null;

  // Compare the converted value, not the fork instant: that is what the reconciler compares.
  const runPending = publishOn !== null && publishOn.getTime() > now.getTime();
  const closePending = closeOn !== null && closeOn.getTime() > now.getTime();

  if (!runPending && !closePending) return null;

  return {
    id: row.id,
    publishOn: runPending ? publishOn : null,
    closeOn: closePending ? closeOn : null,
    pause: runPending && row.status === "draft",
    timeZoneFallback: row.scheduleTimezone !== null && !zoneIsUsable,
  };
};
