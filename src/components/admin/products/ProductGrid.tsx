import Link from "next/link";

/**
 * ProductGrid — visual, thumbnail-first product catalog for the enrichment
 * workflow (UX-4). Each card shows the product image (or a tasteful
 * placeholder), name, brand, category, a status pill, and gap badges that make
 * it obvious at a glance what's missing (description / image / brand link).
 *
 * Server component: pure presentation over the gap data the page already
 * computes. Clicking a card opens the existing per-product editor.
 */
export type ProductGridCard = {
  posKey: string;
  name: string;
  brand: string;
  category: string;
  hasDescription: boolean;
  hasImage: boolean;
  hasBrandLink: boolean;
  enrichmentStatus: string | null;
  thumbnailUrl: string | null;
};

function StatusPill({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    published: "bg-[#7ed957]/15 text-[#7ed957] border-[#7ed957]/30",
    draft: "bg-[#ff7f00]/15 text-[#ff7f00] border-[#ff7f00]/30",
    archived: "bg-white/10 text-white/40 border-white/15",
  };
  const cls = (status && map[status]) || "bg-white/10 text-white/45 border-white/15";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${cls}`}>
      {status ?? "none"}
    </span>
  );
}

function GapBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold ${
        ok ? "bg-[#7ed957]/10 text-[#7ed957]/80" : "bg-[#ff7f00]/15 text-[#ff7f00]"
      }`}
      title={ok ? `${label}: done` : `${label}: missing`}
    >
      {ok ? "✓" : "○"} {label}
    </span>
  );
}

export function ProductGrid({ cards }: { cards: ProductGridCard[] }) {
  if (cards.length === 0) {
    return <p className="text-sm text-white/50">No products match your filter.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {cards.map((c) => (
        <Link
          key={c.posKey}
          href={`/admin/products/${encodeURIComponent(c.posKey)}`}
          className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] transition hover:border-[#7ed957]/50 hover:bg-white/[0.03]"
        >
          <div className="relative aspect-square overflow-hidden bg-zinc-900">
            {c.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.thumbnailUrl}
                alt={c.name}
                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/25">
                <span className="text-2xl">🌿</span>
                <span className="text-[0.65rem] uppercase tracking-wide text-[#ff7f00]">No photo</span>
              </div>
            )}
            <div className="absolute right-2 top-2">
              <StatusPill status={c.enrichmentStatus} />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div>
              <p className="line-clamp-2 text-sm font-semibold leading-tight text-white group-hover:text-[#7ed957]">
                {c.name}
              </p>
              <p className="mt-0.5 text-[0.7rem] text-white/45">
                {c.brand || "No brand"} · {c.category}
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-1">
              <GapBadge ok={c.hasImage} label="Photo" />
              <GapBadge ok={c.hasDescription} label="Copy" />
              <GapBadge ok={c.hasBrandLink} label="Brand" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
