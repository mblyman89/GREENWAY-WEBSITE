/**
 * /admin/registers/receipt — register receipt customization (POS Slice B13).
 *
 * The owner designs the paper receipt the way the big POS players allow:
 * header, address/contact block, footer message, and display toggles
 * (served-by, savings, loyalty). A live preview renders the IDENTICAL pure
 * builder the register hands to Star PassPRNT, so preview and paper can
 * never drift. Saved as a site_settings JSON row (no migration); registers
 * pick it up with their next /api/pos/menu refresh and keep printing the
 * cached design offline.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { ReceiptConfigEditor } from "@/components/admin/registers/ReceiptConfigEditor";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { getPosReturnPolicy } from "@/lib/pos/return-policy-store";
import { defaultReturnPolicyText } from "@/lib/pos/returns-core";

export const dynamic = "force-dynamic";

export default async function ReceiptConfigPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Receipt design" subtitle="Customize the register receipt." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the database to customize the register receipt."
        />
      </div>
    );
  }

  const [config, returnPolicy] = await Promise.all([getPosReceiptConfig(), getPosReturnPolicy()]);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Receipt design" },
        ]}
      />
      <AdminPageHeader
        title="Receipt design"
        subtitle="Header, address block, footer, and display options for every register receipt."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-receipt-design"
          title="How receipt customization works"
          steps={[
            "Edit the header, address/contact block, and footer — the live preview shows exactly what the printer will produce.",
            "Toggles control the optional lines: the budtender's name, the \"You saved\" promo line, and the loyalty points block.",
            "Save, then refresh the menu on each register (automatic when online) — offline registers keep the last downloaded design.",
            "Compliance text is not optional: keep the intoxicating-effects warning in the footer. Blank header/footer reset to safe defaults.",
            "Discount details: two separate sets of switches — one for the register (cart screen, printed + emailed receipt) and one for online orders (website checkout, order confirmation page, confirmation email, printed pickup ticket). Choose what is shown: regular price, savings, percent off, the deal and how it works, cost-floor caps, and the order savings summary with total percent off.",
          ]}
        />
        <Card>
          <ReceiptConfigEditor initial={config} defaultPolicyText={defaultReturnPolicyText(returnPolicy)} />
        </Card>
      </div>
    </div>
  );
}
