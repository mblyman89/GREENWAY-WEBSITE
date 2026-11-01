/**
 * src/lib/pos/scan-exact-size-core.ts  (slice register-scan-exact-size)
 *
 * PURE. "A scanned package adds ITS OWN size, never a size picker."
 *
 * OWNER (verbatim, docs/slice-register-scan-exact-size.md):
 *   "if I scan something, and it knows what it is I just scanned, that
 *    product alone needs to be added to the cart with out needing to select
 *    a variant size."
 *
 * THE DEFECT (measured, not assumed - scripts/recon/scan-exact-size-probe.ts
 * on the committed Cultivera workbooks): the register's barcode index mapped
 * a package barcode to the CARD key only (inventory_lots.pos_product_key).
 * A Cultivera-import card carries every size of a product (3.5g / 7g / 28g)
 * under that one key, so resolveScan could not tell which size the package
 * was and asked the budtender to pick: 739 of the 4,147 stocked lots (all on
 * the 298 multi-size cards). A wrong tap sells - and decrements, by size
 * (R74 S31, sale-decrement-core) - the wrong size. That is the inventory
 * discrepancy the owner is warning about.
 *
 * WHAT THE LOT ALREADY KNOWS (verified in code, reused - rule 4):
 *   1. inventory_lots.menu_source_variant_id (migration 0294): the size this
 *      lot sells as, written by the import (`pos_import`) or picked by hand
 *      on the lot page (`owner`). 738 of those 739 lots carry it.
 *   2. Receiving-intake lots: the variant id IS `${lotKey}-onboarded`
 *      (variant-lot-core) - already exact before this slice.
 *   3. inventory_lots.unit_weight + unit_weight_uom (migration 0024): the
 *      package quantity + unit from the SAME parsePackageSize that produced
 *      the variant's label (transform.ts collectLotSources), so grams from
 *      the lot and grams from the label (gramsFromVariantLabel) are the same
 *      fact. Used ONLY when it points at exactly one size.
 *
 * NEVER GUESS (Standing Rule 2/3):
 *   - Evidence that does not name exactly one size is not used; the scan
 *     then narrows the pick to the sizes that fit (or the whole card, as
 *     before), and says WHY so the lot can be linked once, forever.
 *   - A barcode whose lots disagree about the size is dropped (poisoned).
 *   - A package whose own size is proven but NOT on the register right now
 *     (recalled size, $0 importer size, expired, removed) is REFUSED with
 *     the reason - it never falls back to offering the other sizes, which
 *     is exactly how the wrong size would be sold.
 *
 * No I/O. Self-tests run in scripts/compliance/run-pure-selftests.ts.
 */

