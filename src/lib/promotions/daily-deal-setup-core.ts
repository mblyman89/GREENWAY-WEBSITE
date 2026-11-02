/**
 * src/lib/promotions/daily-deal-setup-core.ts  (D134, owner 2026-11-02)
 *
 * PURE planner behind the "Set up our daily deals" button. The owner asked:
 * "for our routine daily deals, I want a button that I can push that will set
 * it up automatically for me. except for thursday, that one is a manual
 * processes."
 *
 * The 11/2 investigation found the live daily-deal rows had drifted from the
 * standard deals, in ways no screen made obvious:
 *   - Monday at 20% (the standard is 25%),
 *   - Tuesday on the old either/or config instead of the 1→20% / 4+→25% tiers,
 *   - Wednesday with no spend tiers (the engine fell back to 15/20/30 at
 *     $50/$100/$150) and RSO both targeted and excluded,
 *   - Friday also targeting "all" (its weight tiers would reach every gram
 *     product in the store),
 *   - Saturday as a 0% "percent" deal with no basket config (no discount at all).
 *
 * This core compares each existing daily row with the standard deal in
 * DAILY_DEAL_SEEDS (the single source of truth the storefront fallback and the
 * engine already use) and returns a plan: create, update (with a plain-English
 * list of each change), or already right. Thursday is NEVER touched.
 *
 * Wording is the owner's: title, description and badge note are KEPT when they
 * are already filled in (the copy checker warns if they no longer match the
 * deal). Product and brand exclusions are kept (they are staff carve-outs and
 * cost-floor fixes). A category exclusion that cancels one of the deal's own
 * categories is dropped and reported (Wednesday excluded RSO while targeting it).
 *
 * No React, no DB, no server-only.
 */
import { DAILY_DEAL_SEEDS, type DailyDealSeed } from "./daily-deal-seed";
import { DEFAULT_WEIGHT_TIERS, type EngineConfig } from "./discount-engine-core";
import { seedConfigFor } from "./published-rules-core";
import { DISCOUNT_TYPE_LABELS, WEEKDAY_LABELS, type DiscountType, type PromoScope, type Weekday } from "./types";

/** Daily deals the button manages. Thursday stays manual (owner). */
export const MANUAL_DAILY_KEYS = new Set<string>(["daily.thursday"]);

export type ExistingDailyPromo = {
  id: string;
  promo_key: string | null;
  title: string;
  description: string | null;
  bonus_note: string | null;
  status: string;
  discount_type: DiscountType;
  discount_percent: number;
  discount_fixed: number;
  multi_item_percent: number | null;
  per_item_sale: boolean;
  config: Record<string, unknown> | null;
  weekday: number | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  targets: { scope: PromoScope; value: string | null }[];
  exclusions: { scope: PromoScope; value: string | null }[];
};

export type PlannedInput = {
  promo_key: string;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_percent: number;
  discount_fixed: number;
  multi_item_percent: number | null;
  config: Record<string, unknown>;
  per_item_sale: boolean;
  bonus_note: string | null;
  weekday: number;
  starts_at: null;
  ends_at: null;
  priority: number;
};

export type PlannedRule = { scope: PromoScope; value: string | null };

export type DailyDealPlanItem = {
  promoKey: string;
  weekday: Weekday;
  dayLabel: string;
  title: string;
  action: "create" | "update" | "unchanged";
  existingId: string | null;
  /** Plain-English changes, one per line (empty when unchanged). */
  changes: string[];
  /** What the standard deal is, in one sentence. */
  summary: string;
  input: PlannedInput;
  targets: PlannedRule[];
  exclusions: PlannedRule[];
};

export type DailyDealPlan = {
  items: DailyDealPlanItem[];
  /** Thursday (and any other manual day): shown, never changed. */
  manual: { promoKey: string; dayLabel: string; note: string }[];
  toChange: number;
};

