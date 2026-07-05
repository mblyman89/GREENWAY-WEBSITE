import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button } from "@/components/admin/ui";
import { listVendors, vendorLogoUrls, vendorInventoryFacts } from "@/lib/vendors/store";
import { vendorCompleteness } from "@/lib/vendors/completeness";
import { CompletenessMeter } from "@/components/admin/vendors/CompletenessMeter";
import { computeVendorStats, vendorGapInsights } from "@/lib/insight/vendors";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

type Params = {
  q?: string;
  status?: string;
  scope?: string; // "mine" | ""
  active?: string; // "true" | "false" | ""
  license?: string; // "has" | "missing" | ""
  itype?: string; // inventory_type filter
  icat?: string; // inventory category filter
  page?: string;
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requirePermission("vendors.manage");
  const sp = await searchParams;
  const { q, status, scope, active, license, itype, icat } = sp;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Vendors & Brands" subtitle="Manage vendor profiles, logos, and brands." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator
            finishes the one-time setup, vendors and brands will appear here.
          </div>
        </div>
      </div>
    );
  }

  // Full vendor set (paged past the 1000-row PostgREST cap) + inventory facts.
  const [all, inv] = await Promise.all([listVendors(), vendorInventoryFacts()]);

  // ── Apply filters (server-rendered, URL-driven) ────────────────────────────
  let filtered = all;
  if (status) filtered = filtered.filter((v) => v.status === status);
  if (active === "true") filtered = filtered.filter((v) => v.is_active === true);
  if (active === "false") filtered = filtered.filter((v) => v.is_active === false);
  if (license === "has") filtered = filtered.filter((v) => Boolean(v.license_number));
  if (license === "missing") filtered = filtered.filter((v) => !v.license_number);
  if (scope === "mine") filtered = filtered.filter((v) => inv.vendorIds.has(v.id));
  if (itype) filtered = filtered.filter((v) => inv.typesByVendor.get(v.id)?.has(itype));
  if (icat) filtered = filtered.filter((v) => inv.categoriesByVendor.get(v.id)?.has(icat));
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter(
      (v) =>
        v.display_name.toLowerCase().includes(needle) ||
        (v.dba ?? "").toLowerCase().includes(needle) ||
        (v.license_number ?? "").toLowerCase().includes(needle),
    );
  }

  // ── UI pagination (60 cards/page keeps 1,775 vendors fast) ────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  // Logos only for the visible page (fast); stats on the FULL set.
  const logos = await vendorLogoUrls(visible);
  const allLogos = await vendorLogoUrls(all.filter((v) => v.logo_media_id));

  const publishedCount = all.filter((v) => v.status === "published").length;
  const stats = computeVendorStats(all, (id) => Boolean(allLogos.get(id)));
  const gapInsights = vendorGapInsights(stats);

  /** Preserve current filters in pagination links. */
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (scope) params.set("scope", scope);
    if (active) params.set("active", active);
    if (license) params.set("license", license);
    if (itype) params.set("itype", itype);
    if (icat) params.set("icat", icat);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/vendors${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Vendors & Brands"
        subtitle="Build out vendor profiles — logo, mission, contact — then publish them to the public vendors page."
        breadcrumbs={<Breadcrumbs items={[{ label: "Vendors & Brands" }]} />}
        help={
          <HelpPanel
            id="vendors"
            title="How vendor profiles work"
            steps={[
              "Filter to “My vendors” to see suppliers you actually stock.",
              "Open a vendor or brand.",
              "Add a logo, short mission, and contact details.",
              "Publish so it appears on your vendors page.",
            ]}
          >
            <p>
              The directory holds every licensed vendor in the state. “My
              vendors” narrows it to suppliers with product in your inventory,
              and the type/category filters find vendors by what they supply.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Import action — bring vendors/brands in from a Cultivera export. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--admin-text-faint)]">
            Import your vendor or brand list from a spreadsheet export.
          </p>
          <Link
            href="/admin/vendors/import"
            className="inline-flex items-center gap-2 rounded-[var(--admin-radius)] bg-[var(--admin-orange)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110"
          >
            <span aria-hidden>⬆️</span> Import vendors &amp; brands
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total vendors" value={all.length} hint={`${stats.totalBrands} brands · ${stats.totalProducts} products`} accent="muted" />
          <StatCard label="My vendors" value={inv.vendorIds.size} hint="have product in inventory" accent="green" />
          <StatCard label="Published" value={publishedCount} hint={`${all.length - publishedCount} drafts`} accent="orange" />
          <StatCard label="Avg completeness" value={`${stats.avgCompleteness}%`} hint={`${stats.missing.logo} missing a logo`} accent={stats.avgCompleteness >= 70 ? "green" : "gold"} />
        </div>

        {/* What's missing across all vendor profiles */}
        {all.length > 0 && (
          <MissingInsight
            noun="vendor"
            subtitle="Ranked by impact"
            gaps={gapInsights}
          />
        )}

        {all.length === 0 && (
          <EmptyState
            icon="🏷️"
            title="No vendors yet"
            description="Import vendors from a spreadsheet export, or run “npm run seed:vendors:cultivera” to load the statewide Cultivera vendor list."
          />
        )}

        {/* Filters */}
        {all.length > 0 && (
          <form className="flex flex-wrap items-center gap-3" method="get">
            <div className="min-w-48 flex-1">
              <Input name="q" defaultValue={q ?? ""} placeholder="Search name, DBA, or license…" />
            </div>
            <Select name="scope" defaultValue={scope ?? ""} aria-label="Scope">
              <option value="">All vendors</option>
              <option value="mine">My vendors (in inventory)</option>
            </Select>
            <Select name="status" defaultValue={status ?? ""} aria-label="Status">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Select>
            <Select name="active" defaultValue={active ?? ""} aria-label="Active">
              <option value="">Active &amp; inactive</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
            <Select name="license" defaultValue={license ?? ""} aria-label="License">
              <option value="">Any license</option>
              <option value="has">Has license #</option>
              <option value="missing">Missing license #</option>
            </Select>
            {inv.inventoryTypes.length > 0 && (
              <Select name="itype" defaultValue={itype ?? ""} aria-label="Inventory type">
                <option value="">All product types</option>
                {inv.inventoryTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            )}
            {inv.categories.length > 0 && (
              <Select name="icat" defaultValue={icat ?? ""} aria-label="Inventory category">
                <option value="">All categories</option>
                {inv.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            )}
            <Button type="submit" variant="neutral">Filter</Button>
            {(q || status || scope || active || license || itype || icat) && (
              <Link href="/admin/vendors" className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
                Clear
              </Link>
            )}
          </form>
        )}

        {/* Inventory-driven filters explainer when inventory is empty */}
        {all.length > 0 && inv.vendorIds.size === 0 && (
          <p className="text-xs text-white/40">
            “My vendors” and the product type/category filters activate
            automatically once inventory lots are received — they read what each
            vendor actually supplies you.
          </p>
        )}

        {/* Result count + pagination (top) */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/50">
            <span>
              Showing <span className="font-semibold text-white">{start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)}</span> of{" "}
              <span className="font-semibold text-white">{filtered.length}</span> vendor{filtered.length === 1 ? "" : "s"}
            </span>
            {totalPages > 1 && (
              <span className="flex items-center gap-2">
                {safePage > 1 ? (
                  <Link href={pageHref(safePage - 1)} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10">← Prev</Link>
                ) : (
                  <span className="rounded border border-white/5 px-2 py-1 text-white/20">← Prev</span>
                )}
                <span>Page {safePage} / {totalPages}</span>
                {safePage < totalPages ? (
                  <Link href={pageHref(safePage + 1)} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10">Next →</Link>
                ) : (
                  <span className="rounded border border-white/5 px-2 py-1 text-white/20">Next →</span>
                )}
              </span>
            )}
          </div>
        )}

        {/* Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((v) => {
            const logo = logos.get(v.id);
            const completeness = vendorCompleteness(v, Boolean(logo));
            const mine = inv.vendorIds.has(v.id);
            return (
              <Link
                key={v.id}
                href={`/admin/vendors/${v.id}`}
                className="admin-card-interactive group flex flex-col gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-lg font-bold text-white/30">{v.display_name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white group-hover:text-[#7ed957]">{v.display_name}</p>
                    <p className="truncate text-xs text-white/40">
                      {v.license_number ? `Lic ${v.license_number} · ` : ""}
                      {v.brand_count} brand{v.brand_count === 1 ? "" : "s"} · {v.product_count} products
                    </p>
                  </div>
                  <span className="flex flex-col items-end gap-1">
                    {mine && (
                      <span className="rounded bg-[#7ed957]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#7ed957]">Mine</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${v.status === "published" ? "bg-[#7ed957]/15 text-[#7ed957]" : "bg-white/10 text-white/50"}`}>
                      {v.status}
                    </span>
                  </span>
                </div>
                <CompletenessMeter result={completeness} variant="compact" />
                {completeness.nextUp && (
                  <p className="text-[10px] text-white/40">
                    Next: add {completeness.nextUp.label.toLowerCase()}
                  </p>
                )}
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && all.length > 0 && (
          <p className="text-sm text-white/50">
            No vendors match your filter.{scope === "mine" && inv.vendorIds.size === 0 ? " (You have no inventory lots yet — “My vendors” will populate as product is received.)" : ""}
          </p>
        )}

        {/* Pagination (bottom) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-xs text-white/50">
            {safePage > 1 ? (
              <Link href={pageHref(safePage - 1)} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10">← Prev</Link>
            ) : (
              <span className="rounded border border-white/5 px-2 py-1 text-white/20">← Prev</span>
            )}
            <span>Page {safePage} / {totalPages}</span>
            {safePage < totalPages ? (
              <Link href={pageHref(safePage + 1)} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10">Next →</Link>
            ) : (
              <span className="rounded border border-white/5 px-2 py-1 text-white/20">Next →</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
