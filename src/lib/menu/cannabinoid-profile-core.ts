/**
 * src/lib/menu/cannabinoid-profile-core.ts  (R29 - ratio products)
 *
 * The owner (R29, verbatim in the PR): edibles, liquid edibles, tinctures and
 * topicals "don't use or very rarely use a strain type, and instead have
 * ratios of cannabinoids like 1:1:1:1:1 thc:cbd:cbg:cbn:cbc ... So in the
 * strain type for these products, we should show the cannabinoid and the
 * ratio" and "a product with 10 pieces, each with 10mg of each cannabinoid
 * shows on the menu as 100mg total so it's not misleading".
 *
 * ONE pure module answers, for every surface (menu card, product page,
 * register, back office, onboarding form):
 *
 *   1. normalizeRatioLabel   - the ONE canonical ratio text. Accepts every way
 *      a vendor writes it ("CBG:CBC:CBD:THC (2:2:2:1)", "2:2:2:1 cbg:cbc:cbd:thc",
 *      "1:1", "CBD:CBC:CBG") and returns numbers-first, cannabinoids
 *      upper-cased ("2:2:2:1 CBG:CBC:CBD:THC") - the order packaging and the
 *      big menus print it ("1:1 THC:CBD"). A list and a number run of
 *      DIFFERENT lengths is refused (null), never repaired.
 *   2. isRatioLedCategory    - the four website categories dosed in mg.
 *   3. ratioSlot             - what goes in the strain-type slot for them:
 *      the stated ratio, else the cannabinoids actually present (by mg,
 *      largest first), else the strain type exactly as before, else nothing.
 *   4. packageMgFromServing  - package mg = mg per serving x servings (the
 *      label arithmetic WAC 314-55-105 requires: amount per serving, number of
 *      servings, total per package).
 *   5. resolvePackageMg / servingSummary - the per-package totals the card
 *      shows and the "10 servings, each ..." line under them.
 *
 * NEVER-GUESS rules: a ratio is only ever shown when it was WRITTEN (name,
 * COA check or a person); the fallback lists cannabinoids that have a real
 * mg figure and prints no numbers between them. Per-serving figures are only
 * printed when the serving count is known, and are plain division of a
 * package total by it.
 *
 * No I/O, no React. Self-tests: __runCannabinoidProfileCoreTests (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */

/** Cannabinoids a ratio may name (same closed set as media/suggest-core RATIO_CANNABINOIDS). */
export const RATIO_NAMES = ["THC", "CBD", "CBG", "CBN", "CBC", "THCV", "CBDV", "THCA", "CBDA"] as const;
export type RatioName = (typeof RATIO_NAMES)[number];

/** Website categories whose potency is dosed in milligrams (category-taxonomy values). */
export const RATIO_LED_CATEGORIES = new Set(["edible-solid", "edible-liquid", "tincture", "topical"]);

export function isRatioLedCategory(category: string | null | undefined): boolean {
  return RATIO_LED_CATEGORIES.has(String(category ?? "").trim().toLowerCase());
}

export type RatioLabel = {
  /** Canonical text: "2:2:2:1 CBG:CBC:CBD:THC", "1:1:1" or "CBD:CBC:CBG". */
  label: string;
  /** Upper-cased cannabinoids in written order; null when only numbers were written. */
  names: RatioName[] | null;
  /** The numbers in written order; null when only cannabinoids were written. */
  parts: number[] | null;
};

const NAME_ALT = "THCV|THCA|THC|CBDV|CBDA|CBD|CBG|CBN|CBC";
const NUM = "\\d{1,3}(?:\\.\\d{1,2})?";
const NUMS_RE = new RegExp(`^(${NUM}(?:\\s*:\\s*${NUM}){1,5})$`);
const NAMES_RE = new RegExp(`^((?:${NAME_ALT})(?:\\s*:\\s*(?:${NAME_ALT})){1,5})$`, "i");

function splitNums(s: string): number[] {
  return s.split(":").map((p) => Number(p.trim()));
}

function splitNames(s: string): RatioName[] {
  return s.split(":").map((p) => p.trim().toUpperCase()) as RatioName[];
}

