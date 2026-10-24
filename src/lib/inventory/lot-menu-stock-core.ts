/**
 * src/lib/inventory/lot-menu-stock-core.ts  (R74 S32, pure)
 *
 * WHAT. Leafly and the website read stock from the MENU (menu_variants.
 * inventory_level), not from the lots. A sale moves both (sale-decrement), a
 * void moves both (void-store), but before S32 a lot adjustment, a disposition
 * (shrink, damage, destruction, return add-back), a Cultivera count or a
 * legacy-lot removal moved ONLY the lot. The shelf said 2, Leafly kept saying
 * 7. Owner round 13: "full price and quantity control of Cultivera products
 * without waiting on onboarding; cost stays locked".
 *
 * HOW. After a lot's on-hand moves by `delta`, the SAME delta is applied to
 * the menu size that lot sells as, on the published version and on each
 * staged version (the price writer's rule, so a pending publish carries the
 * truth too). The size is found exactly as the price writer finds it
 * (price-variant-match-core resolveLotVariant: the S30 size link, then the
 * intake "-onboarded" size, then a one-size card). A multi-size card whose
 * lot is not linked is AMBIGUOUS: nothing is guessed, the caller says "pick
 * this lot's size" (the lot page offers it).
 *
 * The card's stock status is recomputed with the sale thresholds
 * (statusForLevelTotal). A REMOVAL never flips a card whose sizes tracked no
 * stock (all zero = untracked, the sale rule); an ADDITION may wake a sold
 * out card. Price, cost, hidden and every other field are never touched.
 *
 * Pure: no I/O. Self-tested via __runLotMenuStockCoreTests().
 */
import { statusForLevelTotal, type InventoryStatusSlug } from "@/lib/inventory/sale-decrement-core";

export type MenuStockVariant = { id: string; inventory_level: number | null };

export type MenuStockMatch =
  | { kind: "linked" | "onboarded" | "single-card"; variantId: string; cardVariants: MenuStockVariant[]; itemStatus: string | null }
  | { kind: "ambiguous"; variantCount: number }
  | { kind: "none" };

export type MenuStockStep =
  | {
      action: "write";
      variantId: string;
      delta: number;
      /** The absolute level to write if the atomic RPC (0129) is missing. */
      fallbackLevel: number;
      /** The card's status after the write, or null when it must not change. */
      newStatus: InventoryStatusSlug | null;
    }
  | { action: "skip"; reason: "zero-delta" | "not-on-menu" }
  | { action: "ambiguous"; variantCount: number };

const lvl = (n: number | null | undefined): number => Math.max(0, Math.trunc(Number(n) || 0));

/**
 * Plan one version's write. `postLevelOverride` is the level the atomic RPC
 * reported after the write (null before it ran or on fallback); it lets the
 * caller recompute the status from the truth when another writer landed in
 * between.
 */
export function planMenuStockStep(match: MenuStockMatch, delta: number, postLevelOverride?: number | null): MenuStockStep {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return { action: "skip", reason: "zero-delta" };
  if (match.kind === "none") return { action: "skip", reason: "not-on-menu" };
  if (match.kind === "ambiguous") return { action: "ambiguous", variantCount: match.variantCount };
  const target = match.cardVariants.find((v) => v.id === match.variantId);
  const before = lvl(target?.inventory_level);
  const after = postLevelOverride != null && Number.isFinite(postLevelOverride) ? lvl(postLevelOverride) : Math.max(0, before + d);
  const preTotal = match.cardVariants.reduce((s, v) => s + lvl(v.inventory_level), 0);
  const postTotal = match.cardVariants.reduce((s, v) => s + (v.id === match.variantId ? after : lvl(v.inventory_level)), 0);
  let newStatus: InventoryStatusSlug | null = null;
  // A removal never flips an untracked card (the sale rule); an addition may wake it.
  if (!(d < 0 && preTotal <= 0)) {
    const s = statusForLevelTotal(postTotal);
    if (s !== match.itemStatus) newStatus = s;
  }
  return { action: "write", variantId: match.variantId, delta: d, fallbackLevel: Math.max(0, before + d), newStatus };
}

export type MenuStockVersionOutcome = {
  status: "published" | "staged";
  result: "written" | "not-on-menu" | "ambiguous" | "failed" | "skipped";
  error?: string;
};

/**
 * One plain sentence for the owner about what happened to the menu stock, or
 * null when there is nothing to say (written everywhere it exists, or a zero
 * change). Names the lot so a batch report stays readable.
 */
