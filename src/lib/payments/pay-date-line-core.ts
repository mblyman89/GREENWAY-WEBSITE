/**
 * The Timberland deadline line for a payday, in a PLAIN module (no "use client").
 * Used by the PayDateDeadlineField (browser) and the payroll run page (server).
 * It used to live only in the "use client" field file; the server run page
 * calling it there threw "Cannot access ... on the server".
 */
import { payrollDeadlineFor } from "./timberland-deadline-core";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The line shown for a pay date at a moment (form field and run page). */
export function payDateLine(raw: string, now: Date): { tone: "info" | "bad"; text: string } | null {
  if (!ISO.test(raw)) return null;
  try {
    const d = payrollDeadlineFor(raw, now);
    return { tone: d.check.ok ? "info" : "bad", text: d.line };
  } catch (e) {
    return { tone: "bad", text: `This date cannot be checked against the bank calendar: ${(e as Error).message}` };
  }
}

