/**
 * src/lib/enrichment/batch-answer-core.ts
 *
 * D244 R-15: the overnight (Gemini Batch API) answers did not fit the draft
 * form. The owner's test: "Finished: 0 drafted · 396 failed … display_name:
 * is required - description: must be an object … product_all_fields:
 * expected a JSON object".
 *
 * Why: the live path (provider.ts generateStructured) sends the schema AND a
 * plain-words shape hint in the prompt, and retries once on a bad shape. The
 * batch path sent only `responseJsonSchema`. Google's docs say structured
 * output is supported in batch requests
 * (ai.google.dev/gemini-api/docs/batch-mode#request-config), but the
 * community reports the schema being dropped or loosened in batch mode
 * (googleapis/python-genai#1307; discuss.ai.google.dev/t/102297), and the
 * structured-output docs say to validate in the app and "move non-structural
 * rules to descriptions" / the prompt. So we (1) add the same shape hint to
 * the batch prompt (enrich-batch-server) and (2) read the answer TOLERANTLY
 * here before the strict validator: unwrap `{product_all_fields:{…}}`, a
 * one-item array, or JSON-in-a-string; lift flat fields (`description: "…"`)
 * into `{value, confidence, evidence, best_guess}`; fill a missing field with
 * an empty value (that field is simply skipped, never invented).
 *
 * Nothing here writes or publishes. The result still goes through
 * validate() + storeAllFieldsResult (compliance gate, evidence filter,
 * potency check) and every field is a pending suggestion a person accepts.
 *
 * Pure: no imports with side effects. Self-tests at the bottom.
 */

import type { SchemaShape, FieldSpec } from "@/lib/ai/schema";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The top-level field names of the all-fields form. */
export const ALL_FIELDS_KEYS = ["display_name", "description", "short_description", "seo", "sensory", "effects", "tags", "strain_type", "potency"] as const;
type FieldKey = (typeof ALL_FIELDS_KEYS)[number];

/** Wrapper keys Gemini has been seen to put around the object. */
const WRAPPERS = ["product_all_fields", "productAllFields", "result", "data", "draft", "output", "response", "fields", "answer", "product"];

/** A missing / flat confidence is a guess: low, and marked as one. */
export const LIFTED_CONFIDENCE = 40;

/** A JSON string inside a string -> the value; anything else unchanged. */
function maybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

function knownCount(o: Obj): number {
  return ALL_FIELDS_KEYS.filter((k) => k in o).length;
}

