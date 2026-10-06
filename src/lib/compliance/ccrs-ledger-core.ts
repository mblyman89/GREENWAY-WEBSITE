/**
 * src/lib/compliance/ccrs-ledger-core.ts  (Bible v2 S-11, Part 03 §D.3)
 *
 * PURE routing from a ledger VIEW: "what does CCRS already hold?" in, "which
 * Operation (or withhold), which exact Name, which exact Strain spelling?" out.
 * No fs, no network, no Supabase. The ledger TABLES are S-12; until a view is
 * loaded the builders run exactly as before (an absent view = legacy path).
 *
 * ═══ GROUND ═══
 *   Operation  [G L0246-L0248] "Insert (create a new record with a unique
 *              external identifier). Update (alter an existing record indicated
 *              by external identifier). Delete (delete a record indicated by
 *              external identifier)."
 *   Strain     [G L0319-L0320] "the only upload type that does not include
 *              Operation … records can only be created, not updated or deleted."
 *              [G L0359] "Duplicate Strain. The Strain must be unique for the
 *              LicenseNumber."  Brian A16: "just do not submit the same name with
 *              a variation of captilization. EX: Dutch Treat vs Dutch treat".
 *   Product    [G L0580-L0583] Inventory.Product must be "this product name in
 *              the same format and spelling as previously submitted on the
 *              product.CSV". The join is by NAME, so a filed lot must name the
 *              product exactly as CCRS holds it.
 *
 * ═══ MEASURED (2026-09-18 LCB delivery; analysis3/s11/*.out) ═══
 *   • Product ids are Cultivera-shaped; 0 of 64,563 start "pos-" (our menu-card
 *     key) — so OUR product key never identifies a FILED product. The only
 *     honest bridge is the lot: filed Inventory id → its filed "Product
 *     Identifier" → that Product's filed Name (62,742 of 62,744 resolve).
 *   • The delivery's Inventory "Product Name" column is Product.DESCRIPTION
 *     (62,742/62,742), not the Name — never seed filed_name from it.
 *   • Strains.csv holds 2 case-variant groups already (Mack's GAK/Mack's Gak,
 *     Snoop's Dream x Gobbstopper/snoop's dream …). We never add a third.
 */

import { CCRS_COLUMNS } from "./ccrs-batch-core";

export type LedgerEnv = "preprod" | "prod";

export const LEDGER_STATES = ["seed", "filed", "confirmed", "uncertain", "closed", "deleted", "unknown"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export type LedgerFileType =
  | "Strain"
  | "Area"
  | "Product"
  | "Inventory"
  | "Sale"
  | "InventoryAdjustment"
  | "InventoryTransfer";

export type LedgerEntry = {
  fileType: LedgerFileType;
  /** Exact bytes as filed. For Strain this is the strain name (no id column). */
  externalId: string;
  /** Exact Name/Strain/Area string as filed (the join key CCRS uses). */
  filedName: string | null;
  state: LedgerState;
  /** Inventory only: the filed "Product Identifier" the lot points at. */
  productExternalId?: string | null;
};

export type LedgerView = {
  env: LedgerEnv;
  /** key = `${fileType}\u0000${externalId}` — exact, never case-folded. */
  entries: ReadonlyMap<string, LedgerEntry>;
  /** lower-cased strain → every filed casing (sorted, so choice is stable). */
  strainsByFold: ReadonlyMap<string, readonly string[]>;
  /** exact filed Product Name → filed product ids holding it (present states). */
  productsByName: ReadonlyMap<string, readonly string[]>;
  /**
   * Our product key → the CCRS Product id ASSIGNED to it (a minted `GWP-` id,
   * S-12). Never derived at export time: a key with no assignment is withheld.
   */
  productIdByKey: ReadonlyMap<string, string>;
};

const SEP = "\u0000";
const keyOf = (t: LedgerFileType, id: string) => `${t}${SEP}${id}`;

/** States from which CCRS demonstrably holds the record. */
const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);

