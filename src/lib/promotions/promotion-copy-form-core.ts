/**
 * src/lib/promotions/promotion-copy-form-core.ts  (D135)
 *
 * Reads the promotion form's raw field values into a CopyCheckInput, using the
 * SAME field names and the SAME tier rules as the save action's buildConfig
 * (admin/promotions/actions.ts): tiers need at >= 0 and percent > 0, spend tiers
 * are typed in dollars and stored in cents, basket mode picks one option. This
 * lets the live wording check judge what WILL be saved.
 *
 * Pure (no React, no DB).
 */
import type { CopyCheckInput } from "./promotion-copy-core";

type Get = (k: string) => string | null;
type GetAll = (k: string) => string[];

function tiers(getAll: GetAll, prefix: string, scale = 1): { at: number; percent: number }[] {
  const ats = getAll(`${prefix}_at`);
  const pcts = getAll(`${prefix}_percent`);
  const out: { at: number; percent: number }[] = [];
  for (let i = 0; i < Math.min(ats.length, pcts.length); i++) {
    if (ats[i] === "" || pcts[i] === "") continue;
    const at = Number(ats[i]);
    const percent = Number(pcts[i]);
    if (Number.isFinite(at) && at >= 0 && Number.isFinite(percent) && percent > 0) {
      out.push({ at: Math.round(at * scale), percent: Math.min(99, Math.round(percent)) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const n = (get: Get, k: string) => {
  const v = get(k);
  if (v == null || v === "") return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function copyInputFromForm(get: Get, getAll: GetAll): CopyCheckInput {
  const type = get("discount_type") ?? "percent";
  const config: NonNullable<CopyCheckInput["config"]> = {};
  if (type === "multi_item_tier") {
    const q = tiers(getAll, "cfg_qty_tier");
    if (q.length) config.qtyTiers = q;
    const flat = n(get, "cfg_eo_flat");
    const bn = Math.round(n(get, "cfg_eo_n"));
    const bm = Math.round(n(get, "cfg_eo_m"));
    if (flat > 0 && bn >= 2 && bm >= 0 && bm < bn) config.eitherOr = { flatPercent: Math.min(99, Math.round(flat)), bundle: { n: bn, m: bm } };
  } else if (type === "weight_tier") {
    const w = tiers(getAll, "cfg_weight_tier");
    if (w.length) config.weightTiers = w;
  } else if (type === "threshold_spend") {
    const s = tiers(getAll, "cfg_spend_tier", 100);
    if (s.length) config.spendTiers = s;
  } else if (type === "bogo") {
    const buyQty = Math.round(n(get, "cfg_bogo_buy"));
    const getQty = Math.round(n(get, "cfg_bogo_get"));
    const getPercent = Math.round(n(get, "cfg_bogo_percent"));
    if (buyQty >= 1 && getQty >= 1 && getPercent > 0) config.bogo = { buyQty, getQty, getPercent: Math.min(99, getPercent) };
  } else if (type === "basket") {
    if (get("cfg_basket_mode") === "top_item") {
      const top = Math.round(n(get, "cfg_top_percent"));
      if (top > 0) config.basketTopItem = { topPercent: Math.min(99, top), restPercent: Math.max(0, Math.min(99, Math.round(n(get, "cfg_rest_percent")))) };
    } else {
      const bn = Math.round(n(get, "cfg_basket_n"));
      const bm = Math.round(n(get, "cfg_basket_m"));
      if (bn >= 2 && bm >= 0 && bm < bn) config.basketNforM = { n: bn, m: bm };
    }
  }
  const wd = get("weekday");
  const weekday = wd == null || wd === "" ? null : Number(wd);
  return {
    title: get("title") ?? "",
    description: get("description"),
    bonusNote: get("bonus_note"),
    discountType: type,
    discountPercent: n(get, "discount_percent"),
    config,
    weekday: weekday != null && weekday >= 0 && weekday <= 6 ? weekday : null,
    storewide: getAll("target_scope").includes("all"),
    targetCategories: getAll("target_category").filter(Boolean),
    targetBrands: getAll("target_brand").filter(Boolean),
  };
}

export function __runPromotionCopyFormTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`promotion-copy-form FAIL: ${name}`);
    }
  };
  const mk = (one: Record<string, string>, many: Record<string, string[]> = {}) =>
    copyInputFromForm(
      (k) => (k in one ? one[k] : many[k]?.[0] ?? null),
      (k) => many[k] ?? (k in one ? [one[k]] : []),
    );

  const wed = mk({ discount_type: "threshold_spend", title: "Wax", weekday: "3" }, { cfg_spend_tier_at: ["0", "150", ""], cfg_spend_tier_percent: ["20", "30", ""], target_category: ["concentrate"] });
  ok("spend tiers dollars → cents", JSON.stringify(wed.config?.spendTiers) === JSON.stringify([{ at: 0, percent: 20 }, { at: 15000, percent: 30 }]));
  ok("weekday parsed", wed.weekday === 3);
  ok("not storewide", wed.storewide === false);
  ok("categories read", wed.targetCategories?.[0] === "concentrate");
  const tue = mk({ discount_type: "multi_item_tier", title: "T" }, { cfg_qty_tier_at: ["4", "1"], cfg_qty_tier_percent: ["25", "20"] });
  ok("qty tiers sorted", tue.config?.qtyTiers?.[0].at === 1);
  const sat = mk({ discount_type: "basket", title: "S", cfg_basket_mode: "top_item", cfg_top_percent: "30", cfg_rest_percent: "15" }, { target_scope: ["all"] });
  ok("basket top item", sat.config?.basketTopItem?.topPercent === 30 && sat.config.basketTopItem.restPercent === 15);
  ok("storewide read", sat.storewide === true);
  const sun = mk({ discount_type: "basket", title: "S", cfg_basket_mode: "n_for_m", cfg_basket_n: "3", cfg_basket_m: "2" });
  ok("basket n for m", sun.config?.basketNforM?.n === 3);
  const other = mk({ discount_type: "percent", title: "P", discount_percent: "25", cfg_basket_n: "3", cfg_basket_m: "2" });
  ok("percent ignores mechanics", Object.keys(other.config ?? {}).length === 0 && other.discountPercent === 25);
  ok("blank weekday → null", mk({ title: "x", weekday: "" }).weekday === null);
  const bogo = mk({ discount_type: "bogo", title: "B", cfg_bogo_buy: "1", cfg_bogo_get: "1", cfg_bogo_percent: "100" });
  ok("bogo capped at 99", bogo.config?.bogo?.getPercent === 99);
  return { passed, failed };
}