/** Peel wrappers until we reach the object that carries the form's fields. */
export function unwrapAnswer(raw: unknown): Obj | null {
  let v = maybeJson(raw);
  for (let depth = 0; depth < 4; depth++) {
    if (Array.isArray(v)) {
      const first = v.find((x) => isObj(maybeJson(x)));
      v = first === undefined ? null : maybeJson(first);
      continue;
    }
    if (!isObj(v)) return null;
    const o: Obj = v;
    if (knownCount(o) > 0) return o;
    const wrap = WRAPPERS.find((w) => w in o && (isObj(maybeJson(o[w])) || Array.isArray(maybeJson(o[w]))));
    if (wrap) {
      v = maybeJson(o[wrap]);
      continue;
    }
    const keys = Object.keys(o);
    if (keys.length === 1) {
      v = maybeJson(o[keys[0]]);
      continue;
    }
    return o;
  }
  return isObj(v) ? v : null;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** A list from an array, or a comma / semicolon string. */
function list(v: unknown): string[] {
  const x = maybeJson(v);
  if (Array.isArray(x)) return x.map((i) => (isObj(i) ? str(i.name ?? i.value ?? i.label) : str(i))).map((s) => s.trim()).filter(Boolean);
  if (typeof x === "string") return x.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** confidence/evidence/best_guess from a field object (fractions become 0-100). */
function meta(o: Obj | null): { confidence: number; evidence: string[]; best_guess: boolean } {
  if (!o) return { confidence: LIFTED_CONFIDENCE, evidence: [], best_guess: true };
  let c = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  const had = Number.isFinite(c);
  if (!had) c = LIFTED_CONFIDENCE;
  else if (c > 0 && c <= 1) c = Math.round(c * 100);
  c = Math.max(0, Math.min(100, c));
  const bg = o.best_guess ?? o.bestGuess;
  const best_guess = typeof bg === "boolean" ? bg : bg === "true" ? true : bg === "false" ? false : !had;
  return { confidence: c, evidence: list(o.evidence ?? o.sources ?? o.evidence_ids), best_guess };
}

function asField(v: unknown): Obj | null {
  const x = maybeJson(v);
  return isObj(x) ? x : null;
}

/** A `{value}` field: an object with value (or text/name), or a bare string. */
function valueField(src: Obj, key: FieldKey, aliases: string[] = []): Obj {
  const raw = [key, ...aliases].map((k) => src[k]).find((x) => x !== undefined && x !== null);
  const o = asField(raw);
  if (o) return { value: str(o.value ?? o.text ?? o.name ?? o.title ?? ""), ...meta(o) };
  return { value: str(raw), ...meta(null) };
}

/** Rebuild the form from whatever shape the answer came in. */
export function normalizeAllFieldsAnswer(raw: unknown): { ok: true; value: Obj; usable: number; lifted: boolean } | { ok: false; error: string } {
  const src = unwrapAnswer(raw);
  if (!src) return { ok: false, error: "Google's answer was not a JSON object (nothing to read)." };
  const before = JSON.stringify(src);

  const display_name = valueField(src, "display_name", ["name", "title", "product_name", "displayName"]);
  const description = valueField(src, "description", ["long_description", "body"]);
  const short_description = valueField(src, "short_description", ["shortDescription", "tagline", "summary"]);

  const seoO = asField(src.seo);
  const seo = {
    title: str(seoO?.title ?? seoO?.seo_title ?? src.seo_title ?? src.seoTitle ?? ""),
    meta: str(seoO?.meta ?? seoO?.meta_description ?? seoO?.description ?? src.seo_meta ?? src.meta_description ?? src.metaDescription ?? (typeof src.seo === "string" ? src.seo : "")),
    ...meta(seoO),
  };

  const sensO = asField(src.sensory);
  const sensory = {
    aroma_notes: list(sensO?.aroma_notes ?? sensO?.aroma ?? src.aroma_notes ?? src.aroma),
    flavor_notes: list(sensO?.flavor_notes ?? sensO?.flavor ?? src.flavor_notes ?? src.flavor),
    terpenes: list(sensO?.terpenes ?? src.terpenes),
    ...meta(sensO),
  };

  const listField = (key: "effects" | "tags"): Obj => {
    const o = asField(src[key]);
    if (o) return { values: list(o.values ?? o.value ?? o.items), ...meta(o) };
    return { values: list(src[key]), ...meta(null) };
  };
  const effects = listField("effects");
  const tags = listField("tags");

  const stO = asField(src.strain_type);
  const strain_type = stO ? { value: str(stO.value ?? "unknown").toLowerCase() || "unknown", ...meta(stO) } : { value: str(src.strain_type ?? src.strainType ?? "unknown").toLowerCase() || "unknown", ...meta(null) };

  const potO = asField(src.potency);
  const potency = {
    thc: str(potO?.thc ?? src.thc ?? ""),
    cbd: str(potO?.cbd ?? src.cbd ?? ""),
    ...meta(potO),
  };

  const value: Obj = { display_name, description, short_description, seo, sensory, effects, tags, strain_type, potency };
  const usable = [display_name.value, description.value, short_description.value, seo.title || seo.meta, sensory.aroma_notes.length || sensory.flavor_notes.length || sensory.terpenes.length ? "x" : "", (effects.values as string[]).length ? "x" : "", (tags.values as string[]).length ? "x" : ""].filter((x) => typeof x === "string" && x.trim()).length;
  if (usable === 0) {
    const keys = Object.keys(src).slice(0, 8).join(", ") || "none";
    return { ok: false, error: `Google's answer had none of the draft fields (it sent: ${keys}).` };
  }
  const lifted = JSON.stringify(value) !== before;
  return { ok: true, value, usable, lifted };
}

/**
 * Fit values to the schema's limits the way a person would: clip text past
 * maxLength at a word boundary, clamp numbers, an enum value we do not know ->
 * the enum's "unknown" (or its first value). Gemini's structured-output docs:
 * minLength/maxLength "are not enforced during constrained decoding".
 */
export function fitToShape(shape: SchemaShape, value: Obj): Obj {
  const fit = (spec: FieldSpec, v: unknown): unknown => {
    if (v === undefined || v === null) return v;
    switch (spec.kind) {
      case "string": {
        if (typeof v !== "string") return v;
        const t = v.trim();
        if (typeof spec.maxLength !== "number" || t.length <= spec.maxLength) return t;
        const cut = t.slice(0, spec.maxLength);
        const sp = cut.lastIndexOf(" ");
        return (sp > spec.maxLength * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:-]+$/, "");
      }
      case "enum": {
        const low = typeof v === "string" ? v.trim().toLowerCase() : "";
        const hit = spec.values.find((x) => x.toLowerCase() === low);
        return hit ?? (spec.values.includes("unknown") ? "unknown" : spec.values[0]);
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) return typeof spec.min === "number" ? spec.min : 0;
        return Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, n));
      }
      case "object": {
        if (!isObj(v)) return v;
        const out: Obj = { ...v };
        for (const [k, c] of Object.entries(spec.fields)) out[k] = fit(c, v[k]);
        return out;
      }
      default:
        return v;
    }
  };
  const out: Obj = { ...value };
  for (const [k, spec] of Object.entries(shape)) out[k] = fit(spec, value[k]);
  return out;
}

