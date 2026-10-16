/**
 * src/lib/catalog/lookup-snapshot-core.ts   (R66 slice 2)   PURE - no I/O.
 *
 * Owner (R66): the batch "is far far less effective at finding and presenting
 * product facts than the ai lookup feature on the products row".
 *
 * One cause was PRESENTATION: the batch kept only counts and a sentence
 * (lookup_job_items.result_json), so everything the lookup found that did not
 * attach or become a pending suggestion (category, size, cannabinoids, the
 * description when below the bar, images, the field-by-field evidence ...)
 * was thrown away. The row panel shows all of it.
 *
 * This file keeps a SNAPSHOT of the same result the row panel receives, so the
 * row's AI Lookup panel opens on the batch's findings - the same curation
 * worksheet, the same "Save selected" (which re-sanitizes on the server).
 *
 * WHAT IS STORED (and what is NOT) - Google "Grounding with Google Search"
 * terms: Search Suggestions are never stored, and grounded results may only
 * be shown to the person who asked. We store ONLY the compliance-gated field
 * values, their confidences and source URLs (the same things a row lookup
 * already writes into suggestions / the knowledge base), as this shop's own
 * lookup history, shown only inside its admin. Never the suggestion HTML,
 * never the cited text, never the model's raw reply.
 *
 * EVERY READ IS DEFENSIVE: result_json is a jsonb column anyone with database
 * access could edit, so parseLookupSnapshot re-validates every value through
 * the same strict validators a live reply goes through (normalizeLookup) and
 * caps every string and list. A junk row yields null, never a crash.
 */
import { LOOKUP_FIELD_KEYS, fieldConfidenceForSave, normalizeLookup, type LookupFacts, type LookupFieldKey, type RawLookupV2 } from "@/lib/inventory/lookup-facts-core";
import { factConfidenceFromFacts } from "@/lib/catalog/attach-plan-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** Bump when the stored shape changes incompatibly (old rows then read as null). */
export const LOOKUP_SNAPSHOT_VERSION = 1;
/** The whole snapshot as JSON never exceeds this; past it the evidence table is dropped, then long text trimmed. */
export const LOOKUP_SNAPSHOT_MAX_BYTES = 48_000;

const STRAIN_TYPES: readonly GreenwayStrainType[] = ["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd", "unknown"];
const SCHEMAS = ["v2", "v1", "memory"] as const;
export type LookupSnapshotSchema = (typeof SCHEMAS)[number];

/** The fields of the row action's result the panel draws (minus suggestions, citations, policy). */
export interface LookupSnapshot {
  v: number;
  /** When the lookup ran (ISO), for "from the batch lookup on ...". */
  at: string;
  found: boolean;
  confidence: number;
  hasAnyFindings: boolean;
  strainType: GreenwayStrainType;
  strainTypeConfidence: number;
  autofillStrainType: boolean;
  summary: string;
  effects: string[];
  rejectedEffects: { effect: string; reason: string }[];
  aromaNotes: string[];
  flavorNotes: string[];
  lineage: string;
  terpenes: string[];
  sources: string[];
  model: string;
  usedWebSearch: boolean;
  hasKbDraft: boolean;
  description: string;
  shortDescription: string;
  category: string;
  potencyRatio: string;
  size: string;
  imageCandidates: string[];
  hasEnrichmentDraft: boolean;
  schema: LookupSnapshotSchema;
  facts: LookupFacts | null;
  /** S09: set when no web lookup ran (every fact already on file). */
  memory: { covered: string[]; missing: string[]; notice: string } | null;
}

/** What runOneItem has after a lookup (the shape of ProductLookupResult + outcome). */
export interface SnapshotInput {
  at: string;
  result: {
    found: boolean;
    confidence: number;
    hasAnyFindings: boolean;
    strainType: string;
    strainTypeConfidence: number;
    autofillStrainType: boolean;
    summary: string;
    effects: string[];
    rejectedEffects: { effect: string; reason: string }[];
    aromaNotes: string[];
    flavorNotes: string[];
    lineage: string;
    terpenes: string[];
    hasKbDraft: boolean;
    description: string;
    shortDescription: string;
    category: string;
    potencyRatio: string;
    size: string;
    imageCandidates: string[];
    hasEnrichmentDraft: boolean;
  };
  sources: readonly string[];
  model: string;
  usedWebSearch: boolean;
  facts: LookupFacts | null;
  schema: string;
  memory?: { covered: readonly string[]; missing: readonly string[]; notice: string } | null;
}

