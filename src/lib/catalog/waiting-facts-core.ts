/**
 * src/lib/catalog/waiting-facts-core.ts  (Round 23, items 2 + 6)
 *
 * PURE. "Facts waiting for you" in the onboarding row's AI card.
 *
 * THE OWNER'S ASK (round 23, verbatim excerpts):
 *   "after the AI lookup is finished, for all the facts to be shown in the
 *    ai card section in the product row. with the ability to attach them
 *    there, rather than needing to approve everything"
 *   "if the onboarding page shows facts available, I would like to attach
 *    them in onboarding instead of enrichment."
 *
 * WHY THEY WERE NOT THERE (verified in code, not assumed): the attach policy
 * ring defaults to 1 (shadow, fact-attach-policy-server.ts). In shadow,
 * planAttach() lands nothing live, so "Look up all" only files PENDING
 * ai_suggestions on the product's suggestion key (attach-plan-core.ts
 * "suggestions") and the row line said "N facts waiting for you in Product
 * Enrichment". The S09 memory chips ("What we know") were display-only.
 *
 * WHAT THIS CORE DOES: it turns the two places a fact can be waiting into
 * one list of per-field candidates the row can offer an "Attach" button for:
 *   1. pending ai_suggestions on THIS draft's suggestion key (the same key
 *      the S07 door files under - suggestionTargetKey), parsed per field:
 *      description / short_description (prose), effects (CSV), and
 *      sensory (JSON {aroma_notes, flavor_notes, terpenes});
 *   2. the S09 product memory (RememberedFact - covered or not).
 * It drops what the row already holds (same value attached), and every
 * candidate for a field a PERSON already answered on this row (the person's
 * answer wins - the same survivorship rule as mergeDraftAttachedFacts).
 *
 * The attach itself is a HUMAN confirmation (attach-plan-core confirmedBy
 * "human"): only this product's own record (kb_products) is written, never
 * the shared strain library, never a new suggestion. The server action
 * re-reads the value it attaches (pickSuggestionValue / pickMemoryValue) -
 * the browser only says WHICH fact, never its text.
 *
 * Only the five fields the product record holds are offered (the S09
 * MEMORY_TARGET_FIELDS). Terpenes have no kb_products column the door
 * writes, and images stay a person's choice on Enrichment (S10 policy).
 *
 * Industry pattern: a data-steward review queue (MDM "suggest, then a
 * steward confirms") with field-level survivorship and lineage: every
 * candidate carries its source and confidence, and the confirmation is
 * recorded as its own provenance event (source "human").
 *
 * No I/O. Embedded self-tests at the bottom (run-pure-selftests.ts).
 */

import type { AttachedFacts } from "./attach-facts-core";
import { cleanList, normalizeForDedupe } from "./attach-plan-core";
import {
  MEMORY_FIELD_LABEL,
  MEMORY_TARGET_FIELDS,
  factSourceLabel,
  percentFromStored,
  type MemoryField,
  type ProductMemory,
} from "./fact-memory-core";
import type { RawProductLookup } from "@/lib/inventory/product-lookup-core";

// --- 1. Vocabulary -------------------------------------------------------------------

/** The fields a person can attach from the row (the product record's own fields). */
export const WAITING_FIELDS = MEMORY_TARGET_FIELDS;
export type WaitingField = MemoryField;

/** The pending suggestion keys this list reads (others are Enrichment-only). */
export const WAITING_SUGGESTION_KEYS = ["description", "short_description", "effects", "sensory"] as const;

/** At most this many candidates per field (newest/highest first). */
export const WAITING_PER_FIELD_MAX = 3;

export const WAITING_HEADING = "Facts waiting for you";
export const WAITING_HELP =
  "Found by a lookup or already on file for this product. Attach saves it to this product's own record now, as your confirmed answer - no need to approve first. Nothing is attached until you press Attach.";
export const WAITING_EMPTY_COPY = "Nothing is waiting for this product. Run AI Lookup, or Look up all for the delivery.";

