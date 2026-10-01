/**
 * src/lib/catalog/fact-chips-core.ts  (S11 - onboarding row redesign)
 *
 * PURE. The onboarding row's "what is attached, from where, how sure" view:
 *
 *   buildFactChips(attachedFacts, memory, policy)   (bible S11.5)
 *
 * One chip per row fact, each with a source label (Manifest / COA / KB /
 * Gemini 94% / You / Remembered ...), a confidence, and a plain-English WHY.
 * Fields with no counted chip become the red line
 * "Enrichment will ask for: category, size" and the Facts column "7/9".
 *
 * === WHERE EACH CHIP COMES FROM (verified, not assumed) ===
 *
 *   1. Records the row already holds (the page passes them in; pure helper
 *      rowRecordFacts() below derives them from data the page ALREADY reads):
 *        category     the approver's pick (0141) or the resolver's answer
 *                     (website-category-resolver.ts ResolutionSource);
 *        strain type  the approver's pick (0146), else suggestStrainType()
 *                     (strain library 100 > manifest 95 > name parse);
 *        potency      draft THC, which seeding copies ONLY from the lot's
 *                     lab result (catalog-drafts.ts, `lab_results` read).
 *   2. The draft's attached facts (0235 jsonb, written by the S07 door after
 *      a Save that really landed - attach-facts.ts step 4b). Read through
 *      attachedFactsOf() with the core's DRAFT_FACT_COLUMNS constant.
 *   3. The S09 product memory (fact-memory-core.ts): a fact counts only
 *      when S09's decide() pass said "attach" (memory.covered).
 *
 * === WHAT "COUNTED" MEANS ===
 *
 * A chip is counted (it fills its slot in "7/9") only when its source is one
 * the S10 policy would attach without a person: a person (You), a record the
 * shop holds (COA, manifest, approved KB, the live menu, the strain
 * library), or a web finding at >= ATTACH_AUTO_MIN_CONFIDENCE (90). A name
 * guess, an unapproved KB draft, a low-confidence finding or a potency with
 * no linked lab certificate is SHOWN (with its why) but never counted, so
 * the operator is never told a guess is a fact (rule 3.1).
 *
 * === SURVIVORSHIP (one chip per field) ===
 *
 * Several sources can know the same field. The chip shown is the best one,
 * by the MDM survivorship order the 0235 column comment states
 * (Human > coa/manifest > kb_published > gemini): counted beats not counted,
 * then source rank, then newest. The others are listed under "also".
 * (Survivorship rules: https://profisee.com/blog/mdm-survivorship)
 *
 * === THE "WHY" IS VISIBLE, NOT A HOVER TITLE ===
 *
 * The renderer shows the why in a native <details> disclosure (a
 * "toggletip"): keyboard and touch reachable, read by screen readers, unlike
 * a title="" tooltip. (http://inclusive-components.design/tooltips-toggletips)
 *
 * No I/O. Embedded self-tests at the bottom (run-pure-selftests.ts).
 */

import {
  DRAFT_FACT_COLUMNS,
  isFactSource,
  isStoredConfidence,
  type AttachedFact,
  type AttachedFacts,
  type FactSource,
} from "./attach-facts-core";
import { ATTACH_AUTO_MIN_CONFIDENCE, type AttachPolicyMode } from "./fact-attach-policy-core";
import { factSourceLabel, percentFromStored, type MemoryField, type ProductMemory, type RememberedFact } from "./fact-memory-core";

// --- 1. Flag ---------------------------------------------------------------------

/** Rollback (bible S11.7): ONBOARDING_V2_ROW=off renders today's row. */
export const ONBOARDING_V2_ROW_ENV = "ONBOARDING_V2_ROW";

/** Same idiom as every intake flag: off/0/false/no/disabled -> off; else on. */
export function onboardingV2RowEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// --- 2. Vocabulary -----------------------------------------------------------------

/**
 * The nine facts the Facts column counts, in display order. The first three
 * are classifying facts the approve form already shows; the last six are the
 * descriptive facts the Enrichment page asks for (description, short line,
 * effects, aroma, flavor - the S09 MEMORY_TARGET_FIELDS - plus images, which
 * the S10 policy always leaves to a person).
 */
export const ROW_FACT_FIELDS = [
  "category",
  "strain_type",
  "potency",
  "description",
  "short_description",
  "effects",
  "aroma",
  "flavor",
  "images",
] as const;
export type RowFactField = (typeof ROW_FACT_FIELDS)[number];

export const ROW_FACT_LABEL: Readonly<Record<RowFactField, string>> = Object.freeze({
  category: "category",
  strain_type: "strain type",
  potency: "potency",
  description: "description",
  short_description: "short line",
  effects: "effects",
  aroma: "aroma",
  flavor: "flavor",
  images: "images",
});

/** Bible S11.4 empty state, verbatim. */
export const EMPTY_FACTS_COPY =
  "Nothing attached yet \u2014 press Look up to fetch from the web, or approve and fill it in on Enrichment.";

/** Bible S11.2, verbatim. */
export const NO_VENDOR_IDENTITY_COPY = "Cannot remember this product: manifest has no vendor";
export const NO_NAME_IDENTITY_COPY = "Cannot remember this product: manifest has no product name";
export const NO_FAMILY_IDENTITY_COPY =
  "Cannot remember this product: once the size and brand are removed from its name, nothing is left to match on";

/**
 * Where a chip came from. FactSource (the 0235 vocabulary) plus the four
 * row-only origins that are NOT fact-history sources, so they are never
 * written anywhere - they only label what the row already shows.
 */
