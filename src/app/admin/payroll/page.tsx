import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Button, Badge } from "@/components/admin/ui";
import {
  getAchCompanySettings,
  listPayrollRuns,
  getPayrollReconcileInputs,
} from "@/lib/payroll/payroll-store";
import { centsToDollars } from "@/lib/payroll/payroll-core";
import {
  reconcilePayroll,
  formatDiff,
  type PayrollReconcileResult,
} from "@/lib/payroll/payroll-reconcile-core";
import {
  payrollReconcileChip,
  payrollReconcileHeadline,
} from "@/lib/payroll/payroll-ui-core";
import { createRunAction } from "./actions";

export const dynamic = "force-dynamic";

function statusTone(status: string): "green" | "gold" | "neutral" | "danger" {
  if (status === "file_generated") return "green";
  if (status === "submitted") return "green";
  if (status === "void") return "danger";
  return "gold";
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const { msg, error } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Payroll direct deposit" subtitle="Manual-entry payroll → ACH." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t connected yet. Apply migration 0057 to enable payroll.
          </div>
        </div>
      </div>
    );
  }

  const [settings, runs, reconcileInputs] = await Promise.all([
    getAchCompanySettings(),
    listPayrollRuns(),
    getPayrollReconcileInputs(),
  ]);
  const settingsComplete =
    !!settings.destination_routing && !!settings.company_name && !!settings.originating_dfi;

  const today = new Date().toISOString().slice(0, 10);

  // P6b — reconcile each completed run against the Main-account ACH debit.
  const reconcileResult: PayrollReconcileResult = reconcilePayroll(
    reconcileInputs.runs,
    reconcileInputs.withdrawals,
    { todayIso: today },
  );

  return (
    <div>
      <AdminPageHeader
        title="Payroll direct deposit"
        subtitle="Type the amounts off your Sage paystubs, and we build the ACH file to upload to Timberland. You stay in control — nothing is auto-imported."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Payroll" }]} />}
        help={
          <HelpPanel
            id="payroll"
            title="How this speeds up payroll"
            steps={[
              "Run payroll in Sage like you always do and print the paystubs.",
              "Set your bank block once (Timberland routing + company info) below.",
              "Start a run, pick the pay date, and type each employee's net pay (and gross/taxes/deductions if you want the run to reconcile).",
              "Employee bank info is remembered after the first time, so next run it's already filled in.",
              "Generate the ACH file and upload it to Timberland — no re-keying account numbers.",
              "Later, the Bank reconciliation section below shows a green ✓ once each payroll's withdrawal clears your operating account — or flags any that didn't.",
            ]}
          >
            <p>
              This does not connect to Sage. You run payroll there, then enter the totals here so we
              can produce a standards-compliant NACHA file. We verify routing numbers and reconcile
              gross − taxes − deductions to net so a typo can&apos;t slip through.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {msg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">{msg}</div>
        ) : null}
        {error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">{error}</div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Pay runs" value={runs.length} accent="muted" />
          <StatCard label="Files generated" value={runs.filter((r) => r.status === "file_generated" || r.status === "submitted").length} accent="green" />
          <StatCard label="Bank block" value={settingsComplete ? "Ready" : "Set up"} accent={settingsComplete ? "green" : "gold"} />
        </div>

        {/* Create a run */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Start a payroll run</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">Pick the date employees should be paid, then enter the amounts.</p>
          <form action={createRunAction} className="flex flex-wrap items-end gap-3">
            <Field label="Label" help="Optional, e.g. “Period ending 6/14”">
              <Input name="label" placeholder="Pay period ending…" />
            </Field>
            <Field label="Pay date" help="ACH effective date" required>
              <Input type="date" name="pay_date" defaultValue={today} />
            </Field>
            <Button type="submit" variant="save" size="sm" disabled={!settingsComplete}>
              Create run
            </Button>
            {!settingsComplete ? (
              <span className="text-xs text-[var(--admin-gold)]">Set your bank block first ↓</span>
            ) : null}
          </form>
        </div>

        {/* Runs list */}
        <div>
          <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Pay runs</h2>
          {runs.length === 0 ? (
            <EmptyState icon="💵" title="No payroll runs yet" description="Create your first run above." />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">Pay date</th>
                    <th className="px-4 py-3 text-right">Employees</th>
                    <th className="px-4 py-3 text-right">Net total</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {runs.map((r) => (
                    <tr key={r.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                      <td className="px-4 py-3">
                        <Link href={`/admin/payroll/${r.id}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                          {r.label ?? "(untitled run)"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{r.pay_date}</td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{r.entry_count}</td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">${centsToDollars(r.total_net_cents)}</td>
                      <td className="px-4 py-3 text-center"><Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, " ")}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* P6b — Bank reconciliation: prove every payroll actually cleared. */}
        <PayrollReconcileSection
          result={reconcileResult}
          hasMainAccount={reconcileInputs.hasMainAccount}
          mainAccountNames={reconcileInputs.mainAccountNames}
        />

        {/* Bank block settings — now live on their own Banking settings page. */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Originating bank &amp; company (one-time)</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Your bank details for the ACH file header — routing, account number, company ID, and
            originating DFI — now live on their own <span className="font-semibold">Banking settings</span> page so
            they are shared by both payroll and vendor payments. {settingsComplete ? "They are set up." : "They still need to be filled in before you can generate a file."}
          </p>
          <Link
            href="/admin/settings/banking"
            className="inline-flex items-center gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm font-semibold text-[var(--admin-text)] transition hover:border-white/30"
          >
            🏦 Open Banking settings
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P6b — Bank reconciliation section
// ---------------------------------------------------------------------------
// Novice-friendly, at-a-glance: one plain-English verdict banner, then a
// line-item table (one row per completed run) matched to the ACH withdrawal
// that left the Main operating account. Anything needing attention is
// highlighted, and spelled out below so Michael knows exactly what to chase.

function reconcileBadgeTone(
  tone: "neutral" | "green" | "orange",
): "neutral" | "green" | "orange" {
  return tone;
}

function PayrollReconcileSection({
  result,
  hasMainAccount,
  mainAccountNames,
}: {
  result: PayrollReconcileResult;
  hasMainAccount: boolean;
  mainAccountNames: string[];
}) {
  const { runs, summary, unexplainedDebits } = result;

  const headline = payrollReconcileHeadline({
    allClear: summary.allClear,
    runCount: summary.runCount,
    mismatch: summary.mismatch,
    unmatched: summary.unmatched,
    awaiting: summary.awaiting,
  });

  const bannerCls =
    headline.tone === "green"
      ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)]"
      : headline.tone === "orange"
        ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]"
        : "border-[var(--admin-border)] bg-white/[0.02]";
  const bannerTitleCls =
    headline.tone === "green"
      ? "text-[var(--admin-accent)]"
      : headline.tone === "orange"
        ? "text-[var(--admin-orange)]"
        : "text-[var(--admin-text)]";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Bank reconciliation</h2>
        <p className="text-xs text-[var(--admin-text-muted)]">
          Each completed payroll sends one lump-sum ACH withdrawal out of your Main operating account. We match that
          withdrawal to the run&apos;s net-pay total so you can prove every payroll cleared for the right amount.
          {hasMainAccount && mainAccountNames.length > 0
            ? ` Watching: ${mainAccountNames.join(", ")}.`
            : ""}
        </p>
      </div>

      {!hasMainAccount ? (
        <EmptyState
          icon="🏦"
          title="Connect your Main operating account first"
          description='Reconciliation matches each payroll against the ACH withdrawal that leaves your operating account. Go to Bank Feeds → the Health tab, find your Timberland operating account, and set its job to "Main operating." Then your payrolls will match up here automatically — you only do this once.'
        />
      ) : summary.runCount === 0 ? (
        <EmptyState
          icon="🧾"
          title="No completed payrolls to reconcile yet"
          description="Once you generate an ACH file for a run, its bank withdrawal will be matched here. Draft runs don't have a file yet, so there's nothing to clear."
        />
      ) : (
        <>
          {/* Verdict banner — the whole point, in one glance. */}
          <div className={`rounded-[var(--admin-radius-lg)] border p-5 ${bannerCls}`}>
            <h3 className={`text-base font-bold ${bannerTitleCls}`}>{headline.title}</h3>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{headline.detail}</p>
          </div>

          {/* Count summary. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Cleared" value={summary.matched} accent="green" hint="Withdrew & ties out" />
            <StatCard label="Awaiting clearing" value={summary.awaiting} accent="muted" hint="Still within a day or two" />
            <StatCard label="Amount off" value={summary.mismatch} accent="orange" hint="Posted, wrong amount" />
            <StatCard label="Not cleared" value={summary.unmatched} accent="orange" hint="Window passed — please chase" />
          </div>

          {/* Money summary. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total expected out" value={`$${centsToDollars(summary.totalExpectedCents)}`} accent="muted" hint="Sum of net pay across runs" />
            <StatCard label="Total withdrawn" value={`$${centsToDollars(summary.totalMatchedCents)}`} accent="muted" hint="Actually left the bank so far" />
            <StatCard
              label="Difference"
              value={formatDiff(summary.netDifferenceCents)}
              accent={summary.netDifferenceCents === 0 ? "green" : "muted"}
              hint={summary.netDifferenceCents === 0 ? "Ties out to the penny" : "Withdrawn minus expected"}
            />
          </div>

          {/* Line-item table — one row per completed run. */}
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Payroll</th>
                  <th className="px-4 py-3">Pay date</th>
                  <th className="px-4 py-3 text-right">Net pay (expected)</th>
                  <th className="px-4 py-3 text-right">Withdrawn</th>
                  <th className="px-4 py-3">Posted on</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {runs.map((r) => {
                  const chip = payrollReconcileChip(r.status);
                  return (
                    <tr
                      key={r.runId}
                      className={`bg-[var(--admin-surface)] ${chip.needsAttention ? "bg-[var(--admin-orange-soft)]" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--admin-text)]">{r.label ?? "(untitled run)"}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{r.payDate}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">${centsToDollars(r.expectedCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                        {r.matchedCents === null ? "—" : `$${centsToDollars(r.matchedCents)}`}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-faint)]">{r.matchedDate ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone={reconcileBadgeTone(chip.tone)}>{chip.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* What to check — attention rows spelled out. */}
          {runs.some((r) => payrollReconcileChip(r.status).needsAttention) ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-5">
              <h3 className="mb-2 text-sm font-bold text-[var(--admin-orange)]">What to check</h3>
              <ul className="space-y-2">
                {runs
                  .filter((r) => payrollReconcileChip(r.status).needsAttention)
                  .map((r) => (
                    <li key={`act-${r.runId}`} className="text-sm text-[var(--admin-text-muted)]">
                      <span className="font-semibold text-[var(--admin-text)]">
                        {r.label ?? "(untitled run)"} · {r.payDate}:
                      </span>{" "}
                      {r.status === "mismatch"
                        ? `a withdrawal posted, but for ${formatDiff(r.differenceCents ?? 0)} off the expected net pay. Confirm the amount, or whether a fee/return is mixed in.`
                        : `no matching withdrawal has cleared and the posting window (through ${r.windowLatest}) has passed. Confirm the ACH file was actually uploaded to Timberland for this run.`}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {/* Withdrawals we couldn't tie to any run (informational). */}
          {unexplainedDebits.length > 0 ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Other withdrawals we couldn&apos;t match to a payroll</h3>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                These are money-out transactions on your operating account that didn&apos;t line up with any payroll run. They&apos;re
                probably normal (vendor payments, fees, transfers) — shown here only so nothing is hidden.
              </p>
              <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Description</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {unexplainedDebits.slice(0, 25).map((w) => (
                      <tr key={w.transactionId} className="bg-[var(--admin-surface)]">
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{w.date}</td>
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{w.description ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--admin-text-muted)]">${centsToDollars(w.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unexplainedDebits.length > 25 ? (
                <p className="mt-2 text-xs text-[var(--admin-text-faint)]">Showing the first 25 of {unexplainedDebits.length}.</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