export function isWaitingField(v: unknown): v is WaitingField {
  return typeof v === "string" && (WAITING_FIELDS as readonly string[]).includes(v);
}

// --- 2. Reading a pending suggestion -------------------------------------------------

/** A pending ai_suggestions row as the page reads it (named columns only). */
export interface WaitingSuggestionRow {
  id: string;
  entity_id: string;
  field_key: string;
  suggested_value: string | null;
  status?: string | null;
  confidence?: number | null;
  source?: string | null;
  created_at?: string | null;
}

/** The per-field values a suggestion row carries ({} when it carries none). */
export function suggestionFieldValues(row: Pick<WaitingSuggestionRow, "field_key" | "suggested_value">): Partial<Record<WaitingField, string | string[]>> {
  const out: Partial<Record<WaitingField, string | string[]>> = {};
  const raw = typeof row?.suggested_value === "string" ? row.suggested_value : "";
  if (!raw.trim()) return out;
  const key = typeof row.field_key === "string" ? row.field_key : "";
  if (key === "description" || key === "short_description") {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t) out[key] = t;
  } else if (key === "effects") {
    const l = cleanList(raw.split(","));
    if (l.length) out.effects = l;
  } else if (key === "sensory") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const o = p as Record<string, unknown>;
        const aroma = cleanList(o.aroma_notes);
        const flavor = cleanList(o.flavor_notes);
        if (aroma.length) out.aroma = aroma;
        if (flavor.length) out.flavor = flavor;
      }
    } catch {
      /* malformed JSON -> carries nothing (never guessed) */
    }
  }
  return out;
}

/** Comparable form of a value: prose normalised, lists as a sorted lowercase set. */
export function valueKey(v: unknown): string {
  if (Array.isArray(v)) {
    return cleanList(v)
      .map((x) => x.toLowerCase())
      .sort()
      .join("\u001f");
  }
  if (typeof v === "string") return normalizeForDedupe(v);
  return "";
}

/** "Gemini 94%" for a lookup's suggestion; a plain label for anything else. */
export function suggestionSourceLabel(source: string | null | undefined, confidencePct: number | null): string {
  const s = String(source ?? "").trim().toLowerCase();
  if (s === "" || s === "model" || s.startsWith("model:")) return factSourceLabel("gemini", confidencePct);
  if (s.startsWith("human")) return "You";
  if (s === "kb") return "KB";
  if (s.startsWith("crawl")) return "Web page";
  return "AI suggestion";
}

// --- 3. Building the list ------------------------------------------------------------

export interface WaitingFact {
  /** Stable key for React and for the form ("s:<id>:<field>" | "m:<field>"). */
  key: string;
  field: WaitingField;
  fieldLabel: string;
  value: string | string[];
  /** One-line preview (lists joined, long prose cut at 160 chars). */
  preview: string;
  /** Full text when the preview was cut (shown in a disclosure), else "". */
  full: string;
  origin: "suggestion" | "memory";
  suggestionId: string | null;
  sourceLabel: string;
  confidencePct: number | null;
  /** Plain-English: where it came from and what Attach will do. */
  why: string;
}

export interface WaitingFactsInput {
  /** This draft's suggestion key (suggestionTargetKey), or null when it has none. */
  suggestionKey: string | null;
  /** Pending suggestions read for the page (any keys; filtered to suggestionKey here). */
  suggestions: readonly WaitingSuggestionRow[];
  memory: ProductMemory | null;
  /** The draft's attached facts (attachedFactsOf). */
  attached: AttachedFacts | null;
}

export interface WaitingFactsView {
  facts: WaitingFact[];
  /** Fields a person already answered on this row (their candidates are hidden). */
  answered: WaitingField[];
  /** WAITING_EMPTY_COPY when nothing is waiting, else null. */
  emptyLine: string | null;
}

const PREVIEW_MAX = 160;

function preview(v: string | string[]): { preview: string; full: string } {
  const s = (Array.isArray(v) ? v.join(", ") : v).replace(/\s+/g, " ").trim();
  if (s.length <= PREVIEW_MAX) return { preview: s, full: "" };
  return { preview: `${s.slice(0, PREVIEW_MAX - 1).trimEnd()}\u2026`, full: s };
}

