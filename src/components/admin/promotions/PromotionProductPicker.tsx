"use client";

/**
 * PromotionProductPicker — PR-P1. A client island inside the (server-rendered)
 * PromotionForm that lets the owner target OR exclude *individual* products
 * from the live published menu.
 *
 * The promotions backend already supports product-scoped rules end to end:
 *   - actions.ts parseRules() reads `target_product` / `exclude_product`
 *   - promotions-store.ruleMatches() resolves scope "product" (item.key === value)
 *   - the storefront/register honor the resolved product keys
 * …but there was never any UI to set them. This is that UI.
 *
 * How it works: the picker keeps two ordered lists (include + exclude) in
 * client state and renders a hidden <input name="target_product"> /
 * <input name="exclude_product"> for each selected key. Those inputs live
 * inside the surrounding <form>, so a normal form submit carries them to the
 * server action — no extra wiring, no client save. Nothing persists until the
 * form is submitted, and the CCRS below-cost hard block still runs on publish.
 *
 * A product can be included OR excluded, never both (adding to one side
 * removes it from the other). The selected chips ARE the validation table:
 * the owner sees exactly which products they picked, with brand + price, and
 * can remove any with one click.
 */
import { useMemo, useState } from "react";
import type { MenuProductOption } from "@/lib/promotions/promotions-store";
import { formatMinorCurrency } from "@/lib/leafly/format";

type Props = {
  /** All products from the published menu (empty when nothing is published). */
  products: MenuProductOption[];
  /** Product keys pre-selected as INCLUDE targets (edit mode). */
  initialInclude?: string[];
  /** Product keys pre-selected as EXCLUDE targets (edit mode). */
  initialExclude?: string[];
};

const MAX_RESULTS = 40;

export function PromotionProductPicker({
  products,
  initialInclude = [],
  initialExclude = [],
}: Props) {
  const byKey = useMemo(() => {
    const m = new Map<string, MenuProductOption>();
    for (const p of products) m.set(p.key, p);
    return m;
  }, [products]);

  // Keep only keys that still exist in the current menu (a product could have
  // been removed since the promo was last saved).
  const [include, setInclude] = useState<string[]>(() =>
    initialInclude.filter((k) => byKey.has(k)),
  );
  const [exclude, setExclude] = useState<string[]>(() =>
    initialExclude.filter((k) => byKey.has(k)),
  );
  const [query, setQuery] = useState("");

  const includeSet = new Set(include);
  const excludeSet = new Set(exclude);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as MenuProductOption[];
    const out: MenuProductOption[] = [];
    for (const p of products) {
      const hay = `${p.brand} ${p.name} ${p.categories.join(" ")}`.toLowerCase();
      if (hay.includes(q)) {
        out.push(p);
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [products, query]);

  function addInclude(key: string) {
    setExclude((e) => e.filter((k) => k !== key));
    setInclude((i) => (i.includes(key) ? i : [...i, key]));
  }
  function addExclude(key: string) {
    setInclude((i) => i.filter((k) => k !== key));
    setExclude((e) => (e.includes(key) ? e : [...e, key]));
  }
  function removeInclude(key: string) {
    setInclude((i) => i.filter((k) => k !== key));
  }
  function removeExclude(key: string) {
    setExclude((e) => e.filter((k) => k !== key));
  }

  const label = (key: string) => {
    const p = byKey.get(key);
    if (!p) return key;
    return `${p.brand ? `${p.brand} · ` : ""}${p.name}`;
  };

  if (products.length === 0) {
    return (
      <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs text-[var(--admin-text-muted)]">
        No published menu yet, so there are no individual products to pick. Import
        and publish a menu to target or exclude specific products. You can still
        target by category or brand above.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden inputs the form submit carries to the server action. */}
      {include.map((key) => (
        <input key={`ti-${key}`} type="hidden" name="target_product" value={key} />
      ))}
      {exclude.map((key) => (
        <input key={`xi-${key}`} type="hidden" name="exclude_product" value={key} />
      ))}

      {/* Search box */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products by name, brand, or category…"
          className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          aria-label="Search products to include or exclude"
        />
        {query.trim() && (
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
            {matches.length === 0 && (
              <p className="px-2 py-1 text-xs text-white/40">No products match “{query}”.</p>
            )}
            {matches.map((p) => {
              const isIn = includeSet.has(p.key);
              const isEx = excludeSet.has(p.key);
              return (
                <div
                  key={p.key}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/5"
                >
                  <span className="min-w-0 truncate text-white/70">
                    {p.brand ? `${p.brand} · ` : ""}
                    {p.name}
                    <span className="ml-2 text-white/30">
                      {formatMinorCurrency(p.priceMinorUnits)}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => addInclude(p.key)}
                      disabled={isIn}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        isIn
                          ? "cursor-default bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                          : "bg-white/10 text-white/70 hover:bg-[var(--admin-accent)]/30 hover:text-white"
                      }`}
                    >
                      {isIn ? "Included ✓" : "Include"}
                    </button>
                    <button
                      type="button"
                      onClick={() => addExclude(p.key)}
                      disabled={isEx}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        isEx
                          ? "cursor-default bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]"
                          : "bg-white/10 text-white/70 hover:bg-[var(--admin-orange)]/30 hover:text-white"
                      }`}
                    >
                      {isEx ? "Excluded ✓" : "Exclude"}
                    </button>
                  </span>
                </div>
              );
            })}
            {matches.length >= MAX_RESULTS && (
              <p className="px-2 py-1 text-[11px] text-white/30">
                Showing first {MAX_RESULTS} matches — keep typing to narrow it down.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Selected: INCLUDE */}
      <div>
        <p className="mb-1 text-xs text-white/50">
          Included products{" "}
          <span className="text-white/30">({include.length})</span>
        </p>
        {include.length === 0 ? (
          <p className="text-xs text-white/30">
            None — this promotion targets whatever the category/brand rules above
            match. Add specific products to force them into the deal.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {include.map((key) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2.5 py-1 text-xs text-white/80"
              >
                <span className="max-w-[16rem] truncate">{label(key)}</span>
                <button
                  type="button"
                  onClick={() => removeInclude(key)}
                  className="text-white/40 hover:text-white"
                  aria-label={`Remove ${label(key)} from included`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Selected: EXCLUDE */}
      <div>
        <p className="mb-1 text-xs text-white/50">
          Excluded products{" "}
          <span className="text-white/30">({exclude.length})</span>
        </p>
        {exclude.length === 0 ? (
          <p className="text-xs text-white/30">
            None — no specific products are carved out of this deal.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {exclude.map((key) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-2.5 py-1 text-xs text-white/80"
              >
                <span className="max-w-[16rem] truncate">{label(key)}</span>
                <button
                  type="button"
                  onClick={() => removeExclude(key)}
                  className="text-white/40 hover:text-white"
                  aria-label={`Remove ${label(key)} from excluded`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
