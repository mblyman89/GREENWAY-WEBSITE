import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { SubstituteManager } from "../SubstituteManager";
import { KbFlash } from "../KbFlash";
import {
  listImageSubstitutes,
  imageSubstituteCounts,
  imageSubstitutesMigrated,
  SEED_CATEGORY_KEYS,
  SEED_INVENTORY_TYPE_KEYS,
} from "@/lib/ai/kb/image-substitutes";
import { listMedia, publicUrlForKey } from "@/lib/media/store";

export const dynamic = "force-dynamic";

export default async function KbImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [substitutes, subCounts, subMigrated, mediaAssets] = await Promise.all([
    listImageSubstitutes(500),
    imageSubstituteCounts(),
    imageSubstitutesMigrated(),
    listMedia({ limit: 200 }),
  ]);

  const mediaOptions = mediaAssets.map((m) => ({
    id: m.id,
    label: m.title || m.filename || m.id,
    url: publicUrlForKey(m.storage_key) ?? m.public_url ?? null,
  }));

  return (
    <div>
      <AdminPageHeader
        title="Fallback images"
        subtitle="Substitute images so product cards are never blank when a real photo is missing"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Fallback images" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />
        <SubstituteManager
          substitutes={substitutes}
          media={mediaOptions}
          categoryKeys={SEED_CATEGORY_KEYS}
          inventoryTypeKeys={SEED_INVENTORY_TYPE_KEYS}
          coveredCategories={subCounts.coveredCategories}
          coveredInventoryTypes={subCounts.coveredInventoryTypes}
          totalCategories={SEED_CATEGORY_KEYS.length}
          totalInventoryTypes={SEED_INVENTORY_TYPE_KEYS.length}
          migrated={subMigrated}
        />
      </div>
    </div>
  );
}
