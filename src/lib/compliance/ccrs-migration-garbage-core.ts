/**
 * src/lib/compliance/ccrs-migration-garbage-core.ts — R50 S10c (D-15)
 *
 * Owner, follow-up #5: "I want the system to know, when we migrate, it's going
 * to be intaking some garbage, and I want the system to recognize this and
 * help me remove them from the system when I comes time to do our first CCRS
 * upload."
 *
 * PURE. Sorts the lots the Cultivera migration created into:
 *   - DEAD: the record cannot be a real product we keep. Only two pieces of
 *     evidence count (never a guess, D-15 item 3):
 *       `no_product_master` — the card is in the Inventories export but has no
 *         row in the Products export (hidden by the import with that reason);
 *       `no_barcode` — the lot had no barcode, so it carries a synthetic id
 *         CCRS never held (import_lot_missing_barcode).
 *   - FIXABLE: a migration diagnostic that a person can correct (cost,
 *     potency, size, received date, COA). Listed for fixing, never removal.
 *
 * Each dead lot is then routed by the CCRS ledger (what CCRS really holds):
 *   zero_in_ccrs    on file, stock > 0, active → zero it with a Reconciliation
 *                   adjustment ("Balance inventory → Reconciliation" [G L1142])
 *                   through the R15b screen (no_product_master only);
 *   zeroed          on file, already 0 here — the adjustment is (or was) on a
 *                   CCRS file; confirm it in the CCRS files list;
 *   fix_status      on file, stock > 0 but not active — R15b skips it;
 *   local_only      not on file / no id — CCRS does not hold it, so there is
 *                   nothing to remove there (a reference would be rejected);
 *                   remove or fix it here before the first upload;
 *   already_removed the ledger shows the id Deleted;
 *   reconcile_first uncertain / unknown / closed — settle the ledger first;
 *   unknown         the ledger is not loaded — no action is offered.
 * No Inventory `Delete` is ever proposed (D-15 item 2, U-46).
 */
import { ledgerEntry, type LedgerView } from "./ccrs-ledger-core";

export const DEAD_REASONS = ["no_product_master", "no_barcode"] as const;
export type DeadReason = (typeof DEAD_REASONS)[number];

export const DEAD_REASON_LABEL: Record<DeadReason, string> = {
  no_product_master: "Not in Cultivera's product list (no product master)",
  no_barcode: "No barcode — never filed with CCRS",
};

export const GARBAGE_ROUTES = [
  "zero_in_ccrs",
  "fix_status",
  "local_only",
  "reconcile_first",
  "zeroed",
  "already_removed",
  "unknown",
] as const;
export type GarbageRoute = (typeof GARBAGE_ROUTES)[number];

export const ROUTE_LABEL: Record<GarbageRoute, string> = {
  zero_in_ccrs: "Zero it out in CCRS (Reconciliation)",
  fix_status: "On hold here — make it active or zero it first",
  local_only: "Not in CCRS — remove or fix it here only",
  reconcile_first: "CCRS status unclear — reconcile the file first",
  zeroed: "Already zero here — confirm the adjustment was uploaded",
  already_removed: "Already removed from CCRS",
  unknown: "Unknown — the CCRS ledger is not loaded",
};

/** Routes that still need the owner before the first upload. */
export const OPEN_ROUTES: ReadonlySet<GarbageRoute> = new Set(["zero_in_ccrs", "fix_status", "local_only", "reconcile_first", "unknown"]);

/** Fixable migration diagnostics (codes written by import-lot-core / transform). */
export const FIXABLE_CODES = [
  "import_lot_cost_unparseable",
  "import_lot_received_date_missing",
  "import_lot_coa_missing",
  "package_size_mg_garbage",
  "cannabinoid_missing",
  "draft_inject_unmapped_category",
] as const;
export type FixableCode = (typeof FIXABLE_CODES)[number];

export const FIXABLE_LABEL: Record<FixableCode, string> = {
  import_lot_cost_unparseable: "Cost could not be read",
  import_lot_received_date_missing: "No received date",
  import_lot_coa_missing: "COA flag is N",
  package_size_mg_garbage: "Package size is a milligram figure",
  cannabinoid_missing: "No THC/CBD potency",
  draft_inject_unmapped_category: "Category did not map",
};

