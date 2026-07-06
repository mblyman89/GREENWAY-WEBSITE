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
} from "@/lib/payroll/payroll-store";
import { centsToDollars } from "@/lib/payroll/payroll-core";
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

  const [settings, runs] = await Promise.all([getAchCompanySettings(), listPayrollRuns()]);
  const settingsComplete =
    !!settings.destination_routing && !!settings.company_name && !!settings.originating_dfi;

  const today = new Date().toISOString().slice(0, 10);

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
