import { achAuthority } from "@/lib/auth/ach-authority-core";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TimberlandRoomLeft } from "@/components/admin/payments/TimberlandRoomLeft";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getOriginatorReadiness } from "@/lib/payroll/payroll-store";
import { OriginatorNotReady } from "@/components/admin/payroll/OriginatorNotReady";
import { Card, CardHeader, Section } from "@/components/admin/ui";
import { getVendorReconcileInputs } from "@/lib/payments/vendor-reconcile-store";
import {
  reconcileVendorPayments,
  type VendorReconcileResult,
} from "@/lib/payments/vendor-reconcile-core";
import { VendorReconcileSection } from "@/components/admin/payments/VendorReconcileSection";
import { VendorAchForm } from "./VendorAchForm";
import { ManualPaymentForm } from "./ManualPaymentForm";
import { InvoiceCreditForm } from "./InvoiceCreditForm";
import { earliestEffectiveDate } from "@/lib/payments/timberland-deadline-core";

export const dynamic = "force-dynamic";

export default async function VendorPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  const session = await requirePermission("payables.manage");
  // R41 S0 / D-4: building a vendor ACH file needs ach.act (owner) or ach.request (admin -> a request).
  const achSide = achAuthority(session.profile.role);

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

  const [{ settings, readiness }, reconcileInputs] = await Promise.all([
    getOriginatorReadiness(),
    getVendorReconcileInputs(),
  ]);
  // R41 S2: the one Timberland readiness answer (the builder uses the same check).
  const originatorReady = readiness.ready;

  const today = new Date().toISOString().slice(0, 10);

  // P7-a — reconcile each recorded ACH/wire vendor payment against the
  // Main-account withdrawal that carried it out of the bank.
  const reconcileResult: VendorReconcileResult = reconcileVendorPayments(
    reconcileInputs.payments,
    reconcileInputs.withdrawals,
    { todayIso: today },
  );

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
            <SopSheetLink slug="pay" />
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        {/* R23 item 8: the one pipeline bar, in order. */}
        <CatalogStageStrip current="pay" />

        {/* R41 S4: Timberland's daily and monthly room (the release refuses anything over). */}
        <TimberlandRoomLeft today={pacificToday()} />

        {/* Readiness at a glance — real state, no fabricated payables ledger. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Bank/ACH setup"
            value={originatorReady ? "Ready" : "Incomplete"}
            hint={originatorReady ? "matches Timberland's setup" : "fix it on Banking > My banking"}
            accent={originatorReady ? "green" : "orange"}
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

        {!originatorReady && <OriginatorNotReady problems={readiness.problems} tail="(shared by payroll and vendor payments)." />}

        <Section
          title="Pay by ACH"
          description="Generate a NACHA file to upload to your bank."
        >
          <Card>
            {achSide === "none" ? (
              <p className="text-sm text-[var(--admin-text-muted)]">
                Only Michael (the owner) builds vendor ACH files, and Stephen (admin) can send a batch to Michael for approval. You can still record
                non-ACH payments below.
              </p>
            ) : (
              <VendorAchForm
                settingsComplete={originatorReady}
                companyName={settings.company_name}
                viewerIsOwner={achSide === "act"}
                earliestEffective={earliestEffectiveDate(new Date())}
                nowIso={new Date().toISOString()}
              />
            )}
          </Card>
        </Section>

        {/* Fix 3.4: a credit or discount the system did not read off the invoice. */}
        <Section
          title="Add a credit or discount to an invoice"
          description="The invoice shows a credit, discount or price reduction the system didn't catch? Add it here before paying. What is owed (and the vendor bill) drops by that amount. Credits are never deleted - void one with a reason."
        >
          <Card>
            <CardHeader
              title="Credit / discount before paying"
              subtitle="Type the amount as a positive number (299.70). It can't be more than what is still owed."
            />
            <div className="mt-4">
              <InvoiceCreditForm />
            </div>
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

        {/* P7-a — Bank reconciliation: prove every recorded vendor payment cleared. */}
        <Section
          title="Bank reconciliation"
          description="Match the vendor payments you've recorded against the real withdrawals on your Main operating account."
        >
          <VendorReconcileSection
            result={reconcileResult}
            hasMainAccount={reconcileInputs.hasMainAccount}
            mainAccountNames={reconcileInputs.mainAccountNames}
          />
        </Section>
      </div>
    </div>
  );
}
