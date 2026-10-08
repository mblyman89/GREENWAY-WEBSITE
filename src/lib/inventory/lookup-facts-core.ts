/**
 * src/lib/inventory/lookup-facts-core.ts  (S06: structured, per-field, cited lookup)
 *
 * PURE CORE for the AI lookup's schema v2. It has no network access, no
 * server-only imports and no compliance import, so it is registered in the
 * pure self-test runner. Compliance gating of the text fields happens one
 * layer up (product-lookup-core `gateLookupFacts`), because the compliance
 * engine is server-only.
 *
 * WHY (bible S06; findings F-021, F-022, F-023, F-018):
 *   v1 asked the model for a flat record with ONE strain-type confidence and
 *   told it to FOLD THC/CBD %, terpenes, grower and awards into the description
 *   prose (F-022). A per-field 90% policy was impossible (F-023), and the extra
 *   facts were trapped inside prose (F-021).
 *   v2 asks for EVERY field as `{ value, confidence 0-100, sources: url[] }`,
 *   and grades each field on its OWN confidence:
 *       auto    >= 90   (LOOKUP_FACT_AUTO_MIN_CONFIDENCE, the house 90% bar)
 *       review  60..89
 *       reject  < 60
 *       unknown  the field is missing, or has no confidence of its own. It is
 *                never auto.
 *   The OVERALL confidence never lifts a field. A field with no confidence of
 *   its own is never auto-eligible (S06 acceptance).
 *
 * WHAT THIS MODULE OWNS:
 *   - The v2 field vocabulary (LOOKUP_FIELD_KEYS), with a strict validator
 *     per field. Invalid means missing. Nothing is coerced into a guess.
 *   - parseLookupV2: decides whether a parsed reply IS v2. If not, the caller
 *     falls back to the v1 parser (S06 rollback).
 *   - normalizeLookup: raw v2 -> LookupFacts, with bands, declared sources,
 *     and grounded citations mapped to a field by cited span.
 *   - mapCitationsToFields: a url_citation whose cited text lies inside exactly
 *     ONE top-level field's JSON value is attached to that field. Anything else
 *     (no span, ambiguous, outside the JSON) is attached to the whole record.
 *   - The v2 prompts (system + user + shape hint).
 *   - factsToV1Raw: derives the legacy flat record, so every existing consumer
 *     (worksheet, save actions, KB draft) keeps working unchanged.
 *   - suggestionConfidence: per-field confidence for staged suggestions (F-018).
 *   - The LOOKUP_SCHEMA_V2 rollback switch.
 */

import { STRAIN_TYPE_AUTO_MIN_CONFIDENCE } from "@/lib/inventory/strain-type-intel-core";
import { strainTypeValues } from "@/lib/menu/strain-taxonomy";
import { INVENTORY_TYPE_CATALOG, inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";
import type { WebCitation } from "@/lib/ai/grounding-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";

// ---------------------------------------------------------------------------
// 1. Bands
// ---------------------------------------------------------------------------

/** The house 90% bar. It equals LOOKUP_AUTO_MIN_CONFIDENCE, and a test pins that. */
export const LOOKUP_FACT_AUTO_MIN_CONFIDENCE = STRAIN_TYPE_AUTO_MIN_CONFIDENCE; // 90
/** Below this the model's own confidence is too thin to even suggest. */
export const LOOKUP_FACT_REVIEW_MIN_CONFIDENCE = 60;

export type ConfidenceBand = "auto" | "review" | "reject" | "unknown";

/**
 * Band for a 0-100 confidence. A missing or invalid confidence is `unknown`,
 * never auto. The value is compared RAW, with no rounding, so 89.9 stays in
 * review.
 */
export function confidenceBand(conf: number | null | undefined): ConfidenceBand {
  if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 100) return "unknown";
  if (conf >= LOOKUP_FACT_AUTO_MIN_CONFIDENCE) return "auto";
  if (conf >= LOOKUP_FACT_REVIEW_MIN_CONFIDENCE) return "review";
  return "reject";
}

/**
 * Parse a model confidence on the v2 0-100 scale. Accepts a finite number or
 * a plain numeric string ("95", "95%"). Anything outside 0..100 is null.
 * A 0..1 fraction is NOT rescaled, because 1 could mean 1% or 100%. It stays
 * on the 0-100 scale, which puts it in the reject band. That is safe: it can
 * never be auto.
 */
export function parseConfidence(raw: unknown): number | null {
  let n: number | null = null;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
    if (m) n = Number(m[1]);
  }
  if (n === null || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

// ---------------------------------------------------------------------------
// 2. Field vocabulary + strict validators
// ---------------------------------------------------------------------------

export type Terpene = { name: string; pct: number | null };
export type Cannabinoids = {
  thc_pct: number | null;
  cbd_pct: number | null;
  cbg_pct: number | null;
  thca_pct: number | null;
  ratio: string | null;
};
export type NetSize = { amount: number; uom: string };
export type Servings = { count: number | null; mg_each: number | null };

/** The value type of each v2 field. */
export type LookupFieldValues = {
  strain_name: string;
  strain_type: GreenwayStrainType;
  lineage: string;
  summary: string;
  description: string;
  short_description: string;
  effects: string[];
  aroma: string[];
  flavor: string[];
  terpenes: Terpene[];
  cannabinoids: Cannabinoids;
  category: string;
  house_type: string;
  size: NetSize;
  servings: Servings;
  ingredients: string[];
  allergens: string[];
  producer: string;
  brand_description: string;
  awards: string[];
  images: string[];
};

export type LookupFieldKey = keyof LookupFieldValues;

/**
 * Every v2 field, in display order. The spec list, plus `summary`. `summary`
 * is the v1 strain summary that kb_strains drafts save. Keeping it avoids a
 * regression in "Save selected".
 */
export const LOOKUP_FIELD_KEYS: readonly LookupFieldKey[] = [
  "strain_name",
  "strain_type",
  "lineage",
  "category",
  "house_type",
  "producer",
  "summary",
  "description",
  "short_description",
  "effects",
  "aroma",
  "flavor",
  "terpenes",
  "cannabinoids",
  "size",
  "servings",
  "ingredients",
  "allergens",
  "brand_description",
  "awards",
  "images",
] as const;

/** Plain-English labels for the panel (one per field, pinned by a test). */
export const LOOKUP_FIELD_LABELS: Record<LookupFieldKey, string> = {
  strain_name: "Strain name",
  strain_type: "Strain type",
  lineage: "Lineage",
  category: "Category",
  house_type: "House type",
  producer: "Producer / grower",
  summary: "Summary",
  description: "Description",
  short_description: "Short line",
  effects: "Vibe / effects",
  aroma: "Aroma",
  flavor: "Flavor",
  terpenes: "Terpenes",
  cannabinoids: "Cannabinoids",
  size: "Net size",
  servings: "Servings",
  ingredients: "Ingredients",
  allergens: "Allergens",
  brand_description: "Brand description",
  awards: "Awards",
  images: "Images",
};

const MAX_LIST_ITEMS = 25;
const MAX_SOURCES_PER_FIELD = 5;
const MAX_IMAGES = 12;
const MAX_TERPENES = 12;

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function text(max: number) {
  return (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    return t.length > max ? t.slice(0, max).trimEnd() : t;
  };
}

/** Strict pct parse: number or "22" / "22%" / "22.5 %", within [min, 100]. */
function pct(v: unknown, allowZero: boolean): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
    if (m) n = Number(m[1]);
  }
  if (n === null || !Number.isFinite(n) || n > 100) return null;
  if (allowZero ? n < 0 : n <= 0) return null;
  return n;
}

