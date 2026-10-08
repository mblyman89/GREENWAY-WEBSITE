/**
 * src/lib/catalog/attach-facts-core.ts  (S08 — Phase 2, Ring 0)
 *
 * The TypeScript half of migration 0235_attached_facts.sql. Pure: plain data
 * in, plain data out. No fs, no network, no Supabase.
 *
 * ═══ WHY ═══
 *
 * 0235 gives a draft a home for the facts married to it
 * (catalog_product_drafts.attached_facts / attached_facts_provenance) and adds
 * an append-only trail of every fact write (product_fact_provenance). Nothing
 * writes either yet. S07 (attachProductFacts, the single write door) is the
 * first writer and S11 (the onboarding row) the first reader. This module is
 * the contract both will build on, so they cannot disagree about:
 *
 *   1. the SOURCE vocabulary. FACT_SOURCES is pinned against the SQL check
 *      constraint pfp_source_known by tests/compliance/attached-facts-schema
 *      .test.ts, both ways. A source the DB rejects can never be typed here,
 *      and a source the DB accepts can never be missing here.
 *   2. the CONFIDENCE scale. The S06 lookup reports 0-100; every confidence
 *      column in this schema (ai_suggestions 0018, kb_products 0071, potency
 *      0084, and now 0235) stores 0..1. toStoredConfidence() is the one
 *      converter, and it refuses rather than clamps: 150% is a bug to
 *      surface, not a 100% to store.
 *   3. what a valid provenance row IS. buildProvenanceRow() mirrors every
 *      0235 CHECK (source, non-blank identity, snake_case field, 0..1
 *      confidence), so a writer learns "no" in TypeScript with a reason
 *      instead of from a 23514 in production.
 *   4. whether an error means "0235 is not applied yet".
 *      isMissingAttachedFactsError() is deliberately NARROW (0234 precedent):
 *      only OUR columns / OUR table. Any other missing column is a real bug.
 *
 * ═══ WHAT IS DELIBERATELY NOT HERE ═══
 *
 * Precedence (which source wins when two disagree). The 0235 column comment
 * records the owner-facing order the bible gives:
 *   human > coa/manifest > kb_published > gemini (auto ≥90) > gemini (review).
 * The bible does not place kb_draft, remembered or cultivera in that order,
 * so ranking them here would be a guess. The policy belongs to S07 / S10
 * (FIELD_POLICY), which own the decision and its tests.
 */

import { identityKeyForStorage } from "./identity-columns-core";

// ─── 1. Vocabulary ────────────────────────────────────────────────────────

/** The migration this module mirrors. */
export const ATTACHED_FACTS_MIGRATION = "0235_attached_facts.sql";

/**
 * Every allowed product_fact_provenance.source, in the order the 0235 CHECK
 * lists them. Pinned against the SQL both ways.
 */
export const FACT_SOURCES = [
  "manifest",
  "coa",
  "kb_published",
  "kb_draft",
  "gemini",
  "human",
  "remembered",
  "cultivera",
] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

const SOURCE_SET: ReadonlySet<string> = new Set(FACT_SOURCES);

/** Exact, case-sensitive: "Gemini" and " gemini" are rejected by the DB too. */
export function isFactSource(v: unknown): v is FactSource {
  return typeof v === "string" && SOURCE_SET.has(v);
}

/**
 * The CHECK body 0235 must contain, generated from FACT_SOURCES. The schema
 * test asserts the migration carries exactly this list.
 */
export function sourceCheckSqlList(): string {
  return FACT_SOURCES.map((s) => `'${s}'`).join(", ");
}

/** The two jsonb columns 0235 adds to catalog_product_drafts. */
export const DRAFT_FACT_COLUMNS = ["attached_facts", "attached_facts_provenance"] as const;

/** The provenance table, and its columns in migration order (named selects). */
export const PROVENANCE_TABLE = "product_fact_provenance";
export const PROVENANCE_COLUMNS = [
  "id",
  "identity_key",
  "kb_product_id",
  "draft_id",
  "lot_id",
  "pos_product_key",
  "field",
  "value_json",
  "source",
  "confidence",
  "source_urls",
  "actor_id",
  "created_at",
] as const;

/** Named select list for readers (usage rule: never select *). */
export const PROVENANCE_SELECT = PROVENANCE_COLUMNS.join(", ");

