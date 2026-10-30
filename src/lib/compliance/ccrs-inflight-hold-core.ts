/**
 * W-3 (2026-10-30): a row already in a file that is still waiting for its CCRS
 * answer is never sent a second time, for EVERY file type.
 * PURE: rows + plan + ledger in, decisions out. No I/O, no clock.
 *
 * Why. "The external identifier ... must be unique for each row" and an
 * Insert "create[s] a new record with a unique external identifier"
 * [G L0219-L0221, G L0246-L0248]. CCRS refuses the same data twice
 * [BRIAN A29]: on 2026-10-25 a re-upload came back "Duplicate External
 * Identifier" for Product, Inventory and the three ADJ- adjustment rows, and
 * "Duplicate Sale for Licensee" [G L1390] for every sale line
 * (docs/ccrs-bible/evidence/2026-10-25-reupload/README.md).
 *
 * Before W-3, Strain and Area (R74 S48) and InventoryTransfer (R6-2, E14)
 * already waited for the answer. Product and Inventory Inserts, Sale lines and
 * every InventoryAdjustment did NOT: the ledger records a row only once CCRS
 * accepts it (0249 ccrs_promote_rows), so a rebuild before the answer routed
 * the same ids as Insert again, and Adjustment rows were never checked
 * against the ledger at all.
 *
 * The rule, per type:
 *   - Product / Inventory: an Insert whose id is carried by a waiting file is
 *     HELD (the plan withholds it), and so is every lot that would name a
 *     held product by a name CCRS does not hold yet ("Invalid Product"
 *     [G L0579]). An Update is untouched: re-sending it is harmless (R6-3).
 *   - Sale: a line whose Insert sits in a waiting file is held
 *     (routeSaleInserts, ccrs-return-corrections-core).
 *   - InventoryAdjustment: the ADJ- id CCRS already holds is skipped as
 *     already reported (E62 warning); an unproven state (uncertain/unknown)
 *     is held back (E62 error, held-back code); an id in a waiting file is
 *     held (E61).
 * Held-in-flight rows are an ADVISORY (E61): they are not owed, they were
 * sent. When the file is answered they are on the ledger (never re-sent); a
 * rejected row or an Abandoned file makes them go out with the next rebuild.
 */
import { buildLedgerView, type LedgerEntry, type LedgerPlan, type LedgerState, type LedgerView, type PlannedLot, type PlannedProduct } from "./ccrs-ledger-core";
import { CCRS_COLUMNS } from "./ccrs-batch-core";

/** Every in-flight hold reason starts with this (classifier + report filters). */
export const IN_FLIGHT_HOLD_PREFIX = "already in a file still waiting for its CCRS answer";

/** Types whose waiting-file ids this module reads (Strain/Area: ccrs-answer-core; Sale/Transfer: their slices). */
export const INFLIGHT_ID_TYPES = ["Product", "Inventory", "InventoryAdjustment"] as const;
export type InflightIdType = (typeof INFLIGHT_ID_TYPES)[number];

/** One row of a waiting (emitted / uploaded) file: its type, file, id and operation. */
export type InflightIdRow = { fileType: string; fileName: string; externalId: string; operation: string | null };

/** `${type}\u0000${id}` -> the FIRST waiting file (oldest stamp first, as read) that Inserts it. */
export type InflightIndex = ReadonlyMap<string, string>;

const k = (t: string, id: string) => `${t}\u0000${id}`;

/**
 * Index the Insert rows of waiting files. A null operation counts as Insert
 * (exactly as 0249 ccrs_promote_rows does: coalesce(operation, 'Insert')).
 * Update / Delete rows are not indexed: they never create a record.
 */
export function indexInflightInserts(rows: readonly InflightIdRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!(INFLIGHT_ID_TYPES as readonly string[]).includes(r.fileType)) continue;
    const id = (r.externalId ?? "").trim();
    if (id === "") continue;
    if ((r.operation ?? "Insert") !== "Insert") continue;
    if (!out.has(k(r.fileType, id))) out.set(k(r.fileType, id), r.fileName);
  }
  return out;
}

export function inflightFileOf(index: InflightIndex, t: InflightIdType, id: string): string | undefined {
  return index.get(k(t, id));
}

export function inflightReason(fileName: string): string {
  return `${IN_FLIGHT_HOLD_PREFIX} (${fileName}); it is not sent twice`;
}

export function isInflightHoldReason(reason: string | null | undefined): boolean {
  return (reason ?? "").includes(IN_FLIGHT_HOLD_PREFIX);
}

