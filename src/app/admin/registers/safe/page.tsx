import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge, Select, Input } from "@/components/admin/ui";
import { CountGrid } from "@/components/admin/registers/CountGrid";
import { formatCents } from "@/lib/registers/cash";
import { SAFE_TARGET_MINOR } from "@/lib/registers/safe-core";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { listLittleSafeExchangesRange, listSafeCountsRange, listSwapsRange, safeStatus } from "@/lib/registers/safe-store";
import { LittleSafeExchangeForm } from "@/components/admin/registers/LittleSafeExchangeForm";
import { sheetExchangeFromRow, swapBillWords } from "@/lib/registers/little-safe-core";
import { listEmployees } from "@/lib/staffing/store";
import { backHref } from "@/lib/admin/back-link-core";
import { pacificToday } from "@/lib/reports/timezone";
import { listOpenSupplyRuns } from "@/lib/registers/supply-run-store";
import { openRunsNotice } from "@/lib/registers/supply-run-core";
import { SaveButton } from "@/components/admin/orders/SaveButton";
import {
  MASTER_TILL_STANDARD,
  defaultCountWindow,
  mixCheck,
  mixRows,
  parseDayRange,
  sheetCountFromRow,
} from "@/lib/registers/master-till-core";
import { recordLittleSafeExchangeAction, recordSafeCountAction } from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function varianceLabel(minor: number): string {
  if (minor === 0) return "Balanced";
  return minor > 0 ? `Over ${formatCents(minor)}` : `Short ${formatCents(Math.abs(minor))}`;
}

const WINDOW_LABEL: Record<string, string> = { am: "AM", pm: "PM", other: "Extra" };

/** D11 in words, from the one constant (rule 25): "32 × $10, 64 × $5, …". */
const STANDARD_WORDS = mixRows(MASTER_TILL_STANDARD)
  .filter((r) => r.standard > 0)
  .map((r) => `${r.standard} × ${r.label}`)
  .join(", ");

/**
 * Fix Phase 2.7a (G-09 requirement 3, F-02-13): the history date range. A bad
 * date is shown as an error, never replaced (master-till-core#parseDayRange).
 */
function RangePicker({ from, to }: { from: string; to: string }) {
  return (
    <form method="get" action="/admin/registers/safe" className="flex flex-wrap items-end gap-2">
      <label className="block text-xs text-[var(--admin-text-muted)]">
        From
        <Input type="date" name="from" defaultValue={from} required />
      </label>
      <label className="block text-xs text-[var(--admin-text-muted)]">
        To
        <Input type="date" name="to" defaultValue={to} required />
      </label>
      <Button type="submit" variant="neutral" size="sm">
        Show
      </Button>
    </form>
  );
}