/** Mirrors CHECK pfp_field_key: lowercase snake_case, starts with a letter. */
export const FACT_FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export function isFactFieldKey(v: unknown): v is string {
  return typeof v === "string" && FACT_FIELD_KEY_RE.test(v);
}

/** Upper bound on source_urls per row. Same ceiling as S06's citation cap. */
export const MAX_SOURCE_URLS = 20;

// ─── 2. Shapes ────────────────────────────────────────────────────────────

/** One fact married to a draft: catalog_product_drafts.attached_facts[field]. */
export interface AttachedFact {
  value: unknown;
  source: FactSource;
  /** 0..1, or null when the source carries no confidence (human, manifest). */
  confidence: number | null;
  /** ISO timestamp of the write. */
  at: string;
}

/** catalog_product_drafts.attached_facts */
export type AttachedFacts = Record<string, AttachedFact>;

/** Who / what / when behind one attached fact: attached_facts_provenance[field]. */
export interface FactProvenance {
  source: FactSource;
  confidence: number | null;
  at: string;
  /** staff user id, or null for a machine write. */
  by: string | null;
  urls: string[];
}

/** catalog_product_drafts.attached_facts_provenance */
export type AttachedFactsProvenance = Record<string, FactProvenance>;

/** The insert payload for product_fact_provenance (id / created_at are DB defaults). */
export interface ProductFactProvenanceInsert {
  identity_key: string;
  kb_product_id: string | null;
  draft_id: string | null;
  lot_id: string | null;
  pos_product_key: string | null;
  field: string;
  value_json: unknown;
  source: FactSource;
  confidence: number | null;
  source_urls: string[] | null;
  actor_id: string | null;
}

/** A row as read back (named select of PROVENANCE_COLUMNS). */
export interface ProductFactProvenanceRow extends ProductFactProvenanceInsert {
  id: string;
  created_at: string;
}

// ─── 3. Confidence ────────────────────────────────────────────────────────

/**
 * 0-100 (the S06 lookup scale) → 0..1 (the stored scale), rounded to 4 dp.
 * Returns null for null/undefined/blank (no confidence) AND for anything that
 * is not a finite number in [0, 100]. It never clamps: an out-of-range number
 * means a writer mixed up the scales, and storing 1.0 would hide that.
 */
export function toStoredConfidence(pct: unknown): number | null {
  if (pct === null || pct === undefined) return null;
  if (typeof pct === "string" && pct.trim() === "") return null;
  const n = typeof pct === "number" ? pct : typeof pct === "string" ? Number(pct) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 10000;
}

/** Mirrors CHECK pfp_confidence_unit. */
export function isStoredConfidence(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
}

// ─── 4. Row builder (mirrors every 0235 CHECK) ────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optUuid(v: unknown): string | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : "bad";
}

function cleanUrls(urls: unknown): string[] | null {
  if (!Array.isArray(urls)) return null;
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!/^https?:\/\/\S+$/i.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= MAX_SOURCE_URLS) break;
  }
  return out.length ? out : null;
}

export interface ProvenanceInput {
  identityKey: string | null | undefined;
  field: string;
  value: unknown;
  source: string;
  /** Already on the stored 0..1 scale. Use toStoredConfidence() on S06 numbers. */
  confidence?: number | null;
  urls?: readonly unknown[] | null;
  kbProductId?: string | null;
  draftId?: string | null;
  lotId?: string | null;
  posProductKey?: string | null;
  actorId?: string | null;
}

export type ProvenanceBuild =
  | { ok: true; row: ProductFactProvenanceInsert }
  | { ok: false; reason: string };

/**
 * One product_fact_provenance insert, or a plain reason it would be rejected.
 * Never throws and never mutates the input. `value` must survive JSON
 * (undefined, functions, NaN and cycles would be silently changed by the
 * driver, so they are refused here instead).
 */
