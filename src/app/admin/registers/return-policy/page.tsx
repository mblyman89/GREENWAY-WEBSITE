/**
 * /admin/registers/return-policy — customer return policy (Fix Phase 6F,
 * G-67 / G-68).
 *
 * Owner message 9 (verbatim excerpt): "it would be better if this were
 * changed to allow anyone to return products so long as they have the
 * original packaging and the receipt to go with it and it falls within the
 * 7 day return period. But because we are an enterprise grade platform, we
 * shouldn't just change the behavior in code, we should allow it to be a
 * setting in the register activity page, so we can toggle it on and off if
 * we want to. I also want to have a setting for choosing a return window as
 * well as the types of products we allow to be returned."
 *
 * Saved as a site_settings JSON row (no migration). The returns desk and the
 * iPad lookup read it on every lookup; registers also get it in their menu
 * bundle so the printed receipt policy matches.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { ReturnPolicyEditor } from "@/components/admin/registers/ReturnPolicyEditor";
import { getPosReturnPolicy } from "@/lib/pos/return-policy-store";
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";

export const dynamic = "force-dynamic";

export default async function ReturnPolicyPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Return policy" subtitle="Who may return, for how long, and which products." />
        <EmptyState title="Supabase not configured" description="Connect the database to set the return policy." />
      </div>
    );
  }

  const [config, labelMap] = await Promise.all([
    getPosReturnPolicy(),
    loadCategoryLabelMap({ includeInactive: true }),
  ]);
  const categories = Object.entries(labelMap)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Return policy" },
        ]}
      />
      <AdminPageHeader
        title="Return policy"
        subtitle="Who may return, how many days they have, and which product types can come back."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-return-policy"
          title="How the return policy settings work"
          steps={[
            "Loyalty members only: off means anyone with the original receipt may return; on means the original sale must have had a loyalty member attached.",
            "Return window: how many calendar days after purchase a return is accepted (default 7).",
            "Product types: untick a type and the register and the returns desk refuse returns of it, with the reason on screen.",
            "Always required, not a setting: the original receipt and the original packaging with the lot ID fully legible (WAC 314-55-079(12)), plus a manager PIN.",
            "The returns desk and the register apply a change on the next lookup. Receipts print the new policy after each register's next menu refresh.",
          ]}
        />
        <Card>
          <ReturnPolicyEditor initial={config} categories={categories} />
        </Card>
      </div>
    </div>
  );
}
