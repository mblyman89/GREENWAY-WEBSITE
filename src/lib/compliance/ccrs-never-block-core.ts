/**
 * src/lib/compliance/ccrs-never-block-core.ts - R74 S42 (owner, Round 22).
 *
 * "i need you to continue hardening the ccrs upload logic so it never blocks
 * me from sending good data, ever ... link me to the product detail page, or
 * ... the onboarding page row where i set this info. or allow me to add it to
 * the clean up list of products we will remove from our ccrs record file."
 *
 * PURE (no I/O). Four jobs:
 *   1. applyProductHolds: a product whose Product row CCRS would reject (no
 *      unit weight E9, unknown type E57), a product on the owner's CCRS
 *      clean-up list (E58), a lot whose strain is reserved (E11) or whose id
 *      the ledger holds twice (E59) is WITHHELD in the plan, together with
 *      every lot that would name the withheld product ("Invalid Product"
 *      [G L0579]). CCRS accepts row by row (U-17 CLOSED FALSE), so the rest of
 *      the batch is complete and correct without them.
 *   2. The clean-up list (site_settings key CCRS_CLEANUP_SETTING_KEY).
 *   3. dropCsvDataRows / rowNumbersOf: a row the offline verifier or the
 *      ledger self-check would refuse is taken OUT of its file (E60) instead
 *      of refusing the whole zip.
 *   4. fixLinksFor: every issue row says where to fix it (product page,
 *      onboarding row, inventory search, lot page).
 */
import type { LedgerPlan, LedgerView, PlannedLot, PlannedProduct } from "./ccrs-ledger-core";
import { isReservedStrainName } from "./ccrs-preflight-core";

/* ------------------------------------------------------------------ *
 * 1. Plan holds
 * ------------------------------------------------------------------ */

/** Lot reason: its product row is held until a person fixes the product. */
export const PRODUCT_FIX_HOLD_PREFIX = "held until its product is fixed: ";
/** Lot reason: the product is on the owner's CCRS clean-up list (not owed). */
export const CLEANUP_LOT_REASON = "its product is on the CCRS clean-up list (removed from CCRS reporting by the owner)";
/** Lot reason: CCRS refuses the strain name (E11). */
export const RESERVED_STRAIN_LOT_REASON =
  'its strain name is reserved by CCRS ("Unknown", "THC" or "Other" [G L0358]); set the real strain on the product';
/** Lot / product reason: the ledger holds this id twice (E59). */
export const LEDGER_DUPLICATE_REASON = "our copy of the CCRS record holds this id twice, so what CCRS holds cannot be proven";

export type ProductHold = { reason: string; cleanup?: boolean };

export function applyProductHolds(input: {
  plan: LedgerPlan;
  view: LedgerView | null;
  /** product key -> why its Product row is held. */
  products: ReadonlyMap<string, ProductHold>;
  /** lot id -> reason, held regardless of product (E59). */
  lots?: ReadonlyMap<string, string>;
  lotKeys: readonly { lotId: string; productKey: string }[];
}): { plan: LedgerPlan; heldProducts: Set<string>; heldLotsByKey: Map<string, number> } {
  const { plan, view } = input;
  const productsOut = new Map<string, PlannedProduct>(plan.products);
  const heldProducts = new Set<string>();
  for (const [key, h] of input.products) {
    const pp = productsOut.get(key);
    if (!pp) continue;
    // A product the routing already withholds stays withheld (its own reason
    // is kept) but is listed under the fix the owner can make.
    if (pp.action === "emit") productsOut.set(key, { action: "withhold", reason: h.reason });
    if (pp.action !== "skip" || h.cleanup) heldProducts.add(key);
  }
  const lotsOut = new Map<string, PlannedLot>(plan.lots);
  const heldLotsByKey = new Map<string, number>();
  const filedName = (n: string) => !!view && (view.productsByName.get(n) ?? []).length > 0;
  for (const { lotId, productKey } of input.lotKeys) {
    const pl = lotsOut.get(lotId);
    if (!pl || pl.action !== "emit") continue;
    const forced = input.lots?.get(lotId);
    const h = input.products.get(productKey);
    let reason: string | null = forced ?? null;
    if (!reason && h?.cleanup) reason = CLEANUP_LOT_REASON;
    else if (!reason && h && heldProducts.has(productKey) && !filedName(pl.productName)) reason = `${PRODUCT_FIX_HOLD_PREFIX}${h.reason}`;
    else if (!reason && pl.strain && plan.strainEmit.has(pl.strain) && isReservedStrainName(pl.strain)) reason = RESERVED_STRAIN_LOT_REASON;
    if (!reason) continue;
    lotsOut.set(lotId, { action: "withhold", reason });
    heldLotsByKey.set(productKey, (heldLotsByKey.get(productKey) ?? 0) + 1);
  }
  return { plan: { ...plan, products: productsOut, lots: lotsOut }, heldProducts, heldLotsByKey };
}

