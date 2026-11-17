import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card, CardHeader, type BadgeTone } from "@/components/admin/ui";
import { CalculateOnlyBanner, PayrollCenterNav } from "@/components/admin/payroll-center/PayrollCenterNav";
import { pasteSageCsvAction, saveSageEmployeeAction } from "@/app/admin/payroll-center/actions";
import { PREVIEW_COLUMNS, fmtColumn } from "@/lib/payroll/pay-preview-core";
import { loadPayPreview, type PayPreviewResult } from "@/lib/payroll/pay-preview-store";
import { TOLERANCE, compareRow, summarize, type CellVerdict, type CompareRow } from "@/lib/payroll/sage-compare-core";
import { loadSageEntries, type SageLoad } from "@/lib/payroll/sage-compare-store";
import { loadPeriodChoices, pickDefaultPeriod } from "@/lib/payroll/time-card-store";
import type { PayPeriodRow } from "@/lib/payroll/timesheet-store";

/**
 * D248 slice 4 - COMPARE WITH SAGE (owner + admin).
 *
 * Owner (verbatim excerpt): "...test it to see if it can generate the proper
 * gross amount, and roughly the right amounts for the majority of the taxes
 * ... for me to compare with sage."
 *
 * Type (or paste) Sage's numbers per employee per paystub line; each cell
 * shows ours, Sage's, the difference and a verdict against a stated
 * tolerance. Comparison only - nothing is booked, filed or paid.
 */

export const dynamic = "force-dynamic";

const VERDICT: Record<CellVerdict | CompareRow["verdict"], { tone: BadgeTone; label: string }> = {
  match: { tone: "green", label: "Match" },
  within: { tone: "gold", label: "Within tolerance" },
  off: { tone: "danger", label: "Off" },
  not_entered: { tone: "neutral", label: "Not entered" },
  not_computed: { tone: "outline", label: "Not computed" },
};