export type GarbageItemInput = { sourceItemId: string; hidden: boolean; hiddenReason: string | null };
export type GarbageLotInput = {
  id: string;
  posProductKey: string | null;
  lotCode: string | null;
  ccrsExternalId: string | null;
  onHandQty: number | string | null;
  status: string | null;
  productName: string | null;
};
export type GarbageDiagnosticInput = { code: string };

export type GarbageRow = {
  lotId: string;
  productName: string;
  lotCode: string | null;
  ccrsId: string | null;
  qty: number;
  reasons: DeadReason[];
  route: GarbageRoute;
  ledgerState: string | null;
};

export type GarbageReport = {
  rows: GarbageRow[];
  byRoute: Record<GarbageRoute, number>;
  byReason: Record<DeadReason, number>;
  dead: number;
  open: number;
  units: number;
  unitsToZero: number;
  fixable: { code: FixableCode; label: string; count: number }[];
  fixableTotal: number;
  ledgerLoaded: boolean;
};

function qtyOf(v: number | string | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** The dead reasons for one lot, in DEAD_REASONS order. */
export function deadReasonsFor(lot: GarbageLotInput, noMasterKeys: ReadonlySet<string>): DeadReason[] {
  const out: DeadReason[] = [];
  const key = clean(lot.posProductKey);
  if (key && noMasterKeys.has(key)) out.push("no_product_master");
  if (!clean(lot.lotCode)) out.push("no_barcode");
  return out;
}

/** Route one dead lot by what the ledger proves CCRS holds. */
export function routeGarbageLot(
  lot: GarbageLotInput,
  view: LedgerView | null,
): { route: GarbageRoute; ledgerState: string | null } {
  if (!view) return { route: "unknown", ledgerState: null };
  const id = clean(lot.ccrsExternalId);
  // A lot with no barcode carries a synthetic id CCRS never held, even when
  // the ledger happens to be empty for it — local only.
  if (!id || !clean(lot.lotCode)) return { route: "local_only", ledgerState: null };
  const e = ledgerEntry(view, "Inventory", id);
  if (!e) return { route: "local_only", ledgerState: null };
  switch (e.state) {
    case "deleted":
      return { route: "already_removed", ledgerState: e.state };
    case "uncertain":
    case "unknown":
    case "closed":
      return { route: "reconcile_first", ledgerState: e.state };
    case "seed":
    case "filed":
    case "confirmed": {
      const qty = qtyOf(lot.onHandQty);
      if (qty <= 0) return { route: "zeroed", ledgerState: e.state };
      if ((lot.status ?? "active") !== "active") return { route: "fix_status", ledgerState: e.state };
      return { route: "zero_in_ccrs", ledgerState: e.state };
    }
  }
}

const ROUTE_RANK = new Map<GarbageRoute, number>(GARBAGE_ROUTES.map((r, i) => [r, i]));

export function buildGarbageReport(input: {
  items: readonly GarbageItemInput[];
  lots: readonly GarbageLotInput[];
  diagnostics: readonly GarbageDiagnosticInput[];
  view: LedgerView | null;
}): GarbageReport {
  const noMaster = new Set(
    input.items.filter((i) => i.hidden && i.hiddenReason === "no_product_master").map((i) => clean(i.sourceItemId)).filter(Boolean),
  );
  const byRoute = Object.fromEntries(GARBAGE_ROUTES.map((r) => [r, 0])) as Record<GarbageRoute, number>;
  const byReason = Object.fromEntries(DEAD_REASONS.map((r) => [r, 0])) as Record<DeadReason, number>;
  const rows: GarbageRow[] = [];
  const seen = new Set<string>();
  for (const lot of input.lots) {
    if (seen.has(lot.id)) continue;
    seen.add(lot.id);
    if (lot.status === "destroyed") continue;
    const reasons = deadReasonsFor(lot, noMaster);
    if (reasons.length === 0) continue;
    const { route, ledgerState } = routeGarbageLot(lot, input.view);
    byRoute[route] += 1;
    for (const r of reasons) byReason[r] += 1;
    rows.push({
      lotId: lot.id,
      productName: clean(lot.productName) || "(no name)",
      lotCode: clean(lot.lotCode) || null,
      ccrsId: clean(lot.ccrsExternalId) || null,
      qty: qtyOf(lot.onHandQty),
      reasons,
      route,
      ledgerState,
    });
  }
  rows.sort(
    (a, b) =>
      (ROUTE_RANK.get(a.route) ?? 99) - (ROUTE_RANK.get(b.route) ?? 99) ||
      a.productName.localeCompare(b.productName) ||
      a.lotId.localeCompare(b.lotId),
  );
  const counts = new Map<string, number>();
  for (const d of input.diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
  const fixable = FIXABLE_CODES.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => ({
    code: c,
    label: FIXABLE_LABEL[c],
    count: counts.get(c) ?? 0,
  }));
  return {
    rows,
    byRoute,
    byReason,
    dead: rows.length,
    open: rows.filter((r) => OPEN_ROUTES.has(r.route)).length,
    units: rows.reduce((n, r) => n + Math.max(0, r.qty), 0),
    unitsToZero: rows.filter((r) => r.route === "zero_in_ccrs").reduce((n, r) => n + r.qty, 0),
    fixable,
    fixableTotal: fixable.reduce((n, f) => n + f.count, 0),
    ledgerLoaded: input.view !== null,
  };
}

/** One plain sentence for the top of the panel. */
export function garbageHeadline(r: GarbageReport): string {
  if (r.dead === 0) return "No dead migrated records were found. Nothing needs to be removed from CCRS.";
  if (!r.ledgerLoaded) {
    return `${r.dead} dead migrated record(s) found. The CCRS ledger is not loaded, so the system cannot yet say which ones CCRS holds.`;
  }
  if (r.open === 0) return `${r.dead} dead migrated record(s) found, and every one is handled. Nothing is left before the first upload.`;
  return `${r.dead} dead migrated record(s) found; ${r.open} still need you before the first CCRS upload.`;
}

/** Where the owner acts for each route (null = nothing to press). */
export function routeActionHref(route: GarbageRoute, ctx: { importId: string; lotId: string; reasons: readonly DeadReason[] }): string | null {
  switch (route) {
    case "zero_in_ccrs":
      return ctx.reasons.includes("no_product_master")
        ? `/admin/menu-imports/${ctx.importId}/missing-products`
        : `/admin/inventory/${ctx.lotId}`;
    case "fix_status":
    case "local_only":
      return `/admin/inventory/${ctx.lotId}`;
    case "reconcile_first":
    case "zeroed":
      return "/admin/compliance/ccrs#ccrs-files";
    case "already_removed":
    case "unknown":
      return null;
  }
}

// ---------------------------------------------------------------- self-tests
export function __runCcrsMigrationGarbageCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: unknown, m: string) => {
    if (!c) throw new Error(`ccrs-migration-garbage-core: ${m}`);
    n += 1;
  };
  const entries = new Map<string, { fileType: "Inventory"; externalId: string; filedName: null; state: string }>();
  const put = (id: string, state: string) => entries.set(`Inventory\u0000${id}`, { fileType: "Inventory", externalId: id, filedName: null, state });
  put("B-FILED", "filed");
  put("B-SEED", "seed");
  put("B-CONF", "confirmed");
  put("B-DEL", "deleted");
  put("B-UNC", "uncertain");
  put("B-UNK", "unknown");
  put("B-CLO", "closed");
  const view = {
    env: "prod",
    entries,
    strainsByFold: new Map(),
    productsByName: new Map(),
    productIdByKey: new Map(),
  } as unknown as LedgerView;
  const lot = (o: Partial<GarbageLotInput>): GarbageLotInput => ({
    id: "L1",
    posProductKey: "K1",
    lotCode: "B-FILED",
    ccrsExternalId: "B-FILED",
    onHandQty: 5,
    status: "active",
    productName: "P",
    ...o,
  });
  const nm = new Set(["K1"]);

  // dead reasons
  ok(deadReasonsFor(lot({}), nm).join() === "no_product_master", "no master only");
  ok(deadReasonsFor(lot({ posProductKey: "K2" }), nm).length === 0, "good card is not dead");
  ok(deadReasonsFor(lot({ posProductKey: "K2", lotCode: "  " }), nm).join() === "no_barcode", "blank barcode is dead");
  ok(deadReasonsFor(lot({ lotCode: null }), nm).join() === "no_product_master,no_barcode", "both reasons, stable order");
  ok(deadReasonsFor(lot({ posProductKey: null }), nm).length === 0, "no key is not no-master");
  ok(deadReasonsFor(lot({ posProductKey: " K1 " }), nm).length === 1, "key trimmed");

  // routing
  ok(routeGarbageLot(lot({}), null).route === "unknown", "no ledger → unknown");
  ok(routeGarbageLot(lot({}), view).route === "zero_in_ccrs", "filed + stock + active → zero");
  ok(routeGarbageLot(lot({ ccrsExternalId: "B-SEED", lotCode: "B-SEED" }), view).route === "zero_in_ccrs", "seed is present");
  ok(routeGarbageLot(lot({ ccrsExternalId: "B-CONF", lotCode: "B-CONF" }), view).route === "zero_in_ccrs", "confirmed is present");
  ok(routeGarbageLot(lot({ onHandQty: 0 }), view).route === "zeroed", "on file, zero here → zeroed");
  ok(routeGarbageLot(lot({ onHandQty: -2 }), view).route === "zeroed", "negative counts as zeroed");
  ok(routeGarbageLot(lot({ onHandQty: "x" }), view).route === "zeroed", "unreadable qty is 0");
  ok(routeGarbageLot(lot({ status: "quarantine" }), view).route === "fix_status", "not active → fix status");
  ok(routeGarbageLot(lot({ status: null }), view).route === "zero_in_ccrs", "null status counts as active");
  ok(routeGarbageLot(lot({ ccrsExternalId: "NOT-ON-FILE", lotCode: "NOT-ON-FILE" }), view).route === "local_only", "not on file → local");
  ok(routeGarbageLot(lot({ ccrsExternalId: null }), view).route === "local_only", "no id → local");
  ok(routeGarbageLot(lot({ lotCode: null }), view).route === "local_only", "no barcode → local even if id is on file");
  ok(routeGarbageLot(lot({ ccrsExternalId: "B-DEL", lotCode: "B-DEL" }), view).route === "already_removed", "deleted → removed");
  for (const s of ["B-UNC", "B-UNK", "B-CLO"]) {
    const r = routeGarbageLot(lot({ ccrsExternalId: s, lotCode: s }), view);
    ok(r.route === "reconcile_first" && r.ledgerState !== null, `${s} → reconcile first`);
  }
  ok(routeGarbageLot(lot({ ccrsExternalId: " B-FILED " }), view).route === "zero_in_ccrs", "id trimmed before lookup");
  ok(routeGarbageLot(lot({}), view).ledgerState === "filed", "state reported");

  // report
  const items: GarbageItemInput[] = [
    { sourceItemId: "K1", hidden: true, hiddenReason: "no_product_master" },
    { sourceItemId: "K2", hidden: true, hiddenReason: "owner" },
    { sourceItemId: "K3", hidden: false, hiddenReason: "no_product_master" },
  ];
  const lots: GarbageLotInput[] = [
    lot({ id: "A", productName: "Zeta" }),
    lot({ id: "B", productName: "Alpha", onHandQty: 3 }),
    lot({ id: "A", productName: "dup" }),
    lot({ id: "C", posProductKey: "K2" }),
    lot({ id: "D", posProductKey: "K3" }),
    lot({ id: "E", posProductKey: "K2", lotCode: null, ccrsExternalId: "K2-NOBARCODE-1", onHandQty: 2 }),
    lot({ id: "F", status: "destroyed" }),
    lot({ id: "G", ccrsExternalId: "B-DEL", lotCode: "B-DEL", productName: "Gone" }),
    lot({ id: "H", onHandQty: 0, productName: "Empty" }),
  ];
  const diags = [
    { code: "import_lot_cost_unparseable" },
    { code: "import_lot_cost_unparseable" },
    { code: "cannabinoid_missing" },
    { code: "import_lot_zero_units" },
    { code: "made_up" },
  ];
  const rep = buildGarbageReport({ items, lots, diagnostics: diags, view });
  ok(rep.dead === 5, "A,B,E,G,H dead (dup, owner-hidden, visible, destroyed excluded)");
  ok(rep.rows.map((r) => r.lotId).join() === "B,A,E,H,G", "sorted by route then name");
  ok(rep.byRoute.zero_in_ccrs === 2 && rep.byRoute.local_only === 1 && rep.byRoute.zeroed === 1 && rep.byRoute.already_removed === 1, "route counts");
  ok(rep.byReason.no_product_master === 4 && rep.byReason.no_barcode === 1, "reason counts");
  ok(rep.open === 3, "open = zero + local");
  ok(rep.units === 15, "units 5+3+2+0+5");
  ok(rep.unitsToZero === 8, "units to zero 5+3");
  ok(rep.fixable.length === 2 && rep.fixable[0].code === "import_lot_cost_unparseable" && rep.fixable[0].count === 2, "fixable grouped in code order");
  ok(rep.fixableTotal === 3, "fixable total ignores unknown and non-fixable codes");
  ok(rep.ledgerLoaded, "ledger loaded flag");
  ok(rep.rows.find((r) => r.lotId === "E")?.ccrsId === "K2-NOBARCODE-1", "synthetic id shown");
  ok(rep.rows.find((r) => r.lotId === "E")?.lotCode === null, "blank lot code is null");
  const neg = buildGarbageReport({ items, lots: [lot({ id: "N", onHandQty: -4 }), lot({ id: "P", onHandQty: 2 })], diagnostics: [], view });
  ok(neg.units === 2 && neg.rows[0].qty === 2, "a negative count never shrinks the unit total");

  const noLedger = buildGarbageReport({ items, lots, diagnostics: [], view: null });
  ok(noLedger.byRoute.unknown === 5 && noLedger.open === 5 && !noLedger.ledgerLoaded, "no ledger → all unknown and open");
  ok(noLedger.unitsToZero === 0, "nothing proposed without a ledger");
  ok(garbageHeadline(noLedger).includes("not loaded"), "headline: ledger not loaded");
  ok(garbageHeadline(rep) === "5 dead migrated record(s) found; 3 still need you before the first CCRS upload.", "headline: open");
  const empty = buildGarbageReport({ items: [], lots: [], diagnostics: [], view });
  ok(empty.dead === 0 && garbageHeadline(empty).startsWith("No dead"), "headline: none");
  const done = buildGarbageReport({ items, lots: [lot({ id: "H", onHandQty: 0 })], diagnostics: [], view });
  ok(done.open === 0 && garbageHeadline(done).includes("every one is handled"), "headline: all handled");

  // action links
  ok(routeActionHref("zero_in_ccrs", { importId: "I", lotId: "L", reasons: ["no_product_master"] }) === "/admin/menu-imports/I/missing-products", "zero → R15b screen");
  ok(routeActionHref("zero_in_ccrs", { importId: "I", lotId: "L", reasons: ["no_barcode"] }) === "/admin/inventory/L", "zero without master reason → lot");
  ok(routeActionHref("local_only", { importId: "I", lotId: "L", reasons: [] }) === "/admin/inventory/L", "local → lot");
  ok(routeActionHref("fix_status", { importId: "I", lotId: "L", reasons: [] }) === "/admin/inventory/L", "fix status → lot");
  ok(routeActionHref("reconcile_first", { importId: "I", lotId: "L", reasons: [] }) === "/admin/compliance/ccrs#ccrs-files", "reconcile → files");
  ok(routeActionHref("zeroed", { importId: "I", lotId: "L", reasons: [] }) === "/admin/compliance/ccrs#ccrs-files", "zeroed → files");
  ok(routeActionHref("unknown", { importId: "I", lotId: "L", reasons: [] }) === null, "unknown → nothing");
  ok(routeActionHref("already_removed", { importId: "I", lotId: "L", reasons: [] }) === null, "removed → nothing");
  ok(OPEN_ROUTES.has("unknown") && !OPEN_ROUTES.has("zeroed") && !OPEN_ROUTES.has("already_removed"), "open set");
  ok(GARBAGE_ROUTES.every((r) => ROUTE_LABEL[r].length > 0) && !Object.values(ROUTE_LABEL).some((l) => /delete/i.test(l)), "labels exist and never say Delete");
  return { passed: n, failed: 0 };
}
