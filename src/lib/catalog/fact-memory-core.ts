/**
 * src/lib/catalog/fact-memory-core.ts
 *
 * SLICE S09 (bible) - KB-first at onboarding: RECALL before you ask Gemini.
 *
 * WHY (findings, cited in the bible):
 *   F-027  productLookupAction called lookupProduct with NO knowledge-base
 *          pre-check, so every click paid for a Gemini call even when the
 *          shop already had an approved record for the product.
 *   F-085  classification memory (classification-memory-core.ts) is the
 *          template: same identity key (vendor|categoryAxis|family), the
 *          newest decision wins, "" identity is NEVER a wildcard.
 *
 * WHAT THIS MODULE DECIDES (pure, no I/O):
 *   1. buildProductMemory()  what we already know about a product, per
 *      field, from (a) the knowledge ladder (kb_products / enrichment /
 *      strain, resolved by product-knowledge-batch-core) and (b) the newest
 *      0235 provenance-table row per field (PROVENANCE_TABLE, written by the S07 door
 *      only for facts that really landed on a live record).
 *   2. Whether each known fact COUNTS ("covered"). That is not decided here:
 *      every candidate goes through the S10 policy decide(), and a fact is
 *      covered only when decide() says "attach". So recall can never be
 *      looser than the lookup's own 90% rule:
 *        - an owner-approved KB product (published AND active) is a record
 *          source -> covered;
 *        - a fact the S07 door married earlier at >= 90% -> covered;
 *        - a KB DRAFT, the enrichment layer and the strain library are shown
 *          ("on file, waiting for you") but never covered - nobody approved
 *          them as this product's record (Rule 3.1: never auto-commit
 *          uncertain data).
 *   3. shouldSkipGemini()  only when the flag is on, the operator did not
 *      ask to refresh, and EVERY target field is covered.
 *   4. alreadyKnownPromptBlock()  for a partial memory: the covered fields,
 *      so the model spends its effort on what is missing. "" when nothing is
 *      covered, so the prompt stays byte-identical to S06.
 *   5. memoryChipCopy()  the row chip. Honest wording only: "last onboarded"
 *      is an approval time we really have; "on file" says where.
 *
 * Enterprise pattern: cache-aside with an explicit refresh (read the system
 * of record first, call the expensive source only on a miss, always offer
 * "Refresh from web" because memory can be stale - bible S09.8), and MDM
 * attribute-level survivorship (source priority per field, documented and
 * auditable - Profisee, "MDM survivorship").
 *
 * PURE: no I/O, no server-only imports. Embedded self-tests at the bottom are
 * registered in scripts/compliance/run-pure-selftests.ts.
 */

import type { ProductKnowledge } from "@/lib/ai/kb/product-lookup";
import { decide, isEmptyFactValue, type PolicyVerdict } from "./fact-attach-policy-core";
import { isFactSource, type FactSource } from "./attach-facts-core";
import { productIdentityKey } from "./product-identity-core";
import { shortDeliveryDate } from "./onboarding-list-core";
import type { RawProductLookup } from "@/lib/inventory/product-lookup-core";

// --- 1. Flag ------------------------------------------------------------------

/** S09 rollback switch (bible S09.7). Unset = ON. off/0/false/no/disabled = OFF. */
export const KB_FIRST_ONBOARDING_ENV = "KB_FIRST_ONBOARDING";

export function kbFirstOnboardingEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// --- 2. Vocabulary --------------------------------------------------------------

/**
 * The fields recall must cover before a lookup can be skipped: the product's
 * own descriptive copy, i.e. exactly what a kb_products record holds and what
 * the S07 door marries to the product record (attach-plan-core kb_products
 * section). Strain type, category, size and potency are never recalled into a
 * skip - other gates own them.
 */
export const MEMORY_TARGET_FIELDS = ["description", "short_description", "effects", "aroma", "flavor"] as const;
export type MemoryField = (typeof MEMORY_TARGET_FIELDS)[number];

export const MEMORY_FIELD_LABEL: Readonly<Record<MemoryField, string>> = Object.freeze({
  description: "description",
  short_description: "short line",
  effects: "effects",
  aroma: "aroma",
  flavor: "flavor",
});

/** Where a remembered fact came from (finer than FactSource, for the label). */
export type MemoryOrigin = "kb-exact" | "kb-draft" | "enrichment" | "strain" | "history";

/** A 0235 provenance-table row as recall reads it (PROVENANCE_SELECT subset). */
export interface ProvenanceRecallRow {
  field: string;
  value_json: unknown;
  source: string;
  /** Stored scale 0..1, or null. */
  confidence: number | null;
  created_at: string;
}

export interface RememberedFact {
  field: MemoryField;
  value: string | string[];
  origin: MemoryOrigin;
  /** The FactSource decide() was given. */
  source: FactSource;
  /** 0-100, or null when the source carries no model score. */
  confidence: number | null;
  /** ISO time the fact was recorded, when known (history rows). */
  at: string | null;
  /** True only when decide() said "attach" for this candidate. */
  covered: boolean;
  /** decide()'s plain-English reason (or ours, for the non-record layers). */
  reason: string;
}

