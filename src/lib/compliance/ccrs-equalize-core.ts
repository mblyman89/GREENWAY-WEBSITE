/**
 * ccrs-equalize-core.ts - CCRS Bible v2 Part 17 §E / Part 09, slice S-14:
 * EQUALIZE WAVES. PURE (no clock, no database, no network, no node: imports).
 *
 * The problem (Part 17 §E): CCRS holds tens of thousands of lots open that
 * Greenway no longer has (Cultivera history). The examiner's direction:
 *   "submit an inventory update for all those ids and get them to zero and
 *    then an inventory adjustment for those ids, with the reason as
 *    reconciliation"                                            [EXAM L0430]
 * using the ids already filed (Update, never Insert)             [EXAM L0096]
 * and keeping every other value accurate                         [EXAM L0473].
 *
 * A wave is ONE bounded set of such lots. This module decides, with no guess:
 *   1. which lots a wave zeroes (planEqualizeWave), each other lot held with a
 *      named reason (EQUALIZE_HOLD_CODES);
 *   2. the exact Inventory Update rows (the PREprod-accepted P20261007A shape)
 *      and, only when the examiner says it is allowed (Q-B1), the Reconciliation
 *      adjustment rows in the same batch;
 *   3. in the default SEPARATE mode, the adjustment phase from what the
 *      database PROVES landed (ADJUST_PHASE_SQL -> planAdjustPhase);
 *   4. the emit SQL (one transaction through ccrs_emit_files, which also writes
 *      the wave label), and the pre-check SQL.
 *
 * Open examiner questions are SWITCHES with safe defaults (Part 17 §E, the
 * questions emailed to Brian, Part 17 §H): Q-B1 sameBatchAdjust=false, Q-B2 lots already at 0
 * are counted and never sent, Q-B3 nominalTotalCost=null (zero-cost lots
 * held), Q-B6 strainOverride=null (reserved-strain lots held), Q-B7
 * maxLots=10,000, Q-B8 no Delete is ever written.
 */
import { CCRS_COLUMNS, assembleCcrsFile, ccrsReaderSplit, ccrsUnencodableReason, type CcrsRetailerFileType } from "./ccrs-batch-core";
import { parseDecimal, sumDecimals } from "./ccrs-control-totals-core";
import { buildLedgerView, ledgerEntry, resolveProductName, type LedgerState, type LedgerView } from "./ccrs-ledger-core";
import { emitPayload, verifyOutboxAgainstLedger, type EmitPayloadFile, type LedgerProblem, type OutboxFile, type OutboxSourceFile } from "./ccrs-outbox-core";
import { isReservedStrainName } from "./ccrs-preflight-core";
import { SALES_FLOOR_AREA } from "./ccrs-area-core";
import { samePayload, type LedgerRow } from "./ccrs-reseed-core";
import type { SeedEntity } from "./ccrs-ledger-seed-core";

/* ------------------------------------------------------------------ *
 * Constants, types, errors
 * ------------------------------------------------------------------ */

/** 0247 ccrs_files.purpose value for a stale-lot cleanup file. */
export const EQUALIZE_PURPOSE = "cleanup:stale" as const;

export const AUDIT_DETAIL = (wave: string) => `Inventory audit cleanup - equalize wave ${wave} - lot not on hand`;

/** Every reason a lot is held out of a wave, in a FIXED order (counts are stable for --expect). */
export const EQUALIZE_HOLD_CODES = [
  "H_DELIVERY_CONFLICT",
  "H_OURS_DESTROYED",
  "H_POSSIBLY_OURS",
  "H_NEGATIVE_QOH",
  "H_LEDGER_MISSING",
  "H_LEDGER_TOUCHED",
  "H_LEDGER_STATE",
  "H_LEDGER_NOT_MERGED",
  "H_LICENSE",
  "H_CREATED_DATE",
  "H_CREATED_ON_OR_AFTER_SNAPSHOT",
  "H_CREATED_BY",
  "H_INITIAL",
  "H_ISMEDICAL",
  "H_COST",
  "H_ZERO_COST",
  "H_STRAIN_RESERVED",
  "H_STRAIN_NOT_FILED",
  "H_PRODUCT",
  "H_UNENCODABLE",
  "H_ADJ_ID_TOO_LONG",
] as const;
export type EqualizeHoldCode = (typeof EQUALIZE_HOLD_CODES)[number];

/** Plain-English meaning of each hold (report + docs). */
export const EQUALIZE_HOLD_MEANING: Record<EqualizeHoldCode, string> = {
  H_DELIVERY_CONFLICT: "The LCB copy lists this lot id more than once with different values; we cannot tell which is filed.",
  H_OURS_DESTROYED: "Our own system has this exact lot id, marked destroyed. Its destruction belongs in our weekly files, not a cleanup wave.",
  H_POSSIBLY_OURS: "One of our lots has this id as its lot code or product key. It may be stock we still have; a person must check.",
  H_NEGATIVE_QOH: "CCRS shows a negative quantity on hand. Zeroing it is not a removal; ask the examiner.",
  H_LEDGER_MISSING: "Our ledger does not hold this lot. Run the re-seed (S-15) with this same copy first.",
  H_LEDGER_TOUCHED: "One of our own files already touched this lot after the copy was seeded. It is not a stale Cultivera lot.",
  H_LEDGER_STATE: "Our ledger says this lot is not simply 'as seeded' (closed, uncertain, deleted or unknown).",
  H_LEDGER_NOT_MERGED: "Our ledger's copy of this lot differs from this copy. Run the re-seed (S-15) with this copy first.",
  H_LICENSE: "The lot belongs to a different license number.",
  H_CREATED_DATE: "The filed CreatedDate cannot be read as a date.",
  H_CREATED_ON_OR_AFTER_SNAPSHOT: "The lot was created on or after the day of our count, so it may be real stock.",
  H_CREATED_BY: "The filed CreatedBy is empty or longer than CCRS allows (35).",
  H_INITIAL: "The filed Initial Quantity is not a plain number.",
  H_ISMEDICAL: "The filed IsMedical is not TRUE or FALSE.",
  H_COST: "The filed TotalCost is blank, negative or not a number.",
  H_ZERO_COST: "The filed TotalCost is 0, which CCRS refuses on any row [G L0614]. Held until the examiner says what to write (Q-B3).",
  H_STRAIN_RESERVED: "The filed strain is blank or Unknown/THC/Other, which CCRS refuses [G L0358]. Held until the examiner says what to write (Q-B6).",
  H_STRAIN_NOT_FILED: "The lot's strain is not a strain CCRS holds for us in any casing [G L0555].",
  H_PRODUCT: "The lot's product cannot be proven from the Product list, so the row would be refused as Invalid Product [G L0579].",
  H_UNENCODABLE: "A value contains a comma or a line break, which CCRS's reader cannot carry.",
  H_ADJ_ID_TOO_LONG: "The adjustment id EQ-<wave>-<lot> would be longer than 100 characters.",
};