/**
 * Our schema -> Gemini's `responseSchema` (the OpenAPI subset). Every
 * structured-output example on Google's Batch API page uses `responseSchema`
 * (type OBJECT/STRING/ARRAY…), and Google's forum answer for batch is the
 * same with upper-case types. `additionalProperties` is not part of that
 * subset, so it is left out; `propertyOrdering` keeps the fields in the
 * order the prompt lists them.
 */
export function toGeminiResponseSchema(shape: SchemaShape): Obj {
  const node = (spec: FieldSpec): Obj => {
    const d = spec.description ? { description: spec.description } : {};
    switch (spec.kind) {
      case "string":
        return { type: "STRING", ...d };
      case "enum":
        return { type: "STRING", format: "enum", enum: [...spec.values], ...d };
      case "stringArray":
        return { type: "ARRAY", items: spec.allowed ? { type: "STRING", format: "enum", enum: [...spec.allowed] } : { type: "STRING" }, ...(typeof spec.maxItems === "number" ? { maxItems: spec.maxItems } : {}), ...d };
      case "number":
        return { type: "NUMBER", ...d };
      case "boolean":
        return { type: "BOOLEAN", ...d };
      case "object":
        return { ...obj(spec.fields), ...d };
    }
  };
  const obj = (fields: SchemaShape): Obj => {
    const properties: Obj = {};
    const required: string[] = [];
    for (const [k, spec] of Object.entries(fields)) {
      properties[k] = node(spec);
      if (!spec.optional) required.push(k);
    }
    return { type: "OBJECT", properties, required, propertyOrdering: Object.keys(fields) };
  };
  return obj(shape);
}

