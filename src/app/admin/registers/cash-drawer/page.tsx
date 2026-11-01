/**
 * /admin/registers/cash-drawer — Cash drawer & receipt (R-DRAWER-1).
 *
 * Owner request (verbatim): "i want to build a setting in the register
 * activity page of the back office that gives me the option of popping the
 * cash drawer with a receipt or with out the receipt printed. most of my
 * customers do not want a receipt and this new method should make for a
 * more efficient process."
 *
 * Saved as a site_settings JSON row (no migration); registers pick it up with
 * their next /api/pos/menu refresh and keep the cached value offline.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { DrawerOnSaleEditor } from "@/components/admin/registers/DrawerOnSaleEditor";
import { getPosDrawerOnSaleConfig } from "@/lib/pos/drawer-on-sale-store";

export const dynamic = "force-dynamic";

export default async function CashDrawerSettingPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Cash drawer & receipt" subtitle="How the drawer opens after a cash sale." />
        <EmptyState title="Supabase not configured" description="Connect the database to choose the setting." />
      </div>
    );
  }

  const config = await getPosDrawerOnSaleConfig();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Registers", href: "/admin/registers" }, { label: "Cash drawer & receipt" }]} />
      <AdminPageHeader
        title="Cash drawer & receipt"
        subtitle="Choose whether the drawer opens with a printed receipt or without one."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-cash-drawer-on-sale"
          title="How this setting works"
          steps={[
            "With a printed receipt (the default): after a cash sale the budtender taps Print receipt. The receipt prints and the drawer opens.",
            "Without a receipt: when Sale complete appears on a cash sale, the drawer opens by itself and nothing prints. The screen says Drawer open.",
            "A customer who wants a receipt still gets one: the budtender taps Print receipt. It prints and does not open the drawer again.",
            "If the drawer does not open (printer off or not paired), an Open drawer button appears. Print receipt also opens it.",
            "In both settings the drawer opens once per sale. A sale put on the employee pay-later tab never opens it. No sale with a manager PIN is unchanged.",
            "Registers pick up the setting with their next menu refresh. Offline registers keep the last setting they downloaded. The iPad register app must be on the version with this feature.",
          ]}
        />
        <Card>
          <DrawerOnSaleEditor initial={config} />
        </Card>
      </div>
    </div>
  );
}