/* ------------------------------------------------------------------ *
 * 2. The CCRS clean-up list (site_settings)
 * ------------------------------------------------------------------ */

export const CCRS_CLEANUP_SETTING_KEY = "ccrs.cleanup_products";
export const CCRS_CLEANUP_MAX = 5000;
export type CleanupProduct = { key: string; label: string; at: string };

export function normalizeCleanup(v: unknown): CleanupProduct[] {
  const arr = v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : [];
  const seen = new Set<string>();
  const out: CleanupProduct[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim().slice(0, 200) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: typeof r.label === "string" ? r.label.slice(0, 300) : key, at: typeof r.at === "string" ? r.at : "" });
  }
  return out.slice(0, CCRS_CLEANUP_MAX);
}

export function addCleanup(list: readonly CleanupProduct[], item: CleanupProduct): CleanupProduct[] {
  const key = item.key.trim();
  if (!key) return [...list];
  return [...list.filter((x) => x.key !== key), { ...item, key }].slice(-CCRS_CLEANUP_MAX);
}

export function removeCleanup(list: readonly CleanupProduct[], key: string): CleanupProduct[] {
  return list.filter((x) => x.key !== key.trim());
}

/* ------------------------------------------------------------------ *
 * 3. Rows the verifier / ledger self-check refuse are taken out (E60)
 * ------------------------------------------------------------------ */

/** 1-based data-row numbers a verifier message names; [] = not a row problem. */
export function rowNumbersOf(message: string): number[] {
  const m = /^(?:Data|Sale) row (\d+)\b/.exec(message);
  if (m) return [Number(m[1])];
  if (/ is reused on /.test(message)) return [...message.matchAll(/\brow (\d+)\b/g)].map((x) => Number(x[1]));
  return [];
}

/** Remove 1-based data rows from an assembled CCRS csv; NumberRecords follows. */
export function dropCsvDataRows(csv: string, rows: ReadonlySet<number>): { csv: string; dropped: string[]; kept: number } {
  const lines = (csv.endsWith("\r\n") ? csv.slice(0, -2) : csv).split("\r\n");
  if (lines.length < 4 || rows.size === 0) return { csv, dropped: [], kept: Math.max(0, lines.length - 4) };
  const data = lines.slice(4);
  const keep: string[] = [];
  const dropped: string[] = [];
  data.forEach((l, i) => (rows.has(i + 1) ? dropped.push(l) : keep.push(l)));
  const head = [lines[0], lines[1], `NumberRecords,${keep.length}`, lines[3]];
  return { csv: [...head, ...keep].join("\r\n") + "\r\n", dropped, kept: keep.length };
}

/* ------------------------------------------------------------------ *
 * 4. Where to fix each row
 * ------------------------------------------------------------------ */