// ─── small strict readers ───────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function bool(v: unknown): boolean {
  return v === true;
}
function pct(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}
function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    if (typeof it !== "string") continue;
    const t = it.trim();
    if (!t || t.length > maxLen || out.includes(t)) continue;
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}
function httpUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v.trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
function urls(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const u = httpUrl(it);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}
function strainType(v: unknown): GreenwayStrainType {
  return typeof v === "string" && (STRAIN_TYPES as readonly string[]).includes(v) ? (v as GreenwayStrainType) : "unknown";
}
function rejected(v: unknown): { effect: string; reason: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { effect: string; reason: string }[] = [];
  for (const it of v) {
    if (!isObj(it)) continue;
    const effect = str(it.effect, 60);
    if (!effect) continue;
    out.push({ effect, reason: str(it.reason, 200) });
    if (out.length >= 25) break;
  }
  return out;
}

// ─── facts (compact on disk, re-validated on read) ──────────────────────────

type CompactFact = { v?: unknown; c?: number | null; s?: string[]; ci?: string[]; w?: string };
type CompactFacts = {
  found: boolean;
  oc: number | null;
  rc: string[];
  re: { effect: string; reason: string }[];
  f: Partial<Record<LookupFieldKey, CompactFact>>;
};

function compactFacts(facts: LookupFacts): CompactFacts {
  const f: Partial<Record<LookupFieldKey, CompactFact>> = {};
  for (const k of LOOKUP_FIELD_KEYS) {
    const x = facts.fields[k];
    if (!x) continue;
    if (x.value === null && !x.withheld) continue;
    const c: CompactFact = {};
    if (x.value !== null) c.v = x.value;
    if (x.confidence !== null) c.c = x.confidence;
    if (x.sources.length) c.s = x.sources.slice(0, 5);
    if (x.cited.length) c.ci = x.cited.slice(0, 5);
    if (x.withheld) c.w = x.withheld === "compliance" ? "compliance" : "withheld";
    f[k] = c;
  }
  return { found: facts.found, oc: facts.overallConfidence, rc: facts.recordCitations.slice(0, 20), re: facts.rejectedEffects.slice(0, 25), f };
}

/** Compact facts -> LookupFacts through the SAME strict validators a live reply uses. */
function readFacts(raw: unknown): LookupFacts | null {
  if (!isObj(raw) || !isObj(raw.f)) return null;
  const f = raw.f as Record<string, unknown>;
  const rawV2: Record<string, unknown> = { found: raw.found === true, overall_confidence: raw.oc };
  for (const k of LOOKUP_FIELD_KEYS) {
    const c = f[k];
    if (!isObj(c)) continue;
    rawV2[k] = { value: c.w ? null : c.v, confidence: c.c, sources: c.s };
  }
  const facts = normalizeLookup(rawV2 as RawLookupV2);
  for (const k of LOOKUP_FIELD_KEYS) {
    const c = f[k];
    if (!isObj(c)) continue;
    const fact = facts.fields[k];
    if (c.w && fact.value === null) fact.withheld = c.w === "compliance" ? "compliance" : "withheld";
    else if (fact.value !== null) fact.cited = urls(c.ci, 5);
  }
  facts.recordCitations = urls(raw.rc, 20);
  facts.rejectedEffects = rejected(raw.re);
  return facts;
}

// ─── build + parse ──────────────────────────────────────────────────────────

/** Fields a lookup found a value for (every field, not only the attachable ones). */
export function snapshotFoundCount(s: Pick<LookupSnapshot, "facts" | "strainType" | "summary" | "effects" | "aromaNotes" | "flavorNotes" | "lineage" | "terpenes" | "description" | "shortDescription" | "category" | "potencyRatio" | "size" | "imageCandidates">): number {
  if (s.facts) {
    let n = 0;
    for (const k of LOOKUP_FIELD_KEYS) if (s.facts.fields[k]?.value != null) n += 1;
    return n;
  }
  const parts: boolean[] = [
    s.strainType !== "unknown",
    Boolean(s.summary),
    s.effects.length > 0,
    s.aromaNotes.length > 0,
    s.flavorNotes.length > 0,
    Boolean(s.lineage),
    s.terpenes.length > 0,
    Boolean(s.description),
    Boolean(s.shortDescription),
    Boolean(s.category),
    Boolean(s.potencyRatio),
    Boolean(s.size),
    s.imageCandidates.length > 0,
  ];
  return parts.filter(Boolean).length;
}