/** Strict positive number (or numeric string) up to `max`. */
function posNum(v: unknown, max: number): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(v)) n = Number(v);
  if (n === null || !Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
}

function list(maxLen: number) {
  return (v: unknown): string[] | null => {
    const items: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (typeof it !== "string") continue;
      const t = it.trim();
      if (!t || t.length > maxLen) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= MAX_LIST_ITEMS) break;
    }
    return out.length ? out : null;
  };
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
  return u.toString();
}

function urlList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const u = httpUrl(it);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

const STRAIN_TYPES_KNOWN = new Set<string>(strainTypeValues.filter((v) => v !== "unknown"));
const HOUSE_TYPE_BY_KEY = new Map<string, string>(
  INVENTORY_TYPE_CATALOG.map((e) => [inventoryTypeKey(e.label), e.label]),
);

/** Net-size units we accept, with their spellings. Anything else is missing. */
const UOM_ALIASES: Record<string, string> = {
  g: "g", gram: "g", grams: "g", gr: "g",
  mg: "mg", milligram: "mg", milligrams: "mg",
  kg: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  "fl oz": "fl oz", "fl. oz": "fl oz", "fl.oz": "fl oz", floz: "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  ct: "ct", count: "ct", pcs: "ct", pieces: "ct", piece: "ct",
  pk: "pk", pack: "pk", "pack of": "pk",
};

type Validator<K extends LookupFieldKey> = (v: unknown) => LookupFieldValues[K] | null;

const VALIDATORS: { [K in LookupFieldKey]: Validator<K> } = {
  strain_name: text(120),
  strain_type: (v) => {
    if (typeof v !== "string") return null;
    const t = v.trim().toLowerCase().replace(/\s+/g, "-");
    return STRAIN_TYPES_KNOWN.has(t) ? (t as GreenwayStrainType) : null;
  },
  lineage: text(300),
  summary: text(1200),
  description: text(4000),
  short_description: text(200),
  effects: list(40),
  aroma: list(40),
  flavor: list(40),
  terpenes: (v) => {
    if (!Array.isArray(v)) return null;
    const out: Terpene[] = [];
    const seen = new Set<string>();
    for (const it of v) {
      const name = typeof it === "string" ? it.trim() : isObj(it) && typeof it.name === "string" ? it.name.trim() : "";
      if (!name || name.length > 40) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name, pct: isObj(it) ? pct(it.pct, false) : null });
      if (out.length >= MAX_TERPENES) break;
    }
    return out.length ? out : null;
  },
  cannabinoids: (v) => {
    if (!isObj(v)) return null;
    const ratioRaw = typeof v.ratio === "string" ? v.ratio.match(/\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)+/) : null;
    const c: Cannabinoids = {
      thc_pct: pct(v.thc_pct, true),
      cbd_pct: pct(v.cbd_pct, true),
      cbg_pct: pct(v.cbg_pct, true),
      thca_pct: pct(v.thca_pct, true),
      ratio: ratioRaw ? ratioRaw[0] : null,
    };
    return c.thc_pct === null && c.cbd_pct === null && c.cbg_pct === null && c.thca_pct === null && c.ratio === null
      ? null
      : c;
  },
  category: (v) => {
    const t = text(40)(v);
    return t ? t.toLowerCase() : null;
  },
  house_type: (v) => (typeof v === "string" ? HOUSE_TYPE_BY_KEY.get(inventoryTypeKey(v)) ?? null : null),
  size: (v) => {
    if (!isObj(v)) return null;
    const amount = posNum(v.amount, 10_000);
    const uomRaw = typeof v.uom === "string" ? v.uom.trim().toLowerCase().replace(/\s+/g, " ") : "";
    const uom = UOM_ALIASES[uomRaw];
    return amount !== null && uom ? { amount, uom } : null;
  },
  servings: (v) => {
    if (!isObj(v)) return null;
    const count = posNum(v.count, 1000);
    const s: Servings = {
      count: count !== null && Number.isInteger(count) ? count : null,
      mg_each: posNum(v.mg_each, 1000),
    };
    return s.count === null && s.mg_each === null ? null : s;
  },
  ingredients: list(120),
  allergens: list(60),
  producer: text(160),
  brand_description: text(2000),
  awards: list(200),
  images: (v) => {
    const u = urlList(v, MAX_IMAGES);
    return u.length ? u : null;
  },
};

// ---------------------------------------------------------------------------
// 3. Raw v2 + parse (with v1 fallback decision)
// ---------------------------------------------------------------------------

/** The schema marker the v2 shape hint asks the model to echo. */
export const LOOKUP_V2_SCHEMA_ID = "lookup.v2";

/** One raw v2 field as the model emits it. */
export type RawLookupField = { value?: unknown; confidence?: unknown; sources?: unknown };

/** The raw v2 record: every field optional. */
export type RawLookupV2 = {
  schema?: unknown;
  found?: unknown;
  overall_confidence?: unknown;
} & Partial<Record<LookupFieldKey, RawLookupField | unknown>>;

/**
 * Is this parsed reply a v2 record? It is when at least one known field is a
 * `{value|confidence}` object, OR when the reply carries the v2 schema marker
 * and no v1-style bare values. A marked reply with nothing in it is the
 * honest v2 miss.
 * Returns null otherwise, and the caller falls back to the v1 parser.
 */
export function parseLookupV2(parsed: unknown): RawLookupV2 | null {
  if (!isObj(parsed)) return null;
  let fieldObjs = 0;
  let barePrimitives = 0;
  for (const k of LOOKUP_FIELD_KEYS) {
    const f = parsed[k];
    if (isObj(f) && ("value" in f || "confidence" in f)) fieldObjs += 1;
    else if (typeof f === "string" && f.trim()) barePrimitives += 1;
  }
  if (fieldObjs > 0) return parsed as RawLookupV2;
  if (parsed.schema === LOOKUP_V2_SCHEMA_ID && barePrimitives === 0) return parsed as RawLookupV2;
  return null;
}

// ---------------------------------------------------------------------------
// 4. Normalized facts
// ---------------------------------------------------------------------------

