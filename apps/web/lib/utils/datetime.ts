const DEFAULT_LOCALE = "en-US";

const DEFAULT_DATE_DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const DEFAULT_DATE_TIME_DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

// Helper function to calculate difference in days between two dates
export const diffInDays = (date1: Date, date2: Date) => {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

export const formatDateForDisplay = (
  date: Date,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_DISPLAY_OPTIONS
): string => {
  return new Intl.DateTimeFormat(locale, options).format(date);
};

export const formatDateTimeForDisplay = (
  date: Date,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_DISPLAY_OPTIONS
): string => {
  return new Intl.DateTimeFormat(locale, options).format(date);
};

export const formatDateWithOrdinal = (date: Date, locale: string = DEFAULT_LOCALE): string => {
  return formatDateForDisplay(date, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export const isMonthYearString = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);

export const formatMonthYear = (value: string, locale: string = "en-US"): string => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
};

export const isValidDateString = (value: string) => {
  const regex = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4})$/;

  if (!regex.test(value)) {
    return false;
  }

  const normalizedValue = /^\d{1,2}-\d{1,2}-\d{4}$/.test(value)
    ? value.replace(/(\d{1,2})-(\d{1,2})-(\d{4})/, "$3-$2-$1")
    : value;

  const date = new Date(normalizedValue);
  return !Number.isNaN(date.getTime());
};

export const getFormattedDateTimeString = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };

  return new Intl.DateTimeFormat("en-CA", options).format(date).replace(",", "");
};

/**
 * Formats a duration in milliseconds as an H:MM:SS clock string.
 * Hours are unpadded; minutes and seconds are zero-padded. Seconds are rounded.
 * e.g. 2650411 -> "0:44:10", 38000 -> "0:00:38", 3750000 -> "1:02:30".
 */
export const formatDurationClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};
