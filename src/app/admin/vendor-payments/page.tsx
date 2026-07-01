import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { getAchCompanySettings } from "@/lib/payroll/payroll-store";
import { VendorAchForm } from "./VendorAchForm";

export const dynamic = "force-dynamic";

export default async function VendorPaymentsPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Vendor payments (ACH)" subtitle="Manual-entry vendor bills → ACH file." />
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
        title="Vendor payments (ACH)"
        subtitle="Enter what you owe each vendor and generate a NACHA file to upload to your bank."
        breadcrumbs={<Breadcrumbs items={[{ label: "Finance" }, { label: "Vendor payments" }]} />}
        help={
          <HelpPanel
            id="vendor-ach"
            title="How vendor ACH works"
            steps={[
              "Set your company/bank ACH details once on the Payroll page — they're shared here.",
              "Add a row per vendor: name, routing #, account #, checking/savings, amount.",
              "Click Generate — we validate every row, then build a NACHA (CCD) file.",
              "Download the file and upload it in your bank's ACH portal. Nothing is sent from here.",
            ]}
          >
            <p>
              This uses the exact same vendor-payment engine that already powers the file format
              (validation + NACHA build). Amounts are entered in dollars and stored/generated in
              cents. This is a draft for your review and manual bank upload.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {!settingsComplete && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Your bank/company ACH settings are incomplete. Set them once on the{" "}
            <Link href="/admin/payroll" className="font-semibold underline">
              Payroll page
            </Link>{" "}
            — they are shared with vendor payments.
          </div>
        )}

        <VendorAchForm settingsComplete={settingsComplete} companyName={settings.company_name} />
      </div>
    </div>
  );
}
