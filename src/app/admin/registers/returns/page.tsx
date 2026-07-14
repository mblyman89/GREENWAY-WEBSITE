/**
 * /admin/registers/returns — the counter returns desk (POS Slice B16).
 *
 * Receipt-first customer returns enforcing the owner's store policy on top
 * of the WAC/CCRS machinery that already exists (Task Q):
 *   • loyalty member attached to the original sale (B14),
 *   • original receipt in hand (the printed 8-char number IS the lookup key),
 *   • within 15 Pacific calendar days of purchase,
 *   • WAC 314-55-079(12) attestations per line (original packaging + fully
 *     legible lot ID),
 *   • CCRS Sale Delete/Update correction queued + positive inventory
 *     add-back + restock/destroy — all via createCustomerReturn.
 * Refunds are computed from the stored paid price (never hand-typed);
 * loyalty points are clawed back proportionally; a printable refund receipt
 * comes back in the owner's B13 design.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { CounterReturnDesk } from "@/components/admin/registers/CounterReturnDesk";

export const dynamic = "force-dynamic";

export default async function CounterReturnsPage() {
  await requirePermission("inventory.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Returns desk" subtitle="Process customer returns by receipt number." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the database to process customer returns."
        />
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Returns desk" },
        ]}
      />
      <AdminPageHeader
        title="Returns desk"
        subtitle="Receipt-first customer returns — policy checks, refund math, CCRS corrections, and loyalty clawback in one flow."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-returns-desk"
          title="How counter returns work"
          steps={[
            "Ask for the ORIGINAL receipt and type its 8-character receipt number. Store policy: loyalty members only, receipt in hand, within 15 days of purchase — the lookup verifies all three at once.",
            "Pick the exact item and quantity. The refund is computed from what they actually paid (tax included; medical prices already reflect their exemptions) — you never type an amount.",
            "Inspect the physical product: WAC 314-55-079(12) requires the ORIGINAL packaging and a FULLY LEGIBLE lot/batch ID. If either fails, refuse the return.",
            "Choose restock (sellable) or destroy (opens the destruction hold), then log it. Inventory is added back, the CCRS Sale correction (Delete or Update) is queued for your next upload, and loyalty points are clawed back proportionally.",
            "Print the refund receipt and hand over the cash. Export queued corrections from Inventory → Returns & Destruction.",
          ]}
        />
        <Card>
          <CounterReturnDesk />
        </Card>
      </div>
    </div>
  );
}
