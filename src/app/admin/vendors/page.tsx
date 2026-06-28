import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listVendors, vendorLogoUrls } from "@/lib/vendors/store";
import { vendorCompleteness } from "@/lib/vendors/completeness";
import { CompletenessMeter } from "@/components/admin/vendors/CompletenessMeter";

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
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet. Add the env vars from
            <code className="mx-1 rounded bg-black/40 px-1">docs/BACK_OFFICE_SETUP.md</code>.
          </div>
        </div>
      </div>
    );
  }

  const all = await listVendors(status ? { status } : undefined);
  const filtered = q
    ? all.filter((v) => v.display_name.toLowerCase().includes(q.toLowerCase()))
    : all;
  const logos = await vendorLogoUrls(filtered);

  const publishedCount = all.filter((v) => v.status === "published").length;

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
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total vendors" value={all.length} accent="muted" />
          <StatCard label="Published" value={publishedCount} accent="green" />
          <StatCard label="Drafts" value={all.length - publishedCount} accent="orange" />
        </div>

        {all.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-sm text-white/60">
            No vendors yet. Run <code className="rounded bg-black/40 px-1">npm run seed:vendors</code> to import the
            105 vendors + 168 brands from the folder database, or ask SuperNinja to run the seed for you.
          </div>
        )}

        {/* Filters */}
        {all.length > 0 && (
          <form className="flex flex-wrap items-center gap-3" method="get">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search vendors…"
              className="flex-1 min-w-48 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
            <select
              name="status"
              defaultValue={status ?? ""}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <button type="submit" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[#7ed957] hover:text-white">
              Filter
            </button>
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
                className="group flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4 transition hover:border-[#7ed957]/50"
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
