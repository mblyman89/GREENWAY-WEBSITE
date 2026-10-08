/**
 * src/lib/pos/lot-potency-core.ts  (R15a — Cultivera facts reach the inventory table)
 *
 * Owner request (verbatim, R15): "in the inventory table for the cultivera
 * products uploaded ... the receive date and the thc/ cbd/ cbn/ cbc
 * cannabinoid columns are blank even though the data exists in the cultivera
 * spreadsheets. the menu shows the thc and cbd numbers on their cards."
 *
 * WHY THEY WERE BLANK (cited, not guessed)
 *   - The inventory THC column reads `l.lab?.total_thc_pct`
 *     (src/app/admin/inventory/page.tsx) — a lab_results row. The Cultivera
 *     importer (import-service.ts createImportLots) never creates one, so it
 *     was always NULL. We deliberately do NOT fake a lab_results row: the COA
 *     column shows ✅ whenever `l.lab` exists, so a POS-sourced lab row would
 *     falsely claim a COA is on file. The POS figures get their own columns
 *     (migration 0241) with honest provenance instead.
 *
 * WHAT THIS MODULE DOES
 *   Resolves ONE raw INVENTORIES row's potency with EXACTLY the rules the menu
 *   card uses (transform.ts resolveCannabinoid + the SLICE 56 package-total-
 *   first policy), but per ROW (so each lot carries its own batch numbers) and
 *   with no diagnostics side effects (transform.ts already emits those once).
 *     THC  = Total column; Thc column is the sane sibling when Total is
 *            missing or over the cap. mg-dosed types prefer a VERIFIED package
 *            total from the name cross-exam.
 *     CBD  = Cbd column; Cbda is the sibling. mg types prefer a VERIFIED
 *            package CBD total.
 *     THCa / CBDa = their own columns, capped, kept for the lot page.
 *     CBN / CBC / CBG / CBDV = the export has NO columns for these (verified on
 *            the real INVENTORIES.xlsx header row); they exist only in product
 *            names, so only arithmetic-VERIFIED name facts are kept (Rule 3.1).
 *   Units: "%" for percent types, "mg" for MG_FACT_TYPES — same vocabulary as
 *   intake-potency-core.intakePotencyUnit.
 *   Types that the card never shows potency for (shouldDisplayThcTotal false
 *   in transform.ts) resolve to all-null here too, so the table never shows a
 *   number the menu refuses to show.
 *
 * PURE — no I/O. Self-tests registered in scripts/compliance/run-pure-selftests.ts.
 */
import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";

export type LotPotencyUnit = "%" | "mg";

export type LotPotencyInput = {
  inventoryType: string;
  productName: string;
  totalRaw: number | null;
  thcRaw: number | null;
  thcaRaw: number | null;
  cbdRaw: number | null;
  cbdaRaw: number | null;
};

export type LotMinorCannabinoid = { type: "cbg" | "cbn" | "cbc" | "cbdv"; value: string; unit: "mg" };

export type LotPotency = {
  unit: LotPotencyUnit | null;
  thc: number | null;
  thca: number | null;
  cbd: number | null;
  cbda: number | null;
  minors: LotMinorCannabinoid[];
};

/** Same sets/caps as transform.ts (THC_TOTAL_ALLOWED_TYPES, CANNABINOID_MG_CAP). */
const DISPLAY_TYPES = new Set(["Concentrate for Inhalation", "Usable Marijuana", ...MG_FACT_TYPES]);
const PERCENT_CAP = 100;
const MG_CAP: Record<string, number> = {
  "Solid Edible": 2000,
  "Liquid Edible": 1000,
  Tincture: 5000,
  "Topical Ointment": 5000,
};
const DEFAULT_MG_CAP = 5000;
const MINOR_TYPES = new Set(["cbg", "cbn", "cbc", "cbdv"]);