/** Lot reason: its product's Insert is in a waiting file, so the name is not held by CCRS yet. */
export function inflightProductLotReason(fileName: string): string {
  return `its product is ${IN_FLIGHT_HOLD_PREFIX} (${fileName}); the lot goes once CCRS holds the product`;
}

export type InflightHeldProduct = { key: string; ext: string; file: string };
export type InflightHeldLot = { lotId: string; ext: string; file: string; dependent: boolean };

/**
 * Withhold, in the plan, every Product / Inventory INSERT a waiting file
 * already carries, and every lot that would name such a product by a name
 * CCRS does not hold yet. Only `emit`+`Insert` entries change; nothing the
 * plan already withholds or skips is touched (its own reason stands).
 */
export function applyInflightHolds(input: {
  plan: LedgerPlan;
  view: LedgerView | null;
  index: InflightIndex;
  /** every planned lot: our id, its product key and its CCRS Inventory id. */
  lots: readonly { lotId: string; productKey: string; ext: string }[];
}): { plan: LedgerPlan; products: InflightHeldProduct[]; lots: InflightHeldLot[] } {
  const { plan, view, index } = input;
  if (!view || index.size === 0) return { plan, products: [], lots: [] };
  const productsOut = new Map<string, PlannedProduct>(plan.products);
  const heldProducts: InflightHeldProduct[] = [];
  const heldKeyFile = new Map<string, string>();
  for (const [key, pp] of plan.products) {
    if (pp.action !== "emit" || pp.op !== "Insert") continue;
    const file = inflightFileOf(index, "Product", pp.ext);
    if (!file) continue;
    productsOut.set(key, { action: "withhold", reason: inflightReason(file) });
    heldProducts.push({ key, ext: pp.ext, file });
    heldKeyFile.set(key, file);
  }
  const lotsOut = new Map<string, PlannedLot>(plan.lots);
  const heldLots: InflightHeldLot[] = [];
  const nameHeld = (n: string) => (view.productsByName.get(n) ?? []).length > 0;
  for (const l of input.lots) {
    const pl = lotsOut.get(l.lotId);
    if (!pl || pl.action !== "emit") continue;
    const own = pl.op === "Insert" ? inflightFileOf(index, "Inventory", l.ext) : undefined;
    if (own) {
      lotsOut.set(l.lotId, { action: "withhold", reason: inflightReason(own) });
      heldLots.push({ lotId: l.lotId, ext: l.ext, file: own, dependent: false });
      continue;
    }
    const pf = heldKeyFile.get(l.productKey);
    if (pf && !nameHeld(pl.productName)) {
      lotsOut.set(l.lotId, { action: "withhold", reason: inflightProductLotReason(pf) });
      heldLots.push({ lotId: l.lotId, ext: l.ext, file: pf, dependent: true });
    }
  }
  return { plan: { ...plan, products: productsOut, lots: lotsOut }, products: heldProducts, lots: heldLots };
}

/* ------------------------------------------------------------------ *
 * InventoryAdjustment routing
 * ------------------------------------------------------------------ */

const ADJ_ID = CCRS_COLUMNS.InventoryAdjustment.indexOf("ExternalIdentifier");
const ADJ_OP = CCRS_COLUMNS.InventoryAdjustment.indexOf("Operation");

export type AdjustmentRouting = {
  rows: string[][];
  /** CCRS already holds the id (any settled state, Deleted included): already reported. */
  alreadyHeld: { id: string; state: LedgerState }[];
  /** the ledger cannot say (uncertain / unknown): held back, never guessed. */
  uncertain: { id: string; state: LedgerState }[];
  /** a waiting file Inserts the id: held until the answer. */
  inFlight: { id: string; file: string }[];
};

/**
 * Route this batch's InventoryAdjustment Insert rows against the ledger
 * (`held`: ADJ- id -> ccrs_filed_entities state) and the waiting files.
 * Rows that are not Inserts pass through untouched.
 */
export function routeAdjustmentRows(
  rows: readonly string[][],
  held: ReadonlyMap<string, LedgerState>,
  index: InflightIndex,
): AdjustmentRouting {
  const out: AdjustmentRouting = { rows: [], alreadyHeld: [], uncertain: [], inFlight: [] };
  for (const r of rows) {
    const id = r[ADJ_ID] ?? "";
    if ((r[ADJ_OP] ?? "") !== "Insert" || id === "") {
      out.rows.push(r);
      continue;
    }
    const s = held.get(id);
    if (s === "uncertain" || s === "unknown") out.uncertain.push({ id, state: s });
    else if (s) out.alreadyHeld.push({ id, state: s });
    else {
      const file = inflightFileOf(index, "InventoryAdjustment", id);
      if (file) out.inFlight.push({ id, file });
      else out.rows.push(r);
    }
  }
  return out;
}

