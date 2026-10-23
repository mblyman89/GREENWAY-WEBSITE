/**
 * src/lib/promotions/bad-product-queue-core.ts  (R74 S27, owner round 12)
 *
 * Owner, round 12: "I like the bad product queue and preview before
 * publishing features. Please add those in this next round."
 * Round 11 proposal it answers: "one screen listing every product that's
 * hidden, missing a cost, or under the legal minimum price, each with a fix
 * button. Problems would get fixed before a promotion runs into them."
 *
 * PURE. No I/O, no env. The loader is bad-product-queue.ts. Every problem is
 * an EXISTING signal, decided by the EXISTING rule (nothing new is invented):
 *
 *   no_price         a visible published card whose price, or one of whose
 *                    sizes, is $0 or less (the register cannot ring a real
 *                    sale for it).
 *   below_floor      a visible card whose REGULAR price is at or below its
 *                    cost floor: exactly promo-guard-core's
 *                    "regular_below_cost" test (price <= costFloorMinorUnits(
 *                    weighted-average cost, merch)).
 *   needs_category   a card held by the transform (hidden_reason
 *                    "needs_category", cultivera-category-gate-core).
 *   no_cost          a visible card with no acquisition cost on file
 *                    (promo-guard-core "cost_unknown"): its cost floor is 0,
 *                    so the register's below-cost clamp cannot bind for it.
 *                    A product on the never-discount list is NOT listed: no
 *                    deal can touch it, so the risk is already closed.
 *   missing_coa      a visible cannabis card with an active lot holding stock
 *                    and no lab result linked (InventoryStats.missingCoa
 *                    rule, scoped to stock). Merch never needs a COA.
 *   hidden_with_stock a hidden card (other than needs_category) whose
 *                    product still has active lots with stock on hand.
 *
 * Fixes (the server re-checks the queue at press time; see pickQueueFix):
 *   hide  -> the product page's reversible Visibility write (S22 reuse).
 *   never -> the store-wide never-discount list (S23 reuse).
 * Every other fix is a link to the page that really fixes it.
 */
import { costFloorMinorUnits } from "./discount-engine-core";
import { MERCH_TOKENS } from "./promo-guard-core";
import { heldForCategory } from "@/lib/inventory/cultivera-category-gate-core";

export type QueueKind =
  | "no_price"
  | "below_floor"
  | "needs_category"
  | "no_cost"
  | "missing_coa"
  | "hidden_with_stock";

/** Worst first. The page renders sections in this order. */
export const QUEUE_KINDS: readonly QueueKind[] = [
  "no_price",
  "below_floor",
  "needs_category",
  "no_cost",
  "missing_coa",
  "hidden_with_stock",
];

export type QueueFix = "hide" | "never";

/** Which press-button fixes each kind allows (links are not listed here). */
export const FIXES_FOR_KIND: Readonly<Record<QueueKind, readonly QueueFix[]>> = {
  no_price: ["hide"],
  below_floor: ["hide", "never"],
  needs_category: [],
  no_cost: ["hide", "never"],
  missing_coa: ["hide"],
  hidden_with_stock: [],
};

export const MAX_QUEUE_FIX_PER_PRESS = 100;

/** A published card reduced to what the queue needs. */
export type QueueCard = {
  key: string;
  name: string;
  brand: string;
  /** Lowercased category tokens (filter_categories, else category). */
  categories: string[];
  priceMinor: number;
  hidden: boolean;
  hiddenReason: string | null;
  /** Prices of the card's sizes (menu_variants.price_minor_units). */
  variantPrices: number[];
};

/** An inventory lot reduced to what the queue needs. */
export type QueueLot = {
  id: string;
  key: string | null;
  status: string;
  onHand: number;
  hasCoa: boolean;
  createdAt: string;
};

