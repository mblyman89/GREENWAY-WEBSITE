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
export type SampleProductType = "useable" | "concentrate" | "infused";

export const PRODUCT_TYPE_LABELS: Record<SampleProductType, string> = {
  useable: "Useable cannabis (flower)",
  concentrate: "Concentrate",
  infused: "Infused product",
};

/** Statutory defaults (mirrored by the trade_sample_settings row defaults). */
export const SAMPLE_DEFAULTS = {
  incomingUnitsPerQuarter: 120,
  outgoingUnitsPerEmployee: 30,
  maxFlowerGrams: 3.5,
  maxConcentrateGrams: 1,
  maxInfusedMg: 100,
  maxThcMgPerServing: 10,
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
  unitSizeGrams?: number | null; // useable/concentrate
  unitSizeMg?: number | null; // infused
  thcMgPerServing?: number | null; // infused
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/** Validate a single sample unit's size against the per-unit statutory caps. */
export function validateUnitSize(input: UnitSizeInput, settings: SampleSettings): ValidationResult {
  const errors: string[] = [];
  const { productType } = input;

  if (productType === "useable") {
    const g = num(input.unitSizeGrams);
    if (g === null || g <= 0) errors.push("Enter the per-unit weight in grams.");
    else if (g > settings.maxFlowerGrams) errors.push(`Each useable unit must be ≤ ${settings.maxFlowerGrams} g (${WAC_CITATION}).`);
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

// ---------------------------------------------------------------------------
// Draft parsing for the record form
// ---------------------------------------------------------------------------

export type RecordDraft = {
  direction: string;
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

  const direction = draft.direction === "incoming" || draft.direction === "outgoing" ? (draft.direction as SampleDirection) : null;
  if (!direction) errors.push("Choose a direction (incoming or outgoing).");

  const productType =
    draft.productType === "useable" || draft.productType === "concentrate" || draft.productType === "infused"
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
    errors.push("Choose the receiving employee for outgoing samples.");
  }

  if (productType) {
    const sizeCheck = validateUnitSize(
      { productType, unitSizeGrams, unitSizeMg, thcMgPerServing },
      settings,
    );
    if (!sizeCheck.ok) errors.push(...sizeCheck.errors);
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      direction: direction!,
      productType: productType!,
      unitCount,
      unitSizeGrams: productType === "infused" ? null : unitSizeGrams,
      unitSizeMg: productType === "infused" ? unitSizeMg : null,
      thcMgPerServing: productType === "infused" ? thcMgPerServing : null,
      quarterKey: quarterKeyFromYmd(draft.ymd),
      processorName: direction === "incoming" ? (draft.processorName ?? "").trim() || null : null,
      employeeId: direction === "outgoing" ? (draft.employeeId ?? "").trim() || null : null,
      fromSampleJar: Boolean(draft.fromSampleJar),
      note: (draft.note ?? "").trim() || null,
    },
  };
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

  return "OK: trade-samples-core tests passed";
}
