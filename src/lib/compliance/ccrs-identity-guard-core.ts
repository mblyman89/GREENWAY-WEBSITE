/**
 * src/lib/compliance/ccrs-identity-guard-core.ts — R74 S25 (round 12).
 *
 * Owner (round 12, verbatim excerpt): "do the Cultivera products we migrate
 * over to our system, and they move through our intake pipeline, will the keep
 * their original CCRS designation ... I want to make sure products we actually
 * intake get our new convention, while at the same time ensuring the cultivera
 * products have their original CCRS identifier". Clarified: "It's the GWP-ids.
 * And Cultivera's equivalent of ours."
 *
 * WHAT IS ALREADY TRUE (read from the code, not assumed):
 *   - A Cultivera lot's Inventory id IS the barcode Cultivera filed, byte for
 *     byte (import-lot-core S-10; migration 0246 restored the dotted ones).
 *     Nothing rewrites it later (re-homing and mail-apply move manifest_id only).
 *   - The planner (ccrs-ledger-core planLedgerBatch) names a lot CCRS already
 *     holds by its FILED product's exact Name and sends no GWP- Product row for a
 *     product whose every lot is filed. A lot CCRS does not hold is "ours": it
 *     needs a minted GWP- Product id (0248 ccrs_product_ids, permanent).
 *
 * THE TWO HOLES THIS SLICE CLOSES (fail closed):
 *   1. A Cultivera lot whose id is NOT in the production ledger was routed as
 *      "ours": an Insert of a new Inventory record plus a request to mint a GWP-
 *      Product id for its product. That is the exact thing the owner fears.
 *      The 0248 linker (ccrs_link_unfiled_migration_lots) prevents it only for
 *      lots that existed when the seed was finalized; a lot imported later (for
 *      example after a factory reset and re-import) was not covered. The examiner
 *      said to "continue to use the IDs already submitted and use the update
 *      path to update them vs creating new ones" [EXAM L0096], and an Insert
 *      "create[s] a new record with a unique external identifier" [G L0246].
 *      Such a lot is now HELD (production only), and a product whose only lots
 *      are held asks for no GWP- id.
 *   2. A production batch built without the ledger (legacy routing: every row
 *      Insert, our ids) was only warned about in the README. It is now a
 *      blocking error, so the hard gate refuses the export.
 *
 * PREprod is a separate environment ("These environments are autonomous and do
 * not share administration or reporting data." [FAQ L0096]); its ledger starts
 * empty, so Cultivera lots are new TEST records there. Nothing is held in PREprod.
 *
 * Pure: no I/O, no env reads. Self-tests at the bottom.
 */
import {
  ledgerEntry,
  type LedgerEnv,
  type LedgerPlan,
  type LedgerView,
  type PlannedLot,
  type PlannedProduct,
} from "./ccrs-ledger-core";
import { specPinFor, type CcrsIssueCode, type CcrsIssueRow } from "./ccrs-preflight-core";

/** Exactly the 0248 ccrs_product_ids check: `^(P[0-9]{8}[A-Z]-)?GWP-[0-9]{6}$`. */
export const GWP_ID_RE = /^(P[0-9]{8}[A-Z]-)?GWP-[0-9]{6}$/;

export function isGwpProductId(id: string | null | undefined): boolean {
  return typeof id === "string" && GWP_ID_RE.test(id);
}

/** The withhold reason the guard writes on a held Cultivera lot (classified in ccrs-issue-display-core). */
export const CULTIVERA_NOT_ON_RECORD_REASON =
  "Cultivera lot whose id is not on the CCRS record: sending it would create a new record instead of updating Cultivera's filing";

/** Product-plan reason for a product whose only lots are held Cultivera lots. */
export const CULTIVERA_ONLY_PRODUCT_REASON = "every lot of this product is a held Cultivera lot, so no GWP- id is asked for";

export type IdentityLot = {
  lotId: string;
  label: string;
  /** inventory_lots.lot_code (the Cultivera barcode for a migrated lot). */
  lotCode: string | null;
  /** The ASSIGNED ccrs_inventory_external_id (trimmed), null when none. */
  ccrsId: string | null;
  productKey: string;
  /** lotFlaggedCultivera(lot, migrationManifestIds). */
  isCultivera: boolean;
};

/* ------------------------------------------------------------------ *
 * 1. Which Cultivera lots are held (computed BEFORE planning).
 * ------------------------------------------------------------------ */