function fmtPart(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Compose the canonical label from its pieces; null when they cannot form an
 * honest ratio (different lengths, a duplicate cannabinoid, a zero part).
 */
export function composeRatioLabel(names: readonly string[] | null, parts: readonly number[] | null): RatioLabel | null {
  const n = names && names.length > 0 ? (names.map((x) => x.toUpperCase()) as RatioName[]) : null;
  const p = parts && parts.length > 0 ? [...parts] : null;
  if (!n && !p) return null;
  if (n) {
    if (n.length < 2 || n.length > 6) return null;
    if (!n.every((x) => (RATIO_NAMES as readonly string[]).includes(x))) return null;
    if (new Set(n).size !== n.length) return null;
  }
  if (p) {
    if (p.length < 2 || p.length > 6) return null;
    if (!p.every((x) => Number.isFinite(x) && x > 0)) return null;
  }
  if (n && p && n.length !== p.length) return null;
  const numText = p ? p.map(fmtPart).join(":") : "";
  const nameText = n ? n.join(":") : "";
  return { label: [numText, nameText].filter(Boolean).join(" "), names: n, parts: p };
}

/**
 * Normalize a ratio however it was written. Returns null for anything that is
 * not unambiguously a ratio (a dose, a percent, a lone cannabinoid, a list
 * and a number run of different lengths). Never repairs.
 */
export function normalizeRatioLabel(raw: string | null | undefined): RatioLabel | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^ratio\s*[:-]?\s*/i, "");
  if (!s || s.length > 80) return null;
  // Peel the two halves: "<A> <B>", "<A> (<B>)", "<A> - <B>", "(<A>) <B>".
  const halves = s
    .replace(/[()[\]]/g, " ")
    .replace(/\s+-\s+/g, " ")
    .trim()
    .split(/\s+(?=[\dA-Za-z])/);
  // Re-join pieces split inside "1 : 1" style spacing.
  const joined = halves.join(" ").replace(/\s*:\s*/g, ":").split(" ").filter(Boolean);
  if (joined.length === 1) {
    const only = joined[0];
    if (NUMS_RE.test(only)) return composeRatioLabel(null, splitNums(only));
    if (NAMES_RE.test(only)) return composeRatioLabel(splitNames(only), null);
    return null;
  }
  if (joined.length === 2) {
    const [a, b] = joined;
    if (NUMS_RE.test(a) && NAMES_RE.test(b)) return composeRatioLabel(splitNames(b), splitNums(a));
    if (NAMES_RE.test(a) && NUMS_RE.test(b)) return composeRatioLabel(splitNames(a), splitNums(b));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Package arithmetic
// ---------------------------------------------------------------------------

function positive(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(String(n).replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

const r2 = (n: number) => Number(n.toFixed(2));

/**
 * The canonical ratio_label for a label the NAME extractor found plus the
 * numbers written beside a cannabinoid list (coa-facts-core nameRatioParts).
 * Composes "2:2:2:1 CBG:CBC:CBD:THC" when both agree in length; otherwise the
 * normalized raw label; otherwise the raw text unchanged (never dropped, never
 * repaired - Product facts shows it to a person).
 */
export function canonicalRatioFromName(rawLabel: string, listParts: readonly number[] | null): string {
  const asWritten = normalizeRatioLabel(rawLabel);
  if (asWritten && asWritten.names && !asWritten.parts && listParts) {
    const composed = composeRatioLabel(asWritten.names, listParts);
    if (composed) return composed.label;
  }
  return asWritten?.label ?? rawLabel.trim();
}

/** Package mg = mg per serving x servings (WAC 314-55-105 label arithmetic). null when either is unknown. */
export function packageMgFromServing(mgPerServing: number | null | undefined, servings: number | null | undefined): number | null {
  const mg = positive(mgPerServing);
  const sv = positive(servings);
  if (mg === null || sv === null || !Number.isInteger(sv)) return null;
  return r2(mg * sv);
}

/** Cannabinoids the card totals, in display order (THC first - it is what the law caps). */
export const PROFILE_ORDER = ["thc", "cbd", "cbg", "cbn", "cbc", "cbdv", "thcv"] as const;
export type ProfileType = (typeof PROFILE_ORDER)[number];

export type ProfileInput = {
  category?: string | null;
  strainType?: string | null;
  ratioLabel?: string | null;
  servingsPerPack?: number | null;
  mgPerServing?: number | null;
  packageThcMg?: number | null;
  packageCbdMg?: number | null;
  totalThc?: { value: string | null; unit: string } | null;
  totalCbd?: { value: string | null; unit: string } | null;
  compounds?: readonly { type: string; value: string | null; unit: string }[] | null;
};

const isEstimate = (v: unknown) => typeof v === "string" && v.includes("~");

/**
 * The per-PACKAGE mg of every cannabinoid this product has a real figure for.
 * THC / CBD: the structured package column (verified by the engine, the COA or
 * set by a person) outranks the display JSON - the display JSON is what the
 * pre-R29 intake filled with lab PERCENTS ("0.12 mg"). Minors: compounds_json
 * mg rows. Percent rows and "~" estimates are never counted as mg.
 */
export function resolvePackageMg(item: ProfileInput): { type: ProfileType; mg: number }[] {
  const out: { type: ProfileType; mg: number }[] = [];
  const fromJson = (c: { value: string | null; unit: string } | null | undefined) =>
    c && c.unit === "mg" && !isEstimate(c.value) ? positive(c.value) : null;
  const compounds = item.compounds ?? [];
  const compoundMg = (t: string) => {
    const c = compounds.find((x) => String(x.type).toLowerCase() === t);
    return c ? fromJson(c) : null;
  };
  for (const t of PROFILE_ORDER) {
    let mg: number | null = null;
    if (t === "thc") mg = positive(item.packageThcMg) ?? fromJson(item.totalThc) ?? compoundMg("thc");
    else if (t === "cbd") mg = positive(item.packageCbdMg) ?? fromJson(item.totalCbd) ?? compoundMg("cbd");
    else mg = compoundMg(t);
    if (mg !== null) out.push({ type: t, mg: r2(mg) });
  }
  return out;
}

function fmtMg(n: number): string {
  return `${String(r2(n))} mg`;
}

/**
 * "10 servings · each 5.5 mg THC · 10 mg CBD · 10 mg CBG · 9.5 mg CBC" - only
 * when the serving count is known and greater than one. THC per serving is the
 * stored mg_per_serving when present; every other figure is its package total
 * divided by the serving count (arithmetic, not an estimate).
 */
export function servingSummary(item: ProfileInput): string | null {
  const servings = positive(item.servingsPerPack);
  if (servings === null || servings <= 1 || !Number.isInteger(servings)) return null;
  const totals = resolvePackageMg(item);
  if (totals.length === 0) return null;
  const each = totals.map(({ type, mg }) => {
    const per = type === "thc" && positive(item.mgPerServing) !== null ? (item.mgPerServing as number) : mg / servings;
    return `${fmtMg(per)} ${type.toUpperCase()}`;
  });
  return `${servings} servings · each ${each.join(" · ")}`;
}

export type RatioSlot =
  /** A written ratio: "2:2:2:1 CBG:CBC:CBD:THC". */
  | { kind: "ratio"; text: string; title: string }
  /** No written ratio, 2+ cannabinoids with mg: "CBD · CBG · CBC · THC" (largest first, no numbers). */
  | { kind: "cannabinoids"; text: string; title: string }
  /** Not a ratio product (or nothing to say): the caller shows the strain type as before. */
  | { kind: "strain" };

/**
 * What the strain-type slot shows. Ratio-led categories show the ratio, else
 * the cannabinoids present; everything else (and a single-cannabinoid
 * edible) keeps the strain type exactly as before R29.
 */
export function ratioSlot(item: ProfileInput): RatioSlot {
  if (!isRatioLedCategory(item.category)) return { kind: "strain" };
  const ratio = normalizeRatioLabel(item.ratioLabel);
  if (ratio) {
    const text = ratio.parts ? ratio.label : ratio.label;
    const title =
      ratio.names && ratio.parts
        ? `Cannabinoid ratio ${ratio.names.map((n, i) => `${n} ${fmtPart(ratio.parts![i])}`).join(" : ")}`
        : ratio.names
          ? `Cannabinoids ${ratio.names.join(", ")}`
          : `Cannabinoid ratio ${ratio.label}`;
    return { kind: "ratio", text: ratio.parts && !ratio.names ? `${text} ratio` : text, title };
  }
  const totals = resolvePackageMg(item);
  if (totals.length >= 2) {
    const ordered = [...totals].sort((a, b) => b.mg - a.mg || PROFILE_ORDER.indexOf(a.type) - PROFILE_ORDER.indexOf(b.type));
    const names = ordered.map((t) => t.type.toUpperCase());
    return { kind: "cannabinoids", text: names.join(" · "), title: `Contains ${names.join(", ")}` };
  }
  return { kind: "strain" };
}

// ---------------------------------------------------------------------------
// Onboarding facts: minor cannabinoids (CBG / CBN / CBC) and ratio checks
// ---------------------------------------------------------------------------

/**
 * The minor cannabinoids the Product facts form sets per package. They have
 * no scalar columns: their homes are the EXISTING arrays (migration 0138)
 * menu_items.compounds_json and inventory_lots.minor_cannabinoids_json, as
 * {type, value, unit:"mg"} rows - the shape the card, the register and the
 * lot page already read. No migration.
 */
export const MINOR_FACT_TYPES = { packageCbgMg: "cbg", packageCbnMg: "cbn", packageCbcMg: "cbc" } as const;
export type MinorFactKey = keyof typeof MINOR_FACT_TYPES;
export type MinorType = (typeof MINOR_FACT_TYPES)[MinorFactKey];
export const MINOR_FACT_KEYS = Object.keys(MINOR_FACT_TYPES) as MinorFactKey[];

export function isMinorFactKey(k: string): k is MinorFactKey {
  return Object.prototype.hasOwnProperty.call(MINOR_FACT_TYPES, k);
}

type CompoundRow = { type: string; value: string; unit: string };

function compoundRows(json: unknown): CompoundRow[] {
  if (!Array.isArray(json)) return [];
  const out: CompoundRow[] = [];
  for (const c of json) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.type !== "string" || typeof o.unit !== "string") continue;
    const v = o.value === null || o.value === undefined ? "" : String(o.value);
    out.push({ type: o.type, value: v, unit: o.unit });
  }
  return out;
}

/**
 * Merge person-set package mg for CBG / CBN / CBC into an existing compound
 * array. A number > 0 replaces that cannabinoid's mg row (any mg row of the
 * same type); null or 0 removes it (a person clearing a wrong value); a key
 * that is absent leaves the row alone. Percent rows and every other
 * cannabinoid are kept untouched and in order; new rows are appended in
 * CBG, CBN, CBC order. Pure - returns a new array.
 */
export function mergeMinorMg(existing: unknown, patch: Partial<Record<MinorFactKey, number | null>>): CompoundRow[] {
  let rows = compoundRows(existing);
  for (const key of MINOR_FACT_KEYS) {
    if (!(key in patch)) continue;
    const type = MINOR_FACT_TYPES[key];
    const v = patch[key];
    rows = rows.filter((r) => !(r.type.toLowerCase() === type && r.unit === "mg"));
    if (typeof v === "number" && Number.isFinite(v) && v > 0) rows.push({ type, value: String(r2(v)), unit: "mg" });
  }
  return rows;
}

/** The package mg a compound array states for CBG / CBN / CBC (mg rows only; null when absent). */
export function minorMgFromCompounds(json: unknown): Record<MinorFactKey, number | null> {
  const rows = compoundRows(json);
  const out = { packageCbgMg: null, packageCbnMg: null, packageCbcMg: null } as Record<MinorFactKey, number | null>;
  for (const key of MINOR_FACT_KEYS) {
    const row = rows.find((r) => r.type.toLowerCase() === MINOR_FACT_TYPES[key] && r.unit === "mg" && !isEstimate(r.value));
    out[key] = row ? positive(row.value) : null;
  }
  return out;
}

/**
 * Does a written ratio agree with the package mg a person typed beside it?
 * Each named cannabinoid's mg is divided by its ratio part; the per-part
 * amounts must agree within `tolerance` (20% - labels round, and lab-measured
 * totals drift from the nominal ratio, e.g. Bytes Sour Mandarin 2:2:2:1 with
 * THC 55 / CBD 100 / CBG 100 / CBC 95 is 10% apart and correct). Checked only
 * when the ratio has numbers AND names AND at least two named cannabinoids
 * have mg; otherwise there is nothing to compare (null = no opinion).
 * Returns a plain-English disagreement, or null when they agree.
 */
export function ratioMgDisagreement(
  ratioRaw: string | null | undefined,
  mgByType: Partial<Record<string, number | null>>,
  tolerance = 0.2,
): string | null {
  const ratio = normalizeRatioLabel(ratioRaw);
  if (!ratio || !ratio.names || !ratio.parts) return null;
  const pairs: { name: string; part: number; mg: number }[] = [];
  ratio.names.forEach((n, i) => {
    const mg = positive(mgByType[n.toLowerCase()]);
    if (mg !== null) pairs.push({ name: n, part: ratio.parts![i], mg });
  });
  if (pairs.length < 2) return null;
  const perPart = pairs.map((p) => p.mg / p.part);
  const max = Math.max(...perPart);
  const min = Math.min(...perPart);
  if ((max - min) / max <= tolerance) return null;
  const typed = pairs.map((p) => `${String(r2(p.mg))} mg ${p.name}`).join(", ");
  return `The ratio ${ratio.label} does not match the amounts entered (${typed}). Check the label and correct the ratio or the mg.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCannabinoidProfileCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`cannabinoid-profile-core self-test failed: ${m}`);
    passed += 1;
  };
  const lab = (s: string | null | undefined) => normalizeRatioLabel(s)?.label ?? null;

  // Every way the real fixtures / vendors write it.
  ok(lab("CBG:CBC:CBD:THC (2:2:2:1)") === "2:2:2:1 CBG:CBC:CBD:THC", "list (parts)");
  ok(lab("2:2:2:1 cbg:cbc:cbd:thc") === "2:2:2:1 CBG:CBC:CBD:THC", "parts list, lower case");
  ok(lab("1:1:1:1:1 thc:cbd:cbg:cbn:cbc") === "1:1:1:1:1 THC:CBD:CBG:CBN:CBC", "owner's five-way example");
  ok(lab("CBD:THC (5:1)") === "5:1 CBD:THC", "5:1");
  ok(lab("1 : 1  THC : CBD") === "1:1 THC:CBD", "spaced");
  ok(lab("[3:1] CBG:THC") === "3:1 CBG:THC", "bracketed parts first");
  ok(lab("CBG:THC - 3:1") === "3:1 CBG:THC", "dash separated");
  ok(lab("Ratio: 1:1") === "1:1", "numbers only");
  ok(lab("CBD:CBC:CBG") === "CBD:CBC:CBG", "list only (Cantina)");
  ok(lab("1:0.5 THC:CBD") === "1:0.5 THC:CBD", "decimal part");
  // Refusals - never repaired.
  ok(lab("CBG:THC (2:2:1)") === null, "length mismatch refused");
  ok(lab("THC:THC 1:1") === null, "duplicate cannabinoid refused");
  ok(lab("1:0 THC:CBD") === null, "zero part refused");
  ok(lab("100mg") === null && lab("THC") === null && lab("21%") === null, "doses / lone names refused");
  ok(lab("") === null && lab(null) === null && lab(undefined) === null, "blank");
  ok(lab("XYZ:THC 1:1") === null, "unknown cannabinoid refused");
  ok(lab("1:1:1:1:1:1:1 THC:CBD:CBG:CBN:CBC:CBDV:THCV") === null, "more than six refused");
  ok(normalizeRatioLabel("2:2:2:1 CBG:CBC:CBD:THC")?.parts?.join(",") === "2,2,2,1", "parts kept");
  ok(normalizeRatioLabel("2:2:2:1 CBG:CBC:CBD:THC")?.names?.join(",") === "CBG,CBC,CBD,THC", "names kept");
  ok(lab(lab("CBG:CBC:CBD:THC (2:2:2:1)")) === "2:2:2:1 CBG:CBC:CBD:THC", "idempotent");
  ok(composeRatioLabel(["cbd", "thc"], [5, 1])?.label === "5:1 CBD:THC", "compose");
  ok(composeRatioLabel(["CBD"], null) === null, "compose lone name refused");
  ok(canonicalRatioFromName("CBG:CBC:CBD:THC", [2, 2, 2, 1]) === "2:2:2:1 CBG:CBC:CBD:THC", "name list + written parts");
  ok(canonicalRatioFromName("CBN:THC", null) === "CBN:THC", "list without parts stays a list");
  ok(canonicalRatioFromName("CBG:THC", [2, 2, 1]) === "CBG:THC", "mismatched parts are not glued on");
  ok(canonicalRatioFromName("1:1:1", null) === "1:1:1", "numbers-only label kept");
  ok(canonicalRatioFromName("cbd:thc", [5, 1]) === "5:1 CBD:THC", "lower-case list upper-cased");

  ok(isRatioLedCategory("edible-solid") && isRatioLedCategory("edible-liquid") && isRatioLedCategory("tincture") && isRatioLedCategory("topical"), "four mg categories");
  ok(!isRatioLedCategory("flower") && !isRatioLedCategory("cartridge") && !isRatioLedCategory(null), "others are not ratio-led");

  // The owner's arithmetic: 10 pieces x 10 mg = 100 mg.
  ok(packageMgFromServing(10, 10) === 100, "10 x 10 = 100");
  ok(packageMgFromServing(5.5, 10) === 55 && packageMgFromServing(9.5, 10) === 95, "decimals");
  ok(packageMgFromServing(10, null) === null && packageMgFromServing(null, 10) === null, "unknown -> null");
  ok(packageMgFromServing(10, 2.5) === null, "fractional servings refused");
  ok(packageMgFromServing(0, 10) === null, "zero dose -> null");

  // Bytes Sour Mandarin with its COA facts.
  const sour: ProfileInput = {
    category: "edible-solid",
    strainType: "unknown",
    ratioLabel: "2:2:2:1 CBG:CBC:CBD:THC",
    servingsPerPack: 10,
    mgPerServing: 5.5,
    packageThcMg: 55,
    packageCbdMg: 100,
    totalThc: { value: "55", unit: "mg" },
    totalCbd: { value: "100", unit: "mg" },
    compounds: [
      { type: "thc", value: "55", unit: "mg" },
      { type: "cbd", value: "100", unit: "mg" },
      { type: "cbg", value: "100", unit: "mg" },
      { type: "cbc", value: "95", unit: "mg" },
    ],
  };
  ok(JSON.stringify(resolvePackageMg(sour)) === JSON.stringify([{ type: "thc", mg: 55 }, { type: "cbd", mg: 100 }, { type: "cbg", mg: 100 }, { type: "cbc", mg: 95 }]), "package totals");
  ok(servingSummary(sour) === "10 servings · each 5.5 mg THC · 10 mg CBD · 10 mg CBG · 9.5 mg CBC", "serving summary");
  const slot = ratioSlot(sour);
  ok(slot.kind === "ratio" && slot.text === "2:2:2:1 CBG:CBC:CBD:THC", "ratio in the strain slot");
  ok(slot.kind === "ratio" && slot.title === "Cannabinoid ratio CBG 2 : CBC 2 : CBD 2 : THC 1", "accessible title");

  // The pre-R29 bug row: a lab PERCENT stored as mg must not out-rank the package column.
  const stale: ProfileInput = { ...sour, totalThc: { value: "0.12", unit: "mg" } };
  ok(resolvePackageMg(stale)[0].mg === 55, "package column outranks the display JSON");
  // Percent rows / estimates never count as mg.
  ok(resolvePackageMg({ category: "flower", totalThc: { value: "22", unit: "%" } }).length === 0, "percent not mg");
  ok(resolvePackageMg({ category: "edible-solid", totalThc: { value: "~10", unit: "mg" } }).length === 0, "estimate not mg");

  // No written ratio: list the cannabinoids present, largest first, no numbers.
  const noRatio = ratioSlot({ ...sour, ratioLabel: null });
  ok(noRatio.kind === "cannabinoids" && noRatio.text === "CBD · CBG · CBC · THC", "fallback list by mg (ties THC-order)");
  // Single cannabinoid edible / flower keep the strain type.
  ok(ratioSlot({ category: "edible-solid", packageThcMg: 100, strainType: "indica" }).kind === "strain", "THC-only edible keeps strain");
  ok(ratioSlot({ category: "flower", ratioLabel: "1:1 THC:CBD" }).kind === "strain", "flower keeps strain even with a ratio");
  const numeric = ratioSlot({ category: "tincture", ratioLabel: "1:1:1" });
  ok(numeric.kind === "ratio" && numeric.text === "1:1:1 ratio", "numbers-only ratio says ratio");
  ok(servingSummary({ ...sour, servingsPerPack: 1 }) === null && servingSummary({ ...sour, servingsPerPack: null }) === null, "no summary without servings");
  ok(servingSummary({ ...sour, mgPerServing: null }) === "10 servings · each 5.5 mg THC · 10 mg CBD · 10 mg CBG · 9.5 mg CBC", "THC per serving by division when column absent");

  // Onboarding minors: merge into the existing arrays, never clobber.
  const base = [
    { type: "thc", value: "55", unit: "mg" },
    { type: "cbg", value: "1.2", unit: "%" },
    { type: "cbn", value: "5", unit: "mg" },
  ];
  const merged = mergeMinorMg(base, { packageCbgMg: 100, packageCbnMg: null, packageCbcMg: 95 });
  ok(JSON.stringify(merged) === JSON.stringify([
    { type: "thc", value: "55", unit: "mg" },
    { type: "cbg", value: "1.2", unit: "%" },
    { type: "cbg", value: "100", unit: "mg" },
    { type: "cbc", value: "95", unit: "mg" },
  ]), "minor merge: set CBG/CBC, clear CBN, keep THC and the % row");
  ok(JSON.stringify(mergeMinorMg(base, {})) === JSON.stringify(base), "minor merge: absent keys leave the array alone");
  ok(mergeMinorMg(null, { packageCbgMg: 0 }).length === 0, "minor merge: 0 is a clear, never a 0 mg row");
  ok(mergeMinorMg(base, { packageCbnMg: 10 }).filter((r) => r.type === "cbn").length === 1, "minor merge: replaces, never duplicates");
  ok(base.length === 3 && base[2].value === "5", "minor merge: input untouched");
  ok(JSON.stringify(minorMgFromCompounds(merged)) === JSON.stringify({ packageCbgMg: 100, packageCbnMg: null, packageCbcMg: 95 }), "minor read: mg rows only");
  ok(minorMgFromCompounds([{ type: "cbg", value: "~3", unit: "mg" }]).packageCbgMg === null, "minor read: estimate ignored");
  ok(isMinorFactKey("packageCbgMg") && !isMinorFactKey("packageThcMg") && !isMinorFactKey("toString"), "minor key guard");
  // Ratio vs typed mg.
  ok(ratioMgDisagreement("2:2:2:1 CBG:CBC:CBD:THC", { thc: 55, cbd: 100, cbg: 100, cbc: 95 }) === null, "Sour Mandarin agrees within tolerance");
  ok(ratioMgDisagreement("1:1:1:1:1 THC:CBD:CBG:CBN:CBC", { thc: 100, cbd: 100, cbg: 100, cbn: 100, cbc: 100 }) === null, "owner five-way agrees");
  const bad = ratioMgDisagreement("2:1 THC:CBD", { thc: 100, cbd: 100 });
  ok(bad !== null && bad.includes("2:1 THC:CBD") && bad.includes("100 mg THC"), "2:1 vs 100/100 refused with the numbers");
  ok(ratioMgDisagreement("1:1", { thc: 100, cbd: 5 }) === null, "numbers-only ratio: nothing to compare");
  ok(ratioMgDisagreement("CBD:THC", { thc: 100, cbd: 5 }) === null, "list-only ratio: nothing to compare");
  ok(ratioMgDisagreement("1:1 THC:CBD", { thc: 100 }) === null, "one cannabinoid: nothing to compare");

  return { passed, failed: 0 };
}
