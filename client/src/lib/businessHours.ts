import type { BusinessHoliday } from "../types";

/** Formats an "HH:MM" 24-hour time as a friendly 12-hour string, e.g. "09:00" -> "9am", "18:30" -> "6:30pm". */
export function formatHour(time: string): string {
  const [hourStr, minute] = time.split(":");
  const hour = Number(hourStr);
  const period = hour < 12 ? "am" : "pm";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${displayHour}${period}` : `${displayHour}:${minute}${period}`;
}

/**
 * Today's date as "YYYY-MM-DD", using the browser's *local* calendar date -
 * not `toISOString()`, which converts to UTC and would be off by a day for
 * a meaningful chunk of the day in any timezone that isn't UTC (including
 * Lebanon, UTC+2/+3, this app's own target market). A holiday's `date` is
 * entered as a plain local calendar date (an `<input type="date">` value)
 * and stored as UTC midnight of that same string, so slicing the returned
 * ISO string's first 10 characters reliably reproduces the original
 * "YYYY-MM-DD" regardless of server timezone - "today" must be computed the
 * same timezone-agnostic way to compare correctly against it.
 */
export function getTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The holiday exception (if any) whose date is today - used to auto-surface a same-day closure/special-hours warning. */
export function findTodayHoliday(holidays: BusinessHoliday[]): BusinessHoliday | undefined {
  const today = getTodayIso();
  return holidays.find((h) => h.date.slice(0, 10) === today);
}

/**
 * Formats a `BusinessHoliday.date` for display. Forces `timeZone: "UTC"`
 * so the rendered day always matches the plain "YYYY-MM-DD" originally
 * entered (see `getTodayIso()`'s comment) - without it, `toLocaleDateString`
 * would shift the displayed date back a day for any viewer west of UTC.
 */
export function formatHolidayDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
