/**
 * /admin/knowledge-base/terpenes
 *
 * READ-ONLY terpene reference (Slice 7a → enriched in 8a). The owner does not
 * edit terpenes — there is a fixed reference set — but seeing each one's full
 * aroma/flavor profile is useful when curating strain and product copy.
 *
 * 8a: the standalone detail page was removed. Every terpene now shows its FULL
 * profile inside its own card (aroma, flavor, "also found in"), tinted with its
 * terpene-wheel color so the reference reads at a glance. Degrades to a
 * pre-migration notice if kb_terpenes is empty.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbTerpenesFull } from "@/lib/ai/kb/store";
import { terpeneColor } from "@/lib/ai/kb/terpene-colors";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

function Chips({ items, dotColor }: { items: string[]; dotColor: string }) {
  if (!items.length) {
    return <span className="text-xs text-[var(--admin-text-faint)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-1 text-sm text-[var(--admin-text)]"
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: dotColor }}
          />
          {it}
        </span>
      ))}
    </div>
  );
}

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
          knowledge base. Each is tinted by its aroma family on the terpene wheel.
        </p>

        {terpenes.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No terpenes loaded yet. Load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/library" className="text-[var(--admin-accent)] underline">
              Strains &amp; categories → Setup
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {terpenes.map((t) => {
              const c = terpeneColor(t.slug);
              return (
                <div
                  key={t.id}
                  className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
                  style={{ background: c.soft }}
                >
                  {/* Color header bar */}
                  <div
                    className="flex items-center justify-between gap-2 px-5 py-3.5"
                    style={{ background: c.color }}
                  >
                    <span className="text-xl font-bold text-white drop-shadow-sm">
                      {t.name}
                    </span>
                    <span className="rounded-full bg-white/25 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                      {c.family}
                    </span>
                  </div>

                  <div className="space-y-4 p-5">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        Aroma
                      </h3>
                      <div className="mt-2">
                        <Chips items={t.aroma_notes} dotColor={c.color} />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        Flavor
                      </h3>
                      <div className="mt-2">
                        <Chips items={t.flavor_notes} dotColor={c.color} />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        Also found in
                      </h3>
                      <p className="mt-1.5 text-base text-[var(--admin-text)]">
                        {t.also_found_in ? (
                          t.also_found_in
                        ) : (
                          <span className="text-[var(--admin-text-faint)]">—</span>
                        )}
                      </p>
                    </div>
                    {!t.active ? (
                      <span className="inline-block text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                        inactive
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-[var(--admin-text-faint)]">
          Colors reflect each terpene&apos;s dominant aroma family on the terpene wheel —
          botanical/sensory reference only, not a health or medical claim.
        </p>
      </div>
    </div>
  );
}