export const ADJUST_HOLD_CODES = ["A_FILE_UNANSWERED", "A_ROW_NOT_LANDED", "A_NOT_CLOSED", "A_TOUCHED_LATER", "A_NO_QUANTITY"] as const;
export type AdjustHoldCode = (typeof ADJUST_HOLD_CODES)[number];

export class EqualizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EqualizeError";
  }
}

export type EqualizePolicy = {
  /** Q-B1: may the Reconciliation adjustments go in the SAME batch as the Updates? */
  sameBatchAdjust: boolean;
  /** Q-B3: a positive TotalCost to write for a filed 0 cost; null = hold those lots. */
  nominalTotalCost: string | null;
  /** Q-B6: a FILED, real strain to write for a reserved/blank strain; null = hold. */
  strainOverride: string | null;
  /** Q-B7: the most lots one wave zeroes. */
  maxLots: number;
};

export const DEFAULT_EQUALIZE_POLICY: EqualizePolicy = Object.freeze({
  sameBatchAdjust: false,
  nominalTotalCost: null,
  strainOverride: null,
  maxLots: 10_000,
}) as EqualizePolicy;

/** One of OUR lots (inventory_lots), read so a wave never zeroes stock we hold. */
export type OurLot = { externalId: string | null; lotCode: string | null; posProductKey: string | null; destroyed: boolean };

export type EqualizeInput = {
  /** buildLedgerSeed(<fresh LCB copy>).entities */
  copy: readonly SeedEntity[];
  /** every prod Inventory/Product/Strain/Area ledger row (LEDGER_READ_SQL) */
  ledger: readonly LedgerRow[];
  ours: readonly OurLot[];
  /** YYYY-MM-DD the copy is current through */
  copyAsOf: string;
  /** YYYY-MM-DD of our own full count/snapshot (must be the same day as the copy or later) */
  snapshotDate: string;
  /** YYYY-MM-DD written as UpdatedDate / SubmittedDate */
  waveDate: string;
  /** W1, W2, ... */
  wave: string;
  licenseNumber: string;
  submittedBy: string;
  policy: EqualizePolicy;
};

export type EqualizeHold = { id: string; code: EqualizeHoldCode; detail: string };

export type EqualizePlan = {
  wave: string;
  waveDate: string;
  copyAsOf: string;
  snapshotDate: string;
  licenseNumber: string;
  submittedBy: string;
  policy: EqualizePolicy;
  /** lots in THIS wave, exact byte order, with the quantity CCRS shows on hand */
  lots: { id: string; qty: string }[];
  inventoryRows: string[][];
  /** filled only when policy.sameBatchAdjust */
  adjustmentRows: string[][];
  holds: EqualizeHold[];
  /** eligible lots beyond maxLots, for the next wave */
  nextWave: string[];
  counts: {
    copyOpen: number;
    alreadyZero: number;
    ours: number;
    wave: number;
    nextWave: number;
    sumRemoved: string;
    nominalCost: number;
    strainOverride: number;
    held: Record<EqualizeHoldCode, number>;
  };
};

const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);
const WAVE_RE = /^W\d{1,12}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLAIN_DEC_RE = /^\d+(\.\d+)?$/;
const MAX_ID = 100; // [G L0219-L0224] ExternalIdentifier Text (100)
const MAX_BY = 35; // [G L0226-L0228] CreatedBy Text (35)

/* ------------------------------------------------------------------ *
 * Dates (strict; never guessed)
 * ------------------------------------------------------------------ */

const daysIn = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A CCRS date as delivered: M/D/YYYY or MM/DD/YYYY, nothing else. Returns YYYY-MM-DD or null. */
export function parseCcrsDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function isoOk(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(Number(m[1]), mo);
}

function needIso(s: unknown, what: string): string {
  if (!isoOk(s)) throw new EqualizeError(`${what} must be a real date written YYYY-MM-DD (got ${JSON.stringify(s)})`);
  return s;
}

