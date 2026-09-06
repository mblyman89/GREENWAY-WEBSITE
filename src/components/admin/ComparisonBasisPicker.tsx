import Link from "next/link";
import {
  COMPARISON_BASES,
  basisSpec,
  type ComparisonBasis,
} from "@/lib/admin/comparison-basis-core";

/**
 * SLICE 21 — the "compare today against…" selector.
 *
 * Deliberately built from <Link> elements rather than a client-side <select>.
 * The cockpit is a server component that already re-reads its data per request
 * (`export const dynamic = "force-dynamic"`), so a plain link is enough to
 * change the basis — no client bundle, no hydration, and the chosen basis ends
 * up in the URL. That last part is the real win: the owner can bookmark
 * `/admin?basis=dow_average_4` and land on the view he actually wants, and the
 * back button behaves.
 *
 * `preserve` carries any other query params (there are none today, but the
 * cockpit will grow them) so switching basis never silently drops state.
 */
export function ComparisonBasisPicker({
  active,
  preserve = {},
}: {
  active: ComparisonBasis;
  preserve?: Record<string, string | undefined>;
}) {
  const spec = basisSpec(active);
  const href = (id: ComparisonBasis) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(preserve)) {
      if (typeof v === "string" && v !== "" && k !== "basis") p.set(k, v);
    }
    p.set("basis", id);
    return `/admin?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-black uppercase tracking-[0.14em] text-white/45">
          Compare with
        </span>
        {COMPARISON_BASES.map((b) => {
          const on = b.id === active;
          return (
            <Link
              key={b.id}
              href={href(b.id)}
              scroll={false}
              aria-current={on ? "true" : undefined}
              title={b.description}
              className={
                on
                  ? "rounded-full border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-3 py-1 text-[11px] font-bold text-[var(--admin-accent)]"
                  : "rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-white/60 transition hover:border-white/25 hover:text-white/90"
              }
            >
              {b.label}
            </Link>
          );
        })}
      </div>
      {/*
        The description is shown, not just tucked into a title attribute: the
        difference between "last 4 Tuesdays" and "trailing 28 days" changes how
        you should read the number above it, and that is not a hover-to-discover
        detail.
      */}
      <p className="text-[11px] leading-relaxed text-white/45">{spec.description}</p>
    </div>
  );
}