export type LookupFact<T> = {
  /** Validated value, or null when missing/invalid/withheld. */
  value: T | null;
  /** The model's OWN confidence for this field (0-100), or null. */
  confidence: number | null;
  /** Band from the field's own confidence. `unknown` when value is null. */
  band: ConfidenceBand;
  /** Source URLs the model declared for this field (http(s), deduped). */
  sources: string[];
  /** Grounded url_citation URLs whose cited span lies inside this field. */
  cited: string[];
  /** Why a value was withheld (e.g. "compliance"), when it was. */
  withheld?: string;
};

export type LookupFactsFields = { [K in LookupFieldKey]: LookupFact<LookupFieldValues[K]> };

export type LookupFacts = {
  schema: "v2";
  /** The model said it located the product. Strict: only `true` counts. */
  found: boolean;
  /** Overall confidence 0-100 (display only; NEVER lifts a field). */
  overallConfidence: number | null;
  fields: LookupFactsFields;
  /** Grounded citation URLs that could not be tied to one field. */
  recordCitations: string[];
  /** Field count per band (for the audit + headline). */
  counts: Record<ConfidenceBand, number>;
  /** Effects the compliance gate removed (filled by the server gate). */
  rejectedEffects: { effect: string; reason: string }[];
};

/** A missing field. */
export function unknownFact<T>(): LookupFact<T> {
  return { value: null, confidence: null, band: "unknown", sources: [], cited: [] };
}

/** True only when the field has a value AND its OWN confidence is >= 90. */
export function isAutoEligible(fact: LookupFact<unknown>): boolean {
  return fact.value !== null && fact.confidence !== null && confidenceBand(fact.confidence) === "auto";
}

function buildFact<K extends LookupFieldKey>(key: K, rawField: unknown): LookupFact<LookupFieldValues[K]> {
  if (rawField === undefined || rawField === null) return unknownFact();
  let rawValue: unknown;
  let conf: number | null = null;
  let sources: string[] = [];
  if (isObj(rawField) && ("value" in rawField || "confidence" in rawField || "sources" in rawField)) {
    rawValue = rawField.value;
    conf = parseConfidence(rawField.confidence);
    sources = urlList(rawField.sources, MAX_SOURCES_PER_FIELD);
  } else {
    // A bare value (no confidence of its own) is shown, but it can never be auto.
    rawValue = rawField;
  }
  const value = rawValue === null || rawValue === undefined ? null : VALIDATORS[key](rawValue);
  if (value === null) return { value: null, confidence: conf, band: "unknown", sources, cited: [] };
  return { value, confidence: conf, band: confidenceBand(conf), sources, cited: [] };
}

/** Recount the bands (after normalization or after the compliance gate). */
export function countBands(fields: LookupFactsFields): Record<ConfidenceBand, number> {
  const counts: Record<ConfidenceBand, number> = { auto: 0, review: 0, reject: 0, unknown: 0 };
  for (const k of LOOKUP_FIELD_KEYS) counts[fields[k].band] += 1;
  return counts;
}

/**
 * raw v2 -> LookupFacts. `text` is the model's full reply text and
 * `citations` are the provider's url_citation annotations, both optional.
 * With them, citations are mapped to fields by cited span.
 */
export function normalizeLookup(
  raw: RawLookupV2,
  opts: { text?: string; citations?: readonly WebCitation[] } = {},
): LookupFacts {
  const r = (isObj(raw) ? raw : {}) as Record<string, unknown>;
  const fields = {} as Record<LookupFieldKey, LookupFact<unknown>>;
  for (const k of LOOKUP_FIELD_KEYS) fields[k] = buildFact(k, r[k]);
  const typed = fields as LookupFactsFields;

  const mapped = mapCitationsToFields(opts.text ?? "", opts.citations ?? []);
  const record = new Set<string>(mapped.record);
  for (const k of LOOKUP_FIELD_KEYS) {
    const urls = mapped.byField[k] ?? [];
    if (!urls.length) continue;
    // A citation on a field we withheld (invalid value) is record-level.
    if (typed[k].value === null) urls.forEach((u) => record.add(u));
    else typed[k].cited = urls;
  }

  return {
    schema: "v2",
    found: r.found === true,
    overallConfidence: parseConfidence(r.overall_confidence),
    fields: typed,
    recordCitations: [...record],
    counts: countBands(typed),
    rejectedEffects: [],
  };
}

// ---------------------------------------------------------------------------
// 5. Citation span -> field mapping
// ---------------------------------------------------------------------------

/**
 * Locate each TOP-LEVEL key's value range [start, end) inside the first JSON
 * object in `text` (the same object looseParseLookupJson extracts).
 * Returns null when no well-formed object is found. String-, escape- and
 * nesting-aware.
 */
export function topLevelFieldRanges(text: string): Map<string, { start: number; end: number }> | null {
  const s = String(text ?? "");
  const open = s.indexOf("{");
  if (open < 0) return null;
  const out = new Map<string, { start: number; end: number }>();
  let i = open + 1;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const readString = (): boolean => {
    // s[i] === '"'
    i++;
    while (i < s.length) {
      if (s[i] === "\\") i += 2;
      else if (s[i] === '"') {
        i++;
        return true;
      } else i++;
    }
    return false;
  };
  const skipValue = (): boolean => {
    if (s[i] === '"') return readString();
    if (s[i] === "{" || s[i] === "[") {
      let depth = 0;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '"') {
          if (!readString()) return false;
          continue;
        }
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
          depth--;
          if (depth === 0) {
            i++;
            return true;
          }
        }
        i++;
      }
      return false;
    }
    const start = i;
    while (i < s.length && s[i] !== "," && s[i] !== "}" && !/\s/.test(s[i])) i++;
    return i > start;
  };
  for (;;) {
    ws();
    if (i >= s.length) return null;
    if (s[i] === "}") return out;
    if (s[i] === ",") {
      i++;
      continue;
    }
    if (s[i] !== '"') return null;
    const keyStart = i;
    if (!readString()) return null;
    let key: string;
    try {
      key = JSON.parse(s.slice(keyStart, i)) as string;
    } catch {
      return null;
    }
    ws();
    if (s[i] !== ":") return null;
    i++;
    ws();
    const vStart = i;
    if (!skipValue()) return null;
    out.set(key, { start: vStart, end: i });
  }
}

/**
 * Attach each citation to exactly one field, or to the record.
 * A citation maps to field F when its cited text occurs in `text`, and every
 * occurrence lies inside F's value range and inside no other field's range.
 * No cited text, no occurrence, an occurrence straddling fields or outside
 * all of them, or occurrences in two different fields: all of these are
 * record-level. The mapping never guesses.
 */
