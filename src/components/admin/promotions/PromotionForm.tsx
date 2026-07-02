/**
 * src/components/admin/promotions/PromotionForm.tsx
 *
 * The create/edit form for a promotion. Server-rendered (a plain <form> posting
 * to a server action) so it works without client JS; a small client island
 * handles show/hide of the brand picker and the live discount summary.
 *
 * Includes:
 *  - Core fields (title, description, discount type/percent/fixed, recurrence).
 *  - The Thursday BRAND SELECTOR (checkbox grid of live menu brands).
 *  - Category targeting (Greenway categories) + storewide + clearance toggle.
 *  - Exclusions (categories/brands).
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              placeholder="e.g. Munchie Monday"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Machine key (optional)</span>
            <input
              name="promo_key"
              defaultValue={promotion?.promo_key ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Badge / bonus note (shown on card)</span>
          <input
            name="bonus_note"
            defaultValue={promotion?.bonus_note ?? ""}
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </label>
          <label className="flex items-center gap-3 pt-6">
            <input
              type="checkbox"
              name="per_item_sale"
              defaultChecked={promotion?.per_item_sale ?? true}
              className="h-4 w-4 accent-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Ends (optional)</span>
            <input
              name="ends_at"
              type="datetime-local"
              defaultValue={promotion?.ends_at?.slice(0, 16) ?? ""}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
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
            className="h-4 w-4 accent-[#7ed957]"
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
                  className="h-3.5 w-3.5 accent-[#7ed957]"
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
                    className="h-3.5 w-3.5 accent-[#ffd700]"
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
                className="h-3.5 w-3.5 accent-[#ff7f00]"
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