// ---------------------------------------------------------------------------
// Standard config per seed
// ---------------------------------------------------------------------------

/** The full engine config a standard daily deal should carry (explicit, no fallbacks). */
export function standardConfigFor(seed: DailyDealSeed): EngineConfig {
  const base = seedConfigFor(seed.promoKey);
  if (seed.discountType === "weight_tier" && !base.weightTiers?.length) {
    // Explicit, so the row says what Friday does instead of relying on the
    // engine's silent default.
    return { ...base, weightTiers: DEFAULT_WEIGHT_TIERS.map((t) => ({ ...t })) };
  }
  if (seed.discountType === "multi_item_tier" && seed.qtyTiers?.length && !base.qtyTiers?.length) {
    return { ...base, qtyTiers: seed.qtyTiers.map((t) => ({ ...t })) };
  }
  if (seed.discountType === "threshold_spend" && seed.spendTiers?.length && !base.spendTiers?.length) {
    return { ...base, spendTiers: seed.spendTiers.map((t) => ({ ...t })) };
  }
  return base;
}

function standardTargets(seed: DailyDealSeed): PlannedRule[] {
  if (seed.storewide) return [{ scope: "all", value: null }];
  const out: PlannedRule[] = [];
  for (const c of seed.targetCategories ?? []) out.push({ scope: "category", value: c });
  for (const b of seed.targetBrands ?? []) out.push({ scope: "brand", value: b });
  return out;
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(minor % 100 === 0 ? 0 : 2)}`;
}

/** One sentence describing the mechanics (what the register will do). */
export function describeMechanics(type: DiscountType, percent: number, cfg: EngineConfig): string {
  if (cfg.eitherOr) {
    return `${cfg.eitherOr.flatPercent}% off, or buy ${cfg.eitherOr.bundle.n} pay for ${cfg.eitherOr.bundle.m} (the better one for the customer)`;
  }
  switch (type) {
    case "percent":
      return percent > 0 ? `${percent}% off every matching item` : "0% off (no discount)";
    case "fixed":
      return "a fixed amount off each matching item";
    case "multi_item_tier": {
      const t = cfg.qtyTiers ?? [];
      return t.length ? t.map((x) => `${x.at}+ items ${x.percent}%`).join(", ") : "no quantity tiers set (engine default 2+ 15%, 4+ 25%)";
    }
    case "weight_tier": {
      const t = cfg.weightTiers ?? [];
      return t.length ? t.map((x) => `${x.at}g+ ${x.percent}%`).join(", ") : "no weight tiers set (engine default 7g 15%, 14g 20%, 28g 30%)";
    }
    case "threshold_spend": {
      const t = cfg.spendTiers ?? [];
      return t.length
        ? t.map((x) => (x.at <= 0 ? `${x.percent}% on any amount` : `${x.percent}% at ${money(x.at)}+`)).join(", ")
        : "no spend tiers set (engine default 15% at $50, 20% at $100, 30% at $150)";
    }
    case "bogo":
      return cfg.bogo ? `buy ${cfg.bogo.buyQty}, get ${cfg.bogo.getQty} at ${cfg.bogo.getPercent}% off` : "BOGO with no settings";
    case "basket":
      if (cfg.basketTopItem) return `${cfg.basketTopItem.topPercent}% off one item + ${cfg.basketTopItem.restPercent}% off the rest`;
      if (cfg.basketNforM) return `buy ${cfg.basketNforM.n}, pay for ${cfg.basketNforM.m} (savings spread across the basket)`;
      return "basket deal with no settings (engine default 3 for 2)";
    default:
      return DISCOUNT_TYPE_LABELS[type] ?? type;
  }
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${k}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Drop empty arrays so {} and {qtyTiers: []} compare equal. */
function cleanConfig(c: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const ruleKey = (r: PlannedRule) => `${r.scope}:${(r.value ?? "").toLowerCase()}`;

function ruleLabel(r: PlannedRule): string {
  if (r.scope === "all") return "everything (storewide)";
  return `${r.scope} "${r.value}"`;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export function planDailyDeals(existing: ExistingDailyPromo[]): DailyDealPlan {
  const byKey = new Map<string, ExistingDailyPromo>();
  for (const p of existing) if (p.promo_key) byKey.set(p.promo_key, p);

  const items: DailyDealPlanItem[] = [];
  const manual: DailyDealPlan["manual"] = [];

  for (const seed of DAILY_DEAL_SEEDS) {
    const dayLabel = WEEKDAY_LABELS[seed.weekday];
    if (MANUAL_DAILY_KEYS.has(seed.promoKey)) {
      manual.push({
        promoKey: seed.promoKey,
        dayLabel,
        note: "Set up by hand each week (pick the brands). Use the Guided Thursday setup or the Thursday planner.",
      });
      continue;
    }
    const cur = byKey.get(seed.promoKey) ?? null;
    const config = cleanConfig(standardConfigFor(seed) as Record<string, unknown>);
    const targets = standardTargets(seed);
    const targetKeys = new Set(targets.map(ruleKey));

    // Keep staff carve-outs, but never an exclusion that cancels the deal's own target.
    const keptExclusions: PlannedRule[] = [];
    const droppedExclusions: PlannedRule[] = [];
    for (const e of cur?.exclusions ?? []) {
      const r = { scope: e.scope, value: e.value };
      if (r.scope === "all") {
        droppedExclusions.push(r);
        continue;
      }
      if (r.scope === "category" && targetKeys.has(ruleKey(r))) droppedExclusions.push(r);
      else keptExclusions.push(r);
    }

    const input: PlannedInput = {
      promo_key: seed.promoKey,
      title: cur?.title?.trim() ? cur.title : seed.title,
      description: cur?.description?.trim() ? cur.description : seed.description,
      discount_type: seed.discountType,
      discount_percent: seed.discountPercent,
      discount_fixed: 0,
      multi_item_percent: seed.multiItemPercent ?? null,
      config,
      per_item_sale: seed.perItemSale,
      bonus_note: cur?.bonus_note?.trim() ? cur.bonus_note : seed.bonusNote ?? null,
      weekday: seed.weekday,
      starts_at: null,
      ends_at: null,
      priority: seed.priority,
    };
    const summary = `${dayLabel}: ${describeMechanics(seed.discountType, seed.discountPercent, config)} on ${
      seed.storewide ? "everything storewide (not accessories or merch)" : (seed.targetCategories ?? []).join(", ")
    }.`;

    if (!cur) {
      items.push({
        promoKey: seed.promoKey,
        weekday: seed.weekday,
        dayLabel,
        title: input.title,
        action: "create",
        existingId: null,
        changes: [`Create "${input.title}" and publish it.`],
        summary,
        input,
        targets,
        exclusions: [],
      });
      continue;
    }

    const changes: string[] = [];
    if (cur.discount_type !== seed.discountType) {
      changes.push(`Type: ${DISCOUNT_TYPE_LABELS[cur.discount_type] ?? cur.discount_type} → ${DISCOUNT_TYPE_LABELS[seed.discountType]}.`);
    }
    if (Number(cur.discount_percent) !== seed.discountPercent) {
      changes.push(`Headline percent: ${Number(cur.discount_percent)}% → ${seed.discountPercent}%.`);
    }
    const curCfg = cleanConfig(cur.config);
    if (stable(curCfg) !== stable(config)) {
      const before = describeMechanics(cur.discount_type, Number(cur.discount_percent), curCfg as EngineConfig);
      const after = describeMechanics(seed.discountType, seed.discountPercent, config as EngineConfig);
      changes.push(`Mechanics: ${before} → ${after}.`);
    }
    if (Number(cur.discount_fixed) !== 0) changes.push(`Fixed amount off: cleared (was ${cur.discount_fixed}¢).`);
    if ((cur.multi_item_percent ?? null) !== input.multi_item_percent) {
      changes.push(`Multi-item %: ${cur.multi_item_percent ?? "blank"} → ${input.multi_item_percent ?? "blank"}.`);
    }
    if (cur.per_item_sale !== seed.perItemSale) {
      changes.push(`Struck price on menu cards: ${cur.per_item_sale ? "on" : "off"} → ${seed.perItemSale ? "on" : "off"}.`);
    }
    if (cur.weekday !== seed.weekday) {
      changes.push(`Day: ${cur.weekday == null ? "none" : WEEKDAY_LABELS[cur.weekday as Weekday]} → every ${dayLabel}.`);
    }
    if (cur.starts_at || cur.ends_at) changes.push("Old start/end dates cleared (the weekday decides).");
    if (cur.priority !== seed.priority) changes.push(`Priority: ${cur.priority} → ${seed.priority}.`);

    const curTargets = new Set(cur.targets.map((t) => ruleKey({ scope: t.scope, value: t.value })));
    const add = targets.filter((t) => !curTargets.has(ruleKey(t)));
    const remove = cur.targets.filter((t) => !targetKeys.has(ruleKey({ scope: t.scope, value: t.value })));
    if (add.length) changes.push(`Add to the deal: ${add.map(ruleLabel).join(", ")}.`);
    if (remove.length) changes.push(`Take off the deal: ${remove.map((r) => ruleLabel({ scope: r.scope, value: r.value })).join(", ")}.`);
    if (droppedExclusions.length) {
      changes.push(`Remove exclusions that cancelled the deal's own items: ${droppedExclusions.map(ruleLabel).join(", ")}.`);
    }
    if (cur.status !== "published") changes.push(`Status: ${cur.status} → published.`);

    items.push({
      promoKey: seed.promoKey,
      weekday: seed.weekday,
      dayLabel,
      title: input.title,
      action: changes.length ? "update" : "unchanged",
      existingId: cur.id,
      changes,
      summary,
      input,
      targets,
      exclusions: keptExclusions,
    });
  }

  items.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)); // Mon → Sun
  return { items, manual, toChange: items.filter((i) => i.action !== "unchanged").length };
}

