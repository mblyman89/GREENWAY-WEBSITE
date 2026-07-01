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
import { saveAchSettingsAction, createRunAction } from "./actions";

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

        {/* Bank block settings */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Originating bank &amp; company (one-time)</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            These go in the ACH file header. Your bank (Timberland / Jack Henry) gives you the exact
            values — routing, company ID, and originating DFI. Enter them once.
          </p>
          <form action={saveAchSettingsAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name" help="Immediate Destination Name">
              <Input name="destination_name" defaultValue={settings.destination_name} placeholder="Timberland Bank" />
            </Field>
            <Field label="Bank routing (ABA)" help="Immediate Destination — 9 digits">
              <Input name="destination_routing" defaultValue={settings.destination_routing} placeholder="123456780" />
            </Field>
            <Field label="Company name" help="Prints on employee statements">
              <Input name="company_name" defaultValue={settings.company_name} placeholder="Greenway Marijuana" />
            </Field>
            <Field label="Company ID" help="Usually “1” + your EIN">
              <Input name="company_id" defaultValue={settings.company_id} placeholder="1911234567" />
            </Field>
            <Field label="Immediate Origin" help="Usually “1” + your EIN (from the bank)">
              <Input name="immediate_origin" defaultValue={settings.immediate_origin} placeholder="1911234567" />
            </Field>
            <Field label="Originating DFI" help="First 8 digits of your routing at the ODFI">
              <Input name="originating_dfi" defaultValue={settings.originating_dfi} placeholder="12345678" />
            </Field>
            <Field label="Statement description" help="Prints on employee statements">
              <Input name="entry_description" defaultValue={settings.entry_description} placeholder="PAYROLL" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="save" size="sm">Save bank settings</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
