import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { StatCard } from "@/components/admin/StatCard";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, computeGaps, type GapFlags } from "@/lib/enrichment/store";
import { resolveMediaUrls } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { ProductGrid, type ProductGridCard } from "@/components/admin/products/ProductGrid";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { StatusPill, EmptyState } from "@/components/admin/ux";
import { computeProductStats, productGapInsights } from "@/lib/insight/products";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";
import { withBackParam } from "@/lib/admin/back-link-core";
import { DistributionBars } from "@/components/admin/insight/DistributionBars";
import {
  parseEnrichmentSort,
  parseEnrichmentStatusFilter,
  sortEnrichmentList,
  filterByEnrichmentStatus,
} from "@/lib/enrichment/match-core";

function fmtMoney(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; gap?: string; category?: string; view?: string; sort?: string; status?: string; back?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const { q, gap, category, view } = sp;
  const sort = parseEnrichmentSort(sp.sort);
  const statusFilter = parseEnrichmentStatusFilter(sp.status);
  const isTable = view === "table";
  // GW-029: carry the current filters into detail links for BackLink restore.
  const detailHref = (posKey: string) =>
    withBackParam(`/admin/products/${encodeURIComponent(posKey)}`, sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Product Enrichment"
          subtitle="Enrich products with descriptions, images, tags, and AI assist."
          breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment" }]} />}
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <div>
            <BackLink
              fallback="/admin/catalog"
              back={sp.back}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            >
              ← Back to Product Intake Hub
            </BackLink>
          </div>
          <CatalogStageStrip current="enrichment" />
          <HelpPanel
            id="products-empty"
            title="How product enrichment works"
            defaultOpen
            steps={[
              "Finish the one-time database setup (your administrator does this).",
              "Publish a menu: import your POS export under Menu Imports and publish it.",
              "Products then appear here automatically — your POS only provides names and prices.",
              "Open a product to add a photo, description, tags, and strain type.",
              "Use the AI helper to draft copy, then edit and approve it. Price & stock stay POS-controlled.",
            ]}
          >
            <p>
              Enrichment is what makes a product look great online. Everything here is a
              draft you approve, and nothing makes medical or health claims.
            </p>
          </HelpPanel>
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
        <AdminPageHeader
          title="Product Enrichment"
          subtitle="Enrich products with descriptions, images, tags, and AI assist."
          breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment" }]} />}
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <div>
            <BackLink
              fallback="/admin/catalog"
              back={sp.back}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            >
              ← Back to Product Intake Hub
            </BackLink>
          </div>
          <CatalogStageStrip current="enrichment" />
          <HelpPanel
            id="products-empty"
            title="How product enrichment works"
            defaultOpen
            steps={[
              "Publish a menu first: import your POS export under Menu Imports and publish it.",
              "Products then appear here automatically — your POS only provides names and prices.",
              "Open a product to add a photo, description, tags, and strain type.",
              "Use the AI helper to draft a description or alt-text, then edit and approve it.",
              "Save — the richer info shows on your public product page. Price & stock stay POS-controlled.",
            ]}
          >
            <p>
              Enrichment is what makes a product look great online. Everything here is a
              draft you approve, and nothing makes medical or health claims.
            </p>
          </HelpPanel>
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No published menu yet. Products you receive and approve with a price are carried onto a
            menu draft automatically &mdash; review and publish it under{" "}
            <Link href="/admin/menu-imports" className="text-[var(--admin-accent)] hover:underline">
              Menu Imports &rarr; Menu drafts from receiving
            </Link>
            , then products will appear here for enrichment. (The one-time POS upload on that page is
            only for the initial Cultivera import.)
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
  else if (gap === "any") filtered = filtered.filter((g) => !g.hasDescription || !g.hasImage || !g.hasBrandLink);
  filtered = filterByEnrichmentStatus(filtered, statusFilter);
  filtered = sortEnrichmentList(filtered, sort);

  const missingDesc = gaps.filter((g) => !g.hasDescription).length;
  const missingImg = gaps.filter((g) => !g.hasImage).length;
  const enriched = gaps.filter((g) => g.enrichmentStatus === "published").length;
  const categories = Array.from(new Set(gaps.map((g) => g.category))).sort();

  // Slice 1 — richer read-only insight over the live menu (no source-of-truth change).
  const stats = computeProductStats(items, gaps);
  const gapInsights = productGapInsights(stats);

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
  if (sp.sort) baseQs.set("sort", sort);
  if (statusFilter) baseQs.set("status", statusFilter);
  const gridHref = `/admin/products?${baseQs.toString()}`;
  const tableQs = new URLSearchParams(baseQs);
  tableQs.set("view", "table");
  const tableHref = `/admin/products?${tableQs.toString()}`;

  return (
    <div>
      <AdminPageHeader
        title="Product Enrichment"
        subtitle={`Enrich the ${gaps.length} products in the live menu — descriptions, images, tags, staff picks${isAiConfigured ? ", and AI-drafted copy" : ""}. Price & stock stay POS-controlled.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment" }]} />}
        help={
          <HelpPanel
            id="products"
            title="How product enrichment works"
            steps={[
              "Products come in automatically when you receive and approve them (or, one time, from the initial Cultivera menu upload).",
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
            <SopSheetLink slug="enrich" />
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Green helper box — how to enrich well, with quick links to the
            highest-impact gaps. Pinned to the TOP of the page (above the
            back-link + stage strip) so the guidance & one-click gap fixes are
            the first thing you see. Numbers are real (from stats), so the
            buttons take you straight to the products that need work. */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--admin-accent)]">
                <span aria-hidden>🌱</span> Enrichment helpers
              </h2>
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                Enrichment is what makes a product look great online — your POS only gives names
                and prices. Fill the biggest gaps first (they hurt discoverability most), then
                polish the rest. Everything here is a draft you approve; price &amp; stock stay
                POS-controlled.
              </p>
              <ul className="mt-3 grid gap-1.5 text-sm text-[var(--admin-text-muted)] sm:grid-cols-2">
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]" />
                  <span><strong className="text-[var(--admin-text)]">Descriptions</strong> — 2–3 honest sentences; no medical claims.</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]" />
                  <span><strong className="text-[var(--admin-text)]">Images</strong> — a clean product photo lifts click-through.</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]" />
                  <span><strong className="text-[var(--admin-text)]">Tags &amp; strain type</strong> — power search &amp; filtering.</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]" />
                  <span><strong className="text-[var(--admin-text)]">Brand link</strong> — connects the product to its brand page.</span>
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <Button href="/admin/products?gap=description" variant="save" size="sm">
                Fix missing descriptions{missingDesc > 0 ? ` (${missingDesc})` : ""} →
              </Button>
              <Button href="/admin/products?gap=image" variant="neutral" size="sm">
                Fix missing images{missingImg > 0 ? ` (${missingImg})` : ""} →
              </Button>
              <Button href="/admin/products?gap=brand" variant="neutral" size="sm">
                Fix brand links{stats.missing.brandLink > 0 ? ` (${stats.missing.brandLink})` : ""} →
              </Button>
              {isAiConfigured && (
                <Button href="/admin/products/bulk-ai" variant="neutral" size="sm">
                  ✨ Bulk-draft with AI →
                </Button>
              )}
              <Link
                href="/admin/knowledge-base"
                className="mt-0.5 text-center text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
              >
                📚 Open the Knowledge Base
              </Link>
            </div>
          </div>
        </section>

        <div>
          <BackLink
            fallback="/admin/catalog"
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        <CatalogStageStrip current="enrichment" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Products" value={stats.total} hint={`${stats.visible} visible · ${stats.hidden} hidden`} accent="muted" />
          <StatCard label="Enriched & live" value={enriched} hint={`avg ${stats.avgCompleteness}% complete`} accent="green" />
          <StatCard label="Missing description" value={missingDesc} accent="orange" href="/admin/products?gap=description" />
          <StatCard label="Missing image" value={missingImg} accent="orange" href="/admin/products?gap=image" />
        </div>

        {/* Secondary metrics: price range + brand-link gap */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Lowest price" value={fmtMoney(stats.price.minMinor)} accent="muted" />
          <StatCard label="Median price" value={fmtMoney(stats.price.medianMinor)} accent="muted" />
          <StatCard label="Highest price" value={fmtMoney(stats.price.maxMinor)} accent="muted" />
          <StatCard label="Missing brand link" value={stats.missing.brandLink} accent="orange" href="/admin/products?gap=brand" />
        </div>

        {/* What's missing + distributions */}
        <div className="grid gap-4 lg:grid-cols-2">
          <MissingInsight
            noun="product"
            subtitle="Ranked by impact"
            gaps={gapInsights}
          />
          <DistributionBars title="By category" rows={stats.byCategory} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <DistributionBars title="By strain type" rows={stats.byStrainType} />
          <DistributionBars title="By stock status" rows={stats.byStockStatus} />
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
            <option value="any">Any gap</option>
            <option value="description">Missing description</option>
            <option value="image">Missing image</option>
            <option value="brand">Missing brand link</option>
          </Select>
          <Select name="status" defaultValue={statusFilter} className="w-auto">
            <option value="">Any enrichment status</option>
            <option value="none">Never enriched</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
          <Select name="sort" defaultValue={sort} className="w-auto">
            <option value="gaps">Sort: most gaps first</option>
            <option value="name">Sort: name A–Z</option>
            <option value="brand">Sort: brand A–Z</option>
            <option value="category">Sort: category</option>
            <option value="status">Sort: enrichment status</option>
          </Select>
          <Button type="submit" variant="neutral">
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
        {!isTable && <ProductGrid cards={gridCards} hrefFor={detailHref} />}

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
                    <Link href={detailHref(g.posKey)} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
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