/** YYYY-MM-DD -> MM/DD/YYYY (the zero-padded form CCRS accepted in PREprod). */
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function needWave(w: unknown): string {
  if (typeof w !== "string" || !WAVE_RE.test(w)) throw new EqualizeError(`wave label must look like W1, W2, ... (got ${JSON.stringify(w)})`);
  return w;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ *
 * Reconciliation adjustment row
 * ------------------------------------------------------------------ */

/**
 * One InventoryAdjustment Insert, reason Reconciliation [EXAM L0430]
 * [G L1097-L1103]. A detail is not required for Reconciliation [G L1109];
 * ours is a fixed, comma-free audit note. Quantity is the amount removed and
 * is never negative [G L1119] (and never 0: nothing was removed).
 */
export function adjustmentRowFor(o: {
  licenseNumber: string; lotId: string; qty: string; wave: string; adjustmentDate: string; createdDate: string; by: string;
}): string[] {
  const wave = needWave(o.wave);
  needIso(o.adjustmentDate, "adjustment date");
  needIso(o.createdDate, "created date");
  if (!PLAIN_DEC_RE.test(o.qty)) throw new EqualizeError(`lot ${o.lotId}: adjustment quantity ${JSON.stringify(o.qty)} is not a positive plain number`);
  if (parseDecimal(o.qty, "quantity").n <= BigInt(0)) throw new EqualizeError(`lot ${o.lotId}: adjustment quantity must be more than 0`);
  const id = `EQ-${wave}-${o.lotId}`;
  if (id.length > MAX_ID) throw new EqualizeError(`adjustment id ${id.slice(0, 40)}... is longer than ${MAX_ID}`);
  return [o.licenseNumber, o.lotId, "Reconciliation", AUDIT_DETAIL(wave), o.qty, mdy(o.adjustmentDate), id, o.by, mdy(o.createdDate), o.by, mdy(o.createdDate), "Insert"];
}

/* ------------------------------------------------------------------ *
 * Inputs checked once
 * ------------------------------------------------------------------ */

function checkCommon(licenseNumber: unknown, submittedBy: unknown) {
  if (typeof licenseNumber !== "string" || !/^\d{6}$/.test(licenseNumber)) throw new EqualizeError(`license number must be the six digits (got ${JSON.stringify(licenseNumber)})`);
  if (typeof submittedBy !== "string" || submittedBy.trim() === "") throw new EqualizeError("submitted-by name is required");
  if (ccrsUnencodableReason(submittedBy) !== null) throw new EqualizeError("submitted-by name cannot contain a comma or a line break");
  if (submittedBy.length > MAX_BY) throw new EqualizeError(`submitted-by name is longer than ${MAX_BY} characters`);
}

function checkPolicy(p: EqualizePolicy) {
  if (!p || typeof p !== "object") throw new EqualizeError("policy is required");
  if (typeof p.sameBatchAdjust !== "boolean") throw new EqualizeError("policy.sameBatchAdjust must be true or false");
  if (!Number.isInteger(p.maxLots) || p.maxLots < 1 || p.maxLots > 1_000_000) throw new EqualizeError(`wave size must be a whole number from 1 to 1,000,000 (got ${String(p.maxLots)}) [EXAM L0467]`);
  if (p.nominalTotalCost !== null) {
    if (typeof p.nominalTotalCost !== "string" || !PLAIN_DEC_RE.test(p.nominalTotalCost) || parseDecimal(p.nominalTotalCost, "nominal cost").n <= BigInt(0)) {
      throw new EqualizeError(`nominal TotalCost must be a positive plain number like 0.01 (got ${JSON.stringify(p.nominalTotalCost)}) [G L0614]`);
    }
  }
  if (p.strainOverride !== null && typeof p.strainOverride !== "string") throw new EqualizeError("strain override must be text");
}

/** The present Strain entries by lower-case name, exact first. */
function strainLookup(ledger: readonly LedgerRow[]) {
  const fold = new Map<string, string[]>();
  const exact = new Set<string>();
  for (const r of ledger) {
    if (r.t !== "Strain" || !PRESENT.has(r.state)) continue;
    exact.add(r.id);
    const f = r.id.toLowerCase();
    if (!fold.has(f)) fold.set(f, []);
    fold.get(f)!.push(r.id);
  }
  for (const v of fold.values()) v.sort(byCodeUnit);
  return (s: string): string | null => (exact.has(s) ? s : fold.get(s.toLowerCase())?.[0] ?? null);
}

/* ------------------------------------------------------------------ *
 * The wave plan
 * ------------------------------------------------------------------ */

export function planEqualizeWave(input: EqualizeInput): EqualizePlan {
  const copyAsOf = needIso(input.copyAsOf, "copy date");
  const snapshotDate = needIso(input.snapshotDate, "snapshot date");
  const waveDate = needIso(input.waveDate, "wave date");
  const wave = needWave(input.wave);
  checkCommon(input.licenseNumber, input.submittedBy);
  const policy = input.policy;
  checkPolicy(policy);
  // D-14 item 2: the count and the copy must be a same-day-or-newer pair, or a
  // lot sold/received between them would be misjudged.
  if (snapshotDate < copyAsOf) throw new EqualizeError(`our snapshot (${snapshotDate}) is older than the copy (${copyAsOf}); take a new count on or after the copy's date`);
  if (waveDate < snapshotDate) throw new EqualizeError(`wave date ${waveDate} is before the snapshot ${snapshotDate}`);

  // Ledger: no duplicates, Sales Floor on file.
  const seen = new Set<string>();
  for (const r of input.ledger) {
    const k = `${r.t}\u0000${r.id}`;
    if (seen.has(k)) throw new EqualizeError(`ledger holds a duplicate row ${r.t}/${r.id}; fix the ledger first`);
    seen.add(k);
  }
  if (!input.ledger.some((r) => r.t === "Area" && r.name === SALES_FLOOR_AREA && PRESENT.has(r.state))) {
    throw new EqualizeError(`the ledger holds no filed Area named "${SALES_FLOOR_AREA}"; every Update names that Area [G L0570]`);
  }
  const { view } = buildLedgerView("prod", input.ledger.map((r) => ({ fileType: r.t, externalId: r.id, filedName: r.name, state: r.state, productExternalId: r.prod })));
  const ledgerById = new Map(input.ledger.filter((r) => r.t === "Inventory").map((r) => [r.id, r]));
  const strainOf = strainLookup(input.ledger);

  let overrideStrain: string | null = null;
  if (policy.strainOverride !== null) {
    if (isReservedStrainName(policy.strainOverride) || policy.strainOverride.trim() === "") throw new EqualizeError(`strain override "${policy.strainOverride}" is itself a reserved name [G L0358]`);
    overrideStrain = strainOf(policy.strainOverride);
    if (overrideStrain === null) throw new EqualizeError(`strain override "${policy.strainOverride}" is not a strain CCRS holds for us; file it first [G L0555]`);
  }

  // Our lots: by assigned id (exact), and by lot code / product key (possible).
  const oursById = new Map<string, OurLot>();
  const maybeOurs = new Set<string>();
  for (const o of input.ours) {
    if (o.externalId !== null) {
      if (oursById.has(o.externalId)) throw new EqualizeError(`our system has the CCRS lot id ${o.externalId} twice; fix it before a wave`);
      oursById.set(o.externalId, o);
    }
    if (o.lotCode !== null && o.lotCode.trim() !== "") maybeOurs.add(o.lotCode.trim());
    if (o.posProductKey !== null && o.posProductKey.trim() !== "") maybeOurs.add(o.posProductKey.trim());
  }

  const held = Object.fromEntries(EQUALIZE_HOLD_CODES.map((c) => [c, 0])) as Record<EqualizeHoldCode, number>;
  const holds: EqualizeHold[] = [];
  const hold = (id: string, code: EqualizeHoldCode, detail: string) => { holds.push({ id, code, detail }); held[code] += 1; };
  let copyOpen = 0;
  let alreadyZero = 0;
  let ours = 0;
  type Cand = { id: string; qty: string; row: string[]; nominal: boolean; override: boolean };
  const cands: Cand[] = [];

  const lots = input.copy.filter((e) => e.fileType === "Inventory");
  for (const e of lots) {
    const id = e.externalId;
    const p = e.seedPayload;
    const qohText = p["Quantity on Hand"] ?? "";
    let qoh: bigint;
    try { qoh = parseDecimal(qohText, "QoH").n; } catch { throw new EqualizeError(`copy lot ${id}: Quantity on Hand ${JSON.stringify(qohText)} is not a number`); }
    if (qoh === BigInt(0)) { alreadyZero += 1; continue; } // Q-B2: counted, never sent
    copyOpen += 1;
    const mine = oursById.get(id);
    if (mine && !mine.destroyed) { ours += 1; continue; }

    if (e.seedConflicts) { hold(id, "H_DELIVERY_CONFLICT", `${e.seedConflicts.length} rows in the copy`); continue; }
    if (mine && mine.destroyed) { hold(id, "H_OURS_DESTROYED", "our lot with this id is destroyed"); continue; }
    if (maybeOurs.has(id)) { hold(id, "H_POSSIBLY_OURS", "matches one of our lot codes or product keys"); continue; }
    if (qoh < BigInt(0)) { hold(id, "H_NEGATIVE_QOH", `QoH ${qohText}`); continue; }
    const L = ledgerById.get(id);
    if (!L) { hold(id, "H_LEDGER_MISSING", "not in the ledger"); continue; }
    if (L.lastFile !== null || !L.source.startsWith("seed:")) { hold(id, "H_LEDGER_TOUCHED", `source ${L.source}${L.lastFile ? `, last file ${L.lastFile}` : ""}`); continue; }
    if (L.state !== "seed") { hold(id, "H_LEDGER_STATE", `ledger state ${L.state}`); continue; }
    if (!samePayload(L.payload, p)) { hold(id, "H_LEDGER_NOT_MERGED", "ledger values differ from this copy"); continue; }
    if (p["License Number"] !== input.licenseNumber) { hold(id, "H_LICENSE", `license ${p["License Number"]}`); continue; }
    const created = parseCcrsDate(p.CreatedDate ?? "");
    if (created === null) { hold(id, "H_CREATED_DATE", `CreatedDate ${JSON.stringify(p.CreatedDate ?? "")}`); continue; }
    if (created >= snapshotDate) { hold(id, "H_CREATED_ON_OR_AFTER_SNAPSHOT", `created ${created}, snapshot ${snapshotDate}`); continue; }
    const createdBy = p.CreatedBy ?? "";
    if (createdBy.trim() === "" || createdBy.length > MAX_BY) { hold(id, "H_CREATED_BY", `CreatedBy ${JSON.stringify(createdBy.slice(0, 40))}`); continue; }
    const initial = p["Initial Quantity"] ?? "";
    if (!PLAIN_DEC_RE.test(initial)) { hold(id, "H_INITIAL", `Initial Quantity ${JSON.stringify(initial)}`); continue; }
    const medRaw = (p.IsMedical ?? "").toLowerCase();
    if (medRaw !== "true" && medRaw !== "false") { hold(id, "H_ISMEDICAL", `IsMedical ${JSON.stringify(p.IsMedical ?? "")}`); continue; }
    const med = medRaw === "true" ? "True" : "False"; // title case, as accepted in P20261007A
    let cost = p.TotalCost ?? "";
    let nominal = false;
    if (!PLAIN_DEC_RE.test(cost)) { hold(id, "H_COST", `TotalCost ${JSON.stringify(cost)}`); continue; }
    if (parseDecimal(cost, "cost").n === BigInt(0)) {
      if (policy.nominalTotalCost === null) { hold(id, "H_ZERO_COST", `TotalCost ${cost}`); continue; }
      cost = policy.nominalTotalCost;
      nominal = true;
    }
    let strain = p.Strain ?? "";
    let override = false;
    if (strain.trim() === "" || isReservedStrainName(strain)) {
      if (overrideStrain === null) { hold(id, "H_STRAIN_RESERVED", `Strain ${JSON.stringify(strain)}`); continue; }
      strain = overrideStrain;
      override = true;
    } else {
      const filed = strainOf(strain);
      if (filed === null) { hold(id, "H_STRAIN_NOT_FILED", `Strain ${JSON.stringify(strain)}`); continue; }
      strain = filed;
    }
    const prod = resolveProductName(view, id, p.Name ?? "");
    if (prod.kind !== "filed") { hold(id, "H_PRODUCT", prod.kind === "withhold" ? prod.reason : "lot has no filed product"); continue; }
    const row = [input.licenseNumber, strain, SALES_FLOOR_AREA, prod.name, initial, "0", cost, med, id, createdBy, mdy(created), input.submittedBy, mdy(waveDate), "Update"];
    const bad = row.find((c) => ccrsUnencodableReason(c) !== null);
    if (bad !== undefined) { hold(id, "H_UNENCODABLE", `${ccrsUnencodableReason(bad)} in ${JSON.stringify(bad.slice(0, 40))}`); continue; }
    if (`EQ-${wave}-${id}`.length > MAX_ID) { hold(id, "H_ADJ_ID_TOO_LONG", `${id.length} characters`); continue; }
    cands.push({ id, qty: qohText, row, nominal, override });
  }

  cands.sort((a, b) => byCodeUnit(a.id, b.id));
  const take = cands.slice(0, policy.maxLots);
  const rest = cands.slice(policy.maxLots);
  holds.sort((a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(a.code, b.code));
  const adjustmentRows = policy.sameBatchAdjust
    ? take.map((c) => adjustmentRowFor({ licenseNumber: input.licenseNumber, lotId: c.id, qty: c.qty, wave, adjustmentDate: waveDate, createdDate: waveDate, by: input.submittedBy }))
    : [];
  return {
    wave, waveDate, copyAsOf, snapshotDate, licenseNumber: input.licenseNumber, submittedBy: input.submittedBy, policy: { ...policy },
    lots: take.map((c) => ({ id: c.id, qty: c.qty })),
    inventoryRows: take.map((c) => c.row),
    adjustmentRows,
    holds,
    nextWave: rest.map((c) => c.id),
    counts: {
      copyOpen, alreadyZero, ours, wave: take.length, nextWave: rest.length,
      sumRemoved: sumDecimals(take.map((c) => c.qty), "QoH"),
      nominalCost: take.filter((c) => c.nominal).length,
      strainOverride: take.filter((c) => c.override).length,
      held,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Adjustment phase (separate mode): only what the database PROVES landed
 * ------------------------------------------------------------------ */

/** One row of ADJUST_PHASE_SQL: a lot of a wave Inventory file, as the database holds it now. */
export type AdjustLine = {
  id: string;
  file: string;
  fileState: string;
  rowState: string;
  entityState: string | null;
  lastOp: string | null;
  lastFileName: string | null;
  /** Quantity on Hand of the merged copy (seed_payload), the amount the Update removed. */
  qoh: string | null;
};

/** Every row of every Inventory file of the wave, with its lot's ledger state. One JSON per line. */
export function ADJUST_PHASE_SQL(wave: string): string {
  needWave(wave);
  return (
    "select json_build_object('id', r.external_id, 'file', f.file_name, 'fileState', f.state, 'rowState', r.state, " +
    "'entityState', e.state, 'lastOp', e.last_operation, 'lastFileName', lf.file_name, 'qoh', e.seed_payload->>'Quantity on Hand') " +
    "from public.ccrs_files f join public.ccrs_file_rows r on r.file_id = f.id " +
    "left join public.ccrs_filed_entities e on e.env = f.env and e.file_type = 'Inventory' and e.external_id = r.external_id " +
    "left join public.ccrs_files lf on lf.id = e.last_file_id " +
    `where f.env = 'prod' and f.wave = '${wave}' and f.purpose = 'cleanup:stale' and f.file_type = 'Inventory' ` +
    "order by r.external_id collate \"C\", f.stamp_at;"
  );
}

export function parseAdjustLine(line: string): AdjustLine {
  let o: unknown;
  try { o = JSON.parse(line); } catch { throw new EqualizeError(`adjust line is not JSON: ${line.slice(0, 80)}`); }
  const r = o as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === "string";
  const sn = (k: string) => r[k] === null || typeof r[k] === "string";
  if (!r || typeof r !== "object" || Array.isArray(r) || !str("id") || !str("file") || !str("fileState") || !str("rowState") || !sn("entityState") || !sn("lastOp") || !sn("lastFileName") || !sn("qoh")) {
    throw new EqualizeError(`adjust line has the wrong shape: ${line.slice(0, 120)}`);
  }
  return { id: r.id as string, file: r.file as string, fileState: r.fileState as string, rowState: r.rowState as string, entityState: r.entityState as string | null, lastOp: r.lastOp as string | null, lastFileName: r.lastFileName as string | null, qoh: r.qoh as string | null };
}

export type AdjustPlan = {
  wave: string;
  waveDate: string;
  adjustDate: string;
  licenseNumber: string;
  submittedBy: string;
  rows: string[][];
  lotIds: string[];
  holds: { id: string; code: AdjustHoldCode; detail: string }[];
  counts: { lines: number; adjust: number; sumAdjusted: string; held: Record<AdjustHoldCode, number> };
};

/**
 * The Reconciliation rows for the lots whose wave Update LANDED: the file was
 * answered, the row was not rejected, the lot is closed, and nothing touched
 * it after the wave file. AdjustmentDate = the wave day (the day the lots were
 * zeroed); CreatedDate = the day this file is made.
 */
export function planAdjustPhase(o: { wave: string; waveDate: string; adjustDate: string; licenseNumber: string; submittedBy: string; lines: readonly AdjustLine[] }): AdjustPlan {
  const wave = needWave(o.wave);
  const waveDate = needIso(o.waveDate, "wave date");
  const adjustDate = needIso(o.adjustDate, "adjust date");
  checkCommon(o.licenseNumber, o.submittedBy);
  if (adjustDate < waveDate) throw new EqualizeError(`adjust date ${adjustDate} is before the wave date ${waveDate}`);
  if (o.lines.length === 0) throw new EqualizeError(`the database holds no Inventory file of wave ${wave}; emit and upload the wave first`);
  const seen = new Set<string>();
  for (const l of o.lines) {
    if (seen.has(l.id)) throw new EqualizeError(`lot ${l.id} is in wave ${wave} twice; ask before adjusting it`);
    seen.add(l.id);
  }
  const held = Object.fromEntries(ADJUST_HOLD_CODES.map((c) => [c, 0])) as Record<AdjustHoldCode, number>;
  const holds: AdjustPlan["holds"] = [];
  const ok: AdjustLine[] = [];
  for (const l of o.lines) {
    const h = (code: AdjustHoldCode, detail: string) => { holds.push({ id: l.id, code, detail }); held[code] += 1; };
    if (!["succeeded", "errored", "closed"].includes(l.fileState)) { h("A_FILE_UNANSWERED", `${l.file} is ${l.fileState}`); continue; }
    if (l.rowState !== "submitted" && l.rowState !== "confirmed") { h("A_ROW_NOT_LANDED", `row is ${l.rowState}`); continue; }
    if (l.entityState !== "closed") { h("A_NOT_CLOSED", `lot is ${l.entityState ?? "not in the ledger"}`); continue; }
    if (l.lastFileName !== l.file || l.lastOp !== "Update") { h("A_TOUCHED_LATER", `last touched by ${l.lastFileName ?? "nothing"} (${l.lastOp ?? "-"})`); continue; }
    if (l.qoh === null || !PLAIN_DEC_RE.test(l.qoh) || parseDecimal(l.qoh, "qoh").n <= BigInt(0)) { h("A_NO_QUANTITY", `quantity ${JSON.stringify(l.qoh)}`); continue; }
    ok.push(l);
  }
  ok.sort((a, b) => byCodeUnit(a.id, b.id));
  holds.sort((a, b) => byCodeUnit(a.id, b.id));
  const rows = ok.map((l) => adjustmentRowFor({ licenseNumber: o.licenseNumber, lotId: l.id, qty: l.qoh!, wave, adjustmentDate: waveDate, createdDate: adjustDate, by: o.submittedBy }));
  return {
    wave, waveDate, adjustDate, licenseNumber: o.licenseNumber, submittedBy: o.submittedBy,
    rows, lotIds: ok.map((l) => l.id), holds,
    counts: { lines: o.lines.length, adjust: ok.length, sumAdjusted: sumDecimals(ok.map((l) => l.qoh!), "qoh"), held },
  };
}

/* ------------------------------------------------------------------ *
 * Files, self-check, emit
 * ------------------------------------------------------------------ */

/** Noon UTC of an ISO day is the same calendar day in Pacific time (ccrsDate). */
const noonOf = (iso: string) => new Date(`${iso}T12:00:00Z`);

type AdjustSourceInput = Pick<AdjustPlan, "rows" | "submittedBy" | "adjustDate"> & { extraRows?: string[][] };

/**
 * The CCRS files of a wave. "inventory" = the Updates; "both" = Updates and
 * Reconciliation in one emission (refused unless Q-B1 was answered yes);
 * "adjustments" = the adjustment phase file.
 */
export function equalizeSources(p: EqualizePlan | AdjustSourceInput, mode: "inventory" | "both" | "adjustments"): OutboxSourceFile[] {
  const file = (type: CcrsRetailerFileType, rows: string[][], by: string, day: string) => ({ type, csv: assembleCcrsFile({ type, submittedBy: by, submittedDate: noonOf(day), rows }) });
  if ("inventoryRows" in p) {
    if (mode === "adjustments") return [file("InventoryAdjustment", p.adjustmentRows, p.submittedBy, p.waveDate)];
    if (mode === "both" && !p.policy.sameBatchAdjust) throw new EqualizeError("same-batch adjustments are off (Q-B1 is unanswered); emit the Inventory file alone");
    const out = [file("Inventory", p.inventoryRows, p.submittedBy, p.waveDate)];
    if (mode === "both") out.push(file("InventoryAdjustment", p.adjustmentRows, p.submittedBy, p.waveDate));
    return out;
  }
  if (mode !== "adjustments") throw new EqualizeError("an adjustment-phase plan only makes the adjustments file");
  return [file("InventoryAdjustment", [...p.rows, ...(p.extraRows ?? [])], p.submittedBy, p.adjustDate)];
}

/**
 * The outbox ledger self-check, with ONE exception: an adjustment naming a lot
 * of this wave that the ledger holds as CLOSED is allowed (the wave zeroed it;
 * 0249 ccrs_mark_uploaded accepts a closed lot, and CCRS keeps a zeroed lot).
 * Every other problem stays.
 */
export function verifyEqualizeFiles(view: LedgerView, files: readonly OutboxFile[], waveLotIds: ReadonlySet<string>): LedgerProblem[] {
  const byName = new Map(files.map((f) => [f.fileName, f]));
  return verifyOutboxAgainstLedger(view, files).filter((x) => {
    if (x.code !== "L_REF_INVENTORY") return true;
    const f = byName.get(x.fileName)!;
    const C = CCRS_COLUMNS[f.type];
    const line = f.csv.slice(0, -2).split("\r\n")[3 + x.row];
    const lot = ccrsReaderSplit(line)[C.indexOf("InventoryExternalIdentifier")];
    return !(waveLotIds.has(lot) && ledgerEntry(view, "Inventory", lot)?.state === "closed");
  });
}

export type EqualizePayloadFile = Omit<EmitPayloadFile, "purpose"> & { purpose: typeof EQUALIZE_PURPOSE };

export function equalizeEmitPayload(files: readonly OutboxFile[]): EqualizePayloadFile[] {
  return emitPayload(files).map((f) => ({ ...f, purpose: EQUALIZE_PURPOSE }));
}

const TAG = "$ccrseq$";

/**
 * The statements (no begin/commit): refuse a wave label already used for these
 * file types, emit through ccrs_emit_files, refuse unless every file is new,
 * write the wave label, print the result.
 */
export function equalizeEmitStatements(wave: string, payload: readonly EqualizePayloadFile[]): string {
  needWave(wave);
  if (payload.length === 0) throw new EqualizeError("nothing to emit");
  const json = JSON.stringify(payload);
  if (json.includes(TAG)) throw new EqualizeError(`the files contain the text ${TAG}; refusing to quote them`);
  if (json.includes("\\u0000")) throw new EqualizeError("the files contain a NUL byte");
  const types = [...new Set(payload.map((f) => f.file_type))].sort();
  for (const t of types) if (!/^[A-Za-z]+$/.test(t)) throw new EqualizeError(`bad file type ${t}`);
  const typeList = types.map((t) => `'${t}'`).join(", ");
  return `do $eqchk$ begin
  if exists (select 1 from public.ccrs_files where env = 'prod' and wave = '${wave}' and file_type in (${typeList})) then
    raise exception 'CCRS_EQUALIZE_WAVE_USED: wave ${wave} already has files of these types; use the next wave label';
  end if;
end $eqchk$;
create temp table ccrs_equalize_emit on commit drop as
  select public.ccrs_emit_files('prod', ${TAG}${json}${TAG}::jsonb) as r;
do $eqchk$ begin
  if exists (select 1 from ccrs_equalize_emit, jsonb_array_elements(r->'files') x where x->>'status' <> 'emitted') then
    raise exception 'CCRS_EQUALIZE_NOT_NEW: a file of this wave is already stored; nothing was written';
  end if;
end $eqchk$;
update public.ccrs_files set wave = '${wave}'
 where id in (select (x->>'id')::uuid from ccrs_equalize_emit, jsonb_array_elements(r->'files') x);
select x->>'file_name' as emitted, x->>'id' as file_id from ccrs_equalize_emit, jsonb_array_elements(r->'files') x;
drop table ccrs_equalize_emit;
`;
}

/** ONE transaction. Run with psql -v ON_ERROR_STOP=1. */
export function equalizeEmitSql(wave: string, payload: readonly EqualizePayloadFile[]): string {
  return `begin;\n${equalizeEmitStatements(wave, payload)}commit;\n`;
}

/** Pre-check: is the label used, are its adjustments already emitted, what is the last stamp. One JSON line. */
export function waveCheckSql(wave: string): string {
  needWave(wave);
  return (
    "select json_build_object(" +
    `'inventoryFiles', (select count(*) from public.ccrs_files where env = 'prod' and wave = '${wave}' and file_type = 'Inventory'), ` +
    `'adjustmentFiles', (select count(*) from public.ccrs_files where env = 'prod' and wave = '${wave}' and file_type = 'InventoryAdjustment'), ` +
    "'adjustmentRows', (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id " +
    `where f.env = 'prod' and f.file_type = 'InventoryAdjustment' and r.external_id like 'EQ-${wave}-%'), ` +
    "'lastStamp', (select to_char(max(stamp_at) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') from public.ccrs_files where env = 'prod'));"
  );
}

/** Our own lots, so no wave ever zeroes stock we hold. One JSON per line. */
export const OURS_READ_SQL =
  "select json_build_object('externalId', nullif(trim(l.ccrs_inventory_external_id), ''), 'lotCode', l.lot_code, 'posProductKey', l.pos_product_key, " +
  "'destroyed', coalesce(l.status = 'destroyed', false)) from public.inventory_lots l order by l.id;";

export function parseOurLine(line: string): OurLot {
  let o: unknown;
  try { o = JSON.parse(line); } catch { throw new EqualizeError(`our-lot line is not JSON: ${line.slice(0, 80)}`); }
  const r = o as Record<string, unknown>;
  const sn = (k: string) => r[k] === null || typeof r[k] === "string";
  if (!r || typeof r !== "object" || Array.isArray(r) || !sn("externalId") || !sn("lotCode") || !sn("posProductKey") || typeof r.destroyed !== "boolean") {
    throw new EqualizeError(`our-lot line has the wrong shape: ${line.slice(0, 120)}`);
  }
  return { externalId: r.externalId as string | null, lotCode: r.lotCode as string | null, posProductKey: r.posProductKey as string | null, destroyed: r.destroyed as boolean };
}

/* ------------------------------------------------------------------ *
 * The owner's review document
 * ------------------------------------------------------------------ */

const md = (s: string) => s.replace(/[|\\`*_[\]<>]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, " ");

export function equalizeReport(plan: EqualizePlan, limit = 500): string {
  const c = plan.counts;
  const P = plan.policy;
  const lines: string[] = [
    `# CCRS equalize wave ${plan.wave}`,
    "",
    `Copy current through ${plan.copyAsOf}. Our count taken ${plan.snapshotDate}. Wave day ${plan.waveDate}. License ${plan.licenseNumber}.`,
    "",
    "What this wave does, in the examiner's words: \"submit an inventory update for all those ids and get them to zero and then an inventory adjustment for those ids, with the reason as reconciliation\" [EXAM L0430].",
    "",
    "## Switches (each one waits on an answer from the examiner)",
    "",
    "| Question | Setting now | Effect |",
    "|---|---|---|",
    `| Q-B1 Updates and adjustments in the same batch? | ${P.sameBatchAdjust ? "yes" : "no (default)"} | ${P.sameBatchAdjust ? "The Reconciliation file goes with the Inventory file." : "Inventory file first; the Reconciliation file is made after CCRS answers."} |`,
    `| Q-B3 What cost to write where CCRS shows 0? | ${P.nominalTotalCost ?? "hold (default)"} | ${c.held.H_ZERO_COST} held, ${c.nominalCost} written with the nominal cost. |`,
    `| Q-B6 What strain to write where CCRS shows THC/Other/Unknown/blank? | ${P.strainOverride ? md(P.strainOverride) : "hold (default)"} | ${c.held.H_STRAIN_RESERVED} held, ${c.strainOverride} written with the override. |`,
    `| Q-B7 How many lots per wave? | ${P.maxLots} | ${c.wave} in this wave, ${c.nextWave} wait for the next one. |`,
    "",
    "## Counts",
    "",
    "| What | Lots |",
    "|---|---|",
    `| Open in the copy (quantity not 0) | ${c.copyOpen} |`,
    `| Already 0 in the copy (counted, never sent) | ${c.alreadyZero} |`,
    `| Ours (our system holds this exact lot id; never zeroed) | ${c.ours} |`,
    `| In this wave (Update to 0) | ${c.wave} |`,
    `| Ready for the next wave | ${c.nextWave} |`,
    `| Held (see below) | ${holdsTotal(plan)} |`,
    `| Quantity removed by this wave | ${c.sumRemoved} |`,
    "",
    "## Held lots by reason",
    "",
    "| Code | Lots | Meaning |",
    "|---|---|---|",
    ...EQUALIZE_HOLD_CODES.map((k) => `| ${k} | ${c.held[k]} | ${md(EQUALIZE_HOLD_MEANING[k])} |`),
    "",
  ];
  if (plan.holds.length) {
    lines.push("### Every held lot", "", "| Lot | Code | Detail |", "|---|---|---|");
    for (const h of plan.holds.slice(0, limit)) lines.push(`| ${md(h.id)} | ${h.code} | ${md(h.detail)} |`);
    if (plan.holds.length > limit) lines.push(`| ... | ${plan.holds.length - limit} more | |`);
    lines.push("");
  }
  lines.push("## Lots in this wave", "", "| Lot | Quantity removed |", "|---|---|");
  for (const l of plan.lots.slice(0, limit)) lines.push(`| ${md(l.id)} | ${l.qty} |`);
  if (plan.lots.length > limit) lines.push(`| ... | ${plan.lots.length - limit} more |`);
  lines.push("");
  return lines.join("\n") + "\n";
}

const holdsTotal = (p: EqualizePlan) => EQUALIZE_HOLD_CODES.reduce((a, k) => a + p.counts.held[k], 0);

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCcrsEqualizeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else { failed += 1; console.error(`  FAIL ccrs-equalize-core: ${msg}`); }
  };
  const throws = (f: () => unknown, re?: RegExp) => { try { f(); return false; } catch (e) { return e instanceof EqualizeError && (!re || re.test(e.message)); } };
  const H = ["License Number", "Strain", "Inventory Type", "Name", "Product Identifier", "Product Name", "IsMedical", "InventoryIdentifier (ExternalIdentifier on inventory.csv)", "Initial Quantity", "Quantity on Hand", "TotalCost", "CreatedBy", "CreatedDate", "Updatedby", "UpdatedDate"];
  const payload = (id: string, over: Record<string, string> = {}) => {
    const v = ["413541", "Blue Dream", "Usable Cannabis", "Blue Dream 1g", "P-1", "d", "FALSE", id, "10", "4", "25.00", "Cultivera", "8/30/2024", "", ""];
    const r = Object.fromEntries(H.map((h, i) => [h, v[i]]));
    return { ...r, ...over };
  };
  const ent = (id: string, over: Record<string, string> = {}): SeedEntity => ({ env: "prod", fileType: "Inventory", externalId: id, filedName: null, productExternalId: "P-1", state: "seed", source: "seed:x", seedPayload: payload(id, over), seedConflicts: null });
  const row = (e: SeedEntity): LedgerRow => ({ t: e.fileType, id: e.externalId, name: e.filedName, prod: e.productExternalId, state: e.state, source: "seed:x", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1", payload: e.seedPayload });
  const fixed: LedgerRow[] = [
    { t: "Product", id: "P-1", name: "Blue Dream 1g", prod: null, state: "seed", source: "seed:x", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1", payload: {} },
    { t: "Strain", id: "Blue Dream", name: "Blue Dream", prod: null, state: "seed", source: "seed:x", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1", payload: {} },
    { t: "Area", id: "C1", name: "Sales Floor", prod: null, state: "seed", source: "seed:x", lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1", payload: {} },
  ];
  const inp = (copy: SeedEntity[], o: Partial<EqualizeInput> = {}): EqualizeInput => ({
    copy, ledger: [...fixed, ...copy.map(row)], ours: [], copyAsOf: "2026-11-08", snapshotDate: "2026-11-08", waveDate: "2026-11-15", wave: "W1", licenseNumber: "413541", submittedBy: "Greenway Marijuana", policy: { ...DEFAULT_EQUALIZE_POLICY }, ...o,
  });

  ok(parseCcrsDate("8/30/2024") === "2024-08-30" && parseCcrsDate("2/29/2025") === null && parseCcrsDate("2024-08-30") === null, "dates strict");
  const p = planEqualizeWave(inp([ent("A")]));
  ok(p.inventoryRows.length === 1 && p.inventoryRows[0].join(",") === "413541,Blue Dream,Sales Floor,Blue Dream 1g,10,0,25.00,False,A,Cultivera,08/30/2024,Greenway Marijuana,11/15/2026,Update", "update row bytes");
  ok(p.inventoryRows[0].length === CCRS_COLUMNS.Inventory.length, "update row width");
  ok(p.adjustmentRows.length === 0, "separate mode by default");
  ok(planEqualizeWave(inp([ent("Z", { "Quantity on Hand": "0" })])).counts.alreadyZero === 1, "zero counted, not sent");
  ok(planEqualizeWave(inp([ent("O")], { ours: [{ externalId: "O", lotCode: null, posProductKey: null, destroyed: false }] })).counts.ours === 1, "ours never zeroed");
  ok(planEqualizeWave(inp([ent("C", { TotalCost: "0" })])).holds[0]?.code === "H_ZERO_COST", "zero cost held");
  ok(planEqualizeWave(inp([ent("C", { TotalCost: "0" })], { policy: { ...DEFAULT_EQUALIZE_POLICY, nominalTotalCost: "0.01" } })).inventoryRows[0][6] === "0.01", "nominal cost switch");
  ok(planEqualizeWave(inp([ent("T", { Strain: "THC" })])).holds[0]?.code === "H_STRAIN_RESERVED", "reserved strain held");
  ok(planEqualizeWave(inp([ent("D", { CreatedDate: "11/08/2026" })])).holds[0]?.code === "H_CREATED_ON_OR_AFTER_SNAPSHOT", "created on snapshot held");
  ok(throws(() => planEqualizeWave(inp([ent("A")], { snapshotDate: "2026-11-07" })), /older than the copy/), "stale snapshot refused");
  ok(throws(() => planEqualizeWave(inp([ent("A")], { wave: "w1" }))), "bad wave label refused");
  const big = planEqualizeWave(inp([ent("b"), ent("a"), ent("B")], { policy: { ...DEFAULT_EQUALIZE_POLICY, maxLots: 2 } }));
  ok(big.lots.map((l) => l.id).join() === "B,a" && big.nextWave.join() === "b", "byte order and wave size");
  const r = adjustmentRowFor({ licenseNumber: "413541", lotId: "A", qty: "4", wave: "W1", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "G" });
  ok(r.join(",") === `413541,A,Reconciliation,${AUDIT_DETAIL("W1")},4,11/15/2026,EQ-W1-A,G,11/22/2026,G,11/22/2026,Insert`, "adjustment row bytes");
  ok(throws(() => adjustmentRowFor({ licenseNumber: "413541", lotId: "A", qty: "0", wave: "W1", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "G" })), "zero adjustment refused");
  const line: AdjustLine = { id: "A", file: "F", fileState: "succeeded", rowState: "submitted", entityState: "closed", lastOp: "Update", lastFileName: "F", qoh: "4" };
  const a = planAdjustPhase({ wave: "W1", waveDate: "2026-11-15", adjustDate: "2026-11-22", licenseNumber: "413541", submittedBy: "G", lines: [line, { ...line, id: "B", fileState: "uploaded" }] });
  ok(a.lotIds.join() === "A" && a.holds[0]?.code === "A_FILE_UNANSWERED", "adjust phase holds the unproven");
  ok(throws(() => equalizeSources(p, "both")), "same batch refused when off");
  ok(throws(() => ADJUST_PHASE_SQL("W1'--")) && ADJUST_PHASE_SQL("W3").includes("f.wave = 'W3'"), "adjust SQL label checked");
  ok(Object.keys(p.counts.held).join() === EQUALIZE_HOLD_CODES.join(), "hold counts in fixed order");
  return { passed, failed };
}