export function cultiveraLotsToHold(input: {
  env: LedgerEnv;
  view: LedgerView | null;
  lots: readonly IdentityLot[];
}): Map<string, string> {
  const held = new Map<string, string>();
  // PREprod is separate [FAQ L0096]; no ledger = the whole batch is refused (2).
  if (input.env !== "prod" || !input.view) return held;
  for (const l of input.lots) {
    if (!l.isCultivera || !l.ccrsId) continue;
    if (!ledgerEntry(input.view, "Inventory", l.ccrsId)) held.set(l.lotId, CULTIVERA_NOT_ON_RECORD_REASON);
  }
  return held;
}

/* ------------------------------------------------------------------ *
 * 2. Write the holds into the plan.
 * ------------------------------------------------------------------ */

/**
 * The plan was built WITHOUT the held lots (so they never count toward a
 * product). Each held lot gets a withhold entry, and a product with no lot
 * left in the plan whose only lots were held is skipped instead of being
 * Inserted under, or asking for, a GWP- id. An Update of a GWP- product CCRS
 * already holds is left alone (it is ours and on record).
 */
export function applyIdentityHolds(
  plan: LedgerPlan,
  held: ReadonlyMap<string, string>,
  lots: readonly IdentityLot[],
): LedgerPlan {
  if (held.size === 0) return plan;
  const lotsOut = new Map<string, PlannedLot>(plan.lots);
  for (const [id, reason] of held) lotsOut.set(id, { action: "withhold", reason });
  const keysWithOtherLots = new Set<string>();
  const keysWithHeldLots = new Set<string>();
  for (const l of lots) {
    if (!l.ccrsId) continue;
    if (held.has(l.lotId)) keysWithHeldLots.add(l.productKey);
    else keysWithOtherLots.add(l.productKey);
  }
  const productsOut = new Map<string, PlannedProduct>(plan.products);
  for (const key of keysWithHeldLots) {
    if (keysWithOtherLots.has(key)) continue;
    const pp = productsOut.get(key);
    if (!pp || pp.action === "skip") continue;
    if (pp.action === "emit" && pp.op === "Update") continue;
    productsOut.set(key, { action: "skip", reason: CULTIVERA_ONLY_PRODUCT_REASON });
  }
  return { ...plan, lots: lotsOut, products: productsOut };
}

/* ------------------------------------------------------------------ *
 * 3. The proof: what every lot and product is filed under.
 * ------------------------------------------------------------------ */

export type IdentityProof = {
  env: LedgerEnv;
  mode: "ledger" | "legacy";
  cultivera: {
    lots: number;
    /** sent under the id Cultivera filed, naming Cultivera's filed product. */
    onRecord: number;
    /** distinct Cultivera Product ids those lots name. */
    filedProducts: number;
    /** left out by the ledger routing for its own reason (E41). */
    withheldByRouting: number;
    /** held by this guard (production only). */
    held: number;
    /** sent as new records (PREprod, or legacy mode). */
    sentAsNew: number;
    noId: number;
    /** stored id differs from the barcode (lot_code) the lot was imported with. */
    idNotBarcode: number;
  };
  intake: {
    lots: number;
    /** new records under our id (their products use GWP- ids). */
    newRecords: number;
    /** already on record under a GWP- product (filed by us earlier). */
    onRecordOurs: number;
    /** on record under a NON-GWP product (an id Cultivera filed). */
    onRecordCultivera: number;
    withheld: number;
    noId: number;
  };
  products: {
    gwpInsert: number;
    gwpUpdate: number;
    /** no Product row: every lot names a Cultivera-filed product. */
    filedProductUsed: number;
    /** no Product row: every lot is a held Cultivera lot. */
    cultiveraOnlyHeld: number;
    /** withheld (no GWP- id yet, or another reason). */
    withheld: number;
    /** emitted with an id that is not a GWP- id (legacy mode only). */
    legacyIds: number;
  };
  rows: {
    held: CcrsIssueRow[];
    idNotBarcode: CcrsIssueRow[];
    intakeOnCultiveraRecord: CcrsIssueRow[];
  };
};