/** Held adjustment ids as ledger entries, so the outbox self-check refuses a re-Insert (defence in depth). */
export function adjustmentLedgerEntries(held: ReadonlyMap<string, LedgerState>): LedgerEntry[] {
  return [...held].map(([externalId, state]) => ({ fileType: "InventoryAdjustment", externalId, filedName: null, state, productExternalId: null }));
}

/** The ADJ- ids of a batch's adjustment rows (Inserts only), for the ledger read. */
export function adjustmentInsertIds(rows: readonly string[][]): string[] {
  return [...new Set(rows.filter((r) => r[ADJ_OP] === "Insert" && (r[ADJ_ID] ?? "") !== "").map((r) => r[ADJ_ID]))];
}

/** One plain sentence for the E61 issue of one file type. */
export function inflightHeldMessage(type: string, n: number, files: readonly string[]): string {
  const what =
    type === "Sale"
      ? 'sale line(s) (CCRS would answer "Duplicate Sale detail item for Licensee" [G L1412])'
      : type === "Product"
        ? "product(s)"
        : type === "Inventory"
          ? "lot(s)"
          : type === "InventoryAdjustment"
            ? "adjustment(s)"
            : "row(s)";
  return `${n} ${what} were left out of ${type}.csv because an earlier file still waiting for its CCRS answer already carries them (${[...new Set(files)].sort().join(", ")}). Sending them again only brings back "Duplicate" errors. Nothing is owed: once that file is answered CCRS holds them; a row CCRS rejects, or a file you Abandon, goes out with the next rebuild. If you lost that file, download it again from the CCRS file list instead of re-exporting.`;
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts and
 * tests/compliance/pure-selftests.test.ts).
 * ------------------------------------------------------------------ */
