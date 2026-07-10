import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getAchCompanySettings } from "@/lib/payroll/payroll-store";
import { Card, CardHeader, Section } from "@/components/admin/ui";
import { VendorAchForm } from "./VendorAchForm";
import { ManualPaymentForm } from "./ManualPaymentForm";

export const dynamic = "force-dynamic";

export default async function VendorPaymentsPage() {
  await requirePermission("payables.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Accounts Payable" subtitle="Manual-entry vendor bills → ACH file." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t connected yet.
          </div>
        </div>
      </div>
    );
  }

  const settings = await getAchCompanySettings();
  const settingsComplete =
    !!settings.destination_routing && !!settings.company_name && !!settings.originating_dfi;

  return (
    <div>
      <AdminPageHeader
        title="Accounts Payable"
        subtitle="Enter what you owe each vendor and generate a NACHA file to upload to your bank."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Accounts Payable" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="vendor-ach"
            title="How vendor payments work"
            steps={[
              "Set your company/bank ACH details once on the Payroll page — they're shared here.",
              "Pick the invoice (an accepted manifest). The amount box auto-fills with what you owe — edit it for a partial delivery.",
              "If the delivery was linked to a purchase order, a note compares the invoice against what you ordered before you pay.",
              "Click Generate — we validate every row, then build a NACHA (CCD) file.",
              "Download the file and upload it in your bank's ACH portal. Nothing is sent from here.",
            ]}
          >
            <p>
              The amount box <strong>auto-fills from the invoice total</strong> (the accepted
              manifest&apos;s cost basis) and stays editable for partial deliveries. When the delivery
              was{" "}
              <Link href="/admin/inventory/intake" className="text-[var(--admin-accent)] hover:underline">linked to a purchase order</Link>{" "}
              at receiving, we compare the invoice against what the{" "}
              <Link href="/admin/purchasing" className="text-[var(--admin-accent)] hover:underline">PO</Link>{" "}
              ordered and flag any difference before you pay — overpaying is blocked, partial
              payments are allowed with a warning. Amounts are entered in dollars and
              stored/generated in cents. This is a draft for your review and manual bank upload.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <Link
            href="/admin/catalog"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </Link>
        </div>

        {/* Readiness at a glance — real state, no fabricated payables ledger. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Bank/ACH setup"
            value={settingsComplete ? "Ready" : "Incomplete"}
            hint={settingsComplete ? "company + routing on file" : "set it on the Payroll page"}
            accent={settingsComplete ? "green" : "orange"}
            href="/admin/payroll"
          />
          <StatCard
            label="Payment methods"
            value="ACH + manual"
            hint="NACHA file or record a check/cash/wire"
            accent="muted"
          />
          <StatCard
            label="Control"
            value="Invoice ↔ PO check"
            hint="linked deliveries compared to the PO before you pay"
            accent="muted"
          />
        </div>

        {!settingsComplete && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Your bank/company ACH settings are incomplete. Set them once on the{" "}
            <Link href="/admin/payroll" className="font-semibold underline">
              Payroll page
            </Link>{" "}
            — they are shared with vendor payments.
          </div>
        )}

        <Section
          title="Pay by ACH"
          description="Generate a NACHA file to upload to your bank."
        >
          <Card>
            <VendorAchForm
              settingsComplete={settingsComplete}
              companyName={settings.company_name}
            />
          </Card>
        </Section>

        <Section
          title="Record a non-ACH payment"
          description="Paid a vendor by check, cash, or wire? Record it here so the manifest doesn't hang as an open payable. No bank file is generated."
        >
          <Card>
            <CardHeader
              title="Close out an invoice paid another way"
              subtitle="Same guardrails as ACH: overpaying is blocked, partial payments are allowed with a warning."
            />
            <div className="mt-4">
              <ManualPaymentForm />
            </div>
          </Card>
        </Section>
      </div>
    </div>
  );
}
