/**
 * src/lib/compliance/trade-samples-core.ts
 *
 * PURE trade-sample compliance logic (no server-only imports → tsx-testable).
 *
 * Controlling rule: WAC 314-55-096 (WSR 25-08-032, eff 4/26/25).
 *   • INCOMING (processor → retailer): ≤ 120 units / calendar quarter / processor. [096(1)(f)(ii)]
 *   • OUTGOING (retailer → one employee): ≤ 30 units / calendar quarter / employee
 *     (sample-jar leftovers count). [096(1)(j)(vi), 096(4)(d)(i)]
 *   • CUSTOMERS: retailers may NOT give free samples to customers. [096(2)] — hard block.
 *   • PER-UNIT size caps: ≤ 3.5 g useable; ≤ 1 g concentrate; ≤ 100 mg infused
 *     (≤ 10 mg active delta-9 THC / serving). [096(1)(e)]
 *
 * This module computes quarter keys, validates per-unit sizes, and evaluates
 * whether a proposed event would breach a quarterly cap. The server layer does
 * the DB tally + the actual block/audit.
 */

export const WAC_CITATION = "WAC 314-55-096 (WSR 25-08-032, eff. 4/26/25)";

export type SampleDirection = "incoming" | "outgoing";

/**
 * Sample CATEGORY — the two SEPARATE quarterly buckets a WA retailer's employee
 * has (verified against WAC 314-55-096 + Foster Garvey alert):
 *   • "trade" — ≤ 30 units/employee/quarter                   [096(1)(j)(vi)]
 *   • "iqc"   — internal quality control, ≤ 50 units/employee/quarter with a
 *              ≤ 25 concentrate sub-cap                        [096(3)(c)]
 * There is NO unlimited category and NO job-title exemption; the purchasing
 * manager's product-evaluation samples ARE the (larger, still-capped) IQC bucket.
 */
export type SampleCategory = "trade" | "iqc";

/** Product types. "flower" is an IQC-only type (1 g cap) distinct from the
 * trade-sample "useable" (3.5 g cap); the statute lists both for IQC. */
export type SampleProductType = "useable" | "concentrate" | "infused" | "flower";

export const PRODUCT_TYPE_LABELS: Record<SampleProductType, string> = {
  useable: "Useable cannabis",
  flower: "Cannabis flower",
  concentrate: "Concentrate",
  infused: "Infused product",
};

export const CATEGORY_LABELS: Record<SampleCategory, string> = {
  trade: "Trade sample",
  iqc: "Internal quality control (IQC)",
};

/** Statutory defaults (mirrored by the trade_sample_settings row defaults). */
export const SAMPLE_DEFAULTS = {
  incomingUnitsPerQuarter: 120,
  outgoingUnitsPerEmployee: 30,
  maxFlowerGrams: 3.5,
  maxConcentrateGrams: 1,
  maxInfusedMg: 100,
  maxThcMgPerServing: 10,
  // Internal quality control (IQC) — the second, larger bucket [096(3)].
  iqcUnitsPerEmployee: 50, // ≤ 50 units / employee / quarter
  iqcConcentrateSubcap: 25, // ≤ 25 concentrate units / employee / quarter
  iqcMaxFlowerGrams: 1, // 1 g cannabis flower / unit
  iqcMaxUseableGrams: 1, // 1 g useable / unit
  iqcMaxConcentrateGrams: 1, // 1 g concentrate / unit
  iqcMaxInfusedThcMg: 10, // 10 mg THC in edible/liquid / unit
} as const;

export type SampleSettings = {
  enforce: boolean;
  hardBlock: boolean;
  incomingUnitsPerQuarter: number;
  outgoingUnitsPerEmployee: number;
  maxFlowerGrams: number;
  maxConcentrateGrams: number;
  maxInfusedMg: number;
  maxThcMgPerServing: number;
  // IQC bucket.
  iqcUnitsPerEmployee: number;
  iqcConcentrateSubcap: number;
  iqcMaxFlowerGrams: number;
  iqcMaxUseableGrams: number;
  iqcMaxConcentrateGrams: number;
  iqcMaxInfusedThcMg: number;
};

// ---------------------------------------------------------------------------
// Calendar-quarter helpers (Pacific calendar; caller passes a Pacific YMD).
// ---------------------------------------------------------------------------