export function buildIdentityProof(input: {
  env: LedgerEnv;
  view: LedgerView | null;
  lots: readonly IdentityLot[];
  /** the plan AFTER applyIdentityHolds. */
  plan: LedgerPlan;
  held: ReadonlyMap<string, string>;
}): IdentityProof {
  const { env, view, plan, held } = input;
  const p: IdentityProof = {
    env,
    mode: view ? "ledger" : "legacy",
    cultivera: { lots: 0, onRecord: 0, filedProducts: 0, withheldByRouting: 0, held: 0, sentAsNew: 0, noId: 0, idNotBarcode: 0 },
    intake: { lots: 0, newRecords: 0, onRecordOurs: 0, onRecordCultivera: 0, withheld: 0, noId: 0 },
    products: { gwpInsert: 0, gwpUpdate: 0, filedProductUsed: 0, cultiveraOnlyHeld: 0, withheld: 0, legacyIds: 0 },
    rows: { held: [], idNotBarcode: [], intakeOnCultiveraRecord: [] },
  };
  const filedProducts = new Set<string>();
  for (const l of input.lots) {
    const entry = view && l.ccrsId ? ledgerEntry(view, "Inventory", l.ccrsId) : undefined;
    const planned = plan.lots.get(l.lotId);
    if (l.isCultivera) {
      p.cultivera.lots += 1;
      const code = (l.lotCode ?? "").trim();
      if (l.ccrsId && code && code !== l.ccrsId) {
        p.cultivera.idNotBarcode += 1;
        p.rows.idNotBarcode.push({ id: l.lotId, label: l.label, detail: `stored id "${l.ccrsId}" differs from barcode "${code}"` });
      }
      if (!l.ccrsId) p.cultivera.noId += 1;
      else if (held.has(l.lotId)) {
        p.cultivera.held += 1;
        p.rows.held.push({ id: l.lotId, label: l.label, detail: held.get(l.lotId)! });
      } else if (!planned || planned.action === "withhold") p.cultivera.withheldByRouting += 1;
      else if (entry) {
        p.cultivera.onRecord += 1;
        if (entry.productExternalId) filedProducts.add(entry.productExternalId);
      } else p.cultivera.sentAsNew += 1;
      continue;
    }
    p.intake.lots += 1;
    if (!l.ccrsId) p.intake.noId += 1;
    else if (!planned || planned.action === "withhold") p.intake.withheld += 1;
    else if (!entry) p.intake.newRecords += 1;
    else if (isGwpProductId(entry.productExternalId)) p.intake.onRecordOurs += 1;
    else {
      p.intake.onRecordCultivera += 1;
      p.rows.intakeOnCultiveraRecord.push({
        id: l.lotId,
        label: l.label,
        detail: `id "${l.ccrsId}" is already on the CCRS record under product ${entry.productExternalId ?? "(none)"}, so it is sent as an Update of that record`,
      });
    }
  }
  p.cultivera.filedProducts = filedProducts.size;
  for (const pp of plan.products.values()) {
    if (pp.action === "emit") {
      if (!isGwpProductId(pp.ext)) p.products.legacyIds += 1;
      else if (pp.op === "Insert") p.products.gwpInsert += 1;
      else p.products.gwpUpdate += 1;
    } else if (pp.action === "skip") {
      if (pp.reason === CULTIVERA_ONLY_PRODUCT_REASON) p.products.cultiveraOnlyHeld += 1;
      else p.products.filedProductUsed += 1;
    } else p.products.withheld += 1;
  }
  return p;
}

/* ------------------------------------------------------------------ *
 * 4. Issues (same shape as CcrsSyncIssue in ccrs-batch.ts).
 * ------------------------------------------------------------------ */

export type IdentityIssue = {
  severity: "error" | "warning";
  file: "Inventory" | "General";
  code: CcrsIssueCode;
  specPin: string;
  count: number;
  rows?: CcrsIssueRow[];
  message: string;
};

export type LedgerAbsentReason = "migration-not-applied" | "seed-not-finalized" | "not-configured" | null;

