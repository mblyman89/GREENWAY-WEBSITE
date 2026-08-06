/**
 * /admin/promotions/never-discount — PR-P4.
 *
 * The global "never discount" list: individual products that must NEVER receive
 * ANY promotion. The discount engine folds these keys into every rule's
 * exclusions ("exclusions win"), so a protected product keeps its regular price
 * at the register and on the storefront under every deal — storewide sales,
 * daily deals, brand sales, smart-selector targets, all of it.
 *
 * Works pre-migration: listNeverDiscount() returns [] when the table (migration
 * 0155) isn't applied yet, so the page renders an empty list and the engine
 * behaves exactly as before until Michael runs the SQL.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listMenuProducts, listNeverDiscount } from "@/lib/promotions/promotions-store";
import { NeverDiscountManager } from "@/components/admin/promotions/NeverDiscountManager";

export const dynamic = "force-dynamic";

export default async function NeverDiscountPage() {
  await requirePermission("promotions.manage");

  const [products, list] = isSupabaseServiceConfigured
    ? await Promise.all([listMenuProducts(), listNeverDiscount()])
    : [[], []];

  return (
    <div>
      <AdminPageHeader
        title="Never-discount list"
        subtitle="Products that always keep their regular price — excluded from every promotion, everywhere."
      />
      <div className="px-5 py-6 sm:px-8">
        <Breadcrumbs
          items={[
            { label: "Promotions", href: "/admin/promotions" },
            { label: "Never-discount list" },
          ]}
        />

        <div className="mt-4">
          <HelpPanel id="never-discount-help" title="How the never-discount list works">
            <p>
              Anything on this list is <strong>always sold at full price</strong>. No promotion can
              touch it — not a storewide sale, not a daily deal, not a brand sale, and not the AI
              Smart Selector. The register and the website both honour it automatically.
            </p>
            <p className="mt-2">
              This is your master safety net: use it for vendor price-protected items, loss leaders
              you refuse to cut further, or anything you always sell at full margin. Removing a
              product here makes it eligible for promotions again.
            </p>
          </HelpPanel>
        </div>

        {!isSupabaseServiceConfigured && (
          <div className="mt-4 rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-2 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t configured in this environment, so the list can&apos;t be edited
            here.
          </div>
        )}

        <div className="mt-5">
          <NeverDiscountManager products={products} initialList={list} />
        </div>

        <p className="mt-6 text-xs text-white/40">
          Looking for the deals themselves?{" "}
          <Link href="/admin/promotions" className="text-[var(--admin-accent)] hover:underline">
            Back to the promotions command center
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
