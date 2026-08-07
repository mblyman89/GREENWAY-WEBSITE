import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PromotionForm } from "@/components/admin/promotions/PromotionForm";
import {
  listMenuBrands,
  listMenuProducts,
  listSavedAudiences,
} from "@/lib/promotions/promotions-store";
import { isAiConfigured } from "@/lib/promotions/ai-copy";
import {
  parseGuidedParams,
  buildThursdayBrandSaleDraft,
} from "@/lib/promotions/guided-promotion-core";
import { createPromotionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPromotionPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    brands?: string;
    percent?: string;
    title?: string;
  }>;
}) {
  await requirePermission("promotions.manage");
  const sp = await searchParams;
  const { error } = sp;
  const [brands, products, audiences] = isSupabaseServiceConfigured
    ? await Promise.all([listMenuBrands(), listMenuProducts(), listSavedAudiences()])
    : [[], [], []];

  // PR-P5 guided Thursday brand sale: when the launcher hands us brands+percent,
  // synthesize a ready-to-review DRAFT and pre-fill the form. Unknown brands are
  // dropped (and reported); the existing form + createPromotionAction do the
  // actual save with all publish-time CCRS guards intact.
  const guidedInput = parseGuidedParams(sp);
  const guided = guidedInput ? buildThursdayBrandSaleDraft(guidedInput, brands) : null;
  const guidedPromotion = guided?.promotion ?? null;
  const guidedWarnings = guided?.warnings ?? [];

  return (
    <div>
      <AdminPageHeader
        title={guidedPromotion ? "New Thursday brand sale" : "New promotion"}
        subtitle={
          guidedPromotion
            ? "We pre-filled this from your quick setup — review the brands, percent and schedule, then create the draft."
            : "Create a deal. It saves as a draft — preview affected products, then publish."
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {guidedPromotion && (
          <div className="mb-4 rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--admin-gold)]">
              🌟 Guided setup: Top Shelf Thursday
            </p>
            <p className="mt-1 text-white/70">
              We pre-filled a {guidedPromotion.discount_percent}% Thursday sale on{" "}
              {guidedPromotion.targets.map((t) => t.value).join(", ")}. Change anything below, then
              click <span className="font-semibold">Create draft</span>. It won&apos;t go live until
              you publish it.
            </p>
          </div>
        )}
        {guidedWarnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <ul className="list-disc space-y-0.5 pl-5">
              {guidedWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <PromotionForm
          action={createPromotionAction}
          promotion={guidedPromotion}
          brands={brands}
          products={products}
          audiences={audiences}
          submitLabel="Create draft"
          aiEnabled={isAiConfigured}
        />
      </div>
    </div>
  );
}
