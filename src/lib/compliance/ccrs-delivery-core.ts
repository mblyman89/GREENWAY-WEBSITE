/**
 * ccrs-delivery-core.ts - D250 slice 2. The examiner's DELTA delivery
 * (2026-11-13 + 2026-11-17) merged into the production CCRS ledger.
 * PURE: text / cell values in, entities + a guarded plan out. No I/O, no clock.
 *
 * Why a new reader (evidence: docs/ccrs-bible/evidence/2026-11-17-examiner-delivery):
 *   - the layouts are not the 9/18 seed layout (SEED_HEADERS), so S-15 refuses them;
 *   - the set is a DELTA: open lots created after 9/18, the full Product list,
 *     the Strains and Areas added since, and Cultivera's accepted sales. S-15's
 *     seedMissing gate (a later full copy must hold every earlier record) would
 *     see ~62,000 "missing" rows. Here nothing is missing by design: the 9/18
 *     seed stays, and this delta is laid on top of it.
 *
 * Rules, each pinned or measured, never guessed:
 *   - headers are matched EXACTLY, LCB's spelling included (`LicenesNumber`,
 *     ` Updated Date `, `Unit Price `). A changed layout stops the load.
 *   - ids and names are kept byte-exact [G L0247].
 *   - a delivered lot's payload uses the 9/18 seed key names, so equalize
 *     (S-14), compare and verify (S-16) read it unchanged. `isMedical` 1/0 is
 *     the database bit for TRUE/FALSE; `NULL` is an empty value.
 *   - in this layout the lot's "Product Name" is the Product NAME (measured:
 *     1,174 of 1,174 match a Product Name exactly; 0 match only a Description).
 *     CCRS checks the Inventory Product cell by name: "Valid Values:
 *     Product.Name" [G L0576]. When identical twins share that name (the
 *     Cultivera C11.../C1-110211... pairs), the lowest id is recorded: the
 *     cell CCRS reads is the same Name whichever twin is recorded, so the
 *     choice cannot change a file. Twins that differ are reported (U-82).
 *   - a lot named by a sale CCRS accepted is held by CCRS: a sale naming an
 *     unknown lot is refused "Invalid InventoryExternalIdentifier" [G L1302-L1304]
 *     (U-70). Such a lot, absent from the ledger, is added as present with no
 *     product (its sales go; its Inventory Update waits for a product).
 *   - a row one of OUR files touched is never written, only reported.
 *   - every write carries the state + updated_at the plan saw (STALE guard).
 */
import type { LedgerFileType, LedgerState } from "./ccrs-ledger-core";
import { LINK_SOURCE, ReseedError, reseedSource, samePayload, type LedgerRow } from "./ccrs-reseed-core";
import { parseDeliveryCsv, type SeedEntity } from "./ccrs-ledger-seed-core";

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

/* ------------------------------------------------------------------ *
 * Layouts (exact, as delivered)
 * ------------------------------------------------------------------ */

export const DELIVERY_CSV_LAYOUTS = {
  "inventory-2026-11-17": ["LicenesNumber", "Strain", "Product Type", "Product Name", "isMedical", "InventoryIdentifier", "InitialQuantity", "QuantityonHand", "TotalCost", "Createdby", "CreatedDate", "Updateby", "UpdatedDate", "SystemDate"],
  "inventory-2026-11-13": ["LicenseNumber", "Strain", "Product Type", "Product Name", "Is medical", "Inventory Identifier", "Initial Quantity", "Quantity on Hand", "Total Cost", "Created By", "Created Date", "Updated by", " Updated Date ", "System Date"],
  "sales-2026-11-17": ["LicenseNumber", "Name", "InventoryType", "InventoryIdentifier", "ismedical", "saletype", "SaleDate", "quantity", "UnitPrice", "Discount", "SalesTax", "Excisetax", "SystemDate"],
  "sales-2026-11-13": ["License Number", "Name", "Inventory Type", "Inventory Identifier", "is Medical", "Sale Type", "Sale Date", "Quantity", "Unit Price ", "Discount", "Sales Tax", "Excise Tax", "System Date"],
} as const;
export type DeliveryCsvLayout = keyof typeof DELIVERY_CSV_LAYOUTS;