import { normalizeBarcode } from "@/lib/pos/scan-to-cart-core";
import { lotKeyFromVariantId, ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";
import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One stocked, sellable lot (the same lots the card barcode index is built from). */
export type SizeLotSource = {
  lotCode: string | null;
  ccrsExternalId: string | null;
  posProductKey: string | null;
  /** inventory_lots.menu_source_variant_id (0294). */
  sizeId?: string | null;
  /** inventory_lots.unit_weight / unit_weight_uom (0024). */
  unitWeight?: number | string | null;
  unitWeightUom?: string | null;
  /** inventory_lots.is_medical, when known. */
  isMedical?: boolean | null;
};

/** A published card with ALL its sizes (shipped or not), from the menu snapshot. */
export type SizeMenuCard = {
  id: string;
  name: string;
  variants: { id: string; label: string; medical?: boolean | null }[];
};

/**
 * What ships in the register bundle (`PosMenuBundle.barcodeSizes`).
 *   sizes     code -> the variant ids the package can be. ONE id = exact (add
 *             it, no pick). 2+ ids = the evidence narrowed the card to those
 *             sizes only (still a pick, but never of a size it cannot be).
 *   refusals  code -> plain reason. The package's own size is proven but is
 *             not on the register right now. Nothing is added.
 */
export type BarcodeSizeIndex = {
  sizes: Record<string, string[]>;
  refusals: Record<string, string>;
};

export type SizeProof = "size_link" | "onboarded" | "weight";

export type SizeIndexStats = {
  /** Stocked lots that sit on a card with 2+ register sizes. */
  multiSizeLots: number;
  /** ...of those, scanned straight to their own size. */
  exact: number;
  exactBy: Record<SizeProof, number>;
  /** ...narrowed to a smaller pick by weight. */
  narrowed: number;
  /** ...with no size evidence: the scan still asks (fix: link the lot's size). */
  unknown: number;
  /** Lots (any card) whose proven size is not on the register: scans refused. */
  refused: number;
  /** Barcodes dropped because their lots disagree about the size. */
  conflicts: number;
  /** Up to 10 unknown lots, for the log / back office. */
  unknownExamples: { code: string; card: string }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRAMS_TOLERANCE = 0.01;

/** Grams ONE package weighs, from the lot's own unit_weight + uom. Null = unknown. */
export function lotPackageGrams(unitWeight: unknown, uom: unknown): number | null {
  const q = typeof unitWeight === "number" ? unitWeight : typeof unitWeight === "string" && unitWeight.trim() !== "" ? Number(unitWeight) : NaN;
  if (!Number.isFinite(q) || q <= 0) return null;
  const u = typeof uom === "string" ? uom.trim().toLowerCase() : "";
  if (u === "g" || u === "gram" || u === "grams") return q;
  if (u === "oz" || u === "ounce" || u === "ounces") return q * STATUTORY_GRAMS_PER_OUNCE;
  return null; // mg / ml / each / packs: not a weight we can compare
}

function sameGrams(a: number | null, b: number | null): boolean {
  return a != null && b != null && Math.abs(a - b) < GRAMS_TOLERANCE;
}

function codesOf(lot: SizeLotSource): string[] {
  const out: string[] = [];
  for (const raw of [lot.lotCode, lot.ccrsExternalId]) {
    const c = normalizeBarcode(raw ?? "");
    if (c.length >= 4 && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Plain refusal text for a package whose own size is proven but not shipped. */
export function sizeRefusalMessage(cardName: string, sizeLabel: string): string {
  const size = sizeLabel.trim() || "this size";
  return (
    `This package is ${cardName} (${size}), and that size is not on the register right now ` +
    `(recalled, expired, no price, or removed). Nothing was added. Do not sell it as another size: ` +
    `ask a manager to check the lot in Back office \u2192 Inventory.`
  );
}

// ---------------------------------------------------------------------------
// The decision for one lot
// ---------------------------------------------------------------------------

export type LotSizeDecision =
  | { kind: "exact"; variantId: string; proof: SizeProof }
  | { kind: "narrowed"; variantIds: string[] }
  | { kind: "refused"; message: string }
  /** Card has 0-1 register sizes: the card index already does the right thing. */
  | { kind: "not_needed" }
  /** 2+ register sizes and no evidence names one: the card-wide pick stays. */
  | { kind: "unknown" };

/**
 * Which size a lot's package is, from its own evidence.
 *   card      the published card the lot sells under (by pos_product_key or,
 *             for receiving lots, by the card holding `${key}-onboarded`)
 *   shipped   the variant ids the register is actually selling
 */
export function decideLotSize(lot: SizeLotSource, card: SizeMenuCard, shipped: ReadonlySet<string>): LotSizeDecision {
  const key = (lot.posProductKey ?? "").trim();
  const onCard = new Map(card.variants.map((v) => [v.id, v]));
  const registerSizes = card.variants.filter((v) => shipped.has(v.id));

  const proven = (variantId: string, proof: SizeProof): LotSizeDecision => {
    if (shipped.has(variantId)) return { kind: "exact", variantId, proof };
    const v = onCard.get(variantId);
    return { kind: "refused", message: sizeRefusalMessage(card.name, v?.label ?? "") };
  };

  // 1. Receiving intake: the lot's own variant.
  const onboardedId = `${key}${ONBOARDED_VARIANT_SUFFIX}`;
  if (key && onCard.has(onboardedId)) return proven(onboardedId, "onboarded");

  // 2. The 0294 size link, only when that size is on THIS card (a stale link
  //    - Cultivera re-priced, or the lot moved card - is ignored, as
  //    price-variant-match-core does).
  const linked = (lot.sizeId ?? "").trim();
  if (linked && onCard.has(linked)) return proven(linked, "size_link");

  // Cards with 0-1 register sizes need no help: one size scans straight in.
  // (A single shipped size whose lot is PROVEN to be another size was already
  // refused above - that used to add the wrong size silently.)
  if (registerSizes.length <= 1) return { kind: "not_needed" };

  // 3. The package weight, when it names exactly one register size.
  const grams = lotPackageGrams(lot.unitWeight, lot.unitWeightUom);
  if (grams != null) {
    let fits = registerSizes.filter((v) => sameGrams(gramsFromVariantLabel(v.label), grams));
    if (fits.length > 1 && typeof lot.isMedical === "boolean") {
      const sameProgram = fits.filter((v) => typeof v.medical === "boolean" && v.medical === lot.isMedical);
      if (sameProgram.length >= 1) fits = sameProgram;
    }
    if (fits.length === 1) return { kind: "exact", variantId: fits[0].id, proof: "weight" };
    if (fits.length > 1 && fits.length < registerSizes.length) return { kind: "narrowed", variantIds: fits.map((v) => v.id) };
    if (fits.length === 0) {
      // The package weighs something no register size weighs. If the card
      // has that weight as an UNshipped size, the package is that size.
      const offMenu = card.variants.filter((v) => !shipped.has(v.id) && sameGrams(gramsFromVariantLabel(v.label), grams));
      if (offMenu.length >= 1 && new Set(offMenu.map((v) => v.label.trim().toLowerCase())).size === 1) {
        return { kind: "refused", message: sizeRefusalMessage(card.name, offMenu[0].label) };
      }
    }
  }
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// The bundle index
// ---------------------------------------------------------------------------

/**
 * Build `barcodeSizes` from the SAME stocked lots as the card index.
 *   lots      active, stocked, non-sample lots (caller filters, as for the card index)
 *   cards     every published card the register considered, with ALL sizes
 *   shipped   the register's variant ids (PosMenuProduct.variantId)
 * Codes whose lots disagree are dropped from both maps (never pick one).
 */
export function buildBarcodeSizeIndex(
  lots: readonly SizeLotSource[],
  cards: readonly SizeMenuCard[],
  shipped: ReadonlySet<string>,
): { index: BarcodeSizeIndex; stats: SizeIndexStats } {
  const byId = new Map<string, SizeMenuCard>();
  const byOnboardedKey = new Map<string, SizeMenuCard>();
  for (const c of cards) {
    byId.set(c.id, c);
    for (const v of c.variants) {
      const k = lotKeyFromVariantId(v.id);
      if (k && !byOnboardedKey.has(k)) byOnboardedKey.set(k, c);
    }
  }

  const stats: SizeIndexStats = {
    multiSizeLots: 0,
    exact: 0,
    exactBy: { size_link: 0, onboarded: 0, weight: 0 },
    narrowed: 0,
    unknown: 0,
    refused: 0,
    conflicts: 0,
    unknownExamples: [],
  };

  // code -> one canonical answer ("v:<ids>" or "r:<message>"); poisoned on disagreement
  // `sizes` is only SHIPPED for multi-size cards: a one-size card already
  // scans straight in through the card index, so shipping it would only grow
  // the iPad's cached bundle (measured: 220 KB -> ~35 KB on the real data).
  // It still takes part in conflict detection.
  type Entry = { sig: string; sizes?: string[]; refusal?: string };
  const answer = new Map<string, Entry>();
  const poisoned = new Set<string>();
  const put = (code: string, entry: Entry) => {
    if (poisoned.has(code)) return;
    const prev = answer.get(code);
    if (prev && prev.sig !== entry.sig) {
      answer.delete(code);
      poisoned.add(code);
      stats.conflicts += 1;
      return;
    }
    answer.set(code, entry);
  };

  for (const lot of lots) {
    const key = (lot.posProductKey ?? "").trim();
    if (!key) continue;
    const card = byOnboardedKey.get(key) ?? byId.get(key);
    if (!card) continue;
    const codes = codesOf(lot);
    if (codes.length === 0) continue;
    const multi = card.variants.filter((v) => shipped.has(v.id)).length > 1;
    if (multi) stats.multiSizeLots += 1;
    const d = decideLotSize(lot, card, shipped);
    switch (d.kind) {
      case "exact":
        if (multi) {
          stats.exact += 1;
          stats.exactBy[d.proof] += 1;
        }
        for (const c of codes) put(c, { sig: `v:${d.variantId}`, ...(multi ? { sizes: [d.variantId] } : {}) });
        break;
      case "narrowed": {
        stats.narrowed += 1;
        const ids = [...d.variantIds].sort();
        for (const c of codes) put(c, { sig: `v:${ids.join("|")}`, sizes: ids });
        break;
      }
      case "refused":
        stats.refused += 1;
        for (const c of codes) put(c, { sig: `r:${d.message}`, refusal: d.message });
        break;
      case "unknown":
        stats.unknown += 1;
        if (stats.unknownExamples.length < 10) stats.unknownExamples.push({ code: codes[0], card: card.name });
        // A code another lot proved would disagree with "unknown": poison it,
        // because the same barcode on two lots of different evidence is not
        // a fact we can act on.
        for (const c of codes) put(c, { sig: "unknown" });
        break;
      case "not_needed":
        // Card index already adds the one size. A proven exact would also be
        // fine; nothing to ship.
        for (const c of codes) put(c, { sig: "not_needed" });
        break;
    }
  }

  const index: BarcodeSizeIndex = { sizes: {}, refusals: {} };
  for (const [code, e] of answer) {
    if (e.sizes) index.sizes[code] = e.sizes;
    else if (e.refusal) index.refusals[code] = e.refusal;
  }
  return { index, stats };
}

/** One log line for the menu route (and the back-office note). */
export function sizeIndexSummary(stats: SizeIndexStats): string {
  const parts = [
    `${stats.exact} of ${stats.multiSizeLots} stocked lot(s) on multi-size products scan straight to their own size `,
    `(size link ${stats.exactBy.size_link}, receiving ${stats.exactBy.onboarded}, package weight ${stats.exactBy.weight})`,
  ];
  if (stats.narrowed) parts.push(`; ${stats.narrowed} narrowed by weight`);
  if (stats.unknown) {
    parts.push(
      `; ${stats.unknown} still ask the budtender for the size because the lot is not linked to one ` +
        `(fix once: Back office \u2192 the lot \u2192 \u201cWhich size is this lot?\u201d)`,
    );
  }
  if (stats.refused) parts.push(`; ${stats.refused} refused because their own size is not on the register`);
  if (stats.conflicts) parts.push(`; ${stats.conflicts} barcode(s) dropped: their lots disagree about the size`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runScanExactSizeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL scan-exact-size-core: " + msg);
    passed += 1;
  };

  // lotPackageGrams
  ok(lotPackageGrams(3.5, "g") === 3.5 && lotPackageGrams("7", "G") === 7, "grams from g (number + string)");
  ok(lotPackageGrams(1, "oz") === 28, "1 oz = 28 g statutory");
  ok(lotPackageGrams(100, "mg") === null && lotPackageGrams(1, "ea") === null && lotPackageGrams(2, "pk") === null, "non-weights unknown");
  ok(lotPackageGrams(0, "g") === null && lotPackageGrams(null, "g") === null && lotPackageGrams("x", "g") === null, "bad qty unknown");

  const card: SizeMenuCard = {
    id: "pos-card",
    name: "SPR - Sour Diesel",
    variants: [
      { id: "pos-card-a35", label: "3.5g" },
      { id: "pos-card-b7", label: "7g" },
      { id: "pos-card-c28", label: "1oz" },
    ],
  };
  const all = new Set(card.variants.map((v) => v.id));

  // size link
  let d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-b7" }, card, all);
  ok(d.kind === "exact" && d.variantId === "pos-card-b7" && d.proof === "size_link", "0294 link -> exact size");
  // stale link -> falls to weight
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-OLD", unitWeight: 3.5, unitWeightUom: "g" }, card, all);
  ok(d.kind === "exact" && d.variantId === "pos-card-a35" && d.proof === "weight", "stale link ignored, weight decides");
  // weight 1 oz
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", unitWeight: 1, unitWeightUom: "oz" }, card, all);
  ok(d.kind === "exact" && d.variantId === "pos-card-c28", "1 oz package -> the 1oz size");
  // no evidence
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card" }, card, all);
  ok(d.kind === "unknown", "no evidence -> unknown (never guess)");
  // weight that no size has, and no off-menu size -> unknown
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", unitWeight: 2, unitWeightUom: "g" }, card, all);
  ok(d.kind === "unknown", "weight matching no size -> unknown");
  // linked size not shipped -> refused (never offer the other sizes)
  const noSeven = new Set(["pos-card-a35", "pos-card-c28"]);
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-b7" }, card, noSeven);
  ok(d.kind === "refused" && d.message.includes("(7g)") && d.message.includes("Nothing was added"), "linked size off the register -> refused with its size");
  // single shipped size, lot proven to be ANOTHER size -> refused (was a silent wrong add)
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-b7" }, card, new Set(["pos-card-a35"]));
  ok(d.kind === "refused", "one shipped size, package proven another size -> refused");
  // single shipped size, no evidence -> not needed (card index adds it, as before)
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card" }, card, new Set(["pos-card-a35"]));
  ok(d.kind === "not_needed", "one shipped size, no evidence -> unchanged behaviour");
  // weight -> unshipped size only -> refused
  d = decideLotSize({ lotCode: "L1", ccrsExternalId: null, posProductKey: "pos-card", unitWeight: 7, unitWeightUom: "g" }, card, noSeven);
  ok(d.kind === "refused" && d.message.includes("(7g)"), "weight names an unshipped size -> refused");

  // same weight twice (price tiers): narrowed
  const tiers: SizeMenuCard = {
    id: "pos-t",
    name: "Tiered",
    variants: [
      { id: "t-35-a", label: "3.5g", medical: false },
      { id: "t-35-m", label: "3.5g", medical: true },
      { id: "t-7", label: "7g", medical: false },
    ],
  };
  const tiersAll = new Set(tiers.variants.map((v) => v.id));
  d = decideLotSize({ lotCode: "x", ccrsExternalId: null, posProductKey: "pos-t", unitWeight: 3.5, unitWeightUom: "g" }, tiers, tiersAll);
  ok(d.kind === "narrowed" && d.variantIds.join() === "t-35-a,t-35-m", "two 3.5g sizes -> narrowed to them, never 7g");
  d = decideLotSize({ lotCode: "x", ccrsExternalId: null, posProductKey: "pos-t", unitWeight: 3.5, unitWeightUom: "g", isMedical: true }, tiers, tiersAll);
  ok(d.kind === "exact" && d.variantId === "t-35-m", "medical lot -> the medical 3.5g size");

  // onboarded (receiving) lot on a mastered card
  const mastered: SizeMenuCard = { id: "card-m", name: "Mastered", variants: [{ id: "LOT-A-onboarded", label: "1g" }, { id: "LOT-B-onboarded", label: "3.5g" }] };
  const mAll = new Set(mastered.variants.map((v) => v.id));
  d = decideLotSize({ lotCode: "c", ccrsExternalId: null, posProductKey: "LOT-B" }, mastered, mAll);
  ok(d.kind === "exact" && d.variantId === "LOT-B-onboarded" && d.proof === "onboarded", "receiving lot -> its own variant");
  d = decideLotSize({ lotCode: "c", ccrsExternalId: null, posProductKey: "LOT-B" }, mastered, new Set(["LOT-A-onboarded"]));
  ok(d.kind === "refused", "receiving lot whose size is off the register -> refused");

  // index
  const { index, stats } = buildBarcodeSizeIndex(
    [
      { lotCode: "WA1.AAAA35", ccrsExternalId: "WA1.AAAA35", posProductKey: "pos-card", sizeId: "pos-card-a35" },
      { lotCode: "WA1.BBBB07", ccrsExternalId: null, posProductKey: "pos-card", unitWeight: 7, unitWeightUom: "g" },
      { lotCode: "WA1.CCCCXX", ccrsExternalId: null, posProductKey: "pos-card" },
      { lotCode: "WA1.SAME01", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-a35" },
      { lotCode: "WA1.SAME01", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-c28" },
      { lotCode: "WA1.REPEAT", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-c28" },
      { lotCode: "WA1.REPEAT", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-c28" },
      { lotCode: "WA1.ONBRDB", ccrsExternalId: null, posProductKey: "LOT-B" },
      { lotCode: "WA1.GHOST1", ccrsExternalId: null, posProductKey: "no-such-card", sizeId: "x" },
      { lotCode: "ab", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-a35" },
    ],
    [card, mastered],
    new Set([...all, ...mAll]),
  );
  ok(index.sizes["wa1.aaaa35"]?.join() === "pos-card-a35", "linked lot code -> its size (normalized lower-case)");
  ok(index.sizes["wa1.bbbb07"]?.join() === "pos-card-b7", "weight-proven lot -> 7g");
  ok(!("wa1.ccccxx" in index.sizes) && !("wa1.ccccxx" in index.refusals), "unknown lot ships nothing (card pick stays)");
  ok(!("wa1.same01" in index.sizes), "one code, two different sizes -> dropped (poisoned)");
  ok(index.sizes["wa1.repeat"]?.join() === "pos-card-c28", "same code, same size twice -> kept");
  ok(index.sizes["wa1.onbrdb"]?.join() === "LOT-B-onboarded", "receiving lot code -> its own variant");
  ok(!("wa1.ghost1" in index.sizes) && !("ab" in index.sizes), "lot on no card / short code -> nothing");
  ok(stats.multiSizeLots === 8 && stats.unknown === 1 && stats.conflicts === 1, "stats count multi-size lots, unknowns, conflicts");
  ok(stats.exactBy.size_link === 5 && stats.exactBy.weight === 1 && stats.exactBy.onboarded === 1, "stats by proof");
  ok(stats.unknownExamples[0]?.card === "SPR - Sour Diesel", "unknown example names the card");
  const s = sizeIndexSummary(stats);
  ok(s.includes("Which size is this lot?") && s.includes("dropped"), "summary tells the fix and the conflicts");

  const refusedIdx = buildBarcodeSizeIndex(
    [{ lotCode: "WA1.REFUSE7", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-b7" }],
    [card],
    noSeven,
  );
  ok(refusedIdx.index.refusals["wa1.refuse7"]?.includes("(7g)") === true && !("wa1.refuse7" in refusedIdx.index.sizes), "refusal shipped, no sizes");
  ok(refusedIdx.stats.refused === 1, "refusal counted");

  // one-size card: proven size is NOT shipped (card index handles it), but still poisons a disagreeing code
  const one: SizeMenuCard = { id: "pos-one", name: "One", variants: [{ id: "pos-one-1", label: "1g" }] };
  const lean = buildBarcodeSizeIndex(
    [
      { lotCode: "WA1.ONESIZE", ccrsExternalId: null, posProductKey: "pos-one", sizeId: "pos-one-1" },
      { lotCode: "WA1.MIXED01", ccrsExternalId: null, posProductKey: "pos-one", sizeId: "pos-one-1" },
      { lotCode: "WA1.MIXED01", ccrsExternalId: null, posProductKey: "pos-card", sizeId: "pos-card-a35" },
    ],
    [one, card],
    new Set(["pos-one-1", ...all]),
  );
  ok(!("wa1.onesize" in lean.index.sizes) && lean.stats.multiSizeLots === 1, "one-size card: nothing shipped (lean bundle)");
  ok(!("wa1.mixed01" in lean.index.sizes) && lean.stats.conflicts === 1, "code on a one-size and a multi-size card -> poisoned");

  return { passed, failed: 0 };
}
