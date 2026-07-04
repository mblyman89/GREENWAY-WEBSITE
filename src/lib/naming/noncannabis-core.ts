/**
 * src/lib/naming/noncannabis-core.ts
 *
 * Non-cannabis (glass / accessories / paper) product naming convention + smart
 * SKU generation. Pure, dependency-free, tsx-unit-tested.
 *
 * Owner-defined convention (see docs/PRODUCT_NAMING_CONVENTION.md):
 *
 *   Name = {Brand (if any)} {Type} {Size/Joint size} {Gender} {Color}
 *
 *   e.g.  "Bong 12in Male Blue",  "Raw Lighter",  "Sitka Rolling Tray Walnut"
 *
 * SKU = {TYPE-PREFIX}-{SEQUENCE}[-{ATTR}]  (deterministic, collision-checked by
 * the caller against existing SKUs). Human-readable so staff can read a printed
 * label. The label printer (equipment page) prints the SKU as a Code128 barcode.
 *
 * NOTHING here guesses. Unknown type => "other" prefix; missing attrs simply
 * omitted from the name/SKU.
 */

import {
  DISALLOWED_NAME_CHARS,
  collapseWhitespace,
  stripDisallowedChars,
  toTitleCase,
  NAME_MAX_LEN,
} from "./convention-core";

/** Controlled vocabulary of non-cannabis product types + SKU prefixes. */
export const NONCANNABIS_TYPES = [
  { value: "pipe", label: "Pipe", prefix: "PIPE" },
  { value: "bong", label: "Bong", prefix: "BONG" },
  { value: "dab_rig", label: "Dab Rig", prefix: "RIG" },
  { value: "bubbler", label: "Bubbler", prefix: "BUBL" },
  { value: "downstem", label: "Downstem", prefix: "DSTM" },
  { value: "bowl", label: "Bowl / Slide", prefix: "BOWL" },
  { value: "banger", label: "Banger / Nail", prefix: "BANG" },
  { value: "carb_cap", label: "Carb Cap", prefix: "CARB" },
  { value: "grinder", label: "Grinder", prefix: "GRND" },
  { value: "lighter", label: "Lighter", prefix: "LTR" },
  { value: "torch", label: "Torch", prefix: "TRCH" },
  { value: "papers", label: "Rolling Papers", prefix: "PAPR" },
  { value: "wraps", label: "Wraps / Cones", prefix: "WRAP" },
  { value: "tray", label: "Rolling Tray", prefix: "TRAY" },
  { value: "battery", label: "Battery", prefix: "BATT" },
  { value: "charger", label: "Charger", prefix: "CHRG" },
  { value: "coil", label: "Coil / Atomizer", prefix: "COIL" },
  { value: "storage", label: "Storage / Jar", prefix: "STOR" },
  { value: "ashtray", label: "Ashtray", prefix: "ASHT" },
  { value: "cleaning", label: "Cleaning Supply", prefix: "CLEN" },
  { value: "apparel", label: "Apparel / Merch", prefix: "APRL" },
  { value: "other", label: "Other", prefix: "MISC" },
] as const;

export type NonCannabisType = (typeof NONCANNABIS_TYPES)[number]["value"];

const TYPE_BY_VALUE = new Map(NONCANNABIS_TYPES.map((t) => [t.value, t]));

export function nonCannabisTypeLabel(v: string): string {
  return TYPE_BY_VALUE.get(v as NonCannabisType)?.label ?? v;
}
export function nonCannabisTypePrefix(v: string): string {
  return TYPE_BY_VALUE.get(v as NonCannabisType)?.prefix ?? "MISC";
}

export type Gender = "male" | "female" | "" | null | undefined;

export type NonCannabisNameParts = {
  brand?: string | null;
  type: NonCannabisType | string;
  /** Size / joint size, e.g. "12in", "14mm", "18mm". */
  size?: string | null;
  gender?: Gender;
  color?: string | null;
};