/** One-line result for the banner after the button runs. */
export function dailySetupOutcomeMessage(r: { created: string[]; updated: string[]; unchanged: string[]; skipped: { day: string; reason: string }[] }): string {
  const parts: string[] = [];
  if (r.created.length) parts.push(`Created ${r.created.join(", ")}.`);
  if (r.updated.length) parts.push(`Updated ${r.updated.join(", ")}.`);
  if (r.unchanged.length) parts.push(`Already right: ${r.unchanged.join(", ")}.`);
  if (r.skipped.length) parts.push(`Not changed: ${r.skipped.map((s) => `${s.day} (${s.reason})`).join("; ")}.`);
  if (!parts.length) return "Nothing to do.";
  return `${parts.join(" ")} Thursday was not touched (manual).`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runDailyDealSetupTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`daily-deal-setup FAIL: ${name}`);
    }
  };

  const row = (p: Partial<ExistingDailyPromo> & { promo_key: string }): ExistingDailyPromo => ({
    id: `id-${p.promo_key}`,
    title: "T",
    description: null,
    bonus_note: null,
    status: "published",
    discount_type: "percent",
    discount_percent: 0,
    discount_fixed: 0,
    multi_item_percent: null,
    per_item_sale: true,
    config: {},
    weekday: null,
    starts_at: null,
    ends_at: null,
    priority: 0,
    targets: [],
    exclusions: [],
    ...p,
  });

  // Empty DB: six creates, Thursday manual.
  const empty = planDailyDeals([]);
  ok("six managed days", empty.items.length === 6);
  ok("thursday never planned", !empty.items.some((i) => i.promoKey === "daily.thursday"));
  ok("thursday listed as manual", empty.manual.length === 1 && empty.manual[0].promoKey === "daily.thursday");
  ok("all create", empty.items.every((i) => i.action === "create"));
  ok("monday first", empty.items[0].promoKey === "daily.monday");
  ok("sunday last", empty.items[5].promoKey === "daily.sunday");
  ok("toChange 6", empty.toChange === 6);

  const mon = empty.items.find((i) => i.promoKey === "daily.monday")!;
  ok("monday 25%", mon.input.discount_percent === 25 && mon.input.discount_type === "percent");
  ok("monday 4 categories", mon.targets.length === 4 && mon.targets.every((t) => t.scope === "category"));
  const tue = empty.items.find((i) => i.promoKey === "daily.tuesday")!;
  ok("tuesday qty tiers 1→20 4→25", stable(tue.input.config) === stable({ qtyTiers: [{ at: 1, percent: 20 }, { at: 4, percent: 25 }] }));
  ok("tuesday no eitherOr", !("eitherOr" in tue.input.config));
  const wed = empty.items.find((i) => i.promoKey === "daily.wednesday")!;
  ok("wednesday spend tiers 0→20 $150→30", stable(wed.input.config) === stable({ spendTiers: [{ at: 0, percent: 20 }, { at: 15000, percent: 30 }] }));
  ok("wednesday includes rso", wed.targets.some((t) => t.value === "rso"));
  const fri = empty.items.find((i) => i.promoKey === "daily.friday")!;
  ok("friday explicit weight tiers", Array.isArray(fri.input.config.weightTiers) && (fri.input.config.weightTiers as unknown[]).length === 3);
  ok("friday not storewide", !fri.targets.some((t) => t.scope === "all"));
  const sat = empty.items.find((i) => i.promoKey === "daily.saturday")!;
  ok("saturday basket top item 30/15", sat.input.discount_type === "basket" && stable(sat.input.config) === stable({ basketTopItem: { topPercent: 30, restPercent: 15 } }));
  ok("saturday storewide", sat.targets.length === 1 && sat.targets[0].scope === "all");
  const sun = empty.items.find((i) => i.promoKey === "daily.sunday")!;
  ok("sunday 3 for 2", stable(sun.input.config) === stable({ basketNforM: { n: 3, m: 2 } }));
  ok("summary names the day", sun.summary.startsWith("Sunday:"));

  // The live 11/2 rows.
  const live: ExistingDailyPromo[] = [
    row({ promo_key: "daily.sunday", title: "Ice Cream Sunday", discount_type: "basket", weekday: 0, targets: [{ scope: "all", value: null }] }),
    row({ promo_key: "daily.monday", title: "Munchie Monday", discount_percent: 20, weekday: 1, targets: ["edible-solid", "edible-liquid", "tincture", "rso"].map((v) => ({ scope: "category" as const, value: v })) }),
    row({ promo_key: "daily.tuesday", title: "Doobie Tuesday", discount_type: "multi_item_tier", weekday: 2, config: { eitherOr: { bundle: { m: 3, n: 4 }, flatPercent: 20 } } }),
    row({
      promo_key: "daily.wednesday",
      title: "Wax Wednesday",
      discount_type: "threshold_spend",
      weekday: 3,
      starts_at: "2026-10-21T00:01:00Z",
      targets: ["concentrate", "cartridge", "disposable-cartridge"].map((v) => ({ scope: "category" as const, value: v })),
      exclusions: [{ scope: "category", value: "rso" }, { scope: "category", value: "flower" }, { scope: "product", value: "pk-1" }],
    }),
    row({ promo_key: "daily.thursday", title: "Top Shelf Thursday", discount_percent: 25, weekday: 4, targets: [{ scope: "brand", value: "1937" }] }),
    row({ promo_key: "daily.friday", title: "Ounce Friday", discount_type: "weight_tier", weekday: 5, config: { weightTiers: DEFAULT_WEIGHT_TIERS }, targets: [{ scope: "category", value: "flower" }, { scope: "category", value: "popcorn-bud" }, { scope: "all", value: null }] }),
    row({ promo_key: "daily.saturday", title: "Super Saturday", weekday: 6 }),
  ];
  const p = planDailyDeals(live);
  const get = (k: string) => p.items.find((i) => i.promoKey === k)!;
  ok("live: thursday untouched", !p.items.some((i) => i.promoKey === "daily.thursday"));
  ok("live: monday update 20→25", get("daily.monday").action === "update" && get("daily.monday").changes.some((c) => c.includes("20% → 25%")));
  ok("live: tuesday mechanics change", get("daily.tuesday").changes.some((c) => c.startsWith("Mechanics:")));
  ok("live: wednesday tiers added", get("daily.wednesday").changes.some((c) => c.includes("20% on any amount")));
  ok("live: wednesday dates cleared", get("daily.wednesday").changes.some((c) => c.includes("start/end")));
  ok("live: wednesday rso exclusion dropped", get("daily.wednesday").changes.some((c) => c.includes('category "rso"')) && !get("daily.wednesday").exclusions.some((e) => e.value === "rso"));
  ok("live: wednesday keeps product carve-out", get("daily.wednesday").exclusions.some((e) => e.scope === "product" && e.value === "pk-1"));
  ok("live: wednesday keeps harmless flower exclusion", get("daily.wednesday").exclusions.some((e) => e.value === "flower"));
  ok("live: friday storewide removed", get("daily.friday").changes.some((c) => c.includes("everything (storewide)")));
  ok("live: friday adds infused-flower + trim", get("daily.friday").changes.some((c) => c.includes("infused-flower") && c.includes("trim")));
  ok("live: saturday type → basket", get("daily.saturday").changes.some((c) => c.startsWith("Type:")));
  ok("live: saturday 0 → 30", get("daily.saturday").changes.some((c) => c.includes("0% → 30%")));
  ok("live: kept owner title", get("daily.monday").input.title === "Munchie Monday");
  ok("live: blank description filled from standard", get("daily.monday").input.description === DAILY_DEAL_SEEDS[0].description);
  ok("live: priority to 10", get("daily.sunday").changes.some((c) => c.includes("Priority: 0 → 10")));

  // Re-running on a correct plan is a no-op.
  const fixed: ExistingDailyPromo[] = p.items.map((i) => row({
    id: i.existingId ?? "x",
    ...i.input,
    promo_key: i.promoKey,
    status: "published",
    targets: i.targets,
    exclusions: i.exclusions,
  } as Partial<ExistingDailyPromo> & { promo_key: string }));
  const again = planDailyDeals(fixed);
  ok("second run: nothing to change", again.toChange === 0);
  ok("second run: all unchanged", again.items.every((i) => i.action === "unchanged" && i.changes.length === 0));

  // Draft gets published.
  const draft = planDailyDeals(fixed.map((f) => (f.promo_key === "daily.sunday" ? { ...f, status: "draft" } : f)));
  ok("draft → published", draft.items.find((i) => i.promoKey === "daily.sunday")!.changes.some((c) => c.includes("draft → published")));

  // Message.
  const msg = dailySetupOutcomeMessage({ created: [], updated: ["Monday"], unchanged: ["Sunday"], skipped: [{ day: "Friday", reason: "below cost" }] });
  ok("message mentions thursday", msg.includes("Thursday was not touched"));
  ok("message mentions skip", msg.includes("Friday (below cost)"));
  ok("describe eitherOr", describeMechanics("multi_item_tier", 0, { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } }).includes("better one for the customer"));
  ok("describe empty spend shows fallback", describeMechanics("threshold_spend", 0, {}).includes("engine default"));

  return { passed, failed };
}