function timeOf(at: string | null | undefined): number {
  const t = Date.parse(String(at ?? ""));
  return Number.isFinite(t) ? t : -Infinity;
}

interface Cand {
  fact: WaitingFact;
  rank: number;
  at: number;
}

export function buildWaitingFacts(input: WaitingFactsInput): WaitingFactsView {
  const key = (input.suggestionKey ?? "").trim();
  const attached = input.attached ?? {};
  const answered = WAITING_FIELDS.filter((f) => attached[f]?.source === "human");
  const answeredSet = new Set<WaitingField>(answered);
  const heldKey = new Map<WaitingField, string>();
  for (const f of WAITING_FIELDS) {
    const a = attached[f];
    if (a) heldKey.set(f, valueKey(a.value));
  }
  const cands: Cand[] = [];
  const push = (c: Cand) => {
    const f = c.fact.field;
    if (answeredSet.has(f)) return;
    const vk = valueKey(c.fact.value);
    if (!vk || heldKey.get(f) === vk) return;
    cands.push(c);
  };

  if (key) {
    for (const row of input.suggestions) {
      if (!row || typeof row.id !== "string" || !row.id) continue;
      if (String(row.entity_id ?? "").trim() !== key) continue;
      if (row.status !== undefined && row.status !== null && row.status !== "pending") continue;
      const pct = percentFromStored(row.confidence ?? null);
      const label = suggestionSourceLabel(row.source, pct);
      const vals = suggestionFieldValues(row);
      for (const f of WAITING_FIELDS) {
        const v = vals[f];
        if (v === undefined) continue;
        const p = preview(v);
        push({
          fact: {
            key: `s:${row.id}:${f}`,
            field: f,
            fieldLabel: MEMORY_FIELD_LABEL[f],
            value: v,
            ...p,
            origin: "suggestion",
            suggestionId: row.id,
            sourceLabel: label,
            confidencePct: pct,
            why: `Found by a lookup${pct === null ? "" : ` at ${Math.round(pct)}%`} and waiting for review. Attach saves it to this product's record as your confirmed answer.`,
          },
          rank: pct ?? -1,
          at: timeOf(row.created_at),
        });
      }
    }
  }

  for (const m of input.memory?.facts ?? []) {
    if (!isWaitingField(m.field)) continue;
    const v = Array.isArray(m.value) ? cleanList(m.value) : typeof m.value === "string" ? m.value.replace(/\s+/g, " ").trim() : "";
    if ((Array.isArray(v) && v.length === 0) || v === "") continue;
    const base = factSourceLabel(m.source, m.confidence, m.origin);
    const label = m.origin === "history" ? `Remembered (${base})` : base;
    const p = preview(v);
    push({
      fact: {
        key: `m:${m.field}`,
        field: m.field,
        fieldLabel: MEMORY_FIELD_LABEL[m.field],
        value: v,
        ...p,
        origin: "memory",
        suggestionId: null,
        sourceLabel: label,
        confidencePct: m.confidence,
        why: m.covered
          ? `Already on file for this product (${m.reason}). Attach records it on this row and in the fact history, so Enrichment shows it too.`
          : `On file but not confirmed yet (${m.reason}). Attach saves it as your confirmed answer.`,
      },
      // A covered memory fact outranks an unscored suggestion; scored ones compete on score.
      rank: m.covered ? 100.5 : m.confidence ?? -1,
      at: timeOf(m.at),
    });
  }

  // One candidate per (field, value): keep the best; then best-first per field, capped.
  const best = new Map<string, Cand>();
  for (const c of cands) {
    const k = `${c.fact.field}\u001f${valueKey(c.fact.value)}`;
    const cur = best.get(k);
    if (!cur || c.rank > cur.rank || (c.rank === cur.rank && c.at > cur.at)) best.set(k, c);
  }
  const facts: WaitingFact[] = [];
  for (const f of WAITING_FIELDS) {
    const mine = Array.from(best.values())
      .filter((c) => c.fact.field === f)
      .sort((a, b) => b.rank - a.rank || b.at - a.at || a.fact.key.localeCompare(b.fact.key));
    for (const c of mine.slice(0, WAITING_PER_FIELD_MAX)) facts.push(c.fact);
  }
  return { facts, answered, emptyLine: facts.length === 0 ? WAITING_EMPTY_COPY : null };
}

