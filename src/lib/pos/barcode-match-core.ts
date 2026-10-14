/**
 * src/lib/pos/barcode-match-core.ts  (R50 A7 - barcode-first matching)
 *
 * PURE. The inputs for the rule "a delivery line whose barcode is already a
 * lot on a live card joins that card BEFORE any name rule" (roadmap R50 A7).
 * The rule itself lives next to the other merge rules in
 * intake-mastering-core.ts (barcodeTarget), because it needs the same
 * LiveMergeIndex eligibility and category-axis rule as every other merge.
 *
 * WHAT A BARCODE IS (measured, never assumed - roadmap R50 section 1.8/1.9):
 *   - inventory_lots.lot_code = the Cultivera Barcode = the WCIA
 *     `inventory_id` of the line (intake-parser parseWciaLine; probed on the
 *     harness: lot_code equals ccrs_inventory_external_id for import lots).
 *   - The same CCRS barcode IS re-delivered (900 barcodes sit on 2+ real
 *     transfers in TRANSFERS_INDEX.json; e.g. WA413287.INUN16 on 8). A WCIA
 *     line without a product_sku gets pos_product_key = the barcode, while the
 *     Cultivera card for that product is keyed `pos-<hash>` - so the key never
 *     matches, and only the name rule could find the card. A7 closes that.
 *   - Shapes: 24,710 of the 24,713 barcodes in the transfer index match
 *     BARCODE_RE; the three that do not are junk ("1", "Fire Bros AIO Phone
 *     Case", "Firebros Lanyard"). In the inventories export the 8 misses are
 *     accessories ("RBBW", "giraffe", "D-0005", ...). Anything outside the
 *     shape is "no barcode" - never matched on.
 *   - Vendor: in the transfer index no barcode is ever accepted from two
 *     vendors (0 of 24,622). Migration 0023 still warns lot codes are not
 *     unique across vendors, so the rule also demands a vendor agreement.
 *
 * NEVER GUESS:
 *   - Absent inputs (flag off, any failed read) = the plan before A7, byte
 *     for byte.
 *   - A barcode found on lots of TWO OR MORE different live cards is never
 *     used (ambiguous); the name rule decides, as before.
 *   - The draft's OWN lot rows never count as "live" (excluded by lot id).
 *
 * No fs, no network, no Supabase. Self-tests run in the pure runner.
 */

/** Rollback switch. Default ON; an off-word = the plan before A7. */
export const BARCODE_FIRST_ENV = "INTAKE_BARCODE_FIRST";

const OFF_WORDS = new Set(["off", "0", "false", "no", "disabled"]);

/** Same off-words as every pipeline flag (S05, S06, S17, S18, S19). */
export function barcodeFirstEnabled(raw: string | undefined | null): boolean {
  if (raw == null) return true;
  return !OFF_WORDS.has(String(raw).trim().toLowerCase());
}

/** A real lot barcode: 8-64 chars, letters/digits/dot/dash, starts alphanumeric. */
export const BARCODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{7,63}$/;

/** The barcode as matched (trimmed, case kept), or null when it is not one. */
export function normalizeBarcode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return BARCODE_RE.test(t) ? t : null;
}

/** One live lot carrying a barcode: the live card it belongs to + its vendor id. */
export type LiveBarcodeLot = { cardKey: string; vendorId: string | null };

/**
 * What the planner is handed.
 *   barcodeByLotKey   draft lot key (pos_product_key) -> its lot's barcode
 *   vendorIdByLotKey  draft lot key -> its lot's vendor id (may be absent)
 *   liveByBarcode     barcode -> the live-card lots that carry it
 */
export type BarcodeInputs = {
  barcodeByLotKey: Map<string, string>;
  vendorIdByLotKey: Map<string, string>;
  liveByBarcode: Map<string, LiveBarcodeLot[]>;
};

function cleanId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t ? t : null;
}

/**
 * The lot keys that describe a live card (mirror of vendor-identity-core
 * cardLotKeys, re-stated so this module imports nothing): its own key and
 * every `<lotKey>-onboarded` variant's lot key.
 */
