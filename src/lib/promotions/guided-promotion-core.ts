/**
 * src/lib/promotions/guided-promotion-core.ts  (PR-P5)
 *
 * GUIDED THURSDAY BRAND SALE — the pure brain behind the one-click workflow.
 *
 * The single most common thing Greenway runs is "put brand X on sale this
 * Thursday" (Top Shelf Thursday). Today that means hand-building a promotion
 * from scratch. This module turns a tiny input — a few brand names and a
 * percent — into a fully pre-filled promotion DRAFT that the existing
 * promotion form renders as-is, so the owner just reviews and clicks Create.
 *
 * PURE by design (NO "server-only", NO DB, NO AI): it only transforms and
 * validates, so it runs in the tsx self-test harness and vitest. It never
 * writes anything — the existing createPromotionAction still does the save,
 * with all its publish-time CCRS guards intact.
 *
 * Anti-footgun rules encoded here:
 *  - Percent is clamped to a sane 1..90 (a Thursday sale is a markdown, not a
 *    giveaway; the CCRS cost floor still hard-blocks below-cost at publish).
 *  - Brands are validated against the LIVE menu vocabulary: unknown names are
 *    dropped and reported, never silently targeted.
 *  - An empty/all-dropped selection produces a warning and NO usable draft
 *    (we refuse to build a "sale on nothing", or a silent storewide sale).
 */
import type {
  PromotionWithRules,
  PromotionTargetRow,
  Weekday,
} from "./types";

/** Top Shelf Thursday. 0=Sun … 6=Sat (matches Date.getDay()). */
export const THURSDAY: Weekday = 4;

/** A Thursday sale is a markdown — clamp to a reasonable, non-giveaway range. */
export const GUIDED_PERCENT_MIN = 1;
export const GUIDED_PERCENT_MAX = 90;

export type GuidedThursdayInput = {
  /** Brand names the owner picked (as typed / passed in the URL). */
  brands: string[];
  /** Headline percent off (will be clamped to [MIN, MAX]). */
  percent: number;
  /** Optional custom title; a friendly default is generated when absent. */
  titleOverride?: string | null;
};

export type GuidedThursdayResult = {
  /**
   * A promotion DRAFT shaped exactly like the edit form expects, or null when
   * there is nothing valid to build (no known brands). The form reads:
   * title, discount_type, discount_percent, weekday, per_item_sale, and
   * targets (scope "brand").
   */
  promotion: PromotionWithRules | null;
  /** Human-readable notes (dropped brands, clamped percent, empty selection). */
  warnings: string[];
  /** Brands that matched the live menu (case-insensitive) — canonical spelling. */
  validBrands: string[];
  /** Brands that did NOT match the live menu and were dropped. */
  droppedBrands: string[];
  /** The clamped percent actually used. */
  percent: number;
};

/** Clamp + round a percent into the guided range; NaN/≤0 → MIN. */
export function clampGuidedPercent(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return GUIDED_PERCENT_MIN;
  const rounded = Math.round(raw);
  if (rounded < GUIDED_PERCENT_MIN) return GUIDED_PERCENT_MIN;
  if (rounded > GUIDED_PERCENT_MAX) return GUIDED_PERCENT_MAX;
  return rounded;
}

/** Case-insensitive resolution of picked brands to the live-menu spelling. */
function resolveBrands(
  picked: string[],
  menuBrands: string[],
): { valid: string[]; dropped: string[] } {
  const byLower = new Map<string, string>();
  for (const b of menuBrands) {
    const key = b.trim().toLowerCase();
    if (key) byLower.set(key, b);
  }
  const valid: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of picked) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const canonical = byLower.get(key);
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        valid.push(canonical);
      }
    } else if (!dropped.includes(trimmed)) {
      dropped.push(trimmed);
    }
  }
  return { valid, dropped };
}

/** A friendly default title for a Thursday brand sale. */
export function defaultThursdayTitle(brands: string[], percent: number): string {
  if (brands.length === 0) return `Top Shelf Thursday — ${percent}% off`;
  if (brands.length === 1) return `Top Shelf Thursday — ${brands[0]} ${percent}% off`;
  if (brands.length === 2) {
    return `Top Shelf Thursday — ${brands[0]} & ${brands[1]} ${percent}% off`;
  }
  return `Top Shelf Thursday — ${brands.length} brands ${percent}% off`;
}