export type FixLink = { label: string; href: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codes whose row id is our product key (menu source_item_id). */
const PRODUCT_ROW_CODES = new Set([
  "E9_UNITWEIGHT_ZERO_USABLE",
  "E10_DESCRIPTION_REQUIRED",
  "E10_DESCRIPTION_TOO_LONG",
  "E11_STRAIN_NAME_RESERVED",
  "E57_PRODUCT_TYPE_UNKNOWN",
  "E58_PRODUCT_ON_CLEANUP_LIST",
]);

/** The product key a row names, or null when the row is not a product. */
export function productKeyOfRow(issue: { code?: string; file: string }, row: { id: string }): string | null {
  const id = (row.id ?? "").trim();
  if (!id) return null;
  if (issue.code && PRODUCT_ROW_CODES.has(issue.code)) return id;
  if (issue.code === "E41_LEDGER_WITHHELD" && issue.file === "Product") return id;
  return null;
}

export function fixLinksFor(issue: { code?: string; file: string }, row: { id: string }): FixLink[] {
  const key = productKeyOfRow(issue, row);
  if (key) {
    const q = encodeURIComponent(key);
    return [
      { label: "Product page", href: `/admin/products/${q}` },
      { label: "Onboarding row", href: `/admin/inventory/drafts?status=approved&q=${q}&page=1` },
      { label: "Find in inventory", href: `/admin/inventory?status=all&q=${q}` },
    ];
  }
  const id = (row.id ?? "").trim();
  if (UUID_RE.test(id)) return [{ label: "Open lot", href: `/admin/inventory/${id}` }];
  return [];
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCcrsNeverBlockTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", m);
    }
  };
  const plan: LedgerPlan = {
    strainEmit: new Set(["Unknown"]),
    strainCanonical: new Map(),
    strainCaseVariants: [],
    products: new Map<string, PlannedProduct>([
      ["k1", { action: "emit", op: "Insert", ext: "GWP-1" }],
      ["k2", { action: "skip", reason: "filed" }],
      ["k3", { action: "emit", op: "Insert", ext: "GWP-3" }],
    ]),
    renames: new Map(),
    lots: new Map<string, PlannedLot>([
      ["a", { action: "emit", op: "Insert", productName: "Yuzu", strain: "" }],
      ["b", { action: "emit", op: "Update", productName: "Filed", strain: "" }],
      ["c", { action: "emit", op: "Insert", productName: "Other", strain: "Unknown" }],
      ["d", { action: "emit", op: "Insert", productName: "Other", strain: "" }],
    ]),
    nameFromLedger: [],
  };
  const r = applyProductHolds({
    plan,
    view: null,
    products: new Map([["k1", { reason: "no unit weight" }], ["k2", { reason: "x", cleanup: true }]]),
    lots: new Map([["d", LEDGER_DUPLICATE_REASON]]),
    lotKeys: [
      { lotId: "a", productKey: "k1" },
      { lotId: "b", productKey: "k2" },
      { lotId: "c", productKey: "k3" },
      { lotId: "d", productKey: "k3" },
    ],
  });
  ok(r.plan.products.get("k1")?.action === "withhold", "E9 product withheld");
  ok(r.plan.products.get("k3")?.action === "emit", "other product untouched");
  const la = r.plan.lots.get("a");
  ok(la?.action === "withhold" && la.reason.startsWith(PRODUCT_FIX_HOLD_PREFIX), "its lot withheld (no Invalid Product)");
  const lb = r.plan.lots.get("b");
  ok(lb?.action === "withhold" && lb.reason === CLEANUP_LOT_REASON && r.heldProducts.has("k2"), "clean-up holds even filed lots");
  const lc = r.plan.lots.get("c");
  ok(lc?.action === "withhold" && lc.reason === RESERVED_STRAIN_LOT_REASON, "reserved strain lot withheld");
  const ld = r.plan.lots.get("d");
  ok(ld?.action === "withhold" && ld.reason === LEDGER_DUPLICATE_REASON, "duplicate-id lot withheld");
  ok(plan.lots.get("a")?.action === "emit", "input plan not mutated");

  let list = addCleanup([], { key: " pos-1 ", label: "Relic", at: "t" });
  list = addCleanup(list, { key: "pos-1", label: "Relic 2", at: "t" });
  ok(list.length === 1 && list[0].label === "Relic 2", "clean-up add dedupes");
  ok(removeCleanup(list, "pos-1").length === 0, "clean-up remove");
  ok(normalizeCleanup({ items: [{ key: "a" }, { key: "a" }, 5, { key: "" }] }).length === 1, "normalize drops junk");
  ok(normalizeCleanup(null).length === 0, "normalize null");

  ok(rowNumbersOf("Data row 7: bad date").join() === "7", "row number parsed");
  ok(rowNumbersOf('ExternalIdentifier "X" is reused on row 3 and row 9 (must be unique).').join() === "3,9", "reuse rows parsed");
  ok(rowNumbersOf("File does not use CRLF").length === 0, "file-level problem is not a row");
  const csv = "SubmittedBy,a\r\nSubmittedDate,b\r\nNumberRecords,3\r\nX,Y\r\n1,a\r\n2,b\r\n3,c\r\n";
  const d = dropCsvDataRows(csv, new Set([2]));
  ok(d.kept === 2 && d.dropped[0] === "2,b" && d.csv.includes("NumberRecords,2\r\n") && !d.csv.includes("2,b"), "row dropped, count follows");

  const links = fixLinksFor({ code: "E9_UNITWEIGHT_ZERO_USABLE", file: "Product" }, { id: "pos-db86af8ccba2" });
  ok(links.length === 3 && links[0].href === "/admin/products/pos-db86af8ccba2", "E9 row links to the product page");
  ok(links[1].href.includes("/admin/inventory/drafts?") && links[1].href.includes("q=pos-db86af8ccba2"), "and the onboarding row");
  ok(fixLinksFor({ code: "E7_TOTALCOST_ZERO", file: "Inventory" }, { id: "0b5e8a8e-1111-4222-8333-444455556666" })[0].href.startsWith("/admin/inventory/0b5e8a8e"), "lot row links to the lot");
  ok(fixLinksFor({ code: "E56_EVENT_ROW_LOT_HELD", file: "Sale" }, { id: "D1" }).length === 0, "no invented link");
  return { passed, failed };
}
