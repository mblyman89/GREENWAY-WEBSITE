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
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet.
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
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-sm text-white/60">
            No published menu yet. Import and publish a menu version under{" "}
            <Link href="/admin/menu-imports" className="text-[#7ed957] hover:underline">
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
          <div className="rounded-lg border border-white/10 bg-[#0a0a0a] px-4 py-2 text-xs text-white/45">
            AI drafting is available but not yet enabled. Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> env
            var to turn on one-click description &amp; tag suggestions.
          </div>
        )}

        {/* Filters */}
        <form className="flex flex-wrap items-center gap-3" method="get">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search product or brand…"
            className="flex-1 min-w-48 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
          <select name="category" defaultValue={category ?? ""} className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select name="gap" defaultValue={gap ?? ""} className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]">
            <option value="">All products</option>
            <option value="description">Missing description</option>
            <option value="image">Missing image</option>
            <option value="brand">Missing brand link</option>
          </select>
          <button type="submit" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[#7ed957] hover:text-white">
            Filter
          </button>
          {view && <input type="hidden" name="view" value={view} />}
          {/* Grid / Table view toggle */}
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-white/15">
            <Link
              href={gridHref}
              className={`px-3 py-2 text-xs font-bold ${!isTable ? "bg-[#7ed957] text-black" : "text-white/60 hover:bg-white/10"}`}
            >
              ▦ Grid
            </Link>
            <Link
              href={tableHref}
              className={`px-3 py-2 text-xs font-bold ${isTable ? "bg-[#7ed957] text-black" : "text-white/60 hover:bg-white/10"}`}
            >
              ☰ Table
            </Link>
          </div>
        </form>

        {/* Bulk AI entry point */}
        {isAiConfigured && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ffd700]/25 bg-[#ffd700]/5 px-4 py-3">
            <p className="text-sm text-white/70">
              <span className="font-bold text-[#ffd700]">✨ Bulk AI:</span> draft descriptions for many
              products at once, then review & approve them in a grid.
            </p>
            <Link
              href="/admin/products/bulk-ai"
              className="rounded-lg bg-[#ffd700] px-4 py-2 text-xs font-bold text-black hover:bg-[#e6c200]"
            >
              Open bulk AI review →
            </Link>
          </div>
        )}

        {/* Visual grid (default) */}
        {!isTable && <ProductGrid cards={gridCards} />}

        {/* Table (power-user view) */}
        {isTable && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0a0a] text-left text-xs uppercase tracking-wide text-white/40">
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
            <tbody className="divide-y divide-white/5">
              {filtered.slice(0, 300).map((g) => (
                <tr key={g.posKey} className="bg-black hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <Link href={`/admin/products/${encodeURIComponent(g.posKey)}`} className="font-medium text-white hover:text-[#7ed957]">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-white/60">{g.brand || "—"}</td>
                  <td className="px-4 py-3 text-white/50">{g.category}</td>
                  <td className="px-4 py-3 text-center">{g.hasDescription ? "✅" : <span className="text-[#ff7f00]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasImage ? "✅" : <span className="text-[#ff7f00]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasBrandLink ? "✅" : <span className="text-white/30">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${g.enrichmentStatus === "published" ? "bg-[#7ed957]/15 text-[#7ed957]" : "bg-white/10 text-white/50"}`}>
                      {g.enrichmentStatus ?? "none"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {filtered.length > 300 && (
          <p className="text-xs text-white/40">Showing first 300 of {filtered.length}. Use search/filters to narrow.</p>
        )}
        {isTable && filtered.length === 0 && <p className="text-sm text-white/50">No products match your filter.</p>}
      </div>
    </div>
  );
}