// --- 4. Server-side re-read (the browser only names the fact) ------------------------

export type PickResult = { ok: true; value: string | string[] } | { ok: false; reason: string };

export const PICK_GONE = "That suggestion is no longer waiting (someone reviewed it, or it was replaced). Refresh the page.";
export const PICK_OTHER_PRODUCT = "That suggestion belongs to a different product, so it was not attached.";
export const PICK_NO_VALUE = "That suggestion has no value for this field any more. Refresh the page.";
export const PICK_NO_MEMORY = "Nothing is on file for this field any more. Refresh the page.";
export const PICK_BAD_FIELD = "Only the description, short line, effects, aroma and flavor can be attached here.";

/** The value to attach from a pending suggestion, re-validated against THIS draft's key. */
export function pickSuggestionValue(
  row: WaitingSuggestionRow | null | undefined,
  field: unknown,
  expectedKey: string | null | undefined,
): PickResult {
  if (!isWaitingField(field)) return { ok: false, reason: PICK_BAD_FIELD };
  if (!row || row.status !== "pending") return { ok: false, reason: PICK_GONE };
  const key = (expectedKey ?? "").trim();
  if (!key || String(row.entity_id ?? "").trim() !== key) return { ok: false, reason: PICK_OTHER_PRODUCT };
  const v = suggestionFieldValues(row)[field];
  return v === undefined ? { ok: false, reason: PICK_NO_VALUE } : { ok: true, value: v };
}

/** The value to attach from the product memory (recalled again on the server). */
export function pickMemoryValue(memory: ProductMemory | null | undefined, field: unknown): PickResult {
  if (!isWaitingField(field)) return { ok: false, reason: PICK_BAD_FIELD };
  const m = (memory?.facts ?? []).find((x) => x.field === field);
  if (!m) return { ok: false, reason: PICK_NO_MEMORY };
  const v = Array.isArray(m.value) ? cleanList(m.value) : typeof m.value === "string" ? m.value.trim() : "";
  if ((Array.isArray(v) && v.length === 0) || v === "") return { ok: false, reason: PICK_NO_MEMORY };
  return { ok: true, value: v };
}

/**
 * A lookup-shaped object carrying ONLY the one field, so the action can run
 * it through the SAME compliance gate as a web reply (postProcessLookup:
 * effects allow-list, banned phrases, medical claims) before the door.
 */
export function rawLookupForField(field: WaitingField, value: string | string[]): RawProductLookup {
  const list = Array.isArray(value) ? cleanList(value) : [];
  const text = typeof value === "string" ? value : "";
  return {
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: field === "effects" ? list : [],
    aroma_notes: field === "aroma" ? list : [],
    flavor_notes: field === "flavor" ? list : [],
    lineage: "",
    found: true,
    description: field === "description" ? text : "",
    short_description: field === "short_description" ? text : "",
    category: "",
    potency_ratio: "",
    size: "",
    image_candidates: [],
  };
}

/** What survived the compliance gate for the one field ("" / [] = nothing). */
export function gatedValue(
  field: WaitingField,
  safe: { description: string; shortDescription: string; effects: readonly string[]; aromaNotes: readonly string[]; flavorNotes: readonly string[] },
): string | string[] {
  switch (field) {
    case "description":
      return safe.description;
    case "short_description":
      return safe.shortDescription;
    case "effects":
      return [...safe.effects];
    case "aroma":
      return [...safe.aromaNotes];
    case "flavor":
      return [...safe.flavorNotes];
  }
}

