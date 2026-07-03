/**
 * /admin/knowledge-base/terpenes
 *
 * READ-ONLY terpene reference (Slice 7a). The owner does not edit terpenes —
 * there is a fixed reference set already loaded — but seeing their aroma/flavor
 * profiles is useful when curating strain and product copy. Each row links to a
 * detail page. Degrades to a pre-migration notice if kb_terpenes is empty.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbTerpenesFull } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

export default async function KbTerpenesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const terpenes = await listKbTerpenesFull();

  return (
    <div>
      <AdminPageHeader
        title="Terpenes"
        subtitle="The aroma & flavor map used to describe every strain — reference only"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Terpenes" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {terpenes.length} terpene{terpenes.length === 1 ? "" : "s"} in the reference
          set. These are read-only — they power the aroma/flavor language across the
          knowledge base. Click any terpene to see its full profile.
        </p>

        {terpenes.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No terpenes loaded yet. Load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {terpenes.map((t) => (
              <Link
                key={t.id}
                href={`/admin/knowledge-base/terpenes/${t.slug}`}
                className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 transition-colors hover:border-[var(--admin-accent)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--admin-text)]">{t.name}</span>
                  {!t.active ? (
                    <span className="text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                      inactive
                    </span>
                  ) : null}
                </div>
                {t.aroma_notes.length ? (
                  <div className="mt-1.5 text-xs text-[var(--admin-text-muted)]">
                    {t.aroma_notes.slice(0, 4).join(" · ")}
                  </div>
                ) : (
                  <div className="mt-1.5 text-xs text-[var(--admin-text-faint)]">No aroma notes</div>
                )}
                <span className="mt-2 block text-[11px] font-medium text-[var(--admin-accent)] opacity-0 transition-opacity group-hover:opacity-100">
                  View profile →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
