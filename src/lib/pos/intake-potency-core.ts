/**
 * src/lib/pos/intake-potency-core.ts  (SLICE 61 — mg-aware potency at intake)
 *
 * PURE unit resolution + sanity caps + formatting for potency values flowing
 * through the JSON-manifest INTAKE path (draft injection, intake menu staging,
 * back-office lot displays).
 *
 * THE BUG THIS FIXES (owner report, screenshots 2026-07-26): edibles, drinks,
 * and topicals received via JSON manifest intake displayed their milligram
 * doses as PERCENTAGES — "THC: 3000%" on a topical, "THC: 100%" on a 100 mg
 * drink — because draft-injection-core hard-coded `unit: "%"` onto every
 * potency value. The WCIA transfer JSON stores potency numbers without
 * distinguishing per-package mg from lab percent, and the intake parser
 * flattens them into the *_pct lab columns, so the NUMBERS are right but the
 * UNIT semantics were lost.
 *
 * THE POLICY (mirror of the shipped Cultivera-import path — verified in
 * src/lib/pos/transform.ts `cannabinoidUnitForInventoryType` +
 * `capCannabinoidValue`, and src/lib/inventory/fact-extraction-core.ts
 * MG_FACT_TYPES):
 *
 *   • The display unit is DERIVED, never guessed per-row:
 *       mg  — when the resolved WEBSITE category is a dose-led one
 *             (edible-solid / edible-liquid / tincture / topical), OR the LCB
 *             inventory type is one of the MG_FACT_TYPES ("Solid Edible",
 *             "Liquid Edible", "Tincture", "Topical Ointment").
 *       %   — everything else (flower, concentrates incl. RSO, cartridges).
 *     RSO is deliberately NOT mg here: the extraction engine's rule is
 *     "percent-based types (flower, concentrates incl. RSO) stay in percent
 *     mode" (fact-extraction-core.ts header).
 *
 *   • Sanity caps (identical ceilings to transform.ts):
 *       %   — hard cap 100 (a percentage over 100 is corrupt data).
 *       mg  — per-category generous-but-finite ceilings so corrupt rows can't
 *             render absurd doses: edible-solid 2000, edible-liquid 1000,
 *             tincture 5000, topical 5000, default 5000.
 *
 *   • Formatting matches transform.ts exactly: "12.34%" and "100mg" (no space
 *     before mg) so intake-published cards read identically to import-published
 *     ones and card-cannabinoids.ts parses both the same way.
 *
 * No I/O, no React — registered in scripts/compliance/run-pure-selftests.ts.
 */
import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";

export type PotencyUnit = "%" | "mg";

/**
 * Website categories whose potency is dosed in milligrams. Mirrors the
 * MG_FACT_TYPES inventory-type vocabulary one level up (the resolver maps
 * "Solid Edible" → edible-solid, "Liquid Edible" → edible-liquid,
 * "Tincture" → tincture, "Topical Ointment"/Suppository/Transdermal → topical).
 * Deliberately EXCLUDES "rso" — RSO is a concentrate and stays in percent.
 */
export const MG_WEBSITE_CATEGORIES: ReadonlySet<string> = new Set([
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
]);

/** Percent values can never exceed 100 (same hard cap as transform.ts). */
export const INTAKE_PERCENT_CAP = 100;

/**
 * Per-website-category mg ceilings — same numbers as transform.ts
 * CANNABINOID_MG_CAP (keyed there by LCB inventory type: Solid Edible 2000,
 * Liquid Edible 1000, Tincture 5000, Topical Ointment 5000).
 */
export const INTAKE_MG_CAP_BY_CATEGORY: Readonly<Record<string, number>> = {
  "edible-solid": 2000,
  "edible-liquid": 1000,
  tincture: 5000,
  topical: 5000,
};

/** Fallback mg ceiling (same as transform.ts DEFAULT_CANNABINOID_MG_CAP). */
export const DEFAULT_INTAKE_MG_CAP = 5000;

