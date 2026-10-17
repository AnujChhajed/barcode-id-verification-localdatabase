/**
 * Formats a Date as ISO-8601 UTC.
 *
 * Milliseconds are KEPT deliberately. Timestamps are compared as strings (for
 * example, the duplicate-scan window), and whole-second values cannot order two
 * rows written in the same second — a scan in and a scan out would then sort
 * arbitrarily, which would make "who is on site" unreliable. Fixed-width
 * milliseconds keep string order identical to chronological order.
 */
function toIso(date) {
  return date.toISOString();
}

export function nowIso(now = new Date()) {
  return toIso(now);
}

export function addMinutes(date, minutes) {
  return toIso(new Date(date.getTime() + minutes * 60_000));
}

export function addSeconds(date, seconds) {
  return toIso(new Date(date.getTime() + seconds * 1_000));
}

/**
 * Fail closed: a malformed or missing timestamp is treated as already past,
 * so an unreadable session can never be considered valid.
 */
export function isPast(iso, now = new Date()) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return true;
  return parsed <= now.getTime();
}

/** Local calendar date (`YYYY-MM-DD`) for the given IANA time zone. */
export function dateKeyInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a `YYYY-MM-DD` date string without time-zone drift. */
export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIso(shifted).slice(0, 10);
}

/** Local hour (0–23) for the given IANA time zone. `null` when unreadable. */
export function hourInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    hour: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "");
  if (!Number.isInteger(hour)) return null;
  // Some engines render midnight as "24" with hour12: false.
  return hour % 24;
}

/**
 * The offset of an IANA time zone from UTC, in milliseconds, at a given instant.
 * Reconstructed by formatting the instant in the zone and reading the parts back
 * as if they were UTC — which is how a zone-aware boundary is built without a
 * time-zone database of our own.
 */
function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  // Drop sub-second precision so the comparison is exact.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which a local calendar day begins in an IANA time zone —
 * the inclusive lower bound for "everything that happened on this plant day".
 *
 * The offset is resolved twice: once against UTC midnight and again against the
 * instant the first guess produced. That converges for every zone, including one
 * whose offset changes at midnight.
 */
export function startOfDayIso(dateKey, timeZone) {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let instant = utcMidnight - zoneOffsetMs(new Date(utcMidnight), timeZone);
  instant = utcMidnight - zoneOffsetMs(new Date(instant), timeZone);
  return toIso(new Date(instant));
}

/**
 * True when an entry does not belong to the given plant day — that is, the
 * entry has no recorded exit today. An unreadable timestamp counts as unclosed
 * rather than being quietly reported as closed, because "we cannot date it" is
 * not the same answer as "they left".
 */
export function isEntryUnclosed(occurredAt, timeZone, today) {
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) return true;
  return dateKeyInZone(parsed, timeZone) !== today;
}