export type QueueRow = {
  key: string;
  name: string;
  brand: string;
  priceMinor: number;
  /** Weighted-average pre-tax cost (null = none on file). */
  costMinor: number | null;
  /** Tax-inclusive floor (0 when the cost is unknown). */
  floorMinor: number;
  kinds: QueueKind[];
  hidden: boolean;
  hiddenReason: string | null;
  merch: boolean;
  onNeverList: boolean;
  /** Sizes on the card. More than one = the lot page cannot change its price. */
  variantCount: number;
  /** Active lots with stock. */
  stockLots: number;
  /** Lot to open for a price / category fix (active newest, else newest). */
  lotId: string | null;
  /** An active, stocked lot with no COA (for the #coa link). */
  coaLotId: string | null;
  coaMissingLots: number;
};

export type BadProductQueue = {
  rows: QueueRow[];
  counts: Record<QueueKind, number>;
  /** Published cards looked at. */
  scanned: number;
};

function isMerch(categories: readonly string[]): boolean {
  return categories.some((c) => MERCH_TOKENS.includes(c.toLowerCase()));
}

function newestFirst(a: QueueLot, b: QueueLot): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

function emptyCounts(): Record<QueueKind, number> {
  return { no_price: 0, below_floor: 0, needs_category: 0, no_cost: 0, missing_coa: 0, hidden_with_stock: 0 };
}

/**
 * Build the queue. `costs` is the guard's weighted-average cost map
 * (loadProductCostsChecked); `neverKeys` the never-discount list. Keys that
 * appear on several cards are judged once (first card wins, like the
 * guard's menu join which keys by source_item_id).
 */
