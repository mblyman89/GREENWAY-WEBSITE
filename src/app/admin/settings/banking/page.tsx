import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { BankingSettingsForm } from "@/components/admin/settings/BankingSettingsForm";
import { getAchCompanySettings } from "@/lib/payroll/payroll-store";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";

export const dynamic = "force-dynamic";

export default async function BankingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const [settings, sp] = await Promise.all([
    getAchCompanySettings().catch(() => null),
    searchParams,
  ]);

  const resolved = settings ?? {
    destination_routing: "",
    destination_name: "",
    immediate_origin: "",
    company_name: "",
    company_id: "",
    originating_dfi: "",
    entry_description: "PAYROLL",
    company_account_number: "",
    company_account_type: "checking" as const,
  };

  const complete =
    !!resolved.destination_routing &&
    !!resolved.company_name &&
    !!resolved.originating_dfi &&
    !!resolved.company_id &&
    !!resolved.company_account_number;

  return (
    <div>
      <AdminPageHeader
        title="Banking settings"
        subtitle="Your originating bank & company details for ACH files. Shared by Payroll and Accounts Payable — set once here."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking" }]} />
        }
        help={
          <HelpPanel
            id="banking-settings"
            title="What each field means (and where to get it)"
            steps={[
              "Bank name, routing number, and company name — you already know these.",
              "Your account number — your funding account at the bank. It is NOT written into the ACH file header; your bank's upload portal asks for it and a balanced file uses it for the offset entry. That's why there was no place to enter it before.",
              "Company ID — a 10-character identifier your bank assigns you, almost always the digit “1” followed by your 9-digit EIN.",
              "Immediate Origin — another 10-character value from your bank, usually identical to Company ID (“1” + EIN).",
              "Originating DFI — simply the first 8 digits of your bank's 9-digit routing number.",
            ]}
          >
            <p className="mb-2">
              The three bank-assigned values (Company ID, Immediate Origin, Originating DFI) come from
              your bank when you enroll in ACH origination. If you are unsure of any of them, call your
              treasury/ACH contact — never guess, because a wrong value causes the bank to reject the file.
            </p>
            <p>
              These settings are shared: the same block prints on both your payroll and your vendor
              (Accounts Payable) ACH files.
            </p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
            {sp.msg}
          </div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {sp.error}
          </div>
        ) : null}
        {!complete ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Your banking settings are incomplete. Fill in every field below (ask your bank for Company ID,
            Immediate Origin, and Originating DFI if needed) before generating a payroll or vendor ACH file.
          </div>
        ) : null}

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          {/* S-10: render the funding account MASKED — submitting the mask (or
              leaving it blank) keeps the stored value; typing replaces it. */}
          <BankingSettingsForm
            settings={{
              ...resolved,
              company_account_number: maskAccountTail(resolved.company_account_number),
            }}
          />
        </div>
      </div>
    </div>
  );
}
