"use client";
/**
 * src/components/admin/payroll/PayDateDeadlineField.tsx   (R41 S5)
 *
 * The pay-date input on "Start a payroll run", with the Timberland deadline
 * shown as you pick the date (plan S5: "Upload and approve at Timberland by
 * Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)").
 *
 * There is NO default date (the plan: "no longer today"). The line is a
 * guide only: the server checks the deadline again with its own clock when
 * the ACH file is released (generatePayrollNacha -> releaseLoop), and that
 * check cannot be overridden.
 *
 * The first render uses the server's clock (nowIso) so the server HTML and
 * the browser agree; after that it uses the browser clock, ticking every
 * 15 seconds so a page left open past 4:00 pm turns red on its own.
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/admin/ui";
import { payrollDeadlineFor } from "@/lib/payments/timberland-deadline-core";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Exported for the vitest: the line shown for a typed pay date at a moment. */
export function payDateLine(raw: string, now: Date): { tone: "info" | "bad"; text: string } | null {
  if (!ISO.test(raw)) return null;
  try {
    const d = payrollDeadlineFor(raw, now);
    return { tone: d.check.ok ? "info" : "bad", text: d.line };
  } catch (e) {
    return { tone: "bad", text: `This date cannot be checked against the bank calendar: ${(e as Error).message}` };
  }
}

export function PayDateDeadlineField({ nowIso }: { nowIso: string }) {
  const [value, setValue] = useState("");
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    // The first render uses the server clock (seconds old); the browser clock takes over within 15 s.
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const line = payDateLine(value, now);
  return (
    <div className="flex flex-col gap-1">
      <Input type="date" name="pay_date" required value={value} onChange={(e) => setValue(e.target.value)} />
      {line ? (
        <span
          data-testid="pay-date-deadline"
          className={`max-w-md text-xs ${line.tone === "bad" ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}
        >
          {line.text}
        </span>
      ) : (
        <span className="max-w-md text-xs text-[var(--admin-text-muted)]">Pick the payday. We show the Timberland upload deadline here.</span>
      )}
    </div>
  );
}