export function mapCitationsToFields(
  text: string,
  citations: readonly WebCitation[],
): { byField: Partial<Record<LookupFieldKey, string[]>>; record: string[] } {
  const byField: Partial<Record<LookupFieldKey, string[]>> = {};
  const record: string[] = [];
  const addRecord = (u: string) => {
    if (!record.includes(u)) record.push(u);
  };
  if (!citations.length) return { byField, record };
  const ranges = topLevelFieldRanges(text);
  const known = new Set<string>(LOOKUP_FIELD_KEYS);
  for (const c of citations) {
    const cited = c.citedText ?? "";
    if (!ranges || !cited.trim()) {
      addRecord(c.url);
      continue;
    }
    const hits = new Set<string>();
    let straddle = false;
    let occurrences = 0;
    let from = 0;
    while (occurrences < 20) {
      const p = text.indexOf(cited, from);
      if (p < 0) break;
      occurrences++;
      from = p + 1;
      let owner: string | null = null;
      for (const [key, r] of ranges) {
        if (p >= r.start && p + cited.length <= r.end) {
          owner = key;
          break;
        }
      }
      if (owner === null) straddle = true;
      else hits.add(owner);
    }
    const only = hits.size === 1 ? [...hits][0] : null;
    if (occurrences === 0 || straddle || !only || !known.has(only)) {
      addRecord(c.url);
      continue;
    }
    const k = only as LookupFieldKey;
    const arr = byField[k] ?? (byField[k] = []);
    if (!arr.includes(c.url)) arr.push(c.url);
  }
  return { byField, record };
}

// ---------------------------------------------------------------------------
// 6. Legacy bridge (keeps every v1 consumer working)
// ---------------------------------------------------------------------------

/** The v1 flat record (structurally identical to product-lookup-core's RawProductLookup). */
export type V1RawShape = {
  strain_type: string;
  strain_type_confidence: number;
  summary: string;
  effects: string[];
  aroma_notes: string[];
  flavor_notes: string[];
  lineage: string;
  found: boolean;
  confidence?: number;
  description?: string;
  short_description?: string;
  category?: string;
  potency_ratio?: string;
  size?: string;
  image_candidates?: string[];
  /** R30: terpene NAMES (any band) - postProcessLookup maps them to KB slugs. */
  terpenes?: string[];
};

/** "3.5g", "12 fl oz", "10pk", "100mg". Compact where the unit is short. */
export function formatNetSize(size: NetSize | null): string {
  if (!size) return "";
  const n = Number.isInteger(size.amount) ? String(size.amount) : String(size.amount);
  return size.uom.includes(" ") ? `${n} ${size.uom}` : `${n}${size.uom}`;
}

/**
 * Derive the v1 flat record from facts. Values in EVERY band are carried
 * (the worksheet shows everything for a human to review, as v1 did). The
 * bands travel alongside in `facts` for the panel. Numbers are NOT folded into
 * the description (F-022): a description is only ever what the model wrote
 * in the description field.
 */
export function factsToV1Raw(facts: LookupFacts): V1RawShape {
  const f = facts.fields;
  const st = f.strain_type;
  return {
    strain_type: st.value ?? "unknown",
    strain_type_confidence: st.value !== null && st.confidence !== null ? st.confidence / 100 : 0,
    summary: f.summary.value ?? "",
    effects: f.effects.value ?? [],
    aroma_notes: f.aroma.value ?? [],
    flavor_notes: f.flavor.value ?? [],
    lineage: f.lineage.value ?? "",
    found: facts.found,
    ...(facts.overallConfidence !== null ? { confidence: facts.overallConfidence / 100 } : {}),
    description: f.description.value ?? "",
    short_description: f.short_description.value ?? "",
    category: f.category.value ?? "",
    potency_ratio: f.cannabinoids.value?.ratio ?? "",
    size: formatNetSize(f.size.value),
    image_candidates: f.images.value ?? [],
    terpenes: (f.terpenes.value ?? []).map((t) => t.name),
  };
}

/**
 * The confidence (0..1) stamped on a staged ai_suggestion (F-018). When the
 * field carries its OWN confidence, that is used. Otherwise the legacy rule
 * applies unchanged: the strain-type confidence, else 0.75. This keeps a v1
 * lookup, or a payload without per-field numbers, byte-for-byte as before.
 */
export function suggestionConfidence(fieldPct: unknown, strainTypePct: number): number {
  const own = parseConfidence(fieldPct);
  if (own !== null && own > 0) return own / 100;
  return strainTypePct > 0 ? strainTypePct / 100 : 0.75;
}

/** The per-field confidences the worksheet sends back with "Save selected". */
export type LookupFieldConfidence = Partial<Record<"description" | "short_description" | "images", number>>;

/** Pull the three staged-suggestion confidences out of facts (only real numbers). */
export function fieldConfidenceForSave(facts: LookupFacts | null | undefined): LookupFieldConfidence {
  const out: LookupFieldConfidence = {};
  if (!facts) return out;
  for (const k of ["description", "short_description", "images"] as const) {
    const fact = facts.fields[k];
    if (fact.value !== null && fact.confidence !== null) out[k] = fact.confidence;
  }
  return out;
}

/**
 * One-line, human-readable rendering of a fact's value for the worksheet
 * (display only). Returns "" for null. Numbers are shown exactly as parsed.
 */
export function formatFactValue(key: LookupFieldKey, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (key) {
    case "terpenes":
      return (value as Terpene[]).map((t) => (t.pct !== null ? `${t.name} ${t.pct}%` : t.name)).join(", ");
    case "cannabinoids": {
      const c = value as Cannabinoids;
      const parts: string[] = [];
      if (c.thc_pct !== null) parts.push(`THC ${c.thc_pct}%`);
      if (c.thca_pct !== null) parts.push(`THCa ${c.thca_pct}%`);
      if (c.cbd_pct !== null) parts.push(`CBD ${c.cbd_pct}%`);
      if (c.cbg_pct !== null) parts.push(`CBG ${c.cbg_pct}%`);
      if (c.ratio !== null) parts.push(`ratio ${c.ratio}`);
      return parts.join(" \u00b7 ");
    }
    case "size":
      return formatNetSize(value as NetSize);
    case "servings": {
      const v = value as Servings;
      const parts: string[] = [];
      if (v.count !== null) parts.push(`${v.count} servings`);
      if (v.mg_each !== null) parts.push(`${v.mg_each}mg each`);
      return parts.join(" \u00b7 ");
    }
    case "images":
      return `${(value as string[]).length} image(s)`;
    default:
      return Array.isArray(value) ? (value as unknown[]).map(String).join(", ") : String(value);
  }
}

/**
 * What the worksheet sends back as `fieldConfidence` on "Save selected"
 * (F-018). A field's OWN confidence travels only while the operator keeps the
 * text EXACTLY as the AI wrote it. An edited or discarded field sends nothing,
 * and the server then applies the legacy rule, unchanged. `kept.*` is the
 * trimmed text being saved ("" when unchecked); images count the kept images.
 */
