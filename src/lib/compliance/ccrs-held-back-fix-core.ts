/**
 * src/lib/compliance/ccrs-held-back-fix-core.ts (D251 S1)
 *
 * PURE. Four fixes for rows the week of 11/01 held back in production
 * (ccrs-work/REPORT-2026-11-18-sale-fix-and-held-back.md):
 *
 *   1. restockItems: a restock lot joins its live card as a size variant
 *      (`source_variant_id = <lotKey>-onboarded`, variant-collapse-core). The
 *      batch only read menu_items, so the lot's product key named no Product
 *      and the lot was held (E41 "its product is not in the published menu";
 *      155 lots). Each such lot now gets its OWN product key (= its lot key),
 *      described by the visible card it sits on. A Product needs one
 *      UnitWeightGrams [G L0581], and a card holds several sizes, so the lot
 *      cannot borrow the card's Product.
 *   2. initialQtyForLot: InitialQuantity must not be less than QuantityOnHand
 *      ("QuanityOnHand is greater than InitialQuantity" [G L0597]). A
 *      Cultivera-era lot CCRS already holds (Update) carries CCRS's own
 *      "Initial Quantity" from the Service Desk copy when ours is too low
 *      (48 lots); otherwise nothing changes and E8 still holds the lot.
 *   3. combineDuplicateInventoryRows: two of our lots carrying ONE CCRS
 *      ExternalIdentifier (a vendor re-used the barcode) became two rows with
 *      the same id, and CCRS refuses a duplicate id [G L0219-L0221] (E60,
 *      14 ids). They are reported as ONE record: quantities and cost summed,
 *      the earliest CreatedDate, the first row's other cells.
 *   4. (D251 "production silence = success" was REVERTED in D252: the owner
 *      found production CCRS does send success emails, hours later.)
 */

export type MenuItemLike = { id?: string | null; source_item_id: string; hidden?: boolean | null };

/** A published variant row: which card a restock lot sits on. */
export type RestockLink = { source_variant_id: string; menu_item_id: string };

export const ONBOARDED_SUFFIX = "-onboarded";

/** The variant ids to look up for lot keys that name no visible card. */
export function restockVariantIds(lotKeys: Iterable<string>, itemKeys: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const raw of lotKeys) {
    const k = (raw ?? "").trim();
    if (k && !itemKeys.has(k)) out.add(`${k}${ONBOARDED_SUFFIX}`);
  }
  return [...out].sort();
}

/**
 * One product row per restock lot key: a copy of the visible card it sits on,
 * keyed by the lot key. A key that is already a card, a variant on a card that
 * is not visible, or a variant on two different cards (ambiguous: never
 * guessed) gets nothing.
 */
export function restockItems<T extends MenuItemLike>(
  items: readonly T[],
  links: readonly RestockLink[],
): { items: T[]; ambiguous: string[] } {
  const byId = new Map<string, T>();
  const keys = new Set<string>();
  for (const it of items) {
    keys.add(it.source_item_id.trim());
    if (it.id && it.hidden !== true) byId.set(it.id, it);
  }
  const cards = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l.source_variant_id.endsWith(ONBOARDED_SUFFIX)) continue;
    const key = l.source_variant_id.slice(0, -ONBOARDED_SUFFIX.length).trim();
    if (!key || keys.has(key) || !byId.has(l.menu_item_id)) continue;
    if (!cards.has(key)) cards.set(key, new Set());
    cards.get(key)!.add(l.menu_item_id);
  }
  const out: T[] = [];
  const ambiguous: string[] = [];
  for (const key of [...cards.keys()].sort()) {
    const ids = cards.get(key)!;
    if (ids.size !== 1) {
      ambiguous.push(key);
      continue;
    }
    out.push({ ...byId.get([...ids][0])!, source_item_id: key });
  }
  return { items: out, ambiguous };
}