export type ChipSource = FactSource | "menu" | "strain_library" | "name" | "draft";

const ROW_ONLY_LABEL: Readonly<Record<Exclude<ChipSource, FactSource>, string>> = Object.freeze({
  menu: "Live menu",
  strain_library: "Strain library",
  name: "Product name",
  draft: "Draft",
});

/** Survivorship rank: lower wins (0235 column comment order). */
const SOURCE_RANK: Readonly<Record<ChipSource, number>> = Object.freeze({
  human: 0,
  coa: 1,
  manifest: 2,
  menu: 3,
  kb_published: 4,
  strain_library: 5,
  gemini: 6,
  remembered: 7,
  cultivera: 8,
  kb_draft: 9,
  name: 10,
  draft: 11,
});

/** Sources the S10 policy treats as a fact without a person (no score needed). */
const COUNTED_WITHOUT_SCORE: ReadonlySet<ChipSource> = new Set<ChipSource>([
  "human",
  "coa",
  "manifest",
  "menu",
  "kb_published",
  "strain_library",
]);

/** Label for a chip source; Gemini carries its percentage ("Gemini 94%"). */
export function chipSourceLabel(source: ChipSource, confidencePct: number | null = null): string {
  if (source === "menu" || source === "strain_library" || source === "name" || source === "draft") return ROW_ONLY_LABEL[source];
  return factSourceLabel(source, confidencePct);
}

/** Is a chip with this source + 0-100 confidence counted? */
export function isCountedSource(source: ChipSource, confidencePct: number | null): boolean {
  if (COUNTED_WITHOUT_SCORE.has(source)) return true;
  if (source === "gemini") return confidencePct !== null && confidencePct >= ATTACH_AUTO_MIN_CONFIDENCE;
  return false;
}

/** "94%" (rounded), or "" when there is no score. */
export function confidenceText(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "";
  return `${Math.round(pct)}%`;
}

// --- 3. Reading the draft's attached facts (0235) ------------------------------------

/**
 * The draft row's attached facts, validated entry by entry. Absent column
 * (0235 not applied), NULL, or a non-object -> null. An entry with an unknown
 * source, a non-0..1 confidence or no timestamp is dropped (a malformed
 * entry is never shown as a fact).
 */