export function liveCardLotKeys(card: { source_item_id: string; variants: { source_variant_id: string }[] }): string[] {
  const out: string[] = [];
  const add = (k: string | null) => {
    if (k && !out.includes(k)) out.push(k);
  };
  add(card.source_item_id.trim() || null);
  for (const v of card.variants) {
    const t = v.source_variant_id.trim();
    if (t.endsWith("-onboarded")) add(t.slice(0, -"-onboarded".length).trim() || null);
  }
  return out;
}

/** The draft-side lot rows to read: the draft lot ids that exist (deduped, input order). */
export function draftLotIdsToRead(drafts: Array<{ pos_product_key: string | null; lot_id?: string | null }>): string[] {
  const out: string[] = [];
  for (const d of drafts) {
    const key = d.pos_product_key?.trim();
    const id = d.lot_id?.trim();
    if (key && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Most barcodes one delivery may ask about (a manifest is ~100 lines; more = skip, never partial). */
export const BARCODE_LOOKUP_CAP = 1000;

/**
 * Build the planner inputs from the two bounded reads:
 *   draftLots  inventory_lots rows for the drafts' lot ids (id, lot_code, vendor_id)
 *   liveLots   inventory_lots rows whose lot_code is one of those barcodes
 *              (id, pos_product_key, lot_code, vendor_id)
 * A live lot counts only when its pos_product_key is a lot key of a live
 * card; the drafts' own lot rows never count. Pure; deterministic order.
 */
export function buildBarcodeInputs(input: {
  drafts: Array<{ pos_product_key: string | null; lot_id?: string | null }>;
  draftLots: Array<{ id: string; lot_code: string | null; vendor_id: string | null }>;
  liveLots: Array<{ id: string; pos_product_key: string | null; lot_code: string | null; vendor_id: string | null }>;
  liveCards: Array<{ source_item_id: string; variants: { source_variant_id: string }[] }>;
}): BarcodeInputs {
  const lotById = new Map(input.draftLots.map((l) => [l.id, l]));
  const ownLotIds = new Set<string>();
  const barcodeByLotKey = new Map<string, string>();
  const vendorIdByLotKey = new Map<string, string>();
  for (const d of input.drafts) {
    const key = d.pos_product_key?.trim();
    const id = d.lot_id?.trim();
    if (!key || !id) continue;
    ownLotIds.add(id);
    const lot = lotById.get(id);
    if (!lot) continue;
    const bc = normalizeBarcode(lot.lot_code);
    if (!bc) continue;
    barcodeByLotKey.set(key, bc);
    const vid = cleanId(lot.vendor_id);
    if (vid) vendorIdByLotKey.set(key, vid);
  }
  // Every live card that claims a lot key (normally one). Two cards claiming
  // the same lot is never resolved by picking one: both are listed, so
  // barcodeTarget sees "ambiguous" and the name rule decides, as before.
  const cardsByLotKey = new Map<string, string[]>();
  for (const card of input.liveCards) {
    for (const k of liveCardLotKeys(card)) {
      const list = cardsByLotKey.get(k) ?? [];
      if (!list.includes(card.source_item_id)) list.push(card.source_item_id);
      cardsByLotKey.set(k, list);
    }
  }
  const wanted = new Set(barcodeByLotKey.values());
  const liveByBarcode = new Map<string, LiveBarcodeLot[]>();
  for (const l of input.liveLots) {
    if (ownLotIds.has(l.id)) continue;
    const bc = normalizeBarcode(l.lot_code);
    if (!bc || !wanted.has(bc)) continue;
    const cardKeys = cardsByLotKey.get(l.pos_product_key?.trim() ?? "") ?? [];
    if (cardKeys.length === 0) continue;
    const list = liveByBarcode.get(bc) ?? [];
    for (const cardKey of cardKeys) list.push({ cardKey, vendorId: cleanId(l.vendor_id) });
    liveByBarcode.set(bc, list);
  }
  return { barcodeByLotKey, vendorIdByLotKey, liveByBarcode };
}

/** The distinct barcodes worth reading live lots for (sorted), and whether that is over the cap. */
export function barcodesToRead(draftLots: Array<{ lot_code: string | null }>): { barcodes: string[]; overCap: boolean } {
  const set = new Set<string>();
  for (const l of draftLots) {
    const bc = normalizeBarcode(l.lot_code);
    if (bc) set.add(bc);
  }
  const barcodes = [...set].sort();
  return { barcodes, overCap: barcodes.length > BARCODE_LOOKUP_CAP };
}

// --- self-tests -----------------------------------------------------------------

export function __runBarcodeMatchCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL barcode-match-core: " + msg);
    passed += 1;
  };

  // flag
  ok(barcodeFirstEnabled(undefined) && barcodeFirstEnabled(null) && barcodeFirstEnabled("on") && barcodeFirstEnabled(""), "flag default on");
  for (const w of ["off", " OFF ", "0", "false", "no", "disabled"]) ok(!barcodeFirstEnabled(w), `flag off-word ${w}`);

  // barcode shape (the real shapes from the transfer index)
  ok(normalizeBarcode("WA413287.INUN16") === "WA413287.INUN16", "CCRS dotted barcode");
  ok(normalizeBarcode("  07825626909 ") === "07825626909", "11-digit barcode trimmed");
  ok(normalizeBarcode("6449578214785011") === "6449578214785011", "16-digit barcode");
  ok(normalizeBarcode("A-0000032") === "A-0000032", "dash allowed");
  ok(normalizeBarcode("wa413287.inun16") === "wa413287.inun16", "case kept (never folded)");
  ok(normalizeBarcode("1") === null, "junk '1' is not a barcode");
  ok(normalizeBarcode("giraffe") === null && normalizeBarcode("RBBW") === null && normalizeBarcode("D-0005") === null, "short junk is not a barcode");
  ok(normalizeBarcode("Fire Bros AIO Phone Case") === null, "spaces = not a barcode");
  ok(normalizeBarcode("12345678") === "12345678", "8 chars is the floor");
  ok(normalizeBarcode("1234567") === null, "7 chars is under the floor");
  ok(normalizeBarcode("A".repeat(64)) !== null && normalizeBarcode("A".repeat(65)) === null, "64 chars is the ceiling");
  ok(normalizeBarcode(".12345678") === null && normalizeBarcode("-12345678") === null, "must start alphanumeric");
  ok(normalizeBarcode(12345678 as unknown) === null && normalizeBarcode(null) === null, "non-string = none");

  // card lot keys
  ok(liveCardLotKeys({ source_item_id: "pos-0123456789ab", variants: [{ source_variant_id: "pos-0123456789ab-x1" }] }).join() === "pos-0123456789ab", "Cultivera card: its own key");
  ok(liveCardLotKeys({ source_item_id: "LOT-A", variants: [{ source_variant_id: "LOT-A-onboarded" }, { source_variant_id: " LOT-B-onboarded " }, { source_variant_id: "-onboarded" }] }).join() === "LOT-A,LOT-B", "intake card: key + variant lots, deduped, bare suffix dropped");

  // lot ids to read
  ok(draftLotIdsToRead([{ pos_product_key: "K1", lot_id: "L1" }, { pos_product_key: "K2", lot_id: "L1" }, { pos_product_key: null, lot_id: "L9" }, { pos_product_key: "K3", lot_id: " " }, { pos_product_key: "K4" }]).join() === "L1", "lot ids: keyed drafts only, deduped");

  // barcodes to read
  const btr = barcodesToRead([{ lot_code: "WA1.ABCDEFG" }, { lot_code: " WA1.ABCDEFG " }, { lot_code: "1" }, { lot_code: null }, { lot_code: "07825626909" }]);
  ok(btr.barcodes.join() === "07825626909,WA1.ABCDEFG" && !btr.overCap, "barcodes: valid, deduped, sorted");
  ok(barcodesToRead(Array.from({ length: BARCODE_LOOKUP_CAP + 1 }, (_, i) => ({ lot_code: `BC${String(i).padStart(8, "0")}` }))).overCap, "over the cap is flagged");
  ok(!barcodesToRead(Array.from({ length: BARCODE_LOOKUP_CAP }, (_, i) => ({ lot_code: `BC${String(i).padStart(8, "0")}` }))).overCap, "exactly the cap is fine");

  // build inputs
  const cards = [
    { source_item_id: "pos-0123456789ab", variants: [{ source_variant_id: "pos-0123456789ab-1" }] },
    { source_item_id: "LOT-OLD", variants: [{ source_variant_id: "LOT-OLD-onboarded" }, { source_variant_id: "LOT-OLD2-onboarded" }] },
  ];
  const built = buildBarcodeInputs({
    drafts: [
      { pos_product_key: "WA1.NEWLOT01", lot_id: "draft-lot-1" },
      { pos_product_key: "K2", lot_id: "draft-lot-2" },
      { pos_product_key: "K3", lot_id: "missing" },
      { pos_product_key: "K4", lot_id: "draft-lot-4" },
    ],
    draftLots: [
      { id: "draft-lot-1", lot_code: "WA1.NEWLOT01", vendor_id: " ABC " },
      { id: "draft-lot-2", lot_code: "07825626909", vendor_id: null },
      { id: "draft-lot-4", lot_code: "1", vendor_id: "v" },
    ],
    liveLots: [
      { id: "draft-lot-1", pos_product_key: "pos-0123456789ab", lot_code: "WA1.NEWLOT01", vendor_id: "abc" },
      { id: "old-1", pos_product_key: "pos-0123456789ab", lot_code: "WA1.NEWLOT01", vendor_id: "ABC" },
      { id: "old-2", pos_product_key: "LOT-OLD2", lot_code: "07825626909", vendor_id: null },
      { id: "old-3", pos_product_key: "gone-card", lot_code: "07825626909", vendor_id: null },
      { id: "old-4", pos_product_key: "LOT-OLD", lot_code: "NOTASKED01", vendor_id: null },
    ],
    liveCards: cards,
  });
  ok(built.barcodeByLotKey.get("WA1.NEWLOT01") === "WA1.NEWLOT01" && built.barcodeByLotKey.get("K2") === "07825626909", "draft barcodes keyed by lot key");
  ok(!built.barcodeByLotKey.has("K3") && !built.barcodeByLotKey.has("K4"), "missing lot / junk barcode -> no barcode");
  ok(built.vendorIdByLotKey.get("WA1.NEWLOT01") === "abc" && !built.vendorIdByLotKey.has("K2"), "draft vendor ids cleaned");
  const l1 = built.liveByBarcode.get("WA1.NEWLOT01") ?? [];
  ok(l1.length === 1 && l1[0].cardKey === "pos-0123456789ab" && l1[0].vendorId === "abc", "own lot row excluded; Cultivera card found by its key");
  const l2 = built.liveByBarcode.get("07825626909") ?? [];
  ok(l2.length === 1 && l2[0].cardKey === "LOT-OLD" && l2[0].vendorId === null, "intake card found by a variant's lot; a lot on no live card ignored");
  ok(!built.liveByBarcode.has("NOTASKED01"), "a barcode no draft carries is ignored");
  // one lot key claimed by TWO live cards -> both listed (never pick one)
  const twice = buildBarcodeInputs({
    drafts: [{ pos_product_key: "K2", lot_id: "draft-lot-2" }],
    draftLots: [{ id: "draft-lot-2", lot_code: "07825626909", vendor_id: null }],
    liveLots: [{ id: "old-2", pos_product_key: "SHARED", lot_code: "07825626909", vendor_id: "v" }],
    liveCards: [
      { source_item_id: "SHARED", variants: [] },
      { source_item_id: "CARD-B", variants: [{ source_variant_id: "SHARED-onboarded" }] },
    ],
  });
  ok(JSON.stringify(twice.liveByBarcode.get("07825626909")) === JSON.stringify([{ cardKey: "SHARED", vendorId: "v" }, { cardKey: "CARD-B", vendorId: "v" }]), "a lot claimed by two cards lists both (ambiguous downstream)");
  const none = buildBarcodeInputs({ drafts: [], draftLots: [], liveLots: [], liveCards: cards });
  ok(none.barcodeByLotKey.size === 0 && none.liveByBarcode.size === 0, "empty in, empty out");

  return { passed };
}