/**
 * Turn a tiny guided input into a ready-to-review promotion DRAFT.
 * Fail-safe: unknown brands are dropped (and reported); an empty/all-dropped
 * selection yields promotion=null with a warning (we never build a sale on
 * nothing, nor a silent storewide sale).
 */
export function buildThursdayBrandSaleDraft(
  input: GuidedThursdayInput,
  menuBrands: string[],
): GuidedThursdayResult {
  const warnings: string[] = [];
  const percent = clampGuidedPercent(input.percent);
  if (percent !== Math.round(input.percent)) {
    warnings.push(
      `Percent was adjusted to ${percent}% (allowed range ${GUIDED_PERCENT_MIN}–${GUIDED_PERCENT_MAX}%).`,
    );
  }

  const { valid, dropped } = resolveBrands(input.brands ?? [], menuBrands);
  if (dropped.length) {
    warnings.push(
      `These brands weren't found on the live menu and were skipped: ${dropped.join(", ")}.`,
    );
  }

  if (valid.length === 0) {
    warnings.push(
      "No matching brands were selected, so there's nothing to put on sale yet. Pick at least one brand from your live menu.",
    );
    return { promotion: null, warnings, validBrands: [], droppedBrands: dropped, percent };
  }

  const title = (input.titleOverride ?? "").trim() || defaultThursdayTitle(valid, percent);

  const now = new Date().toISOString();
  const targets: PromotionTargetRow[] = valid.map((brand, i) => ({
    id: `guided-brand-${i}`,
    promotion_id: "guided-draft",
    scope: "brand",
    value: brand,
    created_at: now,
  }));

  const promotion: PromotionWithRules = {
    id: "guided-draft",
    promo_key: null,
    title,
    description: null,
    status: "draft",
    discount_type: "percent",
    discount_percent: percent,
    discount_fixed: 0,
    multi_item_percent: null,
    config: {},
    per_item_sale: true,
    bonus_note: null,
    weekday: THURSDAY,
    starts_at: null,
    ends_at: null,
    priority: 0,
    published_at: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
    targets,
    exclusions: [],
  };

  return { promotion, warnings, validBrands: valid, droppedBrands: dropped, percent };
}

/**
 * Parse the guided query params the launcher navigates to:
 * ?brands=Brand%20A,Brand%20B&percent=20&title=Optional
 */
export function parseGuidedParams(params: {
  brands?: string | null;
  percent?: string | null;
  title?: string | null;
}): GuidedThursdayInput | null {
  const brandsRaw = (params.brands ?? "").trim();
  const percentRaw = (params.percent ?? "").trim();
  if (!brandsRaw && !percentRaw) return null;
  const brands = brandsRaw
    ? brandsRaw
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean)
    : [];
  const percent = Number(percentRaw);
  return {
    brands,
    percent: Number.isFinite(percent) ? percent : GUIDED_PERCENT_MIN,
    titleOverride: (params.title ?? "").trim() || null,
  };
}

/** Build the launcher's target URL for the pre-filled new-promotion form. */
export function guidedNewPromotionHref(input: GuidedThursdayInput): string {
  const sp = new URLSearchParams();
  if (input.brands.length) sp.set("brands", input.brands.join(","));
  sp.set("percent", String(clampGuidedPercent(input.percent)));
  if (input.titleOverride) sp.set("title", input.titleOverride);
  return `/admin/promotions/new?${sp.toString()}`;
}

// ---------------------------------------------------------------------------
// Embedded pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------