/**
 * Build a view from ledger rows. A duplicate (fileType, externalId) is a data
 * fault upstream; it is REPORTED, never silently resolved — the first row wins
 * and the duplicate id is returned so the caller can surface it.
 */
export function buildLedgerView(
  env: LedgerEnv,
  rows: readonly LedgerEntry[],
  productIdByKey: ReadonlyMap<string, string> = new Map(),
): { view: LedgerView; duplicates: string[] } {
  const entries = new Map<string, LedgerEntry>();
  const fold = new Map<string, Set<string>>();
  const byName = new Map<string, string[]>();
  const duplicates: string[] = [];
  for (const r of rows) {
    if (!(LEDGER_STATES as readonly string[]).includes(r.state)) {
      throw new Error(`ledger row ${r.fileType}/${r.externalId}: unknown state "${String(r.state)}"`);
    }
    const k = keyOf(r.fileType, r.externalId);
    if (entries.has(k)) {
      duplicates.push(`${r.fileType}/${r.externalId}`);
      continue;
    }
    entries.set(k, r);
    if (r.fileType === "Strain" && r.state !== "deleted") {
      const f = r.externalId.toLowerCase();
      if (!fold.has(f)) fold.set(f, new Set());
      fold.get(f)!.add(r.externalId);
    }
    if (r.fileType === "Product" && PRESENT.has(r.state) && r.filedName) {
      if (!byName.has(r.filedName)) byName.set(r.filedName, []);
      byName.get(r.filedName)!.push(r.externalId);
    }
  }
  const strainsByFold = new Map<string, readonly string[]>();
  for (const [f, s] of fold) strainsByFold.set(f, [...s].sort());
  return { view: { env, entries, strainsByFold, productsByName: byName, productIdByKey }, duplicates };
}

export function ledgerEntry(view: LedgerView, t: LedgerFileType, id: string): LedgerEntry | undefined {
  return view.entries.get(keyOf(t, id));
}

export type RouteIntent = "upsert" | "delete";
export type RoutedOperation = "Insert" | "Update" | "Delete" | "withhold";
export type RouteResult = { op: RoutedOperation; state: LedgerState | null; reason: string };

/**
 * Part 03 §D.3, verbatim table. Never Delete what we cannot prove exists; never
 * Update/Insert an id whose CCRS status we do not know.
 */
export function routeOperation(view: LedgerView, t: LedgerFileType, id: string, intent: RouteIntent): RouteResult {
  const e = ledgerEntry(view, t, id);
  const state = e?.state ?? null;
  if (intent === "delete") {
    return e && PRESENT.has(e.state)
      ? { op: "Delete", state, reason: "on file" }
      : { op: "withhold", state, reason: e ? `cannot Delete a record in state "${e.state}"` : "cannot Delete a record CCRS was never sent" };
  }
  if (!e) return { op: "Insert", state, reason: "not on file" };
  switch (e.state) {
    case "seed":
    case "filed":
    case "confirmed":
    case "closed":
      return { op: "Update", state, reason: "on file" };
    case "uncertain":
      return { op: "withhold", state, reason: "last file outcome is uncertain — reconcile first (Part 06)" };
    case "deleted":
      return { op: "withhold", state, reason: "id was Deleted in CCRS and is never re-used" };
    case "unknown":
      return { op: "withhold", state, reason: "id status is unknown (pending probe P-07)" };
  }
}

/**
 * An EVENT row (Sale, Adjustment, Transfer) is always an Insert, but the lot it
 * names must be one CCRS holds, else CCRS answers "Invalid
 * InventoryExternalIdentifier" for the whole file.
 */
export function routeReference(view: LedgerView, t: LedgerFileType, id: string): { ok: boolean; state: LedgerState | null } {
  const e = ledgerEntry(view, t, id);
  return { ok: !!e && PRESENT.has(e.state), state: e?.state ?? null };
}