export interface LastSeen {
  /** ISO timestamp. */
  at: string;
  /** Vendor (or brand) of that earlier delivery, when known. */
  from: string | null;
  /** "onboarded" = an approved draft; "recorded" = a fact-history row. */
  kind: "onboarded" | "recorded";
}

export interface ProductMemory {
  identityKey: string;
  /** One per target field that has ANY known value, in MEMORY_TARGET_FIELDS order. */
  facts: RememberedFact[];
  covered: MemoryField[];
  missing: MemoryField[];
  /** Every target field covered. */
  complete: boolean;
  lastSeen: LastSeen | null;
}

// --- 3. Reading values ------------------------------------------------------------

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

function cleanList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const t = cleanText(x);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.length ? out : null;
}

const LIST_FIELDS: ReadonlySet<MemoryField> = new Set<MemoryField>(["effects", "aroma", "flavor"]);

/** A field's value in the shape recall uses, or null when empty / wrong type. */
export function memoryValue(field: MemoryField, raw: unknown): string | string[] | null {
  return LIST_FIELDS.has(field) ? cleanList(raw) : cleanText(raw);
}

/** The ladder's value for one target field. */
export function knowledgeFieldValue(k: ProductKnowledge | null | undefined, field: MemoryField): string | string[] | null {
  if (!k) return null;
  switch (field) {
    case "description":
      return memoryValue(field, k.description);
    case "short_description":
      return memoryValue(field, k.shortDescription);
    case "effects":
      return memoryValue(field, k.effects);
    case "aroma":
      return memoryValue(field, k.aromaNotes);
    case "flavor":
      return memoryValue(field, k.flavorNotes);
  }
}

/** Stored 0..1 -> 0-100 without float noise (0.94 -> 94, 0.895 -> 89.5). */
export function percentFromStored(c: unknown): number | null {
  if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1) return null;
  return Number((c * 100).toFixed(4));
}

// --- 4. The per-field decision -------------------------------------------------------

const ORIGIN_SOURCE: Readonly<Record<Exclude<MemoryOrigin, "history">, FactSource>> = Object.freeze({
  // Owner-approved (published AND active - isExactKb): a record the shop holds.
  "kb-exact": "kb_published",
  // Everything below is decided as an UNAPPROVED source (kb_draft, no score),
  // which decide() never attaches. FactSource has no "enrichment"/"strain",
  // and labelling them a record would be a guess.
  "kb-draft": "kb_draft",
  enrichment: "kb_draft",
  strain: "kb_draft",
});

/** Plain reason for a layer decide() would only "suggest". */
const LAYER_REASON: Readonly<Record<Exclude<MemoryOrigin, "kb-exact" | "history">, string>> = Object.freeze({
  "kb-draft": "Saved as a knowledge-base draft that nobody has approved yet, so it is shown but not counted.",
  enrichment: "On the Enrichment page, but not an approved knowledge-base record for this product, so it is shown but not counted.",
  strain: "From the strain library (it describes the strain, not this exact product), so it is shown but not counted.",
});

function candidateFromKnowledge(k: ProductKnowledge, field: MemoryField): RememberedFact | null {
  if (k.source === "none") return null;
  const value = knowledgeFieldValue(k, field);
  if (value === null) return null;
  // Rung 4 maps the STRAIN summary into `description` (fromStrainPure); it is
  // not this product's description, so it is never offered as one.
  if (k.source === "strain" && (field === "description" || field === "short_description")) return null;
  const origin: MemoryOrigin = k.source;
  const source = ORIGIN_SOURCE[origin];
  const v: PolicyVerdict = decide(field, { source, value, confidence: null });
  const covered = v.decision === "attach";
  return {
    field,
    value,
    origin,
    source,
    confidence: null,
    at: null,
    covered,
    reason: covered ? "Approved in your knowledge base." : origin === "kb-exact" ? v.reason : LAYER_REASON[origin],
  };
}

function candidateFromHistory(row: ProvenanceRecallRow, field: MemoryField): RememberedFact | null {
  if (!isFactSource(row.source)) return null;
  const value = memoryValue(field, row.value_json);
  if (value === null) return null;
  const confidence = percentFromStored(row.confidence);
  const v = decide(field, { source: row.source, value, confidence });
  return {
    field,
    value,
    origin: "history",
    source: row.source,
    confidence,
    at: typeof row.created_at === "string" ? row.created_at : null,
    covered: v.decision === "attach",
    reason: v.reason,
  };
}

/** Newest history row per field (ties keep the first seen). Unparseable dates lose. */
function newestByField(rows: readonly ProvenanceRecallRow[]): Map<string, ProvenanceRecallRow> {
  const best = new Map<string, { row: ProvenanceRecallRow; t: number }>();
  for (const r of rows) {
    if (!r || typeof r.field !== "string") continue;
    const t0 = Date.parse(r.created_at);
    const t = Number.isFinite(t0) ? t0 : -Infinity;
    const cur = best.get(r.field);
    if (!cur || t > cur.t) best.set(r.field, { row: r, t });
  }
  const out = new Map<string, ProvenanceRecallRow>();
  for (const [f, v] of best) out.set(f, v.row);
  return out;
}