export default async function SafePage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; error?: string; counted?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  // Fix Phase 2.7a (G-13, owner D15: "anyone can count and record the master
  // count"): every back-office login opens the page and records a count with
  // the counter's own PIN. History, the printable sheet and the export stay
  // manager-level (inventory.manage), per G-13 requirement 1(a).
  const session = await requirePermission("orders.manage");
  const canManage = can(session.profile.role, "inventory.manage");
  const today = pacificToday();
  const range = parseDayRange(sp.from, sp.to, today);

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Safe" }]} />
        <AdminPageHeader title="Store safe" subtitle="The $1,000 change fund behind the registers." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to manage the safe." />
      </div>
    );
  }

  const empty = { ready: true, counts: [], swaps: [], error: null };
  const [status, countsRes, swapsRes, exchangesRes, allEmployees, openRunsRes] = await Promise.all([
    safeStatus(),
    canManage && range.ok ? listSafeCountsRange(range.from, range.to) : Promise.resolve({ ...empty, counts: [] }),
    canManage && range.ok ? listSwapsRange(range.from, range.to) : Promise.resolve({ ...empty, swaps: [] }),
    // Fix Phase 2.7b (G-02 requirements 3 and 5): the exchange log, same days.
    canManage && range.ok ? listLittleSafeExchangesRange(range.from, range.to) : Promise.resolve({ ...empty, exchanges: [] }),
    canManage ? listEmployees({ includeInactive: true }) : Promise.resolve([]),
    // Fix Phase 2.7c (G-11): cash out of the master till on open supply runs.
    listOpenSupplyRuns(),
  ]);
  // The master till counts short by every open supply run (books-98: a
  // receipt is evidence, not cash). Missing 0318 = no notice.
  const supplyNotice = openRunsRes.ok ? openRunsNotice(openRunsRes.runs) : null;

  // Employee id → full name resolver (counted_by / performed_by / approved_by are FKs).
  const empName = new Map(allEmployees.map((e) => [e.id, e.full_name]));
  const nameFor = (id: string | null): string => (id ? (empName.get(id) ?? "—") : "—");
  const readErrors = [
    countsRes.error ? `Counts could not all be read: ${countsRes.error}` : null,
    swapsRes.error ? `Change swaps could not all be read: ${swapsRes.error}` : null,
    exchangesRes.error ? `Little safe exchanges could not all be read: ${exchangesRes.error}` : null,
  ].filter((x): x is string => x != null);
  const rangeQs = range.ok ? `from=${range.from}&to=${range.to}` : "";
  const startWindow = defaultCountWindow(status.todayAmDone, status.todayPmDone);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Safe" }]} />
      <AdminPageHeader
        title="Store safe"
        subtitle={`The master till: the change fund behind the registers — target ${formatCents(SAFE_TARGET_MINOR)}, counted twice a day.`}
        action={
          <Button href={backHref(BASE, sp.back)} variant="neutral">
            ← Register Activity
          </Button>
        }
        help={
          <HelpPanel id="registers-safe" title="How the safe works">
            <p>
              This page is the <strong>master till</strong>: the store&apos;s change fund —{" "}
              {formatCents(SAFE_TARGET_MINOR)} in small bills and coins so registers never run out of
              change. It is counted twice a day: once in the morning (AM) before open, once in the
              evening (PM). Any employee can count and record it with their own PIN (owner decision
              D15). Counts are open, not blind — the target is known policy, so the grid shows your
              variance live while you count.
            </p>
            <p>
              <strong>The standard mix</strong> (owner decision D11): {STANDARD_WORDS}. The grid shows the
              standard and the difference under every box, and says &ldquo;Mix on standard&rdquo; or &ldquo;Mix off&rdquo; apart from the total: a
              count can be exactly {formatCents(SAFE_TARGET_MINOR)} and still be off the mix. Big bills
              ($20 and up) go to the little safe; rebuild the small bills and coin from it (SOP-02 §4.10).
            </p>
            <p>
              <strong>Little safe exchange</strong> (owner decision D3): record every swap of big bills out of the
              master till for small bills and coin from the little safe, by denomination on both sides, with your PIN.
              The two sides must be the same value or it is not saved. The little safe has no balance or target, so
              the app does not count it.
            </p>
            <p>
              Change swaps happen at the register: a cashier trades big bills for equal change with
              the safe. The same value goes each way, so neither the drawer&apos;s expected cash nor
              the safe total moves — but every trip into the safe is recorded here, with the
              cashier who did it and the manager or lead who approved it by PIN on the register.
            </p>
            <p>
              Drops and close takings are <strong>not</strong> master till money. They go to the store
              safe and into the deposit bag (Deposit bags page), never into this count. If drop or
              takings cash is found in the master till, take it out, put it in the store safe and
              count again (SOP-02 §4.12).
            </p>
            <p>
              <strong>The $5 rule</strong> (owner decisions D7, D16, D21): the counter enters their PIN (required). When the
              count is more than $5.00 over or short of the target, a written reason is required and the count
              shows as a warning on the owner&apos;s Over / short warnings screen. At $5.00 or less the reason is
              optional. Warnings never block a count.
            </p>
          </HelpPanel>
        }
      />

      {sp.error ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          {sp.error}
        </div>
      ) : sp.counted ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.counted}
        </div>
      ) : null}

      {supplyNotice ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          {supplyNotice}{" "}
          <a href="/admin/registers/supply-runs" className="underline">
            Supply runs
          </a>
        </div>
      ) : null}

      {!status.ready ? (
        <EmptyState
          title="Safe tracking not set up yet"
          description="Run migration 0135_safe_counts_swaps.sql in the Supabase SQL editor, then reload this page. Until then, register change swaps will refuse to record (nothing is silently skipped)."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Target float" value={formatCents(status.targetMinor)} hint="Store policy" />
            <StatCard
              label="Last count"
              value={status.latest ? formatCents(status.latest.total_minor) : "—"}
              hint={
                status.latest
                  ? `${varianceLabel(status.latest.variance_minor)} · ${fmtTime(status.latest.counted_at)}`
                  : "No counts yet"
              }
            />
            <StatCard
              label="Today's AM count"
              value={status.todayAmDone ? "Done" : "Not yet"}
              hint="Before open"
            />
            <StatCard
              label="Today's PM count"
              value={status.todayPmDone ? "Done" : "Not yet"}
              hint="Evening"
            />
          </div>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">Count the safe</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Count every denomination in the master till. The variance against the {formatCents(SAFE_TARGET_MINOR)} target
              and the difference from the standard mix update live as you type.
            </p>
            <form action={recordSafeCountAction} className="mt-3 space-y-3">
              <CountGrid
                expectedMinor={SAFE_TARGET_MINOR}
                expectedLabel="Target"
                totalLabel="Safe total"
                reasonName="variance_reason"
                showStandard
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  Count window
                  <Select name="count_window" defaultValue={startWindow} required>
                    <option value="am">AM (before open)</option>
                    <option value="pm">PM (evening)</option>
                    <option value="other">Extra count</option>
                  </Select>
                </label>
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  Counted by: your PIN (required)
                  <Input
                    name="counter_pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    minLength={4}
                    maxLength={6}
                    autoComplete="off"
                    required
                    placeholder="PIN"
                  />
                </label>
                <label className="block grow text-xs text-[var(--admin-text-muted)]">
                  Notes (optional)
                  <Input name="notes" maxLength={500} placeholder="e.g. 3 × $20 from swaps, not yet to the little safe" />
                </label>
                <SaveButton label="Record safe count" busyLabel="Saving…" variant="primary" />
              </div>
            </form>
          </section>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">Little safe exchange</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Big bills out of the master till into the little safe, and the same value of small bills and coin from
              the little safe into the master till (owner D3). Count both sides by denomination. Any employee, with
              their own PIN. A saved exchange cannot be changed; to undo one, record the reverse with a note.
            </p>
            <LittleSafeExchangeForm action={recordLittleSafeExchangeAction} />
          </section>

          {!canManage ? (
            <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm text-[var(--admin-text-muted)]">
              Count history, the printable master till sheet and the export are for managers (owner, admin or manager
              logins). Your count is saved with your name the moment you tap <strong>Record safe count</strong>.
            </section>
          ) : (
            <>
              <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--admin-text)]">Count history</h2>
                    <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                      Every count for the business days picked (30 days unless you choose). Tap a row&apos;s
                      mix to see its denominations against the standard.
                    </p>
                  </div>
                  <RangePicker from={range.ok ? range.from : (sp.from ?? "")} to={range.ok ? range.to : (sp.to ?? "")} />
                </div>
                {!range.ok ? (
                  <p className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-3 py-2 text-sm text-[var(--admin-danger)]" role="alert">
                    {range.error}
                  </p>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                      <Button href={`/admin/registers/safe/sheet?day=${range.to}`} variant="neutral" size="sm">
                        Printable sheet ({range.to})
                      </Button>
                      {readErrors.length === 0 ? (
                        <span className="text-[var(--admin-text-muted)]">
                          Export {range.from} to {range.to}:{" "}
                          <a className="underline" href={`/admin/registers/safe/export?${rangeQs}&format=csv`}>
                            CSV
                          </a>{" "}
                          ·{" "}
                          <a className="underline" href={`/admin/registers/safe/export?${rangeQs}&format=xlsx`}>
                            Excel
                          </a>
                        </span>
                      ) : (
                        <span className="text-[var(--admin-text-muted)]">Export is off until every record reads.</span>
                      )}
                    </div>
                    {readErrors.length > 0 ? (
                      <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-3 py-2 text-sm text-[var(--admin-danger)]" role="alert">
                        <p className="font-semibold">This history may be incomplete.</p>
                        <ul className="mt-1 list-disc pl-5">
                          {readErrors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {countsRes.counts.length === 0 ? (
                      <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No master till counts in these days.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[980px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                              <th className="py-2 pr-3">When</th>
                              <th className="py-2 pr-3">Window</th>
                              <th className="py-2 pr-3">Counted by</th>
                              <th className="py-2 pr-3 text-right">Total</th>
                              <th className="py-2 pr-3 text-right">Target</th>
                              <th className="py-2 pr-3">Variance</th>
                              <th className="py-2 pr-3">Mix</th>
                              <th className="py-2 pr-3">Reason</th>
                              <th className="py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {countsRes.counts.map((row) => {
                              const c = sheetCountFromRow(row, nameFor);
                              const m = mixCheck(c.denoms);
                              return (
                                <tr key={c.id} className="border-b border-[var(--admin-border)]/50 align-top text-[var(--admin-text)]">
                                  <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(c.countedAt)}</td>
                                  <td className="py-2 pr-3">
                                    <Badge tone={c.window === "other" ? "neutral" : "outline"}>
                                      {WINDOW_LABEL[c.window] ?? c.window}
                                    </Badge>
                                  </td>
                                  <td className="py-2 pr-3">{c.countedByName}</td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{formatCents(c.totalMinor)}</td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{formatCents(c.expectedMinor)}</td>
                                  <td className="py-2 pr-3">
                                    <span
                                      className={
                                        c.varianceMinor === 0
                                          ? "text-[var(--admin-text-muted)]"
                                          : c.varianceMinor > 0
                                            ? "text-[var(--admin-gold)]"
                                            : "text-[var(--admin-danger)]"
                                      }
                                    >
                                      {varianceLabel(c.varianceMinor)}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-3">
                                    <details>
                                      <summary className={`cursor-pointer ${m.onStandard ? "text-[var(--admin-text-muted)]" : "text-[var(--admin-gold)]"}`}>
                                        {m.onStandard ? "On standard" : `Off: ${m.offText}`}
                                      </summary>
                                      <table className="mt-1 text-xs tabular-nums">
                                        <thead>
                                          <tr className="text-[var(--admin-text-faint)]">
                                            <th className="pr-2 text-left">Denom</th>
                                            <th className="pr-2 text-right">Standard</th>
                                            <th className="pr-2 text-right">Counted</th>
                                            <th className="text-right">Diff</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {mixRows(c.denoms)
                                            .filter((r) => r.standard !== 0 || r.counted !== 0)
                                            .map((r) => (
                                              <tr key={r.key}>
                                                <td className="pr-2">{r.label}</td>
                                                <td className="pr-2 text-right">{r.standard}</td>
                                                <td className="pr-2 text-right">{r.counted}</td>
                                                <td className="text-right">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </details>
                                  </td>
                                  <td className="py-2 pr-3 text-[var(--admin-text-muted)]">
                                    {c.reason ?? (isOverShortWarning(c.varianceMinor) ? "No reason" : "—")}
                                  </td>
                                  <td className="py-2 text-[var(--admin-text-muted)]">{c.notes ?? "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <h2 className="text-sm font-semibold text-[var(--admin-text)]">Change swaps</h2>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  Value-neutral trades between a register drawer and the master till — recorded at the register
                  with a manager or lead approval PIN. Same days as the count history.
                </p>
                {!range.ok ? null : swapsRes.swaps.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No change swaps in these days.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                          <th className="py-2 pr-3">When</th>
                          <th className="py-2 pr-3 text-right">Amount</th>
                          <th className="py-2 pr-3">Big bills in</th>
                          <th className="py-2 pr-3">Change out</th>
                          <th className="py-2 pr-3">Performed by</th>
                          <th className="py-2 pr-3">Approved by</th>
                          <th className="py-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {swapsRes.swaps.map((s) => {
                          const bills = swapBillWords(s.in_denoms, s.out_denoms);
                          return (
                          <tr key={s.id} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)]">
                            <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(s.occurred_at)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{formatCents(s.amount_minor)}</td>
                            <td className="py-2 pr-3 text-[var(--admin-text-muted)]">{bills.inWords}</td>
                            <td className="py-2 pr-3 text-[var(--admin-text-muted)]">{bills.outWords}</td>
                            <td className="py-2 pr-3">{nameFor(s.performed_by)}</td>
                            <td className="py-2 pr-3">{nameFor(s.approved_by)}</td>
                            <td className="py-2 text-[var(--admin-text-muted)]">{s.notes ?? "—"}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <h2 className="text-sm font-semibold text-[var(--admin-text)]">Little safe exchanges</h2>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  Master till ↔ little safe, both sides by denomination (owner D3). Same days as the count history.
                </p>
                {!range.ok ? null : !exchangesRes.ready ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                    Not set up yet: run migration 0317_little_safe_exchanges.sql. Until then use paper form 8.2 (SOP-02 §4.10).
                  </p>
                ) : exchangesRes.exchanges.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No little safe exchanges in these days.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                          <th className="py-2 pr-3">When</th>
                          <th className="py-2 pr-3">OUT of master till → little safe</th>
                          <th className="py-2 pr-3">IN from little safe → master till</th>
                          <th className="py-2 pr-3 text-right">Each side</th>
                          <th className="py-2 pr-3">Recorded by</th>
                          <th className="py-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exchangesRes.exchanges.map((row) => {
                          const e = sheetExchangeFromRow(row, nameFor);
                          return (
                            <tr key={e.id} className="border-b border-[var(--admin-border)]/50 align-top text-[var(--admin-text)]">
                              <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(e.occurredAt)}</td>
                              <td className="py-2 pr-3">{e.outWords}</td>
                              <td className="py-2 pr-3">{e.inWords}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{formatCents(e.valueMinor)}</td>
                              <td className="py-2 pr-3">{e.recordedByName}</td>
                              <td className="py-2 text-[var(--admin-text-muted)]">{e.notes ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