export type StrainResolution =
  /** exact spelling on file → emit no Strain row; use it as is. */
  | { kind: "filed"; value: string }
  /** a different casing is on file → emit no Strain row; use the FILED casing. */
  | { kind: "case-variant"; value: string; ours: string }
  /** not on file in any casing → emit one Strain row. */
  | { kind: "new"; value: string };

export function resolveStrainCasing(view: LedgerView, strain: string): StrainResolution {
  const exact = ledgerEntry(view, "Strain", strain);
  if (exact && exact.state !== "deleted") return { kind: "filed", value: strain };
  const filed = view.strainsByFold.get(strain.toLowerCase());
  if (filed && filed.length > 0) return { kind: "case-variant", value: filed[0], ours: strain };
  return { kind: "new", value: strain };
}

export type ProductNameResolution =
  /** lot is filed and its filed product is on file → name it EXACTLY as filed. */
  | { kind: "filed"; name: string; productExternalId: string; differs: boolean }
  /** lot is not a filed lot → our own product (Insert/Update by our id). */
  | { kind: "ours"; name: string }
  /** filed lot whose product we cannot prove → the Inventory row is withheld. */
  | { kind: "withhold"; reason: string };

/**
 * The name the Inventory row must carry. Only a lot CCRS already holds has a
 * filed product; every other lot uses our composed name (and our Product row).
 * `rename` (operator intent, Brian A13 analogue / U-39) keeps OUR name and
 * requires the Product to be Updated in the same batch — the caller is told
 * via `productExternalId` which filed product to Update.
 */
export function resolveProductName(
  view: LedgerView,
  inventoryExternalId: string,
  ourName: string,
  opts: { rename?: boolean } = {},
): ProductNameResolution {
  const inv = ledgerEntry(view, "Inventory", inventoryExternalId);
  if (!inv) return { kind: "ours", name: ourName };
  const pid = (inv.productExternalId ?? "").trim() === "" ? null : inv.productExternalId!;
  if (!pid) return { kind: "withhold", reason: "filed lot has no filed Product Identifier" };
  const p = ledgerEntry(view, "Product", pid);
  if (!p) return { kind: "withhold", reason: `filed Product ${pid} is not in the Product ledger` };
  if (!PRESENT.has(p.state)) return { kind: "withhold", reason: `filed Product ${pid} is in state "${p.state}"` };
  if (p.filedName == null || p.filedName === "") {
    return { kind: "withhold", reason: `filed Product ${pid} has no filed Name` };
  }
  if (opts.rename && ourName !== "" && ourName !== p.filedName) {
    return { kind: "filed", name: ourName, productExternalId: pid, differs: true };
  }
  return { kind: "filed", name: p.filedName, productExternalId: pid, differs: ourName !== p.filedName };
}

/* ------------------------------------------------------------------ *
 * Minted Product ids (D-01a). The SEQUENCE is S-12's; this is the format.
 * ------------------------------------------------------------------ */
export const PREPROD_RUN_RE = /^P\d{8}[A-Z]$/;
export function formatMintedProductId(seq: number, preprodRun?: string): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new Error(`GWP sequence out of range: ${seq}`);
  if (preprodRun !== undefined && !PREPROD_RUN_RE.test(preprodRun)) throw new Error(`bad PREprod run id: ${preprodRun}`);
  const id = `GWP-${String(seq).padStart(6, "0")}`;
  return preprodRun ? `${preprodRun}-${id}` : id;
}

/* ------------------------------------------------------------------ *
 * Batch planner — every routing decision for one batch, in one pure place.
 * ------------------------------------------------------------------ */
export type PlanLot = {
  lotId: string;
  label: string;
  /** assigned ccrs_inventory_external_id (S-10); lots without one never reach here. */
  inventoryExternalId: string;
  productKey: string;
  /** our strain string for the lot (trimmed; "" = none). */
  strain: string;
};

