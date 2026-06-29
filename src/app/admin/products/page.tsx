import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, computeGaps, type GapFlags } from "@/lib/enrichment/store";
import { resolveMediaUrls } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { ProductGrid, type ProductGridCard } from "@/components/admin/products/ProductGrid";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { StatusPill, EmptyState } from "@/components/admin/ux";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; gap?: string; category?: string; view?: string }>;
}) {
  await requirePermission("products.enrich");
  const { q, gap, category, view } = await searchParams;
  const isTable = view === "table";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Products" subtitle="Enrich products with descriptions, images, tags, and AI assist." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator
            finishes the one-time setup, your products will appear here.
          </div>
        </div>
      </div>
    );
  }

  const published = await getPublishedVersion();

  if (!published) {
    return (
      <div>
        <AdminPageHeader title="Products" subtitle="Enrich products with descriptions, images, tags, and AI assist." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No published menu yet. Import and publish a menu version under{" "}
            <Link href="/admin/menu-imports" className="text-[var(--admin-accent)] hover:underline">
              Menu Imports
            </Link>
            , then products will appear here for enrichment.
          </div>
        </div>
      </div>
    );
  }

  const items = await getVersionItems(published.id);
  const keys = items.map((i) => i.source_item_id);
  const enrichments = await getEnrichmentsForKeys(keys);

  const gaps: GapFlags[] = items.map((i) => computeGaps(i, enrichments.get(i.source_item_id) ?? null));

  // Filter
  let filtered = gaps;
  if (q) {
    const ql = q.toLowerCase();
    filtered = filtered.filter((g) => g.name.toLowerCase().includes(ql) || g.brand.toLowerCase().includes(ql));
  }
  if (category) filtered = filtered.filter((g) => g.category === category);
  if (gap === "description") filtered = filtered.filter((g) => !g.hasDescription);
  else if (gap === "image") filtered = filtered.filter((g) => !g.hasImage);
  else if (gap === "brand") filtered = filtered.filter((g) => !g.hasBrandLink);

  const missingDesc = gaps.filter((g) => !g.hasDescription).length;
  const missingImg = gaps.filter((g) => !g.hasImage).length;
  const enriched = gaps.filter((g) => g.enrichmentStatus === "published").length;
  const categories = Array.from(new Set(gaps.map((g) => g.category))).sort();

  // Resolve thumbnails for the visual grid (batch — no N+1).
  const shown = filtered.slice(0, 300);
  const thumbIds: string[] = [];
  for (const g of shown) {
    const e = enrichments.get(g.posKey);
    const id = e?.primary_media_id ?? e?.image_media_ids?.[0];
    if (id) thumbIds.push(id);
  }
  const thumbMap = await resolveMediaUrls(thumbIds);
  const gridCards: ProductGridCard[] = shown.map((g) => {
    const e = enrichments.get(g.posKey);
    const id = e?.primary_media_id ?? e?.image_media_ids?.[0] ?? null;
    return {
      posKey: g.posKey,
      name: g.name,
      brand: g.brand,
      category: g.category,
      hasDescription: g.hasDescription,
      hasImage: g.hasImage,
      hasBrandLink: g.hasBrandLink,
      enrichmentStatus: g.enrichmentStatus,
      thumbnailUrl: id ? thumbMap.get(id) ?? null : null,
    };
  });

  const baseQs = new URLSearchParams();
  if (q) baseQs.set("q", q);
  if (category) baseQs.set("category", category);
  if (gap) baseQs.set("gap", gap);
  const gridHref = `/admin/products?${baseQs.toString()}`;
  const tableQs = new URLSearchParams(baseQs);
  tableQs.set("view", "table");
  const tableHref = `/admin/products?${tableQs.toString()}`;

  return (
    <div>
      <AdminPageHeader
        title="Products"
        subtitle={`Enrich the ${gaps.length} products in the live menu — descriptions, images, tags, staff picks${isAiConfigured ? ", and AI-drafted copy" : ""}. Price & stock stay POS-controlled.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Products" }]} />}
        help={
          <HelpPanel
            id="products"
            title="How product enrichment works"
            steps={[
              "Products come in automatically from your POS menu upload.",
              "Open a product to add a photo, description, and tags.",
              "Use the AI helper to draft a description or alt-text, then edit it.",
              "Save — the richer info shows on your public product page.",
            ]}
          >
            <p>
              Your POS only provides names and prices. Everything that makes a
              product look great online — photos, descriptions, tags — is added
              here. The AI helper only writes drafts; you always approve.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Products" value={gaps.length} accent="muted" />
          <StatCard label="Enriched & live" value={enriched} accent="green" />
          <StatCard label="Missing description" value={missingDesc} accent="orange" href="/admin/products?gap=description" />
          <StatCard label="Missing image" value={missingImg} accent="orange" href="/admin/products?gap=image" />
        </div>

        {!isAiConfigured && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2 text-xs text-[var(--admin-text-faint)]">
            AI drafting is available but not yet enabled. Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> env
            var to turn on one-click description &amp; tag suggestions.
          </div>
        )}

        {/* Filters */}
        <form className="flex flex-wrap items-center gap-3" method="get">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search product or brand…"
            className="min-w-48 flex-1"
          />
          <Select name="category" defaultValue={category ?? ""} className="w-auto">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select name="gap" defaultValue={gap ?? ""} className="w-auto">
            <option value="">All products</option>
            <option value="description">Missing description</option>
            <option value="image">Missing image</option>
            <option value="brand">Missing brand link</option>
          </Select>
          <Button type="submit" variant="subtle">
            Filter
          </Button>
          {view && <input type="hidden" name="view" value={view} />}
          {/* Grid / Table view toggle */}
          <div className="ml-auto inline-flex overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)]">
            <Link
              href={gridHref}
              className={`px-3 py-2 text-xs font-bold ${!isTable ? "bg-[var(--admin-accent)] text-black" : "text-[var(--admin-text-muted)] hover:bg-white/10"}`}
            >
              ▦ Grid
            </Link>
            <Link
              href={tableHref}
              className={`px-3 py-2 text-xs font-bold ${isTable ? "bg-[var(--admin-accent)] text-black" : "text-[var(--admin-text-muted)] hover:bg-white/10"}`}
            >
              ☰ Table
            </Link>
          </div>
        </form>

        {/* Bulk AI entry point */}
        {isAiConfigured && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] px-4 py-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              <span className="font-bold text-[var(--admin-gold)]">✨ Bulk AI:</span> draft descriptions for many
              products at once, then review & approve them in a grid.
            </p>
            <Button href="/admin/products/bulk-ai" variant="save" size="sm">
              Open bulk AI review →
            </Button>
          </div>
        )}

        {/* Visual grid (default) */}
        {!isTable && <ProductGrid cards={gridCards} />}

        {/* Table (power-user view) */}
        {isTable && (
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-center">Desc</th>
                <th className="px-4 py-3 text-center">Image</th>
                <th className="px-4 py-3 text-center">Brand link</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {filtered.slice(0, 300).map((g) => (
                <tr key={g.posKey} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                  <td className="px-4 py-3">
                    <Link href={`/admin/products/${encodeURIComponent(g.posKey)}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">{g.brand || "—"}</td>
                  <td className="px-4 py-3 text-[var(--admin-text-faint)]">{g.category}</td>
                  <td className="px-4 py-3 text-center">{g.hasDescription ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasImage ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasBrandLink ? "✅" : <span className="text-[var(--admin-text-faint)]">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={g.enrichmentStatus ?? undefined}>
                      {g.enrichmentStatus ?? "none"}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {filtered.length > 300 && (
          <p className="text-xs text-[var(--admin-text-faint)]">Showing first 300 of {filtered.length}. Use search/filters to narrow.</p>
        )}
        {isTable && filtered.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No products match your filter"
            description="Try clearing the search box or choosing a different category or gap filter."
          />
        )}
      </div>
    </div>
  );
}