export function __runInflightHoldTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-inflight-hold-core FAIL: ${m}`);
    }
  };
  const rows: InflightIdRow[] = [
    { fileType: "Product", fileName: "Product_1.csv", externalId: "GWP-000001", operation: "Insert" },
    { fileType: "Product", fileName: "Product_2.csv", externalId: "GWP-000001", operation: "Insert" },
    { fileType: "Product", fileName: "Product_1.csv", externalId: "GWP-000009", operation: "Update" },
    { fileType: "Inventory", fileName: "Inventory_1.csv", externalId: "L-NEW", operation: "Insert" },
    { fileType: "InventoryAdjustment", fileName: "Adj_1.csv", externalId: "ADJ-3", operation: null },
    { fileType: "Strain", fileName: "Strain_1.csv", externalId: "Kush", operation: null },
    { fileType: "Inventory", fileName: "Inventory_1.csv", externalId: "  ", operation: "Insert" },
  ];
  const idx = indexInflightInserts(rows);
  ok(idx.get("Product\u0000GWP-000001") === "Product_1.csv", "first waiting file wins");
  ok(!idx.has("Product\u0000GWP-000009"), "an Update is not an in-flight Insert");
  ok(idx.get("InventoryAdjustment\u0000ADJ-3") === "Adj_1.csv", "null operation counts as Insert (0249)");
  ok(!idx.has("Strain\u0000Kush") && idx.size === 3, "other types and blank ids are ignored");
  ok(isInflightHoldReason(inflightReason("X.csv")) && isInflightHoldReason(inflightProductLotReason("X.csv")) && !isInflightHoldReason("other"), "reason classifier");

  const view = buildLedgerView("preprod", [
    { fileType: "Product", externalId: "P-FILED", filedName: "Filed Name", state: "filed" },
    { fileType: "Inventory", externalId: "L-OLD", filedName: null, state: "filed", productExternalId: "P-FILED" },
  ]).view;
  const plan: LedgerPlan = {
    strainEmit: new Set(),
    strainCanonical: new Map(),
    strainCaseVariants: [],
    products: new Map<string, PlannedProduct>([
      ["k1", { action: "emit", op: "Insert", ext: "GWP-000001" }],
      ["k2", { action: "emit", op: "Insert", ext: "GWP-000002" }],
      ["k3", { action: "emit", op: "Update", ext: "GWP-000001" }],
    ]),
    renames: new Map(),
    lots: new Map<string, PlannedLot>([
      ["a", { action: "emit", op: "Insert", productName: "New One", strain: "" }],
      ["b", { action: "emit", op: "Insert", productName: "Two", strain: "" }],
      ["c", { action: "emit", op: "Update", productName: "Filed Name", strain: "" }],
      ["d", { action: "emit", op: "Update", productName: "Filed Name", strain: "" }],
      ["e", { action: "withhold", reason: "own reason" }],
    ]),
    nameFromLedger: [],
  };
  const lots = [
    { lotId: "a", productKey: "k1", ext: "L-A" },
    { lotId: "b", productKey: "k2", ext: "L-NEW" },
    { lotId: "c", productKey: "k1", ext: "L-OLD" },
    { lotId: "d", productKey: "k2", ext: "L-NEW" },
    { lotId: "e", productKey: "k1", ext: "L-E" },
  ];
  const h = applyInflightHolds({ plan, view, index: idx, lots });
  ok(h.plan.products.get("k1")?.action === "withhold" && h.products.map((p) => p.key).join() === "k1", "product Insert in flight held");
  ok(h.plan.products.get("k2")?.action === "emit", "product not in flight is untouched");
  ok(h.plan.products.get("k3")?.action === "emit", "a product Update is never held");
  const a = h.plan.lots.get("a");
  ok(a?.action === "withhold" && a.reason.startsWith("its product is " + IN_FLIGHT_HOLD_PREFIX), "lot naming a held product by an unheld name is held (dependent)");
  const b = h.plan.lots.get("b");
  ok(b?.action === "withhold" && b.reason.startsWith(IN_FLIGHT_HOLD_PREFIX), "lot Insert in flight held");
  ok(h.plan.lots.get("c")?.action === "emit", "lot naming the FILED product name is not held");
  ok(h.plan.lots.get("d")?.action === "emit", "a lot Update is never held, even with its id in flight");
  const e = h.plan.lots.get("e");
  ok(e?.action === "withhold" && e.reason === "own reason", "an existing withhold keeps its own reason");
  ok(h.lots.map((x) => `${x.lotId}:${x.dependent}`).join() === "a:true,b:false", "held lots listed, dependent flagged");
  ok(plan.products.get("k1")?.action === "emit" && plan.lots.get("b")?.action === "emit", "input plan not mutated");
  ok(applyInflightHolds({ plan, view: null, index: idx, lots }).plan === plan, "legacy routing (no view): nothing held");
  ok(applyInflightHolds({ plan, view, index: new Map(), lots }).plan === plan, "nothing in flight: same plan");

  const A = CCRS_COLUMNS.InventoryAdjustment;
  const adj = (id: string, op = "Insert") => A.map((c) => (c === "ExternalIdentifier" ? id : c === "Operation" ? op : "x"));
  const held = new Map<string, LedgerState>([
    ["ADJ-1", "filed"],
    ["ADJ-2", "deleted"],
    ["ADJ-4", "uncertain"],
    ["ADJ-5", "unknown"],
  ]);
  const r = routeAdjustmentRows([adj("ADJ-1"), adj("ADJ-2"), adj("ADJ-3"), adj("ADJ-4"), adj("ADJ-5"), adj("ADJ-6"), adj("ADJ-1", "Update")], held, idx);
  ok(r.alreadyHeld.map((x) => x.id).join() === "ADJ-1,ADJ-2", "held (any settled state) -> already reported");
  ok(r.uncertain.map((x) => x.id).join() === "ADJ-4,ADJ-5", "uncertain / unknown -> held back");
  ok(r.inFlight.map((x) => `${x.id}@${x.file}`).join() === "ADJ-3@Adj_1.csv", "in a waiting file -> held");
  ok(r.rows.map((x) => `${x[A.indexOf("ExternalIdentifier")]}/${x[A.indexOf("Operation")]}`).join() === "ADJ-6/Insert,ADJ-1/Update", "new Inserts and non-Inserts are sent");
  ok(adjustmentInsertIds([adj("ADJ-1"), adj("ADJ-1"), adj("ADJ-7", "Update"), adj("")]).join() === "ADJ-1", "ids read once, Inserts only");
  const ents = adjustmentLedgerEntries(held);
  ok(ents.length === 4 && ents.every((x) => x.fileType === "InventoryAdjustment"), "ledger entries for the self-check");
  const msg = inflightHeldMessage("Sale", 2, ["B.csv", "A.csv", "B.csv"]);
  ok(msg.startsWith("2 sale line(s)") && msg.includes("(A.csv, B.csv)") && msg.includes("Nothing is owed") && msg.includes("[G L1412]"), "message");
  return { passed, failed };
}