/**
 * Pick one fact per field. A covered candidate beats an uncovered one; among
 * covered, the approved KB record beats history (the owner's published copy
 * is the golden record); among uncovered, the KB layer is shown first.
 */
function pick(kb: RememberedFact | null, hist: RememberedFact | null): RememberedFact | null {
  if (kb?.covered) return kb;
  if (hist?.covered) return hist;
  return kb ?? hist;
}

/**
 * THE RECALL. Null when identity is "" (never a wildcard - bible S09.5) or
 * when nothing at all is known (no facts and never seen before).
 */
export function buildProductMemory(input: {
  identityKey: string | null | undefined;
  knowledge?: ProductKnowledge | null;
  provenance?: readonly ProvenanceRecallRow[] | null;
  lastSeen?: LastSeen | null;
}): ProductMemory | null {
  const identityKey = typeof input.identityKey === "string" ? input.identityKey.trim() : "";
  if (identityKey === "") return null;
  const history = newestByField(Array.isArray(input.provenance) ? input.provenance : []);
  const facts: RememberedFact[] = [];
  for (const field of MEMORY_TARGET_FIELDS) {
    const kb = input.knowledge ? candidateFromKnowledge(input.knowledge, field) : null;
    const h = history.get(field);
    const hist = h ? candidateFromHistory(h, field) : null;
    const chosen = pick(kb, hist);
    if (chosen) facts.push(chosen);
  }
  const covered = facts.filter((f) => f.covered).map((f) => f.field);
  const missing = MEMORY_TARGET_FIELDS.filter((f) => !covered.includes(f));
  let lastSeen = input.lastSeen ?? null;
  if (!lastSeen) {
    // Fallback: the newest fact-history row is a real time something about
    // this product was recorded. Never invented.
    let newest: string | null = null;
    let nt = -Infinity;
    for (const r of history.values()) {
      const t = Date.parse(r.created_at);
      if (Number.isFinite(t) && t > nt) {
        nt = t;
        newest = r.created_at;
      }
    }
    if (newest) lastSeen = { at: newest, from: null, kind: "recorded" };
  }
  if (facts.length === 0 && !lastSeen) return null;
  return { identityKey, facts, covered, missing, complete: missing.length === 0, lastSeen };
}

// --- 5. "Last onboarded" from approved-draft history -----------------------------------

/** The approved-draft history rows recall needs (listPriorClassifications shape). */
export interface OnboardedHistoryRow {
  vendorName?: string | null;
  brandName?: string | null;
  productName?: string | null;
  category?: string | null;
  decidedAt?: string | null;
}

/**
 * The newest APPROVED draft of the same product identity, or null. Same key
 * algorithm as the draft (productIdentityKey); "" never matches anything.
 */
export function lastOnboarded(identityKey: string | null | undefined, history: readonly OnboardedHistoryRow[] | null | undefined): LastSeen | null {
  const key = typeof identityKey === "string" ? identityKey.trim() : "";
  if (key === "" || !Array.isArray(history)) return null;
  let best: { row: OnboardedHistoryRow; t: number } | null = null;
  for (const row of history) {
    if (!row) continue;
    const t = Date.parse(String(row.decidedAt ?? ""));
    if (!Number.isFinite(t)) continue;
    const k = productIdentityKey({
      vendorName: row.vendorName,
      brandName: row.brandName,
      productName: row.productName,
      category: row.category,
    });
    if (k !== key) continue;
    if (!best || t > best.t) best = { row, t };
  }
  if (!best) return null;
  const from = cleanText(best.row.vendorName) ?? cleanText(best.row.brandName);
  return { at: String(best.row.decidedAt), from, kind: "onboarded" };
}

// --- 6. Decisions -------------------------------------------------------------------------

/** Skip the Gemini call? Only flag on + no refresh asked + every target covered. */
export function shouldSkipGemini(input: { enabled: boolean; refresh: boolean; memory: ProductMemory | null }): boolean {
  return input.enabled === true && input.refresh !== true && input.memory !== null && input.memory.complete === true;
}

const MAX_PROMPT_VALUE = 200;

function promptValue(v: string | string[]): string {
  const s = Array.isArray(v) ? v.join(", ") : v;
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_PROMPT_VALUE ? `${one.slice(0, MAX_PROMPT_VALUE - 1)}\u2026` : one;
}

/**
 * The "already known" block appended to the v2 user prompt for a PARTIAL
 * memory. Only covered facts (approved / married at >= 90%) are listed;
 * drafts are never fed back to the model as truth. "" when nothing is
 * covered, so the S06 prompt stays byte-identical.
 */