/** Quarter number 1..4 for a 1-based month. */
export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/** Quarter key "YYYY-Qn" from a Pacific YMD ("2025-05-14" → "2025-Q2"). */
export function quarterKeyFromYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}-Q${quarterOfMonth(m)}`;
}

/** Human label for a quarter key ("2025-Q2" → "Q2 2025 (Apr–Jun)"). */
export function quarterLabel(key: string): string {
  const [y, q] = key.split("-Q");
  const ranges: Record<string, string> = { "1": "Jan–Mar", "2": "Apr–Jun", "3": "Jul–Sep", "4": "Oct–Dec" };
  return `Q${q} ${y} (${ranges[q] ?? ""})`;
}

// ---------------------------------------------------------------------------
// Per-unit size validation
// ---------------------------------------------------------------------------

export type UnitSizeInput = {
  productType: SampleProductType;
  category?: SampleCategory; // defaults to "trade"
  unitSizeGrams?: number | null; // useable/concentrate/flower
  unitSizeMg?: number | null; // infused (trade)
  thcMgPerServing?: number | null; // infused
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/** Validate a single sample unit's size against the per-unit statutory caps.
 * TRADE and IQC have DIFFERENT caps:
 *   trade: 3.5 g useable · 1 g concentrate · 100 mg infused (≤10 mg THC/serving)
 *   iqc:   1 g flower · 1 g useable · 1 g concentrate · 10 mg THC infused        */
export function validateUnitSize(input: UnitSizeInput, settings: SampleSettings): ValidationResult {
  const errors: string[] = [];
  const { productType } = input;
  const category: SampleCategory = input.category ?? "trade";

  if (category === "iqc") {
    // IQC caps (all grams except infused which is THC mg per unit).
    if (productType === "flower") {
      const g = num(input.unitSizeGrams);
      if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
      else if (g > settings.iqcMaxFlowerGrams) errors.push(`Each IQC flower unit must be ≤ ${settings.iqcMaxFlowerGrams} g (${WAC_CITATION}, §096(3)).`);
    } else if (productType === "useable") {
      const g = num(input.unitSizeGrams);
      if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
      else if (g > settings.iqcMaxUseableGrams) errors.push(`Each IQC useable unit must be ≤ ${settings.iqcMaxUseableGrams} g (${WAC_CITATION}, §096(3)).`);
    } else if (productType === "concentrate") {
      const g = num(input.unitSizeGrams);
      if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
      else if (g > settings.iqcMaxConcentrateGrams) errors.push(`Each IQC concentrate unit must be ≤ ${settings.iqcMaxConcentrateGrams} g (${WAC_CITATION}, §096(3)).`);
    } else {
      // infused: IQC is capped by THC mg per unit (10 mg), not total weight.
      const thc = num(input.thcMgPerServing);
      if (thc === null || thc <= 0) errors.push("Enter the THC (mg) for this IQC infused unit.");
      else if (thc > settings.iqcMaxInfusedThcMg) errors.push(`Each IQC infused unit must be ≤ ${settings.iqcMaxInfusedThcMg} mg THC (${WAC_CITATION}, §096(3)).`);
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  }

  // TRADE caps.
  if (productType === "useable" || productType === "flower") {
    const g = num(input.unitSizeGrams);
    if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
    else if (g > settings.maxFlowerGrams) errors.push(`Each useable/flower unit must be ≤ ${settings.maxFlowerGrams} g (${WAC_CITATION}).`);
  } else if (productType === "concentrate") {
    const g = num(input.unitSizeGrams);
    if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
    else if (g > settings.maxConcentrateGrams) errors.push(`Each concentrate unit must be ≤ ${settings.maxConcentrateGrams} g (${WAC_CITATION}).`);
  } else {
    // infused
    const mg = num(input.unitSizeMg);
    if (mg === null || mg <= 0) errors.push("Enter the per-unit weight in milligrams.");
    else if (mg > settings.maxInfusedMg) errors.push(`Each infused unit must be ≤ ${settings.maxInfusedMg} mg (${WAC_CITATION}).`);
    const thc = num(input.thcMgPerServing);
    if (thc !== null && thc > settings.maxThcMgPerServing) {
      errors.push(`Infused samples must be ≤ ${settings.maxThcMgPerServing} mg active THC per serving (${WAC_CITATION}).`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number.isFinite(v) ? Number(v) : null;
}

// ---------------------------------------------------------------------------
// Quarterly cap evaluation
// ---------------------------------------------------------------------------

export type CapEvaluation = {
  /** Units already recorded for this subject (processor or employee) this quarter. */
  usedUnits: number;
  /** The quarterly cap that applies. */
  capUnits: number;
  /** Units the caller wants to add. */
  addUnits: number;
  /** used + add. */
  projectedUnits: number;
  /** projected > cap. */
  overCap: boolean;
  /** used/cap ≥ 0.8 (amber). */
  nearCap: boolean;
  /** cap - used (0 floor). */
  remaining: number;
  /** true when this event must be blocked (over cap AND enforce AND hardBlock). */
  block: boolean;
  message: string;
};

/**
 * Evaluate a proposed sample event against the applicable quarterly cap.
 * `direction` selects which cap applies. `usedUnits` is the tally the server
 * computed for the same quarter + subject (processor for incoming, employee for
 * outgoing).
 */
export function evaluateCap(args: {
  direction: SampleDirection;
  usedUnits: number;
  addUnits: number;
  settings: SampleSettings;
}): CapEvaluation {
  const { direction, usedUnits, addUnits, settings } = args;
  const capUnits = direction === "incoming" ? settings.incomingUnitsPerQuarter : settings.outgoingUnitsPerEmployee;
  const projectedUnits = usedUnits + addUnits;
  const overCap = projectedUnits > capUnits;
  const remaining = Math.max(0, capUnits - usedUnits);
  const nearCap = capUnits > 0 && usedUnits / capUnits >= 0.8;
  const block = overCap && settings.enforce && settings.hardBlock;

  const subject = direction === "incoming" ? "this processor" : "this employee";
  let message: string;
  if (overCap) {
    message = `Blocked: ${projectedUnits} units would exceed the ${capUnits}-unit quarterly cap for ${subject} (${remaining} remaining). ${WAC_CITATION}.`;
  } else if (nearCap) {
    message = `Warning: ${subject} is near the ${capUnits}-unit quarterly cap (${remaining} remaining after this).`;
  } else {
    message = `${projectedUnits} of ${capUnits} units used this quarter for ${subject} (${capUnits - projectedUnits} remaining).`;
  }

  return { usedUnits, capUnits, addUnits, projectedUnits, overCap, nearCap, remaining, block, message };
}

/** Bucket a used/cap ratio into a UI tone. */
export function capTone(used: number, cap: number): "green" | "amber" | "red" {
  if (cap <= 0) return "green";
  const r = used / cap;
  if (r >= 1) return "red";
  if (r >= 0.8) return "amber";
  return "green";
}

/**
 * Evaluate an IQC (internal quality control) sample assignment to one employee.
 * IQC has TWO caps per employee per quarter: a total-unit cap (50) AND a
 * concentrate sub-cap (25). Blocks if EITHER would be exceeded.
 */
export function evaluateIqcCap(args: {
  usedTotalUnits: number; // all IQC units used by this employee this quarter
  usedConcentrateUnits: number; // of which, concentrate units
  addUnits: number;
  addIsConcentrate: boolean;
  settings: SampleSettings;
}): CapEvaluation & { subcapOver: boolean } {
  const { usedTotalUnits, usedConcentrateUnits, addUnits, addIsConcentrate, settings } = args;
  const totalCap = settings.iqcUnitsPerEmployee;
  const subCap = settings.iqcConcentrateSubcap;

  const projectedTotal = usedTotalUnits + addUnits;
  const projectedConc = usedConcentrateUnits + (addIsConcentrate ? addUnits : 0);

  const totalOver = projectedTotal > totalCap;
  const subcapOver = addIsConcentrate && projectedConc > subCap;
  const overCap = totalOver || subcapOver;

  const remaining = Math.max(0, totalCap - usedTotalUnits);
  const nearCap = totalCap > 0 && usedTotalUnits / totalCap >= 0.8;
  const block = overCap && settings.enforce && settings.hardBlock;

  let message: string;
  if (subcapOver) {
    message = `Blocked: ${projectedConc} IQC concentrate units would exceed the ${subCap}-unit concentrate sub-cap for this employee this quarter. ${WAC_CITATION}, §096(3).`;
  } else if (totalOver) {
    message = `Blocked: ${projectedTotal} IQC units would exceed the ${totalCap}-unit quarterly cap for this employee (${remaining} remaining). ${WAC_CITATION}, §096(3).`;
  } else if (nearCap) {
    message = `Warning: this employee is near the ${totalCap}-unit IQC quarterly cap (${remaining} remaining after this).`;
  } else {
    message = `${projectedTotal} of ${totalCap} IQC units used this quarter for this employee (${totalCap - projectedTotal} remaining).`;
  }

  return {
    usedUnits: usedTotalUnits,
    capUnits: totalCap,
    addUnits,
    projectedUnits: projectedTotal,
    overCap,
    subcapOver,
    nearCap,
    remaining,
    block,
    message,
  };
}

// ---------------------------------------------------------------------------
// Draft parsing for the record form
// ---------------------------------------------------------------------------

export type RecordDraft = {
  direction: string;
  category?: string; // "trade" (default) | "iqc"
  productType: string;
  unitCount: string;
  unitSizeGrams?: string;
  unitSizeMg?: string;
  thcMgPerServing?: string;
  ymd: string;
  processorName?: string;
  employeeId?: string;
  fromSampleJar?: boolean;
  note?: string;
};

export type ParsedRecord = {
  direction: SampleDirection;
  category: SampleCategory;
  productType: SampleProductType;
  unitCount: number;
  unitSizeGrams: number | null;
  unitSizeMg: number | null;
  thcMgPerServing: number | null;
  quarterKey: string;
  processorName: string | null;
  employeeId: string | null;
  fromSampleJar: boolean;
  note: string | null;
};

export type ParseResult = { ok: true; value: ParsedRecord } | { ok: false; errors: string[] };

/** Validate + normalize the record form, including per-unit size caps. */
export function parseRecordDraft(draft: RecordDraft, settings: SampleSettings): ParseResult {
  const errors: string[] = [];

  const category: SampleCategory = draft.category === "iqc" ? "iqc" : "trade";

  // IQC is inherently self-sampling by the retailer's own employees → always
  // "outgoing" to an employee. Trade samples can be incoming or outgoing.
  const rawDirection = category === "iqc" ? "outgoing" : draft.direction;
  const direction = rawDirection === "incoming" || rawDirection === "outgoing" ? (rawDirection as SampleDirection) : null;
  if (!direction) errors.push("Choose a direction (incoming or outgoing).");

  const validTypes: SampleProductType[] = ["useable", "concentrate", "infused", "flower"];
  const productType = validTypes.includes(draft.productType as SampleProductType)
    ? (draft.productType as SampleProductType)
    : null;
  if (!productType) errors.push("Choose a product type.");

  const unitCount = Math.trunc(Number(draft.unitCount));
  if (!Number.isFinite(unitCount) || unitCount <= 0) errors.push("Enter a unit count of 1 or more.");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.ymd ?? "")) errors.push("Enter a valid date.");

  const unitSizeGrams = draft.unitSizeGrams ? Number(draft.unitSizeGrams) : null;
  const unitSizeMg = draft.unitSizeMg ? Number(draft.unitSizeMg) : null;
  const thcMgPerServing = draft.thcMgPerServing ? Number(draft.thcMgPerServing) : null;

  if (direction === "incoming" && !(draft.processorName ?? "").trim()) {
    errors.push("Enter the supplying processor's name for incoming samples.");
  }
  if (direction === "outgoing" && !(draft.employeeId ?? "").trim()) {
    errors.push("Choose the receiving employee.");
  }

  // IQC cannot be incoming (it's the retailer's own self-sampling).
  if (category === "iqc" && direction === "incoming") {
    errors.push("Internal quality control samples are assigned to employees, not received from a processor.");
  }

  if (productType) {
    const sizeCheck = validateUnitSize(
      { productType, category, unitSizeGrams, unitSizeMg, thcMgPerServing },
      settings,
    );
    if (!sizeCheck.ok) errors.push(...sizeCheck.errors);
  }

  if (errors.length) return { ok: false, errors };

  // For IQC, infused is captured by THC mg (thcMgPerServing); size grams n/a.
  const isInfused = productType === "infused";
  return {
    ok: true,
    value: {
      direction: direction!,
      category,
      productType: productType!,
      unitCount,
      unitSizeGrams: isInfused ? null : unitSizeGrams,
      unitSizeMg: category === "trade" && isInfused ? unitSizeMg : null,
      thcMgPerServing: isInfused ? thcMgPerServing : null,
      quarterKey: quarterKeyFromYmd(draft.ymd),
      processorName: direction === "incoming" ? (draft.processorName ?? "").trim() || null : null,
      employeeId: direction === "outgoing" ? (draft.employeeId ?? "").trim() || null : null,
      fromSampleJar: Boolean(draft.fromSampleJar),
      note: (draft.note ?? "").trim() || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Sample JSON import ("samples come to us like regular products, with its own
// json to upload"). We parse a permissive shape into normalized incoming lots.
// ---------------------------------------------------------------------------

export type SampleJsonLot = {
  productType: SampleProductType;
  unitCount: number;
  unitSizeGrams: number | null;
  unitSizeMg: number | null;
  thcMgPerServing: number | null;
  processorName: string | null;
  productName: string | null;
  lotRef: string | null;
};

export type SampleJsonParse =
  | { ok: true; lots: SampleJsonLot[]; totalUnits: number; warnings: string[] }
  | { ok: false; errors: string[] };

function coerceType(v: unknown): SampleProductType | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "useable" || s === "usable") return "useable";
  if (s === "flower") return "flower";
  if (s === "concentrate" || s === "extract") return "concentrate";
  if (s === "infused" || s === "edible") return "infused";
  return null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an uploaded sample JSON payload. Accepts either a bare array of lots or
 * an object with a `samples`/`lots`/`items` array. Each lot is permissive about
 * field names (product_type|productType|type, unit_count|units|quantity, etc.).
 * Returns normalized incoming lots the owner can then record + assign.
 */
export function parseSampleJson(input: unknown): SampleJsonParse {
  const warnings: string[] = [];

  // Accept a raw JSON string (uploaded file contents) or an already-parsed value.
  let parsed: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, errors: ["The file is empty."] };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, errors: ["The file is not valid JSON."] };
    }
  }

  let arr: unknown[] | null = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const cand = o.samples ?? o.lots ?? o.items ?? o.data;
    if (Array.isArray(cand)) arr = cand;
  }
  if (!arr) return { ok: false, errors: ["JSON must be an array of samples, or an object with a 'samples' array."] };
  if (arr.length === 0) return { ok: false, errors: ["No sample lots found in the file."] };

  const lots: SampleJsonLot[] = [];
  arr.forEach((rawItem, i) => {
    if (!rawItem || typeof rawItem !== "object") {
      warnings.push(`Row ${i + 1}: skipped (not an object).`);
      return;
    }
    const r = rawItem as Record<string, unknown>;
    const productType = coerceType(r.product_type ?? r.productType ?? r.type ?? r.category);
    if (!productType) {
      warnings.push(`Row ${i + 1}: skipped (unknown product type "${String(r.product_type ?? r.type ?? "")}").`);
      return;
    }
    const unitCountRaw = numOrNull(r.unit_count ?? r.units ?? r.quantity ?? r.qty ?? 1);
    const unitCount = Math.trunc(unitCountRaw ?? 1);
    if (unitCount <= 0) {
      warnings.push(`Row ${i + 1}: skipped (unit count must be ≥ 1).`);
      return;
    }
    lots.push({
      productType,
      unitCount,
      unitSizeGrams: numOrNull(r.unit_size_grams ?? r.unitSizeGrams ?? r.grams ?? r.size_g),
      unitSizeMg: numOrNull(r.unit_size_mg ?? r.unitSizeMg ?? r.mg ?? r.size_mg),
      thcMgPerServing: numOrNull(r.thc_mg ?? r.thcMgPerServing ?? r.thc_per_serving ?? r.thc),
      processorName: String(r.processor_name ?? r.processor ?? r.vendor ?? r.supplier ?? "").trim() || null,
      productName: String(r.product_name ?? r.productName ?? r.name ?? r.strain ?? "").trim() || null,
      lotRef: String(r.lot ?? r.lot_ref ?? r.lotRef ?? r.batch ?? r.uid ?? "").trim() || null,
    });
  });

  if (lots.length === 0) return { ok: false, errors: ["No valid sample lots could be parsed.", ...warnings] };
  const totalUnits = lots.reduce((s, l) => s + l.unitCount, 0);
  return { ok: true, lots, totalUnits, warnings };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const TEST_SETTINGS: SampleSettings = {
  enforce: true,
  hardBlock: true,
  incomingUnitsPerQuarter: 120,
  outgoingUnitsPerEmployee: 30,
  maxFlowerGrams: 3.5,
  maxConcentrateGrams: 1,
  maxInfusedMg: 100,
  maxThcMgPerServing: 10,
  iqcUnitsPerEmployee: 50,
  iqcConcentrateSubcap: 25,
  iqcMaxFlowerGrams: 1,
  iqcMaxUseableGrams: 1,
  iqcMaxConcentrateGrams: 1,
  iqcMaxInfusedThcMg: 10,
};

export function __runTradeSamplesCoreTests(): string {
  // quarter math
  assert(quarterOfMonth(1) === 1 && quarterOfMonth(4) === 2 && quarterOfMonth(9) === 3 && quarterOfMonth(12) === 4, "quarterOfMonth");
  assert(quarterKeyFromYmd("2025-05-14") === "2025-Q2", "quarterKey Q2");
  assert(quarterKeyFromYmd("2025-01-01") === "2025-Q1", "quarterKey Q1");
  assert(quarterLabel("2025-Q2").includes("Apr–Jun"), "quarter label");

  // per-unit size caps
  assert(validateUnitSize({ productType: "useable", unitSizeGrams: 3.5 }, TEST_SETTINGS).ok === true, "flower 3.5g ok");
  assert(validateUnitSize({ productType: "useable", unitSizeGrams: 4 }, TEST_SETTINGS).ok === false, "flower 4g over");
  assert(validateUnitSize({ productType: "concentrate", unitSizeGrams: 1 }, TEST_SETTINGS).ok === true, "conc 1g ok");
  assert(validateUnitSize({ productType: "concentrate", unitSizeGrams: 1.5 }, TEST_SETTINGS).ok === false, "conc 1.5g over");
  assert(validateUnitSize({ productType: "infused", unitSizeMg: 100, thcMgPerServing: 10 }, TEST_SETTINGS).ok === true, "infused 100mg/10mg ok");
  assert(validateUnitSize({ productType: "infused", unitSizeMg: 100, thcMgPerServing: 11 }, TEST_SETTINGS).ok === false, "infused 11mg thc over");
  assert(validateUnitSize({ productType: "infused", unitSizeMg: 150, thcMgPerServing: 10 }, TEST_SETTINGS).ok === false, "infused 150mg over");

  // cap evaluation — incoming
  const eIn = evaluateCap({ direction: "incoming", usedUnits: 100, addUnits: 10, settings: TEST_SETTINGS });
  assert(eIn.overCap === false && eIn.remaining === 20 && eIn.nearCap === true, "incoming near cap");
  const eInOver = evaluateCap({ direction: "incoming", usedUnits: 115, addUnits: 10, settings: TEST_SETTINGS });
  assert(eInOver.overCap === true && eInOver.block === true, "incoming over cap blocks");

  // cap evaluation — outgoing employee
  const eOut = evaluateCap({ direction: "outgoing", usedUnits: 25, addUnits: 6, settings: TEST_SETTINGS });
  assert(eOut.overCap === true && eOut.block === true, "outgoing 31 over 30 blocks");
  const eOutOk = evaluateCap({ direction: "outgoing", usedUnits: 10, addUnits: 5, settings: TEST_SETTINGS });
  assert(eOutOk.overCap === false && eOutOk.block === false, "outgoing 15 ok");

  // warn-only (hardBlock false) does not block
  const soft: SampleSettings = { ...TEST_SETTINGS, hardBlock: false };
  const eSoft = evaluateCap({ direction: "outgoing", usedUnits: 30, addUnits: 5, settings: soft });
  assert(eSoft.overCap === true && eSoft.block === false, "soft over cap warns not blocks");

  // capTone
  assert(capTone(0, 30) === "green" && capTone(24, 30) === "amber" && capTone(30, 30) === "red", "capTone buckets");

  // parseRecordDraft — incoming happy
  const okIn = parseRecordDraft(
    { direction: "incoming", productType: "useable", unitCount: "10", unitSizeGrams: "3.5", ymd: "2025-05-14", processorName: "Acme Farms" },
    TEST_SETTINGS,
  );
  assert(okIn.ok === true, "parse incoming ok");
  if (okIn.ok) assert(okIn.value.quarterKey === "2025-Q2" && okIn.value.processorName === "Acme Farms", "parse incoming fields");

  // parse missing processor
  const badIn = parseRecordDraft(
    { direction: "incoming", productType: "useable", unitCount: "10", unitSizeGrams: "3.5", ymd: "2025-05-14" },
    TEST_SETTINGS,
  );
  assert(badIn.ok === false, "incoming requires processor");

  // parse outgoing requires employee
  const badOut = parseRecordDraft(
    { direction: "outgoing", productType: "concentrate", unitCount: "2", unitSizeGrams: "1", ymd: "2025-05-14" },
    TEST_SETTINGS,
  );
  assert(badOut.ok === false, "outgoing requires employee");

  // parse over-size unit rejected
  const badSize = parseRecordDraft(
    { direction: "incoming", productType: "useable", unitCount: "1", unitSizeGrams: "9", ymd: "2025-05-14", processorName: "X" },
    TEST_SETTINGS,
  );
  assert(badSize.ok === false, "over-size unit rejected");

  // -------------------------------------------------------------------------
  // IQC per-unit size caps (differ from trade)
  // -------------------------------------------------------------------------
  assert(validateUnitSize({ productType: "flower", category: "iqc", unitSizeGrams: 1 }, TEST_SETTINGS).ok === true, "iqc flower 1g ok");
  assert(validateUnitSize({ productType: "flower", category: "iqc", unitSizeGrams: 1.5 }, TEST_SETTINGS).ok === false, "iqc flower 1.5g over");
  assert(validateUnitSize({ productType: "useable", category: "iqc", unitSizeGrams: 1 }, TEST_SETTINGS).ok === true, "iqc useable 1g ok");
  assert(validateUnitSize({ productType: "useable", category: "iqc", unitSizeGrams: 3.5 }, TEST_SETTINGS).ok === false, "iqc useable 3.5g over (trade limit, not iqc)");
  assert(validateUnitSize({ productType: "concentrate", category: "iqc", unitSizeGrams: 1 }, TEST_SETTINGS).ok === true, "iqc conc 1g ok");
  assert(validateUnitSize({ productType: "concentrate", category: "iqc", unitSizeGrams: 1.1 }, TEST_SETTINGS).ok === false, "iqc conc 1.1g over");
  assert(validateUnitSize({ productType: "infused", category: "iqc", thcMgPerServing: 10 }, TEST_SETTINGS).ok === true, "iqc infused 10mg thc ok");
  assert(validateUnitSize({ productType: "infused", category: "iqc", thcMgPerServing: 11 }, TEST_SETTINGS).ok === false, "iqc infused 11mg thc over");

  // -------------------------------------------------------------------------
  // IQC quarterly cap evaluation (50 total, 25 concentrate sub-cap)
  // -------------------------------------------------------------------------
  const iqcOk = evaluateIqcCap({ usedTotalUnits: 10, usedConcentrateUnits: 0, addUnits: 5, addIsConcentrate: false, settings: TEST_SETTINGS });
  assert(iqcOk.overCap === false && iqcOk.block === false && iqcOk.remaining === 40, "iqc 15/50 ok");

  const iqcNear = evaluateIqcCap({ usedTotalUnits: 42, usedConcentrateUnits: 0, addUnits: 4, addIsConcentrate: false, settings: TEST_SETTINGS });
  assert(iqcNear.nearCap === true && iqcNear.overCap === false, "iqc 42 near cap");

  const iqcTotalOver = evaluateIqcCap({ usedTotalUnits: 48, usedConcentrateUnits: 0, addUnits: 5, addIsConcentrate: false, settings: TEST_SETTINGS });
  assert(iqcTotalOver.overCap === true && iqcTotalOver.subcapOver === false && iqcTotalOver.block === true, "iqc 53 over 50-cap blocks");

  const iqcSubOver = evaluateIqcCap({ usedTotalUnits: 20, usedConcentrateUnits: 24, addUnits: 3, addIsConcentrate: true, settings: TEST_SETTINGS });
  assert(iqcSubOver.subcapOver === true && iqcSubOver.overCap === true && iqcSubOver.block === true, "iqc 27 concentrate over 25 sub-cap blocks");

  const iqcSubOkTotalRoom = evaluateIqcCap({ usedTotalUnits: 20, usedConcentrateUnits: 24, addUnits: 1, addIsConcentrate: true, settings: TEST_SETTINGS });
  assert(iqcSubOkTotalRoom.subcapOver === false && iqcSubOkTotalRoom.overCap === false, "iqc 25 concentrate exactly at sub-cap ok");

  // soft mode: over cap warns but does not block
  const iqcSoft = evaluateIqcCap({ usedTotalUnits: 48, usedConcentrateUnits: 0, addUnits: 5, addIsConcentrate: false, settings: { ...TEST_SETTINGS, hardBlock: false } });
  assert(iqcSoft.overCap === true && iqcSoft.block === false, "iqc soft over warns not blocks");

  // -------------------------------------------------------------------------
  // Category-aware parseRecordDraft (IQC forced outgoing, incoming rejected)
  // -------------------------------------------------------------------------
  const iqcParse = parseRecordDraft(
    { direction: "incoming", category: "iqc", productType: "flower", unitCount: "2", unitSizeGrams: "1", ymd: "2025-05-14", employeeId: "emp-1" },
    TEST_SETTINGS,
  );
  assert(iqcParse.ok === true, "iqc parse ok (direction coerced to outgoing)");
  if (iqcParse.ok) assert(iqcParse.value.direction === "outgoing" && iqcParse.value.category === "iqc" && iqcParse.value.employeeId === "emp-1", "iqc parse fields");

  const iqcNoEmp = parseRecordDraft(
    { direction: "outgoing", category: "iqc", productType: "flower", unitCount: "1", unitSizeGrams: "1", ymd: "2025-05-14" },
    TEST_SETTINGS,
  );
  assert(iqcNoEmp.ok === false, "iqc requires employee");

  const iqcOversize = parseRecordDraft(
    { direction: "outgoing", category: "iqc", productType: "useable", unitCount: "1", unitSizeGrams: "3.5", ymd: "2025-05-14", employeeId: "emp-1" },
    TEST_SETTINGS,
  );
  assert(iqcOversize.ok === false, "iqc useable 3.5g rejected (over 1g iqc cap)");

  const iqcInfusedParse = parseRecordDraft(
    { direction: "outgoing", category: "iqc", productType: "infused", unitCount: "1", thcMgPerServing: "10", ymd: "2025-05-14", employeeId: "emp-1" },
    TEST_SETTINGS,
  );
  assert(iqcInfusedParse.ok === true, "iqc infused parse ok");
  if (iqcInfusedParse.ok) assert(iqcInfusedParse.value.unitSizeMg === null && iqcInfusedParse.value.thcMgPerServing === 10, "iqc infused stores thc mg, not size mg");

  // -------------------------------------------------------------------------
  // parseSampleJson
  // -------------------------------------------------------------------------
  const jsonOk = parseSampleJson(JSON.stringify([
    { product_type: "useable", unit_count: 10, unit_size_grams: 3.5, processor: "Acme Farms", strain: "OG", lot: "L1" },
    { type: "concentrate", units: 5, grams: 1, vendor: "Dab Co" },
  ]));
  assert(jsonOk.ok === true, "json parse ok");
  if (jsonOk.ok) assert(jsonOk.lots.length === 2 && jsonOk.totalUnits === 15, "json parse totals");

  const jsonWrapped = parseSampleJson(JSON.stringify({ lots: [{ product_type: "infused", qty: 3, thc_mg: 10 }] }));
  assert(jsonWrapped.ok === true, "json parse wrapped object ok");
  if (jsonWrapped.ok) assert(jsonWrapped.lots.length === 1 && jsonWrapped.lots[0]!.thcMgPerServing === 10, "json wrapped fields");

  const jsonBad = parseSampleJson("not json at all {");
  assert(jsonBad.ok === false, "json invalid rejected");

  const jsonEmpty = parseSampleJson("[]");
  assert(jsonEmpty.ok === false, "json empty rejected");

  const jsonPartial = parseSampleJson(JSON.stringify([{ product_type: "banana", units: 2 }, { product_type: "useable", units: 4, grams: 3.5 }]));
  assert(jsonPartial.ok === true, "json with one bad row still parses good rows");
  if (jsonPartial.ok) assert(jsonPartial.lots.length === 1 && (jsonPartial.warnings?.length ?? 0) >= 1, "json partial warns on bad row");

  return "OK: trade-samples-core tests passed";
}
