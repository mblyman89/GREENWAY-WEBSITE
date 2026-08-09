import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import {
  getKbCounts,
  listKbStrainsFull,
  listKbProductCategoriesAll,
  listKbTerpenesFull,
} from "@/lib/ai/kb/store";
import { isAiConfigured } from "@/lib/ai/suggestions";
import { buildStrainVocab } from "@/lib/ai/kb/strain-vocab-core";
import {
  buildStrainTypeSuggestion,
  type StrainTypeSuggestion,
  type SuggestPoolRow,
} from "@/lib/ai/kb/strain-type-suggest-core";
import { strainTypeValues } from "@/lib/menu/strain-taxonomy";
import { KbLibrary } from "../KbLibrary";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

export default async function KbLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [counts, strains, productCategories, terpeneRows] = await Promise.all([
    getKbCounts(),
    listKbStrainsFull(2500),
    listKbProductCategoriesAll(500),
    listKbTerpenesFull(500),
  ]);

  // Smart-selector vocab (terpenes/aroma/flavor) + per-type house suggestions,
  // both computed server-side from the verified seed + live terpene reference
  // so the big STRAINS_RICH dataset never ships to the client bundle.
  const vocab = buildStrainVocab(terpeneRows);

  // Learn over time: fold the operator's OWN saved strains into the suggestion
  // pool alongside the verified seed. Only ACTIVE, non-draft strains count, so
  // hidden or half-reviewed rows never skew the "typical for this type" chips.
  // Uses the strains we already loaded above — no extra DB query. De-dupe by
  // slug happens inside buildStrainTypeSuggestion (a saved strain overrides its
  // seed copy so nothing is counted twice).
  const learnedRows: SuggestPoolRow[] = strains
    .filter((s) => s.active === true && s.status !== "draft")
    .map((s) => ({
      slug: s.slug,
      strain_type: s.strain_type,
      terpenes: s.terpenes,
      aroma_notes: s.aroma_notes,
      flavor_notes: s.flavor_notes,
    }));

  const strainTypeSuggestions: Record<string, StrainTypeSuggestion> = {};
  for (const t of strainTypeValues) {
    strainTypeSuggestions[t] = buildStrainTypeSuggestion(t, { extraRows: learnedRows });
  }

  return (
    <div>
      <AdminPageHeader
        title="Strains & product categories"
        subtitle="The core factual vocabulary the AI writes from — lineage, aroma, flavor, format"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Strains & categories" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />
        <KbLibrary
          strains={strains}
          strainsMigrated={counts.migrated}
          strainsTotal={counts.strains}
          productCategories={productCategories}
          productCategoriesMigrated={productCategories.length > 0}
          vocab={vocab}
          strainTypeSuggestions={strainTypeSuggestions}
          aiEnabled={isAiConfigured}
        />
      </div>
    </div>
  );
}