export function alreadyKnownPromptBlock(memory: ProductMemory | null | undefined): string {
  if (!memory) return "";
  const covered = memory.facts.filter((f) => f.covered);
  if (covered.length === 0) return "";
  const lines = covered.map((f) => `- ${f.field}: ${JSON.stringify(promptValue(f.value))}`);
  return [
    "",
    "",
    "Already on file for this product (approved by the shop). Do not spend effort re-finding these;",
    "return them as null unless you find a clearly more specific fact with a source:",
    ...lines,
    `Focus on: ${memory.missing.join(", ") || "(nothing)"}.`,
  ].join("\n");
}

/** The lookup-shaped values a skipped lookup returns (covered facts only). */
export function memoryLookupValues(memory: ProductMemory): {
  description: string;
  shortDescription: string;
  effects: string[];
  aromaNotes: string[];
  flavorNotes: string[];
} {
  const get = (f: MemoryField) => memory.facts.find((x) => x.field === f && x.covered)?.value ?? null;
  const text = (f: MemoryField) => {
    const v = get(f);
    return typeof v === "string" ? v : "";
  };
  const list = (f: MemoryField) => {
    const v = get(f);
    return Array.isArray(v) ? [...v] : [];
  };
  return {
    description: text("description"),
    shortDescription: text("short_description"),
    effects: list("effects"),
    aromaNotes: list("aroma"),
    flavorNotes: list("flavor"),
  };
}

/** The model label a skipped lookup reports (shown under the worksheet, audited). */
export const MEMORY_MODEL_LABEL = "Already on file (knowledge base) \u2014 no web lookup";

/**
 * Overall confidence (0-100) of a memory answer: the LOWEST covered fact's
 * score, where an owner-approved KB fact (no model score) counts as 100.
 * Covered history facts are >= 90 by construction (decide()), so this never
 * overstates the weakest fact. 0 when nothing is covered.
 */
export function memoryOverallConfidence(memory: ProductMemory | null | undefined): number {
  if (!memory) return 0;
  const covered = memory.facts.filter((f) => f.covered);
  if (covered.length === 0) return 0;
  let low = 100;
  for (const f of covered) {
    const c = f.confidence === null ? 100 : f.confidence;
    if (c < low) low = c;
  }
  return Math.round(low);
}

/**
 * A complete memory as the RAW lookup shape, so the server action runs it
 * through the SAME postProcessLookup compliance gate as a Gemini reply (an
 * approved record is re-linted against today's banned list; nothing skips
 * the gate). Strain type is "unknown" at 0: memory never decides strain type
 * (other gates own it), so autofill can never fire from memory.
 */
export function memoryRawLookup(memory: ProductMemory): RawProductLookup {
  const v = memoryLookupValues(memory);
  return {
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: v.effects,
    aroma_notes: v.aromaNotes,
    flavor_notes: v.flavorNotes,
    lineage: "",
    found: memory.covered.length > 0,
    confidence: memoryOverallConfidence(memory) / 100,
    description: v.description,
    short_description: v.shortDescription,
    category: "",
    potency_ratio: "",
    size: "",
    image_candidates: [],
  };
}

/** The panel's one-line notice for a memory answer (per-field source list). */
export function memoryResultNotice(memory: ProductMemory, now: Date): string {
  const chip = memoryChipCopy(memory, now);
  const where = Array.from(
    new Set(memory.facts.filter((f) => f.covered).map((f) => (f.origin === "history" ? `earlier lookup ${factSourceLabel(f.source, f.confidence)}` : factSourceLabel(f.source, f.confidence, f.origin)))),
  );
  const head = chip?.title || "Known product.";
  return `${head} Every fact below is already on file (${joinList(where)}), so no web lookup was made and nothing was spent. Press Refresh from web if the product changed.`;
}

// --- 7. Labels + copy -----------------------------------------------------------------------

