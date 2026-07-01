import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { PricingSettingsForm } from "@/components/admin/settings/PricingSettingsForm";
import { getPricingSettings } from "@/lib/inventory/pricing";

export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  await requirePermission("settings.manage");
  const settings = await getPricingSettings();

  return (
    <div>
      <AdminPageHeader
        title="Pricing settings"
        subtitle="Store-wide pricing guard rails: minimum markup and rounding."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Pricing" }]} />
        }
        help={
          <HelpPanel
            id="pricing-settings"
            title="How pricing guard rails work"
            steps={[
              "The minimum markup is a hard floor — prices can never dip below it.",
              "Rounding keeps suggested prices tidy (e.g. ending in .00 or .05).",
              "These rules apply everywhere the pricing tools set a price.",
            ]}
          >
            <p>Only owners and admins can change these settings.</p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <PricingSettingsForm settings={settings} />
      </div>
    </div>
  );
}
