import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button } from "@/components/admin/ui";
import { listVendors, vendorLogoUrls } from "@/lib/vendors/store";
import { vendorCompleteness } from "@/lib/vendors/completeness";
import { CompletenessMeter } from "@/components/admin/vendors/CompletenessMeter";
import { computeVendorStats, vendorGapInsights } from "@/lib/insight/vendors";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { q, status } = await searchParams;

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

  const all = await listVendors(status ? { status } : undefined);
  const filtered = q
    ? all.filter((v) => v.display_name.toLowerCase().includes(q.toLowerCase()))
    : all;
  // Resolve logos for ALL vendors so aggregate insight is accurate, not just the filtered view.
  const logos = await vendorLogoUrls(all);

  const publishedCount = all.filter((v) => v.status === "published").length;

  // Slice 1 — aggregate insight across all vendors (read-only).
  const stats = computeVendorStats(all, (id) => Boolean(logos.get(id)));
  const gapInsights = vendorGapInsights(stats);

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
              "Open a vendor or brand.",
              "Add a logo, short mission, and contact details.",
              "Preview the public card.",
              "Publish so it appears on your vendors page.",
            ]}
          >
            <p>
              Complete profiles make your vendors page look professional. A
              completeness meter shows what&apos;s still missing for each one.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total vendors" value={all.length} hint={`${stats.totalBrands} brands · ${stats.totalProducts} products`} accent="muted" />
          <StatCard label="Published" value={publishedCount} accent="green" />
          <StatCard label="Drafts" value={all.length - publishedCount} accent="orange" />
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
            description="Run “npm run seed:vendors” to import the 105 vendors + 168 brands from the folder database, or ask SuperNinja to run the seed for you."
          />
        )}

        {/* Filters */}
        {all.length > 0 && (
          <form className="flex flex-wrap items-center gap-3" method="get">
            <div className="min-w-48 flex-1">
              <Input name="q" defaultValue={q ?? ""} placeholder="Search vendors…" />
            </div>
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Select>
            <Button type="submit" variant="neutral">Filter</Button>
          </form>
        )}

        {/* Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => {
            const logo = logos.get(v.id);
            const completeness = vendorCompleteness(v, Boolean(logo));
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
                    <p className="text-xs text-white/40">
                      {v.brand_count} brand{v.brand_count === 1 ? "" : "s"} · {v.product_count} products
                    </p>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${v.status === "published" ? "bg-[#7ed957]/15 text-[#7ed957]" : "bg-white/10 text-white/50"}`}>
                    {v.status}
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
          <p className="text-sm text-white/50">No vendors match your filter.</p>
        )}
      </div>
    </div>
  );
}
