/**
 * /admin/registers/scanning — scan-required register mode (POS Slice B41).
 *
 * Dutchie's "require scanning": cannabis items must be added by scanning
 * the package barcode, proving the budtender holds the exact package that
 * leaves the shelf — wrong-item picks (two strains, same name, different
 * lots) die at the register instead of becoming inventory drift. Saved as
 * a site_settings JSON row (no migration); registers pick it up with their
 * next /api/pos/menu refresh and keep enforcing the cached policy offline.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { ScanRequiredEditor } from "@/components/admin/registers/ScanRequiredEditor";
import { getPosScanRequiredConfig } from "@/lib/pos/scan-required-store";

export const dynamic = "force-dynamic";

export default async function ScanRequiredPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Scan-required mode" subtitle="Cannabis must be scanned at the register." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the database to set the scanning policy."
        />
      </div>
    );
  }

  const config = await getPosScanRequiredConfig();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Scan-required mode" },
        ]}
      />
      <AdminPageHeader
        title="Scan-required mode"
        subtitle="Make budtenders scan the package barcode to ring cannabis — the scan proves the right package left the shelf."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-scan-required"
          title="How scan-required mode works"
          steps={[
            "Turn it on and every cannabis item must be SCANNED at the register — tapping a cannabis tile shows a “scan required” notice instead of adding it to the check.",
            "Merch & accessory tiles and the quick-amount keypad stay tappable — they carry no package/lot identity to protect.",
            "Damaged label or scanner down? A manager or lead lifts the requirement for THAT SALE ONLY with their PIN (verified server-side — the register must be online). The register locks after every sale, so the unlock never carries over.",
            "Registers download the policy with their next menu refresh (automatic when online); offline registers keep enforcing the last downloaded policy.",
          ]}
        />
        <Card>
          <ScanRequiredEditor initial={config} />
        </Card>
      </div>
    </div>
  );
}
