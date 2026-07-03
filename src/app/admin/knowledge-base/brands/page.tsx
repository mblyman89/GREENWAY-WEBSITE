import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { getKbCounts, listKbBrands } from "@/lib/ai/kb/store";
import { upsertBrandAction } from "../actions";
import { KbFlash } from "../KbFlash";
import { scoreBrand } from "@/lib/ai/kb/quality";
import { QualityBadge } from "../QualityBadge";

export const dynamic = "force-dynamic";

export default async function KbBrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [counts, brands] = await Promise.all([getKbCounts(), listKbBrands(500)]);

  return (
    <div>
      <AdminPageHeader
        title="Brand facts"
        subtitle="What each brand is known for, so AI copy matches their voice and style"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Brands" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">
            Add / update a brand ({counts.brands})
          </h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Tell the AI what each brand is known for, so it can write copy that matches their style.
          </p>
          <form action={upsertBrandAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Brand name</span>
              <input name="name" required className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. Avitas" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Known for</span>
              <input name="known_for" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. clean live-resin vape cartridges" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">House style (voice)</span>
              <input name="house_style" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. clean, modern, understated" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Sensory notes (comma-separated)</span>
              <input name="sensory_notes" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. bright, true-to-strain, smooth" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="neutral" disabled={!counts.migrated}>Save brand facts</Button>
            </div>
          </form>

          {brands.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Brand</th>
                    <th className="py-2 pr-4 font-medium">Health</th>
                    <th className="py-2 pr-4 font-medium">Known for</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => {
                    const sc = scoreBrand(b as unknown as Record<string, unknown>);
                    return (
                      <tr key={b.id} className="border-t border-[var(--admin-border)]">
                        <td className="py-2 pr-4 text-[var(--admin-text)]">{b.name}</td>
                        <td className="py-2 pr-4">
                          <QualityBadge quality={sc.quality} grade={sc.grade} completeness={sc.completeness} />
                        </td>
                        <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.known_for ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