export function keptFieldConfidence(
  own: LookupFieldConfidence | undefined,
  ai: { description: string; shortDescription: string },
  kept: { description: string; shortDescription: string; imagesKept: number },
): LookupFieldConfidence {
  const out: LookupFieldConfidence = {};
  if (!own) return out;
  if (own.description !== undefined && kept.description !== "" && kept.description === ai.description)
    out.description = own.description;
  if (
    own.short_description !== undefined &&
    kept.shortDescription !== "" &&
    kept.shortDescription === ai.shortDescription
  )
    out.short_description = own.short_description;
  if (own.images !== undefined && kept.imagesKept > 0) out.images = own.images;
  return out;
}

// ---------------------------------------------------------------------------
// 7. Rollback switch
// ---------------------------------------------------------------------------

/** The S06 rollback switch, set in Vercel. */
export const LOOKUP_SCHEMA_V2_ENV = "LOOKUP_SCHEMA_V2";

/**
 * On by default. Only an explicit off-word turns it off:
 * off, 0, false, no or disabled (case- and space-insensitive).
 * With it off, the lookup sends the v1 prompt and shape, byte-identical
 * to before S06.
 */
export function lookupSchemaV2Enabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

/** Output-token ceiling for the v2 reply (billing is per token produced, not the cap). */
export const LOOKUP_V2_MAX_TOKENS = 4000;

// ---------------------------------------------------------------------------
// 8. Prompts (v2)
// ---------------------------------------------------------------------------

export const PRODUCT_LOOKUP_SYSTEM_V2 = `
You are a thorough cannabis product research assistant for a licensed
Washington State (I-502) retailer. You look up a specific product (often a
flower strain, but sometimes an edible, vape, concentrate, pre-roll, beverage,
tincture, topical, or accessory) and report what the internet and the cannabis
community say about it. Search widely: brand sites, licensed menus, Leafly,
AllBud, dispensary listings, review sites, and community forums all count.

YOUR JOB — A STRUCTURED, FIELD-BY-FIELD, CITED RECORD:
- Report every fact in its OWN field, each with its OWN confidence (0-100) and
  the source URLs that support it. The retailer auto-attaches a field only when
  THAT field's confidence is 90 or more, so grade each field honestly on its
  own evidence, not on how sure you are about the product overall.
- Community consensus is valuable. You do NOT need an official manufacturer
  source to report a detail. Grade it lower when it is thin or conflicting.
- NEVER GUESS. The ONE thing you must never do is INVENT a specific fact (a
  made-up lineage, a fake potency number, a fabricated image URL). When a field
  is not found, return "value": null and "confidence": 0 for that field. Still
  report every other field you did find.
- CITE. Put the URLs that support a field in that field's "sources" (at most 3).
  Do not cite a page that does not state the fact.

CONFIDENCE, per field (0-100):
- 90-100: several independent sources agree, or the maker states it.
- 60-89: one solid source or strong community consensus.
- below 60: thin, dated, or conflicting. Report it anyway so it can be reviewed.

KEEP FACTS OUT OF THE PROSE. Numbers and lists belong in their fields, not in
the description: THC/CBD/CBG/THCA percentages go in "cannabinoids", terpenes in
"terpenes", the grower in "producer", awards in "awards", sizes in "size",
servings in "servings". The description does not need to repeat them.

WASHINGTON I-502 COMPLIANCE (never violate — this is the law, not a preference):
- NO health, medical, therapeutic, or curative claims. Do NOT say a product
  treats, cures, heals, relieves, prevents, or reduces any condition, symptom,
  disease, pain, anxiety, inflammation, etc.
- You MAY describe EXPERIENTIAL character with plain adjectives (relaxed, calm,
  sleepy, uplifted, happy, focused, creative, energetic, euphoric, giggly,
  talkative, hungry, mellow, etc.) framed as the general vibe — never as a
  treatment.
- NO dosing advice, no safety/efficacy claims, nothing appealing to minors, no
  alcohol/tobacco/vehicle associations.
- Keep copy sensory and tasteful: aroma, flavor, format, lineage/strain type,
  and general experiential character.

THIS VENDOR'S VERSION FIRST: a vendor/brand is usually given. Prefer what THAT
vendor publishes about THEIR version (their site, their menu listing,
licensed-menu pages that name them). Their lineage, potency, terpenes, size,
and imagery can differ from the generic strain. Only widen to the general
community when the vendor says nothing.

Return ONLY the JSON object in the exact shape requested.
`.trim();

/** v2 user prompt: same row context as v1, WITHOUT the "pack the description" ask (F-022). */
export function buildLookupUserPromptV2(input: {
  query: string;
  productName?: string | null;
  vendorOrBrand?: string | null;
}): string {
  const lines: string[] = [];
  const query = String(input.query ?? "").trim();
  const name = String(input.productName ?? "").trim();
  const vendor = String(input.vendorOrBrand ?? "").trim();
  lines.push(`Search request: ${query || name || "(none)"}`);
  if (name && name.toLowerCase() !== query.toLowerCase()) lines.push(`Product name on the manifest: ${name}`);
  if (vendor) lines.push(`Vendor / brand: ${vendor}`);
  lines.push("");
  lines.push(
    (vendor
      ? `Focus FIRST on ${vendor}'s own version of this product (their site, their menu listing, ` +
        "licensed-menu pages that name them); only widen to the broader community when they say nothing. "
      : "") +
      "Look this up thoroughly across brand sites, licensed menus, Leafly, AllBud, dispensary listings, and " +
      "community/review sources. Fill every field you can find evidence for, each with its own confidence and " +
      "sources. For a non-flower product, leave strain_type null unless the maker states one. A field you cannot " +
      "find is null with confidence 0. Never fabricate a fact, number, or URL.",
  );
  return lines.join("\n");
}

const F = (hint: string) => `{ "value": ${hint}, "confidence": 0, "sources": [] }`;

