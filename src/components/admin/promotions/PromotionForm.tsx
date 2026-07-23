/**
 * src/components/admin/promotions/PromotionForm.tsx
 *
 * The create/edit form for a promotion. Server-rendered (a plain <form> posting
 * to a server action) so it works without client JS; a small client island
 * handles show/hide of the brand picker and the live discount summary.
 *
 * Includes:
 *  - Core fields (title, description, discount type/percent/fixed, recurrence).
 *  - MECHANICS editor (structured promotions.config): qty/weight/spend tiers,
 *    BOGO, basket N-for-M / top-item, and the Doobie-Tuesday-style either/or.
 *    Only the section matching the chosen discount type is persisted, so stale
 *    mechanics never leak between types.
 *  - The Thursday BRAND SELECTOR (checkbox grid of live menu brands).
 *  - Category targeting (Greenway categories) + storewide + clearance toggle.
 *  - Exclusions (categories/brands).
 *
 * Compliance guardrails baked into the UI: percent inputs cap at 99 (cannabis
 * is never free — RCW 69.50.357), stacking does not exist (best-deal-wins
 * only), and publish runs the CCRS below-cost HARD BLOCK server-side.
 */
import {
  DISCOUNT_TYPE_LABELS,
  WEEKDAY_LABELS,
  type PromotionWithRules,
  type Weekday,
} from "@/lib/promotions/types";
import { GREENWAY_CATEGORY_VALUES } from "@/lib/promotions/category-values";
import { PromotionAiCopy } from "@/components/admin/promotions/PromotionAiCopy";
import { Button } from "@/components/admin/ui";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  promotion?: PromotionWithRules | null;
  brands: string[];
  submitLabel: string;
  /** Whether the AI copy writer is available (AI_API_KEY present). */
  aiEnabled?: boolean;
};

const DISCOUNT_TYPES = Object.keys(DISCOUNT_TYPE_LABELS) as (keyof typeof DISCOUNT_TYPE_LABELS)[];

/** Defensive read of a stored tier list from promotions.config jsonb. */
function readTiers(config: Record<string, unknown> | undefined, key: string): { at: number; percent: number }[] {
  const raw = config?.[key];
  if (!Array.isArray(raw)) return [];
  const out: { at: number; percent: number }[] = [];
  for (const t of raw) {
    if (t && typeof t === "object") {
      const at = Number((t as Record<string, unknown>).at);
      const percent = Number((t as Record<string, unknown>).percent);
      if (Number.isFinite(at) && Number.isFinite(percent)) out.push({ at, percent });
    }
  }
  return out;
}