/** The plain object to store in result_json.snapshot (JSON-safe, capped). */
export function buildLookupSnapshot(input: SnapshotInput): Record<string, unknown> {
  const r = input.result;
  const memory = input.memory
    ? { covered: strList(input.memory.covered as unknown, 30, 60), missing: strList(input.memory.missing as unknown, 30, 60), notice: str(input.memory.notice, 600) }
    : null;
  const snap: Record<string, unknown> = {
    v: LOOKUP_SNAPSHOT_VERSION,
    at: str(input.at, 40),
    found: bool(r.found),
    confidence: pct(r.confidence),
    hasAnyFindings: bool(r.hasAnyFindings),
    strainType: strainType(r.strainType),
    strainTypeConfidence: pct(r.strainTypeConfidence),
    autofillStrainType: bool(r.autofillStrainType),
    summary: str(r.summary, 1200),
    effects: strList(r.effects, 25, 40),
    rejectedEffects: rejected(r.rejectedEffects),
    aromaNotes: strList(r.aromaNotes, 25, 40),
    flavorNotes: strList(r.flavorNotes, 25, 40),
    lineage: str(r.lineage, 300),
    terpenes: strList(r.terpenes, 12, 40),
    sources: urls(input.sources as unknown, 20),
    model: str(input.model, 120),
    usedWebSearch: bool(input.usedWebSearch),
    hasKbDraft: bool(r.hasKbDraft),
    description: str(r.description, 4000),
    shortDescription: str(r.shortDescription, 200),
    category: str(r.category, 40),
    potencyRatio: str(r.potencyRatio, 40),
    size: str(r.size, 40),
    imageCandidates: urls(r.imageCandidates, 12),
    hasEnrichmentDraft: bool(r.hasEnrichmentDraft),
    schema: (SCHEMAS as readonly string[]).includes(input.schema) ? input.schema : "v1",
    facts: input.facts ? compactFacts(input.facts) : null,
    memory,
  };
  // Size cap: drop the evidence table first, then trim the long text.
  if (JSON.stringify(snap).length > LOOKUP_SNAPSHOT_MAX_BYTES) snap.facts = null;
  if (JSON.stringify(snap).length > LOOKUP_SNAPSHOT_MAX_BYTES) {
    snap.description = String(snap.description).slice(0, 1000);
    snap.summary = String(snap.summary).slice(0, 600);
  }
  return snap;
}

/** Defensive read of result_json.snapshot. Null for an old row, a junk row or another version. */
export function parseLookupSnapshot(raw: unknown): LookupSnapshot | null {
  if (!isObj(raw) || raw.v !== LOOKUP_SNAPSHOT_VERSION) return null;
  const schema = (SCHEMAS as readonly string[]).includes(raw.schema as string) ? (raw.schema as LookupSnapshotSchema) : "v1";
  const mem = isObj(raw.memory)
    ? { covered: strList(raw.memory.covered, 30, 60), missing: strList(raw.memory.missing, 30, 60), notice: str(raw.memory.notice, 600) }
    : null;
  return {
    v: LOOKUP_SNAPSHOT_VERSION,
    at: str(raw.at, 40),
    found: bool(raw.found),
    confidence: pct(raw.confidence),
    hasAnyFindings: bool(raw.hasAnyFindings),
    strainType: strainType(raw.strainType),
    strainTypeConfidence: pct(raw.strainTypeConfidence),
    autofillStrainType: bool(raw.autofillStrainType),
    summary: str(raw.summary, 1200),
    effects: strList(raw.effects, 25, 40),
    rejectedEffects: rejected(raw.rejectedEffects),
    aromaNotes: strList(raw.aromaNotes, 25, 40),
    flavorNotes: strList(raw.flavorNotes, 25, 40),
    lineage: str(raw.lineage, 300),
    terpenes: strList(raw.terpenes, 12, 40),
    sources: urls(raw.sources, 20),
    model: str(raw.model, 120),
    usedWebSearch: bool(raw.usedWebSearch),
    hasKbDraft: bool(raw.hasKbDraft),
    description: str(raw.description, 4000),
    shortDescription: str(raw.shortDescription, 200),
    category: str(raw.category, 40),
    potencyRatio: str(raw.potencyRatio, 40),
    size: str(raw.size, 40),
    imageCandidates: urls(raw.imageCandidates, 12),
    hasEnrichmentDraft: bool(raw.hasEnrichmentDraft),
    schema,
    facts: schema === "v2" ? readFacts(raw.facts) : null,
    memory: mem,
  };
}