export function menuStockSentence(lotLabel: string, delta: number, outcomes: readonly MenuStockVersionOutcome[]): string | null {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0 || outcomes.length === 0) return null;
  const name = (lotLabel ?? "").trim() || "This lot";
  const failed = outcomes.filter((o) => o.result === "failed");
  if (failed.length > 0) {
    return `${name}: the lot changed by ${d} but the menu stock could not be updated (${failed.map((f) => f.error ?? "unknown error").join("; ").slice(0, 300)}). Leafly and the website still show the old quantity until it is fixed.`;
  }
  if (outcomes.some((o) => o.result === "ambiguous")) {
    return `${name}: the lot changed by ${d}, but its menu card has several sizes and this lot is not linked to one, so the menu stock was not changed. Pick its size in "Which size is this lot?" and adjust the menu quantity once.`;
  }
  const published = outcomes.find((o) => o.status === "published");
  if (published && published.result === "not-on-menu") {
    return `${name}: the lot changed by ${d}; it is not on the live menu, so there was no menu stock to change.`;
  }
  return null;
}

export function __runLotMenuStockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`lot-menu-stock-core FAIL: ${msg}`);
    }
  };
  const card = (levels: number[], status = "in-stock"): MenuStockMatch => ({
    kind: "linked",
    variantId: "v0",
    cardVariants: levels.map((l, i) => ({ id: `v${i}`, inventory_level: l })),
    itemStatus: status,
  });

  // 1-4: removal on a tracked card
  const a = planMenuStockStep(card([7, 2]), -5);
  ok(a.action === "write", "removal writes");
  ok(a.action === "write" && a.delta === -5 && a.fallbackLevel === 2, "removal delta and fallback level");
  ok(a.action === "write" && a.variantId === "v0", "writes the lot's own size");
  ok(a.action === "write" && a.newStatus === null, "7+2 -> 2+2 = 4 stays in-stock (null)");

  // 5-6: removal to low stock / zero
  const b = planMenuStockStep(card([3, 0]), -1);
  ok(b.action === "write" && b.newStatus === "low-stock", "3 -> 2 total flips to low-stock");
  const c = planMenuStockStep(card([2, 0], "low-stock"), -5);
  ok(c.action === "write" && c.fallbackLevel === 0 && c.newStatus === "unavailable", "floored at 0, unavailable");

  // 7: removal on an untracked card never flips status
  const u = planMenuStockStep(card([0, 0], "in-stock"), -1);
  ok(u.action === "write" && u.newStatus === null, "untracked card keeps its status on a removal");

  // 8-9: addition wakes a sold-out card
  const w = planMenuStockStep(card([0, 0], "unavailable"), 6);
  ok(w.action === "write" && w.fallbackLevel === 6, "addition fallback level");
  ok(w.action === "write" && w.newStatus === "in-stock", "addition wakes the card");

  // 10: post-level override (RPC truth) drives the status
  const o = planMenuStockStep(card([10, 0]), -1, 1);
  ok(o.action === "write" && o.newStatus === "low-stock" && o.fallbackLevel === 9, "override recomputes from the RPC level");

  // 11-13: skip / ambiguous / none
  ok(planMenuStockStep(card([5]), 0).action === "skip", "zero delta skips");
  const amb = planMenuStockStep({ kind: "ambiguous", variantCount: 3 }, -1);
  ok(amb.action === "ambiguous" && amb.variantCount === 3, "ambiguous never writes");
  const none = planMenuStockStep({ kind: "none" }, -1);
  ok(none.action === "skip" && none.reason === "not-on-menu", "not on menu skips");

  // 14: other sizes are never written (plan names exactly one variant)
  const s = planMenuStockStep({ kind: "single-card", variantId: "v1", cardVariants: [{ id: "v0", inventory_level: 4 }, { id: "v1", inventory_level: 4 }], itemStatus: "in-stock" }, -4);
  ok(s.action === "write" && s.variantId === "v1" && s.fallbackLevel === 0, "only the lot's own size");

  // 15-19: sentences
  ok(menuStockSentence("Lot A", -2, [{ status: "published", result: "written" }]) === null, "written = silent");
  ok((menuStockSentence("Lot A", -2, [{ status: "published", result: "ambiguous" }]) ?? "").includes("Which size is this lot?"), "ambiguous names the fix");
  ok((menuStockSentence("Lot A", -2, [{ status: "published", result: "failed", error: "boom" }]) ?? "").includes("boom"), "failure is loud with the reason");
  ok((menuStockSentence("Lot A", 3, [{ status: "published", result: "not-on-menu" }]) ?? "").includes("not on the live menu"), "not on menu said");
  ok(menuStockSentence("Lot A", 0, [{ status: "published", result: "failed" }]) === null, "zero change says nothing");

  // 20: a NaN delta is a zero (never writes garbage)
  ok(planMenuStockStep(card([5]), Number.NaN).action === "skip", "NaN delta skips");

  return { passed, failed };
}
