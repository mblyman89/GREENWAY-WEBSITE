"use client";

/**
 * GuidedThursdayLauncher — PR-P5 client island for the one-click "Top Shelf
 * Thursday" brand sale. The owner picks one or more brands from the live menu,
 * sets a percent, and clicks "Set up Thursday sale". We navigate to the normal
 * New-promotion form with the guided params pre-filled — so the existing form
 * (with all its publish-time CCRS guards) renders the draft ready to review.
 *
 * This is purely a convenience launcher: it writes nothing itself. The live
 * title preview mirrors the pure core's default so what you see is what the
 * form will show.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import {
  defaultThursdayTitle,
  clampGuidedPercent,
  guidedNewPromotionHref,
} from "@/lib/promotions/guided-promotion-core";

type Props = {
  /** Published-menu brand names (canonical spelling). */
  brands: string[];
};

export function GuidedThursdayLauncher({ brands }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [percent, setPercent] = useState<number>(20);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? brands.filter((b) => b.toLowerCase().includes(q)) : brands;
    return list.slice(0, 40);
  }, [brands, query]);

  const cleanPercent = clampGuidedPercent(percent);
  const previewTitle =
    selected.length > 0
      ? defaultThursdayTitle(selected, cleanPercent)
      : `Top Shelf Thursday — ${cleanPercent}% off (pick at least one brand)`;

  function toggle(brand: string) {
    setSelected((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand],
    );
  }

  function launch() {
    if (selected.length === 0) return;
    router.push(guidedNewPromotionHref({ brands: selected, percent: cleanPercent }));
  }

  return (
    <div className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>
          🌟
        </span>
        <h2 className="text-sm font-semibold text-white/90">Set up a Thursday brand sale</h2>
        <span className="text-xs text-white/45">
          Pick brands + a percent — we&apos;ll pre-fill the promotion for you to review.
        </span>
      </div>

      {brands.length === 0 ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60">
          No published menu brands yet. Import and publish a menu to use the guided Thursday
          sale. You can still build a promotion manually with “+ New promotion”.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {/* Brand picker */}
          <div>
            <label className="mb-1 block text-xs text-white/50">Brands on sale</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search brands…"
              className="mb-2 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
            <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
              {filtered.map((brand) => (
                <label
                  key={brand}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(brand)}
                    onChange={() => toggle(brand)}
                    className="h-3.5 w-3.5 accent-[var(--admin-gold)]"
                  />
                  {brand}
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="col-span-2 px-1 py-2 text-xs text-white/40">
                  No brands match “{query}”.
                </p>
              )}
            </div>
          </div>

          {/* Percent + preview + launch */}
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-white/50">Percent off</span>
              <input
                type="number"
                min={1}
                max={90}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="w-32 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
              />
            </label>

            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <p className="text-xs text-white/40">Preview</p>
              <p className="mt-0.5 text-sm text-white/85">{previewTitle}</p>
              {selected.length > 0 && (
                <p className="mt-1 text-xs text-white/45">
                  Every {selected.length === 1 ? "" : "listed "}Thursday, {cleanPercent}% off{" "}
                  {selected.join(", ")}. Saves as a draft to review &amp; publish.
                </p>
              )}
            </div>

            <Button variant="special" onClick={launch} disabled={selected.length === 0}>
              Set up Thursday sale →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
