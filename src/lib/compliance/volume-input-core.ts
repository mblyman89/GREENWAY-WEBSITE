/**
 * R37 S3 - the net-volume field takes millilitres OR US fluid ounces.
 *
 * Owner: "select between ml and fl oz. And I want standard conversion rates
 * so it's easy to know without needing to google it first."
 *
 * The stored fact stays canonical in millilitres (net_volume_ml; every reader
 * - the 72 fl oz WAC 314-55-095(1)(d)(i)(E) cap, the cards, Leafly - reads
 * ml). A figure typed in fl oz is converted ONCE, server-side, by the
 * codebase's single constant (liquid-volume-core ML_PER_FLUID_OUNCE =
 * 29.5735; the owner ruled that value over NIST's 29.5735295625 for
 * consistency - the difference is 0.0001 %). Nothing here guesses: an
 * unknown unit or a bad number is refused, never coerced.
 *
 * PURE: imports only the constant module. Safe in client and server code.
 */
import { ML_PER_FLUID_OUNCE, REC_LIQUID_FLUID_OUNCES, REC_LIQUID_ML } from "./liquid-volume-core";

export const VOLUME_INPUT_UNITS = ["ml", "floz"] as const;
export type VolumeInputUnit = (typeof VOLUME_INPUT_UNITS)[number];

export const VOLUME_UNIT_LABEL: Record<VolumeInputUnit, string> = { ml: "ml", floz: "fl oz" };

export function isVolumeInputUnit(v: unknown): v is VolumeInputUnit {
  return v === "ml" || v === "floz";
}

/** ml rounded to 3 dp (72 fl oz -> exactly the 2129.292 ml cap). */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A tidy number for people: up to 2 dp, trailing zeros dropped. */
export function tidy(n: number): string {
  return String(r2(n));
}

/** fl oz -> ml (3 dp), ml -> ml. Null for a non-finite or negative figure. */
export function volumeToMl(quantity: number, unit: VolumeInputUnit): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return unit === "floz" ? r3(quantity * ML_PER_FLUID_OUNCE) : quantity;
}

/** ml -> fl oz (2 dp). */
export function mlToFlOz(ml: number): number | null {
  if (!Number.isFinite(ml) || ml < 0) return null;
  return r2(ml / ML_PER_FLUID_OUNCE);
}

/**
 * Parse the form's raw volume + unit. Empty raw -> { ok, ml: null } (nothing
 * typed). A missing unit means ml (the field's historic meaning, so an old
 * form posted mid-deploy still saves the same number).
 */
export function parseVolumeInput(
  raw: string,
  unitRaw: string,
): { ok: true; ml: number | null; unit: VolumeInputUnit } | { ok: false; error: string } {
  const unitText = String(unitRaw ?? "").trim();
  const unit: VolumeInputUnit | null = unitText === "" ? "ml" : isVolumeInputUnit(unitText) ? unitText : null;
  if (unit === null) return { ok: false, error: `"${unitText}" is not a volume unit - choose ml or fl oz.` };
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, ml: null, unit };
  const n = Number(text);
  const ml = volumeToMl(n, unit);
  if (ml === null) return { ok: false, error: `"${text}" is not a valid number for net volume.` };
  return { ok: true, ml, unit };
}

/** "354.88 ml = 12 fl oz" - the conversion line shown under the field. */
export function volumeConversionText(quantity: number, unit: VolumeInputUnit): string | null {
  const ml = volumeToMl(quantity, unit);
  if (ml === null || ml === 0) return null;
  const oz = mlToFlOz(ml)!;
  const over = ml > REC_LIQUID_ML + 1e-9;
  const base = unit === "floz" ? `${tidy(quantity)} fl oz = ${tidy(ml)} ml` : `${tidy(ml)} ml = ${tidy(oz)} fl oz`;
  return over ? `${base} - over Washington's ${REC_LIQUID_FLUID_OUNCES} fl oz liquid limit` : base;
}

/** Standard sizes, so nobody has to look a conversion up. */
export const COMMON_FL_OZ = [1, 2, 4, 8, 12, 16, 72] as const;
export const COMMON_ML = [5, 10, 15, 30, 60, 100, 250, 355, 500, 1000] as const;