function money(c: number | null) {
  if (c === null) return "—";
  const s = `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return c < 0 ? `-${s}` : s;
}
const cell = (kind: "hours" | "money", v: number | null) => (v === null ? "—" : kind === "money" ? money(v) : fmtColumn("hours", v));
const signed = (kind: "hours" | "money", v: number | null) => (v === null ? "" : `${v > 0 ? "+" : ""}${kind === "money" ? money(v) : fmtColumn("hours", v)}`);
const KIND = new Map(PREVIEW_COLUMNS.map((c) => [c.key, c.kind] as const));

function periodOption(p: PayPeriodRow) {
  return `${p.start_date} → ${p.end_date} · paid ${p.pay_date} · ${p.status}`;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; emp?: string; msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();

  let periods: PayPeriodRow[] = [];
  let chosen: PayPeriodRow | null = null;
  let res: PayPreviewResult | null = null;
  let sage: SageLoad | null = null;
  let failure: string | null = null;
  if (!isSupabaseServiceConfigured) failure = "The database is not connected on this server.";
  else {
    try {
      periods = await loadPeriodChoices();
      chosen = periods.find((p) => p.id === sp.period) ?? pickDefaultPeriod(periods, today);
      if (chosen) [res, sage] = await Promise.all([loadPayPreview(chosen.id), loadSageEntries(chosen.id)]);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  const view = res && res.ok ? res : null;
  const refused = res && !res.ok ? res : null;
  const entries = sage && sage.ok ? sage.doc.entries : {};
  const rows = view ? view.rows.map((r) => compareRow(r, entries[r.employeeId])) : [];
  const summary = summarize(rows);
  const focusId = sp.emp ?? view?.rows[0]?.employeeId ?? null;
  const focusPreview = view?.rows.find((r) => r.employeeId === focusId) ?? null;
  const focusCompare = rows.find((r) => r.employeeId === focusId) ?? null;
  const base = `/admin/payroll-center/compare?period=${chosen?.id ?? ""}`;
  const canSave = !!(sage && sage.ok);

  return (
    <div>
      <AdminPageHeader
        title="Compare with Sage"
        subtitle="Type or paste what Sage produced and see, line by line, where the calculated pay matches, is within rounding, or is off."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Payroll command center", href: "/admin/payroll-center" }, { label: "Compare with Sage" }]} />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="sage-compare-page">
        <PayrollCenterNav current="compare" />
        <CalculateOnlyBanner />

        {sp.msg ? <p className="rounded-[var(--admin-radius)] bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">{sp.msg}</p> : null}
        {sp.error ? <p className="rounded-[var(--admin-radius)] bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">{sp.error}</p> : null}
        {failure ? (
          <Card>
            <CardHeader title="The comparison could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}
        {sage && !sage.ok ? (
          <div data-testid="sage-store-problem">
            <Card>
              <CardHeader title={sage.missingTable ? "One database step first" : "Sage amounts could not be read"} />
              <p className="text-sm text-[var(--admin-text-muted)]">{sage.message}</p>
            </Card>
          </div>
        ) : null}
        {sage && sage.ok && sage.dropped > 0 ? (
          <p className="text-sm text-[var(--admin-gold)]">{sage.dropped} stored value(s) were not readable and are ignored. Re-enter them if needed.</p>
        ) : null}

        {!failure && periods.length === 0 ? (
          <Card>
            <CardHeader title="No pay periods yet" subtitle="Comparisons are per pay period." />
            <Button href="/admin/payroll-center/schedule" variant="primary">
              Open pay schedule
            </Button>
          </Card>
        ) : null}

        {periods.length > 0 && chosen ? (
          <form method="get" className="flex flex-wrap items-center gap-2" data-testid="period-picker">
            <label htmlFor="period" className="text-xs font-semibold text-[var(--admin-text-muted)]">
              Pay period
            </label>
            <select id="period" name="period" defaultValue={chosen.id} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodOption(p)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="neutral" size="sm">
              Show
            </Button>
            <Button href={`/admin/payroll-center/pay-preview?period=${chosen.id}`} variant="neutral" size="sm">
              Pay preview for this period
            </Button>
          </form>
        ) : null}

        {refused ? (
          <Card>
            <CardHeader title="Pay was not calculated for this period, so there is nothing to compare yet" />
            <p className="text-sm text-[var(--admin-danger)]">{refused.message}</p>
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">{refused.whatToDo}</p>
          </Card>
        ) : null}

        {view ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="sage-compare-kpis">
              <StatCard label="Employees compared" value={`${summary.employeesEntered} of ${rows.length}`} hint={`${summary.cellsEntered} lines entered`} accent="muted" />
              <StatCard label="Match" value={String(summary.matched)} hint="To the cent" accent="green" />
              <StatCard label="Within tolerance" value={String(summary.within)} hint="Rounding, or federal method" accent="gold" />
              <StatCard label="Off" value={String(summary.off)} hint="Outside the stated tolerance" accent={summary.off > 0 ? "orange" : "muted"} />
            </div>

            <Card>
              <CardHeader title="By employee" subtitle="Pick a name to enter or review that person's Sage stub." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm" data-testid="sage-compare-employees">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-xs text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Employee</th>
                      <th className="py-2 pr-3">Verdict</th>
                      <th className="py-2 pr-3 text-right">Gross (ours / Sage)</th>
                      <th className="py-2 pr-3 text-right">Federal (ours / Sage)</th>
                      <th className="py-2 pr-3 text-right">Net (ours / Sage)</th>
                      <th className="py-2 pr-3 text-right">Lines off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const g = r.cells.find((c) => c.key === "gross")!;
                      const f = r.cells.find((c) => c.key === "federal")!;
                      const n = r.cells.find((c) => c.key === "net")!;
                      return (
                        <tr key={r.employeeId} className={`border-b border-[var(--admin-border)] ${r.employeeId === focusId ? "bg-[var(--admin-surface-2)]" : ""}`}>
                          <td className="py-2 pr-3">
                            <a href={`${base}&emp=${r.employeeId}`} className="font-semibold underline-offset-2 hover:underline">
                              {r.name}
                            </a>
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {money(g.ours)} / {money(g.sage)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {money(f.ours)} / {money(f.sage)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {money(n.ours)} / {money(n.sage)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{r.off}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {focusPreview && focusCompare ? (
              <div data-testid="sage-compare-stub">
                <Card>
                  <CardHeader
                    title={`${focusCompare.name} - ours vs Sage`}
                    subtitle={focusPreview.status === "blocked" ? "Not computed by the engine - see the pay preview for the reason. You can still record Sage's figures." : "Type Sage's figure on each line. Blank = not entered. Hours as decimals (e.g. 38.25)."}
                  />
                  <form action={saveSageEmployeeAction}>
                    <input type="hidden" name="period_id" value={chosen?.id ?? ""} />
                    <input type="hidden" name="employee_id" value={focusCompare.employeeId} />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead>
                          <tr className="border-b border-[var(--admin-border)] text-left text-xs text-[var(--admin-text-muted)]">
                            <th className="py-2 pr-3">Line</th>
                            <th className="py-2 pr-3 text-right">Ours</th>
                            <th className="py-2 pr-3">Sage</th>
                            <th className="py-2 pr-3 text-right">Difference</th>
                            <th className="py-2 pr-3">Verdict</th>
                            <th className="py-2 pr-3">Tolerance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {focusCompare.cells.map((c) => {
                            const col = PREVIEW_COLUMNS.find((x) => x.key === c.key)!;
                            const tol = TOLERANCE[c.key];
                            return (
                              <tr key={c.key} className="border-b border-[var(--admin-border)]">
                                <td className="py-1.5 pr-3">{col.label}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{cell(col.kind, c.ours)}</td>
                                <td className="py-1.5 pr-3">
                                  <input
                                    name={`sage_${c.key}`}
                                    defaultValue={c.sage === null ? "" : (c.sage / 100).toFixed(2)}
                                    inputMode="decimal"
                                    aria-label={`Sage ${col.label}`}
                                    disabled={!canSave}
                                    className="w-28 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-right tabular-nums"
                                  />
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{signed(col.kind, c.diff)}</td>
                                <td className="py-1.5 pr-3">
                                  <Badge tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].label}</Badge>
                                </td>
                                <td className="py-1.5 pr-3 text-xs text-[var(--admin-text-muted)]" title={tol.why}>
                                  ±{cell(col.kind, tol.abs)} · {tol.why}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button type="submit" variant="save" disabled={!canSave}>
                        Save Sage amounts for {focusCompare.name}
                      </Button>
                      <span className="text-xs text-[var(--admin-text-muted)]">Saved for comparison only. Never booked, filed or paid.</span>
                    </div>
                  </form>
                </Card>
              </div>
            ) : null}

            <Card>
              <CardHeader title="Where the differences are" subtitle="Per paystub line, across everyone entered. Difference = ours minus Sage." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm" data-testid="sage-compare-columns">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-xs text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Line</th>
                      <th className="py-2 pr-3 text-right">Entered</th>
                      <th className="py-2 pr-3 text-right">Off</th>
                      <th className="py-2 pr-3 text-right">Total difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byColumn
                      .filter((c) => c.entered > 0)
                      .map((c) => (
                        <tr key={c.key} className="border-b border-[var(--admin-border)]">
                          <td className="py-1.5 pr-3">{c.label}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{c.entered}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{c.off > 0 ? <Badge tone="danger">{c.off}</Badge> : "0"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{signed(KIND.get(c.key) ?? "money", c.totalDiff) || "0.00"}</td>
                        </tr>
                      ))}
                    {summary.cellsEntered === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 text-[var(--admin-text-muted)]">
                          Nothing entered yet. Pick an employee above, or paste a CSV below.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Paste from a spreadsheet"
                subtitle={'Download the CSV on the Pay preview, type Sage\'s numbers over ours, and paste it here. A header row starting "Employee" with any paystub line names. Names must match exactly.'}
              />
              <form action={pasteSageCsvAction} className="space-y-3">
                <input type="hidden" name="period_id" value={chosen?.id ?? ""} />
                <textarea
                  name="csv"
                  rows={6}
                  aria-label="CSV of Sage amounts"
                  disabled={!canSave}
                  placeholder={"Employee,Gross,Federal income tax,Social Security,Medicare,Net pay\nJane Doe,1234.56,98.00,76.54,17.90,1001.23"}
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 font-mono text-xs"
                />
                <Button type="submit" variant="save" disabled={!canSave}>
                  Save pasted Sage amounts
                </Button>
              </form>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