export type PlanInput = {
  /** null = no ledger loaded yet → legacy routing (every row Insert, our ids). */
  view: LedgerView | null;
  lots: readonly PlanLot[];
  /** our product keys in menu order, with the CCRS id legacy mode would use. */
  products: readonly { key: string; legacyId: string; ourName: string }[];
  /** strain strings from the menu in order (trimmed, non-empty). */
  strains: readonly string[];
  /** filed Product ids the operator chose to RENAME to our name (Brian A13 analogue, U-39). */
  renameFiledProductIds?: ReadonlySet<string>;
};

export type PlannedProduct =
  | { action: "emit"; op: "Insert" | "Update"; ext: string }
  /** no row: every lot names a filed product, or our name is already filed. */
  | { action: "skip"; reason: string }
  | { action: "withhold"; reason: string };

export type PlannedLot =
  | { action: "emit"; op: "Insert" | "Update"; productName: string; strain: string }
  | { action: "withhold"; reason: string };

export type LedgerPlan = {
  /** strains to emit in the Strain file (one casing per case-fold, never a filed one). */
  strainEmit: ReadonlySet<string>;
  /** any strain string → the exact casing every file must write. */
  strainCanonical: ReadonlyMap<string, string>;
  strainCaseVariants: { ours: string; value: string; source: "ledger" | "batch" }[];
  products: ReadonlyMap<string, PlannedProduct>;
  /** Product Update rows for operator renames: filed id → new name + the key whose fields fill the row. */
  renames: ReadonlyMap<string, { name: string; productKey: string }>;
  lots: ReadonlyMap<string, PlannedLot>;
  /** filed lots whose Product cell uses the FILED name rather than ours. */
  nameFromLedger: { lotId: string; label: string; ours: string; filed: string }[];
};

