/**
 * /admin/knowledge-base/products — PR-D1 KB Products viewer.
 *
 * The missing validation surface: the per-SKU kb_products backbone (migration
 * 0071) is where every menu fetch + enrichment writes a product's saved
 * description, image, and provenance — but there was no screen to SEE it. So
 * when a Cultivera description saved, Michael had no way to confirm it worked.
 *
 * This read-only page lists those rows with description, image thumbnail,
 * source, status, and last-changed, plus headline coverage (how many have a
 * description / an image). Everything is read server-side and degrades to an
 * empty, friendly state pre-migration.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listKbProducts, getKbProductCoverage } from "@/lib/ai/kb/store";
import { resolveMediaUrls } from "@/lib/media/store";
import { KbProductsViewer } from "./KbProductsViewer";

export const dynamic = "force-dynamic";

export default async function KbProductsPage() {
  await requirePermission("products.enrich");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Product records"
          subtitle="The per-product backbone the KB saves descriptions and images into."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Knowledge Base", href: "/admin/knowledge-base" },
                { label: "Product records" },
              ]}
            />
          }
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            The database isn’t connected yet. Once it is, every product you save
            from a vendor menu will appear here.
          </div>
        </div>
      </div>
    );
  }

  const [products, coverage] = await Promise.all([
    listKbProducts("all", 3000),
    getKbProductCoverage(),
  ]);

  // Resolve primary-image media ids to public URLs for thumbnails (one query).
  const primaryIds = products
    .map((p) => p.primary_media_id)
    .filter((x): x is string => Boolean(x));
  const urlMap = await resolveMediaUrls(primaryIds);
  const imageUrls: Record<string, string> = {};
  for (const [id, url] of urlMap) imageUrls[id] = url;

  return (
    <div>
      <AdminPageHeader
        title="Product records"
        subtitle="The per-product backbone the KB saves descriptions and images into — search it and see exactly what’s saved."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Product records" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="kb-products"
            title="What this page is"
            steps={[
              "Every time you save a vendor product's assets to the KB, a record lands here with its description and image.",
              "Use this page to confirm a save worked — search for the product and check the Description column.",
              "The “Missing description” filter shows the products that still need real prose sourced.",
            ]}
          >
            <p>
              This is the durable per-SKU backbone (one row per brand + product +
              size). It’s what feeds enrichment and the storefront, so keeping the
              descriptions real and complete here is what sets our menu apart.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Product records" value={coverage.total} accent="muted" />
          <StatCard
            label="With a description"
            value={coverage.withDescription}
            accent={coverage.withDescription > 0 ? "green" : "muted"}
          />
          <StatCard
            label="Missing description"
            value={coverage.missingDescription}
            accent={coverage.missingDescription > 0 ? "gold" : "green"}
          />
          <StatCard
            label="With an image"
            value={coverage.withImage}
            accent={coverage.withImage > 0 ? "green" : "muted"}
          />
        </div>

        <KbProductsViewer products={products} imageUrls={imageUrls} />
      </div>
    </div>
  );
}