/**
 * Close the pending suggestion (mark it accepted) after a person's attach?
 * Only sensory / effects rows, and only when EVERY field the row carries is
 * now held on the draft with the same value by a person - so no part a
 * person never saw is ever marked accepted. Accepting sensory / effects on
 * Enrichment writes nothing else either (products/actions.ts
 * acceptSuggestion), so this is the same end state. Prose rows stay pending
 * on purpose: Enrichment's Accept is what puts the text on the website card.
 */
export function suggestionClosable(row: Pick<WaitingSuggestionRow, "field_key" | "suggested_value">, attachedAfter: AttachedFacts | null): boolean {
  if (row.field_key !== "sensory" && row.field_key !== "effects") return false;
  const vals = suggestionFieldValues(row);
  const fields = WAITING_FIELDS.filter((f) => vals[f] !== undefined);
  if (fields.length === 0) return false;
  return fields.every((f) => {
    const a = attachedAfter?.[f];
    return !!a && a.source === "human" && valueKey(a.value) === valueKey(vals[f]);
  });
}

// --- 5. The redirect receipt (banner) ------------------------------------------------

export const WAITING_RESULT_CODES = ["attached", "kept", "skipped", "error"] as const;
export type WaitingResultCode = (typeof WAITING_RESULT_CODES)[number];

/** Banner for ?wf=<code>&wf_msg=<sentence>. The sentence is the door's own receipt. */
export function waitingResultBanner(code: unknown, msg: unknown): { tone: "ok" | "info" | "error"; text: string } | null {
  if (typeof code !== "string" || !(WAITING_RESULT_CODES as readonly string[]).includes(code)) return null;
  const m = typeof msg === "string" ? msg.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  switch (code as WaitingResultCode) {
    case "attached":
      return { tone: "ok", text: m || "Attached to this product." };
    case "kept":
      return { tone: "info", text: m || "Already on this product's record - recorded as confirmed." };
    case "skipped":
      return { tone: "info", text: m || "Nothing was attached." };
    default:
      return { tone: "error", text: m || "That fact could not be attached just now. Try again." };
  }
}

// --- Self-tests ----------------------------------------------------------------------