/**
 * The snapshot as the row action's result (ProductLookupActionResult ok:true),
 * so the row's AI Lookup panel draws the batch's findings with the SAME
 * worksheet and the same "Save selected" payload. Never stored, so no Search
 * Suggestions and no citation text; no policy preview (the batch already
 * applied the policy when it ran - the row line says what attached).
 */
export function snapshotToLookupResult(
  s: LookupSnapshot,
  ctx: { honestMiss: string; name: string; posProductKey: string },
) {
  return {
    ok: true as const,
    found: s.found,
    confidence: s.confidence,
    hasAnyFindings: s.hasAnyFindings,
    strainType: s.strainType,
    strainTypeConfidence: s.strainTypeConfidence,
    autofillStrainType: s.autofillStrainType,
    summary: s.summary,
    effects: s.effects,
    rejectedEffects: s.rejectedEffects,
    aromaNotes: s.aromaNotes,
    flavorNotes: s.flavorNotes,
    lineage: s.lineage,
    terpenes: s.terpenes,
    sources: s.sources,
    model: s.model,
    usedWebSearch: s.usedWebSearch,
    hasKbDraft: s.hasKbDraft,
    honestMiss: ctx.honestMiss,
    description: s.description,
    shortDescription: s.shortDescription,
    category: s.category,
    potencyRatio: s.potencyRatio,
    size: s.size,
    imageCandidates: s.imageCandidates,
    hasEnrichmentDraft: s.hasEnrichmentDraft,
    facts: s.facts,
    schema: s.schema,
    citations: [] as { url: string; title?: string; citedText?: string }[],
    searchSuggestions: [] as string[],
    draft: {
      name: ctx.name,
      strainType: s.strainType,
      strainTypeConfidence: s.strainTypeConfidence,
      summary: s.summary,
      effects: s.effects,
      aromaNotes: s.aromaNotes,
      flavorNotes: s.flavorNotes,
      lineage: s.lineage,
      terpenes: s.terpenes,
      sources: s.sources,
      posProductKey: ctx.posProductKey,
      description: s.description,
      shortDescription: s.shortDescription,
      category: s.category,
      potencyRatio: s.potencyRatio,
      size: s.size,
      imageCandidates: s.imageCandidates,
      fieldConfidence: fieldConfidenceForSave(s.facts),
      factConfidence: factConfidenceFromFacts(s.facts),
    },
    policy: null,
    memory: s.memory ? { skipped: true, refresh: false, covered: s.memory.covered, missing: s.memory.missing, notice: s.memory.notice } : null,
  };
}

/** The closed panel's button: says the batch already found something to look at. */
export function snapshotButtonLabel(s: LookupSnapshot | null): string {
  if (!s) return "AI Lookup";
  if (!s.hasAnyFindings) return "AI Lookup \u00b7 batch found nothing";
  const n = snapshotFoundCount(s);
  return n > 0 ? `AI Lookup \u00b7 batch found ${n === 1 ? "1 fact" : `${n} facts`}` : "AI Lookup \u00b7 see the batch result";
}

/** The note above the batch's findings in the open panel. */
export function snapshotNote(s: LookupSnapshot, when: string): string {
  const at = when ? ` on ${when}` : "";
  return `From the batch lookup${at}. Keep, edit and Save selected exactly as with a row search, or press Search to look again.`;
}