export function volumeReferenceRows(): { flOz: string; ml: string; note: string | null }[] {
  const rows: { flOz: string; ml: string; note: string | null }[] = [];
  for (const oz of COMMON_FL_OZ) {
    rows.push({ flOz: tidy(oz), ml: tidy(volumeToMl(oz, "floz")!), note: oz === 12 ? "a standard can" : oz === REC_LIQUID_FLUID_OUNCES ? "Washington's liquid limit" : null });
  }
  for (const ml of COMMON_ML) {
    rows.push({ flOz: tidy(mlToFlOz(ml)!), ml: tidy(ml), note: ml === 30 ? "a common tincture bottle" : ml === 5 ? "1 teaspoon" : ml === 15 ? "1 tablespoon" : null });
  }
  return rows;
}

export const VOLUME_RATE_TEXT = `1 fl oz = ${ML_PER_FLUID_OUNCE} ml \u00b7 1 ml = ${(1 / ML_PER_FLUID_OUNCE).toFixed(4)} fl oz`;

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVolumeInputTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.log("  FAIL volume-input-core: " + m);
    }
  };
  ok(volumeToMl(1, "floz") === 29.574, "1 fl oz -> 29.574 ml (3 dp)");
  ok(volumeToMl(12, "floz") === 354.882, "12 fl oz -> 354.882 ml");
  ok(volumeToMl(72, "floz") === 2129.292 && Math.abs(volumeToMl(72, "floz")! - REC_LIQUID_ML) < 1e-9, "72 fl oz -> exactly the 2129.292 ml cap");
  ok(volumeToMl(355, "ml") === 355, "ml passes through");
  ok(volumeToMl(-1, "ml") === null && volumeToMl(NaN, "floz") === null, "negative / NaN refused");
  ok(mlToFlOz(355) === 12, "355 ml -> 12 fl oz");
  ok(mlToFlOz(30) === 1.01, "30 ml -> 1.01 fl oz");
  const a = parseVolumeInput("12", "floz");
  ok(a.ok && a.ml === 354.882 && a.unit === "floz", "parse 12 floz");
  const b = parseVolumeInput("100", "");
  ok(b.ok && b.ml === 100 && b.unit === "ml", "missing unit = ml (old forms keep their meaning)");
  const c = parseVolumeInput("", "floz");
  ok(c.ok && c.ml === null, "empty -> nothing typed");
  const d = parseVolumeInput("12", "oz");
  ok(!d.ok && d.error.includes("choose ml or fl oz"), "bare oz refused (weight vs fluid ambiguity)");
  const e = parseVolumeInput("twelve", "ml");
  ok(!e.ok && e.error.includes("not a valid number"), "words refused");
  ok(!parseVolumeInput("-3", "floz").ok, "negative refused");
  ok(volumeConversionText(12, "floz") === "12 fl oz = 354.88 ml", "conversion line fl oz");
  ok(volumeConversionText(355, "ml") === "355 ml = 12 fl oz", "conversion line ml");
  ok(volumeConversionText(73, "floz")!.includes("over Washington's 72 fl oz liquid limit"), "over the cap is said");
  ok(!volumeConversionText(72, "floz")!.includes("over"), "exactly 72 is not over");
  ok(volumeConversionText(0, "ml") === null, "zero -> no line");
  const rows = volumeReferenceRows();
  ok(rows.length === COMMON_FL_OZ.length + COMMON_ML.length, "reference rows");
  ok(rows.some((r) => r.flOz === "72" && r.ml === "2129.29" && r.note === "Washington's liquid limit"), "72 fl oz row");
  ok(rows.some((r) => r.flOz === "12" && r.ml === "354.88"), "12 fl oz row");
  ok(VOLUME_RATE_TEXT === "1 fl oz = 29.5735 ml \u00b7 1 ml = 0.0338 fl oz", "rate text");
  ok(isVolumeInputUnit("ml") && isVolumeInputUnit("floz") && !isVolumeInputUnit("oz") && !isVolumeInputUnit("l"), "units");
  ok(tidy(354.882) === "354.88" && tidy(12) === "12", "tidy");
  return { passed, failed };
}
