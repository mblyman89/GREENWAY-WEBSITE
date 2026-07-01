import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { TaxSettingsForm } from "@/components/admin/settings/TaxSettingsForm";
import { getTaxSettings } from "@/lib/reports/tax";
import { getTaxCategoryRules } from "@/lib/admin/settings-store";

export const dynamic = "force-dynamic";

export default async function TaxSettingsPage() {
  await requirePermission("settings.manage");
  const [settings, rules] = await Promise.all([
    getTaxSettings().catch(() => null),
    getTaxCategoryRules(),
  ]);

  const resolved =
    settings ?? {
      exciseRateBps: 3700,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      medicalEndorsement: false,
      taxBaseMode: "pre_tax" as const,
    };

  return (
    <div>
      <AdminPageHeader
        title="Tax settings"
        subtitle="Excise and sales tax rates, and which categories are cannabis."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Tax" }]} />
        }
        help={
          <HelpPanel
            id="tax-settings"
            title="How tax settings work"
            steps={[
              "Cannabis excise applies only to categories marked as cannabis below.",
              "Sales tax (state + local) applies to everything sold.",
              "Medical endorsement enables the medical exemption path.",
              "These rates drive the POS tax engine and every tax report.",
            ]}
          >
            <p>Enter rates as percentages (e.g. 37 for 37%). Changes are recorded in the activity log.</p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <TaxSettingsForm settings={resolved} rules={rules} />
      </div>
    </div>
  );
}