/** A source label for chips (S09 + S11). Confidence is 0-100 or null. */
export function factSourceLabel(source: string, confidence: number | null = null, origin: MemoryOrigin | null = null): string {
  if (origin === "kb-exact") return "KB";
  if (origin === "kb-draft") return "KB draft";
  if (origin === "enrichment") return "Enrichment";
  if (origin === "strain") return "Strain library";
  switch (source) {
    case "manifest":
      return "Manifest";
    case "coa":
      return "COA";
    case "kb_published":
      return "KB";
    case "kb_draft":
      return "KB draft";
    case "gemini":
      return confidence === null ? "Gemini" : `Gemini ${Math.round(confidence)}%`;
    case "human":
      return "You";
    case "remembered":
      return "Remembered";
    case "cultivera":
      return "Cultivera";
    default:
      return "Unknown source";
  }
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface MemoryChip {
  title: string;
  detail: string;
  tone: "accent" | "muted";
}

/**
 * The row chip (bible S09.4). Wording is held to what is TRUE today:
 *   - "last onboarded <date> from <vendor>" only from an approved draft; a
 *     history-only date says "fact last recorded"; no date -> no date.
 *   - covered facts are "on file"; S12 (not shipped) is what copies them onto
 *     the menu item at approve, so this chip never promises "auto-attach on
 *     approve".
 */
export function memoryChipCopy(memory: ProductMemory | null | undefined, now: Date): MemoryChip | null {
  if (!memory) return null;
  const when = memory.lastSeen ? shortDeliveryDate(memory.lastSeen.at, now) : null;
  let seen = "";
  if (memory.lastSeen && when) {
    seen =
      memory.lastSeen.kind === "onboarded"
        ? ` \u2014 last onboarded ${when}${memory.lastSeen.from ? ` from ${memory.lastSeen.from}` : ""}`
        : ` \u2014 a fact was last recorded ${when}`;
  }
  const title = memory.facts.length > 0 || memory.lastSeen ? `Known product${seen}.` : "";
  const label = (fs: readonly MemoryField[]) => joinList(fs.map((f) => MEMORY_FIELD_LABEL[f]));
  const parts: string[] = [];
  const n = memory.covered.length;
  if (memory.complete) {
    parts.push(`All ${n} facts are already on file (${label(memory.covered)}), so no web lookup is needed. Press Refresh from web in the lookup if the product changed.`);
  } else if (n > 0) {
    parts.push(`${n} of ${MEMORY_TARGET_FIELDS.length} facts are on file (${label(memory.covered)}). A lookup only needs to find ${label(memory.missing)}.`);
  }
  const waiting = memory.facts.filter((f) => !f.covered);
  if (waiting.length > 0) {
    const where = Array.from(new Set(waiting.map((f) => factSourceLabel(f.source, f.confidence, f.origin))));
    parts.push(
      `${waiting.length} more ${waiting.length === 1 ? "is" : "are"} saved but not approved yet (${label(waiting.map((f) => f.field))} \u2014 ${joinList(where)}), so ${waiting.length === 1 ? "it is" : "they are"} not counted.`,
    );
  }
  if (memory.facts.length === 0) parts.push("Nothing about it is on file yet, so a lookup is still needed.");
  return { title, detail: parts.join(" "), tone: n > 0 ? "accent" : "muted" };
}

/** Audit payload: counts and field names only (never values). */
export function memoryAuditPayload(memory: ProductMemory | null, skipped: boolean, refresh: boolean): {
  known: boolean;
  covered: string[];
  missing: string[];
  skippedGemini: boolean;
  refresh: boolean;
} {
  return {
    known: memory !== null,
    covered: memory ? [...memory.covered] : [],
    missing: memory ? [...memory.missing] : [...MEMORY_TARGET_FIELDS],
    skippedGemini: skipped,
    refresh,
  };
}

/** Is a value empty in the policy's sense (re-export for callers' checks). */
export function isEmptyMemoryValue(v: unknown): boolean {
  return isEmptyFactValue(v);
}

// --- Self-tests ------------------------------------------------------------------------------

export function __runFactMemoryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  \u2717 fact-memory-core: ${msg}`);
    }
  };
  const K = "phat panda|flower|blue dream";
  const know = (over: Partial<ProductKnowledge> = {}): ProductKnowledge => ({
    source: "kb-exact",
    displayName: "Blue Dream",
    description: "A bright, berry-forward flower.",
    shortDescription: "Berry and pine.",
    aromaNotes: ["berry", "pine"],
    flavorNotes: ["sweet"],
    terpenes: [],
    effects: ["relaxed"],
    imageMediaIds: [],
    primaryMediaId: null,
    imageHint: "substitute",
    needsOnline: false,
    ...over,
  });
  const prov = (field: string, value: unknown, source = "gemini", confidence: number | null = 0.94, at = "2026-03-12T18:00:00Z"): ProvenanceRecallRow => ({
    field,
    value_json: value,
    source,
    confidence,
    created_at: at,
  });

  // Flag
  ok(kbFirstOnboardingEnabled(undefined) === true, "unset -> on");
  ok(kbFirstOnboardingEnabled("") === true, "blank -> on");
  ok(kbFirstOnboardingEnabled(" OFF ") === false, "OFF -> off");
  for (const v of ["0", "false", "no", "disabled", "off"]) ok(kbFirstOnboardingEnabled(v) === false, `${v} -> off`);
  ok(kbFirstOnboardingEnabled("on") === true, "on -> on");
  ok(kbFirstOnboardingEnabled("junk") === true, "junk -> on (default)");
  ok(KB_FIRST_ONBOARDING_ENV === "KB_FIRST_ONBOARDING", "env name");

  // '' identity -> null (bible S09.5)
  ok(buildProductMemory({ identityKey: "", knowledge: know() }) === null, "'' identity -> null");
  ok(buildProductMemory({ identityKey: "   ", knowledge: know() }) === null, "blank identity -> null");
  ok(buildProductMemory({ identityKey: null, knowledge: know() }) === null, "null identity -> null");
  ok(buildProductMemory({ identityKey: K }) === null, "nothing known -> null");
  ok(buildProductMemory({ identityKey: K, knowledge: know({ source: "none" }) }) === null, "ladder miss -> null");

  // Approved KB covers everything
  const full = buildProductMemory({ identityKey: K, knowledge: know() })!;
  ok(full !== null && full.complete, "kb-exact with all five -> complete");
  ok(full.covered.length === 5 && full.missing.length === 0, "covered 5, missing 0");
  ok(full.facts.every((f) => f.source === "kb_published" && f.origin === "kb-exact"), "kb-exact -> kb_published");
  ok(full.facts[0].reason === "Approved in your knowledge base.", "covered reason");
  ok(full.identityKey === K, "identity carried");

  // Partial KB
  const part = buildProductMemory({ identityKey: K, knowledge: know({ shortDescription: "  ", flavorNotes: [] }) })!;
  ok(!part.complete, "missing two -> not complete");
  ok(part.missing.join(",") === "short_description,flavor", "missing list in field order");
  ok(part.covered.join(",") === "description,effects,aroma", "covered list in field order");

  // KB draft / enrichment / strain never cover
  const draft = buildProductMemory({ identityKey: K, knowledge: know({ source: "kb-draft" }) })!;
  ok(draft.covered.length === 0 && draft.facts.length === 5, "kb-draft: shown, never covered");
  ok(draft.facts[0].source === "kb_draft" && draft.facts[0].reason.includes("nobody has approved"), "kb-draft reason");
  const enr = buildProductMemory({ identityKey: K, knowledge: know({ source: "enrichment", aromaNotes: [], flavorNotes: [], effects: [] }) })!;
  ok(enr.covered.length === 0 && enr.facts.length === 2 && enr.facts[0].origin === "enrichment", "enrichment: shown, never covered");
  const strain = buildProductMemory({ identityKey: K, knowledge: know({ source: "strain" }) })!;
  ok(!strain.facts.some((f) => f.field === "description" || f.field === "short_description"), "strain summary is never a product description");
  ok(strain.facts.length === 3 && strain.covered.length === 0, "strain lists shown, not covered");

  // History (0235) - married at >= 90 covers; below does not
  const h = buildProductMemory({
    identityKey: K,
    provenance: [prov("description", "Married text."), prov("effects", ["calm"], "gemini", 0.895), prov("aroma", ["citrus"], "human", null)],
  })!;
  ok(h.facts.find((f) => f.field === "description")?.covered === true, "gemini 94 history -> covered");
  ok(h.facts.find((f) => f.field === "description")?.confidence === 94, "0.94 -> 94 (no float noise)");
  ok(h.facts.find((f) => f.field === "effects")?.covered === false, "gemini 89.5 -> not covered (no rounding up)");
  ok(h.facts.find((f) => f.field === "aroma")?.covered === true, "human history -> covered");
  ok(h.lastSeen?.kind === "recorded" && h.lastSeen.at === "2026-03-12T18:00:00Z", "history date is the fallback last-seen");
  ok(buildProductMemory({ identityKey: K, provenance: [prov("description", "x", "bogus")] }) !== null, "unknown source row still dates the product");
  ok(buildProductMemory({ identityKey: K, provenance: [prov("description", "x", "bogus")] })!.facts.length === 0, "unknown source -> no fact");
  ok(buildProductMemory({ identityKey: K, provenance: [prov("description", 42)] })!.facts.length === 0, "wrong-type value -> no fact");
  ok(buildProductMemory({ identityKey: K, provenance: [prov("terpenes", ["x"])] })!.facts.length === 0, "non-target field ignored");
  ok(buildProductMemory({ identityKey: K, provenance: [prov("description", "x", "gemini", 1.5)] })!.facts[0].confidence === null, "out-of-range confidence -> null");

  // Newest history row per field wins
  const newest = buildProductMemory({
    identityKey: K,
    provenance: [prov("description", "old", "gemini", 0.95, "2026-01-01T00:00:00Z"), prov("description", "new", "gemini", 0.5, "2026-02-01T00:00:00Z")],
  })!;
  ok(newest.facts[0].value === "new" && newest.facts[0].covered === false, "newest row wins even when weaker");
  const badDate = buildProductMemory({
    identityKey: K,
    provenance: [prov("description", "dated", "gemini", 0.95, "2026-01-01T00:00:00Z"), prov("description", "undated", "gemini", 0.95, "not a date")],
  })!;
  ok(badDate.facts[0].value === "dated", "unparseable date never wins");

  // Precedence: covered beats uncovered; KB record beats history
  const both = buildProductMemory({ identityKey: K, knowledge: know(), provenance: [prov("description", "Married text.")] })!;
  ok(both.facts[0].value === "A bright, berry-forward flower." && both.facts[0].origin === "kb-exact", "approved KB beats history");
  const draftVsHist = buildProductMemory({ identityKey: K, knowledge: know({ source: "kb-draft" }), provenance: [prov("description", "Married text.")] })!;
  ok(draftVsHist.facts[0].origin === "history" && draftVsHist.facts[0].covered, "covered history beats a KB draft");
  const draftVsWeak = buildProductMemory({ identityKey: K, knowledge: know({ source: "kb-draft" }), provenance: [prov("description", "weak", "gemini", 0.5)] })!;
  ok(draftVsWeak.facts[0].origin === "kb-draft", "uncovered: the KB layer is shown first");

  // Value cleaning
  ok((memoryValue("aroma", ["Pine", " pine ", "", 3, "Citrus"]) as string[]).join("|") === "Pine|Citrus", "list: trim, dedupe case-insensitively, drop junk");
  ok(memoryValue("description", "  a \n b ") === "a b", "text: collapse whitespace");
  ok(memoryValue("description", ["x"]) === null, "text field rejects arrays");
  ok(memoryValue("effects", "calm") === null, "list field rejects strings");
  ok(percentFromStored(0) === 0 && percentFromStored(1) === 100 && percentFromStored(-0.1) === null && percentFromStored("0.9") === null, "percentFromStored bounds");

  // lastOnboarded
  const hist: OnboardedHistoryRow[] = [
    { vendorName: "Phat Panda", brandName: null, productName: "Blue Dream", category: "flower", decidedAt: "2026-03-12T19:00:00Z" },
    { vendorName: "Phat Panda", brandName: null, productName: "Blue Dream", category: "flower", decidedAt: "2026-01-02T19:00:00Z" },
    { vendorName: "Other Farm", brandName: null, productName: "Blue Dream", category: "flower", decidedAt: "2026-04-01T19:00:00Z" },
    { vendorName: "Phat Panda", brandName: null, productName: "Blue Dream", category: "flower", decidedAt: "garbage" },
  ];
  const key = productIdentityKey({ vendorName: "Phat Panda", productName: "Blue Dream", category: "flower" });
  const ls = lastOnboarded(key, hist);
  ok(ls?.at === "2026-03-12T19:00:00Z" && ls.from === "Phat Panda" && ls.kind === "onboarded", "newest approved of the SAME identity");
  ok(lastOnboarded("", hist) === null, "'' identity never matches");
  ok(lastOnboarded(key, null) === null, "no history -> null");
  ok(lastOnboarded(key, [{ ...hist[0], vendorName: null, brandName: "Phat Panda" }])?.from === "Phat Panda", "brand when no vendor");
  const withSeen = buildProductMemory({ identityKey: key, knowledge: know(), lastSeen: ls, provenance: [prov("description", "x")] })!;
  ok(withSeen.lastSeen?.kind === "onboarded", "approved-draft date beats history date");
  const seenOnly = buildProductMemory({ identityKey: key, lastSeen: ls })!;
  ok(seenOnly !== null && seenOnly.facts.length === 0 && !seenOnly.complete, "seen before, nothing on file");

  // shouldSkipGemini
  ok(shouldSkipGemini({ enabled: true, refresh: false, memory: full }) === true, "complete -> skip");
  ok(shouldSkipGemini({ enabled: false, refresh: false, memory: full }) === false, "flag off -> never skip");
  ok(shouldSkipGemini({ enabled: true, refresh: true, memory: full }) === false, "refresh -> never skip");
  ok(shouldSkipGemini({ enabled: true, refresh: false, memory: part }) === false, "partial -> no skip");
  ok(shouldSkipGemini({ enabled: true, refresh: false, memory: draft }) === false, "drafts only -> no skip");
  ok(shouldSkipGemini({ enabled: true, refresh: false, memory: null }) === false, "no memory -> no skip");

  // Prompt block
  ok(alreadyKnownPromptBlock(null) === "", "no memory -> ''");
  ok(alreadyKnownPromptBlock(draft) === "", "nothing covered -> '' (prompt byte-identical)");
  const block = alreadyKnownPromptBlock(part);
  ok(block.startsWith("\n\nAlready on file for this product"), "block leads with a blank line");
  ok(block.includes('- description: "A bright, berry-forward flower."'), "covered value listed (JSON-quoted)");
  ok(block.includes('- aroma: "berry, pine"'), "list joined");
  ok(!block.includes("short_description:"), "missing field not listed as known");
  ok(block.trimEnd().endsWith("Focus on: short_description, flavor."), "focus line names the missing fields");
  const long = buildProductMemory({ identityKey: K, knowledge: know({ description: "x".repeat(500) }) })!;
  ok(alreadyKnownPromptBlock(long).includes(`"${"x".repeat(199)}\u2026"`), "long values truncated to 200");
  ok(!alreadyKnownPromptBlock(draftVsWeak).includes("weak"), "uncovered history never fed to the model");

  // memoryLookupValues
  const vals = memoryLookupValues(part);
  ok(vals.description === "A bright, berry-forward flower." && vals.shortDescription === "" && vals.flavorNotes.length === 0, "lookup values: covered only");
  ok(memoryLookupValues(draft).effects.length === 0, "drafts never become lookup values");

  // Labels
  ok(factSourceLabel("gemini", 94) === "Gemini 94%", "gemini %");
  ok(factSourceLabel("gemini", 89.5) === "Gemini 90%", "gemini rounds for display only");
  ok(factSourceLabel("gemini") === "Gemini", "gemini without score");
  ok(factSourceLabel("human") === "You" && factSourceLabel("manifest") === "Manifest" && factSourceLabel("coa") === "COA", "record labels");
  ok(factSourceLabel("remembered") === "Remembered" && factSourceLabel("kb_published") === "KB", "remembered + kb");
  ok(factSourceLabel("kb_draft", null, "enrichment") === "Enrichment", "origin wins over source");
  ok(factSourceLabel("zzz") === "Unknown source", "unknown -> honest label");

  // Chip copy
  const now = new Date("2026-05-01T12:00:00Z");
  const c1 = memoryChipCopy(withSeen, now)!;
  ok(c1.title === "Known product \u2014 last onboarded Mar 12 from Phat Panda.", `title: ${c1.title}`);
  ok(c1.detail.startsWith("All 5 facts are already on file"), "complete detail");
  ok(c1.detail.includes("Refresh from web"), "names the refresh escape hatch");
  ok(!/auto-attach/i.test(c1.detail), "never promises auto-attach on approve (S12 not shipped)");
  ok(c1.tone === "accent", "accent when covered");
  const c2 = memoryChipCopy(part, now)!;
  ok(c2.title === "Known product.", "no date -> no date");
  ok(c2.detail.startsWith("3 of 5 facts are on file (description, effects and aroma). A lookup only needs to find short line and flavor."), `partial: ${c2.detail}`);
  const c3 = memoryChipCopy(draft, now)!;
  ok(c3.detail.includes("5 more are saved but not approved yet") && c3.detail.includes("KB draft"), `drafts: ${c3.detail}`);
  ok(c3.tone === "muted", "muted when nothing covered");
  const c4 = memoryChipCopy(seenOnly, now)!;
  ok(c4.detail === "Nothing about it is on file yet, so a lookup is still needed.", "seen-only copy");
  ok(memoryChipCopy(h, now)!.title === "Known product \u2014 a fact was last recorded Mar 12.", "history date says recorded");
  ok(memoryChipCopy(null, now) === null, "null -> no chip");
  const one = buildProductMemory({ identityKey: K, knowledge: know({ source: "kb-draft", shortDescription: null, aromaNotes: [], flavorNotes: [], effects: [] }) })!;
  ok(memoryChipCopy(one, now)!.detail.includes("1 more is saved but not approved yet") && memoryChipCopy(one, now)!.detail.includes("it is not counted"), "singular grammar");

  // Audit
  const a = memoryAuditPayload(part, false, true);
  ok(a.known && a.covered.length === 3 && a.missing.length === 2 && !a.skippedGemini && a.refresh, "audit payload");
  ok(memoryAuditPayload(null, false, false).missing.length === 5, "audit: no memory -> all missing");
  ok(!JSON.stringify(memoryAuditPayload(full, true, false)).includes("berry"), "audit never carries values");
  ok(isEmptyMemoryValue("  ") && !isEmptyMemoryValue("x"), "empty re-export");

  // Memory as a lookup answer
  ok(MEMORY_MODEL_LABEL.includes("no web lookup"), "model label says no web lookup");
  ok(memoryOverallConfidence(full) === 100, `KB-only complete -> 100 (${memoryOverallConfidence(full)})`);
  ok(memoryOverallConfidence(null) === 0, "null -> 0");
  ok(memoryOverallConfidence(draft) === 0, "nothing covered -> 0");
  const mixed = buildProductMemory({
    identityKey: K,
    knowledge: know({ flavorNotes: [] }),
    provenance: [prov("flavor", ["citrus"], "gemini", 0.91)],
  })!;
  ok(mixed.complete && memoryOverallConfidence(mixed) === 91, `lowest covered wins (${memoryOverallConfidence(mixed)})`);
  const raw = memoryRawLookup(full);
  ok(raw.strain_type === "unknown" && raw.strain_type_confidence === 0, "memory never decides strain type");
  ok(raw.found === true && raw.confidence === 1, "found + confidence 1.0 on stored scale");
  ok(raw.description === "A bright, berry-forward flower." && raw.short_description === "Berry and pine.", "copy carried");
  ok(raw.aroma_notes?.join(",") === "berry,pine" && raw.flavor_notes?.join(",") === "sweet" && raw.effects.join(",") === "relaxed", "lists carried");
  ok(raw.summary === "" && raw.lineage === "" && (raw.image_candidates ?? []).length === 0 && raw.category === "", "no invented fields");
  const rawDraft = memoryRawLookup(draft);
  ok(rawDraft.found === false && rawDraft.description === "" && rawDraft.effects.length === 0, "uncovered facts never leak into an answer");
  const note = memoryResultNotice(withSeen, now);
  ok(note.startsWith("Known product \u2014 last onboarded Mar 12 from Phat Panda.") && note.includes("(KB)") && note.includes("nothing was spent") && note.includes("Refresh from web"), `notice: ${note}`);
  const note2 = memoryResultNotice(mixed, now);
  ok(note2.includes("KB and earlier lookup Gemini 91%"), `notice mixed: ${note2}`);

  return { passed, failed };
}
