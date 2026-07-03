import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import {
  getKbCounts,
  listKbStrainsFull,
  listKbProductCategoriesAll,
} from "@/lib/ai/kb/store";
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

  const [counts, strains, productCategories] = await Promise.all([
    getKbCounts(),
    listKbStrainsFull(2500),
    listKbProductCategoriesAll(500),
  ]);

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
        />
      </div>
    </div>
  );
}