/** Normalize a size token: keep digits + unit, e.g. "12 in" -> "12in". */
export function normalizeSize(raw?: string | null): string {
  const s = collapseWhitespace((raw ?? "").toLowerCase());
  if (!s) return "";
  // glue number + unit: "12 in" -> "12in", "14 mm" -> "14mm"
  return s
    .replace(/(\d)\s*(in|inch|inches)\b/g, "$1in")
    .replace(/(\d)\s*(mm|millimeter[s]?)\b/g, "$1mm")
    .replace(/(\d)\s*(cm)\b/g, "$1cm")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the non-cannabis display name from parts. */
export function buildNonCannabisName(parts: NonCannabisNameParts): string {
  const brand = collapseWhitespace(parts.brand ?? "");
  const typeLabel = nonCannabisTypeLabel(parts.type);
  const size = normalizeSize(parts.size);
  const gender =
    parts.gender === "male" ? "Male" : parts.gender === "female" ? "Female" : "";
  const color = collapseWhitespace(parts.color ?? "");

  const tokens = [brand, typeLabel, size, gender, color].filter(Boolean);
  let name = toTitleCase(collapseWhitespace(tokens.join(" ")));
  name = collapseWhitespace(name);
  if (name.length > NAME_MAX_LEN) name = name.slice(0, NAME_MAX_LEN).trim();
  return name;
}

/** Validate a non-cannabis name (same char/casing rules as the cannabis one). */
export function validateNonCannabisName(raw: string | null | undefined): {
  ok: boolean;
  issues: string[];
} {
  const name = (raw ?? "").trim();
  const issues: string[] = [];
  if (!name) issues.push("Name is required.");
  if (name.length > NAME_MAX_LEN) issues.push(`Name exceeds ${NAME_MAX_LEN} chars.`);
  if (DISALLOWED_NAME_CHARS.test(name)) issues.push("Contains a disallowed character.");
  if (/^[^A-Za-z0-9]/.test(name)) issues.push("Must start with a letter or number.");
  return { ok: issues.length === 0, issues };
}

/** Draft-clean a messy non-cannabis name (staff confirm). */
export function suggestNonCannabisName(raw: string | null | undefined): string {
  let s = collapseWhitespace(stripDisallowedChars((raw ?? "").trim()));
  s = s.replace(/^[^A-Za-z0-9]+/, "").trim();
  s = toTitleCase(s);
  if (s.length > NAME_MAX_LEN) s = s.slice(0, NAME_MAX_LEN).trim();
  return collapseWhitespace(s);
}

/* ------------------------------------------------------------------ *
 *  Smart SKU generation
 * ------------------------------------------------------------------ */

/** Compact an attribute token for SKU use: alnum only, upper, short. */
function skuToken(raw: string, maxLen = 4): string {
  const t = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t.slice(0, maxLen);
}

export type SkuParts = {
  type: NonCannabisType | string;
  size?: string | null;
  color?: string | null;
  gender?: Gender;
};

/**
 * Build a human-readable, deterministic SKU:
 *   {PREFIX}-{SEQ4}[-{SIZE}][-{COLOR}][-{G}]
 * The caller supplies `seq` (next sequence for this prefix) and MUST verify the
 * result doesn't already exist (collision check against stored SKUs). This
 * function is pure so it is fully testable.
 */
export function buildSku(parts: SkuParts, seq: number): string {
  const prefix = nonCannabisTypePrefix(parts.type);
  const seqStr = String(Math.max(1, Math.floor(seq))).padStart(4, "0");
  const bits = [`${prefix}-${seqStr}`];
  const size = skuToken(normalizeSize(parts.size).replace(/\s+/g, ""), 5);
  if (size) bits.push(size);
  const color = skuToken(parts.color ?? "", 4);
  if (color) bits.push(color);
  if (parts.gender === "male") bits.push("M");
  else if (parts.gender === "female") bits.push("F");
  return bits.join("-");
}

/**
 * Given a set of existing SKUs and the desired parts, return the next available
 * SKU (increments the sequence until no collision). Pure + deterministic.
 */
export function nextAvailableSku(
  parts: SkuParts,
  existing: Set<string>,
  startSeq = 1,
): string {
  let seq = Math.max(1, Math.floor(startSeq));
  // Cap the loop generously; non-cannabis catalogs are tiny.
  for (let i = 0; i < 100000; i++) {
    const sku = buildSku(parts, seq);
    if (!existing.has(sku)) return sku;
    seq += 1;
  }
  // Extremely unlikely fallback.
  return `${nonCannabisTypePrefix(parts.type)}-${Date.now()}`;
}

/**
 * Compute the next sequence for a given type prefix from existing SKUs, so SKUs
 * of the same type increment predictably (PIPE-0001, PIPE-0002, ...).
 */
export function nextSeqForType(
  type: NonCannabisType | string,
  existing: Iterable<string>,
): number {
  const prefix = nonCannabisTypePrefix(type);
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d{1,})`);
  for (const sku of existing) {
    const m = re.exec(sku);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max + 1;
}

/* ------------------------------------------------------------------ *
 *  Unit tests (tsx-runnable)
 * ------------------------------------------------------------------ */
export function __runNonCannabisTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  // name build — order is {Brand} {Type} {Size} {Gender} {Color}
  assert(
    buildNonCannabisName({ type: "bong", size: "12 in", gender: "male", color: "blue" }) ===
      "Bong 12in Male Blue",
    "bong name: " + buildNonCannabisName({ type: "bong", size: "12 in", gender: "male", color: "blue" }),
  );
  // Title Case normalizes brand casing (RAW -> Raw); acronym preservation for
  // brands is intentionally out of scope for the compliance name.
  assert(buildNonCannabisName({ brand: "RAW", type: "lighter" }) === "Raw Lighter", "raw lighter");
  assert(
    buildNonCannabisName({ brand: "Sitka", type: "tray", color: "walnut" }) === "Sitka Rolling Tray Walnut",
    "tray: " + buildNonCannabisName({ brand: "Sitka", type: "tray", color: "walnut" }),
  );
  assert(
    buildNonCannabisName({ type: "downstem", size: "18mm", gender: "female" }) === "Downstem 18mm Female",
    "downstem: " + buildNonCannabisName({ type: "downstem", size: "18mm", gender: "female" }),
  );

  // size normalize
  assert(normalizeSize("14 mm") === "14mm", "size mm");
  assert(normalizeSize("12 inches") === "12in", "size inches");

  // validate
  assert(validateNonCannabisName("12in Bong Male Blue").ok === true, "valid name");
  assert(validateNonCannabisName("- bong / blue").ok === false, "invalid name");

  // SKU
  assert(buildSku({ type: "bong", size: "12in", color: "blue", gender: "male" }, 1) === "BONG-0001-12IN-BLUE-M", "sku: " + buildSku({ type: "bong", size: "12in", color: "blue", gender: "male" }, 1));
  assert(buildSku({ type: "lighter" }, 7) === "LTR-0007", "lighter sku");
  assert(buildSku({ type: "unknown_xyz" }, 3) === "MISC-0003", "unknown type -> MISC");

  // next seq + next available (collision)
  const existing = new Set(["PIPE-0001", "PIPE-0002", "PIPE-0003-14MM"]);
  assert(nextSeqForType("pipe", existing) === 4, "next seq pipe = 4 (max seq seen = 3)");
  const seq = nextSeqForType("bong", existing);
  assert(seq === 1, "next seq bong = 1");
  const avail = nextAvailableSku({ type: "pipe" }, existing, nextSeqForType("pipe", existing));
  assert(!existing.has(avail), "next available not colliding: " + avail);

  console.log("naming/noncannabis-core: all tests passed");
}

declare const require: { main?: unknown } | undefined;
// eslint-disable-next-line @next/next/no-assign-module-variable
declare const module: unknown;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  __runNonCannabisTests();
}