export const DELIVERY_SHEETS = {
  areas: ["LicenseNumber", "DBA", "areaexternalIdentifier", "Name", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"],
  strains: ["LicenseNumber", "DBA", "Name", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"],
  Product: ["LicenseNumber", "DBA", "Name", "Description", "ExternalIdentifier", "InventoryCategory", "ProductType", "unitofmeasure", "UnitWeightGrams", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate", "SystemModifiedDate"],
} as const;
export type DeliverySheet = keyof typeof DELIVERY_SHEETS;

/** Which delivered CSV this is, by its exact header row (null = not one). */
export function detectDeliveryCsv(firstLine: string): DeliveryCsvLayout | null {
  const line = firstLine.replace(/^\uFEFF/, "").replace(/\r?\n?$/, "").replace(/\r$/, "");
  const cells = line.split(",");
  for (const k of Object.keys(DELIVERY_CSV_LAYOUTS) as DeliveryCsvLayout[]) {
    const want = DELIVERY_CSV_LAYOUTS[k] as readonly string[];
    if (cells.length === want.length && cells.every((c, i) => c === want[i])) return k;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

const PLAIN_DEC_RE = /^\d+(\.\d+)?$/;
const MDY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const daysIn = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** M/D/YYYY -> YYYY-MM-DD, or null. */
export function mdyToIso(s: string): string | null {
  const m = MDY_RE.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The delivery writes an empty value as the text NULL. */
const nul = (s: string) => (s === "NULL" ? "" : s);

/**
 * One xlsx cell as text, the way the CSV files write the same value:
 * a whole number without ".0", a decimal as JavaScript prints it, a date as
 * M/D/YYYY (UTC parts: exceljs reads a sheet date as UTC). Anything else refuses.
 */
export function xlsxCellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new DeliveryError(`a sheet cell holds ${String(v)}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new DeliveryError("a sheet cell holds an invalid date");
    return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text; // hyperlink / rich text
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map((r) => (typeof r.text === "string" ? r.text : "")).join("");
    if ("result" in o) return xlsxCellText(o.result); // formula: its value
  }
  throw new DeliveryError(`a sheet cell holds a value of an unexpected kind (${Object.prototype.toString.call(v)})`);
}

/* ------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------ */

export type DeliveredLot = {
  file: string;
  layout: DeliveryCsvLayout;
  license: string;
  strain: string;
  productType: string;
  productName: string;
  isMedical: "TRUE" | "FALSE";
  id: string;
  initial: string;
  qoh: string;
  cost: string;
  createdBy: string;
  createdDate: string;
  updatedBy: string;
  updatedDate: string;
  systemDate: string;
};

export type DeliveredSale = { file: string; lot: string; inventoryType: string; saleDate: string; quantity: string; systemDate: string };

function csvRows(text: string, file: string): { layout: DeliveryCsvLayout; rows: string[][] } {
  const rows = parseDeliveryCsv(text);
  if (rows.length === 0) throw new DeliveryError(`${file}: empty file`);
  const layout = detectDeliveryCsv(rows[0].join(","));
  if (!layout) throw new DeliveryError(`${file}: the header is not a delivered layout. got ${JSON.stringify(rows[0])}`);
  const width = DELIVERY_CSV_LAYOUTS[layout].length;
  const body = rows.slice(1).filter((r) => !(r.length === 1 && r[0] === ""));
  body.forEach((r, n) => { if (r.length !== width) throw new DeliveryError(`${file}: data row ${n + 1} has ${r.length} cells, expected ${width}`); });
  return { layout, rows: body };
}

const need = (v: string, what: string, file: string, n: number) => {
  if (v === "" || v === "NULL") throw new DeliveryError(`${file}: data row ${n} has no ${what}`);
  return v;
};
const needDec = (v: string, what: string, file: string, n: number) => {
  if (!PLAIN_DEC_RE.test(v)) throw new DeliveryError(`${file}: data row ${n} ${what} ${JSON.stringify(v)} is not a plain number`);
  return v;
};
const needDate = (v: string, what: string, file: string, n: number) => {
  if (mdyToIso(v) === null) throw new DeliveryError(`${file}: data row ${n} ${what} ${JSON.stringify(v)} is not M/D/YYYY`);
  return v;
};

export function readDeliveredInventory(text: string, file: string): DeliveredLot[] {
  const { layout, rows } = csvRows(text, file);
  if (!layout.startsWith("inventory-")) throw new DeliveryError(`${file}: this is a ${layout} file, not an inventory file`);
  return rows.map((r, i) => {
    const n = i + 1;
    const med = r[4];
    if (med !== "1" && med !== "0") throw new DeliveryError(`${file}: data row ${n} isMedical ${JSON.stringify(med)} is not 1 or 0`);
    const initial = needDec(r[6], "InitialQuantity", file, n);
    const qoh = needDec(r[7], "QuantityonHand", file, n);
    return {
      file, layout,
      license: need(r[0], "license", file, n),
      strain: need(r[1], "Strain", file, n),
      productType: need(r[2], "Product Type", file, n),
      productName: need(r[3], "Product Name", file, n),
      isMedical: med === "1" ? "TRUE" : "FALSE",
      id: need(r[5], "InventoryIdentifier", file, n),
      initial, qoh,
      cost: needDec(r[8], "TotalCost", file, n),
      createdBy: need(r[9], "Createdby", file, n),
      createdDate: needDate(r[10], "CreatedDate", file, n),
      updatedBy: nul(r[11]),
      updatedDate: nul(r[12]) === "" ? "" : needDate(r[12], "UpdatedDate", file, n),
      systemDate: needDate(r[13], "SystemDate", file, n),
    };
  });
}

export function readDeliveredSales(text: string, file: string): DeliveredSale[] {
  const { layout, rows } = csvRows(text, file);
  if (!layout.startsWith("sales-")) throw new DeliveryError(`${file}: this is a ${layout} file, not a sales file`);
  return rows.map((r, i) => {
    const n = i + 1;
    return {
      file,
      lot: need(r[3], "InventoryIdentifier", file, n),
      inventoryType: r[2],
      saleDate: needDate(r[6], "SaleDate", file, n),
      quantity: needDec(r[7], "quantity", file, n),
      systemDate: needDate(r[12], "SystemDate", file, n),
    };
  });
}

/** Sheet rows (already xlsxCellText) -> records, header checked exactly. Trailing empty rows dropped. */
export function readDeliveredSheet(sheet: DeliverySheet, rows: readonly (readonly string[])[]): Record<string, string>[] {
  if (rows.length === 0) throw new DeliveryError(`sheet ${sheet}: empty`);
  const want = DELIVERY_SHEETS[sheet] as readonly string[];
  const head = rows[0].slice(0, want.length);
  if (head.length !== want.length || head.some((h, i) => h !== want[i]) || rows[0].slice(want.length).some((c) => c !== "")) {
    throw new DeliveryError(`sheet ${sheet}: header does not match the delivered layout. got ${JSON.stringify(rows[0])}`);
  }
  const body = rows.slice(1).filter((r) => r.some((c) => c !== ""));
  return body.map((r, i) => {
    if (r.slice(want.length).some((c) => c !== "")) throw new DeliveryError(`sheet ${sheet}: data row ${i + 1} has cells beyond the header`);
    const o: Record<string, string> = {};
    want.forEach((h, k) => { o[h] = r[k] ?? ""; });
    return o;
  });
}

/* ------------------------------------------------------------------ *
 * The delivered set
 * ------------------------------------------------------------------ */

export type DeliveredProduct = { id: string; name: string; description: string; type: string; category: string; weight: string; payload: Record<string, string> };

export type DeliverySet = {
  lots: DeliveredLot[];
  sales: DeliveredSale[];
  products: Record<string, string>[];
  strains: Record<string, string>[];
  areas: Record<string, string>[];
};

export const DELIVERY_LICENSE = "413541";

/** Seed-shaped Inventory payload (SEED_HEADERS key names) plus where it came from. */
export function lotPayload(l: DeliveredLot, productId: string): Record<string, string> {
  return {
    "License Number": l.license,
    Strain: l.strain,
    "Inventory Type": l.productType,
    Name: l.productName,
    "Product Identifier": productId,
    // the delivered layout carries the Product NAME only; the 9/18 column held the Description
    "Product Name": "",
    IsMedical: l.isMedical,
    "InventoryIdentifier (ExternalIdentifier on inventory.csv)": l.id,
    "Initial Quantity": l.initial,
    "Quantity on Hand": l.qoh,
    TotalCost: l.cost,
    CreatedBy: l.createdBy,
    CreatedDate: l.createdDate,
    Updatedby: l.updatedBy,
    UpdatedDate: l.updatedDate,
    "System Date": l.systemDate,
    "Delivered In": l.file,
  };
}

function productOf(r: Record<string, string>): DeliveredProduct {
  const id = r.ExternalIdentifier;
  if (id === "" || id === "NULL") throw new DeliveryError("sheet Product: a row has no ExternalIdentifier");
  if (r.Name === "" || r.Name === "NULL") throw new DeliveryError(`sheet Product: ${id} has no Name`);
  const payload: Record<string, string> = {
    Inventorytype: r.ProductType,
    Name: r.Name,
    Description: nul(r.Description),
    UnitWeightGrams: r.UnitWeightGrams,
    ExternalIdentifier: id,
    CreatedBy: nul(r.CreatedBy),
    CreatedDate: r.CreatedDate,
    UpdatedBy: nul(r.UpdatedBy),
    UpdatedDate: nul(r.UpdatedDate),
    InventoryCategory: r.InventoryCategory,
    UnitOfMeasure: r.unitofmeasure,
  };
  return { id, name: r.Name, description: nul(r.Description), type: r.ProductType, category: r.InventoryCategory, weight: r.UnitWeightGrams, payload };
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

export type DeliveryOp = "add" | "refresh" | "settleLink";

export type DeliveryWrite = {
  op: DeliveryOp;
  t: LedgerFileType;
  id: string;
  name: string | null;
  prod: string | null;
  state: LedgerState;
  source: string;
  payload: Record<string, string>;
  conflicts: Record<string, string>[] | null;
  expectState: LedgerState | null;
  expectUpdatedAt: string | null;
  why: string;
};

export type DeliveryReviewItem = { t: LedgerFileType; id: string; ledgerState: LedgerState | null; why: string };

export const DELIVERY_REVIEW_META = {
  oursDiffers: "One of our own files already wrote this record and the delivery disagrees. Ours is kept; check it.",
  deletedPresent: "Our ledger says Deleted, but the delivery still lists it.",
  uncertainProved: "Our last file about this record has no clear answer yet; the delivery shows CCRS holds it. Apply that file's email (proof by reference settles it).",
  unknownHeld: "The ledger holds this id as unknown (not a migration-lot link). Left as it is.",
  productUnresolved: "No product in the Product list (or the ledger) has this lot's exact Name and type, so its Inventory Update waits [G L0576].",
  twinDiffers: "Products sharing this lot's Name differ in description, type, category or weight. The lowest id is recorded; the Name sent is the same either way (U-82).",
  strainNotOnRecord: "The lot's strain is not a strain CCRS holds for us, in the ledger or the delivered Strain list [G L0555].",
  productNotInList: "A product in our ledger is not in the delivered Product list (which is the full history). Left as it is.",
  lotTwice: "The lot is in both inventory files with different values; the later System Date is used and both rows are kept.",
} as const;
export type DeliveryReviewBucket = keyof typeof DELIVERY_REVIEW_META;

export type DeliveryPlan = {
  asOf: string;
  source: string;
  proofSource: string;
  writes: DeliveryWrite[];
  review: Record<DeliveryReviewBucket, DeliveryReviewItem[]>;
  counts: {
    delivered: { lots: number; saleRows: number; saleLots: number; products: number; strains: number; areas: number };
    add: Record<"Inventory" | "Product" | "Strain" | "Area", number>;
    refresh: Record<"Inventory" | "Product" | "Strain" | "Area", number>;
    settleLink: number;
    proofAdd: number;
    proofSettle: number;
    unchanged: number;
    alreadyOnFileBySale: number;
    /** U-68: delivered open lots whose later sales CCRS's quantity does not reflect */
    staleQoh: number;
    /** U-68: of those, lots the later sales sold out */
    soldOutStillOpen: number;
    review: Record<DeliveryReviewBucket, number>;
  };
};

const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);
const keyOf = (t: string, id: string) => `${t}\u0000${id}`;
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `proof:<asOf>-delivery-sale` - a lot proven only by an accepted Cultivera sale. */
export function proofSource(asOf: string): string {
  reseedSource(asOf);
  return `proof:${asOf}-delivery-sale`;
}

/** Decimal text -> integer thousandths (3 places is more than any delivered value carries). */
function milli(s: string): bigint {
  const [w, f = ""] = s.split(".");
  if (f.length > 3) throw new DeliveryError(`quantity ${s} has more than 3 decimals`);
  return BigInt(w) * BigInt(1000) + BigInt((f + "000").slice(0, 3));
}

export function planDeliveryMerge(set: DeliverySet, ledger: readonly LedgerRow[], asOf: string): DeliveryPlan {
  let source: string;
  try { source = reseedSource(asOf); } catch (e) { throw new DeliveryError(e instanceof ReseedError ? e.message.replace("--as-of", "the delivery date") : String(e)); }
  const pSource = proofSource(asOf);
  if (!ledger.some((r) => r.source.startsWith("seed:"))) throw new DeliveryError("the ledger has no seeded rows: the 9/18 seed must be loaded first (S-12a)");
  const L = new Map<string, LedgerRow>();
  for (const r of ledger) {
    const k = keyOf(r.t, r.id);
    if (L.has(k)) throw new DeliveryError(`ledger holds ${r.t} ${JSON.stringify(r.id)} twice`);
    L.set(k, r);
  }
  for (const l of set.lots) if (l.license !== DELIVERY_LICENSE) throw new DeliveryError(`${l.file}: lot ${l.id} is for license ${l.license}, not ${DELIVERY_LICENSE}`);
  for (const [name, rows] of [["Product", set.products], ["strains", set.strains], ["areas", set.areas]] as const) {
    for (const r of rows) if (r.LicenseNumber !== DELIVERY_LICENSE) throw new DeliveryError(`sheet ${name}: a row is for license ${r.LicenseNumber}, not ${DELIVERY_LICENSE}`);
  }

  const writes: DeliveryWrite[] = [];
  const review = Object.fromEntries(Object.keys(DELIVERY_REVIEW_META).map((k) => [k, [] as DeliveryReviewItem[]])) as DeliveryPlan["review"];
  const rv = (b: DeliveryReviewBucket, t: LedgerFileType, id: string, st: LedgerState | null, why: string) => review[b].push({ t, id, ledgerState: st, why });
  const add = { Inventory: 0, Product: 0, Strain: 0, Area: 0 };
  const refresh = { ...add };
  let settleLink = 0;
  let proofAdd = 0;
  let proofSettle = 0;
  let unchanged = 0;
  let alreadyOnFileBySale = 0;
  const untouchedSeed = (l: LedgerRow) => l.lastFile === null && (l.source.startsWith("seed:") || l.source.startsWith("proof:")) && (l.state === "seed" || l.state === "closed");
  const linkRow = (l: LedgerRow) => l.lastFile === null && l.state === "unknown" && l.source === LINK_SOURCE;
  const guard = (l: LedgerRow) => ({ expectState: l.state, expectUpdatedAt: l.updatedAt });

  /* ---- Products (the full list) ---- */
  const products = new Map<string, DeliveredProduct>();
  for (const r of set.products) {
    const p = productOf(r);
    if (products.has(p.id)) throw new DeliveryError(`sheet Product lists ${p.id} twice`);
    products.set(p.id, p);
  }
  for (const p of products.values()) {
    const l = L.get(keyOf("Product", p.id));
    const state: LedgerState = p.id === "1" ? "unknown" : "seed";
    if (!l) { writes.push({ op: "add", t: "Product", id: p.id, name: p.name, prod: null, state, source, payload: p.payload, conflicts: null, expectState: null, expectUpdatedAt: null, why: "not in the ledger: filed after 9/18" }); add.Product += 1; continue; }
    if (l.name === p.name) { unchanged += 1; continue; } // a name is all CCRS joins on; same name = nothing to change
    if (untouchedSeed(l) && l.state === "seed") { writes.push({ op: "refresh", t: "Product", id: p.id, name: p.name, prod: null, state: "seed", source, payload: p.payload, conflicts: null, ...guard(l), why: `renamed: ${JSON.stringify(l.name)} -> ${JSON.stringify(p.name)}` }); refresh.Product += 1; continue; }
    if (l.state === "deleted") { rv("deletedPresent", "Product", p.id, l.state, "Product"); continue; }
    rv("oursDiffers", "Product", p.id, l.state, `name ${JSON.stringify(l.name)} vs ${JSON.stringify(p.name)}`);
  }
  for (const l of ledger) if (l.t === "Product" && l.state !== "deleted" && l.state !== "unknown" && !products.has(l.id)) rv("productNotInList", "Product", l.id, l.state, l.name ?? "");

  /* ---- Strains ---- */
  const deliveredStrains = new Set<string>();
  for (const r of set.strains) {
    const name = r.Name;
    if (name === "" || name === "NULL") throw new DeliveryError("sheet strains: a row has no Name");
    if (deliveredStrains.has(name)) throw new DeliveryError(`sheet strains lists ${JSON.stringify(name)} twice`);
    deliveredStrains.add(name);
    const l = L.get(keyOf("Strain", name));
    if (!l) { writes.push({ op: "add", t: "Strain", id: name, name, prod: null, state: "seed", source, payload: { Name: name, CreatedBy: nul(r.CreatedBy), CreatedDate: r.CreatedDate, UpdatedBy: nul(r.UpdatedBy), UpdatedDate: nul(r.UpdatedDate) }, conflicts: null, expectState: null, expectUpdatedAt: null, why: "not in the ledger: filed after 9/18" }); add.Strain += 1; continue; }
    if (l.state === "deleted") rv("deletedPresent", "Strain", name, l.state, "Strain");
    else unchanged += 1;
  }

  /* ---- Areas ---- */
  const areaIds = new Set<string>();
  for (const r of set.areas) {
    const id = r.areaexternalIdentifier;
    if (id === "" || id === "NULL" || r.Name === "" || r.Name === "NULL") throw new DeliveryError("sheet areas: a row has no id or Name");
    if (areaIds.has(id)) throw new DeliveryError(`sheet areas lists ${id} twice`);
    areaIds.add(id);
    const payload = { Name: r.Name, ExternalIdentifier: id, CreatedBy: nul(r.CreatedBy), CreatedDate: r.CreatedDate, UpdatedBy: nul(r.UpdatedBy), UpdatedDate: nul(r.UpdatedDate) };
    const l = L.get(keyOf("Area", id));
    if (!l) { writes.push({ op: "add", t: "Area", id, name: r.Name, prod: null, state: "seed", source, payload, conflicts: null, expectState: null, expectUpdatedAt: null, why: "not in the ledger" }); add.Area += 1; continue; }
    if (l.name === r.Name) { unchanged += 1; continue; }
    if (untouchedSeed(l)) { writes.push({ op: "refresh", t: "Area", id, name: r.Name, prod: null, state: l.state, source, payload, conflicts: null, ...guard(l), why: `renamed: ${JSON.stringify(l.name)} -> ${JSON.stringify(r.Name)}` }); refresh.Area += 1; continue; }
    if (l.state === "deleted") { rv("deletedPresent", "Area", id, l.state, "Area"); continue; }
    rv("oursDiffers", "Area", id, l.state, `name ${JSON.stringify(l.name)} vs ${JSON.stringify(r.Name)}`);
  }

  /* ---- Product join (exact Name + type), delivered list first, then the ledger ---- */
  const byName = new Map<string, DeliveredProduct[]>();
  for (const p of products.values()) {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name)!.push(p);
  }
  const ledgerByName = new Map<string, LedgerRow[]>();
  for (const l of ledger) {
    if (l.t !== "Product" || !PRESENT.has(l.state) || !l.name || products.has(l.id)) continue;
    if (!ledgerByName.has(l.name)) ledgerByName.set(l.name, []);
    ledgerByName.get(l.name)!.push(l);
  }
  const resolveProduct = (lot: DeliveredLot): { id: string | null; why: string | null; twinDiffers: boolean } => {
    const fromList = (byName.get(lot.productName) ?? []).filter((p) => p.type === lot.productType);
    if (fromList.length > 0) {
      const sorted = [...fromList].sort((a, b) => byCodeUnit(a.id, b.id));
      const f = (p: DeliveredProduct) => `${p.description}\u0000${p.type}\u0000${p.category}\u0000${p.weight}`;
      return { id: sorted[0].id, why: null, twinDiffers: new Set(sorted.map(f)).size > 1 };
    }
    const fromLedger = (ledgerByName.get(lot.productName) ?? []).filter((l) => (l.payload?.Inventorytype ?? lot.productType) === lot.productType);
    if (fromLedger.length > 0) return { id: [...fromLedger].sort((a, b) => byCodeUnit(a.id, b.id))[0].id, why: null, twinDiffers: false };
    const anyType = (byName.get(lot.productName) ?? []).length;
    return { id: null, why: anyType ? `products named ${JSON.stringify(lot.productName)} exist, none of type ${lot.productType}` : `no product named ${JSON.stringify(lot.productName)}`, twinDiffers: false };
  };

  /* ---- Strain check (any casing, present in the ledger, or delivered now) ---- */
  const strainFold = new Set<string>();
  for (const l of ledger) if (l.t === "Strain" && l.state !== "deleted" && l.state !== "unknown") strainFold.add(l.id.toLowerCase());
  for (const s of deliveredStrains) strainFold.add(s.toLowerCase());

  /* ---- Lots: one per id; a lot in both files keeps the later System Date ---- */
  const lots = new Map<string, { lot: DeliveredLot; all: DeliveredLot[] }>();
  for (const l of set.lots) {
    const g = lots.get(l.id);
    if (!g) { lots.set(l.id, { lot: l, all: [l] }); continue; }
    g.all.push(l);
    if (mdyToIso(l.systemDate)! > mdyToIso(g.lot.systemDate)!) g.lot = l;
  }
  const salesByLot = new Map<string, DeliveredSale[]>();
  for (const s of set.sales) {
    if (!salesByLot.has(s.lot)) salesByLot.set(s.lot, []);
    salesByLot.get(s.lot)!.push(s);
  }
  // the two sales files overlap (10/24-10/26): one sale counted once, by its full row
  const uniqueSales = (rows: DeliveredSale[]) => {
    const seenByFile = new Map<string, Map<string, number>>();
    for (const s of rows) {
      const k = `${s.saleDate}\u0000${s.quantity}\u0000${s.systemDate}`;
      const m = seenByFile.get(s.file) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + 1);
      seenByFile.set(s.file, m);
    }
    const merged = new Map<string, number>();
    for (const m of seenByFile.values()) for (const [k, n] of m) merged.set(k, Math.max(merged.get(k) ?? 0, n));
    const out: { saleDate: string; quantity: string }[] = [];
    for (const [k, n] of merged) { const [saleDate, quantity] = k.split("\u0000"); for (let i = 0; i < n; i += 1) out.push({ saleDate, quantity }); }
    return out;
  };
  let staleQoh = 0;
  let soldOutStillOpen = 0;

  for (const id of [...lots.keys()].sort(byCodeUnit)) {
    const { lot, all } = lots.get(id)!;
    // two rows for one lot are "the same" when they differ only in which file carried them
    const sig = (x: DeliveredLot) => ({ ...lotPayload(x, ""), "Delivered In": "" });
    const distinct = all.filter((x, i) => all.findIndex((y) => samePayload(sig(y), sig(x))) === i);
    const conflicts = distinct.length > 1 ? distinct.map((x) => lotPayload(x, "")) : null;
    if (conflicts) rv("lotTwice", "Inventory", id, null, `${distinct.length} different rows; using ${lot.file}`);
    const pr = resolveProduct(lot);
    if (pr.id === null) rv("productUnresolved", "Inventory", id, null, pr.why ?? "");
    if (pr.twinDiffers) rv("twinDiffers", "Inventory", id, null, lot.productName);
    if (!strainFold.has(lot.strain.toLowerCase())) rv("strainNotOnRecord", "Inventory", id, null, lot.strain);
    // U-68: sales dated after the System Date of the lot's Insert are not in its quantity
    const sys = mdyToIso(lot.systemDate)!;
    const later = uniqueSales(salesByLot.get(id) ?? []).filter((s) => mdyToIso(s.saleDate)! > sys);
    if (later.length > 0) {
      staleQoh += 1;
      const sold = later.reduce((a, s) => a + milli(s.quantity), BigInt(0));
      if (sold >= milli(lot.qoh)) soldOutStillOpen += 1;
    }
    const payload = lotPayload(lot, pr.id ?? "");
    const state: LedgerState = milli(lot.qoh) === BigInt(0) ? "closed" : "seed";
    const l = L.get(keyOf("Inventory", id));
    const base = { t: "Inventory" as const, id, name: null, prod: pr.id, payload, conflicts, source };
    if (!l) { writes.push({ ...base, op: "add", state, expectState: null, expectUpdatedAt: null, why: `delivered (${lot.file})` }); add.Inventory += 1; continue; }
    if (linkRow(l)) { writes.push({ ...base, op: "settleLink", state, ...guard(l), why: "migration lot is on the CCRS record (delivered)" }); settleLink += 1; continue; }
    if (untouchedSeed(l)) {
      const differs = l.state !== state || l.prod !== pr.id || l.source !== source || !samePayload(l.payload, payload);
      if (!differs) { unchanged += 1; continue; }
      writes.push({ ...base, op: "refresh", state, ...guard(l), why: l.source.startsWith("proof:") ? "proved by a sale earlier; now delivered in full" : "the delivery is newer than the seed" });
      refresh.Inventory += 1;
      continue;
    }
    if (l.state === "uncertain") { rv("uncertainProved", "Inventory", id, l.state, "delivered"); continue; }
    if (l.state === "deleted") { rv("deletedPresent", "Inventory", id, l.state, "delivered"); continue; }
    if (l.state === "unknown") { rv("unknownHeld", "Inventory", id, l.state, l.source); continue; }
    if (l.prod !== pr.id || (l.state === "closed") !== (state === "closed")) rv("oursDiffers", "Inventory", id, l.state, `ledger product ${JSON.stringify(l.prod)}, delivered ${JSON.stringify(pr.id)}; ledger ${l.state}, delivered ${state}`);
    else unchanged += 1;
  }

  /* ---- Lots proven only by an accepted Cultivera sale [G L1302-L1304] ---- */
  for (const id of [...salesByLot.keys()].sort(byCodeUnit)) {
    if (lots.has(id)) continue;
    const rows = salesByLot.get(id)!;
    const dates = rows.map((s) => mdyToIso(s.saleDate)!).sort();
    const payload = { Proof: "a sale CCRS accepted names this lot", "Inventory Type": rows[0].inventoryType, "First Sale Date": dates[0], "Last Sale Date": dates[dates.length - 1], "Sale Rows": String(rows.length) };
    const l = L.get(keyOf("Inventory", id));
    const base = { t: "Inventory" as const, id, name: null, prod: null, payload, conflicts: null, source: pSource };
    if (!l) { writes.push({ ...base, op: "add", state: "seed", expectState: null, expectUpdatedAt: null, why: "named by an accepted Cultivera sale" }); proofAdd += 1; continue; }
    if (linkRow(l)) { writes.push({ ...base, op: "settleLink", state: "seed", ...guard(l), why: "migration lot named by an accepted Cultivera sale" }); proofSettle += 1; continue; }
    if (PRESENT.has(l.state) || l.state === "closed") { alreadyOnFileBySale += 1; continue; }
    if (l.state === "uncertain") rv("uncertainProved", "Inventory", id, l.state, "named by an accepted Cultivera sale");
    else if (l.state === "deleted") rv("deletedPresent", "Inventory", id, l.state, "named by an accepted Cultivera sale");
    else rv("unknownHeld", "Inventory", id, l.state, l.source);
  }

  for (const b of Object.keys(review) as DeliveryReviewBucket[]) review[b].sort((a, c) => byCodeUnit(a.t, c.t) || byCodeUnit(a.id, c.id));
  return {
    asOf, source, proofSource: pSource, writes, review,
    counts: {
      delivered: { lots: lots.size, saleRows: set.sales.length, saleLots: salesByLot.size, products: products.size, strains: deliveredStrains.size, areas: areaIds.size },
      add, refresh, settleLink, proofAdd, proofSettle, unchanged, alreadyOnFileBySale, staleQoh, soldOutStillOpen,
      review: Object.fromEntries(Object.entries(review).map(([k, v]) => [k, v.length])) as Record<DeliveryReviewBucket, number>,
    },
  };
}

/** Writes that add a row vs. change one (the apply's expected counts). */
export function deliveryExpect(plan: DeliveryPlan): { add: number; upd: number } {
  const a = plan.writes.filter((w) => w.op === "add").length;
  return { add: a, upd: plan.writes.length - a };
}

/** Ledger rows as a seed-shaped copy (equalize / verify input): every delivered or seeded lot with a quantity. */
export function ledgerAsCopy(ledger: readonly LedgerRow[]): SeedEntity[] {
  const out: SeedEntity[] = [];
  for (const l of ledger) {
    if (l.payload === null || l.lastFile !== null || !l.source.startsWith("seed:")) continue;
    if (l.t === "Inventory" && !(typeof l.payload["Quantity on Hand"] === "string" && /^-?\d+(\.\d+)?$/.test(l.payload["Quantity on Hand"]))) continue;
    out.push({ env: "prod", fileType: l.t, externalId: l.id, filedName: l.name, productExternalId: l.prod, state: l.state, source: l.source, seedPayload: l.payload, seedConflicts: null });
  }
  return out;
}

/** Plain-text report for the CLI and the page's download. */
export function deliveryReport(plan: DeliveryPlan, limit = 200): string {
  const c = plan.counts;
  const lines = [
    `CCRS examiner delivery merge (D250) - as of ${plan.asOf}`,
    `source ${plan.source}; sale proof ${plan.proofSource}`,
    "",
    `Delivered: ${c.delivered.lots} lots, ${c.delivered.saleRows} sale rows naming ${c.delivered.saleLots} lots, ${c.delivered.products} products, ${c.delivered.strains} strains, ${c.delivered.areas} areas`,
    `Add:      Inventory ${c.add.Inventory}, Product ${c.add.Product}, Strain ${c.add.Strain}, Area ${c.add.Area}`,
    `Refresh:  Inventory ${c.refresh.Inventory}, Product ${c.refresh.Product}, Area ${c.refresh.Area}`,
    `Migration lots settled: ${c.settleLink}`,
    `Lots proven by an accepted sale: ${c.proofAdd} added, ${c.proofSettle} migration lots settled, ${c.alreadyOnFileBySale} already on file`,
    `Unchanged: ${c.unchanged}`,
    `U-68: ${c.staleQoh} delivered lots have later sales CCRS's quantity does not show; ${c.soldOutStillOpen} of them are sold out but still open in CCRS`,
    "",
  ];
  for (const b of Object.keys(plan.review) as DeliveryReviewBucket[]) {
    const items = plan.review[b];
    lines.push(`${b}: ${items.length} - ${DELIVERY_REVIEW_META[b]}`);
    for (const it of items.slice(0, limit)) lines.push(`  ${it.t} ${it.id}${it.ledgerState ? ` [${it.ledgerState}]` : ""} ${it.why}`);
    if (items.length > limit) lines.push(`  ... ${items.length - limit} more`);
  }
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ *
 * Self-test
 * ------------------------------------------------------------------ */

export function __runCcrsDeliveryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else { failed += 1; console.error(`  FAIL ccrs-delivery-core: ${msg}`); }
  };
  const throws = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof DeliveryError; } };
  const H17 = DELIVERY_CSV_LAYOUTS["inventory-2026-11-17"].join(",");
  const H13 = DELIVERY_CSV_LAYOUTS["inventory-2026-11-13"].join(",");
  const S17 = DELIVERY_CSV_LAYOUTS["sales-2026-11-17"].join(",");

  ok(detectDeliveryCsv("\uFEFF" + H17 + "\r") === "inventory-2026-11-17" && detectDeliveryCsv(H13) === "inventory-2026-11-13" && detectDeliveryCsv(H17.replace("Licenes", "License")) === null, "exact header detection");
  ok(detectDeliveryCsv(H13.replace(" Updated Date ", "Updated Date")) === null, "padded header kept exact");
  ok(mdyToIso("9/18/2026") === "2026-09-18" && mdyToIso("2/30/2026") === null && mdyToIso("2026-09-18") === null, "M/D/YYYY dates");
  ok(xlsxCellText(413541) === "413541" && xlsxCellText(49.9) === "49.9" && xlsxCellText(new Date(Date.UTC(2024, 7, 22, 17, 44))) === "8/22/2024" && xlsxCellText(null) === "" && xlsxCellText({ result: 2 }) === "2", "xlsx cell text");
  ok(throws(() => xlsxCellText(NaN)) && throws(() => xlsxCellText(Symbol("x"))), "odd cells refused");

  const inv17 = `\uFEFF${H17}\r\n413541,Blue Dream,Usable Cannabis,Twin Name,1,LOT1,10,4,0.01,User-110211,9/18/2026,NULL,NULL,9/19/2026\r\n413541,C99,Usable Cannabis,Solo,0,LOT2,5,5,0.01,User-110211,10/1/2026,NULL,NULL,10/4/2026\r\n`;
  const lots = readDeliveredInventory(inv17, "inv17");
  ok(lots.length === 2 && lots[0].isMedical === "TRUE" && lots[1].isMedical === "FALSE" && lots[0].updatedBy === "", "inventory read: bit -> TRUE/FALSE, NULL -> empty");
  ok(throws(() => readDeliveredInventory(inv17.replace(",1,LOT1", ",Y,LOT1"), "x")) && throws(() => readDeliveredInventory(inv17.replace(",10,4,", ",10,-4,"), "x")) && throws(() => readDeliveredInventory(`${S17}\r\n`, "x")), "bad bit / negative / wrong file refused");
  const sales = readDeliveredSales(`${S17}\r\n413541,GREENWAY MARIJUANA,Usable Cannabis,LOT1,0,RecreationalRetail,10/1/2026,4,10,0,1,3.7,10/2/2026\r\n413541,GREENWAY MARIJUANA,Usable Cannabis,OLD9,0,RecreationalRetail,10/1/2026,1,10,0,1,3.7,10/2/2026\r\n413541,GREENWAY MARIJUANA,Usable Cannabis,MIG7,0,RecreationalRetail,10/3/2026,1,10,0,1,3.7,10/4/2026\r\n`, "s17");
  ok(sales.length === 3 && sales[0].lot === "LOT1", "sales read");
  const head = (s: DeliverySheet) => [...DELIVERY_SHEETS[s]] as string[];
  const prodRows = [head("Product"),
    ["413541", "G", "Twin Name", "NULL", "C1100011", "EndProduct", "Usable Cannabis", "Each", "1", "U", "1/1/2025", "NULL", "NULL", ""],
    ["413541", "G", "Twin Name", "NULL", "C1-11021100011", "EndProduct", "Usable Cannabis", "Each", "1", "U", "1/1/2025", "NULL", "NULL", ""],
    ["413541", "G", "Solo", "NULL", "C1-NEWSOLO", "EndProduct", "Usable Cannabis", "Each", "1", "U", "10/1/2026", "NULL", "NULL", ""],
    ["413541", "G", "Renamed Now", "d", "P1", "EndProduct", "Usable Cannabis", "Each", "1", "U", "1/1/2020", "NULL", "NULL", ""]];
  const products = readDeliveredSheet("Product", prodRows);
  ok(products.length === 4 && throws(() => readDeliveredSheet("Product", [prodRows[0].slice(1), ...prodRows.slice(1)])), "sheet header exact");
  const strains = readDeliveredSheet("strains", [head("strains"), ["413541", "G", "C99", "U", "10/1/2026", "NULL", "NULL"]]);
  const areas = readDeliveredSheet("areas", [head("areas"), ["413541", "G", "C1100011", "Sales Floor", "U", "8/22/2024", "NULL", "NULL"]]);

  const row = (t: LedgerFileType, id: string, over: Partial<LedgerRow> = {}): LedgerRow => ({ t, id, name: t === "Inventory" ? null : id, prod: null, state: "seed", source: "seed:2026-09-18-delivery", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789900000123456", payload: { k: id }, ...over });
  const ledger: LedgerRow[] = [
    row("Product", "C1100011", { name: "Twin Name" }), row("Product", "P1", { name: "Old Name" }),
    row("Strain", "blue dream"), row("Area", "C1100011", { name: "Sales Floor" }),
    row("Inventory", "OLD9"), row("Inventory", "MIG7", { state: "unknown", source: LINK_SOURCE, payload: null }),
    row("Inventory", "LOT2", { state: "filed", lastFile: "f1", source: "file:x", prod: "C1-NEWSOLO" }),
  ];
  const set: DeliverySet = { lots, sales, products, strains, areas };
  const p = planDeliveryMerge(set, ledger, "2026-11-17");
  const w = (t: string, id: string) => p.writes.find((x) => x.t === t && x.id === id);
  ok(w("Inventory", "LOT1")?.op === "add" && w("Inventory", "LOT1")!.prod === "C1-11021100011" && w("Inventory", "LOT1")!.source === "seed:2026-11-17-delivery", "new lot added; twin -> lowest id (C1- before C11)");
  ok(w("Inventory", "LOT1")!.payload["Quantity on Hand"] === "4" && w("Inventory", "LOT1")!.payload.IsMedical === "TRUE" && w("Inventory", "LOT1")!.payload.Name === "Twin Name", "seed-shaped payload");
  ok(w("Inventory", "LOT2") === undefined && p.review.oursDiffers.length === 0, "our filed lot never written");
  ok(w("Product", "P1")?.op === "refresh" && w("Product", "P1")!.expectUpdatedAt === "1789900000123456" && w("Product", "C1100011") === undefined && w("Product", "C1-NEWSOLO")?.op === "add", "product rename refreshed, same name unchanged, new added");
  ok(w("Strain", "C99")?.op === "add" && w("Area", "C1100011") === undefined, "strain added, area unchanged");
  ok(w("Inventory", "MIG7")?.op === "settleLink" && w("Inventory", "MIG7")!.source === "proof:2026-11-17-delivery-sale" && w("Inventory", "OLD9") === undefined && p.counts.alreadyOnFileBySale === 1, "sale proof: migration lot settled, seeded lot untouched");
  ok(p.counts.staleQoh === 1 && p.counts.soldOutStillOpen === 1 && p.review.strainNotOnRecord.length === 0, "strain found in any casing; the 10/1 sale after the 9/19 System Date is stale and sells it out");
  ok(deliveryExpect(p).add + deliveryExpect(p).upd === p.writes.length && deliveryExpect(p).upd === 2, "expected counts");
  // a sale on/before the System Date is already in the quantity; a partial later sale is stale, not sold out
  const p2 = planDeliveryMerge({ ...set, sales: readDeliveredSales(`${S17}\r\n413541,G,Usable Cannabis,LOT1,0,RecreationalRetail,9/19/2026,4,10,0,1,3.7,9/19/2026\r\n413541,G,Usable Cannabis,LOT2,0,RecreationalRetail,10/5/2026,2,10,0,1,3.7,10/5/2026\r\n`, "s") }, ledger, "2026-11-17");
  ok(p2.counts.staleQoh === 1 && p2.counts.soldOutStillOpen === 0, "U-68 stale quantity measured");
  // idempotent: the ledger after the apply plans nothing
  const after: LedgerRow[] = [...ledger.filter((l) => !p.writes.some((x) => x.t === l.t && x.id === l.id)), ...p.writes.map((x) => row(x.t, x.id, { name: x.name, prod: x.prod, state: x.state, source: x.source, payload: x.payload }))];
  const again = planDeliveryMerge(set, after, "2026-11-17");
  ok(again.writes.length === 0, `re-run plans nothing (got ${again.writes.map((x) => x.t + "/" + x.id + ":" + x.op).join(",")})`);
  ok(throws(() => planDeliveryMerge(set, ledger, "2026-09-18")) && throws(() => planDeliveryMerge(set, [row("Area", "x", { source: "file:x" })], "2026-11-17")), "date and seeded ledger required");
  ok(throws(() => planDeliveryMerge({ ...set, lots: [{ ...lots[0], license: "999999" }] }, ledger, "2026-11-17")), "other license refused");
  const unresolved = planDeliveryMerge({ ...set, lots: [{ ...lots[1], productName: "Nobody" }] }, ledger.filter((l) => l.id !== "LOT2"), "2026-11-17");
  ok(unresolved.review.productUnresolved.length === 1 && w("Inventory", "LOT2") === undefined && unresolved.writes.find((x) => x.id === "LOT2")!.prod === null, "unresolved product: added without a product, reported");
  const copy = ledgerAsCopy(after);
  ok(copy.some((e) => e.externalId === "LOT1") && !copy.some((e) => e.externalId === "MIG7") && !copy.some((e) => e.externalId === "LOT2"), "composite copy: delivered lots in, proof-only and our lots out");
  ok(deliveryReport(p).includes("Add:      Inventory 1"), "report");
  return { passed, failed };
}