export function planLedgerBatch(input: PlanInput): LedgerPlan {
  const { view } = input;

  // ── Strains: one casing per case-fold [BRIAN A16]; never re-send a filed one.
  const strainEmit = new Set<string>();
  const strainCanonical = new Map<string, string>();
  const strainCaseVariants: LedgerPlan["strainCaseVariants"] = [];
  const firstByFold = new Map<string, string>();
  const canon = (s: string): string => {
    const hit = strainCanonical.get(s);
    if (hit !== undefined) return hit;
    let value = s;
    if (view) {
      const r = resolveStrainCasing(view, s);
      if (r.kind === "case-variant") strainCaseVariants.push({ ours: s, value: r.value, source: "ledger" });
      value = r.value;
      if (r.kind !== "new") {
        strainCanonical.set(s, value);
        return value;
      }
    }
    const f = s.toLowerCase();
    const first = firstByFold.get(f);
    if (first === undefined) {
      firstByFold.set(f, s);
      strainEmit.add(s);
    } else if (first !== s) {
      strainCaseVariants.push({ ours: s, value: first, source: "batch" });
      value = first;
    }
    strainCanonical.set(s, value);
    return value;
  };
  for (const s of input.strains) if (s) canon(s);

  // ── Lots: route + product name.
  const lots = new Map<string, PlannedLot>();
  const nameFromLedger: LedgerPlan["nameFromLedger"] = [];
  const ourNameByKey = new Map(input.products.map((p) => [p.key, p.ourName]));
  const renameIds = input.renameFiledProductIds ?? new Set<string>();
  const renameNames = new Map<string, Set<string>>();
  const renameKey = new Map<string, string>();
  const filedLotsByKey = new Map<string, number>();
  const oursLotsByKey = new Map<string, number>();
  const pending: { lot: PlanLot; op: "Insert" | "Update"; res: Exclude<ProductNameResolution, { kind: "withhold" }> }[] = [];
  for (const l of input.lots) {
    const ourName = ourNameByKey.get(l.productKey) ?? "";
    if (!view) {
      lots.set(l.lotId, { action: "emit", op: "Insert", productName: ourName, strain: l.strain ? canon(l.strain) : "" });
      continue;
    }
    const r = routeOperation(view, "Inventory", l.inventoryExternalId, "upsert");
    if (r.op === "withhold" || r.op === "Delete") {
      lots.set(l.lotId, { action: "withhold", reason: r.reason });
      continue;
    }
    const res = resolveProductName(view, l.inventoryExternalId, ourName, {
      rename: renameIds.has(ledgerEntry(view, "Inventory", l.inventoryExternalId)?.productExternalId ?? ""),
    });
    if (res.kind === "withhold") {
      lots.set(l.lotId, { action: "withhold", reason: res.reason });
      continue;
    }
    if (res.kind === "filed") {
      filedLotsByKey.set(l.productKey, (filedLotsByKey.get(l.productKey) ?? 0) + 1);
      if (renameIds.has(res.productExternalId)) {
        if (!renameNames.has(res.productExternalId)) renameNames.set(res.productExternalId, new Set());
        renameNames.get(res.productExternalId)!.add(res.name);
        if (!renameKey.has(res.productExternalId)) renameKey.set(res.productExternalId, l.productKey);
      }
    } else {
      oursLotsByKey.set(l.productKey, (oursLotsByKey.get(l.productKey) ?? 0) + 1);
    }
    pending.push({ lot: l, op: r.op, res });
  }

  // ── Renames: one filed product, one new name — else nobody moves.
  const renames = new Map<string, { name: string; productKey: string }>();
  const renameConflict = new Set<string>();
  for (const [pid, names] of renameNames) {
    if (names.size === 1) renames.set(pid, { name: [...names][0], productKey: renameKey.get(pid)! });
    else renameConflict.add(pid);
  }

  // ── Products.
  const products = new Map<string, PlannedProduct>();
  for (const p of input.products) {
    if (!view) {
      products.set(p.key, { action: "emit", op: "Insert", ext: p.legacyId });
      continue;
    }
    const ours = oursLotsByKey.get(p.key) ?? 0;
    const filed = filedLotsByKey.get(p.key) ?? 0;
    if (ours === 0 && filed > 0) {
      products.set(p.key, { action: "skip", reason: "every lot names a filed product" });
      continue;
    }
    const assigned = view.productIdByKey.get(p.key);
    if (assigned) {
      const r = routeOperation(view, "Product", assigned, "upsert");
      if (r.op === "Insert" || r.op === "Update") {
        // Never Insert a second product under a Name CCRS already holds: the
        // Inventory→Product join is by name [G L0580-L0583].
        const holders = (view.productsByName.get(p.ourName) ?? []).filter((id) => id !== assigned);
        if (r.op === "Insert" && holders.length > 0) {
          // Which record a shared name resolves to is not defined by the guide
          // (gap N-12), so we refuse to create the ambiguity: withhold.
          products.set(p.key, {
            action: "withhold",
            reason: `this exact name is already filed under CCRS product ${holders.join(", ")} — Inventory joins Product by name, so rename ours or reuse the filed product`,
          });
        } else {
          products.set(p.key, { action: "emit", op: r.op, ext: assigned });
        }
      } else {
        products.set(p.key, { action: "withhold", reason: r.reason });
      }
      continue;
    }
    products.set(p.key, { action: "withhold", reason: "no CCRS Product id (GWP-) is assigned to this product" });
  }

  // ── Finalise lots now that product outcomes are known.
  for (const { lot, op, res } of pending) {
    const strain = lot.strain ? canon(lot.strain) : "";
    if (res.kind === "filed") {
      if (renameConflict.has(res.productExternalId)) {
        lots.set(lot.lotId, { action: "withhold", reason: `conflicting renames of filed Product ${res.productExternalId}` });
        continue;
      }
      if (res.differs && !renames.has(res.productExternalId)) {
        nameFromLedger.push({ lotId: lot.lotId, label: lot.label, ours: ourNameByKey.get(lot.productKey) ?? "", filed: res.name });
      }
      lots.set(lot.lotId, { action: "emit", op, productName: res.name, strain });
      continue;
    }
    const pp = products.get(lot.productKey);
    if (!pp || pp.action === "withhold") {
      lots.set(lot.lotId, { action: "withhold", reason: pp ? `its product is withheld: ${pp.reason}` : "its product is not in the published menu" });
      continue;
    }
    lots.set(lot.lotId, { action: "emit", op, productName: res.name, strain });
  }

  return { strainEmit, strainCanonical, strainCaseVariants, products, renames, lots, nameFromLedger };
}