export function attachedFactsOf(row: Record<string, unknown> | null | undefined): AttachedFacts | null {
  if (!row || typeof row !== "object") return null;
  const raw = row[DRAFT_FACT_COLUMNS[0]];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: AttachedFacts = {};
  for (const [field, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const e = v as Record<string, unknown>;
    if (!isFactSource(e.source)) continue;
    const confidence = e.confidence === undefined ? null : e.confidence;
    if (!isStoredConfidence(confidence)) continue;
    if (typeof e.at !== "string" || e.at.trim() === "") continue;
    out[field] = { value: e.value, source: e.source, confidence: confidence as number | null, at: e.at };
  }
  return out;
}

// --- 4. Record facts the row already holds -------------------------------------------

/** The resolver's sources (website-category-resolver.ts ResolutionSource). */
export type CategoryVia = "human" | "override" | "menu_item" | "inventory_type" | "heuristic" | "unmapped";

export interface RowRecordFacts {
  category?: { value: string; label: string; via: CategoryVia } | null;
  strainType?: { value: string; label: string; via: "human" | "strain library" | "manifest" | "product name"; confidence: number | null } | null;
  potency?: { thcPct: number; hasLab: boolean } | null;
}

/** Inputs rowRecordFacts() reads - all already on the page (no new query). */
export interface RowRecordInput {
  chosenWebsiteCategory: string | null | undefined;
  resolvedWebsiteCategory: string | null | undefined;
  resolutionSource: CategoryVia | null | undefined;
  categoryLabel: (value: string) => string;
  chosenStrainType: string | null | undefined;
  strainSuggestion: { value: string; confidence: number; source: "strain library" | "manifest" | "product name" } | null | undefined;
  strainLabel: (value: string) => string;
  totalThcPct: number | null | undefined;
  thcPct: number | null | undefined;
  labResultId: string | null | undefined;
}

const clean = (v: string | null | undefined) => String(v ?? "").trim();

export function rowRecordFacts(input: RowRecordInput): RowRecordFacts {
  const out: RowRecordFacts = {};
  const chosen = clean(input.chosenWebsiteCategory);
  const resolved = clean(input.resolvedWebsiteCategory);
  if (chosen) out.category = { value: chosen, label: input.categoryLabel(chosen), via: "human" };
  else if (resolved && input.resolutionSource && input.resolutionSource !== "unmapped") {
    out.category = { value: resolved, label: input.categoryLabel(resolved), via: input.resolutionSource };
  }
  const pick = clean(input.chosenStrainType);
  if (pick && pick !== "unknown") out.strainType = { value: pick, label: input.strainLabel(pick), via: "human", confidence: null };
  else if (input.strainSuggestion && clean(input.strainSuggestion.value) && input.strainSuggestion.value !== "unknown") {
    out.strainType = {
      value: input.strainSuggestion.value,
      label: input.strainLabel(input.strainSuggestion.value),
      via: input.strainSuggestion.source,
      confidence: input.strainSuggestion.confidence,
    };
  }
  const thc = input.totalThcPct ?? input.thcPct;
  if (typeof thc === "number" && Number.isFinite(thc)) out.potency = { thcPct: thc, hasLab: Boolean(clean(input.labResultId)) };
  return out;
}

// --- 5. buildFactChips ---------------------------------------------------------------

export interface FactChip {
  field: RowFactField;
  fieldLabel: string;
  /** Short preview of the value (lists joined, long text cut at 90 chars). */
  value: string;
  source: ChipSource;
  sourceLabel: string;
  /** 0-100, or null when the source has no score. */
  confidencePct: number | null;
  confidenceText: string;
  counted: boolean;
  why: string;
  /** Labels of other sources that also know this field (lower priority). */
  also: string[];
  /** True when the fact was recalled from an earlier delivery / the KB. */
  remembered: boolean;
}

export interface FactChipsPolicy {
  mode: AttachPolicyMode;
}

export interface FactChipsView {
  chips: FactChip[];
  counted: number;
  total: number;
  /** "7/9" - the Facts column. */
  countLabel: string;
  missing: RowFactField[];
  /** "Enrichment will ask for: category, size", or null when nothing is missing. */
  missingLine: string | null;
  /** EMPTY_FACTS_COPY when there is no chip at all, else null. */
  emptyLine: string | null;
  /** What the ring means for Save selected right now, or null at "act". */
  modeNote: string | null;
}

const PREVIEW_MAX = 90;

/** A value as a one-line preview, or "" when it carries nothing. */
export function previewValue(v: unknown): string {
  let s = "";
  if (typeof v === "string") s = v;
  else if (typeof v === "number" && Number.isFinite(v)) s = String(v);
  else if (Array.isArray(v)) s = v.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => (x as string).trim()).join(", ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX - 1).trimEnd()}\u2026` : s;
}

function isoDay(at: string | null | undefined): string {
  const t = Date.parse(String(at ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

function isRowField(f: string): f is RowFactField {
  return (ROW_FACT_FIELDS as readonly string[]).includes(f);
}

interface Candidate {
  chip: Omit<FactChip, "also">;
  at: number;
}

function cand(
  field: RowFactField,
  value: string,
  source: ChipSource,
  confidencePct: number | null,
  why: string,
  opts: { at?: string | null; remembered?: boolean; counted?: boolean; sourceLabel?: string } = {},
): Candidate | null {
  if (value === "") return null;
  const counted = opts.counted ?? isCountedSource(source, confidencePct);
  const t = Date.parse(String(opts.at ?? ""));
  return {
    chip: {
      field,
      fieldLabel: ROW_FACT_LABEL[field],
      value,
      source,
      sourceLabel: opts.sourceLabel ?? chipSourceLabel(source, confidencePct),
      confidencePct,
      confidenceText: confidenceText(confidencePct),
      counted,
      why,
      remembered: opts.remembered ?? false,
    },
    at: Number.isFinite(t) ? t : -Infinity,
  };
}

const CATEGORY_WHY: Readonly<Record<Exclude<CategoryVia, "unmapped">, { source: ChipSource; why: string }>> = Object.freeze({
  human: { source: "human", why: "You picked this category on the approve form." },
  override: { source: "human", why: "Your saved category rule for this product decides it." },
  menu_item: { source: "menu", why: "The live menu already lists this POS key in this category." },
  inventory_type: { source: "manifest", why: "Mapped from the LCB inventory type on the manifest." },
  heuristic: {
    source: "name",
    why: "Guessed from the product name, so it is not counted. Pick the category on the approve form to confirm it.",
  },
});

function recordCandidates(records: RowRecordFacts): Candidate[] {
  const out: (Candidate | null)[] = [];
  const c = records.category;
  if (c && c.via !== "unmapped") {
    const m = CATEGORY_WHY[c.via];
    out.push(cand("category", previewValue(c.label || c.value), m.source, null, m.why));
  }
  const s = records.strainType;
  if (s) {
    const label = previewValue(s.label || s.value);
    if (s.via === "human") out.push(cand("strain_type", label, "human", null, "You picked this strain type on the approve form."));
    else if (s.via === "strain library") out.push(cand("strain_type", label, "strain_library", null, "The strain library has this strain's type."));
    else if (s.via === "manifest") out.push(cand("strain_type", label, "manifest", null, "The manifest the vendor sent states it."));
    else {
      const pct = typeof s.confidence === "number" && Number.isFinite(s.confidence) ? s.confidence : null;
      out.push(
        cand(
          "strain_type",
          label,
          "name",
          pct,
          `Guessed from the product name${pct === null ? "" : ` (${confidenceText(pct)})`}, so it is not counted. Pick it on the approve form to confirm.`,
          { sourceLabel: ROW_ONLY_LABEL.name },
        ),
      );
    }
  }
  const p = records.potency;
  if (p) {
    const v = `${Number(p.thcPct.toFixed(2))}% THC`;
    out.push(
      p.hasLab
        ? cand("potency", v, "coa", null, "From the lab certificate (COA) linked to this lot.")
        : cand("potency", v, "draft", null, "On the draft, but no lab certificate is linked to it, so it is not counted."),
    );
  }
  return out.filter((x): x is Candidate => x !== null);
}

function attachedWhy(f: AttachedFact, pct: number | null): string {
  const day = isoDay(f.at);
  const when = day ? ` on ${day}` : "";
  switch (f.source) {
    case "gemini":
      return pct !== null && pct >= ATTACH_AUTO_MIN_CONFIDENCE
        ? `Found by the web lookup at ${confidenceText(pct)} and attached with Save selected${when}.`
        : `Found by the web lookup${pct === null ? " with no score" : ` at ${confidenceText(pct)}`}, below the ${ATTACH_AUTO_MIN_CONFIDENCE}% bar, so it is not counted.`;
    case "human":
      return `You entered it and saved it${when}.`;
    case "coa":
      return `Attached from the lab certificate (COA)${when}.`;
    case "manifest":
      return `Attached from the manifest${when}.`;
    case "kb_published":
      return `Attached from the approved knowledge base${when}.`;
    case "kb_draft":
      return `From a knowledge-base draft nobody has approved yet${when}, so it is not counted.`;
    case "remembered":
      return `Pre-filled from an earlier answer${when}; it needs a person to confirm, so it is not counted.`;
    case "cultivera":
      return `Imported from Cultivera${when}; not a reviewed source, so it is not counted.`;
  }
}

function attachedCandidates(attached: AttachedFacts | null): Candidate[] {
  if (!attached) return [];
  const out: (Candidate | null)[] = [];
  for (const [field, f] of Object.entries(attached)) {
    if (!isRowField(field)) continue;
    const pct = percentFromStored(f.confidence);
    out.push(cand(field, previewValue(f.value), f.source, pct, attachedWhy(f, pct), { at: f.at }));
  }
  return out.filter((x): x is Candidate => x !== null);
}

function memoryCandidate(f: RememberedFact): Candidate | null {
  const field = f.field as MemoryField;
  if (!isRowField(field)) return null;
  const isKb = f.origin === "kb-exact";
  const base = factSourceLabel(f.source, f.confidence, f.origin);
  const sourceLabel = f.origin === "history" ? `Remembered (${base})` : base;
  const why = f.covered
    ? `Already on file for this product: ${f.reason}`
    : `On file, but not counted: ${f.reason}`;
  // A covered memory fact counts no matter its raw source: S09 ran it
  // through decide() and only "attach" sets covered.
  return cand(field, previewValue(f.value), isKb ? "kb_published" : f.origin === "history" ? "remembered" : "kb_draft", f.confidence, why, {
    at: f.at,
    remembered: true,
    counted: f.covered,
    sourceLabel,
  });
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.chip.counted !== b.chip.counted) return a.chip.counted;
  const ra = SOURCE_RANK[a.chip.source];
  const rb = SOURCE_RANK[b.chip.source];
  if (ra !== rb) return ra < rb;
  return a.at > b.at;
}

function modeNoteFor(mode: AttachPolicyMode): string | null {
  if (mode === "act") return null;
  if (mode === "off") {
    return "Fact attaching is switched off (ATTACH_POLICY_RING=0): a lookup only shows what it found, and nothing lands here.";
  }
  return "Lookups are in preview (ATTACH_POLICY_RING=1): Save selected lists findings for review on Enrichment, so nothing lands here until the ring is raised to 2.";
}

/**
 * The row's fact chips. `records` is the third data source the page already
 * holds (rowRecordFacts); the bible's three-argument shape is kept with an
 * optional fourth so the pure builder needs no I/O.
 */
export function buildFactChips(
  attachedFacts: AttachedFacts | null,
  memory: ProductMemory | null,
  policy: FactChipsPolicy,
  records: RowRecordFacts = {},
): FactChipsView {
  const all: Candidate[] = [
    ...recordCandidates(records),
    ...attachedCandidates(attachedFacts),
    ...((memory?.facts ?? []).map(memoryCandidate).filter((x): x is Candidate => x !== null)),
  ];
  const chips: FactChip[] = [];
  for (const field of ROW_FACT_FIELDS) {
    const mine = all.filter((c) => c.chip.field === field);
    if (mine.length === 0) continue;
    let best = mine[0];
    for (const c of mine.slice(1)) if (better(c, best)) best = c;
    const also = Array.from(new Set(mine.filter((c) => c !== best).map((c) => c.chip.sourceLabel))).filter((l) => l !== best.chip.sourceLabel);
    chips.push({ ...best.chip, also });
  }
  const countedFields = new Set(chips.filter((c) => c.counted).map((c) => c.field));
  const missing = ROW_FACT_FIELDS.filter((f) => !countedFields.has(f));
  const total = ROW_FACT_FIELDS.length;
  return {
    chips,
    counted: countedFields.size,
    total,
    countLabel: `${countedFields.size}/${total}`,
    missing,
    missingLine: missing.length > 0 ? `Enrichment will ask for: ${missing.map((f) => ROW_FACT_LABEL[f]).join(", ")}` : null,
    emptyLine: chips.length === 0 ? EMPTY_FACTS_COPY : null,
    modeNote: modeNoteFor(policy.mode),
  };
}

// --- 6. Identity line ------------------------------------------------------------------

export interface IdentityLine {
  ok: boolean;
  text: string;
}

/**
 * "Remembered as ..." when the row has an identity; otherwise the reason it
 * cannot be remembered, in the bible's words when the vendor is missing.
 * productIdentityKey() refuses (returns "") when vendor AND brand are blank,
 * when the name is blank, or when nothing is left of the name once the size
 * and brand are stripped - each gets its own true sentence.
 */
export function identityLine(
  identityKey: string,
  row: { vendor_name?: string | null; brand_name?: string | null; name?: string | null },
  kbFirst: boolean,
): IdentityLine {
  const key = clean(identityKey);
  if (key) {
    return {
      ok: true,
      text: kbFirst
        ? `Remembered as ${key}. Next time this product arrives, what is on file is recalled before any web lookup.`
        : `Remembered as ${key}. (Recall before a web lookup is switched off: KB_FIRST_ONBOARDING=off.)`,
    };
  }
  if (!clean(row.vendor_name) && !clean(row.brand_name)) return { ok: false, text: NO_VENDOR_IDENTITY_COPY };
  if (!clean(row.name)) return { ok: false, text: NO_NAME_IDENTITY_COPY };
  return { ok: false, text: NO_FAMILY_IDENTITY_COPY };
}

// --- 7. Manifest column ----------------------------------------------------------------

export interface ManifestCellInput {
  manifest_number: string | null;
  received_at: string | null;
  accepted_at: string | null;
  transfer_date: string | null;
}

/** "#0012345 · received 2026-05-01" (falls back accepted -> transfer date). */
export function manifestCell(m: ManifestCellInput | null | undefined): { number: string; date: string } | null {
  if (!m) return null;
  const number = clean(m.manifest_number);
  const recv = isoDay(m.received_at);
  const acc = isoDay(m.accepted_at);
  const xfer = isoDay(m.transfer_date);
  const date = recv ? `received ${recv}` : acc ? `accepted ${acc}` : xfer ? `transfer ${xfer}` : "";
  if (!number && !date) return null;
  return { number: number ? `#${number}` : "No manifest number", date };
}

// --- Self-tests ------------------------------------------------------------------------

export function __runFactChipsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL fact-chips-core: " + msg);
    }
  };
  const SHADOW: FactChipsPolicy = { mode: "shadow" };
  const ACT: FactChipsPolicy = { mode: "act" };

  // 1. Flag.
  ok(ONBOARDING_V2_ROW_ENV === "ONBOARDING_V2_ROW", "env name");
  for (const v of [undefined, null, "", "on", "1", "true", "yes", "junk"]) ok(onboardingV2RowEnabled(v as string | undefined) === true, `flag on for ${String(v)}`);
  for (const v of ["off", "OFF", " 0 ", "false", "no", "disabled"]) ok(onboardingV2RowEnabled(v) === false, `flag off for ${v}`);

  // 2. Vocabulary.
  ok(ROW_FACT_FIELDS.length === 9 && new Set(ROW_FACT_FIELDS).size === 9, "nine distinct fields");
  ok(ROW_FACT_FIELDS.every((f) => typeof ROW_FACT_LABEL[f] === "string" && ROW_FACT_LABEL[f] !== ""), "every field labelled");
  ok(EMPTY_FACTS_COPY === "Nothing attached yet \u2014 press Look up to fetch from the web, or approve and fill it in on Enrichment.", "empty copy verbatim");
  ok(NO_VENDOR_IDENTITY_COPY === "Cannot remember this product: manifest has no vendor", "no-vendor copy verbatim");

  // 3. Labels + counting.
  ok(chipSourceLabel("gemini", 94) === "Gemini 94%", "Gemini 94%");
  ok(chipSourceLabel("gemini", 93.6) === "Gemini 94%", "Gemini rounds");
  ok(chipSourceLabel("gemini") === "Gemini", "Gemini no score");
  ok(chipSourceLabel("human") === "You", "You");
  ok(chipSourceLabel("manifest") === "Manifest" && chipSourceLabel("coa") === "COA" && chipSourceLabel("kb_published") === "KB", "record labels");
  ok(chipSourceLabel("remembered") === "Remembered", "Remembered");
  ok(chipSourceLabel("menu") === "Live menu" && chipSourceLabel("strain_library") === "Strain library", "row-only labels");
  ok(chipSourceLabel("name") === "Product name" && chipSourceLabel("draft") === "Draft", "row-only labels 2");
  ok(isCountedSource("gemini", 90) && !isCountedSource("gemini", 89.9) && !isCountedSource("gemini", null), "gemini counts at >= 90 only");
  ok(isCountedSource("human", null) && isCountedSource("coa", null) && isCountedSource("manifest", null), "records count");
  ok(!isCountedSource("kb_draft", 100) && !isCountedSource("remembered", 100) && !isCountedSource("name", 99) && !isCountedSource("draft", null), "guesses never count");
  ok(!isCountedSource("cultivera", null), "cultivera never counts");
  ok(confidenceText(94.4) === "94%" && confidenceText(null) === "" && confidenceText(Number.NaN) === "", "confidence text");

  // 4. attachedFactsOf.
  const col = DRAFT_FACT_COLUMNS[0];
  ok(attachedFactsOf(null) === null && attachedFactsOf({}) === null, "absent column -> null");
  ok(attachedFactsOf({ [col]: null }) === null && attachedFactsOf({ [col]: [] }) === null && attachedFactsOf({ [col]: "x" }) === null, "bad shapes -> null");
  const parsed = attachedFactsOf({
    [col]: {
      description: { value: "Sweet.", source: "gemini", confidence: 0.94, at: "2026-05-01T10:00:00Z" },
      aroma: { value: ["citrus"], source: "Gemini", confidence: 0.94, at: "2026-05-01T10:00:00Z" },
      flavor: { value: ["pine"], source: "gemini", confidence: 94, at: "2026-05-01T10:00:00Z" },
      effects: { value: ["calm"], source: "gemini", confidence: 0.95, at: "" },
      short_description: { value: "Short.", source: "human", at: "2026-05-02T00:00:00Z" },
    },
  });
  ok(parsed !== null && Object.keys(parsed).join() === "description,short_description", "only valid entries survive: " + Object.keys(parsed ?? {}).join());
  ok(parsed?.short_description.confidence === null, "missing confidence -> null");

  // 5. Empty.
  const empty = buildFactChips(null, null, SHADOW);
  ok(empty.chips.length === 0 && empty.counted === 0 && empty.countLabel === "0/9", "empty count 0/9");
  ok(empty.emptyLine === EMPTY_FACTS_COPY, "empty state line");
  ok(empty.missingLine === "Enrichment will ask for: category, strain type, potency, description, short line, effects, aroma, flavor, images", "missing all: " + empty.missingLine);
  ok(empty.modeNote !== null && empty.modeNote.includes("ATTACH_POLICY_RING=1"), "shadow note");
  ok(buildFactChips(null, null, ACT).modeNote === null, "act -> no note");
  ok((buildFactChips(null, null, { mode: "off" }).modeNote ?? "").includes("ATTACH_POLICY_RING=0"), "off note");

  // 6. Records.
  const lab = (v: string) => (v === "flower" ? "Flower" : v);
  const strainLab = (v: string) => (v === "hybrid" ? "Hybrid" : v);
  const rec = rowRecordFacts({
    chosenWebsiteCategory: null,
    resolvedWebsiteCategory: "flower",
    resolutionSource: "inventory_type",
    categoryLabel: lab,
    chosenStrainType: null,
    strainSuggestion: { value: "hybrid", confidence: 95, source: "manifest" },
    strainLabel: strainLab,
    totalThcPct: 24.123,
    thcPct: 20,
    labResultId: "lab-1",
  });
  ok(rec.category?.via === "inventory_type" && rec.category.label === "Flower", "category from resolver");
  ok(rec.strainType?.via === "manifest" && rec.strainType.label === "Hybrid", "strain from manifest");
  ok(rec.potency?.thcPct === 24.123 && rec.potency.hasLab === true, "total THC preferred");
  const recView = buildFactChips(null, null, ACT, rec);
  ok(recView.countLabel === "3/9", "3 records counted: " + recView.countLabel);
  const cat = recView.chips.find((c) => c.field === "category");
  ok(cat?.sourceLabel === "Manifest" && cat.value === "Flower" && cat.counted, "category chip manifest");
  ok((cat?.why ?? "").includes("LCB inventory type"), "category why");
  const pot = recView.chips.find((c) => c.field === "potency");
  ok(pot?.value === "24.12% THC" && pot.sourceLabel === "COA" && pot.counted, "potency chip: " + pot?.value);
  ok(recView.emptyLine === null, "no empty line with chips");
  ok(recView.missingLine === "Enrichment will ask for: description, short line, effects, aroma, flavor, images", "missing descriptive: " + recView.missingLine);
  // Picks win and are "You".
  const picked = rowRecordFacts({
    chosenWebsiteCategory: "flower",
    resolvedWebsiteCategory: "preroll",
    resolutionSource: "heuristic",
    categoryLabel: lab,
    chosenStrainType: "hybrid",
    strainSuggestion: { value: "indica", confidence: 60, source: "product name" },
    strainLabel: strainLab,
    totalThcPct: null,
    thcPct: 18,
    labResultId: null,
  });
  ok(picked.category?.via === "human" && picked.category.value === "flower", "category pick wins");
  ok(picked.strainType?.via === "human" && picked.strainType.value === "hybrid", "strain pick wins");
  ok(picked.potency?.thcPct === 18 && picked.potency.hasLab === false, "thc fallback, no lab");
  const pv = buildFactChips(null, null, ACT, picked);
  ok(pv.chips.find((c) => c.field === "category")?.sourceLabel === "You", "pick chip says You");
  const potNoLab = pv.chips.find((c) => c.field === "potency");
  ok(potNoLab?.counted === false && potNoLab.sourceLabel === "Draft" && potNoLab.why.includes("no lab certificate"), "no-lab potency not counted");
  ok(pv.countLabel === "2/9" && pv.missing.includes("potency"), "no-lab potency stays missing");
  // Guesses never count.
  const guess = rowRecordFacts({
    chosenWebsiteCategory: "",
    resolvedWebsiteCategory: "preroll",
    resolutionSource: "heuristic",
    categoryLabel: (v) => v,
    chosenStrainType: "unknown",
    strainSuggestion: { value: "indica", confidence: 60, source: "product name" },
    strainLabel: (v) => v,
    totalThcPct: undefined,
    thcPct: undefined,
    labResultId: undefined,
  });
  ok(guess.category?.via === "heuristic", "heuristic category carried");
  ok(guess.strainType?.via === "product name" && guess.strainType.confidence === 60, "'unknown' pick ignored; name guess carried");
  ok(guess.potency === undefined, "no THC -> no potency");
  const gv = buildFactChips(null, null, ACT, guess);
  ok(gv.counted === 0 && gv.chips.length === 2, "guesses shown, not counted");
  ok(gv.chips.every((c) => !c.counted && c.why.includes("not counted")), "guess why says not counted");
  ok(gv.chips.find((c) => c.field === "strain_type")?.why.includes("(60%)") === true, "name guess shows its %");
  ok(gv.emptyLine === null && gv.missing.length === 9, "chips but all missing");
  ok(rowRecordFacts({ chosenWebsiteCategory: null, resolvedWebsiteCategory: "x", resolutionSource: "unmapped", categoryLabel: (v: string) => v, chosenStrainType: null, strainSuggestion: null, strainLabel: (v: string) => v, totalThcPct: null, thcPct: null, labResultId: null }).category === undefined, "unmapped -> no category");
  ok(rowRecordFacts({ chosenWebsiteCategory: null, resolvedWebsiteCategory: "flower", resolutionSource: "menu_item", categoryLabel: lab, chosenStrainType: null, strainSuggestion: { value: "sativa", confidence: 100, source: "strain library" }, strainLabel: (v) => v, totalThcPct: null, thcPct: null, labResultId: null }).strainType?.via === "strain library", "strain library via");
  const menuView = buildFactChips(null, null, ACT, { category: { value: "flower", label: "Flower", via: "menu_item" }, strainType: { value: "sativa", label: "Sativa", via: "strain library", confidence: 100 } });
  ok(menuView.chips.map((c) => c.sourceLabel).join() === "Live menu,Strain library" && menuView.counted === 2, "menu + strain library count");
  ok(buildFactChips(null, null, ACT, { category: { value: "x", label: "X", via: "override" } }).chips[0]?.sourceLabel === "You", "override is the owner's rule -> You");

  // 7. Attached facts.
  const att: AttachedFacts = {
    description: { value: "A sweet, berry-forward hybrid with a smooth finish.", source: "gemini", confidence: 0.94, at: "2026-05-01T10:00:00Z" },
    effects: { value: ["calm", "happy"], source: "gemini", confidence: 0.9, at: "2026-05-01T10:00:00Z" },
    aroma: { value: ["citrus"], source: "gemini", confidence: 0.72, at: "2026-05-01T10:00:00Z" },
    flavor: { value: ["pine"], source: "human", confidence: null, at: "2026-05-03T00:00:00Z" },
    summary: { value: "strain-level", source: "gemini", confidence: 0.99, at: "2026-05-01T10:00:00Z" },
    short_description: { value: "  ", source: "gemini", confidence: 0.99, at: "2026-05-01T10:00:00Z" },
  };
  const av = buildFactChips(att, null, ACT);
  const d = av.chips.find((c) => c.field === "description");
  ok(d?.sourceLabel === "Gemini 94%" && d.confidenceText === "94%" && d.counted, "description Gemini 94%");
  ok((d?.why ?? "").includes("on 2026-05-01") && (d?.why ?? "").includes("94%"), "attached why has date + %: " + d?.why);
  ok(av.chips.find((c) => c.field === "effects")?.value === "calm, happy", "list preview joined");
  ok(av.chips.find((c) => c.field === "effects")?.counted === true, "exactly 90 counts");
  const ar = av.chips.find((c) => c.field === "aroma");
  ok(ar?.counted === false && (ar?.why ?? "").includes("below the 90% bar"), "72% shown, not counted");
  ok(av.chips.find((c) => c.field === "flavor")?.sourceLabel === "You", "human attached -> You");
  ok(!av.chips.some((c) => (c.field as string) === "summary"), "non-row fields ignored");
  ok(!av.chips.some((c) => c.field === "short_description"), "blank value -> no chip");
  ok(av.countLabel === "3/9", "3 attached counted: " + av.countLabel);
  ok(av.missing.includes("aroma") && av.missing.includes("short_description"), "uncounted fields are missing");
  for (const s of ["coa", "manifest", "kb_published", "kb_draft", "remembered", "cultivera"] as const) {
    const one = buildFactChips({ description: { value: "x", source: s, confidence: null, at: "2026-05-01T00:00:00Z" } }, null, ACT);
    ok(one.chips.length === 1 && one.chips[0].why.length > 10, `why for ${s}`);
    ok(one.chips[0].counted === (s === "coa" || s === "manifest" || s === "kb_published"), `counted for ${s}`);
  }
  ok(buildFactChips({ description: { value: "x", source: "gemini", confidence: null, at: "bad" } }, null, ACT).chips[0].why.includes("with no score"), "gemini no score why; bad date tolerated");
  const long = "word ".repeat(40);
  const lv = buildFactChips({ description: { value: long, source: "human", confidence: null, at: "2026-05-01T00:00:00Z" } }, null, ACT);
  ok(lv.chips[0].value.length === PREVIEW_MAX && lv.chips[0].value.endsWith("\u2026"), "long preview cut to 90");
  ok(previewValue(12) === "12" && previewValue(null) === "" && previewValue([" a ", "", 3, "b"]) === "a, b" && previewValue({}) === "", "previewValue shapes");

  // 8. Memory.
  const mem: ProductMemory = {
    identityKey: "phat panda|flower|blue dream",
    facts: [
      { field: "description", value: "On file.", origin: "kb-exact", source: "kb_published", confidence: null, at: null, covered: true, reason: "From a record we already hold." },
      { field: "aroma", value: ["citrus", "berry"], origin: "history", source: "gemini", confidence: 91, at: "2026-04-01T00:00:00Z", covered: true, reason: "91% from an earlier lookup." },
      { field: "flavor", value: ["pine"], origin: "kb-draft", source: "kb_draft", confidence: null, at: null, covered: false, reason: "Saved as a knowledge-base draft that nobody has approved yet." },
    ],
    covered: ["description", "aroma"],
    missing: ["short_description", "effects", "flavor"],
    complete: false,
    lastSeen: null,
  };
  const mv = buildFactChips(null, mem, SHADOW);
  const md = mv.chips.find((c) => c.field === "description");
  ok(md?.sourceLabel === "KB" && md.counted && md.remembered, "KB memory chip");
  ok((md?.why ?? "").startsWith("Already on file for this product:"), "memory why");
  const ma = mv.chips.find((c) => c.field === "aroma");
  ok(ma?.sourceLabel === "Remembered (Gemini 91%)" && ma.counted && ma.confidenceText === "91%", "history chip: " + ma?.sourceLabel);
  const mf = mv.chips.find((c) => c.field === "flavor");
  ok(mf?.sourceLabel === "KB draft" && !mf.counted && mf.why.startsWith("On file, but not counted:"), "kb draft memory not counted");
  ok(mv.countLabel === "2/9", "memory counts covered only");

  // 9. Survivorship.
  const both = buildFactChips(
    { description: { value: "Web text.", source: "gemini", confidence: 0.95, at: "2026-05-02T00:00:00Z" } },
    mem,
    ACT,
  );
  const bd = both.chips.find((c) => c.field === "description");
  ok(bd?.sourceLabel === "KB" && bd.also.join() === "Gemini 95%", "KB beats Gemini; Gemini listed under also: " + bd?.also.join());
  const humanWins = buildFactChips({ description: { value: "Mine.", source: "human", confidence: null, at: "2026-01-01T00:00:00Z" } }, mem, ACT);
  ok(humanWins.chips.find((c) => c.field === "description")?.value === "Mine.", "a person beats the KB");
  const countedBeatsRank = buildFactChips(
    { flavor: { value: ["web"], source: "gemini", confidence: 0.92, at: "2026-05-02T00:00:00Z" } },
    mem,
    ACT,
  );
  ok(countedBeatsRank.chips.find((c) => c.field === "flavor")?.sourceLabel === "Gemini 92%", "counted Gemini beats an uncounted KB draft");
  const newer = buildFactChips(
    null,
    {
      ...mem,
      facts: [
        { field: "effects", value: ["old"], origin: "history", source: "gemini", confidence: 95, at: "2026-01-01T00:00:00Z", covered: true, reason: "r" },
        { field: "effects", value: ["new"], origin: "history", source: "gemini", confidence: 95, at: "2026-03-01T00:00:00Z", covered: true, reason: "r" },
      ],
    },
    ACT,
  );
  ok(newer.chips.find((c) => c.field === "effects")?.value === "new", "same rank -> newest wins");
  ok(newer.chips.find((c) => c.field === "effects")?.also.length === 0, "same label not repeated under also");
  const recVsAtt = buildFactChips({ category: { value: "web cat", source: "gemini", confidence: 0.99, at: "2026-05-02T00:00:00Z" } }, null, ACT, {
    category: { value: "flower", label: "Flower", via: "human" },
  });
  ok(recVsAtt.chips[0].sourceLabel === "You" && recVsAtt.chips[0].also.join() === "Gemini 99%", "pick beats a web category");

  // 10. Full house.
  const full = buildFactChips(
    {
      ...att,
      aroma: { value: ["citrus"], source: "gemini", confidence: 0.95, at: "2026-05-01T10:00:00Z" },
      short_description: { value: "Short.", source: "gemini", confidence: 0.95, at: "2026-05-01T10:00:00Z" },
      images: { value: ["https://x/1.jpg"], source: "human", confidence: null, at: "2026-05-01T10:00:00Z" },
    },
    null,
    ACT,
    rec,
  );
  ok(full.countLabel === "9/9" && full.missingLine === null && full.missing.length === 0, "9/9 -> no missing line: " + full.countLabel);
  ok(full.chips.map((c) => c.field).join() === ROW_FACT_FIELDS.join(), "chips in field order");

  // 11. Identity line.
  ok(identityLine("a|flower|b", {}, true).ok && identityLine("a|flower|b", {}, true).text.startsWith("Remembered as a|flower|b."), "identity on");
  ok(identityLine("a|flower|b", {}, true).text.includes("recalled before any web lookup"), "kb-first wording");
  ok(identityLine("a|flower|b", {}, false).text.includes("KB_FIRST_ONBOARDING=off"), "kb-first off wording");
  ok(identityLine("  ", { vendor_name: " ", brand_name: null, name: "X" }, true).text === NO_VENDOR_IDENTITY_COPY, "no vendor copy");
  ok(identityLine("", { vendor_name: "V", name: " " }, true).text === NO_NAME_IDENTITY_COPY, "no name copy");
  ok(identityLine("", { brand_name: "B", name: "3.5g" }, true).text === NO_FAMILY_IDENTITY_COPY, "nothing left copy");
  ok(identityLine("", { vendor_name: "V", name: "X" }, true).ok === false, "refused -> ok false");

  // 12. Manifest cell.
  ok(manifestCell(null) === null, "no manifest");
  ok(manifestCell({ manifest_number: null, received_at: null, accepted_at: null, transfer_date: null }) === null, "empty manifest");
  const mc = manifestCell({ manifest_number: " 0012345 ", received_at: "2026-05-01T15:00:00Z", accepted_at: "2026-05-02T00:00:00Z", transfer_date: null });
  ok(mc?.number === "#0012345" && mc.date === "received 2026-05-01", "manifest number + received");
  ok(manifestCell({ manifest_number: "9", received_at: null, accepted_at: "2026-05-02T00:00:00Z", transfer_date: null })?.date === "accepted 2026-05-02", "accepted fallback");
  ok(manifestCell({ manifest_number: "", received_at: null, accepted_at: null, transfer_date: "2026-04-30" })?.number === "No manifest number", "no number but a date");
  ok(manifestCell({ manifest_number: "9", received_at: "junk", accepted_at: null, transfer_date: null })?.date === "", "junk date -> no date");

  return { passed, failed };
}
