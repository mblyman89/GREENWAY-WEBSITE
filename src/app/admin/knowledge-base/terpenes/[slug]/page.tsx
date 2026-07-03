/**
 * /admin/knowledge-base/terpenes/[slug]
 *
 * READ-ONLY terpene detail (Slice 7a). Shows the full aroma/flavor profile and
 * botanical "also found in" note (kept non-medical per compliance). No editing.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { getKbTerpeneBySlug } from "@/lib/ai/kb/store";

export const dynamic = "force-dynamic";

function Chips({ items }: { items: string[] }) {
  if (!items.length) {
    return <span className="text-sm text-[var(--admin-text-faint)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it}
          className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2.5 py-0.5 text-xs text-[var(--admin-text)]"
        >
          {it}
        </span>
      ))}
    </div>
  );
}

export default async function KbTerpeneDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requirePermission("products.enrich");
  const { slug } = await params;
  const terpene = await getKbTerpeneBySlug(slug);
  if (!terpene) notFound();

  return (
    <div>
      <AdminPageHeader
        title={terpene.name}
        subtitle="Terpene profile — reference only"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Terpenes", href: "/admin/knowledge-base/terpenes" },
              { label: terpene.name },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Aroma notes
            </h3>
            <div className="mt-2">
              <Chips items={terpene.aroma_notes} />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Flavor notes
            </h3>
            <div className="mt-2">
              <Chips items={terpene.flavor_notes} />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Also found in
            </h3>
            <p className="mt-1 text-sm text-[var(--admin-text)]">
              {terpene.also_found_in ? (
                terpene.also_found_in
              ) : (
                <span className="text-[var(--admin-text-faint)]">—</span>
              )}
            </p>
            <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
              Botanical reference only — not a health or medical claim.
            </p>
          </div>
        </div>

        <Link
          href="/admin/knowledge-base/terpenes"
          className="inline-block text-sm text-[var(--admin-accent)] underline"
        >
          ← All terpenes
        </Link>
      </div>
    </div>
  );
}
