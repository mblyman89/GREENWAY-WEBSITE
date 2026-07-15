/**
 * /admin/registers/rounding — cash-rounding policy (POS Slice B33).
 *
 * Washington eliminated new penny production; the big POS players (Square,
 * Toast) let the merchant choose a nickel-rounding policy for CASH. The WA
 * Department of Revenue's interim guidance makes the mode the retailer's
 * choice and keeps SALES TAX on the pre-rounded price — so the register
 * rounds only the cash amount due, prints the adjustment as its own receipt
 * line, and reports the day's net rounding on the X/Z slip. Saved as a
 * site_settings JSON row (no migration); registers pick it up with their
 * next /api/pos/menu refresh and keep applying the cached policy offline.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { CashRoundingEditor } from "@/components/admin/registers/CashRoundingEditor";
import { getPosCashRoundingConfig } from "@/lib/pos/cash-rounding-store";

export const dynamic = "force-dynamic";

export default async function CashRoundingPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Cash rounding" subtitle="Penny-free cash handling at the registers." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the database to set the cash-rounding policy."
        />
      </div>
    );
  }

  const config = await getPosCashRoundingConfig();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Cash rounding" },
        ]}
      />
      <AdminPageHeader
        title="Cash rounding"
        subtitle="Choose how the registers round the cash due to the nickel — pennies are going away."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-cash-rounding"
          title="How cash rounding works"
          steps={[
            "Pick a policy: off (exact pennies), nearest nickel (Square's default), always up, or always down.",
            "The register rounds ONLY the cash amount due — sales tax stays on the pre-rounded total per the WA Department of Revenue interim guidance.",
            "Every rounded sale prints a separate \"Cash rounding\" line plus the resulting \"Cash due\" on the receipt, and the X/Z day report shows the day's net rounding.",
            "Registers download the new policy with their next menu refresh (automatic when online); offline registers keep applying the last downloaded policy.",
          ]}
        />
        <Card>
          <CashRoundingEditor initial={config} />
        </Card>
      </div>
    </div>
  );
}
