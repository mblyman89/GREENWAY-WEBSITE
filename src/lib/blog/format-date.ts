/**
 * src/lib/blog/format-date.ts
 *
 * Blog/newsletter date presentation. The owner wants the FULL month name with
 * day and year, e.g. "June 20, 2026" (not the old abbreviated "JUN 20, 2026").
 *
 * Posts store two date fields:
 *   - publishDate: an ISO date string (e.g. "2026-06-20") — the source of truth.
 *   - dateLabel:   a human label that historically held "JUN 20, 2026".
 *
 * To avoid a data migration, we format at RENDER time:
 *   1. Prefer the ISO publishDate (parse → full-month format).
 *   2. If that's missing/invalid, upgrade a legacy abbreviated label in place
 *      (expand the 3-letter month to its full name).
 *   3. Otherwise fall back to the raw label as-is.
 *
 * Parsing the ISO string manually (not `new Date(str)`) avoids timezone
 * shifting the day backward on UTC-negative servers.
 */

const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ABBR_TO_FULL: Record<string, string> = {
  JAN: "January",
  FEB: "February",
  MAR: "March",
  APR: "April",
  MAY: "May",
  JUN: "June",
  JUL: "July",
  AUG: "August",
  SEP: "September",
  SEPT: "September",
  OCT: "October",
  NOV: "November",
  DEC: "December",
};

/** Format an ISO-ish date (YYYY-MM-DD or full ISO) as "Month D, YYYY". */
function fromIso(value: string): string | null {
  // Match leading YYYY-MM-DD; ignore any time/zone suffix.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${FULL_MONTHS[month - 1]} ${day}, ${year}`;
}

/** Expand a legacy abbreviated label like "JUN 20, 2026" → "June 20, 2026". */
function expandLegacyLabel(label: string): string | null {
  const m = /^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const full = ABBR_TO_FULL[m[1].toUpperCase()];
  if (!full) return null;
  return `${full} ${Number(m[2])}, ${m[3]}`;
}

/**
 * Public formatter. Pass the post's publishDate (ISO) and/or dateLabel.
 * Returns a "Month D, YYYY" string, never throwing on bad input.
 */
export function formatBlogDate(
  publishDate?: string | null,
  dateLabel?: string | null,
): string {
  if (publishDate) {
    const iso = fromIso(publishDate);
    if (iso) return iso;
  }
  if (dateLabel) {
    const upgraded = expandLegacyLabel(dateLabel);
    if (upgraded) return upgraded;
    return dateLabel; // already friendly (e.g. "Draft post") — leave as-is
  }
  return "";
}