export function buildBadProductQueue(input: {
  cards: readonly QueueCard[];
  costs: ReadonlyMap<string, number>;
  neverKeys: ReadonlySet<string>;
  lots: readonly QueueLot[];
}): BadProductQueue {
  const lotsByKey = new Map<string, QueueLot[]>();
  for (const l of input.lots) {
    const k = (l.key ?? "").trim();
    if (!k) continue;
    const list = lotsByKey.get(k) ?? [];
    list.push(l);
    lotsByKey.set(k, list);
  }
  const counts = emptyCounts();
  const rows: QueueRow[] = [];
  const seen = new Set<string>();
  for (const c of input.cards) {
    const key = (c.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const merch = isMerch(c.categories);
    const rawCost = input.costs.get(key);
    const costMinor = rawCost != null && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;
    const floorMinor = costFloorMinorUnits(costMinor, merch);
    const lots = lotsByKey.get(key) ?? [];
    const stocked = lots.filter((l) => l.status === "active" && l.onHand > 0);
    const noCoa = stocked.filter((l) => !l.hasCoa).sort(newestFirst);
    const active = lots.filter((l) => l.status === "active").sort(newestFirst);
    const lotId = (active[0] ?? [...lots].sort(newestFirst)[0])?.id ?? null;
    const onNeverList = input.neverKeys.has(key);
    const kinds: QueueKind[] = [];

    if (heldForCategory(c.hiddenReason)) {
      kinds.push("needs_category");
    } else if (c.hidden) {
      if (stocked.length > 0) kinds.push("hidden_with_stock");
    } else {
      const price = Number.isFinite(c.priceMinor) ? c.priceMinor : 0;
      const badSize = c.variantPrices.some((p) => !Number.isFinite(p) || p <= 0);
      if (price <= 0 || badSize) kinds.push("no_price");
      if (costMinor != null && price > 0 && price <= floorMinor) kinds.push("below_floor");
      if (costMinor == null && !onNeverList) kinds.push("no_cost");
      if (!merch && noCoa.length > 0) kinds.push("missing_coa");
    }
    if (kinds.length === 0) continue;
    for (const k of kinds) counts[k] += 1;
    rows.push({
      key,
      name: c.name,
      brand: c.brand,
      priceMinor: c.priceMinor,
      costMinor,
      floorMinor,
      kinds,
      hidden: c.hidden,
      hiddenReason: c.hiddenReason,
      merch,
      onNeverList,
      variantCount: c.variantPrices.length,
      stockLots: stocked.length,
      lotId,
      coaLotId: noCoa[0]?.id ?? null,
      coaMissingLots: noCoa.length,
    });
  }
  return { rows, counts, scanned: seen.size };
}

/** The rows in one section (a row with several problems shows in each). */
export function rowsOfKind(q: BadProductQueue, kind: QueueKind): QueueRow[] {
  return q.rows.filter((r) => r.kinds.includes(kind));
}

/** Does this row allow this press-button fix right now? */
export function rowAllowsFix(row: QueueRow, fix: QueueFix): boolean {
  if (fix === "never" && row.onNeverList) return false;
  if (fix === "hide" && row.hidden) return false;
  return row.kinds.some((k) => FIXES_FOR_KIND[k].includes(fix));
}

export type QueuePick = { ok: true; picks: QueueRow[] } | { ok: false; error: string };

/**
 * Which rows a press may change, re-checked against the queue as it is NOW.
 *  - "all" + kind: every row of that kind that allows the fix (at most max).
 *  - keys: each must be in the queue and allow the fix, else the WHOLE press
 *    is refused with the product named (fail closed, nothing changes).
 */
export function pickQueueFix(
  requested: string[] | { all: QueueKind },
  queue: BadProductQueue,
  fix: QueueFix,
  max: number = MAX_QUEUE_FIX_PER_PRESS,
): QueuePick {
  const verb = fix === "hide" ? "hidden" : "put on the never-discount list";
  if (!Array.isArray(requested)) {
    const kind = requested.all;
    if (!QUEUE_KINDS.includes(kind) || !FIXES_FOR_KIND[kind].includes(fix)) {
      return { ok: false, error: "Nothing was changed: that fix does not apply to that list." };
    }
    const all = rowsOfKind(queue, kind).filter((r) => rowAllowsFix(r, fix));
    if (all.length === 0) return { ok: false, error: `Nothing was changed: no product in that list can be ${verb} any more.` };
    return { ok: true, picks: all.slice(0, Math.max(1, max)) };
  }
  const keys = Array.from(new Set(requested.map((k) => String(k ?? "").trim()).filter(Boolean)));
  if (keys.length === 0) return { ok: false, error: "Nothing was changed: pick a product." };
  if (keys.length > max) return { ok: false, error: `Nothing was changed: at most ${max} products per press.` };
  const byKey = new Map(queue.rows.map((r) => [r.key, r]));
  const picks: QueueRow[] = [];
  for (const k of keys) {
    const row = byKey.get(k);
    if (!row || !rowAllowsFix(row, fix)) {
      return {
        ok: false,
        error: `Nothing was changed: product ${row?.name || k} cannot be ${verb} from this queue now (it was fixed already or the page was out of date). Reload and try again.`,
      };
    }
    picks.push(row);
  }
  return { ok: true, picks };
}

/** Plain-English label per kind (section titles). */
export const KIND_TITLE: Readonly<Record<QueueKind, string>> = {
  no_price: "No price",
  below_floor: "Priced at or below the legal floor",
  needs_category: "Waiting for a category",
  no_cost: "No cost on file",
  missing_coa: "Stock with no COA linked",
  hidden_with_stock: "Hidden, but you hold stock",
};

/** What it means, per kind. */
export const KIND_MEANING: Readonly<Record<QueueKind, string>> = {
  no_price: "The card, or one of its sizes, is $0 or less on the live menu, so it cannot be sold at a real price.",
  below_floor: "Its regular price is at or below cost plus tax, so no promotion can discount it and every sale loses money.",
  needs_category: "Cultivera's category gives no product form, so the card is held hidden until somebody picks one.",
  no_cost: "No acquisition cost is on file, so the below-cost clamp cannot protect it in a promotion and margins skip it.",
  missing_coa: "An active lot with stock on hand has no lab result linked.",
  hidden_with_stock: "The card is hidden from the website and register while you still hold stock for it.",
};

/** The reason stored on the product page when hidden from the queue. */
export function queueHideReason(kinds: readonly QueueKind[]): string {
  const named = kinds.map((k) => KIND_TITLE[k].toLowerCase()).join(", ");
  return `Hidden from the bad product queue (${named || "problem product"}). Fix it, then set Visibility to Inherit POS.`;
}

/** The never-discount reason when added from the queue. */
export function queueNeverReason(kinds: readonly QueueKind[]): string {
  const named = kinds.map((k) => KIND_TITLE[k].toLowerCase()).join(", ");
  return `Added from the bad product queue (${named || "problem product"}).`;
}

export type QueueFixOutcome = {
  fix: QueueFix;
  done: { key: string; name: string }[];
  already: { key: string; name: string }[];
  failed: { key: string; name: string; error: string }[];
};

/** The banner after a press. Loud about failures. */
export function queueFixMessage(o: QueueFixOutcome): { tone: "ok" | "error"; text: string } {
  const names = (refs: { key: string; name: string }[]) =>
    refs
      .slice(0, 5)
      .map((r) => r.name || r.key)
      .join(", ") + (refs.length > 5 ? ` and ${refs.length - 5} more` : "");
  const parts: string[] = [];
  const n = o.done.length;
  if (n > 0) {
    parts.push(
      o.fix === "hide"
        ? `Hid ${n} product${n === 1 ? "" : "s"} from the menu: ${names(o.done)}.`
        : `Put ${n} product${n === 1 ? "" : "s"} on the never-discount list: ${names(o.done)}.`,
    );
  }
  if (o.already.length > 0) parts.push(`Already done: ${names(o.already)}.`);
  if (o.failed.length > 0) {
    parts.push(
      `Could not change ${o.failed.length}: ` +
        o.failed
          .slice(0, 3)
          .map((f) => `${f.name || f.key} (${f.error})`)
          .join("; ") +
        (o.failed.length > 3 ? ` and ${o.failed.length - 3} more` : "") +
        ".",
    );
  }
  if (n === 0 && o.already.length === 0 && o.failed.length === 0) parts.push("Nothing was changed.");
  parts.push(
    o.fix === "hide"
      ? "Undo: open the product and set Visibility to Inherit POS."
      : "Undo: Promotions > Never-discount list > remove.",
  );
  return { tone: o.failed.length > 0 ? "error" : "ok", text: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runBadProductQueueCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ bad-product-queue-core: ${label}`);
    }
  };
  const card = (over: Partial<QueueCard> = {}): QueueCard => ({
    key: "k1",
    name: "Gelato 3.5g",
    brand: "B",
    categories: ["flower"],
    priceMinor: 3000,
    hidden: false,
    hiddenReason: null,
    variantPrices: [3000],
    ...over,
  });
  const lot = (over: Partial<QueueLot> = {}): QueueLot => ({
    id: "L1",
    key: "k1",
    status: "active",
    onHand: 5,
    hasCoa: true,
    createdAt: "2026-01-01",
    ...over,
  });
  const build = (cards: QueueCard[], costs: [string, number][] = [["k1", 1000]], lots: QueueLot[] = [lot()], never: string[] = []) =>
    buildBadProductQueue({ cards, costs: new Map(costs), neverKeys: new Set(never), lots });

  // Clean product -> not listed.
  const clean = build([card()]);
  ok(clean.rows.length === 0 && clean.scanned === 1, "clean product not listed");

  // Floor boundary uses the guard's own floor.
  const floor = costFloorMinorUnits(1000, false);
  ok(build([card({ priceMinor: floor, variantPrices: [floor] })]).rows[0]?.kinds.includes("below_floor") === true, "price == floor is below_floor");
  ok(build([card({ priceMinor: floor + 1, variantPrices: [floor + 1] })]).rows.length === 0, "one cent above floor is clean");
  ok(build([card({ priceMinor: floor - 1, variantPrices: [floor - 1] })]).rows[0]?.floorMinor === floor, "row carries the floor");

  // Merch floor uses the merch divisor.
  const mFloor = costFloorMinorUnits(1000, true);
  ok(mFloor !== floor, "merch divisor differs (fixture sanity)");
  const merchRow = build([card({ categories: ["accessories"], priceMinor: mFloor, variantPrices: [mFloor] })]).rows[0];
  ok(merchRow?.merch === true && merchRow.kinds.includes("below_floor") && merchRow.floorMinor === mFloor, "merch floor");

  // No price: card price or any size.
  ok(build([card({ priceMinor: 0, variantPrices: [0] })]).rows[0]?.kinds.includes("no_price") === true, "zero card price");
  ok(build([card({ variantPrices: [3000, 0] })]).rows[0]?.kinds.includes("no_price") === true, "one size at $0");
  ok(build([card({ variantPrices: [3000, Number.NaN] })]).rows[0]?.kinds.includes("no_price") === true, "NaN size price");
  ok(build([card({ priceMinor: 0, variantPrices: [0] })]).rows[0]?.kinds.includes("below_floor") === false, "no_price is not also below_floor");

  // No cost; never-discount closes it.
  ok(build([card()], []).rows[0]?.kinds.join() === "no_cost", "no cost listed");
  ok(build([card()], [["k1", 0]]).rows[0]?.kinds.join() === "no_cost", "zero cost counts as none");
  ok(build([card()], [], [lot()], ["k1"]).rows.length === 0, "no cost on never list not listed");
  ok(build([card()], [["k1", 1000]], [lot()], ["k1"]).rows.length === 0, "never list alone not listed");
  const neverBelow = build([card({ priceMinor: floor, variantPrices: [floor] })], [["k1", 1000]], [lot()], ["k1"]).rows[0];
  ok(neverBelow?.kinds.includes("below_floor") === true && neverBelow.onNeverList, "below floor still listed when on never list");

  // Missing COA: stocked active lots only, cannabis only.
  ok(build([card()], [["k1", 1000]], [lot({ hasCoa: false })]).rows[0]?.kinds.join() === "missing_coa", "missing coa");
  ok(build([card()], [["k1", 1000]], [lot({ hasCoa: false, onHand: 0 })]).rows.length === 0, "no stock -> no coa row");
  ok(build([card()], [["k1", 1000]], [lot({ hasCoa: false, status: "quarantine" })]).rows.length === 0, "non-active lot ignored for coa");
  ok(build([card({ categories: ["merch"] })], [["k1", 1000]], [lot({ hasCoa: false })]).rows.length === 0, "merch never needs coa");
  const coaPick = build([card()], [["k1", 1000]], [lot({ id: "old", hasCoa: false, createdAt: "2026-01-01" }), lot({ id: "new", hasCoa: false, createdAt: "2026-02-01" })]).rows[0];
  ok(coaPick?.coaLotId === "new" && coaPick.coaMissingLots === 2, "coa link opens newest lot");

  // Category hold and hidden-with-stock.
  ok(build([card({ hidden: true, hiddenReason: "needs_category" })]).rows[0]?.kinds.join() === "needs_category", "needs_category");
  ok(build([card({ hidden: true, hiddenReason: "needs_category" })], [["k1", 1000]], []).rows[0]?.kinds.join() === "needs_category", "needs_category even without stock");
  ok(build([card({ hidden: true, hiddenReason: "owner_override_hide:" })]).rows[0]?.kinds.join() === "hidden_with_stock", "hidden with stock");
  ok(build([card({ hidden: true, hiddenReason: "no_product_master" })], [["k1", 1000]], [lot({ onHand: 0 })]).rows.length === 0, "hidden without stock not listed");
  ok(build([card({ hidden: true, priceMinor: 0, variantPrices: [0] })], []).rows[0]?.kinds.join() === "hidden_with_stock", "hidden card is not judged for price/cost");

  // Lot for fixes: active newest, else newest.
  const lotPick = build([card()], [], [lot({ id: "a1", createdAt: "2026-01-01" }), lot({ id: "a2", createdAt: "2026-03-01" }), lot({ id: "s1", status: "sold_out", createdAt: "2026-05-01" })]).rows[0];
  ok(lotPick?.lotId === "a2", "active newest lot for fixes");
  ok(build([card()], [], [lot({ id: "s1", status: "sold_out", onHand: 0 })]).rows[0]?.lotId === "s1", "else newest of any status");
  ok(build([card()], [], []).rows[0]?.lotId === null, "no lot -> null");

  // Duplicate keys judged once; counts.
  const dup = build([card(), card({ priceMinor: 0 })], []);
  ok(dup.rows.length === 1 && dup.scanned === 1 && dup.rows[0].kinds.join() === "no_cost", "duplicate key judged once (first card)");
  const multi = build([card({ key: "a" }), card({ key: "b", priceMinor: 0, variantPrices: [0] })], [["a", 1000]], []);
  ok(multi.counts.no_price === 1 && multi.counts.no_cost === 1 && multi.rows.length === 1, "counts per kind");
  ok(rowsOfKind(multi, "no_cost").length === 1 && rowsOfKind(multi, "below_floor").length === 0, "rowsOfKind");

  // Fix eligibility.
  const q = build(
    [
      card({ key: "nocost" }),
      card({ key: "coa" }),
      card({ key: "held", hidden: true, hiddenReason: "needs_category" }),
      card({ key: "low", priceMinor: floor, variantPrices: [floor] }),
    ],
    [["coa", 1000], ["held", 1000], ["low", 1000]],
    [lot({ key: "coa", hasCoa: false })],
    ["low"],
  );
  const row = (k: string) => q.rows.find((r) => r.key === k)!;
  ok(rowAllowsFix(row("nocost"), "never") && rowAllowsFix(row("nocost"), "hide"), "no_cost: never + hide");
  ok(rowAllowsFix(row("coa"), "hide") && !rowAllowsFix(row("coa"), "never"), "missing_coa: hide only");
  ok(!rowAllowsFix(row("held"), "hide") && !rowAllowsFix(row("held"), "never"), "needs_category: links only");
  ok(!rowAllowsFix(row("low"), "never") && rowAllowsFix(row("low"), "hide"), "already on never list: no never button");

  // pickQueueFix: fail closed.
  const p1 = pickQueueFix(["nocost", "coa"], q, "hide");
  ok(p1.ok && p1.picks.length === 2, "pick keys");
  const p2 = pickQueueFix(["nocost", "held"], q, "hide");
  ok(!p2.ok && /Nothing was changed/.test(p2.ok ? "" : p2.error), "one ineligible key refuses the whole press");
  ok(!pickQueueFix(["ghost"], q, "hide").ok, "unknown key refused");
  ok(!pickQueueFix([], q, "hide").ok, "empty refused");
  ok(!pickQueueFix(["nocost", "coa"], q, "hide", 1).ok, "over max refused");
  const p3 = pickQueueFix({ all: "no_cost" }, q, "never");
  ok(p3.ok && p3.picks.map((r) => r.key).join() === "nocost", "all of a kind");
  ok(!pickQueueFix({ all: "needs_category" }, q, "hide").ok, "all on a link-only kind refused");
  ok(!pickQueueFix({ all: "below_floor" }, q, "never").ok, "all with nothing eligible refused");
  ok(!pickQueueFix({ all: "bogus" as QueueKind }, q, "hide").ok, "unknown kind refused");

  // Messages.
  const m1 = queueFixMessage({ fix: "hide", done: [{ key: "a", name: "A" }], already: [], failed: [] });
  ok(m1.tone === "ok" && /Hid 1 product from the menu: A\./.test(m1.text) && /Inherit POS/.test(m1.text), "hide message");
  const m2 = queueFixMessage({ fix: "never", done: [], already: [], failed: [{ key: "a", name: "A", error: "db down" }] });
  ok(m2.tone === "error" && /Could not change 1: A \(db down\)/.test(m2.text), "failure is loud");
  ok(/bad product queue \(no cost on file\)/.test(queueHideReason(["no_cost"])), "hide reason names the problem");
  ok(/never-discount|bad product queue/.test(queueNeverReason(["below_floor"])), "never reason");

  return { passed, failed };
}