/** The v2 JSON shape appended to the user prompt (the web-search path has no response_format). */
export const LOOKUP_V2_SHAPE_HINT = `

Respond with ONLY a JSON object (no prose, no code fences) in EXACTLY this shape.
Every field is { "value": ..., "confidence": 0-100, "sources": ["https://..."] }.
Use "value": null and "confidence": 0 for anything you did not find.
{
  "schema": "${LOOKUP_V2_SCHEMA_ID}",
  "found": true,
  "overall_confidence": 0,
  "strain_name": ${F('"strain name as sources give it, or null"')},
  "strain_type": ${F('"indica|sativa|hybrid|indica-hybrid|sativa-hybrid|cbd or null"')},
  "lineage": ${F('"parents, e.g. Blueberry x Haze, or null"')},
  "category": ${F('"flower|pre-roll|vape|concentrate|edible|beverage|tincture|topical|capsule|accessory|other or null"')},
  "house_type": ${F('"a specific format such as Live Resin Cartridge, Gummies, Hash Rosin, Infused Pre-roll, or null"')},
  "producer": ${F('"grower / farm / producer, or null"')},
  "summary": ${F('"one or two sensory sentences about the strain, or null"')},
  "description": ${F('"a rich sensory/experiential marketing description (no numbers needed), or null"')},
  "short_description": ${F('"one catchy line under ~120 chars, or null"')},
  "effects": ${F('["experiential words only"]')},
  "aroma": ${F('["..."]')},
  "flavor": ${F('["..."]')},
  "terpenes": ${F('[{ "name": "myrcene", "pct": 0.8 }]')},
  "cannabinoids": ${F('{ "thc_pct": null, "cbd_pct": null, "cbg_pct": null, "thca_pct": null, "ratio": null }')},
  "size": ${F('{ "amount": 3.5, "uom": "g|mg|oz|ml|fl oz|ct|pk" }')},
  "servings": ${F('{ "count": 10, "mg_each": 10 }')},
  "ingredients": ${F('["..."]')},
  "allergens": ${F('["..."]')},
  "brand_description": ${F('"what the brand says about itself, or null"')},
  "awards": ${F('["award name + year"]')},
  "images": ${F('["direct http(s) image URLs of THIS product; [] if unsure"]')}
}`;

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLookupFactsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lookup-facts-core: " + msg);
    passed += 1;
  };
  const fld = (value: unknown, confidence: unknown, sources: unknown = []) => ({ value, confidence, sources });

  // ── Bands (spec: 89 -> review, 90 -> auto; missing -> unknown) ──────────
  ok(LOOKUP_FACT_AUTO_MIN_CONFIDENCE === 90, "the bar is 90");
  ok(confidenceBand(90) === "auto", "90 -> auto");
  ok(confidenceBand(89) === "review", "89 -> review");
  ok(confidenceBand(89.99) === "review", "89.99 -> review (no rounding up)");
  ok(confidenceBand(100) === "auto", "100 -> auto");
  ok(confidenceBand(60) === "review", "60 -> review");
  ok(confidenceBand(59) === "reject", "59 -> reject");
  ok(confidenceBand(0) === "reject", "0 -> reject");
  ok(confidenceBand(null) === "unknown" && confidenceBand(undefined) === "unknown", "missing -> unknown");
  ok(confidenceBand(101) === "unknown" && confidenceBand(-1) === "unknown" && confidenceBand(NaN) === "unknown", "out of range -> unknown");

  ok(parseConfidence(95) === 95 && parseConfidence("95") === 95 && parseConfidence("95%") === 95, "confidence parse");
  ok(parseConfidence(0.95) === 0.95, "0..1 fraction is NOT rescaled (stays reject, never auto)");
  ok(parseConfidence("high") === null && parseConfidence(true) === null && parseConfidence(150) === null, "junk confidence -> null");

  // ── normalizeLookup ────────────────────────────────────────────────────
  const facts = normalizeLookup({
    schema: LOOKUP_V2_SCHEMA_ID,
    found: true,
    overall_confidence: 99,
    strain_name: fld("Blue Dream", 96, ["https://leafly.com/strains/blue-dream", "ftp://x.example/a", "nope"]),
    strain_type: fld("Sativa Hybrid", 90),
    lineage: fld("Blueberry x Haze", 89),
    description: fld("A bright berry-forward flower with a gentle, uplifted character.", 92),
    effects: fld(["uplifted", "Uplifted", "creative"], 70),
    cannabinoids: fld({ thc_pct: "24%", cbd_pct: 0, ratio: "none" }, 95),
    terpenes: fld([{ name: "Myrcene", pct: 0.8 }, "Pinene", { name: "myrcene" }, { name: "caryophyllene", pct: 250 }], 80),
    size: fld({ amount: "3.5", uom: "Grams" }, 99),
    servings: fld({ count: 10.5, mg_each: 10 }, 91),
    house_type: fld("live resin cartridge", 93),
    category: fld("Flower", 97),
    images: fld(["https://cdn.example.com/bd.jpg", "javascript:alert(1)", "https://cdn.example.com/bd.jpg"], 75),
    producer: "Acme Farms", // bare value: no confidence of its own
    awards: fld([], 0),
    allergens: fld(null, 0),
  });
  const f = facts.fields;
  ok(facts.schema === "v2" && facts.found === true && facts.overallConfidence === 99, "record-level fields");
  ok(f.strain_name.value === "Blue Dream" && f.strain_name.band === "auto", "96 -> auto");
  ok(f.strain_name.sources.length === 1 && f.strain_name.sources[0] === "https://leafly.com/strains/blue-dream", "only http(s) sources kept");
  ok(f.strain_type.value === "sativa-hybrid" && f.strain_type.band === "auto", "strain type canonicalised; 90 -> auto");
  ok(f.lineage.band === "review", "89 -> review");
  ok(JSON.stringify(f.effects.value) === '["uplifted","creative"]' && f.effects.band === "review", "list deduped, review band");
  ok(f.cannabinoids.value?.thc_pct === 24 && f.cannabinoids.value?.cbd_pct === 0 && f.cannabinoids.value?.ratio === null, "cannabinoids: 24% parsed, 0 kept, junk ratio null");
  ok(f.terpenes.value?.length === 3 && f.terpenes.value[0].pct === 0.8 && f.terpenes.value[1].pct === null, "terpenes: object + string, deduped");
  ok(f.terpenes.value?.[2].pct === null, "impossible terpene pct dropped, name kept");
  ok(f.size.value?.amount === 3.5 && f.size.value?.uom === "g", "size: numeric string + unit alias");
  ok(f.servings.value?.count === null && f.servings.value?.mg_each === 10, "non-integer serving count dropped");
  ok(f.house_type.value === "Live Resin Cartridge", "house type matched to the catalog label");
  ok(f.category.value === "flower", "category lowercased");
  ok(JSON.stringify(f.images.value) === '["https://cdn.example.com/bd.jpg"]', "images: http(s) only, deduped");
  // Spec: no field is auto-eligible without its own confidence.
  ok(f.producer.value === "Acme Farms" && f.producer.confidence === null && f.producer.band === "unknown", "bare value shown, band unknown");
  ok(!isAutoEligible(f.producer), "bare value never auto-eligible even with overall 99");
  ok(f.awards.value === null && f.awards.band === "unknown", "empty list -> unknown");
  ok(f.allergens.value === null && f.allergens.band === "unknown" && f.allergens.confidence === 0, "null value + 0 -> unknown");
  ok(f.ingredients.band === "unknown" && f.ingredients.value === null, "absent field -> unknown");
  ok(isAutoEligible(f.strain_name) && !isAutoEligible(f.lineage), "auto eligibility follows the field's own band");
  const cnt = facts.counts;
  ok(cnt.auto + cnt.review + cnt.reject + cnt.unknown === LOOKUP_FIELD_KEYS.length, "every field counted once");
  ok(cnt.auto === 8 && cnt.review === 4 && cnt.reject === 0 && cnt.unknown === 9, "band counts");
  ok(
    ["strain_name", "strain_type", "category", "house_type", "description", "cannabinoids", "size", "servings"].every((k) => f[k as LookupFieldKey].band === "auto") &&
      ["lineage", "effects", "terpenes", "images"].every((k) => f[k as LookupFieldKey].band === "review"),
    "exact band per field",
  );

  // A value present with a HIGH confidence but invalid content is unknown.
  const bad = normalizeLookup({ strain_type: fld("indica-ish", 99), size: fld({ amount: 3.5, uom: "handfuls" }, 99), house_type: fld("Space Cake", 99) });
  ok(bad.fields.strain_type.band === "unknown" && bad.fields.size.band === "unknown" && bad.fields.house_type.band === "unknown", "invalid values never auto");
  ok(bad.found === false, "found must be literally true");
  ok(
    normalizeLookup({ found: "true", strain_type: fld("indica", 95) }).found === false &&
      normalizeLookup({ found: 1, strain_type: fld("indica", 95) }).found === false,
    "truthy non-boolean found is not found",
  );

  // Prose no longer has to carry THC/terpenes when structured fields exist (spec test 3).
  const prose = normalizeLookup({
    description: fld("Citrus-forward with a mellow, easygoing finish.", 93),
    cannabinoids: fld({ thc_pct: 27.1 }, 94),
    terpenes: fld([{ name: "limonene", pct: 1.2 }], 91),
  });
  ok(prose.fields.description.band === "auto" && !/thc|terpene|limonene|%/i.test(prose.fields.description.value ?? ""), "clean prose description is auto without numbers");
  ok(prose.fields.cannabinoids.value?.thc_pct === 27.1 && prose.fields.terpenes.value?.[0].name === "limonene", "numbers live in their own fields");
  const v1 = factsToV1Raw(prose);
  ok(v1.description === "Citrus-forward with a mellow, easygoing finish.", "v1 bridge never folds numbers into the description");
  ok(!/\bfold\b/i.test(PRODUCT_LOOKUP_SYSTEM_V2) && !/flowing prose/i.test(PRODUCT_LOOKUP_SYSTEM_V2), "v2 prompt no longer asks to fold facts into prose");
  ok(PRODUCT_LOOKUP_SYSTEM_V2.includes("KEEP FACTS OUT OF THE PROSE"), "v2 prompt keeps numbers in fields");
  ok(!/Pack the description/i.test(buildLookupUserPromptV2({ query: "x" })), "v2 user prompt drops the pack-the-description ask");

  // Prompt: explicit null + confidence 0, never guess, cite (spec).
  ok(PRODUCT_LOOKUP_SYSTEM_V2.includes('"value": null and "confidence": 0'), "prompt: null + 0 when not found");
  ok(PRODUCT_LOOKUP_SYSTEM_V2.includes("NEVER GUESS") && PRODUCT_LOOKUP_SYSTEM_V2.includes("CITE."), "prompt: never guess + cite");
  ok(PRODUCT_LOOKUP_SYSTEM_V2.includes("INVENT") && PRODUCT_LOOKUP_SYSTEM_V2.includes("community") && PRODUCT_LOOKUP_SYSTEM_V2.includes("I-502"), "prompt keeps the v1 rails");
  ok(LOOKUP_V2_SHAPE_HINT.includes(`"schema": "${LOOKUP_V2_SCHEMA_ID}"`), "shape hint carries the schema marker");
  for (const k of LOOKUP_FIELD_KEYS) ok(LOOKUP_V2_SHAPE_HINT.includes(`"${k}": {`), `shape hint asks for ${k}`);
  const up = buildLookupUserPromptV2({ query: "Blue Dream", productName: "Blue Dream 3.5g", vendorOrBrand: "Acme" });
  ok(up.includes("Search request: Blue Dream") && up.includes("Product name on the manifest: Blue Dream 3.5g") && up.includes("Acme's own version"), "v2 user prompt carries row context");

  // ── parseLookupV2 (rollback decision) ──────────────────────────────────
  ok(parseLookupV2({ strain_type: { value: "indica", confidence: 95 } }) !== null, "one field object -> v2");
  ok(parseLookupV2({ strain_type: "indica", strain_type_confidence: 0.9, found: true }) === null, "v1 reply -> null (fallback)");
  ok(parseLookupV2({}) === null && parseLookupV2(null) === null && parseLookupV2("x") === null, "empty/non-object -> null");
  ok(parseLookupV2({ schema: LOOKUP_V2_SCHEMA_ID, found: false }) !== null, "marked honest miss is v2");
  ok(parseLookupV2({ schema: LOOKUP_V2_SCHEMA_ID, strain_type: "indica" }) === null, "marked but v1-shaped -> fallback");

  // ── Citation span mapping ──────────────────────────────────────────────
  const reply =
    '{"schema":"lookup.v2","found":true,"lineage":{"value":"Blueberry x Haze","confidence":95,"sources":[]},' +
    '"description":{"value":"Sweet berry nose. Uplifted \\"daytime\\" vibe.","confidence":91,"sources":[]},' +
    '"producer":{"value":"Haze Farms","confidence":80,"sources":[]}}';
  const ranges = topLevelFieldRanges(reply);
  ok(ranges !== null && ranges.has("lineage") && ranges.has("description") && ranges.has("found"), "top-level ranges found");
  ok(reply.slice(ranges!.get("found")!.start, ranges!.get("found")!.end) === "true", "scalar value range exact");
  const cits: WebCitation[] = [
    { url: "https://a.example/lineage", citedText: "Blueberry x Haze" },
    { url: "https://b.example/desc", citedText: 'Uplifted \\"daytime\\" vibe.' },
    { url: "https://c.example/haze", citedText: "Haze" }, // in lineage AND producer -> ambiguous
    { url: "https://d.example/none" }, // no span
    { url: "https://e.example/outside", citedText: '"found":true,"lineage"' }, // straddles keys
    { url: "https://f.example/missing", citedText: "not in reply" },
  ];
  const mapped = mapCitationsToFields(reply, cits);
  ok(JSON.stringify(mapped.byField.lineage) === '["https://a.example/lineage"]', "span inside lineage -> lineage");
  ok(JSON.stringify(mapped.byField.description) === '["https://b.example/desc"]', "span with JSON escapes -> description");
  ok(!mapped.byField.producer, "ambiguous span never guessed onto a field");
  ok(
    ["https://c.example/haze", "https://d.example/none", "https://e.example/outside", "https://f.example/missing"].every((u) => mapped.record.includes(u)),
    "ambiguous / no-span / straddling / absent -> record",
  );
  // One occurrence inside a field + one outside every range (a key name) = straddle -> record.
  const reply2 = '{"lineage":{"value":null,"confidence":0,"sources":[]},"description":{"value":"Its lineage is unknown","confidence":90,"sources":[]}}';
  const m2 = mapCitationsToFields(reply2, [{ url: "https://g.example/partial", citedText: "lineage" }]);
  ok(!m2.byField.description && m2.record.includes("https://g.example/partial"), "partly-outside span never attributed");
  const withCites = normalizeLookup(JSON.parse(reply), { text: reply, citations: cits });
  ok(withCites.fields.lineage.cited[0] === "https://a.example/lineage" && withCites.recordCitations.length === 4, "normalizeLookup wires the mapping");
  // Fenced / prose-wrapped reply: ranges still found from the first "{".
  const fenced = "Here you go:\n```json\n" + reply + "\n```";
  ok(mapCitationsToFields(fenced, [cits[0]]).byField.lineage?.[0] === "https://a.example/lineage", "fenced reply still maps");
  ok(topLevelFieldRanges("no json here") === null && topLevelFieldRanges('{"a": ') === null, "malformed -> null");
  ok(mapCitationsToFields("no json", [cits[0]]).record[0] === "https://a.example/lineage", "no JSON -> every citation record-level");
  // A citation onto a withheld (invalid) field falls back to record.
  const inval = normalizeLookup(
    { strain_type: { value: "martian", confidence: 99 } },
    { text: '{"strain_type":{"value":"martian","confidence":99}}', citations: [{ url: "https://m.example", citedText: "martian" }] },
  );
  ok(inval.fields.strain_type.cited.length === 0 && inval.recordCitations[0] === "https://m.example", "citation on invalid field -> record");

  // ── v1 bridge ──────────────────────────────────────────────────────────
  const b = factsToV1Raw(facts);
  ok(b.strain_type === "sativa-hybrid" && b.strain_type_confidence === 0.9, "bridge strain type + 0..1 confidence");
  ok(b.confidence === 0.99 && b.found === true, "bridge overall + found");
  ok(b.size === "3.5g" && b.potency_ratio === "" && b.category === "flower", "bridge size/ratio/category");
  ok(JSON.stringify(b.image_candidates) === '["https://cdn.example.com/bd.jpg"]' && b.lineage === "Blueberry x Haze", "bridge images/lineage");
  const empty = factsToV1Raw(normalizeLookup({ schema: LOOKUP_V2_SCHEMA_ID, found: false }));
  ok(empty.strain_type === "unknown" && empty.strain_type_confidence === 0 && empty.description === "" && !("confidence" in empty), "honest v2 miss -> empty v1");
  ok(JSON.stringify(empty.terpenes) === "[]", "R30: honest miss bridges no terpenes");
  ok(JSON.stringify(v1.terpenes) === '["limonene"]', "R30: v1 bridge carries terpene names: " + JSON.stringify(v1.terpenes));
  ok(formatNetSize({ amount: 12, uom: "fl oz" }) === "12 fl oz" && formatNetSize({ amount: 10, uom: "pk" }) === "10pk" && formatNetSize(null) === "", "size formatting");
  // A strain type with no confidence of its own bridges at 0 (cannot autofill).
  const noConf = factsToV1Raw(normalizeLookup({ strain_type: "indica", overall_confidence: 100 }));
  ok(noConf.strain_type === "indica" && noConf.strain_type_confidence === 0, "bare strain type bridges with 0 confidence");

  // ── F-018 suggestion confidence ────────────────────────────────────────
  ok(suggestionConfidence(93, 40) === 0.93, "own field confidence wins");
  ok(suggestionConfidence(undefined, 40) === 0.4 && suggestionConfidence(undefined, 0) === 0.75, "legacy fallback unchanged");
  ok(suggestionConfidence(0, 40) === 0.4 && suggestionConfidence("junk", 0) === 0.75, "zero/junk own confidence -> legacy");
  const fc = fieldConfidenceForSave(facts);
  ok(fc.description === 92 && fc.images === 75 && !("short_description" in fc), "save confidences only for present fields");
  ok(Object.keys(fieldConfidenceForSave(null)).length === 0, "no facts -> {}");

  // ── Switch ─────────────────────────────────────────────────────────────
  ok(LOOKUP_SCHEMA_V2_ENV === "LOOKUP_SCHEMA_V2", "env name");
  ok(lookupSchemaV2Enabled(undefined) && lookupSchemaV2Enabled("") && lookupSchemaV2Enabled("on") && lookupSchemaV2Enabled("offf"), "default on; typo stays on");
  ok(["off", " OFF ", "0", "false", "No", "disabled"].every((v) => !lookupSchemaV2Enabled(v)), "off-words turn it off");

  // ── Labels ─────────────────────────────────────────────────────────────
  ok(LOOKUP_FIELD_KEYS.every((k) => LOOKUP_FIELD_LABELS[k].length > 0), "every field has a label");
  ok(new Set(LOOKUP_FIELD_KEYS).size === LOOKUP_FIELD_KEYS.length && Object.keys(LOOKUP_FIELD_LABELS).length === LOOKUP_FIELD_KEYS.length, "keys unique, labels 1:1");

  // -- formatFactValue (display only) --
  ok(formatFactValue("terpenes", [{ name: "myrcene", pct: 0.8 }, { name: "pinene", pct: null }]) === "myrcene 0.8%, pinene", "terpene display");
  ok(
    formatFactValue("cannabinoids", { thc_pct: 24, thca_pct: null, cbd_pct: 0, cbg_pct: null, ratio: "1:1" }) === "THC 24% \u00b7 CBD 0% \u00b7 ratio 1:1",
    "cannabinoid display keeps a real 0",
  );
  ok(formatFactValue("size", { amount: 12, uom: "fl oz" }) === "12 fl oz" && formatFactValue("size", { amount: 3.5, uom: "g" }) === "3.5g", "size display");
  ok(formatFactValue("servings", { count: 10, mg_each: 10 }) === "10 servings \u00b7 10mg each", "servings display");
  ok(formatFactValue("effects", ["calm", "happy"]) === "calm, happy" && formatFactValue("lineage", null) === "", "list + null display");
  ok(formatFactValue("images", ["https://a/x.jpg"]) === "1 image(s)", "images display");

  // -- keptFieldConfidence (F-018: own confidence only for untouched AI text) --
  const own = { description: 95, short_description: 72, images: 88 };
  const ai = { description: "Bright and berry.", shortDescription: "Berry bright." };
  ok(
    JSON.stringify(keptFieldConfidence(own, ai, { description: "Bright and berry.", shortDescription: "Berry bright.", imagesKept: 2 })) ===
      '{"description":95,"short_description":72,"images":88}',
    "untouched text keeps its own confidence",
  );
  ok(
    JSON.stringify(keptFieldConfidence(own, ai, { description: "Bright and berry!", shortDescription: "", imagesKept: 0 })) === "{}",
    "edited, unchecked and no-image fields send nothing",
  );
  ok(JSON.stringify(keptFieldConfidence(undefined, ai, { description: "Bright and berry.", shortDescription: "", imagesKept: 1 })) === "{}", "no own confidence -> nothing");
  ok(
    JSON.stringify(keptFieldConfidence({ images: 88 }, { description: "", shortDescription: "" }, { description: "", shortDescription: "", imagesKept: 1 })) ===
      '{"images":88}',
    "empty AI text never matches an empty kept text",
  );

  return { passed, failed: 0 };
}
