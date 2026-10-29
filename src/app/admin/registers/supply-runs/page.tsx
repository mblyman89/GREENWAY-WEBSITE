import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge, Input, Select } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents } from "@/lib/registers/cash";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { listEmployees } from "@/lib/staffing/store";
import { backHref } from "@/lib/admin/back-link-core";
import {
  MAX_SUPPLY_RUN_MINOR,
  SUPPLY_EXPENSE_ACCOUNTS,
  SUPPLY_TEXT_MAX_LEN,
  daysOpen,
  isOpen,
  notPosted,
  openAdvanceMinor,
  supplyExpenseAccount,
} from "@/lib/registers/supply-run-core";
import { listSupplyRuns } from "@/lib/registers/supply-run-store";
import { cashOutAction, settleAction, retrySupplyPostAction } from "./actions";

/**
 * /admin/registers/supply-runs — Fix Phase 2.7c (G-11, F-02-11, owner D17:
 * "Q-02-4- id like the supply run screen built"). The three parts G-11
 * recorded: cash out (who, amount, approver PIN), settle (receipt, change,
 * expense account), and the open-advances list for the owner. SOP-02 §4.13.
 */

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h2>
      {children}
    </section>
  );
}

function PinField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-xs text-[var(--admin-text-muted)]">
      {label}
      <Input name={name} type="password" inputMode="numeric" pattern="[0-9]*" minLength={4} maxLength={6} autoComplete="off" required placeholder="PIN" />
    </label>
  );
}

