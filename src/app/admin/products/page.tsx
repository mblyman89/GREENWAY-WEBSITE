import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { StatCard } from "@/components/admin/StatCard";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, resolveEnrichmentsForItems, computeGaps, type GapFlags } from "@/lib/enrichment/store";
import { enrichmentFollowsIdentityOn } from "@/lib/enrichment/enrichment-identity-server";
import { linkEnrichmentsToProducts, linkMenuCardsToKbAction } from "./actions";
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
  parseEnrichmentStockFilter,
  sortEnrichmentList,
  filterByEnrichmentStatus,
  filterByStock,
} from "@/lib/enrichment/match-core";
// S22 (R-ENRICH-FILTER, F-081, F-079): which delivery each card came from.
import { readEnrichmentAttribution } from "@/lib/enrichment/enrichment-manifest";
import {
  ATTRIBUTION_UNAVAILABLE_NOTE,
  MANIFEST_FILTER_LABEL,
  SINCE_DAY_CHOICES,
  applyManifestFilters,
  deliveryVendorChoices,
  hasManifestFilters,
  manifestFocusSentence,
  manifestParamValue,
  manifestPickerOptions,
  parseEnrichmentManifestParams,
  receivedFromLabel,
  sinceLabel,
} from "@/lib/enrichment/enrichment-manifest-core";