export function buildProvenanceRow(input: ProvenanceInput): ProvenanceBuild {
  const identity = identityKeyForStorage(input.identityKey);
  if (identity === null) return { ok: false, reason: "no product identity (0234 doctrine: identity is never blank)" };
  if (!isFactFieldKey(input.field)) return { ok: false, reason: `field "${String(input.field)}" is not a snake_case fact key` };
  if (!isFactSource(input.source)) return { ok: false, reason: `source "${String(input.source)}" is not one of ${FACT_SOURCES.join(", ")}` };
  const confidence = input.confidence ?? null;
  if (!isStoredConfidence(confidence)) {
    return { ok: false, reason: `confidence ${String(confidence)} is not on the 0..1 scale (use toStoredConfidence for 0-100)` };
  }
  let valueJson: unknown;
  try {
    if (input.value === undefined || (typeof input.value === "number" && !Number.isFinite(input.value))) throw new Error();
    const s = JSON.stringify(input.value);
    if (s === undefined) throw new Error();
    valueJson = JSON.parse(s);
  } catch {
    return { ok: false, reason: "value is not JSON-serialisable" };
  }
  const ids: Record<string, string | null> = {};
  for (const [k, v] of [
    ["kb_product_id", input.kbProductId],
    ["draft_id", input.draftId],
    ["lot_id", input.lotId],
    ["actor_id", input.actorId],
  ] as const) {
    const u = optUuid(v);
    if (u === "bad") return { ok: false, reason: `${k} is not a uuid` };
    ids[k] = u;
  }
  const pos = typeof input.posProductKey === "string" && input.posProductKey.trim() !== "" ? input.posProductKey.trim() : null;
  return {
    ok: true,
    row: {
      identity_key: identity,
      kb_product_id: ids.kb_product_id,
      draft_id: ids.draft_id,
      lot_id: ids.lot_id,
      pos_product_key: pos,
      field: input.field,
      value_json: valueJson,
      source: input.source,
      confidence,
      source_urls: cleanUrls(input.urls),
      actor_id: ids.actor_id,
    },
  };
}

/**
 * Latest row per field (the S09 recall shape), from rows in ANY order.
 * Ties on created_at keep the first seen, so the result is deterministic for
 * a given input order. An unparseable created_at never wins over a valid one.
 */
export function latestByField(rows: readonly Pick<ProductFactProvenanceRow, "field" | "created_at">[]): Map<string, number> {
  const best = new Map<string, { i: number; t: number }>();
  rows.forEach((r, i) => {
    const t = Date.parse(r.created_at);
    const tt = Number.isFinite(t) ? t : -Infinity;
    const cur = best.get(r.field);
    if (!cur || tt > cur.t) best.set(r.field, { i, t: tt });
  });
  const out = new Map<string, number>();
  for (const [f, v] of best) out.set(f, v.i);
  return out;
}

// ─── 4b. The draft's own copy (S11) ───────────────────────────────────────────

/** One fact that really landed live in this save (the door's step 4 set). */
export interface LandedDraftFact {
  field: string;
  value: unknown;
  source: FactSource;
  /** 0..1, or null. */
  confidence: number | null;
}

/** Named select for the draft's two fact columns (never select *). */
export const DRAFT_FACT_SELECT = DRAFT_FACT_COLUMNS.join(", ");