export default async function SupplyRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; error?: string; done?: string }>;
}) {
  const sp = await searchParams;
  const session = await requirePermission("orders.manage");
  const isOwner = canReadBooks(session.profile.role);
  const today = pacificToday();
  const crumbs = <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Supply runs" }]} />;
  const back = (
    <Button href={backHref(BASE, sp.back)} variant="neutral">
      ← Register Activity
    </Button>
  );

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Supply runs" subtitle="Cash out of the master till for supplies, and the receipt and change back." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to record supply runs." />
      </div>
    );
  }

  const [runsRes, employees] = await Promise.all([listSupplyRuns(addPacificDays(today, -30)), listEmployees({ includeInactive: true })]);

  if (!runsRes.ok) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Supply runs" subtitle="Cash out of the master till for supplies, and the receipt and change back." action={back} />
        {runsRes.missingSchema ? (
          <EmptyState
            title="Supply-run screen not set up yet"
            description="Apply migration 0318_supply_runs.sql in the Supabase SQL editor, then reload this page. Until then, use paper form 8.4 (SOP-02). Nothing is recorded silently."
          />
        ) : (
          <EmptyState title="The supply runs could not be read" description={`${runsRes.error}. This is not the same as there being no supply runs; reload the page.`} />
        )}
      </div>
    );
  }

  const runs = runsRes.runs;
  const empName = new Map(employees.map((e) => [e.id, e.full_name]));
  const nameOf = (id: string | null) => (id ? (empName.get(id) ?? "—") : "—");
  const open = runs.filter(isOpen).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const settled = runs.filter((r) => !isOpen(r));
  const outMinor = openAdvanceMinor(runs);
  const unposted = runs.filter((r) => notPosted(r).advance || notPosted(r).settle);
  const oldest = open[0] ? daysOpen(open[0].businessDay, today) : 0;

  return (
    <div className="space-y-6">
      <div className="print:hidden">{crumbs}</div>
      <div className="print:hidden">
        <AdminPageHeader
          title="Supply runs"
          subtitle="Cash out of the master till for supplies (two PINs), then the receipt and change back. The store rule is still the shop card."
          action={back}
          help={
            <HelpPanel id="registers-supply-runs" title="How supply runs work (SOP-02 §4.13)">
              <p>
                <strong>Use the shop card first.</strong> The owner: &quot;I don&apos;t want to use the master till any more for petty cash.&quot; Take cash
                only when the card cannot be used, and write why.
              </p>
              <p>
                <strong>Cash out.</strong> The person taking the cash enters the amount, the reason and their PIN. A manager or lead (not the same
                person) enters theirs to approve. The books record it as money owed back by that person (12100 Employee Advances), not as an expense.
              </p>
              <p>
                <strong>Settle.</strong> When they come back, a different employee counts the change, checks the receipt, picks what it was for, and
                enters their PIN. Receipt + change must equal the cash taken. The receipt goes to the owner the same day; the change goes back in the
                master till.
              </p>
              <p>
                <strong>The master till counts short</strong> by every open run until it is settled. That is correct: a receipt is evidence, not cash.
              </p>
            </HelpPanel>
          }
        />
      </div>

      <div className="space-y-6 px-5 sm:px-8 print:px-0">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:hidden">{sp.error}</div>
        ) : sp.done ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)] print:hidden">{sp.done}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          <StatCard label="Open supply runs" value={String(open.length)} hint="Cash out, not settled" />
          <StatCard label="Out with employees" value={formatCents(outMinor)} hint="The master till counts short by this" />
          <StatCard label="Oldest open" value={open.length === 0 ? "—" : `${oldest} day${oldest === 1 ? "" : "s"}`} hint={open[0] ? nameOf(open[0].takenBy) : "None open"} />
          <StatCard label="Not posted to the books" value={String(unposted.length)} hint={unposted.length > 0 ? "Press Post to the books below" : "Every entry posted"} />
        </div>

        {/* ── Cash out ─────────────────────────────────────────────── */}
        <Panel title="Cash out of the master till (two PINs)" className="print:hidden">
          <form action={cashOutAction} className="mt-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs text-[var(--admin-text-muted)]">
                Cash taken ($, up to {formatCents(MAX_SUPPLY_RUN_MINOR)})
                <Input name="amount" inputMode="decimal" required placeholder="e.g. 20.00" autoComplete="off" />
              </label>
              <label className="block grow text-xs text-[var(--admin-text-muted)]">
                Why not the shop card (required)
                <Input name="reason" required maxLength={SUPPLY_TEXT_MAX_LEN} placeholder="e.g. card declined at the hardware store" />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <PinField name="taker_pin" label="PIN of the person taking the cash" />
              <PinField name="approver_pin" label="Manager or lead PIN (approves; not the taker)" />
              <Button type="submit" variant="primary" size="sm">
                Record cash out
              </Button>
            </div>
          </form>
        </Panel>

        {/* ── Open runs: settle ────────────────────────────────────── */}
        <Panel title={`Open supply runs (${open.length})`} className="print:hidden">
          {open.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No cash is out with anyone. Nothing to settle.</p>
          ) : (
            <div className="mt-2 space-y-4">
              {open.map((r) => {
                const np = notPosted(r);
                return (
                  <form key={r.id} action={settleAction} className="space-y-3 rounded-lg border border-[var(--admin-border)] p-3">
                    <input type="hidden" name="run_id" value={r.id} />
                    <p className="text-sm text-[var(--admin-text)]">
                      <strong>{formatCents(r.amountMinor)}</strong> with <strong>{nameOf(r.takenBy)}</strong> since {fmtTime(r.takenAt)} ({daysOpen(r.businessDay, today)} day(s)) ·
                      approved by {nameOf(r.approvedBy)} · why: {r.reason}{" "}
                      {np.advance ? <Badge tone="danger">Cash out NOT POSTED</Badge> : <Badge tone="green">Cash out in the books</Badge>}
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block text-xs text-[var(--admin-text-muted)]">
                        Receipt total ($)
                        <Input name="receipt" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
                      </label>
                      <label className="block text-xs text-[var(--admin-text-muted)]">
                        Change handed back ($)
                        <Input name="change" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
                      </label>
                      <label className="block text-xs text-[var(--admin-text-muted)]">
                        What the receipt was for
                        <Select name="expense_account" defaultValue="">
                          <option value="">— pick one (not needed if the receipt is 0.00) —</option>
                          {SUPPLY_EXPENSE_ACCOUNTS.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="block grow text-xs text-[var(--admin-text-muted)]">
                        Note (optional)
                        <Input name="note" maxLength={SUPPLY_TEXT_MAX_LEN} placeholder="e.g. store name, what was bought" />
                      </label>
                      <PinField name="receiver_pin" label="PIN of who counted the change (not the taker)" />
                      <Button type="submit" variant="primary" size="sm">
                        Settle {formatCents(r.amountMinor)}
                      </Button>
                    </div>
                    <p className="text-xs text-[var(--admin-text-faint)]">
                      Receipt + change must equal {formatCents(r.amountMinor)}. 76020 note from the chart: packaging that becomes part of the product sold
                      may be inventoriable; ask the owner before using it for that.
                    </p>
                  </form>
                );
              })}
              {open.some((r) => notPosted(r).advance) ? (
                <div className="flex flex-wrap gap-2">
                  {open
                    .filter((r) => notPosted(r).advance)
                    .map((r) => (
                      <form key={r.id} action={retrySupplyPostAction}>
                        <input type="hidden" name="run_id" value={r.id} />
                        <input type="hidden" name="leg" value="advance" />
                        <Button type="submit" variant="neutral" size="sm">
                          Post to the books: cash out {formatCents(r.amountMinor)} ({nameOf(r.takenBy)})
                        </Button>
                      </form>
                    ))}
                </div>
              ) : null}
            </div>
          )}
        </Panel>

        {/* ── The log (owner: the open-advances list; print) ───────── */}
        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">
                Supply-run log · every open run, and runs from {addPacificDays(today, -30)} to {today}
              </h2>
              <p className="text-xs text-[var(--admin-text-muted)] print:text-black/70">
                Greenway Marijuana · WA license 413541 · keep with the receipts (SOP-02 form 8.4){isOwner ? " · owner: anything still open is money out with a named person" : ""}
              </p>
            </div>
            <div className="print:hidden">
              <PrintButton />
            </div>
          </div>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No supply runs in this period.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black">
                    <th className="py-2 pr-3">Day</th>
                    <th className="py-2 pr-3">Taken by</th>
                    <th className="py-2 pr-3">Approved by</th>
                    <th className="py-2 pr-3 text-right">Out</th>
                    <th className="py-2 pr-3">Why not the card</th>
                    <th className="py-2 pr-3 text-right">Receipt</th>
                    <th className="py-2 pr-3 text-right">Change</th>
                    <th className="py-2 pr-3">For</th>
                    <th className="py-2 pr-3">Received by</th>
                    <th className="py-2">Books</th>
                  </tr>
                </thead>
                <tbody>
                  {[...open, ...settled].map((r) => {
                    const np = notPosted(r);
                    const acct = r.expenseAccount ? supplyExpenseAccount(r.expenseAccount) : null;
                    return (
                      <tr key={r.id} className="border-b border-[var(--admin-border)]/50 align-top text-[var(--admin-text)] print:text-black">
                        <td className="py-2 pr-3">{r.businessDay}</td>
                        <td className="py-2 pr-3">{nameOf(r.takenBy)}</td>
                        <td className="py-2 pr-3">{nameOf(r.approvedBy)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCents(r.amountMinor)}</td>
                        <td className="py-2 pr-3">{r.reason}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.receiptMinor === null ? "OPEN" : formatCents(r.receiptMinor)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.changeMinor === null ? "—" : formatCents(r.changeMinor)}</td>
                        <td className="py-2 pr-3">{acct ? `${acct.code} ${acct.name}` : r.receiptMinor === 0 ? "nothing bought" : "—"}{r.receiptNote ? ` · ${r.receiptNote}` : ""}</td>
                        <td className="py-2 pr-3">{r.settledAt ? `${nameOf(r.settledBy)} ${fmtTime(r.settledAt)}` : "—"}</td>
                        <td className="py-2">
                          {np.advance || np.settle ? (
                            <span className="flex flex-wrap items-center gap-1">
                              <Badge tone="danger">NOT POSTED</Badge>
                              {np.settle && !np.advance ? (
                                <form action={retrySupplyPostAction} className="print:hidden">
                                  <input type="hidden" name="run_id" value={r.id} />
                                  <input type="hidden" name="leg" value="settle" />
                                  <Button type="submit" variant="neutral" size="sm">
                                    Post settle
                                  </Button>
                                </form>
                              ) : null}
                              {np.advance && !isOpen(r) ? (
                                <form action={retrySupplyPostAction} className="print:hidden">
                                  <input type="hidden" name="run_id" value={r.id} />
                                  <input type="hidden" name="leg" value="advance" />
                                  <Button type="submit" variant="neutral" size="sm">
                                    Post cash out
                                  </Button>
                                </form>
                              ) : null}
                            </span>
                          ) : (
                            <Badge tone="green">{isOpen(r) ? "Cash out posted" : "Posted"}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 hidden text-xs print:block">Checked by (owner): ______________________ Date: ____________</p>
        </section>
      </div>
    </div>
  );
}