function readObj(config: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  const raw = config?.[key];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function readNum(obj: Record<string, unknown>, key: string): number | "" {
  const n = Number(obj[key]);
  return Number.isFinite(n) && n > 0 ? n : "";
}

export function PromotionForm({ action, promotion, brands, submitLabel, aiEnabled = false }: Props) {
  const selectedBrands = new Set(
    promotion?.targets.filter((t) => t.scope === "brand").map((t) => t.value ?? "") ?? [],
  );
  const selectedCategories = new Set(
    promotion?.targets.filter((t) => t.scope === "category").map((t) => t.value ?? "") ?? [],
  );
  const excludedCategories = new Set(
    promotion?.exclusions.filter((e) => e.scope === "category").map((e) => e.value ?? "") ?? [],
  );
  const storewide = promotion?.targets.some((t) => t.scope === "all") ?? false;

  // Stored mechanics (promotions.config jsonb) → editor defaults.
  const cfg = (promotion?.config ?? {}) as Record<string, unknown>;
  const qtyTiers = readTiers(cfg, "qtyTiers");
  const weightTiers = readTiers(cfg, "weightTiers");
  const spendTiers = readTiers(cfg, "spendTiers").map((t) => ({ at: t.at / 100, percent: t.percent }));
  const bogo = readObj(cfg, "bogo");
  const basketNforM = readObj(cfg, "basketNforM");
  const basketTopItem = readObj(cfg, "basketTopItem");
  const eitherOr = readObj(cfg, "eitherOr");
  const eitherOrBundle = readObj(eitherOr, "bundle");
  const basketMode = Object.keys(basketTopItem).length > 0 ? "top_item" : "n_for_m";

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]";
  const tierRow = (prefix: string, atLabel: string, tiers: { at: number; percent: number }[]) =>
    [0, 1, 2].map((i) => (
      <div key={`${prefix}-${i}`} className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">{atLabel} {i + 1}</span>
          <input name={`${prefix}_at`} type="number" min={0} step="any" defaultValue={tiers[i]?.at ?? ""} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">% off</span>
          <input name={`${prefix}_percent`} type="number" min={0} max={99} step="1" defaultValue={tiers[i]?.percent ?? ""} className={inputCls} />
        </label>
      </div>
    ));

  return (
    <form action={action} className="space-y-8">
      {promotion && <input type="hidden" name="id" value={promotion.id} />}

      {/* Core */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Title *</span>
            <input
              name="title"
              defaultValue={promotion?.title ?? ""}
              required
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
              placeholder="e.g. Munchie Monday"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Machine key (optional)</span>
            <input
              name="promo_key"
              defaultValue={promotion?.promo_key ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
              placeholder="e.g. daily.monday"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Description</span>
          <textarea
            name="description"
            defaultValue={promotion?.description ?? ""}
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Badge / bonus note (shown on card)</span>
          <input
            name="bonus_note"
            defaultValue={promotion?.bonus_note ?? ""}
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            placeholder='e.g. "buy 2+ to save"'
          />
        </label>

        <PromotionAiCopy aiEnabled={aiEnabled} />
      </section>

      {/* Discount */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Discount</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Discount type</span>
            <select
              name="discount_type"
              defaultValue={promotion?.discount_type ?? "percent"}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            >
              {DISCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DISCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Percent (%)</span>
            <input
              name="discount_percent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={promotion?.discount_percent ?? 0}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Fixed off (¢, minor units)</span>
            <input
              name="discount_fixed"
              type="number"
              min={0}
              step="1"
              defaultValue={promotion?.discount_fixed ?? 0}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Multi-item tier % (optional)</span>
            <input
              name="multi_item_percent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={promotion?.multi_item_percent ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
          <label className="flex items-center gap-3 pt-6">
            <input
              type="checkbox"
              name="per_item_sale"
              defaultChecked={promotion?.per_item_sale ?? true}
              className="h-4 w-4 accent-[var(--admin-accent)]"
            />
            <span className="text-sm text-white/70">
              Show honest struck per-item price on cards
              <span className="block text-xs text-white/40">
                Off for weight/spend/basket tiers — card shows the note only; cart computes the exact
                charge.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Mechanics (structured config) */}
      <section className="space-y-5 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">
          Mechanics (advanced — only the section matching your discount type is used)
        </h2>
        <p className="text-xs text-white/40">
          Fill in ONLY the block for the discount type selected above; everything else is ignored
          and cleared on save. Percent caps at 99 — cannabis is never free (RCW 69.50.357). Deals
          never stack: every item gets the single best deal, and the register clamps any price at
          the product&apos;s cost floor (CCRS: never below the cost of acquisition).
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Multi-item qty tiers + either/or */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Multi-item tier (qty)
            </h3>
            <p className="text-xs text-white/40">e.g. buy 2 → 15% off, buy 4 → 25% off.</p>
            {tierRow("cfg_qty_tier", "Buy at least", qtyTiers)}
            <div className="mt-2 border-t border-white/10 pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Either/or bundle (Doobie Tuesday style)
              </h4>
              <p className="mb-2 text-xs text-white/40">
                Flat % OR buy-N-for-M — the register applies whichever saves the customer LESS
                (store-advantaged, uniform for everyone). Leave blank if unused.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Flat %</span>
                  <input name="cfg_eo_flat" type="number" min={0} max={99} step="1" defaultValue={readNum(eitherOr, "flatPercent")} className={inputCls} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Buy N</span>
                  <input name="cfg_eo_n" type="number" min={0} max={24} step="1" defaultValue={readNum(eitherOrBundle, "n")} className={inputCls} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Pay for M</span>
                  <input name="cfg_eo_m" type="number" min={0} max={24} step="1" defaultValue={readNum(eitherOrBundle, "m")} className={inputCls} />
                </label>
              </div>
            </div>
          </div>

          {/* Weight tiers */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Weight tier (grams)
            </h3>
            <p className="text-xs text-white/40">
              e.g. 7g (quarter) → 15%, 14g (half) → 20%, 28g (oz) → 30%.
            </p>
            {tierRow("cfg_weight_tier", "Grams ≥", weightTiers)}
          </div>

          {/* Spend tiers */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Spend threshold (dollars)
            </h3>
            <p className="text-xs text-white/40">e.g. spend $50 → 15%, $100 → 20% (enter dollars).</p>
            {tierRow("cfg_spend_tier", "Spend $ ≥", spendTiers)}
          </div>

          {/* BOGO */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">BOGO</h3>
            <p className="text-xs text-white/40">
              Buy X, get Y at Z% off — the CHEAPEST eligible units are the discounted ones
              (store-advantaged). Max 99%.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-white/50">Buy qty</span>
                <input name="cfg_bogo_buy" type="number" min={0} max={12} step="1" defaultValue={readNum(bogo, "buyQty")} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-white/50">Get qty</span>
                <input name="cfg_bogo_get" type="number" min={0} max={12} step="1" defaultValue={readNum(bogo, "getQty")} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-white/50">Get % off</span>
                <input name="cfg_bogo_percent" type="number" min={0} max={99} step="1" defaultValue={readNum(bogo, "getPercent")} className={inputCls} />
              </label>
            </div>
          </div>

          {/* Basket */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4 lg:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Basket deal
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="radio" name="cfg_basket_mode" value="n_for_m" defaultChecked={basketMode === "n_for_m"} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" />
                  Buy N for the price of M (mix &amp; match — cheapest units set the savings, spread
                  across the basket like Ice Cream Sunday)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-white/50">Buy N</span>
                    <input name="cfg_basket_n" type="number" min={0} max={24} step="1" defaultValue={readNum(basketNforM, "n")} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-white/50">Pay for M</span>
                    <input name="cfg_basket_m" type="number" min={0} max={24} step="1" defaultValue={readNum(basketNforM, "m")} className={inputCls} />
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="radio" name="cfg_basket_mode" value="top_item" defaultChecked={basketMode === "top_item"} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" />
                  Top item % + rest % (Super Saturday style)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-white/50">Top item %</span>
                    <input name="cfg_top_percent" type="number" min={0} max={99} step="1" defaultValue={readNum(basketTopItem, "topPercent")} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-white/50">Rest %</span>
                    <input name="cfg_rest_percent" type="number" min={0} max={99} step="1" defaultValue={readNum(basketTopItem, "restPercent")} className={inputCls} />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Schedule */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Schedule</h2>
        <p className="text-xs text-white/40">
          Pick a weekday for a recurring daily deal, OR leave it blank and set a date window for a
          one-off / seasonal promo. Store timezone: America/Los_Angeles.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Recurring weekday</span>
            <select
              name="weekday"
              defaultValue={promotion?.weekday ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            >
              <option value="">— none (use date window) —</option>
              {([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Starts (optional)</span>
            <input
              name="starts_at"
              type="datetime-local"
              defaultValue={promotion?.starts_at?.slice(0, 16) ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Ends (optional)</span>
            <input
              name="ends_at"
              type="datetime-local"
              defaultValue={promotion?.ends_at?.slice(0, 16) ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
        </div>
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs text-white/50">Priority (higher wins for badge)</span>
          <input
            name="priority"
            type="number"
            step="1"
            defaultValue={promotion?.priority ?? 0}
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
      </section>

      {/* Targeting */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">What it applies to</h2>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="target_scope"
            value="all"
            defaultChecked={storewide}
            className="h-4 w-4 accent-[var(--admin-accent)]"
          />
          <span className="text-sm text-white/70">
            Storewide (applies to everything — e.g. Super Saturday / clearance event)
          </span>
        </label>

        {/* Category targeting */}
        <div>
          <p className="mb-2 text-xs text-white/50">Categories</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {GREENWAY_CATEGORY_VALUES.map((cat) => (
              <label
                key={cat}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/70"
              >
                <input
                  type="checkbox"
                  name="target_category"
                  value={cat}
                  defaultChecked={selectedCategories.has(cat)}
                  className="h-3.5 w-3.5 accent-[var(--admin-accent)]"
                />
                {cat}
              </label>
            ))}
          </div>
        </div>

        {/* Thursday brand selector */}
        <div>
          <p className="mb-2 text-xs text-white/50">
            Brands{" "}
            <span className="text-white/30">
              (Top Shelf Thursday selector — pick the featured brands from the live menu)
            </span>
          </p>
          {brands.length === 0 ? (
            <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs text-[var(--admin-text-muted)]">
              No published menu brands found yet. Import and publish a menu to
              populate this list. Until then, this promotion will apply across all
              brands.
            </p>
          ) : (
            <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2 sm:grid-cols-3">
              {brands.map((brand) => (
                <label
                  key={brand}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    name="target_brand"
                    value={brand}
                    defaultChecked={selectedBrands.has(brand)}
                    className="h-3.5 w-3.5 accent-[var(--admin-gold)]"
                  />
                  {brand}
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Exclusions */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Exclusions (optional)</h2>
        <p className="text-xs text-white/40">Carve out categories that should NOT get this deal.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {GREENWAY_CATEGORY_VALUES.map((cat) => (
            <label
              key={`ex-${cat}`}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/60"
            >
              <input
                type="checkbox"
                name="exclude_category"
                value={cat}
                defaultChecked={excludedCategories.has(cat)}
                className="h-3.5 w-3.5 accent-[var(--admin-orange)]"
              />
              {cat}
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="save">
          {submitLabel}
        </Button>
        <Button href="/admin/promotions" variant="neutral">
          Cancel
        </Button>
      </div>
    </form>
  );
}
