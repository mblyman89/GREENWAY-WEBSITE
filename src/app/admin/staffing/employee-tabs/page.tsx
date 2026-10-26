/**
 * Employee → Employee tabs (Register S5): pay-later product loans.
 *
 * Owner request (verbatim, todo.md): "keep track of these unpaid for products
 * and then deduct it from their pay if over n number of days old, a setting
 * in the admin somewhere for owners and admin to set." Owner/admin only
 * (settings.manage, same as Payroll).
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { pacificDayKey, pacificToday } from "@/lib/reports/timezone";
import {
  LOAN_STATUS_LABELS,
  isDueForDeduction,
  summarizeLoans,
  type LoanRow,
} from "@/lib/pos/employee-loan-core";
import { employeeNames, getLoanDeductDays, listEmployeeLoans } from "@/lib/pos/employee-loan-store";
import { saveLoanPolicyAction, settleLoanAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EmployeeTabsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const [sp, days, list] = await Promise.all([searchParams, getLoanDeductDays(), listEmployeeLoans()]);
  const today = pacificToday();
  const rows: (LoanRow & { raw: (typeof list.rows)[number] })[] = list.rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    amountMinor: r.amount_minor,
    status: r.status,
    takenDay: pacificDayKey(r.taken_at),
    raw: r,
  }));
  const summary = summarizeLoans(rows, today, days);
  const names = await employeeNames([...rows.map((r) => r.employeeId), ...rows.map((r) => r.raw.witness_id ?? "")]);
  const totalOpen = summary.reduce((a, s) => a + s.openMinor, 0);
  const totalDue = summary.reduce((a, s) => a + s.dueMinor, 0);
  const open = rows.filter((r) => r.status === "open");
  const settled = rows.filter((r) => r.status !== "open").slice(0, 100);
  const td = "px-3 py-2 text-sm";

  return (
    <div>
      <AdminPageHeader
        title="Employee tabs"
        subtitle="Pay-later employee purchases (product loans). Open tabs older than the set number of days are due to be deducted from pay."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.msg ? <p className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p className="rounded border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">{sp.error}</p> : null}
        {list.migrationMissing ? (
          <p className="rounded border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-300">
            Migration 0302 (employee_product_loans) is not applied yet. Pay-later sales are refused at sync until it is.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Open tabs" value={String(open.length)} />
          <StatCard label="Open balance" value={formatMinorCurrency(totalOpen)} />
          <StatCard label={`Due for deduction (> ${days} days)`} value={formatMinorCurrency(totalDue)} />
        </div>

        <form action={saveLoanPolicyAction} className="flex flex-wrap items-end gap-3 rounded border border-[var(--admin-border)] p-4">
          <Field label="Deduct unpaid tabs from pay after (days)">
            <Input name="days" defaultValue={String(days)} inputMode="numeric" className="w-28" />
          </Field>
          <Button type="submit">Save</Button>
          <p className="text-xs text-[var(--admin-text-muted)]">
            Each employee ticks a written pay-deduction acknowledgement at the register before a tab opens.
          </p>
        </form>

        <section>
          <h2 className="mb-2 text-base font-semibold">By employee</h2>
          <table className="w-full text-left">
            <thead className="text-xs text-[var(--admin-text-muted)]">
              <tr><th className={td}>Employee</th><th className={td}>Open</th><th className={td}>Open balance</th><th className={td}>Due now</th></tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr><td className={td} colSpan={4}>No open tabs.</td></tr>
              ) : (
                summary.map((s) => (
                  <tr key={s.employeeId} className="border-t border-[var(--admin-border)]">
                    <td className={td}>{names[s.employeeId] ?? "Employee"}</td>
                    <td className={td}>{s.openCount}</td>
                    <td className={td}>{formatMinorCurrency(s.openMinor)}</td>
                    <td className={`${td} font-bold ${s.dueMinor > 0 ? "text-amber-300" : ""}`}>{formatMinorCurrency(s.dueMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Open tabs</h2>
          <table className="w-full text-left">
            <thead className="text-xs text-[var(--admin-text-muted)]">
              <tr><th className={td}>Taken</th><th className={td}>Employee</th><th className={td}>Witness</th><th className={td}>Amount</th><th className={td}>Age</th><th className={td}>Settle</th></tr>
            </thead>
            <tbody>
              {open.map((r) => {
                const due = isDueForDeduction(r, today, days);
                return (
                  <tr key={r.id} className="border-t border-[var(--admin-border)]">
                    <td className={td}>{r.takenDay}</td>
                    <td className={td}>{names[r.employeeId] ?? "Employee"}</td>
                    <td className={td}>{r.raw.witness_id ? names[r.raw.witness_id] ?? "—" : "—"}</td>
                    <td className={td}>{formatMinorCurrency(r.amountMinor)}</td>
                    <td className={`${td} ${due ? "font-bold text-amber-300" : ""}`}>{due ? "DEDUCT" : "open"}</td>
                    <td className={td}>
                      <form action={settleLoanAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="note" placeholder="Note (required to forgive)" className="w-44 rounded border border-[var(--admin-border)] bg-transparent px-2 py-1 text-xs" />
                        <Button type="submit" name="to" value="paid" size="sm">Paid cash</Button>
                        <Button type="submit" name="to" value="deducted" size="sm">Deducted</Button>
                        <Button type="submit" name="to" value="forgiven" size="sm" variant="neutral">Forgive</Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {settled.length ? (
          <section>
            <h2 className="mb-2 text-base font-semibold">Recently settled</h2>
            <table className="w-full text-left">
              <tbody>
                {settled.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--admin-border)]">
                    <td className={td}>{r.takenDay}</td>
                    <td className={td}>{names[r.employeeId] ?? "Employee"}</td>
                    <td className={td}>{formatMinorCurrency(r.amountMinor)}</td>
                    <td className={td}>{LOAN_STATUS_LABELS[r.status]}</td>
                    <td className={td}>{r.raw.settle_note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
}
