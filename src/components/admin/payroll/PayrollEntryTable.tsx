"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import { dollarsToCents, centsToDollars } from "@/lib/payroll/payroll-core";

const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]";

export type EmployeeRow = {
  id: string;
  name: string;
  net: string; // dollar strings (prefilled from saved line)
  gross: string;
  taxes: string;
  deductions: string;
  routing: string;
  account: string;
  accountType: "checking" | "savings";
};

export function PayrollEntryTable({
  runId,
  employees,
  saveAction,
  readOnly,
}: {
  runId: string;
  employees: EmployeeRow[];
  saveAction: (runId: string, formData: FormData) => void;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<EmployeeRow[]>(employees);

  const totals = useMemo(() => {
    let net = 0;
    let gross = 0;
    let taxes = 0;
    let deductions = 0;
    let count = 0;
    for (const r of rows) {
      const n = dollarsToCents(r.net);
      if (n == null) continue;
      count += 1;
      net += n;
      gross += dollarsToCents(r.gross) ?? 0;
      taxes += dollarsToCents(r.taxes) ?? 0;
      deductions += dollarsToCents(r.deductions) ?? 0;
    }
    return { net, gross, taxes, deductions, count };
  }, [rows]);

  const update = (id: string, field: keyof EmployeeRow, value: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const reconcileDelta = (r: EmployeeRow): number | null => {
    const g = dollarsToCents(r.gross);
    const t = dollarsToCents(r.taxes);
    const d = dollarsToCents(r.deductions);
    const n = dollarsToCents(r.net);
    if (g == null || t == null || d == null || n == null) return null;
    return g - t - d - n;
  };

  return (
    <form action={saveAction.bind(null, runId)} className="space-y-4">
      <input type="hidden" name="emp_ids" value={rows.map((r) => r.id).join(",")} />

      <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
            <tr>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Net pay *</th>
              <th className="px-3 py-2">Gross</th>
              <th className="px-3 py-2">Taxes</th>
              <th className="px-3 py-2">Deductions</th>
              <th className="px-3 py-2">Routing</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.map((r) => {
              const delta = reconcileDelta(r);
              const bad = delta != null && delta !== 0;
              return (
                <tr key={r.id} className="bg-[var(--admin-surface)]">
                  <td className="px-3 py-2 font-medium text-[var(--admin-text)]">
                    {r.name}
                    <input type="hidden" name={`name_${r.id}`} value={r.name} />
                    {bad ? (
                      <div className="text-[10px] font-normal text-[var(--admin-danger)]">
                        Off by ${centsToDollars(Math.abs(delta!))}
                      </div>
                    ) : delta === 0 ? (
                      <div className="text-[10px] font-normal text-[var(--admin-accent)]">✓ reconciles</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`net_${r.id}`} value={r.net} inputMode="decimal" placeholder="0.00" readOnly={readOnly} onChange={(e) => update(r.id, "net", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`gross_${r.id}`} value={r.gross} inputMode="decimal" placeholder="0.00" readOnly={readOnly} onChange={(e) => update(r.id, "gross", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`taxes_${r.id}`} value={r.taxes} inputMode="decimal" placeholder="0.00" readOnly={readOnly} onChange={(e) => update(r.id, "taxes", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`deductions_${r.id}`} value={r.deductions} inputMode="decimal" placeholder="0.00" readOnly={readOnly} onChange={(e) => update(r.id, "deductions", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`routing_${r.id}`} value={r.routing} inputMode="numeric" placeholder="9 digits" readOnly={readOnly} onChange={(e) => update(r.id, "routing", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} name={`account_${r.id}`} value={r.account} placeholder="Account #" readOnly={readOnly} onChange={(e) => update(r.id, "account", e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputCls} name={`acct_type_${r.id}`} value={r.accountType} disabled={readOnly} onChange={(e) => update(r.id, "accountType", e.target.value)}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-[var(--admin-surface-2)] text-xs font-semibold text-[var(--admin-text-muted)]">
            <tr>
              <td className="px-3 py-2">Totals ({totals.count} paid)</td>
              <td className="px-3 py-2">${centsToDollars(totals.net)}</td>
              <td className="px-3 py-2">${centsToDollars(totals.gross)}</td>
              <td className="px-3 py-2">${centsToDollars(totals.taxes)}</td>
              <td className="px-3 py-2">${centsToDollars(totals.deductions)}</td>
              <td className="px-3 py-2" colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {!readOnly ? (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="save" size="sm">💾 Save entries</Button>
          <span className="text-xs text-[var(--admin-text-faint)]">
            Leave an employee&apos;s net pay blank to skip them this run.
          </span>
        </div>
      ) : null}
    </form>
  );
}