/** "Oct 3, 2026, 2:15 PM" style, or "" for a junk date (never invents one). */
export function snapshotWhen(at: string, timeZone = "America/Los_Angeles"): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t));
  } catch {
    return "";
  }
}

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runLookupSnapshotCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`lookup-snapshot-core FAIL: ${label}`);
    }
  };

  const facts = normalizeLookup({
    found: true,
    overall_confidence: 88,
    strain_type: { value: "hybrid", confidence: 92, sources: ["https://brand.example/p", "javascript:alert(1)"] },
    category: { value: "Flower", confidence: 95 },
    size: { value: { amount: 3.5, uom: "grams" }, confidence: 80 },
    cannabinoids: { value: { thc_pct: 24.1, ratio: "x" }, confidence: 70 },
    terpenes: { value: [{ name: "Myrcene", pct: 1.2 }, "Limonene"], confidence: 65 },
    images: { value: ["https://cdn.example/a.jpg"], confidence: 60 },
    description: { value: "A bright, citrus-forward flower.", confidence: 75 },
  } as RawLookupV2);
  facts.fields.effects = { value: null, confidence: 80, band: "unknown", sources: [], cited: [], withheld: "compliance" };
  facts.fields.description.cited = ["https://review.example/x"];
  facts.recordCitations = ["https://rec.example/1"];
  facts.rejectedEffects = [{ effect: "cures pain", reason: "medical claim" }];

  const input: SnapshotInput = {
    at: "2026-10-03T21:15:00.000Z",
    result: {
      found: true, confidence: 88, hasAnyFindings: true, strainType: "hybrid", strainTypeConfidence: 92, autofillStrainType: true,
      summary: "Citrus.", effects: ["relaxed", "relaxed", 7 as unknown as string], rejectedEffects: [{ effect: "cures pain", reason: "medical claim" }],
      aromaNotes: ["citrus"], flavorNotes: [], lineage: "A x B", terpenes: ["myrcene", "limonene"], hasKbDraft: true,
      description: "A bright, citrus-forward flower.", shortDescription: "Bright.", category: "flower", potencyRatio: "", size: "3.5g",
      imageCandidates: ["https://cdn.example/a.jpg", "ftp://x.example/b.jpg", "not a url"], hasEnrichmentDraft: true,
    },
    sources: ["https://brand.example/p", "https://brand.example/p", "data:text/html,x"],
    model: "gemini-3.8-flash",
    usedWebSearch: true,
    facts,
    schema: "v2",
  };
  const built = buildLookupSnapshot(input);
  const json = JSON.stringify(built);
  ok(!/searchSuggestions|citedText|<div|<style/i.test(json), "no suggestions / cited text / html stored");
  ok(built.v === 1 && built.schema === "v2", "version + schema");
  const back = parseLookupSnapshot(JSON.parse(json));
  ok(back !== null, "round trip parses");
  if (back) {
    ok(back.strainType === "hybrid" && back.strainTypeConfidence === 92 && back.autofillStrainType === true, "strain round trip");
    ok(back.effects.join(",") === "relaxed", "list deduped + junk dropped");
    ok(back.sources.length === 1 && back.sources[0] === "https://brand.example/p", "sources: http(s) only, deduped");
    ok(back.imageCandidates.length === 1, "images: http(s) only");
    ok(back.size === "3.5g" && back.category === "flower" && back.terpenes.length === 2, "v1 fields kept");
    ok(back.facts !== null && back.facts.fields.category.value === "flower" && back.facts.fields.category.confidence === 95, "facts: category kept (re-validated)");
    ok(back.facts?.fields.size.value?.uom === "g" && back.facts.fields.size.value.amount === 3.5, "facts: size kept");
    ok(back.facts?.fields.cannabinoids.value?.thc_pct === 24.1 && back.facts.fields.cannabinoids.value.ratio === null, "facts: cannabinoids kept, junk ratio dropped");
    ok(back.facts?.fields.terpenes.value?.length === 2 && back.facts.fields.terpenes.value[0].pct === 1.2, "facts: terpenes kept");
    ok(back.facts?.fields.strain_type.sources.length === 1, "facts: unsafe source url dropped");
    ok(back.facts?.fields.effects.withheld === "compliance" && back.facts.fields.effects.value === null, "facts: withheld stays withheld");
    ok(back.facts?.fields.description.cited[0] === "https://review.example/x", "facts: cited urls kept");
    ok(back.facts?.recordCitations[0] === "https://rec.example/1" && back.facts.rejectedEffects[0]?.effect === "cures pain", "facts: record citations + rejected kept");
    ok(back.facts?.found === true && back.facts.overallConfidence === 88, "facts: found + overall");
    ok(back.facts?.counts.auto === 2, "facts: bands recounted (strain 92 + category 95 = 2 auto)");
    ok(snapshotFoundCount(back) === 7, "found count = fields with a value (7)");
  }
  // a withheld field cannot be smuggled back in by editing the row
  const tampered = JSON.parse(json);
  tampered.facts.f.effects.v = ["cures everything"];
  ok(parseLookupSnapshot(tampered)?.facts?.fields.effects.value === null, "tampered withheld value ignored");
  tampered.facts.f.category.v = "<script>";
  ok(parseLookupSnapshot(tampered)?.facts?.fields.category.value === "<script>".toLowerCase(), "category text is plain text (rendered escaped by React)");
  tampered.strainType = "purple";
  tampered.confidence = 900;
  tampered.description = "x".repeat(9000);
  const t2 = parseLookupSnapshot(tampered);
  ok(t2?.strainType === "unknown" && t2.confidence === 100 && t2.description.length === 4000, "junk strain / pct / length clamped");
  // junk rows
  ok(parseLookupSnapshot(null) === null && parseLookupSnapshot([]) === null && parseLookupSnapshot("x") === null, "junk = null");
  ok(parseLookupSnapshot({ v: 2 }) === null && parseLookupSnapshot({}) === null, "other version / old row = null");
  const minimal = parseLookupSnapshot({ v: 1 });
  ok(minimal !== null && minimal.facts === null && minimal.schema === "v1" && minimal.effects.length === 0 && snapshotFoundCount(minimal) === 0, "minimal row is safe");
  ok(parseLookupSnapshot({ v: 1, schema: "v2", facts: "junk" })?.facts === null, "junk facts = null");
  ok(parseLookupSnapshot({ v: 1, schema: "v1", facts: built.facts })?.facts === null, "facts only read on a v2 row");
  // v1 found count
  ok(snapshotFoundCount({ ...minimal!, strainType: "indica", summary: "s", size: "1g", imageCandidates: ["https://a.example/x.jpg"] }) === 4, "v1 found count");
  // memory
  const mem = parseLookupSnapshot(buildLookupSnapshot({ ...input, facts: null, schema: "memory", memory: { covered: ["effects", "effects"], missing: [], notice: "Known." } }));
  ok(mem?.schema === "memory" && mem.memory?.notice === "Known." && mem.memory.covered.length === 1 && mem.facts === null, "memory snapshot");
  ok(buildLookupSnapshot({ ...input, schema: "weird" }).schema === "v1", "unknown schema = v1");
  // size cap
  const huge = buildLookupSnapshot({
    ...input,
    result: { ...input.result, description: "d".repeat(4000) },
    facts: { ...facts, fields: { ...facts.fields, brand_description: { value: "b".repeat(2000), confidence: 50, band: "reject", sources: [], cited: [] }, description: { ...facts.fields.description, value: "e".repeat(4000) } } },
  });
  ok(JSON.stringify(huge).length <= LOOKUP_SNAPSHOT_MAX_BYTES, "snapshot stays within the size cap");
  ok(LOOKUP_SNAPSHOT_MAX_BYTES >= 20_000, "cap leaves room for a full normal result");
  // when
  ok(snapshotWhen("2026-10-03T21:15:00.000Z") === "Oct 3, 2026, 2:15 PM", "when (Pacific)");
  ok(snapshotWhen("junk") === "" && snapshotWhen("") === "", "junk when = empty");

  // row-panel result
  if (back) {
    const view = snapshotToLookupResult(back, { honestMiss: "miss", name: "Blue Dream 3.5g", posProductKey: "K1" });
    ok(view.ok === true && view.searchSuggestions.length === 0 && view.citations.length === 0 && view.policy === null, "view: no suggestions / citations / policy");
    ok(view.draft.name === "Blue Dream 3.5g" && view.draft.posProductKey === "K1" && view.honestMiss === "miss", "view: context carried");
    ok(view.draft.factConfidence.strain_type === 92 && view.draft.fieldConfidence.description === 75, "view: own confidences carried for Save selected");
    ok(view.facts === back.facts && view.category === "flower" && view.size === "3.5g" && view.memory === null, "view: fields carried");
    ok(snapshotButtonLabel(back) === "AI Lookup \u00b7 batch found 7 facts" && snapshotButtonLabel(null) === "AI Lookup", "button label");
  }
  ok(snapshotToLookupResult(mem!, { honestMiss: "", name: "", posProductKey: "" }).memory?.skipped === true, "view: memory answer says no web lookup ran");
  ok(snapshotButtonLabel(minimal) === "AI Lookup \u00b7 batch found nothing", "button label: nothing");
  ok(snapshotButtonLabel({ ...minimal!, hasAnyFindings: true }) === "AI Lookup \u00b7 see the batch result", "button label: findings, no count");
  ok(snapshotButtonLabel({ ...minimal!, hasAnyFindings: true, size: "1g" }) === "AI Lookup \u00b7 batch found 1 fact", "button label singular");
  ok(snapshotNote(minimal!, "Oct 3").startsWith("From the batch lookup on Oct 3.") && snapshotNote(minimal!, "").startsWith("From the batch lookup."), "note");

  return { passed, failed };
}