function fmtMoney(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; gap?: string; category?: string; brand?: string; stock?: string; view?: string; sort?: string; status?: string; back?: string; manifest?: string; since?: string; vendor?: string; error?: string; linked?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const { q, gap, category, view } = sp;
  const brandFilter = sp.brand ?? "";
  const sort = parseEnrichmentSort(sp.sort);
  const statusFilter = parseEnrichmentStatusFilter(sp.status);
  const stockFilter = parseEnrichmentStockFilter(sp.stock);
  // S22: ?manifest= (a delivery uuid or "cultivera"), ?since= (days), ?vendor= (uuid).
  const mf = parseEnrichmentManifestParams(sp);
  const manifestValue = manifestParamValue(mf.manifest);
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
            No published menu yet. Products you receive and approve with a price publish to the
            website and register automatically, then appear here for enrichment. If an update is
            ever held for a second look, it waits under{" "}
            <Link href="/admin/publish" className="text-[var(--admin-accent)] hover:underline">
              Admin &rarr; Publish Menu
            </Link>
            . (The one-time POS upload under Menu Imports is only for the initial Cultivera import.)
          </div>
        </div>
      </div>
    );
  }

  const items = await getVersionItems(published.id);
  const keys = items.map((i) => i.source_item_id);
  // S22: the lot -> delivery attribution runs beside the enrichment read
  // (two bounded, named-column reads; null = unavailable, filters off).
  const [ownEnrichments, attribution] = await Promise.all([
    getEnrichmentsForKeys(keys),
    readEnrichmentAttribution(items),
  ]);
  // S20: a card whose own row is absent/blank is measured against the
  // product's published record (what the live menu actually serves it), in
  // ONE extra read; flag off -> exactly the own-key map, as before.
  const { byKey: enrichments, viaIdentity } = await resolveEnrichmentsForItems(items, ownEnrichments).catch(
    () => ({ byKey: ownEnrichments, viaIdentity: new Set<string>() }),
  );
  const attrs = attribution?.attrs ?? null;
  const now = new Date();

  const gaps: GapFlags[] = items.map((i) =>
    computeGaps(i, enrichments.get(i.source_item_id) ?? null, attrs?.get(i.source_item_id) ?? null),
  );

  // Filter
  let filtered = gaps;
  if (q) {
    const ql = q.toLowerCase();
    filtered = filtered.filter((g) => g.name.toLowerCase().includes(ql) || g.brand.toLowerCase().includes(ql));
  }
  if (category) filtered = filtered.filter((g) => g.category === category);
  if (brandFilter) filtered = filtered.filter((g) => g.brand === brandFilter);
  if (gap === "description") filtered = filtered.filter((g) => !g.hasDescription);
  else if (gap === "image") filtered = filtered.filter((g) => !g.hasImage);
  else if (gap === "brand") filtered = filtered.filter((g) => !g.hasBrandLink);
  else if (gap === "tags") filtered = filtered.filter((g) => !g.hasTags);
  else if (gap === "any") filtered = filtered.filter((g) => !g.hasDescription || !g.hasImage || !g.hasBrandLink || !g.hasTags);
  filtered = filterByEnrichmentStatus(filtered, statusFilter);
  filtered = filterByStock(filtered, stockFilter);
  // S22: invoice/manifest, received-since and vendor filters (pure).
  const manifestFiltered = applyManifestFilters(filtered, mf, attrs, now);
  filtered = manifestFiltered.rows;
  filtered = sortEnrichmentList(filtered, sort);
  const pickerOptions = attrs && attribution ? manifestPickerOptions(attribution.manifests, attrs, now, mf.manifest) : [];
  const focusSentence = manifestFiltered.applied ? manifestFocusSentence(mf.manifest, pickerOptions) : null;
  // Vendor choices: every vendor on a delivery with live cards (no extra read).
  const vendorChoices = attribution ? deliveryVendorChoices(attribution.manifests, pickerOptions) : [];

  const missingDesc = gaps.filter((g) => !g.hasDescription).length;
  // S23: of those, how many only carry the house placeholder sentence (they
  // used to count as "described").
  const placeholderDesc = gaps.filter((g) => g.descriptionPlaceholder === true).length;
  const missingImg = gaps.filter((g) => !g.hasImage).length;
  const missingTags = gaps.filter((g) => !g.hasTags).length;
  const enriched = gaps.filter((g) => g.enrichmentStatus === "published").length;
  const categories = Array.from(new Set(gaps.map((g) => g.category))).sort();
  const brandOptions = Array.from(new Set(gaps.map((g) => g.brand).filter(Boolean))).sort();

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
      // S23: the copy is only the placeholder sentence.
      descriptionPlaceholder: g.descriptionPlaceholder === true,
      hasImage: g.hasImage,
      hasBrandLink: g.hasBrandLink,
      enrichmentStatus: g.enrichmentStatus,
      thumbnailUrl: id ? thumbMap.get(id) ?? null : null,
      // S22: "From <delivery>" line (only when attribution was read).
      receivedFrom: attrs ? receivedFromLabel(attrs.get(g.posKey) ?? null, now) : null,
      // S20: served from the product's record (an earlier lot), not its own.
      viaProduct: viaIdentity.has(g.posKey),
    };
  });

  const baseQs = new URLSearchParams();
  if (q) baseQs.set("q", q);
  if (category) baseQs.set("category", category);
  if (brandFilter) baseQs.set("brand", brandFilter);
  if (gap) baseQs.set("gap", gap);
  if (sp.sort) baseQs.set("sort", sort);
  if (statusFilter) baseQs.set("status", statusFilter);
  if (stockFilter) baseQs.set("stock", stockFilter);
  if (manifestValue) baseQs.set("manifest", manifestValue);
  if (mf.sinceDays !== null) baseQs.set("since", String(mf.sinceDays));
  if (mf.vendorId) baseQs.set("vendor", mf.vendorId);
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
        {/* S31: every product action (Cultivera-imported products included)
            redirects here with ?error= when it cannot run; the page used to
            drop it, so a failed fix looked like nothing happened. Same
            treatment as the product detail page's error line. */}
        {sp.error && (
          <div role="alert" className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            {sp.error}
          </div>
        )}
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
            {/* SLICE 75 fix: these buttons filter THIS page, but the results
                live several screens down and the filter dropdowns (uncontrolled
                defaultValue) didn't visually update on same-page navigation —
                so they looked dead. Every gap link now jumps straight to the
                filtered #worklist, and the filter form remounts (key) so the
                dropdowns always show the active filter. */}
            <div className="flex flex-col gap-2">
              <Button href="/admin/products?gap=description#worklist" variant="save" size="sm">
                Fix missing descriptions{missingDesc > 0 ? ` (${missingDesc})` : ""} →
              </Button>
              <Button href="/admin/products?gap=image#worklist" variant="neutral" size="sm">
                Fix missing images{missingImg > 0 ? ` (${missingImg})` : ""} →
              </Button>
              <Button href="/admin/products?gap=brand#worklist" variant="neutral" size="sm">
                Fix brand links{stats.missing.brandLink > 0 ? ` (${stats.missing.brandLink})` : ""} →
              </Button>
              <Button href="/admin/products?gap=tags#worklist" variant="neutral" size="sm">
                Fix missing tags{missingTags > 0 ? ` (${missingTags})` : ""} →
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
          <StatCard
            label="Missing description"
            value={missingDesc}
            hint={placeholderDesc > 0 ? `${placeholderDesc} only have the placeholder sentence` : undefined}
            accent="orange"
            href="/admin/products?gap=description#worklist"
          />
          <StatCard label="Missing image" value={missingImg} accent="orange" href="/admin/products?gap=image#worklist" />
        </div>

        {/* Secondary metrics: price range + brand-link gap */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Lowest price" value={fmtMoney(stats.price.minMinor)} accent="muted" />
          <StatCard label="Median price" value={fmtMoney(stats.price.medianMinor)} accent="muted" />
          <StatCard label="Highest price" value={fmtMoney(stats.price.maxMinor)} accent="muted" />
          <StatCard label="Missing brand link" value={stats.missing.brandLink} accent="orange" href="/admin/products?gap=brand#worklist" />
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

        {/* Filters. SLICE 75: #worklist is the jump target for the helper
            buttons up top; the key remounts the form whenever the URL filters
            change so the UNCONTROLLED dropdowns (defaultValue) always show the
            filter a link just applied. */}
        <form
          id="worklist"
          key={`${q ?? ""}|${category ?? ""}|${brandFilter}|${gap ?? ""}|${statusFilter}|${stockFilter}|${sort}|${manifestValue}|${mf.sinceDays ?? ""}|${mf.vendorId ?? ""}`}
          className="scroll-mt-24 flex flex-wrap items-center gap-3"
          method="get"
        >
          {/* S22 (bible S22.4): the invoice/manifest picker, S14's label. */}
          {pickerOptions.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--admin-text-faint)]">
              <span>{MANIFEST_FILTER_LABEL}</span>
              <Select name="manifest" defaultValue={manifestValue} className="w-72 text-xs" aria-label="From invoice/manifest">
                <option value="">Every invoice/manifest</option>
                {pickerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {attrs && (
            <Select name="since" defaultValue={mf.sinceDays !== null ? String(mf.sinceDays) : ""} className="w-auto" aria-label="Received">
              <option value="">Received any time</option>
              {SINCE_DAY_CHOICES.map((d) => (
                <option key={d} value={String(d)}>
                  {sinceLabel(d)}
                </option>
              ))}
            </Select>
          )}
          {vendorChoices.length > 0 && (
            <Select name="vendor" defaultValue={mf.vendorId ?? ""} className="w-auto" aria-label="Delivery vendor">
              <option value="">Any delivery vendor</option>
              {vendorChoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
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
          {/* SLICE 72 — brand filter (values come from the live menu). */}
          <Select name="brand" defaultValue={brandFilter} className="w-auto">
            <option value="">All brands</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <Select name="gap" defaultValue={gap ?? ""} className="w-auto">
            <option value="">All products</option>
            <option value="any">Any gap</option>
            <option value="description">Missing description</option>
            <option value="image">Missing image</option>
            <option value="brand">Missing brand link</option>
            <option value="tags">Missing tags</option>
          </Select>
          <Select name="status" defaultValue={statusFilter} className="w-auto">
            <option value="">Any enrichment status</option>
            <option value="none">Never enriched</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
          {/* SLICE 72 — stock filter: fix what shoppers can BUY first. */}
          <Select name="stock" defaultValue={stockFilter} className="w-auto">
            <option value="">Any stock</option>
            <option value="in-stock">In stock</option>
            <option value="low-stock">Low stock</option>
            <option value="unavailable">Sold out</option>
          </Select>
          <Select name="sort" defaultValue={sort} className="w-auto">
            <option value="gaps">Sort: most gaps first</option>
            <option value="priority">Sort: smart priority (sellable + broken first)</option>
            <option value="name">Sort: name A–Z</option>
            <option value="brand">Sort: brand A–Z</option>
            <option value="category">Sort: category</option>
            <option value="status">Sort: enrichment status</option>
            <option value="priceHigh">Sort: price high → low</option>
            <option value="priceLow">Sort: price low → high</option>
            <option value="newest">Sort: newest from receiving</option>
          </Select>
          <Button type="submit" variant="neutral">
            Filter
          </Button>
          {(q || category || brandFilter || gap || statusFilter || stockFilter || hasManifestFilters(mf)) && (
            <Link
              href={view ? `/admin/products?view=${view}` : "/admin/products"}
              className="text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            >
              ✕ Clear filters
            </Link>
          )}
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

        {/* S20: enrichment follows the PRODUCT, not the lot. One button links
            existing records to their product so every future lot of the same
            product is served the copy and photo already written. */}
        {sp.linked && (
          <div role="status" className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            {sp.linked}
          </div>
        )}
        <form
          action={linkEnrichmentsToProducts}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3"
        >
          <p className="max-w-3xl text-sm text-[var(--admin-text-muted)]">
            <span className="font-bold text-[var(--admin-text)]">Product records follow the product:</span> a new lot of
            a product you already enriched uses that copy and photo automatically
            {enrichmentFollowsIdentityOn() ? "" : " (currently switched off on this server)"}. Link your existing
            records once so older work is found too; it only fills blank links and is safe to run again.
            {viaIdentity.size > 0 ? ` ${viaIdentity.size} card${viaIdentity.size === 1 ? " is" : "s are"} using a product record right now.` : ""}
          </p>
          <Button type="submit" variant="neutral" size="sm">
            Link records to products
          </Button>
        </form>

        {/* R25 C: the menu card linked to its knowledge-base product. New
            menus link themselves as they are built; this catches up the cards
            already live. */}
        <form
          action={linkMenuCardsToKbAction}
          data-testid="link-menu-cards-kb"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3"
        >
          <p className="max-w-3xl text-sm text-[var(--admin-text-muted)]">
            <span className="font-bold text-[var(--admin-text)]">Menu cards linked to the knowledge base:</span> when
            you approve a product, its lot is linked to its knowledge-base product, and every menu built after that
            carries the link. Press once to link the cards that are already live. It only fills blank links, never
            guesses (a card whose lots point at two different products is left for you), and is safe to run again.
          </p>
          <Button type="submit" variant="neutral" size="sm">
            Link menu cards to the KB
          </Button>
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

        {/* S22: which delivery you're looking at, or why the filter is off. */}
        {focusSentence && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
            data-testid="enrich-manifest-focus"
          >
            <span>{focusSentence}</span>
            <Link href={view ? `/admin/products?view=${view}` : "/admin/products"} className="font-semibold underline">
              Show every product
            </Link>
          </div>
        )}
        {!manifestFiltered.applied && (
          <div
            className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]"
            data-testid="enrich-manifest-unavailable"
          >
            {ATTRIBUTION_UNAVAILABLE_NOTE}
          </div>
        )}

        {/* SLICE 72 — honest result count so filtering feels responsive. */}
        <p className="text-xs text-[var(--admin-text-faint)]">
          Showing <span className="font-semibold text-[var(--admin-text-muted)]">{Math.min(filtered.length, 300)}</span> of{" "}
          <span className="font-semibold text-[var(--admin-text-muted)]">{filtered.length}</span> matching products
          {filtered.length !== gaps.length ? ` (${gaps.length} total on the live menu)` : ""}.
        </p>

        {/* Visual grid (default) */}
        {!isTable && <ProductGrid cards={gridCards} hrefFor={detailHref} />}
        {!isTable && filtered.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No products match your filter"
            description="Try clearing the search box or choosing a different category, brand, gap, or stock filter."
          />
        )}

        {/* Table (power-user view) */}
        {isTable && (
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">From delivery</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-center">Stock</th>
                <th className="px-4 py-3 text-center">Desc</th>
                <th className="px-4 py-3 text-center">Image</th>
                <th className="px-4 py-3 text-center">Brand link</th>
                <th className="px-4 py-3 text-center">Tags</th>
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
                    {viaIdentity.has(g.posKey) && (
                      <span
                        className="ml-2 text-[0.65rem] text-[var(--admin-accent)]/80"
                        title="No enrichment of its own yet: the published record of the same product (an earlier lot) serves this card."
                      >
                        uses product record
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">{g.brand || "—"}</td>
                  <td className="px-4 py-3 text-[var(--admin-text-faint)]">{g.category}</td>
                  <td className="px-4 py-3 text-xs text-[var(--admin-text-faint)]">
                    {receivedFromLabel(attrs?.get(g.posKey) ?? null, now)}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{fmtMoney(g.priceMinorUnits)}</td>
                  <td className="px-4 py-3 text-center">
                    {g.inventoryStatus === "in-stock" ? (
                      <span className="text-[var(--admin-accent)]">●</span>
                    ) : g.inventoryStatus === "low-stock" ? (
                      <span className="text-[var(--admin-gold)]">●</span>
                    ) : (
                      <span className="text-[var(--admin-text-faint)]">○</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.hasDescription ? (
                      "✅"
                    ) : g.descriptionPlaceholder ? (
                      <span className="text-[var(--admin-orange)]" title="Only the placeholder sentence - no real description yet">
                        placeholder
                      </span>
                    ) : (
                      <span className="text-[var(--admin-orange)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{g.hasImage ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasBrandLink ? "✅" : <span className="text-[var(--admin-text-faint)]">—</span>}</td>
                  <td className="px-4 py-3 text-center">{g.hasTags ? "✅" : <span className="text-[var(--admin-text-faint)]">—</span>}</td>
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