function collapse(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Resolve the display unit for an intake product from its resolved website
 * category and/or its LCB inventory type. Either signal alone is enough to
 * flip to mg; with neither, percent is the safe default (flower/concentrate).
 */
export function intakePotencyUnit(
  websiteCategory: string | null | undefined,
  inventoryType: string | null | undefined,
): PotencyUnit {
  const cat = collapse(websiteCategory).toLowerCase();
  if (cat && MG_WEBSITE_CATEGORIES.has(cat)) return "mg";
  const type = collapse(inventoryType);
  if (type && MG_FACT_TYPES.has(type)) return "mg";
  return "%";
}

/**
 * Apply the sanity cap for a potency value in the resolved unit. Returns the
 * (possibly clamped) value and whether a cap was applied — callers surface a
 * diagnostic when `capped` so the human sees exactly what was reined in.
 */
export function capIntakePotency(
  raw: number,
  unit: PotencyUnit,
  websiteCategory: string | null | undefined,
): { value: number; capped: boolean } {
  if (!Number.isFinite(raw)) return { value: 0, capped: true };
  if (unit === "%") {
    if (raw > INTAKE_PERCENT_CAP) return { value: INTAKE_PERCENT_CAP, capped: true };
    return { value: raw, capped: false };
  }
  const cat = collapse(websiteCategory).toLowerCase();
  const ceiling = INTAKE_MG_CAP_BY_CATEGORY[cat] ?? DEFAULT_INTAKE_MG_CAP;
  if (raw > ceiling) return { value: ceiling, capped: true };
  return { value: raw, capped: false };
}

/**
 * Format a potency value for display, matching transform.ts output byte for
 * byte: percent as "21.66%", milligrams as "100mg" (no space — the register
 * and card pipelines both strip with /mg$/ and /%$/ anchors).
 */
export function formatIntakePotency(value: number, unit: PotencyUnit): string {
  const n = Number(value.toFixed(2));
  return unit === "%" ? `${n}%` : `${n}mg`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runIntakePotencyCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`intake-potency-core self-test failed: ${msg}`);
    passed += 1;
  };

  // Unit resolution: website category signal.
  ok(intakePotencyUnit("edible-solid", null) === "mg", "edible-solid -> mg");
  ok(intakePotencyUnit("edible-liquid", null) === "mg", "edible-liquid -> mg");
  ok(intakePotencyUnit("tincture", null) === "mg", "tincture -> mg");
  ok(intakePotencyUnit("topical", null) === "mg", "topical -> mg");
  ok(intakePotencyUnit("flower", null) === "%", "flower -> %");
  ok(intakePotencyUnit("concentrate", null) === "%", "concentrate -> %");
  ok(intakePotencyUnit("rso", null) === "%", "RSO stays percent (extraction-engine rule)");
  ok(intakePotencyUnit("cartridge", null) === "%", "cartridge -> %");
  ok(intakePotencyUnit("  Topical  ", null) === "mg", "category trimmed + case-insensitive");

  // Unit resolution: LCB inventory-type signal (MG_FACT_TYPES vocabulary).
  ok(intakePotencyUnit(null, "Solid Edible") === "mg", "Solid Edible type -> mg");
  ok(intakePotencyUnit(null, "Liquid Edible") === "mg", "Liquid Edible type -> mg");
  ok(intakePotencyUnit(null, "Tincture") === "mg", "Tincture type -> mg");
  ok(intakePotencyUnit(null, "Topical Ointment") === "mg", "Topical Ointment type -> mg");
  ok(intakePotencyUnit(null, "Usable Marijuana") === "%", "Usable Marijuana -> %");
  ok(intakePotencyUnit(null, "Concentrate for Inhalation") === "%", "Concentrate for Inhalation -> %");
  ok(intakePotencyUnit(null, "  Solid   Edible ") === "mg", "type whitespace normalized");
  ok(intakePotencyUnit(null, null) === "%", "no signals -> % (safe default)");
  // Either signal alone flips to mg.
  ok(intakePotencyUnit("topical", "EndProduct") === "mg", "category wins over unknown type");
  ok(intakePotencyUnit("unknown-cat", "Liquid Edible") === "mg", "type rescues unknown category");

  // Caps: percent hard cap at 100.
  ok(capIntakePotency(21.66, "%", "flower").value === 21.66, "sane percent untouched");
  ok(!capIntakePotency(21.66, "%", "flower").capped, "sane percent not flagged");
  ok(capIntakePotency(3000, "%", "flower").value === 100, "3000% capped to 100");
  ok(capIntakePotency(3000, "%", "flower").capped, "cap flagged");
  ok(capIntakePotency(100, "%", "flower").value === 100 && !capIntakePotency(100, "%", "flower").capped, "exactly 100% allowed");

  // Caps: mg ceilings per category (same numbers as transform.ts).
  ok(capIntakePotency(3000, "mg", "topical").value === 3000, "3000mg topical under 5000 ceiling");
  ok(capIntakePotency(6000, "mg", "topical").value === 5000, "6000mg topical capped at 5000");
  ok(capIntakePotency(2500, "mg", "edible-solid").value === 2000, "edible-solid capped at 2000");
  ok(capIntakePotency(1500, "mg", "edible-liquid").value === 1000, "edible-liquid capped at 1000");
  ok(capIntakePotency(4999, "mg", "tincture").value === 4999, "tincture 4999mg under ceiling");
  ok(capIntakePotency(9999, "mg", "unknown").value === DEFAULT_INTAKE_MG_CAP, "unknown category uses default mg cap");
  ok(capIntakePotency(Number.NaN, "mg", "topical").capped && capIntakePotency(Number.NaN, "mg", "topical").value === 0, "NaN treated as corrupt");

  // Formatting matches transform.ts ("100mg" no space; trimmed decimals).
  ok(formatIntakePotency(100, "mg") === "100mg", "mg format no space");
  ok(formatIntakePotency(21.658, "%") === "21.66%", "percent rounds to 2dp");
  ok(formatIntakePotency(12.5, "mg") === "12.5mg", "mg trims trailing zeros");
  ok(formatIntakePotency(0.13, "%") === "0.13%", "small percent keeps precision");

  console.log(`intake-potency-core: ${passed} assertions passed`);
}