export function __runGuidedPromotionTests(): { passed: number; failed: number } {
  const failures: string[] = [];
  let passed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };

  const MENU = ["Fairwinds", "Avitas", "Dama", "Top Shelf Co"];

  // 1. Happy path: one known brand builds a Thursday percent draft.
  {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas"], percent: 20 }, MENU);
    check("happy: promotion built", r.promotion !== null);
    check("happy: weekday is Thursday(4)", r.promotion?.weekday === THURSDAY);
    check("happy: discount_type percent", r.promotion?.discount_type === "percent");
    check("happy: percent 20", r.promotion?.discount_percent === 20);
    check("happy: per_item_sale true", r.promotion?.per_item_sale === true);
    check("happy: status draft", r.promotion?.status === "draft");
    check("happy: one brand target", (r.promotion?.targets.length ?? 0) === 1);
    check(
      "happy: brand target scope+value",
      r.promotion?.targets[0]?.scope === "brand" && r.promotion?.targets[0]?.value === "Avitas",
    );
    check("happy: no exclusions", (r.promotion?.exclusions.length ?? 0) === 0);
    check("happy: validBrands", r.validBrands.join(",") === "Avitas");
    check("happy: no dropped", r.droppedBrands.length === 0);
  }

  // 2. Case-insensitive brand match resolves to canonical spelling.
  {
    const r = buildThursdayBrandSaleDraft({ brands: ["avitas", "FAIRWINDS"], percent: 15 }, MENU);
    check("ci: two valid", r.validBrands.length === 2);
    check("ci: canonical Avitas", r.validBrands.includes("Avitas"));
    check("ci: canonical Fairwinds", r.validBrands.includes("Fairwinds"));
    check("ci: two targets", (r.promotion?.targets.length ?? 0) === 2);
  }

  // 3. Unknown brand is dropped and reported; still builds from the valid ones.
  {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas", "Ghost Brand"], percent: 25 }, MENU);
    check("drop: promotion built", r.promotion !== null);
    check("drop: dropped Ghost Brand", r.droppedBrands.includes("Ghost Brand"));
    check("drop: valid only Avitas", r.validBrands.join(",") === "Avitas");
    check("drop: has warning", r.warnings.some((w) => w.includes("Ghost Brand")));
  }

  // 4. All-unknown → no promotion, clear warning.
  {
    const r = buildThursdayBrandSaleDraft({ brands: ["Nope", "Nada"], percent: 20 }, MENU);
    check("empty: promotion null", r.promotion === null);
    check("empty: warning present", r.warnings.some((w) => w.toLowerCase().includes("nothing")));
  }

  // 5. Percent clamping: over-max, zero/negative, non-integer.
  {
    check("clamp: 200→90", clampGuidedPercent(200) === GUIDED_PERCENT_MAX);
    check("clamp: 0→1", clampGuidedPercent(0) === GUIDED_PERCENT_MIN);
    check("clamp: -5→1", clampGuidedPercent(-5) === GUIDED_PERCENT_MIN);
    check("clamp: 19.6→20", clampGuidedPercent(19.6) === 20);
    check("clamp: NaN→1", clampGuidedPercent(Number.NaN) === GUIDED_PERCENT_MIN);
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas"], percent: 150 }, MENU);
    check("clamp: draft percent 90", r.promotion?.discount_percent === GUIDED_PERCENT_MAX);
    check("clamp: warns on adjust", r.warnings.some((w) => w.includes("adjusted")));
  }

  // 6. Default title generation.
  {
    check("title: one", defaultThursdayTitle(["Avitas"], 20) === "Top Shelf Thursday — Avitas 20% off");
    check(
      "title: two",
      defaultThursdayTitle(["Avitas", "Dama"], 15) === "Top Shelf Thursday — Avitas & Dama 15% off",
    );
    check(
      "title: many",
      defaultThursdayTitle(["A", "B", "C"], 10) === "Top Shelf Thursday — 3 brands 10% off",
    );
    const r = buildThursdayBrandSaleDraft(
      { brands: ["Avitas"], percent: 20, titleOverride: "  My Custom Sale  " },
      MENU,
    );
    check("title: override wins", r.promotion?.title === "My Custom Sale");
  }

  // 7. Param parsing + href round-trip.
  {
    const parsed = parseGuidedParams({ brands: "Avitas, Dama", percent: "20", title: "" });
    check("parse: two brands", (parsed?.brands.length ?? 0) === 2);
    check("parse: percent 20", parsed?.percent === 20);
    check("parse: empty title null", parsed?.titleOverride === null);
    check("parse: nothing → null", parseGuidedParams({}) === null);
    const href = guidedNewPromotionHref({ brands: ["Avitas", "Dama"], percent: 20 });
    check("href: has brands", href.includes("brands=Avitas%2CDama"));
    check("href: has percent", href.includes("percent=20"));
  }

  if (failures.length) {
    console.error("guided-promotion-core FAILURES:", failures.join("; "));
  }
  return { passed, failed: failures.length };
}
