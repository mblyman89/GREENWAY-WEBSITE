import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs } from "@/components/admin/ux";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  type BadgeTone,
} from "@/components/admin/ui";
import {
  CalculateOnlyBanner,
  PayrollCenterNav,
} from "@/components/admin/payroll-center/PayrollCenterNav";
import {
  PREVIEW_COLUMNS,
  effectiveRates,
  fmtColumn,
  previewCsv,
  type PreviewRow,
} from "@/lib/payroll/pay-preview-core";
import {
  loadPayPreview,
  type PayPreviewResult,
} from "@/lib/payroll/pay-preview-store";
import {
  loadPeriodChoices,
  pickDefaultPeriod,
} from "@/lib/payroll/time-card-store";
import type { PayPeriodRow } from "@/lib/payroll/timesheet-store";

/**
 * D248 slice 3 - PAY PREVIEW (owner + admin).
 *
 * Owner (verbatim excerpt): "...take the hours worked and calculate all things
 * employee payroll for me to compare with sage ... gross pay, rough fed tax,
 * all other taxes should be accurate."
 *
 * The existing pay-run engine's answer for one period as a payroll register:
 * one row per employee, one column per Sage paystub line, employer taxes, the
 * total cost, re-add checks and a CSV. Calculate and compare only - nothing
 * here books a journal, files a form or pays anyone.
 */

export const dynamic = "force-dynamic";

const STATUS: Record<PreviewRow["status"], { tone: BadgeTone; label: string }> =
  {
    blocked: { tone: "danger", label: "Not computed" },
    attention: { tone: "gold", label: "Review" },
    ready: { tone: "green", label: "Computed" },
  };

