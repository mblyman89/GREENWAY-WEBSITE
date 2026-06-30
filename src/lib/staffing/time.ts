/**
 * src/lib/staffing/time.ts
 *
 * PURE time-clock helpers (no server-only imports → unit-testable with tsx).
 */
import { pacificDayKey } from "@/lib/reports/timezone";

/** Whole minutes between two ISO timestamps (clamped at 0). */
export function punchMinutes(clockInISO: string, clockOutISO: string): number {
  const inMs = Date.parse(clockInISO);
  const outMs = Date.parse(clockOutISO);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return 0;
  return Math.max(0, Math.round((outMs - inMs) / 60000));
}

/** The Pacific business day (YYYY-MM-DD) for an ISO timestamp. */
export function businessDayFor(iso: string): string {
  return pacificDayKey(iso);
}

/** Format minutes as "Hh Mm" (e.g. 425 -> "7h 5m"). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Sum worked minutes from a list of closed work punches (ignores breaks). */
export function totalWorkedMinutes(
  punches: { punch_kind: string; minutes: number | null }[],
): number {
  return punches
    .filter((p) => p.punch_kind === "work" && typeof p.minutes === "number")
    .reduce((sum, p) => sum + (p.minutes ?? 0), 0);
}

/** Validate a clock PIN: 4-6 digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin.trim());
}