function collapse(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function positive(n: number | null | undefined): number | null {
  return n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? n : null;
}

function cap(n: number, type: string, unit: LotPotencyUnit): { value: number; capped: boolean } {
  const ceiling = unit === "%" ? PERCENT_CAP : MG_CAP[type] ?? DEFAULT_MG_CAP;
  return n > ceiling ? { value: ceiling, capped: true } : { value: n, capped: false };
}

/** transform.ts resolveCannabinoid, minus diagnostics. */
function resolveWithSibling(primary: number | null, sibling: number | null, type: string, unit: LotPotencyUnit): number | null {
  const p = positive(primary);
  const s = positive(sibling);
  if (p !== null) {
    const c = cap(p, type, unit);
    if (c.capped && s !== null) {
      const sc = cap(s, type, unit);
      if (!sc.capped) return round2(sc.value);
    }
    return round2(c.value);
  }
  if (s !== null) return round2(cap(s, type, unit).value);
  return null;
}

export function resolveLotPotency(input: LotPotencyInput): LotPotency {
  const type = collapse(input.inventoryType);
  const empty: LotPotency = { unit: null, thc: null, thca: null, cbd: null, cbda: null, minors: [] };
  if (!DISPLAY_TYPES.has(type)) return empty;
  const unit: LotPotencyUnit = MG_FACT_TYPES.has(type) ? "mg" : "%";

  let thc = resolveWithSibling(input.totalRaw, input.thcRaw, type, unit);
  let cbd = resolveWithSibling(input.cbdRaw, input.cbdaRaw, type, unit);
  const thcaP = positive(input.thcaRaw);
  const cbdaP = positive(input.cbdaRaw);
  const thca = thcaP === null ? null : round2(cap(thcaP, type, unit).value);
  const cbda = cbdaP === null ? null : round2(cap(cbdaP, type, unit).value);
  const minors: LotMinorCannabinoid[] = [];

  if (unit === "mg" && collapse(input.productName)) {
    const exam = crossExamineRow({
      productText: collapse(input.productName),
      inventoryType: type,
      thcColumn: input.thcRaw,
      cbdColumn: input.cbdRaw,
    });
    if (exam.packageThcMg?.confidence === "verified") thc = round2(cap(exam.packageThcMg.value, type, unit).value);
    if (exam.packageCbdMg?.confidence === "verified") cbd = round2(cap(exam.packageCbdMg.value, type, unit).value);
    for (const m of exam.minorCannabinoids) {
      const t = m.cannabinoid.toLowerCase();
      if (m.confidence !== "verified" || m.mg === null || !MINOR_TYPES.has(t)) continue;
      if (minors.some((x) => x.type === t)) continue;
      minors.push({ type: t as LotMinorCannabinoid["type"], value: String(round2(m.mg)), unit: "mg" });
    }
  }
  return { unit, thc, thca, cbd, cbda, minors };
}

/** True when the resolution carries at least one number worth storing. */
export function hasLotPotency(p: LotPotency): boolean {
  return p.thc !== null || p.cbd !== null || p.thca !== null || p.cbda !== null || p.minors.length > 0;
}

// ---------------------------------------------------------------------------
// Display helpers for the inventory table (COA outranks POS; never invented)
// ---------------------------------------------------------------------------

export type PotencyLotFields = {
  inventory_type: string | null;
  lab?: { total_thc_pct: number | null; total_cbd_pct: number | null } | null;
  pos_thc?: number | null;
  pos_cbd?: number | null;
  minor_cannabinoids_json?: unknown;
  /** R29: verified package mg totals (0138) - the mg-dosed lot's real figures. */
  package_thc_mg?: number | null;
  package_cbd_mg?: number | null;
};

const finiteOrNull = (v: unknown): number | null =>
  v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
const isMgLot = (l: PotencyLotFields) => MG_FACT_TYPES.has(collapse(l.inventory_type));

/**
 * The THC number the table shows.
 *   percent lots (flower, concentrates): the COA's when on file, else the
 *     POS export's - unchanged.
 *   R29 mg lots (edibles, drinks, tinctures, topicals): the VERIFIED package
 *     total, else the Cultivera export's mg figure. The COA's number is a
 *     PERCENT of weight (0.12 on a 55 mg gummy pack) and is never shown in
 *     an mg column; lotLabPercentLabel shows it, labelled "%".
 */
export function lotThcValue(l: PotencyLotFields): number | null {
  if (isMgLot(l)) return finiteOrNull(l.package_thc_mg) ?? finiteOrNull(l.pos_thc);
  return finiteOrNull(l.lab?.total_thc_pct) ?? finiteOrNull(l.pos_thc);
}

export function lotCbdValue(l: PotencyLotFields): number | null {
  if (isMgLot(l)) return finiteOrNull(l.package_cbd_mg) ?? finiteOrNull(l.pos_cbd);
  return finiteOrNull(l.lab?.total_cbd_pct) ?? finiteOrNull(l.pos_cbd);
}

/**
 * R29: the figure the inventory FILTER compares ("THC at least 20%", "has
 * CBD"). The filter's chips are written in percent, so it keeps its
 * pre-R29 meaning for every lot: the COA's percent first, else the POS
 * export's figure. The table COLUMN and its sort use lotThcValue /
 * lotCbdValue (package mg for mg lots) - what you see is what sorts - but
 * a percent filter must never silently compare against milligrams, and a
 * tincture with 12.4% CBD on its certificate still "has CBD" before anyone
 * types its package mg.
 */
export function lotThcFilterValue(l: PotencyLotFields): number | null {
  return finiteOrNull(l.lab?.total_thc_pct) ?? finiteOrNull(l.pos_thc);
}

export function lotCbdFilterValue(l: PotencyLotFields): number | null {
  return finiteOrNull(l.lab?.total_cbd_pct) ?? finiteOrNull(l.pos_cbd);
}

/** Where the shown THC came from — "coa" | "pos" | "package" | null (for a tooltip). */
export function lotPotencySource(l: PotencyLotFields): "coa" | "pos" | "package" | null {
  if (isMgLot(l)) {
    if (finiteOrNull(l.package_thc_mg) !== null || finiteOrNull(l.package_cbd_mg) !== null) return "package";
    if (l.pos_thc != null || l.pos_cbd != null) return "pos";
    return null;
  }
  if (l.lab?.total_thc_pct != null || l.lab?.total_cbd_pct != null) return "coa";
  if (l.pos_thc != null || l.pos_cbd != null) return "pos";
  return null;
}

/** Minor cannabinoid mg value by type from minor_cannabinoids_json (0138 shape). */
export function lotMinorValue(l: PotencyLotFields, type: "cbn" | "cbc" | "cbg"): number | null {
  const arr = Array.isArray(l.minor_cannabinoids_json) ? (l.minor_cannabinoids_json as unknown[]) : [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { type?: unknown; value?: unknown };
    if (String(r.type ?? "").toLowerCase() !== type) continue;
    const n = Number(r.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests (kept small on purpose — owner asked for minimal testing)
// ---------------------------------------------------------------------------
export function __runLotPotencyCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`lot-potency-core self-test failed: ${m}`);
    passed += 1;
  };
  // Flower: Total wins; garbage Total (>100%) falls back to the sane Thc sibling.
  const flower = resolveLotPotency({ inventoryType: "Usable Marijuana", productName: "Blue Dream 3.5g", totalRaw: 24.5, thcRaw: 1.1, thcaRaw: 26.7, cbdRaw: 0.05, cbdaRaw: null });
  ok(flower.unit === "%" && flower.thc === 24.5 && flower.cbd === 0.05 && flower.thca === 26.7, "flower percent values");
  const bad = resolveLotPotency({ inventoryType: "Usable Marijuana", productName: "X", totalRaw: 2450, thcRaw: 22.1, thcaRaw: null, cbdRaw: null, cbdaRaw: null });
  ok(bad.thc === 22.1, "over-cap Total uses sane Thc sibling");
  // Edible: verified package total + verified CBN from the name.
  const gummy = resolveLotPotency({ inventoryType: "Topical Ointment", productName: "A.C. Topical Drops 4:1 - 1000mg THC 250mg CBN - 1.7 oz", totalRaw: null, thcRaw: 1000, thcaRaw: null, cbdRaw: 12, cbdaRaw: null });
  ok(gummy.unit === "mg" && gummy.thc === 1000 && gummy.minors.some((m) => m.type === "cbn" && m.value === "250"), "mg total + verified CBN");
  // Non-display type → nothing.
  ok(!hasLotPotency(resolveLotPotency({ inventoryType: "Paraphernalia", productName: "Lighter", totalRaw: 5, thcRaw: 5, thcaRaw: null, cbdRaw: null, cbdaRaw: null })), "non-cannabis type stores nothing");
  // COA outranks POS.
  ok(lotThcValue({ inventory_type: "Usable Marijuana", lab: { total_thc_pct: 20, total_cbd_pct: null }, pos_thc: 25 }) === 20, "COA outranks POS");
  // R29: an mg lot never shows the lab PERCENT in its mg column.
  const bytes = { inventory_type: "Solid Edible", lab: { total_thc_pct: 0.1206, total_cbd_pct: 0.2219 }, pos_thc: null, pos_cbd: null };
  ok(lotThcValue(bytes) === null && lotCbdValue(bytes) === null && lotPotencySource(bytes) === null, "R29: mg lot, lab percent only -> nothing in the mg column");
  ok(lotThcValue({ ...bytes, package_thc_mg: 55, package_cbd_mg: 100 }) === 55 && lotCbdValue({ ...bytes, package_thc_mg: 55, package_cbd_mg: 100 }) === 100, "R29: mg lot shows the verified package totals");
  ok(lotPotencySource({ ...bytes, package_thc_mg: 55 }) === "package", "R29: source says package total");
  ok(lotThcValue({ ...bytes, pos_thc: 100 }) === 100 && lotPotencySource({ ...bytes, pos_thc: 100 }) === "pos", "R29: Cultivera mg figure is the fallback");
  ok(lotThcValue({ inventory_type: "Usable Marijuana", lab: { total_thc_pct: 20, total_cbd_pct: null }, package_thc_mg: 99 }) === 20, "R29: percent lots ignore package mg");
  ok(lotCbdFilterValue({ ...bytes, package_cbd_mg: 100 }) === 0.2219 && lotThcFilterValue({ ...bytes, package_thc_mg: 55 }) === 0.1206, "R29: the % filter compares the lab percent, never the package mg");
  ok(lotThcFilterValue({ inventory_type: "Solid Edible", lab: null, pos_thc: 100 }) === 100 && lotCbdFilterValue({ inventory_type: "Solid Edible", lab: null }) === null, "R29: filter falls back to POS, never invents");
  ok(lotThcValue({ inventory_type: "Usable Marijuana", lab: null, pos_thc: 25 }) === 25 && lotMinorValue({ inventory_type: null, minor_cannabinoids_json: [{ type: "cbn", value: "100", unit: "mg" }] }, "cbn") === 100, "POS fallback + minor lookup");
  return { passed };
}