export function identityIssues(proof: IdentityProof, absentReason: LedgerAbsentReason = null): IdentityIssue[] {
  const out: IdentityIssue[] = [];
  if (proof.env === "prod" && proof.mode === "legacy") {
    out.push({
      severity: "error",
      file: "General",
      code: "E53_PROD_LEDGER_NOT_LOADED",
      specPin: specPinFor("E53_PROD_LEDGER_NOT_LOADED"),
      count: 1,
      message: `The production CCRS ledger is not loaded (${absentReason ?? "unknown reason"}). Without it every row would be an Insert under our ids, so the ${proof.cultivera.lots} Cultivera lot(s) would be sent as NEW records instead of updating the ids Cultivera filed ("continue to use the IDs already submitted and use the update path" [EXAM L0096]; Insert creates "a new record with a unique external identifier" [G L0246]). Apply migration 0248 and finalize the production seed, then rebuild. Production export is refused until then.`,
    });
  }
  if (proof.rows.held.length > 0) {
    out.push({
      severity: "error",
      file: "Inventory",
      code: "E52_CULTIVERA_LOT_NOT_ON_RECORD",
      specPin: specPinFor("E52_CULTIVERA_LOT_NOT_ON_RECORD"),
      count: proof.rows.held.length,
      rows: proof.rows.held,
      message: `${proof.rows.held.length} Cultivera lot(s) were left out of Inventory.csv because their id is not in our copy of what CCRS holds. Sending them would create new records (Insert [G L0246]) and ask for new GWP- product ids, instead of updating what Cultivera filed [EXAM L0096]. Merge the fresh CCRS data copy (re-seed, Part 17 §G), or correct the lot's id to the barcode Cultivera filed, then rebuild.`,
    });
  }
  if (proof.rows.idNotBarcode.length > 0) {
    out.push({
      severity: "warning",
      file: "Inventory",
      code: "E54_CULTIVERA_ID_NOT_BARCODE",
      specPin: specPinFor("E54_CULTIVERA_ID_NOT_BARCODE"),
      count: proof.rows.idNotBarcode.length,
      rows: proof.rows.idNotBarcode,
      message: `${proof.rows.idNotBarcode.length} Cultivera lot(s) have a stored CCRS id that differs from the barcode they were imported with. Cultivera filed the barcode, so check each one. Lots on the CCRS record are still sent under their filed id; lots not on it are held (E52).`,
    });
  }
  if (proof.rows.intakeOnCultiveraRecord.length > 0) {
    out.push({
      severity: "warning",
      file: "Inventory",
      code: "E55_INTAKE_LOT_ON_CULTIVERA_RECORD",
      specPin: specPinFor("E55_INTAKE_LOT_ON_CULTIVERA_RECORD"),
      count: proof.rows.intakeOnCultiveraRecord.length,
      rows: proof.rows.intakeOnCultiveraRecord,
      message: `${proof.rows.intakeOnCultiveraRecord.length} lot(s) received through our intake carry an id CCRS already holds under a product Cultivera filed (usually the same vendor lot received twice). CCRS keeps one record per id, so the row is an Update of that record, named by its filed product [G L0580-L0583], not a new GWP- product. Check the received quantity on each.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCcrsIdentityGuardCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ccrs-identity-guard-core: " + m);
    }
  };
  const mkView = (entries: { t: "Inventory" | "Product"; id: string; name?: string | null; prod?: string | null; state?: "seed" | "filed" }[]): LedgerView => {
    const m = new Map<string, import("./ccrs-ledger-core").LedgerEntry>();
    for (const e of entries) {
      m.set(`${e.t}\u0000${e.id}`, { fileType: e.t, externalId: e.id, filedName: e.name ?? null, state: e.state ?? "seed", productExternalId: e.prod ?? null });
    }
    return { env: "prod", entries: m, strainsByFold: new Map(), productsByName: new Map(), productIdByKey: new Map() };
  };
  const view = mkView([
    { t: "Inventory", id: "WA1.CV", prod: "CVP1" },
    { t: "Product", id: "CVP1", name: "Cultivera Name" },
    { t: "Inventory", id: "OURS-1", prod: "GWP-000001", state: "filed" },
    { t: "Inventory", id: "WA9.DUP", prod: "CVP9" },
  ]);
  const L = (lotId: string, ccrsId: string | null, key: string, isCultivera: boolean, lotCode: string | null = ccrsId): IdentityLot => ({
    lotId,
    label: lotId.toUpperCase(),
    lotCode,
    ccrsId,
    productKey: key,
    isCultivera,
  });
  const cvFiled = L("a", "WA1.CV", "k1", true);
  const cvUnfiled = L("b", "WA2.NEW", "k2", true);
  const cvUnfiledMixed = L("c", "WA3.NEW", "k3", true);
  const intakeNew = L("d", "VEND-LOT-7", "k3", false);
  const intakeOurs = L("e", "OURS-1", "k4", false);
  const intakeDup = L("f", "WA9.DUP", "k5", false);
  const cvNoId = L("g", null, "k6", true, "BC-G");
  const cvDrift = L("h", "WA1.CV", "k1", true, "WA1-CV");
  const lots = [cvFiled, cvUnfiled, cvUnfiledMixed, intakeNew, intakeOurs, intakeDup, cvNoId, cvDrift];

  // 1. holds
  const held = cultiveraLotsToHold({ env: "prod", view, lots });
  ok(held.size === 2 && held.has("b") && held.has("c"), "prod: only unfiled Cultivera lots are held");
  ok(held.get("b") === CULTIVERA_NOT_ON_RECORD_REASON, "hold reason is the constant");
  ok(!held.has("d"), "an unfiled INTAKE lot is never held (it is a new record by design)");
  ok(!held.has("g"), "a Cultivera lot with no id is not held here (E3 owns it)");
  ok(!held.has("a") && !held.has("h"), "a filed Cultivera lot is not held");
  ok(cultiveraLotsToHold({ env: "preprod", view, lots }).size === 0, "PREprod holds nothing (separate environment)");
  ok(cultiveraLotsToHold({ env: "prod", view: null, lots }).size === 0, "no ledger: nothing held here (E53 refuses the batch)");

  // 2. apply
  const basePlan: LedgerPlan = {
    strainEmit: new Set(),
    strainCanonical: new Map(),
    strainCaseVariants: [],
    renames: new Map(),
    nameFromLedger: [],
    lots: new Map<string, PlannedLot>([
      ["a", { action: "emit", op: "Update", productName: "Cultivera Name", strain: "" }],
      ["h", { action: "emit", op: "Update", productName: "Cultivera Name", strain: "" }],
      ["d", { action: "emit", op: "Insert", productName: "Ours 3", strain: "" }],
      ["e", { action: "emit", op: "Update", productName: "Ours 4", strain: "" }],
      ["f", { action: "emit", op: "Update", productName: "CV9", strain: "" }],
    ]),
    products: new Map<string, PlannedProduct>([
      ["k1", { action: "skip", reason: "every lot names a filed product" }],
      ["k2", { action: "withhold", reason: "no CCRS Product id (GWP-) is assigned to this product" }],
      ["k3", { action: "emit", op: "Insert", ext: "GWP-000003" }],
      ["k4", { action: "emit", op: "Update", ext: "GWP-000001" }],
      ["k5", { action: "skip", reason: "every lot names a filed product" }],
    ]),
  };
  const plan = applyIdentityHolds(basePlan, held, lots);
  const pb = plan.lots.get("b");
  ok(pb?.action === "withhold" && pb.reason === CULTIVERA_NOT_ON_RECORD_REASON, "held lot written as a withhold");
  ok(plan.lots.get("c")?.action === "withhold", "second held lot withheld");
  ok(plan.lots.get("a")?.action === "emit", "filed lot untouched");
  const p2 = plan.products.get("k2");
  ok(p2?.action === "skip" && p2.reason === CULTIVERA_ONLY_PRODUCT_REASON, "Cultivera-only product no longer asks for a GWP- id");
  const p3 = plan.products.get("k3");
  ok(p3?.action === "emit" && p3.ext === "GWP-000003", "a product that also has an intake lot keeps its GWP- row");
  ok(basePlan.lots.get("b") === undefined && basePlan.products.get("k2")?.action === "withhold", "input plan not mutated");
  ok(applyIdentityHolds(basePlan, new Map(), lots) === basePlan, "no holds: same plan object");
  const upd = applyIdentityHolds(
    { ...basePlan, products: new Map<string, PlannedProduct>([["k2", { action: "emit", op: "Update", ext: "GWP-000002" }]]) },
    held,
    lots,
  );
  ok(upd.products.get("k2")?.action === "emit", "an Update of an on-record GWP- product is left alone");
  const ins = applyIdentityHolds(
    { ...basePlan, products: new Map<string, PlannedProduct>([["k2", { action: "emit", op: "Insert", ext: "GWP-000002" }]]) },
    held,
    lots,
  );
  ok(ins.products.get("k2")?.action === "skip", "a GWP- Insert for a Cultivera-only product is not sent");

  // 3. proof
  const proof = buildIdentityProof({ env: "prod", view, lots, plan, held });
  ok(proof.mode === "ledger", "mode ledger");
  ok(proof.cultivera.lots === 5, "5 Cultivera lots");
  ok(proof.cultivera.onRecord === 2, "2 Cultivera lots on record (a, h)");
  ok(proof.cultivera.filedProducts === 1, "one distinct Cultivera product");
  ok(proof.cultivera.held === 2 && proof.rows.held.length === 2, "2 held, rows listed");
  ok(proof.cultivera.noId === 1, "one Cultivera lot with no id");
  ok(proof.cultivera.idNotBarcode === 1 && proof.rows.idNotBarcode[0].id === "h", "barcode drift found");
  ok(proof.cultivera.sentAsNew === 0, "nothing Cultivera sent as new in prod");
  ok(proof.intake.lots === 3 && proof.intake.newRecords === 1, "intake: 1 new record");
  ok(proof.intake.onRecordOurs === 1, "intake on record under a GWP- product");
  ok(proof.intake.onRecordCultivera === 1 && proof.rows.intakeOnCultiveraRecord[0].id === "f", "intake lot on a Cultivera record flagged");
  ok(proof.products.gwpInsert === 1 && proof.products.gwpUpdate === 1, "GWP products counted by op");
  ok(proof.products.filedProductUsed === 2 && proof.products.cultiveraOnlyHeld === 1, "skips split by reason");
  ok(proof.products.legacyIds === 0 && proof.products.withheld === 0, "no legacy ids, nothing withheld");

  // legacy + preprod
  const legacyPlan: LedgerPlan = {
    ...basePlan,
    lots: new Map<string, PlannedLot>(lots.filter((l) => l.ccrsId).map((l) => [l.lotId, { action: "emit", op: "Insert", productName: "x", strain: "" }])),
    products: new Map<string, PlannedProduct>([["k1", { action: "emit", op: "Insert", ext: "k1" }]]),
  };
  const lp = buildIdentityProof({ env: "prod", view: null, lots, plan: legacyPlan, held: new Map() });
  ok(lp.mode === "legacy" && lp.cultivera.sentAsNew === 4, "legacy: Cultivera lots would be sent as new");
  ok(lp.products.legacyIds === 1, "legacy product id counted");
  const li = identityIssues(lp, "seed-not-finalized");
  ok(li.length === 2 && li[0].code === "E53_PROD_LEDGER_NOT_LOADED" && li[0].severity === "error", "prod legacy -> blocking E53 first");
  ok(li[0].message.includes("seed-not-finalized") && li[0].message.includes("5 Cultivera lot(s)"), "E53 names the reason and the count");
  ok(li[0].specPin === "[G L0246-L0248]", "E53 pinned");
  const pre = buildIdentityProof({ env: "preprod", view: null, lots, plan: legacyPlan, held: new Map() });
  ok(!identityIssues(pre).some((i) => i.code === "E53_PROD_LEDGER_NOT_LOADED"), "PREprod without a ledger is not refused here");

  // 4. issues
  const iss = identityIssues(proof);
  const by = new Map(iss.map((i) => [i.code, i]));
  ok(by.get("E52_CULTIVERA_LOT_NOT_ON_RECORD")?.severity === "error" && by.get("E52_CULTIVERA_LOT_NOT_ON_RECORD")?.count === 2, "E52 blocking with count");
  ok(by.get("E54_CULTIVERA_ID_NOT_BARCODE")?.severity === "warning", "E54 advisory");
  ok(by.get("E55_INTAKE_LOT_ON_CULTIVERA_RECORD")?.severity === "warning", "E55 advisory");
  ok(!by.has("E53_PROD_LEDGER_NOT_LOADED"), "ledger loaded -> no E53");
  ok(identityIssues(buildIdentityProof({ env: "prod", view, lots: [cvFiled], plan, held: new Map() })).length === 0, "a clean batch raises nothing");

  // GWP pattern = the 0248 check
  ok(isGwpProductId("GWP-000123") && isGwpProductId("P20261020A-GWP-000087"), "GWP ids recognised");
  ok(!isGwpProductId("GWP-12345") && !isGwpProductId("CVP1") && !isGwpProductId(null) && !isGwpProductId(" GWP-000001"), "non-GWP ids refused");
  return { passed, failed };
}