/** The InitialQuantity to write, and where it came from. */
export function initialQtyForLot(f: {
  received: number;
  onHand: number;
  op: string;
  ccrsInitial: number | null | undefined;
}): { qty: number; fromCcrs: boolean } {
  if (f.onHand <= f.received) return { qty: f.received, fromCcrs: false };
  const c = f.ccrsInitial;
  if (f.op === "Update" && typeof c === "number" && Number.isFinite(c) && c >= f.onHand) return { qty: c, fromCcrs: true };
  return { qty: f.received, fromCcrs: false };
}

/** Parse a Service Desk "Initial Quantity" cell; anything not a plain non-negative number is null. */
export function parseCcrsQty(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export type InventoryColumns = { ext: number; initial: number; onHand: number; cost: number; created: number };

const mmddyyyyKey = (d: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  return m ? `${m[3]}${m[1]}${m[2]}` : "99999999";
};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Merge Inventory rows that share an ExternalIdentifier into ONE row (order of
 * first appearance kept). Refuses (returns the group in `refused`) when a
 * number cell is not a number: never writes a guessed sum.
 */
export function combineDuplicateInventoryRows(
  rows: readonly (readonly string[])[],
  c: InventoryColumns,
): { rows: string[][]; combined: { ext: string; count: number }[]; refused: string[] } {
  const groups = new Map<string, string[][]>();
  const order: string[] = [];
  for (const r of rows) {
    const ext = r[c.ext];
    if (!groups.has(ext)) {
      groups.set(ext, []);
      order.push(ext);
    }
    groups.get(ext)!.push([...r]);
  }
  const out: string[][] = [];
  const combined: { ext: string; count: number }[] = [];
  const refused: string[] = [];
  for (const ext of order) {
    const g = groups.get(ext)!;
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const init = g.reduce((s, r) => s + num(r[c.initial]), 0);
    const oh = g.reduce((s, r) => s + num(r[c.onHand]), 0);
    const cost = g.reduce((s, r) => s + num(r[c.cost]), 0);
    if (![init, oh, cost].every(Number.isFinite)) {
      refused.push(ext);
      out.push(...g);
      continue;
    }
    const row = [...g[0]];
    row[c.initial] = qtyText(init);
    row[c.onHand] = qtyText(oh);
    row[c.cost] = cost.toFixed(2);
    row[c.created] = g.map((r) => r[c.created]).sort((a, b) => mmddyyyyKey(a).localeCompare(mmddyyyyKey(b)))[0];
    out.push(row);
    combined.push({ ext, count: g.length });
  }
  return { rows: out, combined, refused };
}

/**
 * The strain to fill a blank Inventory Strain with: what CCRS last accepted
 * from us, else what the Service Desk copy says CCRS filed for the lot, but
 * only when CCRS's Strain list holds that exact string (Valid Values:
 * Strain.Strain [G L0552]). Never a guess: null holds the lot (E64).
 */
export function pickFiledStrain(
  told: string | null | undefined,
  seed: unknown,
  view: { entries: ReadonlyMap<string, { state: string }> } | null,
): string | null {
  const t = (told ?? "").trim();
  if (t) return t;
  const s = typeof seed === "string" ? seed.trim() : "";
  if (!s || !view) return null;
  const e = view.entries.get(`Strain\u0000${s}`);
  return e && ["seed", "filed", "confirmed"].includes(e.state) ? s : null;
}

export function __runCcrsHeldBackFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-held-back-fix-core FAIL: ${name}`);
    }
  };
  const items = [
    { id: "i1", source_item_id: "CARD", hidden: false, name: "Blue" },
    { id: "i2", source_item_id: "HID", hidden: true, name: "Hidden" },
    { id: "i3", source_item_id: "C2", hidden: false, name: "Two" },
  ];
  ok(JSON.stringify(restockVariantIds(["L1", "CARD", " L1 ", ""], new Set(["CARD"]))) === '["L1-onboarded"]', "variant ids: only keys with no card, deduped");
  const r = restockItems(items, [
    { source_variant_id: "L1-onboarded", menu_item_id: "i1" },
    { source_variant_id: "L2-onboarded", menu_item_id: "i2" },
    { source_variant_id: "CARD-onboarded", menu_item_id: "i1" },
    { source_variant_id: "L3-onboarded", menu_item_id: "i1" },
    { source_variant_id: "L3-onboarded", menu_item_id: "i3" },
    { source_variant_id: "L4", menu_item_id: "i1" },
  ]);
  ok(r.items.length === 1 && r.items[0].source_item_id === "L1" && r.items[0].name === "Blue", "restock: own key, card's details");
  ok(!r.items.some((i) => i.source_item_id === "L2"), "restock on a hidden card: nothing");
  ok(!r.items.some((i) => i.source_item_id === "CARD"), "a key that is a card is not copied");
  ok(r.ambiguous.join() === "L3", "two cards: ambiguous, never guessed");
  ok(!r.items.some((i) => i.source_item_id === "L4"), "no suffix: ignored");
  ok(items[0].source_item_id === "CARD", "input not mutated");
  ok(initialQtyForLot({ received: 5, onHand: 4, op: "Update", ccrsInitial: 9 }).qty === 5, "ours fine: ours kept");
  ok(initialQtyForLot({ received: 3, onHand: 6, op: "Update", ccrsInitial: 8 }).fromCcrs, "ours low: CCRS initial");
  ok(!initialQtyForLot({ received: 3, onHand: 6, op: "Insert", ccrsInitial: 8 }).fromCcrs, "Insert: never CCRS's");
  ok(!initialQtyForLot({ received: 12, onHand: 17, op: "Update", ccrsInitial: 12 }).fromCcrs, "CCRS also low: E8 stays");
  ok(!initialQtyForLot({ received: 3, onHand: 6, op: "Update", ccrsInitial: null }).fromCcrs, "no CCRS value: E8 stays");
  ok(initialQtyForLot({ received: 3, onHand: 6, op: "Update", ccrsInitial: 6 }).qty === 6, "equal is allowed");
  ok(parseCcrsQty("24") === 24 && parseCcrsQty(" 2.5 ") === 2.5 && parseCcrsQty("") === null && parseCcrsQty("-1") === null && parseCcrsQty(null) === null, "parse qty");
  const C = { ext: 0, initial: 1, onHand: 2, cost: 3, created: 4 };
  const m = combineDuplicateInventoryRows(
    [
      ["X", "8", "3", "10.00", "10/22/2026", "Update"],
      ["Y", "1", "1", "1.00", "10/01/2026", "Insert"],
      ["X", "8", "8", "12.50", "11/10/2026", "Update"],
    ],
    C,
  );
  ok(m.rows.length === 2 && m.rows[0].join() === "X,16,11,22.50,10/22/2026,Update", "combine: summed, earliest date, first row kept");
  ok(m.rows[1][0] === "Y" && m.combined.length === 1 && m.combined[0].count === 2, "others untouched");
  const e = combineDuplicateInventoryRows([["X", "8", "", "1", "01/01/2026"], ["X", "1", "1", "1", "01/01/2026"]], C);
  ok(e.refused.join() === "X" && e.rows.length === 2, "blank number: refused, never guessed");
  const d = combineDuplicateInventoryRows([["X", "1", "1", "1", "12/31/2025"], ["X", "1", "1", "1", "01/02/2026"]], C);
  ok(d.rows[0][4] === "12/31/2025", "earliest date across years");
  const v = { entries: new Map([["Strain\u0000Cherry Og", { state: "seed" }], ["Strain\u0000Gone", { state: "deleted" }]]) };
  ok(pickFiledStrain(" Kush ", "Cherry Og", v) === "Kush", "strain: our accepted value first");
  ok(pickFiledStrain(null, "Cherry Og", v) === "Cherry Og", "strain: CCRS's filed strain");
  ok(pickFiledStrain(null, "Cherry OG", v) === null, "strain: exact string only");
  ok(pickFiledStrain(null, "Gone", v) === null && pickFiledStrain(null, "", v) === null && pickFiledStrain(null, "Cherry Og", null) === null, "strain: deleted / blank / no ledger -> held");
  return { passed, failed };
}