function money(c: number | null) {
  if (c === null) return "—";
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cell(kind: "hours" | "money", v: number | null) {
  if (v === null) return "—";
  return kind === "money" ? money(v) : fmtColumn("hours", v);
}

function periodOption(p: PayPeriodRow) {
  return `${p.start_date} → ${p.end_date} · paid ${p.pay_date} · ${p.status}`;
}

const EMPLOYEE_KEYS = new Set([
  "regularHours",
  "overtimeHours",
  "regularPay",
  "overtimePay",
  "gross",
  "federal",
  "socialSecurity",
  "medicare",
  "additionalMedicare",
  "pfmlEmployee",
  "waCares",
  "lniEmployee",
  "garnishments",
  "voluntary",
  "net",
]);

export default async function PayPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; emp?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();

  let periods: PayPeriodRow[] = [];
  let chosen: PayPeriodRow | null = null;
  let res: PayPreviewResult | null = null;
  let failure: string | null = null;
  if (!isSupabaseServiceConfigured)
    failure = "The database is not connected on this server.";
  else {
    try {
      periods = await loadPeriodChoices();
      chosen =
        periods.find((p) => p.id === sp.period) ??
        pickDefaultPeriod(periods, today);
      if (chosen) res = await loadPayPreview(chosen.id);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  const view = res && res.ok ? res : null;
  const refused = res && !res.ok ? res : null;
  const t = view?.totals ?? null;
  const rates = t ? effectiveRates(t) : [];
  const csvHref = view
    ? `data:text/csv;charset=utf-8,${encodeURIComponent(previewCsv(view.rows, { periodLabel: view.periodLabel, payDate: view.payDateIso }))}`
    : null;
  const focus =
    view && sp.emp
      ? (view.rows.find((r) => r.employeeId === sp.emp) ?? null)
      : null;
  const empCols = PREVIEW_COLUMNS.filter((c) => EMPLOYEE_KEYS.has(c.key));
  const erCols = PREVIEW_COLUMNS.filter((c) => !EMPLOYEE_KEYS.has(c.key));
  const base = `/admin/payroll-center/pay-preview?period=${chosen?.id ?? ""}`;

  return (
    <div>
      <AdminPageHeader
        title="Pay preview"
        subtitle="Gross, every tax and net for each employee, from the hours worked and the W-4s on file - laid out like a Sage register so you can compare line by line."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              {
                label: "Payroll command center",
                href: "/admin/payroll-center",
              },
              { label: "Pay preview" },
            ]}
          />
        }
      />
      <div
        className="space-y-6 px-5 py-6 sm:px-8"
        data-testid="pay-preview-page"
      >
        <PayrollCenterNav current="pay-preview" />
        <CalculateOnlyBanner />

        {failure ? (
          <Card>
            <CardHeader title="The pay preview could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}

        {!failure && periods.length === 0 ? (
          <Card>
            <CardHeader
              title="No pay periods yet"
              subtitle="Pay is calculated per pay period."
            />
            <p className="text-sm text-[var(--admin-text-muted)]">
              Set the pay Friday and period, then add the year&apos;s periods to
              the calendar.
            </p>
            <div className="mt-3">
              <Button href="/admin/payroll-center/schedule" variant="primary">
                Open pay schedule
              </Button>
            </div>
          </Card>
        ) : null}

        {periods.length > 0 && chosen ? (
          <form
            method="get"
            className="flex flex-wrap items-center gap-2"
            data-testid="period-picker"
          >
            <label
              htmlFor="period"
              className="text-xs font-semibold text-[var(--admin-text-muted)]"
            >
              Pay period
            </label>
            <select
              id="period"
              name="period"
              defaultValue={chosen.id}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodOption(p)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="neutral" size="sm">
              Show
            </Button>
            <Button
              href={`/admin/payroll-center/time-cards?period=${chosen.id}`}
              variant="neutral"
              size="sm"
            >
              Time cards for this period
            </Button>
          </form>
        ) : null}

        {refused ? (
          <div data-testid="pay-preview-refused">
            <Card>
              <CardHeader
                title="Pay was not calculated for this period"
                subtitle={refused.code.replace(/_/g, " ").toLowerCase()}
              />
              <p className="text-sm text-[var(--admin-danger)]">
                {refused.message}
              </p>
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                {refused.whatToDo}
              </p>
              {refused.missingRates.length > 0 ? (
                <ul
                  className="mt-3 space-y-1 text-sm"
                  data-testid="missing-rates"
                >
                  {refused.missingRates.map((m) => (
                    <li key={m.label}>
                      <span className="font-semibold">{m.label}</span> -{" "}
                      <span className="text-[var(--admin-text-muted)]">
                        {m.why}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {refused.code === "RATES_NOT_ON_FILE" ? (
                <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
                  Rates are kept in the payroll rate registry with the notice
                  each came from. The next year&apos;s rates are added there
                  once the agencies publish them (ESD for SUTA, PFML and WA
                  Cares, L&I for the hourly premium, L&I for the minimum wage).
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  href="/admin/payroll-center/time-cards"
                  variant="neutral"
                  size="sm"
                >
                  Time cards
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {view && t ? (
          <>
            <div
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              data-testid="pay-preview-kpis"
            >
              <StatCard
                label="Gross pay"
                value={money(t.gross)}
                hint={`${view.readyCount + view.attentionCount} computed · ${view.blockedCount} not computed`}
                accent="green"
              />
              <StatCard
                label="Employee taxes withheld"
                value={money(
                  sumKeys(t, [
                    "federal",
                    "socialSecurity",
                    "medicare",
                    "additionalMedicare",
                    "pfmlEmployee",
                    "waCares",
                    "lniEmployee",
                  ]),
                )}
                hint={`Federal income tax ${money(t.federal)}`}
                accent="gold"
              />
              <StatCard
                label="Net pay"
                value={money(t.net)}
                hint={`Pay date ${view.payDateIso}`}
                accent="green"
              />
              <StatCard
                label="Total labor cost"
                value={money(t.totalCost)}
                hint={`Employer taxes ${money(t.employerTaxes)}`}
                accent="muted"
              />
            </div>

            {view.blockedCount > 0 ? (
              <div data-testid="pay-preview-blocked">
                <Card>
                  <CardHeader
                    title={`${view.blockedCount} employee${view.blockedCount === 1 ? "" : "s"} not computed`}
                    subtitle="Not in the totals. The engine's reason, word for word, and the fix."
                  />
                  <ul className="space-y-2 text-sm">
                    {view.rows
                      .filter((r) => r.status === "blocked")
                      .map((r) => (
                        <li key={r.employeeId}>
                          <span className="font-semibold">{r.name}</span>
                          {r.problems.map((p, i) => (
                            <p
                              key={i}
                              className="text-[var(--admin-text-muted)]"
                            >
                              {p}
                            </p>
                          ))}
                        </li>
                      ))}
                  </ul>
                </Card>
              </div>
            ) : null}

            {view.warnings.length > 0 ||
            view.unreadableW4Names.length > 0 ||
            view.defaultW4Names.length > 0 ? (
              <Card>
                <CardHeader title="Read before comparing" />
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-text-muted)]">
                  {view.unreadableW4Names.length > 0 ? (
                    <li className="text-[var(--admin-danger)]">
                      W-4 on file could not be read for:{" "}
                      {view.unreadableW4Names.join(", ")}.
                    </li>
                  ) : null}
                  {view.defaultW4Names.length > 0 ? (
                    <li>
                      Federal tax uses the IRS default (no signed W-4) for:{" "}
                      {view.defaultW4Names.join(", ")}. Sage will differ if it
                      has a W-4 for them.
                    </li>
                  ) : null}
                  {view.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Register - employee side"
                subtitle={`${view.periodLabel} · ${view.periodStartDate} → ${view.periodEndDate} · pay date ${view.payDateIso} · period ${view.periodStatus}`}
                action={
                  csvHref ? (
                    <a
                      href={csvHref}
                      download={`payroll-preview-${view.payDateIso}.csv`}
                      className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-1.5 text-xs font-semibold"
                      data-testid="pay-preview-csv"
                    >
                      Download CSV
                    </a>
                  ) : null
                }
              />
              <RegisterTable
                rows={view.rows}
                cols={empCols}
                totals={t}
                base={base}
                extras
              />
            </Card>

            <Card>
              <CardHeader
                title="Register - employer side"
                subtitle="What the business pays on top of gross. Not taken from the paycheck."
              />
              <RegisterTable
                rows={view.rows}
                cols={erCols}
                totals={t}
                base={base}
              />
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Effective rates"
                  subtitle="Share of total gross. A quick 'does this look right' against Sage."
                />
                <ul className="space-y-2 text-sm" data-testid="effective-rates">
                  {rates.map((x) => (
                    <li key={x.label} className="flex items-center gap-3">
                      <span className="w-44 shrink-0">{x.label}</span>
                      <span className="h-2 flex-1 rounded bg-[var(--admin-surface-2)]">
                        <span
                          className="block h-2 rounded bg-[var(--admin-accent)]"
                          style={{
                            width: `${Math.min(100, Math.max(0, x.pct ?? 0))}%`,
                          }}
                        />
                      </span>
                      <span className="w-16 text-right tabular-nums">
                        {x.pct === null ? "—" : `${x.pct.toFixed(2)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader
                  title="Beside gross - not in it"
                  subtitle="Shown for comparison. Adding them would change every tax, and the engine has not taxed them."
                />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-[var(--admin-text-muted)]">
                    Sick hours taken
                  </dt>
                  <dd className="text-right tabular-nums">
                    {fmtColumn("hours", t.sickHundredthHours)}
                  </dd>
                  <dt className="text-[var(--admin-text-muted)]">
                    Sick pay estimate (regular rate)
                  </dt>
                  <dd className="text-right tabular-nums">
                    {money(t.sickPayEstimateCents)}
                  </dd>
                  <dt className="text-[var(--admin-text-muted)]">
                    Tips counted at drawer close
                  </dt>
                  <dd className="text-right tabular-nums">
                    {money(t.tipsCents)}
                  </dd>
                </dl>
              </Card>
            </div>

            {focus ? <EmployeeStub row={focus} base={base} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function sumKeys(t: Record<string, number | null>, keys: string[]): number {
  return keys.reduce((s, k) => s + (t[k] ?? 0), 0);
}

type Col = (typeof PREVIEW_COLUMNS)[number];

function RegisterTable({
  rows,
  cols,
  totals,
  base,
  extras,
}: {
  rows: readonly PreviewRow[];
  cols: readonly Col[];
  totals: Record<string, number | null>;
  base: string;
  extras?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[900px] text-xs"
        data-testid="pay-preview-register"
      >
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-text-muted)]">
            <th className="py-2 pr-3">Employee</th>
            <th className="py-2 pr-3">Status</th>
            {cols.map((c) => (
              <th key={c.key} className="py-2 pr-3 text-right">
                {c.label}
              </th>
            ))}
            {extras ? <th className="py-2 pr-3 text-right">Check</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.employeeId}
              className="border-b border-[var(--admin-border)] align-top"
            >
              <td className="py-2 pr-3">
                <a
                  href={`${base}&emp=${r.employeeId}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {r.name}
                </a>
              </td>
              <td className="py-2 pr-3">
                <Badge tone={STATUS[r.status].tone}>
                  {STATUS[r.status].label}
                </Badge>
              </td>
              {cols.map((c) => (
                <td key={c.key} className="py-2 pr-3 text-right tabular-nums">
                  {cell(c.kind, r.amounts[c.key])}
                </td>
              ))}
              {extras ? (
                <td className="py-2 pr-3 text-right">
                  {r.status === "blocked" ? (
                    "—"
                  ) : r.reAdds ? (
                    <Badge tone="green">Adds up</Badge>
                  ) : (
                    <Badge tone="danger">Does not add</Badge>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2 pr-3">Total</td>
            <td className="py-2 pr-3 text-[var(--admin-text-muted)]">
              computed rows
            </td>
            {cols.map((c) => (
              <td key={c.key} className="py-2 pr-3 text-right tabular-nums">
                {cell(c.kind, totals[c.key] ?? null)}
              </td>
            ))}
            {extras ? <td /> : null}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function EmployeeStub({ row, base }: { row: PreviewRow; base: string }) {
  return (
    <div data-testid="pay-preview-stub">
      <Card>
        <CardHeader
          title={`Paystub view - ${row.name}`}
          subtitle="One employee, every line, top to bottom. Compare to the same person's Sage stub."
          action={
            <Button href={base} variant="neutral" size="sm">
              Close
            </Button>
          }
        />
        <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {PREVIEW_COLUMNS.map((c) => (
            <div key={c.key} className="contents">
              <dt className="text-[var(--admin-text-muted)]">{c.label}</dt>
              <dd className="text-right tabular-nums">
                {cell(c.kind, row.amounts[c.key])}
              </dd>
            </div>
          ))}
          <dt className="text-[var(--admin-text-muted)]">
            Sick hours (not in gross)
          </dt>
          <dd className="text-right tabular-nums">
            {fmtColumn("hours", row.sickHundredthHours)}
          </dd>
          <dt className="text-[var(--admin-text-muted)]">
            Sick pay estimate (not in gross)
          </dt>
          <dd className="text-right tabular-nums">
            {money(row.sickPayEstimateCents)}
          </dd>
          <dt className="text-[var(--admin-text-muted)]">
            Tips (not in gross)
          </dt>
          <dd className="text-right tabular-nums">{money(row.tipsCents)}</dd>
        </dl>
        {row.notes.length > 0 || row.problems.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--admin-text-muted)]">
            {[...row.problems, ...row.notes].map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