/** The shape hint the live path appends (provider.ts), for the batch prompt. */
export function batchShapeHint(shape: string): string {
  return `\n\nReturn ONLY a JSON object with this exact shape (no prose, no code fences, no wrapper key, not an array). Every top-level field is an object, even when its value is empty:\n${shape}`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runBatchAnswerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL batch-answer-core: ${label}`);
    }
  };
  const good = {
    display_name: { value: "Lemon Meringue 3.5g", confidence: 90, evidence: ["pos"], best_guess: false },
    description: { value: "Bright lemon.", confidence: 80, evidence: ["pos"], best_guess: false },
    short_description: { value: "Lemon.", confidence: 80, evidence: [], best_guess: false },
    seo: { title: "Lemon Meringue", meta: "Pick up in store.", confidence: 70, evidence: [], best_guess: false },
    sensory: { aroma_notes: ["lemon"], flavor_notes: [], terpenes: [], confidence: 60, evidence: [], best_guess: true },
    effects: { values: ["Uplifted"], confidence: 50, evidence: [], best_guess: true },
    tags: { values: [], confidence: 50, evidence: [], best_guess: true },
    strain_type: { value: "hybrid", confidence: 90, evidence: ["pos"], best_guess: false },
    potency: { thc: "24%", cbd: "", confidence: 95, evidence: ["pos"], best_guess: false },
  };
  const a = normalizeAllFieldsAnswer(good);
  ok(a.ok && !a.lifted && a.usable === 6, "a correct answer passes through unchanged");
  const w = normalizeAllFieldsAnswer({ product_all_fields: good });
  ok(w.ok && (w.value.display_name as Obj).value === "Lemon Meringue 3.5g", "unwraps {product_all_fields: …}");
  const arr = normalizeAllFieldsAnswer([good]);
  ok(arr.ok && (arr.value.potency as Obj).thc === "24%", "unwraps a one-item array");
  const s = normalizeAllFieldsAnswer(JSON.stringify({ product_all_fields: JSON.stringify(good) }));
  ok(s.ok && (s.value.description as Obj).value === "Bright lemon.", "unwraps JSON inside a string inside a wrapper");
  const flat = normalizeAllFieldsAnswer({ display_name: "Blue City Diesel 1g", description: "Diesel and citrus.", short_description: "Gassy.", seo_title: "Blue City Diesel", meta_description: "Pickup.", aroma_notes: "diesel, citrus", effects: ["Relaxed"], strain_type: "Sativa", thc: 22.1 });
  ok(flat.ok && flat.lifted, "flat answer is lifted");
  if (flat.ok) {
    const dn = flat.value.display_name as Obj;
    ok(dn.value === "Blue City Diesel 1g" && dn.confidence === LIFTED_CONFIDENCE && dn.best_guess === true && Array.isArray(dn.evidence), "flat string -> {value, low confidence, best_guess}");
    ok((flat.value.seo as Obj).title === "Blue City Diesel" && (flat.value.seo as Obj).meta === "Pickup.", "flat seo_title / meta_description -> seo");
    ok(JSON.stringify((flat.value.sensory as Obj).aroma_notes) === '["diesel","citrus"]', "comma string -> list");
    ok(JSON.stringify((flat.value.effects as Obj).values) === '["Relaxed"]', "bare array -> {values}");
    ok((flat.value.strain_type as Obj).value === "sativa" && (flat.value.potency as Obj).thc === "22.1", "strain type lower-cased, number -> text");
    ok(JSON.stringify((flat.value.tags as Obj).values) === "[]", "missing field -> empty (skipped, never invented)");
  }
  const frac = normalizeAllFieldsAnswer({ ...good, description: { value: "x", confidence: 0.85 } });
  ok(frac.ok && (frac.value.description as Obj).confidence === 85 && (frac.value.description as Obj).best_guess === false, "0.85 -> 85, stated confidence is not a guess");
  const none = normalizeAllFieldsAnswer({ foo: 1, bar: 2 });
  ok(!none.ok && none.error.includes("foo, bar"), "no draft fields -> says what Google sent");
  ok(!normalizeAllFieldsAnswer(null).ok && !normalizeAllFieldsAnswer("nope").ok && !normalizeAllFieldsAnswer([]).ok, "not an object -> plain error");
  const single = normalizeAllFieldsAnswer({ anything: good });
  ok(single.ok && single.usable === 6, "a single unknown wrapper key is peeled");
  const shp: SchemaShape = { a: { kind: "object", fields: { value: { kind: "string", maxLength: 10 }, t: { kind: "enum", values: ["indica", "unknown"] }, c: { kind: "number", min: 0, max: 100 } } } };
  const f = fitToShape(shp, { a: { value: "one two three four", t: "Indica", c: 140 } }).a as Obj;
  ok(f.value === "one two" && f.t === "indica" && f.c === 100, "clip at a word, enum case, clamp");
  ok((fitToShape(shp, { a: { value: "x", t: "cbd-ish", c: "n/a" } }).a as Obj).t === "unknown", "unknown enum -> unknown");
  const g = toGeminiResponseSchema(shp) as { type: string; properties: { a: { type: string; properties: Obj; required: string[]; propertyOrdering: string[] } } };
  ok(g.type === "OBJECT" && g.properties.a.type === "OBJECT" && JSON.stringify(g.properties.a.propertyOrdering) === '["value","t","c"]' && g.properties.a.required.length === 3, "OpenAPI subset: OBJECT, order, required");
  ok(!JSON.stringify(g).includes("additionalProperties") && JSON.stringify(g.properties.a.properties.t).includes('"enum":["indica","unknown"]'), "no additionalProperties; enums kept");
  ok(batchShapeHint("- a: string").includes("not an array") && batchShapeHint("- a: string").endsWith("- a: string"), "shape hint");
  return { passed, failed };
}
