/**
 * /admin/knowledge-base/brands
 *
 * BRAND FACTS enrichment (Slice 7, post-0072 unification). Brand facts now live
 * on the OPERATIONAL `brands` table (one golden record per brand), so this page
 * enriches the REAL vendor-linked brands rather than a separate KB table. Each
 * brand gets an inline form for known-for / house style / signature lines /
 * sensory notes, plus a health badge. Brands themselves are created on the
 * Vendors page; here we only enrich them (voice/facts — no medical claims).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { listBrandsWithFacts } from "@/lib/vendors/store";
import { updateBrandFactsAction } from "../actions";
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

  const brands = await listBrandsWithFacts();

  return (
    <div>
      <AdminPageHeader
        title="Brand facts"
        subtitle="Enrich each real brand so AI copy matches its voice — one golden record per brand"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Brand facts" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {brands.length} brand{brands.length === 1 ? "" : "s"}. Brands are created on the{" "}
          <Link href="/admin/vendors" className="text-[var(--admin-accent)] underline">
            Vendors page
          </Link>
          ; here you enrich each with its voice and sensory language. Keep it factual —
          describe the experience (relaxing, uplifting), never a medical claim.
        </p>

        {brands.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No brands yet. Import or add them from the{" "}
            <Link href="/admin/vendors" className="text-[var(--admin-accent)] underline">
              Vendors page
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-4">
            {brands.map((b) => {
              const sc = scoreBrand(b as unknown as Record<string, unknown>);
              return (
                <section
                  key={b.id}
                  className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <strong className="text-[var(--admin-text)]">{b.display_name}</strong>
                      <QualityBadge quality={sc.quality} grade={sc.grade} completeness={sc.completeness} />
                    </div>
                    <span className="text-xs text-[var(--admin-text-faint)]">{b.slug}</span>
                  </div>

                  <form action={updateBrandFactsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={b.id} />
                    <label className="text-sm">
                      <span className="block text-[var(--admin-text-muted)]">Known for</span>
                      <input
                        name="known_for"
                        defaultValue={b.known_for ?? ""}
                        className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]"
                        placeholder="e.g. clean live-resin vape cartridges"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-[var(--admin-text-muted)]">House style (voice)</span>
                      <input
                        name="house_style"
                        defaultValue={b.house_style ?? ""}
                        className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]"
                        placeholder="e.g. clean, modern, understated"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-[var(--admin-text-muted)]">Signature lines (comma-separated)</span>
                      <input
                        name="signature_lines"
                        defaultValue={(b.signature_lines ?? []).join(", ")}
                        className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]"
                        placeholder="e.g. Live Resin, Pax Pods"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-[var(--admin-text-muted)]">Sensory notes (comma-separated)</span>
                      <input
                        name="sensory_notes"
                        defaultValue={(b.sensory_notes ?? []).join(", ")}
                        className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]"
                        placeholder="e.g. bright, true-to-strain, smooth"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <Button type="submit" variant="save" size="sm">
                        Save brand facts
                      </Button>
                    </div>
                  </form>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