export interface DraftFactsMerge {
  /** The update payload, keyed by DRAFT_FACT_COLUMNS; null = nothing to write. */
  patch: Record<(typeof DRAFT_FACT_COLUMNS)[number], unknown> | null;
  written: string[];
  /** Fields left alone because a PERSON already set them on this draft. */
  keptHuman: string[];
  /**
   * R30: fields left alone because the LAB CERTIFICATE already set them
   * (source "coa") and the incoming value is a lower-trust machine source
   * (a web lookup, the KB, memory). MDM survivorship: source priority first.
   */
  keptLab: string[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/**
 * Merge this save's landed facts into the draft's attached_facts pair.
 * Survivorship (0235 column comment): a value a person set on the draft
 * (source "human") is never replaced by a machine source; anything else is
 * replaced by the newer landed value. Entries for other fields are kept as
 * they were. Invalid entries (bad field key / source / confidence, or a value
 * that is not JSON) are skipped, so a bad input can never corrupt the column.
 * Pure: never mutates its inputs.
 */
export function mergeDraftAttachedFacts(input: {
  existingFacts: unknown;
  existingProvenance: unknown;
  landed: readonly LandedDraftFact[];
  at: string;
  by: string | null;
  urls: readonly unknown[];
}): DraftFactsMerge {
  const facts = asRecord(input.existingFacts);
  const prov = asRecord(input.existingProvenance);
  const written: string[] = [];
  const keptHuman: string[] = [];
  const keptLab: string[] = [];
  const urls = cleanUrls(input.urls) ?? [];
  for (const l of input.landed) {
    if (!isFactFieldKey(l.field) || !isFactSource(l.source) || !isStoredConfidence(l.confidence ?? null)) continue;
    let value: unknown;
    try {
      if (l.value === undefined) continue;
      const s = JSON.stringify(l.value);
      if (s === undefined) continue;
      value = JSON.parse(s);
    } catch {
      continue;
    }
    const cur = asRecord(facts[l.field]);
    if (cur.source === "human" && l.source !== "human") {
      if (!keptHuman.includes(l.field)) keptHuman.push(l.field);
      continue;
    }
    // R30: a lab-measured value is replaced only by a person or a newer read.
    if (cur.source === "coa" && l.source !== "coa" && l.source !== "human") {
      if (!keptLab.includes(l.field)) keptLab.push(l.field);
      continue;
    }
    facts[l.field] = { value, source: l.source, confidence: l.confidence ?? null, at: input.at } satisfies AttachedFact;
    prov[l.field] = { source: l.source, confidence: l.confidence ?? null, at: input.at, by: input.by, urls: [...urls] } satisfies FactProvenance;
    if (!written.includes(l.field)) written.push(l.field);
  }
  if (written.length === 0) return { patch: null, written, keptHuman, keptLab };
  return {
    patch: { [DRAFT_FACT_COLUMNS[0]]: facts, [DRAFT_FACT_COLUMNS[1]]: prov } as DraftFactsMerge["patch"],
    written,
    keptHuman,
    keptLab,
  };
}

// ─── 5. "0235 not applied yet" ────────────────────────────────────────────

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

function mentions(lowerMessage: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(lowerMessage);
}

/**
 * True only when the error says one of 0235's draft columns, or the 0235
 * table, does not exist. Word-boundary matching, so "attached_facts" is not
 * found inside "attached_facts_provenance_v2" or "pre_attached_facts".
 */
export function isMissingAttachedFactsError(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const colSignal = MISSING_COLUMN_CODES.has(code) || /column .* does not exist|could not find the .* column/.test(msg);
  if (colSignal && DRAFT_FACT_COLUMNS.some((c) => mentions(msg, c))) return true;
  const tableSignal =
    MISSING_TABLE_CODES.has(code) || /relation .* does not exist|could not find the table/.test(msg);
  return tableSignal && mentions(msg, PROVENANCE_TABLE);
}

// ─── Self-tests ───────────────────────────────────────────────────────────

export function __runAttachFactsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL attach-facts-core: " + msg);
    }
  };

  // 1. Vocabulary.
  ok(FACT_SOURCES.length === 8 && new Set(FACT_SOURCES).size === 8, "8 distinct sources");
  ok(
    sourceCheckSqlList() === "'manifest', 'coa', 'kb_published', 'kb_draft', 'gemini', 'human', 'remembered', 'cultivera'",
    "SQL list is generated in migration order",
  );
  for (const s of FACT_SOURCES) ok(isFactSource(s), `${s} is a source`);
  for (const bad of ["Gemini", " gemini", "gemini ", "ai", "kb", "", null, undefined, 1, {}]) {
    ok(!isFactSource(bad), `${JSON.stringify(bad)} is not a source`);
  }
  ok(PROVENANCE_COLUMNS.length === 13 && PROVENANCE_SELECT.startsWith("id, identity_key,") && !PROVENANCE_SELECT.includes("*"), "13 named columns");
  ok(DRAFT_FACT_COLUMNS.join() === "attached_facts,attached_facts_provenance", "two draft columns");

  // 2. Field keys (mirror of pfp_field_key).
  for (const f of ["description", "thc_pct", "short_description", "a1"]) ok(isFactFieldKey(f), `${f} ok`);
  for (const f of ["Description", "1description", "desc ription", "", "_x", "d-escription", null]) ok(!isFactFieldKey(f), `${String(f)} rejected`);

  // 3. Confidence: scale conversion, no clamping.
  ok(toStoredConfidence(95) === 0.95 && toStoredConfidence(90) === 0.9 && toStoredConfidence(0) === 0 && toStoredConfidence(100) === 1, "0-100 -> 0..1");
  ok(toStoredConfidence(94.5) === 0.945 && toStoredConfidence("72") === 0.72, "fractional and numeric string");
  ok(toStoredConfidence(33.33333) === 0.3333, "rounded to 4 dp");
  ok(
    [150, -1, 100.01, NaN, Infinity, "abc", {}, true].every((v) => toStoredConfidence(v) === null),
    "out of range / junk -> null, never clamped",
  );
  ok(toStoredConfidence(null) === null && toStoredConfidence(undefined) === null && toStoredConfidence(" ") === null, "absent -> null");
  ok(isStoredConfidence(null) && isStoredConfidence(0) && isStoredConfidence(1) && isStoredConfidence(0.5), "stored range accepted");
  ok(!isStoredConfidence(95) && !isStoredConfidence(-0.01) && !isStoredConfidence(1.01) && !isStoredConfidence(NaN), "stored range rejected");

  // 4. Row builder.
  const U = "11111111-2222-3333-4444-555555555555";
  const good = buildProvenanceRow({
    identityKey: "  acme|flower|blue dream ",
    field: "description",
    value: "Sweet berry nose.",
    source: "gemini",
    confidence: toStoredConfidence(95),
    urls: ["https://a.example/x", "https://a.example/x", "javascript:alert(1)", 7, " https://b.example/y "],
    draftId: U.toUpperCase(),
    posProductKey: " LOT-1 ",
  });
  ok(good.ok, "valid row builds");
  if (good.ok) {
    ok(good.row.identity_key === "acme|flower|blue dream", "identity trimmed");
    ok(good.row.confidence === 0.95, "confidence carried");
    ok(JSON.stringify(good.row.source_urls) === '["https://a.example/x","https://b.example/y"]', "urls: http(s) only, deduped, trimmed");
    ok(good.row.draft_id === U && good.row.kb_product_id === null && good.row.actor_id === null, "uuids normalised, absent -> null");
    ok(good.row.pos_product_key === "LOT-1", "pos key trimmed");
    ok(!("created_at" in good.row) && !("id" in good.row), "DB defaults are not sent");
  }
  const reasons: Array<[ProvenanceInput, string]> = [
    [{ identityKey: "", field: "description", value: 1, source: "human" }, "identity"],
    [{ identityKey: "  ", field: "description", value: 1, source: "human" }, "identity"],
    [{ identityKey: null, field: "description", value: 1, source: "human" }, "identity"],
    [{ identityKey: "a|b|c", field: "Description", value: 1, source: "human" }, "field"],
    [{ identityKey: "a|b|c", field: "description", value: 1, source: "Gemini" }, "source"],
    [{ identityKey: "a|b|c", field: "description", value: 1, source: "gemini", confidence: 95 }, "0..1"],
    [{ identityKey: "a|b|c", field: "description", value: undefined, source: "human" }, "JSON"],
    [{ identityKey: "a|b|c", field: "description", value: NaN, source: "human" }, "JSON"],
    [{ identityKey: "a|b|c", field: "description", value: () => 1, source: "human" }, "JSON"],
    [{ identityKey: "a|b|c", field: "description", value: 1, source: "human", lotId: "not-a-uuid" }, "lot_id"],
    [{ identityKey: "a|b|c", field: "description", value: 1, source: "human", actorId: "x" }, "actor_id"],
  ];
  for (const [inp, word] of reasons) {
    const r = buildProvenanceRow(inp);
    ok(!r.ok && r.reason.includes(word), `rejected for ${word}: ${JSON.stringify(inp.field)}/${String(inp.source)}`);
  }
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  ok(!buildProvenanceRow({ identityKey: "a|b|c", field: "x", value: cyc, source: "human" }).ok, "cyclic value rejected");
  const nul = buildProvenanceRow({ identityKey: "a|b|c", field: "terpenes", value: null, source: "human", urls: [] });
  ok(nul.ok && nul.row.value_json === null && nul.row.source_urls === null && nul.row.confidence === null, "null value, no urls, no confidence");
  const inputObj = { v: [1, 2] };
  const deep = buildProvenanceRow({ identityKey: "a|b|c", field: "x", value: inputObj, source: "coa" });
  ok(deep.ok && deep.row.value_json !== inputObj && JSON.stringify(deep.row.value_json) === '{"v":[1,2]}', "value copied, not aliased");
  const many = buildProvenanceRow({
    identityKey: "a|b|c",
    field: "x",
    value: 1,
    source: "gemini",
    urls: Array.from({ length: 30 }, (_, i) => `https://e.example/${i}`),
  });
  ok(many.ok && many.row.source_urls!.length === MAX_SOURCE_URLS, "urls capped");

  // 5. Recall helper.
  const idx = latestByField([
    { field: "description", created_at: "2026-01-01T00:00:00Z" },
    { field: "description", created_at: "2026-01-03T00:00:00Z" },
    { field: "lineage", created_at: "garbage" },
    { field: "description", created_at: "2026-01-02T00:00:00Z" },
    { field: "lineage", created_at: "2026-01-01T00:00:00Z" },
    { field: "description", created_at: "2026-01-03T00:00:00Z" },
  ]);
  ok(idx.get("description") === 1, "newest wins, first of a tie kept");
  ok(idx.get("lineage") === 4, "valid date beats an unparseable one");
  ok(latestByField([]).size === 0, "empty in, empty out");

  // 6. Missing-schema detection: ours only.
  ok(
    isMissingAttachedFactsError({ code: "PGRST204", message: "Could not find the 'attached_facts' column of 'catalog_product_drafts' in the schema cache" }),
    "PGRST204 draft column",
  );
  ok(
    isMissingAttachedFactsError({ code: "42703", message: 'column "attached_facts_provenance" of relation "catalog_product_drafts" does not exist' }),
    "42703 provenance column",
  );
  ok(isMissingAttachedFactsError({ code: "42P01", message: 'relation "public.product_fact_provenance" does not exist' }), "42P01 table");
  ok(
    isMissingAttachedFactsError({ code: "PGRST205", message: "Could not find the table 'public.product_fact_provenance' in the schema cache" }),
    "PGRST205 table",
  );
  ok(!isMissingAttachedFactsError(null) && !isMissingAttachedFactsError(undefined), "no error -> false");
  ok(!isMissingAttachedFactsError({ code: "42703", message: 'column "identity_key" of relation "catalog_product_drafts" does not exist' }), "another column is not ours");
  ok(!isMissingAttachedFactsError({ code: "42P01", message: 'relation "public.kb_products" does not exist' }), "another table is not ours");
  ok(!isMissingAttachedFactsError({ code: "42703", message: 'column "pre_attached_facts" does not exist' }), "word boundary (prefix)");
  ok(!isMissingAttachedFactsError({ code: "42703", message: 'column "attached_facts_v2" does not exist' }), "word boundary (suffix)");
  ok(
    !isMissingAttachedFactsError({ code: "23514", message: 'new row for relation "product_fact_provenance" violates check constraint "pfp_source_known"' }),
    "a check violation on our table is NOT 'missing' (it must surface)",
  );
  ok(
    !isMissingAttachedFactsError({ code: "42703", message: 'column "product_fact_provenance" does not exist' }),
    "a missing COLUMN named like the table is not a missing table",
  );

  // 6. S11: the draft's own copy (mergeDraftAttachedFacts).
  ok(DRAFT_FACT_SELECT === "attached_facts, attached_facts_provenance", "draft fact select is named");
  const AT = "2026-05-01T10:00:00.000Z";
  const BY = "00000000-0000-4000-8000-000000000001";
  const none = mergeDraftAttachedFacts({ existingFacts: null, existingProvenance: null, landed: [], at: AT, by: BY, urls: [] });
  ok(none.patch === null && none.written.length === 0, "nothing landed -> no write");
  const first = mergeDraftAttachedFacts({
    existingFacts: null,
    existingProvenance: null,
    landed: [
      { field: "description", value: "Sweet.", source: "gemini", confidence: 0.94 },
      { field: "effects", value: ["calm"], source: "gemini", confidence: 0.95 },
    ],
    at: AT,
    by: BY,
    urls: ["https://a.example/x", "nope", "https://a.example/x"],
  });
  const fp = (first.patch ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  ok(first.written.join() === "description,effects", "written fields");
  ok(fp.attached_facts?.description?.value === "Sweet." && fp.attached_facts.description.confidence === 0.94 && fp.attached_facts.description.at === AT, "fact shape");
  ok(fp.attached_facts?.description?.source === "gemini", "fact source");
  ok(JSON.stringify(fp.attached_facts_provenance?.effects) === JSON.stringify({ source: "gemini", confidence: 0.95, at: AT, by: BY, urls: ["https://a.example/x"] }), "provenance shape + clean urls");
  const existing = { flavor: { value: ["pine"], source: "human", confidence: null, at: "2026-04-01T00:00:00Z" }, aroma: { value: ["old"], source: "gemini", confidence: 0.91, at: "2026-04-01T00:00:00Z" } };
  const existingProv = { flavor: { source: "human", confidence: null, at: "2026-04-01T00:00:00Z", by: BY, urls: [] } };
  const second = mergeDraftAttachedFacts({
    existingFacts: existing,
    existingProvenance: existingProv,
    landed: [
      { field: "flavor", value: ["web"], source: "gemini", confidence: 0.99 },
      { field: "aroma", value: ["new"], source: "gemini", confidence: 0.93 },
      { field: "Bad Key", value: "x", source: "gemini", confidence: 0.99 },
      { field: "lineage", value: "x", source: "Gemini" as FactSource, confidence: 0.99 },
      { field: "summary", value: "x", source: "gemini", confidence: 95 },
      { field: "images", value: undefined, source: "gemini", confidence: 0.99 },
    ],
    at: AT,
    by: null,
    urls: [],
  });
  const sp = (second.patch ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  ok(second.keptHuman.join() === "flavor" && JSON.stringify(sp.attached_facts?.flavor) === JSON.stringify(existing.flavor), "a person's value is never replaced by a machine");
  ok(JSON.stringify(sp.attached_facts_provenance?.flavor) === JSON.stringify(existingProv.flavor), "human provenance kept");
  ok(JSON.stringify(sp.attached_facts?.aroma?.value) === JSON.stringify(["new"]), "machine value replaced by the newer landed one");
  ok(second.written.join() === "aroma", "invalid entries skipped: " + second.written.join());
  ok(JSON.stringify(existing.aroma.value) === JSON.stringify(["old"]), "inputs not mutated");
  const humanOverHuman = mergeDraftAttachedFacts({ existingFacts: existing, existingProvenance: null, landed: [{ field: "flavor", value: ["mine"], source: "human", confidence: null }], at: AT, by: BY, urls: [] });
  ok(humanOverHuman.written.join() === "flavor" && humanOverHuman.keptHuman.length === 0, "a person may replace their own value");
  // R30: source priority - a lab value survives a web lookup; a person or a newer read replaces it.
  const labFacts = { terpenes: { value: ["limonene 0.51%"], source: "coa", confidence: null, at: "2026-04-01T00:00:00Z" } };
  const webOverLab = mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["myrcene"], source: "gemini", confidence: 0.99 }, { field: "aroma", value: ["citrus"], source: "gemini", confidence: 0.95 }], at: AT, by: null, urls: [] });
  ok(webOverLab.keptLab.join() === "terpenes" && webOverLab.written.join() === "aroma", "a web lookup never replaces a lab value: " + webOverLab.written.join());
  ok(JSON.stringify((webOverLab.patch as Record<string, Record<string, Record<string, unknown>>>).attached_facts.terpenes.value) === JSON.stringify(["limonene 0.51%"]), "lab value kept verbatim");
  for (const src of ["kb_published", "kb_draft", "remembered", "cultivera", "manifest"] as const) {
    ok(mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["x"], source: src, confidence: null }], at: AT, by: null, urls: [] }).keptLab.join() === "terpenes", `${src} never replaces a lab value`);
  }
  const newerRead = mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["limonene 0.6%"], source: "coa", confidence: null }], at: AT, by: null, urls: [] });
  ok(newerRead.written.join() === "terpenes" && newerRead.keptLab.length === 0, "a newer lab read replaces the old one");
  const personOverLab = mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["mine"], source: "human", confidence: null }], at: AT, by: BY, urls: [] });
  ok(personOverLab.written.join() === "terpenes" && personOverLab.keptLab.length === 0, "a person may replace a lab value");
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  ok(mergeDraftAttachedFacts({ existingFacts: [], existingProvenance: "x", landed: [{ field: "description", value: loop, source: "gemini", confidence: 0.9 }], at: AT, by: BY, urls: [] }).patch === null, "non-JSON value skipped; junk existing tolerated");

  return { passed, failed };
}
