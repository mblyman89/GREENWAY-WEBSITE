/**
 * src/lib/inventory/unlinked-stock-core.ts  (D195 step 2: unlinked stock)
 *
 * Owner, 2026-11-07: "i think it is not connected properly to the inventory
 * system." Finding (D195): four Legit infused prerolls showed "no cost" on
 * Promotions because their menu cards had ZERO lots under their key. The lots
 * were on the shelf, keyed by their vendor barcode (GF41918905566982 ...),
 * while the cards were keyed pos-<hash>. Nothing joined them, so the register
 * could not floor them at cost, FIFO could not find them, and Promotions
 * called them "no cost".
 *
 * HOW A LOT ENDS UP UNLINKED. Receiving keys a WCIA line by its product_sku,
 * or by its barcode when the vendor sent no SKU (intake-parser.ts:
 * `pos_product_key: sku ?? lot_code`). Product Onboarding + mastering then
 * joins the lot to its card through a `<lotKey>-onboarded` size. That join is
 * skipped when (a) the manifest was REJECTED and the lots were later set
 * active by hand (onboarding never ran), or (b) an approved draft was
 * superseded by an existing live card. The lot then belongs to no card.
 *
 * WHAT THIS MODULE DECIDES (pure, no I/O):
 *   - which lots are unlinked: a non-blank key that is neither a published
 *     card key nor the lot key of any published `-onboarded` size;
 *   - for each, the published card it most likely belongs to, from evidence
 *     the owner can read: same vendor, the same product name (token for
 *     token), the card name inside the lot name, and the same size;
 *   - which size of that card it sells as;
 *   - whether it may be linked at all (rejected stock is flagged, not linked).
 *
 * NEVER GUESS. A suggestion is only offered; the owner confirms it, and the
 * server re-runs this module before writing (the write itself is a
 * compare-and-set on the old key; see unlinked-stock-store.ts).
 *
 * PURE: no I/O. Self-tested via __runUnlinkedStockCoreTests().
 */
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

export type UnlinkedLotInput = {
  id: string;
  posProductKey: string | null;
  productName: string | null;
  status: string;
  onHandQty: number;
  vendorName: string | null;
  brandName: string | null;
  unitCostMinorUnits: number | null;
  unitWeight?: number | null;
  unitWeightUom?: string | null;
  createdAt?: string | null;
};

export type UnlinkedCardSize = { sourceVariantId: string; label: string | null };

export type UnlinkedCardInput = {
  key: string;
  name: string;
  productName: string | null;
  vendorName: string | null;
  brandName: string | null;
  category: string | null;
  sizes: UnlinkedCardSize[];
};

/** How strong the evidence for a suggested card is. */
export type MatchTier = "exact_name" | "name_and_size";

export type CardSuggestion = {
  cardKey: string;
  cardName: string;
  brandName: string | null;
  category: string | null;
  tier: MatchTier;
  /** The size the lot sells as, or null when the owner must pick it on the lot page. */
  sizeId: string | null;
  sizeLabel: string | null;
  /** Plain-English evidence, shown to the owner. */
  reasons: string[];
};

export type UnlinkedState =
  /** One clear card: the owner can confirm it. */
  | "suggested"
  /** Several cards fit equally well: the owner picks one. */
  | "ambiguous"
  /** No published card fits: create one in Product Onboarding. */
  | "no_match"
  /** The lot was rejected at receiving: it is not ours to sell, so it is not linked. */
  | "rejected";

export type UnlinkedRow = {
  lot: UnlinkedLotInput;
  state: UnlinkedState;
  /** Best-tier candidates (one when "suggested", several when "ambiguous"). */
  candidates: CardSuggestion[];
};

/** Lot statuses that may be relinked. Destroyed never; rejected is flagged instead. */
export const RELINKABLE_STATUSES: readonly string[] = ["active", "sold_out", "quarantine", "recalled"];

const STOP = new Set(["the", "and", "of", "a", "an", "pk", "pack", "x"]);

/** Lowercase alphanumeric tokens, sizes dropped, de-duplicated, sorted. */
export function nameTokens(raw: string | null | undefined): string[] {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/(\d*\.?\d+)\s*(mg|g|gram|grams|oz|ml)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return [];
  const out = new Set<string>();
  for (const t of s.split(" ")) if (t && !STOP.has(t)) out.add(t);
  return [...out].sort();
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((t, i) => t === b[i]);
}

function containsAll(hay: string[], needles: string[]): boolean {
  if (needles.length === 0) return false;
  const set = new Set(hay);
  return needles.every((t) => set.has(t));
}