/**
 * Apply the plan to the Product rows `buildProductFile` composed (one per key,
 * same order as `keys`). Legacy (no view) rows pass through untouched.
 */
export function applyProductPlan(
  rows: readonly (readonly string[])[],
  keys: readonly string[],
  plan: LedgerPlan,
): { rows: string[][]; skipped: { key: string; reason: string }[]; withheld: { key: string; label: string; reason: string }[] } {
  if (rows.length !== keys.length) throw new Error(`applyProductPlan: ${rows.length} rows vs ${keys.length} keys`);
  const C = CCRS_COLUMNS.Product;
  const iName = C.indexOf("Name");
  const iExt = C.indexOf("ExternalIdentifier");
  const iOp = C.indexOf("Operation");
  const out: string[][] = [];
  const skipped: { key: string; reason: string }[] = [];
  const withheld: { key: string; label: string; reason: string }[] = [];
  const rowByKey = new Map<string, readonly string[]>();
  rows.forEach((r, i) => {
    const key = keys[i];
    rowByKey.set(key, r);
    const pp = plan.products.get(key);
    if (!pp) throw new Error(`applyProductPlan: no plan for product key "${key}"`);
    if (pp.action === "skip") return void skipped.push({ key, reason: pp.reason });
    if (pp.action === "withhold") return void withheld.push({ key, label: r[iName] || key, reason: pp.reason });
    const row = [...r];
    row[iExt] = pp.ext;
    row[iOp] = pp.op;
    out.push(row);
  });
  for (const [pid, rn] of plan.renames) {
    const src = rowByKey.get(rn.productKey);
    if (!src) throw new Error(`applyProductPlan: rename of ${pid} has no source row for key "${rn.productKey}"`);
    const row = [...src];
    row[iName] = rn.name;
    row[iExt] = pid;
    row[iOp] = "Update";
    out.push(row);
  }
  return { rows: out, skipped, withheld };
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsLedgerCoreTests(): void {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`ccrs-ledger-core: ${m}`);
  };
  const { view } = buildLedgerView("prod", [
    { fileType: "Strain", externalId: "Dutch Treat", filedName: "Dutch Treat", state: "seed" },
    { fileType: "Product", externalId: "P1", filedName: "Filed Name", state: "seed" },
    { fileType: "Inventory", externalId: "I1", filedName: null, state: "seed", productExternalId: "P1" },
    { fileType: "Inventory", externalId: "I2", filedName: null, state: "uncertain" },
  ]);
  ok(routeOperation(view, "Inventory", "I1", "upsert").op === "Update", "seed → Update");
  ok(routeOperation(view, "Inventory", "NEW", "upsert").op === "Insert", "absent → Insert");
  ok(routeOperation(view, "Inventory", "I2", "upsert").op === "withhold", "uncertain → withhold");
  ok(routeOperation(view, "Inventory", "NEW", "delete").op === "withhold", "absent delete → withhold");
  const s = resolveStrainCasing(view, "Dutch treat");
  ok(s.kind === "case-variant" && s.value === "Dutch Treat", "ledger casing wins");
  const p = resolveProductName(view, "I1", "Our Name");
  ok(p.kind === "filed" && p.name === "Filed Name" && p.differs, "filed name wins");
}