export function __runWaitingFactsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL waiting-facts-core: " + msg);
    }
  };

  // 1. Vocabulary.
  ok(WAITING_FIELDS.join() === "description,short_description,effects,aroma,flavor", "five record fields");
  ok(isWaitingField("aroma") && !isWaitingField("terpenes") && !isWaitingField("images") && !isWaitingField(null), "isWaitingField");
  ok(WAITING_SUGGESTION_KEYS.join() === "description,short_description,effects,sensory", "suggestion keys");

  // 2. suggestionFieldValues.
  ok(suggestionFieldValues({ field_key: "description", suggested_value: "  A  bright   flower. " }).description === "A bright flower.", "prose collapsed");
  ok(Object.keys(suggestionFieldValues({ field_key: "description", suggested_value: "   " })).length === 0, "blank prose -> nothing");
  ok(Object.keys(suggestionFieldValues({ field_key: "description", suggested_value: null })).length === 0, "null -> nothing");
  const eff = suggestionFieldValues({ field_key: "effects", suggested_value: "calm, Calm , happy,," }).effects;
  ok(Array.isArray(eff) && eff.join("|") === "calm|happy", "effects CSV cleaned + deduped");
  const sens = suggestionFieldValues({ field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["berry", ""], terpenes: ["myrcene"] }) });
  ok((sens.aroma as string[]).join() === "pine" && (sens.flavor as string[]).join() === "berry", "sensory aroma + flavor");
  ok(!("terpenes" in sens), "terpenes are never offered");
  ok(Object.keys(suggestionFieldValues({ field_key: "sensory", suggested_value: "{bad" })).length === 0, "bad JSON -> nothing");
  ok(Object.keys(suggestionFieldValues({ field_key: "sensory", suggested_value: "[1]" })).length === 0, "array JSON -> nothing");
  ok(Object.keys(suggestionFieldValues({ field_key: "research_images", suggested_value: "https://x" })).length === 0, "images not offered");
  ok(Object.keys(suggestionFieldValues({ field_key: "seo", suggested_value: "x" })).length === 0, "seo not offered");

  // 3. valueKey + labels.
  ok(valueKey(["Pine", "citrus"]) === valueKey(["citrus", "pine "]), "list key order/case-free");
  ok(valueKey(" A  b ") === valueKey("a B"), "prose key normalised");
  ok(valueKey(5) === "" && valueKey([]) === "", "non-values -> empty key");
  ok(suggestionSourceLabel("model:onboarding-lookup", 94) === "Gemini 94%", "lookup label");
  ok(suggestionSourceLabel(null, null) === "Gemini", "no source -> lookup label");
  ok(suggestionSourceLabel("kb", null) === "KB" && suggestionSourceLabel("crawl:https://a", null) === "Web page", "kb / crawl labels");
  ok(suggestionSourceLabel("human:onboarding-attach", null) === "You" && suggestionSourceLabel("pos", null) === "AI suggestion", "human / other labels");

  // 4. buildWaitingFacts.
  const KEY = "LOT-1";
  const S = (id: string, field_key: string, suggested_value: string, extra: Partial<WaitingSuggestionRow> = {}): WaitingSuggestionRow => ({
    id,
    entity_id: KEY,
    field_key,
    suggested_value,
    status: "pending",
    confidence: 0.8,
    source: "model:onboarding-lookup",
    created_at: "2026-05-01T00:00:00Z",
    ...extra,
  });
  const mem = (facts: ProductMemory["facts"]): ProductMemory => ({
    identityKey: "v|b|x",
    facts,
    covered: facts.filter((f) => f.covered).map((f) => f.field),
    missing: [],
    complete: false,
    lastSeen: null,
  });
  const empty = buildWaitingFacts({ suggestionKey: KEY, suggestions: [], memory: null, attached: null });
  ok(empty.facts.length === 0 && empty.emptyLine === WAITING_EMPTY_COPY, "empty list + copy");

  const v1 = buildWaitingFacts({
    suggestionKey: KEY,
    suggestions: [
      S("a", "description", "Sweet berry flower."),
      S("b", "sensory", JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["berry"], terpenes: [] }), { confidence: 0.94 }),
      S("c", "effects", "calm, happy"),
      S("x", "description", "Other product.", { entity_id: "LOT-2" }),
      S("y", "description", "Already reviewed.", { status: "accepted" }),
      S("z", "research_images", "https://img"),
    ],
    memory: null,
    attached: null,
  });
  ok(v1.emptyLine === null, "not empty");
  ok(v1.facts.map((f) => f.field).join() === "description,effects,aroma,flavor", "field order + only this key/pending: " + v1.facts.map((f) => f.field).join());
  ok(!v1.facts.some((f) => f.preview.includes("Other product") || f.preview.includes("Already reviewed")), "other key + reviewed dropped");
  const aroma = v1.facts.find((f) => f.field === "aroma")!;
  ok(aroma.suggestionId === "b" && aroma.key === "s:b:aroma" && aroma.origin === "suggestion", "aroma from the sensory row");
  ok(aroma.sourceLabel === "Gemini 94%" && aroma.confidencePct === 94, "aroma label + pct");
  ok(aroma.why.includes("94%"), "why carries the score");
  ok(v1.facts.find((f) => f.field === "effects")!.preview === "calm, happy", "effects preview joined");

  ok(buildWaitingFacts({ suggestionKey: null, suggestions: [S("a", "description", "D")], memory: null, attached: null }).facts.length === 0, "no key -> no suggestions shown");
  ok(buildWaitingFacts({ suggestionKey: " LOT-1 ", suggestions: [S("a", "description", "D")], memory: null, attached: null }).facts.length === 1, "key trimmed");

  // Already held with the same value -> hidden; a person's answer hides the field.
  const att = (field: string, value: unknown, source: "human" | "gemini"): AttachedFacts => ({ [field]: { value, source, confidence: null, at: "2026-05-02T00:00:00Z" } });
  const held = buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("a", "description", "sweet  berry flower.")], memory: null, attached: att("description", "Sweet berry flower.", "gemini") });
  ok(held.facts.length === 0, "same value already attached -> hidden");
  const other = buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("a", "description", "New copy.")], memory: null, attached: att("description", "Old copy.", "gemini") });
  ok(other.facts.length === 1, "a different value from a lookup is still offered");
  const human = buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("a", "description", "New copy.")], memory: null, attached: att("description", "Mine.", "human") });
  ok(human.facts.length === 0 && human.answered.join() === "description", "a person's answer hides the field");

  // Memory: covered + uncovered, history label, dedupe with a suggestion.
  const m1 = mem([
    { field: "flavor", value: ["berry"], origin: "kb-exact", source: "kb_published", confidence: null, at: null, covered: true, reason: "approved KB record" },
    { field: "effects", value: ["relaxed"], origin: "history", source: "gemini", confidence: 82, at: "2026-04-01T00:00:00Z", covered: false, reason: "below the bar" },
    { field: "aroma", value: [], origin: "kb-draft", source: "kb_draft", confidence: null, at: null, covered: false, reason: "draft" },
  ]);
  const v2 = buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("b", "sensory", JSON.stringify({ aroma_notes: [], flavor_notes: ["Berry"] }))], memory: m1, attached: null });
  const flav = v2.facts.filter((f) => f.field === "flavor");
  ok(flav.length === 1 && flav[0].origin === "memory" && flav[0].sourceLabel === "KB", "same flavor: covered memory wins the dedupe");
  ok(flav[0].why.startsWith("Already on file"), "covered why");
  const effM = v2.facts.find((f) => f.field === "effects")!;
  ok(effM.sourceLabel.startsWith("Remembered (") && effM.key === "m:effects" && effM.suggestionId === null, "history label + memory key");
  ok(effM.why.startsWith("On file but not confirmed"), "uncovered why");
  ok(!v2.facts.some((f) => f.field === "aroma"), "empty memory list skipped");

  // Cap + ordering by score.
  const many = buildWaitingFacts({
    suggestionKey: KEY,
    suggestions: [
      S("1", "description", "One.", { confidence: 0.5 }),
      S("2", "description", "Two.", { confidence: 0.9 }),
      S("3", "description", "Three.", { confidence: 0.7 }),
      S("4", "description", "Four.", { confidence: null }),
    ],
    memory: null,
    attached: null,
  });
  ok(many.facts.length === WAITING_PER_FIELD_MAX, "capped per field");
  ok(many.facts.map((f) => f.suggestionId).join() === "2,3,1", "best score first: " + many.facts.map((f) => f.suggestionId).join());
  const long = buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("L", "description", "x".repeat(400))], memory: null, attached: null }).facts[0];
  ok(long.preview.length === 160 && long.preview.endsWith("\u2026") && long.full.length === 400, "long prose previewed with full text kept");
  ok(buildWaitingFacts({ suggestionKey: KEY, suggestions: [S("", "description", "x")], memory: null, attached: null }).facts.length === 0, "row without id dropped");

  // 5. Picks.
  const row = S("b", "sensory", JSON.stringify({ aroma_notes: ["pine"], flavor_notes: [] }));
  const p1 = pickSuggestionValue(row, "aroma", KEY);
  ok(p1.ok && (p1.value as string[]).join() === "pine", "pick aroma");
  const p2 = pickSuggestionValue(row, "flavor", KEY);
  ok(!p2.ok && p2.reason === PICK_NO_VALUE, "pick a field the row lacks");
  const p3 = pickSuggestionValue(row, "aroma", "LOT-2");
  ok(!p3.ok && p3.reason === PICK_OTHER_PRODUCT, "pick from another product's key refused");
  const p4 = pickSuggestionValue(row, "aroma", null);
  ok(!p4.ok && p4.reason === PICK_OTHER_PRODUCT, "no key -> refused");
  const p5 = pickSuggestionValue({ ...row, status: "accepted" }, "aroma", KEY);
  ok(!p5.ok && p5.reason === PICK_GONE, "reviewed row refused");
  const p6 = pickSuggestionValue(null, "aroma", KEY);
  ok(!p6.ok && p6.reason === PICK_GONE, "missing row refused");
  const p7 = pickSuggestionValue(row, "terpenes", KEY);
  ok(!p7.ok && p7.reason === PICK_BAD_FIELD, "terpenes refused");
  const pm = pickMemoryValue(m1, "flavor");
  ok(pm.ok && (pm.value as string[]).join() === "berry", "memory pick");
  const pm2 = pickMemoryValue(m1, "aroma");
  ok(!pm2.ok && pm2.reason === PICK_NO_MEMORY, "empty memory pick refused");
  const pm3 = pickMemoryValue(null, "flavor");
  ok(!pm3.ok && pm3.reason === PICK_NO_MEMORY, "no memory refused");
  const pm4 = pickMemoryValue(m1, "images");
  ok(!pm4.ok && pm4.reason === PICK_BAD_FIELD, "images refused");

  // 6. rawLookupForField / gatedValue.
  const rl = rawLookupForField("aroma", ["pine", "pine"]);
  ok(rl.aroma_notes.join() === "pine" && rl.flavor_notes.length === 0 && rl.effects.length === 0 && rl.description === "", "one field only");
  ok(rl.strain_type === "unknown" && rl.found === true && (rl.image_candidates ?? []).length === 0, "never a strain type or image");
  ok(rawLookupForField("description", "Copy.").description === "Copy." && rawLookupForField("description", "Copy.").short_description === "", "prose field only");
  ok(rawLookupForField("description", ["x"]).description === "", "list value never becomes prose");
  const safe = { description: "D", shortDescription: "S", effects: ["calm"], aromaNotes: ["pine"], flavorNotes: ["berry"] };
  ok(gatedValue("description", safe) === "D" && gatedValue("short_description", safe) === "S", "gated prose");
  ok((gatedValue("effects", safe) as string[]).join() === "calm" && (gatedValue("aroma", safe) as string[]).join() === "pine" && (gatedValue("flavor", safe) as string[]).join() === "berry", "gated lists");

  // 7. suggestionClosable.
  const sensRow = { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["berry"] }) };
  ok(!suggestionClosable(sensRow, att("aroma", ["pine"], "human")), "half the sensory row confirmed -> stays pending");
  ok(suggestionClosable(sensRow, { ...att("aroma", ["Pine"], "human"), ...att("flavor", ["berry"], "human") }), "both parts confirmed -> closable");
  ok(!suggestionClosable(sensRow, { ...att("aroma", ["pine"], "human"), ...att("flavor", ["berry"], "gemini") }), "a lookup's copy is not a person's");
  ok(!suggestionClosable(sensRow, { ...att("aroma", ["pine"], "human"), ...att("flavor", ["mint"], "human") }), "a different value is not this row");
  ok(suggestionClosable({ field_key: "effects", suggested_value: "calm" }, att("effects", ["calm"], "human")), "effects closable");
  ok(!suggestionClosable({ field_key: "description", suggested_value: "D" }, att("description", "D", "human")), "prose rows stay pending");
  ok(!suggestionClosable({ field_key: "sensory", suggested_value: "{}" }, null), "empty sensory never closable");
  ok(!suggestionClosable(sensRow, null), "nothing attached -> stays pending");

  // 8. Banner.
  ok(waitingResultBanner("attached", "Attached aroma.")?.text === "Attached aroma." && waitingResultBanner("attached", "")?.tone === "ok", "attached banner");
  ok(waitingResultBanner("kept", null)?.tone === "info" && waitingResultBanner("skipped", "x")?.text === "x", "kept / skipped");
  ok(waitingResultBanner("error", null)?.tone === "error", "error banner");
  ok(waitingResultBanner("junk", "x") === null && waitingResultBanner(undefined, "x") === null, "unknown code -> none");
  ok((waitingResultBanner("attached", "y".repeat(500))?.text.length ?? 0) === 300, "message capped");

  return { passed, failed };
}