/** Vendor / brand compare: lowercase alphanumerics only. */
export function normParty(raw: string | null | undefined): string {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Grams named by a label or product name ("0.7g", ".7g", "1 Grams", "3.6 g",
 * "1oz"). The LAST weight in a name wins ("Preroll (1.2g) / ..." -> 1.2).
 * Milligram strings (dose, not weight) are ignored. Null when none.
 */
export function gramsIn(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").toLowerCase();
  const re = /(\d*\.?\d+)\s*(g|gram|grams|oz|ounce)\b/g;
  let m: RegExpExecArray | null;
  let last: number | null = null;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    last = m[2].startsWith("o") ? Math.round(n * 28 * 100) / 100 : n;
  }
  return last;
}

function lotGrams(lot: UnlinkedLotInput): number | null {
  const uom = String(lot.unitWeightUom ?? "").toLowerCase();
  if (lot.unitWeight != null && lot.unitWeight > 0 && (uom === "g" || uom === "gram" || uom === "grams")) return lot.unitWeight;
  return gramsIn(lot.productName);
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.051;
}

/** The size of `card` this lot sells as: the one size, or the one whose grams match. */
export function sizeForLot(lot: UnlinkedLotInput, card: UnlinkedCardInput): UnlinkedCardSize | null {
  if (card.sizes.length === 1) return card.sizes[0];
  const g = lotGrams(lot);
  if (g == null) return null;
  const hits = card.sizes.filter((s) => {
    const sg = gramsIn(s.label);
    return sg != null && nearlyEqual(sg, g);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Keys a lot can already be reached by: every card key + every `-onboarded` size's lot key. */
export function reachableLotKeys(cards: readonly { key: string; sizes: readonly UnlinkedCardSize[] }[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    const k = c.key.trim();
    if (k) out.add(k);
    for (const s of c.sizes) {
      const lk = lotKeyFromVariantId(s.sourceVariantId);
      if (lk) out.add(lk);
    }
  }
  return out;
}

/** Is this lot on no published card (and so invisible to cost, FIFO and Promotions)? */
export function isUnlinkedLot(lot: Pick<UnlinkedLotInput, "posProductKey" | "status">, reachable: ReadonlySet<string>): boolean {
  const key = (lot.posProductKey ?? "").trim();
  if (!key) return false; // a BLANK key is the lot page's "Link this lot" door (S37)
  if (lot.status === "destroyed") return false;
  return !reachable.has(key);
}

function judge(lot: UnlinkedLotInput, card: UnlinkedCardInput): CardSuggestion | null {
  const lotV = normParty(lot.vendorName);
  const cardV = normParty(card.vendorName);
  // Vendor must agree when both are known; a different vendor is never the same product.
  if (lotV && cardV && lotV !== cardV) return null;
  const lotT = nameTokens(lot.productName);
  if (lotT.length === 0) return null;
  const size = sizeForLot(lot, card);
  const reasons: string[] = [];
  if (lotV && cardV) reasons.push(`Same vendor (${card.vendorName})`);

  if (sameTokens(lotT, nameTokens(card.productName))) {
    reasons.push(`Same product name ("${card.productName}")`);
    if (size) reasons.push(card.sizes.length === 1 ? `The card's only size (${size.label ?? "one size"})` : `Same size (${size.label})`);
    return { cardKey: card.key, cardName: card.name, brandName: card.brandName, category: card.category, tier: "exact_name", sizeId: size?.sourceVariantId ?? null, sizeLabel: size?.label ?? null, reasons };
  }
  // Weaker: the card's name sits inside the lot name, the vendor agrees, and the size matches.
  const cardT = nameTokens(card.name);
  if (lotV && cardV && size && cardT.length > 0 && containsAll(lotT, cardT)) {
    const g = lotGrams(lot);
    const sg = gramsIn(size.label);
    if (g != null && sg != null && nearlyEqual(g, sg)) {
      reasons.push(`The card name "${card.name}" is in the lot name`, `Same size (${size.label})`);
      return { cardKey: card.key, cardName: card.name, brandName: card.brandName, category: card.category, tier: "name_and_size", sizeId: size.sourceVariantId, sizeLabel: size.label, reasons };
    }
  }
  return null;
}

const TIER_RANK: Record<MatchTier, number> = { exact_name: 0, name_and_size: 1 };

/** The best-tier candidates for one lot (stable: card key order). */
export function suggestCards(lot: UnlinkedLotInput, cards: readonly UnlinkedCardInput[]): CardSuggestion[] {
  const all: CardSuggestion[] = [];
  for (const c of cards) {
    if (!c.key.trim()) continue;
    const s = judge(lot, c);
    if (s) all.push(s);
  }
  if (all.length === 0) return [];
  const best = Math.min(...all.map((s) => TIER_RANK[s.tier]));
  return all.filter((s) => TIER_RANK[s.tier] === best).sort((a, b) => a.cardKey.localeCompare(b.cardKey));
}

/** The worklist: every unlinked lot with its state and candidates. Active first, most stock first. */
export function buildUnlinkedWorklist(lots: readonly UnlinkedLotInput[], cards: readonly UnlinkedCardInput[]): UnlinkedRow[] {
  const reachable = reachableLotKeys(cards);
  const rows: UnlinkedRow[] = [];
  for (const lot of lots) {
    if (!isUnlinkedLot(lot, reachable)) continue;
    const candidates = suggestCards(lot, cards);
    const state: UnlinkedState =
      lot.status === "rejected" ? "rejected" : candidates.length === 0 ? "no_match" : candidates.length === 1 ? "suggested" : "ambiguous";
    rows.push({ lot, state, candidates });
  }
  const rank = (r: UnlinkedRow) => (r.state === "rejected" ? 1 : 0);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.lot.onHandQty ?? 0) - (a.lot.onHandQty ?? 0) ||
      String(a.lot.posProductKey).localeCompare(String(b.lot.posProductKey)),
  );
}

export type UnlinkedSummary = { total: number; sellable: number; suggested: number; rejected: number; unitsOnHand: number };

export function summarizeUnlinked(rows: readonly UnlinkedRow[]): UnlinkedSummary {
  let sellable = 0, suggested = 0, rejected = 0, units = 0;
  for (const r of rows) {
    if (r.state === "rejected") rejected += 1;
    else {
      sellable += 1;
      units += Math.max(0, r.lot.onHandQty ?? 0);
      if (r.state === "suggested") suggested += 1;
    }
  }
  return { total: rows.length, sellable, suggested, rejected, unitsOnHand: units };
}

export type RelinkCheck =
  | { ok: true; suggestion: CardSuggestion }
  | { ok: false; error: string };

/**
 * Server-side re-check before the write: the lot must still be unlinked, still
 * carry the key the owner saw, not be rejected/destroyed, and the card the
 * owner confirmed must be one of the lot's current best-tier candidates.
 * A size the owner picked must belong to that card.
 */
export function checkRelink(
  lot: UnlinkedLotInput | null,
  cards: readonly UnlinkedCardInput[],
  input: { expectedOldKey: string; cardKey: string; sizeId?: string | null },
): RelinkCheck {
  if (!lot) return { ok: false, error: "That lot no longer exists." };
  const oldKey = (lot.posProductKey ?? "").trim();
  if (oldKey !== input.expectedOldKey.trim()) return { ok: false, error: "This lot's product key changed since the page loaded. Reload and check again." };
  if (lot.status === "destroyed") return { ok: false, error: "This lot was destroyed; it cannot be linked." };
  if (lot.status === "rejected") return { ok: false, error: "This lot was rejected at receiving. Set it active on its lot page first if it really is on the shelf." };
  if (!RELINKABLE_STATUSES.includes(lot.status)) return { ok: false, error: `A ${lot.status} lot cannot be linked here.` };
  const reachable = reachableLotKeys(cards);
  if (!isUnlinkedLot(lot, reachable)) return { ok: false, error: "This lot is already on a published menu card. Nothing to do." };
  const cand = suggestCards(lot, cards).find((c) => c.cardKey === input.cardKey.trim());
  if (!cand) return { ok: false, error: "That card is no longer a match for this lot (the menu changed). Reload and check again." };
  const pickedSize = (input.sizeId ?? "").trim();
  if (pickedSize) {
    const card = cards.find((c) => c.key === cand.cardKey);
    const size = card?.sizes.find((s) => s.sourceVariantId === pickedSize);
    if (!size) return { ok: false, error: "That size is not on this card." };
    return { ok: true, suggestion: { ...cand, sizeId: size.sourceVariantId, sizeLabel: size.label } };
  }
  return { ok: true, suggestion: cand };
}

/** Where the worklist lives. */
export const UNLINKED_STOCK_HREF = "/admin/inventory/unlinked";

/* ------------------------------------------------------------------ tests */

export function __runUnlinkedStockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("unlinked-stock-core FAIL:", m);
    }
  };

  // Real production shapes (2026-11-07).
  const lot = (o: Partial<UnlinkedLotInput>): UnlinkedLotInput => ({
    id: "L1", posProductKey: "GF41918905566982", productName: "HTE HONEY - Face Off OG - Face Off OG - .7g",
    status: "active", onHandQty: 50, vendorName: "CANNA PROCESSING", brandName: null, unitCostMinorUnits: 226, ...o,
  });
  const faceOff: UnlinkedCardInput = {
    key: "pos-e00093cb5259", name: "Face Off OG", productName: "HTE Honey - Face Off OG - .7g",
    vendorName: "CANNA PROCESSING", brandName: "Legit Mini", category: "infused-preroll",
    sizes: [{ sourceVariantId: "pos-e00093cb5259-a061daab2d68", label: "0.7g" }],
  };
  const mimosa: UnlinkedCardInput = { ...faceOff, key: "pos-ed4d754d2d14", name: "Mimosa", productName: "HTE HONEY - Mimosa - Mimosa - .7g", brandName: "Legit Gold", sizes: [{ sourceVariantId: "pos-ed4d754d2d14-a061daab2d68", label: "0.7g" }] };
  const doh: UnlinkedCardInput = {
    key: "01M6249215QH3HD5", name: "Durban Candy (H)", productName: null, vendorName: null, brandName: null, category: "preroll-pack",
    sizes: [{ sourceVariantId: "01M6249215QH3HD5-onboarded", label: "3.6 g" }, { sourceVariantId: "01M6246Y6PAER443-onboarded", label: "1.2 g" }],
  };
  const multi: UnlinkedCardInput = {
    key: "pos-gg4", name: "GG#4", productName: "GG4 Flower", vendorName: "CANNA PROCESSING", brandName: "X", category: "flower",
    sizes: [{ sourceVariantId: "pos-gg4-a", label: "3.5g" }, { sourceVariantId: "pos-gg4-b", label: "7g" }, { sourceVariantId: "pos-gg4-c", label: "1oz" }],
  };
  const cards = [faceOff, mimosa, doh, multi];

  // tokens / grams
  ok(sameTokens(nameTokens("HTE HONEY - Face Off OG - Face Off OG - .7g"), nameTokens("HTE Honey - Face Off OG - .7g")), "duplicate words + size ignored");
  ok(nameTokens("").length === 0 && nameTokens(null).length === 0, "blank -> no tokens");
  ok(gramsIn(".7g") === 0.7 && gramsIn("0.7g") === 0.7, "grams .7g");
  ok(gramsIn("1 Grams") === 1, "grams 1 Grams");
  ok(gramsIn("DOH-Full Flower Glass Tip Preroll (1.2g) / Blue Jam") === 1.2, "grams in a long name");
  ok(gramsIn("1oz") === 28, "ounce -> 28g");
  ok(gramsIn("(300mg CBG;100mg THC)") === null, "mg is a dose, not a weight");
  ok(gramsIn("Pack (3.6g) 1.2g") === 1.2, "last weight wins");
  ok(normParty("CANNA PROCESSING") === normParty("Canna-Processing"), "party normalised");

  // reachability
  const reach = reachableLotKeys(cards);
  ok(reach.has("pos-e00093cb5259") && reach.has("01M6246Y6PAER443"), "card keys and -onboarded lot keys are reachable");
  ok(!reach.has("GF41918905566982"), "barcode key not reachable");
  ok(isUnlinkedLot(lot({}), reach), "barcode lot is unlinked");
  ok(!isUnlinkedLot(lot({ posProductKey: "01M6246Y6PAER443" }), reach), "lot reached through an -onboarded size is linked");
  ok(!isUnlinkedLot(lot({ posProductKey: "  " }), reach), "blank key is the S37 door, not this one");
  ok(!isUnlinkedLot(lot({ status: "destroyed" }), reach), "destroyed never listed");

  // suggestion
  const s1 = suggestCards(lot({}), cards);
  ok(s1.length === 1 && s1[0].cardKey === "pos-e00093cb5259", "Face Off lot -> Face Off card");
  ok(s1[0].tier === "exact_name" && s1[0].sizeId === "pos-e00093cb5259-a061daab2d68", "exact name + the only size");
  ok(s1[0].reasons.some((r) => r.includes("Same vendor")), "reason names the vendor");
  ok(suggestCards(lot({ vendorName: "OTHER FARM" }), cards).length === 0, "different vendor never matches");
  ok(suggestCards(lot({ productName: "Something Else - .7g" }), cards).length === 0, "different name no match");
  // weaker tier: card name inside lot name + same size
  const weak = suggestCards(lot({ productName: "Fresh GG#4 Smalls - 7g" }), cards);
  ok(weak.length === 1 && weak[0].tier === "name_and_size" && weak[0].sizeId === "pos-gg4-b", "name inside + matching size of a multi-size card");
  ok(suggestCards(lot({ productName: "Fresh GG#4 Smalls - 2g" }), cards).length === 0, "weak tier needs a matching size");
  // size by unit weight
  ok(sizeForLot(lot({ productName: "GG4 Flower", unitWeight: 3.5, unitWeightUom: "g" }), multi)?.sourceVariantId === "pos-gg4-a", "unit weight picks the size");
  ok(sizeForLot(lot({ productName: "GG4 Flower" }), multi) === null, "no weight on a multi-size card -> owner picks");
  const exactMulti = suggestCards(lot({ productName: "GG4 Flower" }), cards);
  ok(exactMulti.length === 1 && exactMulti[0].sizeId === null, "exact name on a multi-size card, size left to the owner");

  // ambiguity
  const twin: UnlinkedCardInput = { ...faceOff, key: "pos-twin", sizes: [{ sourceVariantId: "pos-twin-1", label: "0.7g" }] };
  const amb = buildUnlinkedWorklist([lot({})], [faceOff, twin]);
  ok(amb.length === 1 && amb[0].state === "ambiguous" && amb[0].candidates.length === 2, "two equal cards -> ambiguous");

  // worklist ordering + states
  const wl = buildUnlinkedWorklist(
    [
      lot({ id: "R", posProductKey: "GF41918905566983", status: "rejected", productName: "HTE HONEY -Oil Tanker - Oil Tanker - .7g" }),
      lot({ id: "A", onHandQty: 10 }),
      lot({ id: "B", posProductKey: "GF41918905566984", productName: "HTE HONEY - Mimosa - Mimosa - .7g", onHandQty: 50 }),
      lot({ id: "N", posProductKey: "X1", productName: "Unknown thing", onHandQty: 3 }),
      lot({ id: "OK", posProductKey: "pos-e00093cb5259" }),
    ],
    cards,
  );
  ok(wl.map((r) => r.lot.id).join(",") === "B,A,N,R", "active by stock first, rejected last, linked lots excluded");
  ok(wl[0].state === "suggested" && wl[0].candidates[0].cardKey === "pos-ed4d754d2d14", "Mimosa -> Mimosa card");
  ok(wl[2].state === "no_match", "no card -> no_match");
  ok(wl[3].state === "rejected", "rejected flagged");
  const sum = summarizeUnlinked(wl);
  ok(sum.total === 4 && sum.sellable === 3 && sum.suggested === 2 && sum.rejected === 1 && sum.unitsOnHand === 63, "summary counts");

  // server re-check
  ok(checkRelink(null, cards, { expectedOldKey: "x", cardKey: "y" }).ok === false, "missing lot refused");
  ok(checkRelink(lot({}), cards, { expectedOldKey: "GF0", cardKey: "pos-e00093cb5259" }).ok === false, "stale old key refused");
  ok(checkRelink(lot({ status: "rejected" }), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259" }).ok === false, "rejected refused");
  ok(checkRelink(lot({ status: "destroyed" }), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259" }).ok === false, "destroyed refused");
  ok(checkRelink(lot({}), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-ed4d754d2d14" }).ok === false, "a card that is not a candidate is refused");
  const good = checkRelink(lot({}), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259" });
  ok(good.ok && good.suggestion.sizeId === "pos-e00093cb5259-a061daab2d68", "good relink keeps the suggested size");
  ok(checkRelink(lot({}), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259", sizeId: "pos-gg4-a" }).ok === false, "a size of another card is refused");
  const picked = checkRelink(lot({ productName: "GG4 Flower" }), cards, { expectedOldKey: "GF41918905566982", cardKey: "pos-gg4", sizeId: "pos-gg4-c" });
  ok(picked.ok && picked.suggestion.sizeId === "pos-gg4-c" && picked.suggestion.sizeLabel === "1oz", "owner-picked size of the card accepted");
  ok(checkRelink(lot({ posProductKey: "pos-e00093cb5259" }), cards, { expectedOldKey: "pos-e00093cb5259", cardKey: "pos-e00093cb5259" }).ok === false, "already linked refused");

  return { passed, failed };
}
