/**
 * src/lib/catalog/golden-record-core.ts  (SLICE S12, pure half)
 *
 * "Approve materializes the golden record onto the menu item (no more
 * boilerplate description)." Before S12 every product that reached the menu
 * through Product Onboarding carried the same sentence,
 *
 *   "<name> from <brand>. Browse current availability, package options, and
 *    pricing at Greenway Marijuana in Port Orchard."
 *
 * (draft-injection-core.ts and intake-mastering-core.ts, bible F-064), even
 * when a description had been attached to the draft minutes earlier (S07 door
 * -> S11 step 4b -> catalog_product_drafts.attached_facts, migration 0235).
 * Real copy only appeared at RENDER time through the KB ladder, and only when
 * that lookup's key matched. Strain type fell back to "unknown" whenever the
 * strain library was keyed differently from the draft (F-067).
 *
 * This core decides, with no I/O, which attached facts may travel onto the
 * menu row:
 *
 *   - countedAttachedFact(): the survivorship gate. A fact counts when its
 *     source is a RECORD source (human, coa, manifest, kb_published) or a
 *     banded source (gemini, kb_draft, cultivera) at >= 90% (the same
 *     ATTACH_AUTO_MIN_CONFIDENCE the S10 policy uses). "remembered" never
 *     counts: memory pre-fills, a person decides (0220 doctrine).
 *   - pickAttachedDescription(): description, else short_description. The
 *     SERVER must lint the text (lintCopy + kb_banned_phrases) before it is
 *     used; this file cannot import the compliance module (it is
 *     server-only), so the planner only ever sees text the server cleared.
 *   - pickAttachedStrainType(): canonical, never "unknown".
 *   - resolveGoldenStrainType(): the approver's pick > a person's attached
 *     answer > the server's enrichment verdict (strain library > manifest >
 *     confident name parse, all >= 90%) > another counted attached value >
 *     "unknown". The order is the 0235 survivorship order
 *     (human > coa/manifest > kb_published > gemini).
 *   - boilerplateDescription() / isBoilerplateDescription(): the one place
 *     the house sentence lives, so mastering can tell "real copy" from "the
 *     placeholder" and stop overwriting real copy.
 *
 * ROLLBACK (bible S12.7 "Flag; boilerplate path retained"):
 * GOLDEN_RECORD_ON_APPROVE=off. The servers then never read attached_facts
 * and never set the golden enrichment fields, so the planner's output is
 * byte-identical to before S12.
 *
 * No fs, no network, no Supabase, no compliance import. Embedded self-tests
 * at the bottom (scripts/compliance/run-pure-selftests.ts).
 */
import { isFactSource, isStoredConfidence, type FactSource } from "./attach-facts-core";
import { ATTACH_AUTO_MIN_CONFIDENCE } from "./fact-attach-policy-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { sensoryForStorage } from "../pos/menu-sensory-core";

// --- 1. Flag ---------------------------------------------------------------------

/** Rollback switch (bible S12.7). */
export const GOLDEN_RECORD_ENV = "GOLDEN_RECORD_ON_APPROVE";

/** Same idiom as every intake flag: off/0/false/no/disabled -> off; else on. */
export function goldenRecordEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

/** The draft column the servers add to their read (0235). */
export const GOLDEN_FACTS_COLUMN = "attached_facts";

// --- 2. The house placeholder sentence ----------------------------------------------

/** The tail every generated placeholder ends with (transform.ts genericDescription shape). */
export const BOILERPLATE_TAIL =
  ". Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.";

/** "<display> from <brand>." + tail; brand omitted when blank. */
export function boilerplateDescription(display: string, brand: string | null | undefined): string {
  const b = String(brand ?? "").trim();
  return `${display}${b ? ` from ${b}` : ""}${BOILERPLATE_TAIL}`;
}

/** True when the text is the generated placeholder (or empty: nothing real to keep). */
export function isBoilerplateDescription(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (t === "") return true;
  return t.endsWith(BOILERPLATE_TAIL.trim());
}

// --- 3. Survivorship gate -----------------------------------------------------------

/** Sources that are a record of fact, not a model score (S10 rule 4). */
const RECORD_SOURCES: ReadonlySet<FactSource> = new Set<FactSource>(["human", "coa", "manifest", "kb_published"]);
/** Sources banded by their own confidence (S10 rule 5). */
const BANDED_SOURCES: ReadonlySet<FactSource> = new Set<FactSource>(["gemini", "kb_draft", "cultivera"]);

export interface CountedFact {
  value: unknown;
  source: FactSource;
  /** 0..1 or null. */
  confidence: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The attached fact for `field`, only when it may decide a customer-facing
 * value: a record source, or a banded source at >= 90%. Anything malformed
 * (unknown source, confidence outside 0..1) is not a fact.
 */
export function countedAttachedFact(attachedFacts: unknown, field: string): CountedFact | null {
  const facts = asRecord(attachedFacts);
  if (!facts) return null;
  const e = asRecord(facts[field]);
  if (!e) return null;
  if (!isFactSource(e.source)) return null;
  const confidence = e.confidence === undefined ? null : e.confidence;
  if (!isStoredConfidence(confidence)) return null;
  const c = confidence as number | null;
  if (RECORD_SOURCES.has(e.source)) return { value: e.value, source: e.source, confidence: c };
  if (BANDED_SOURCES.has(e.source)) {
    if (c === null) return null;
    // Compare in whole-percent space, like the policy (0.9 * 100 === 90).
    if (Math.round(c * 10000) / 100 < ATTACH_AUTO_MIN_CONFIDENCE) return null;
    return { value: e.value, source: e.source, confidence: c };
  }
  return null; // "remembered": pre-fill only, never decides.
}

// --- 4. Description -----------------------------------------------------------------

/** Description fields in the order they may supply the menu copy. */
export const GOLDEN_DESCRIPTION_FIELDS = ["description", "short_description"] as const;

export interface PickedDescription {
  text: string;
  field: (typeof GOLDEN_DESCRIPTION_FIELDS)[number];
  source: FactSource;
  confidence: number | null;
}

/**
 * The attached description the SERVER should lint, or null. A value that is
 * itself the placeholder sentence is not "real copy" and is ignored.
 */
export function pickAttachedDescription(attachedFacts: unknown): PickedDescription | null {
  for (const field of GOLDEN_DESCRIPTION_FIELDS) {
    const f = countedAttachedFact(attachedFacts, field);
    if (!f || typeof f.value !== "string") continue;
    const text = f.value.trim();
    if (!text || isBoilerplateDescription(text)) continue;
    return { text, field, source: f.source, confidence: f.confidence };
  }
  return null;
}

// --- 5. Strain type -----------------------------------------------------------------

export interface PickedStrainType {
  value: string;
  source: FactSource;
  confidence: number | null;
}

/** Canonical attached strain type (never "unknown"), or null. */
export function pickAttachedStrainType(attachedFacts: unknown): PickedStrainType | null {
  const f = countedAttachedFact(attachedFacts, "strain_type");
  if (!f || typeof f.value !== "string") return null;
  const c = canonicalStrainType(f.value);
  if (c === "unknown") return null;
  return { value: c, source: f.source, confidence: f.confidence };
}

// --- 5b. Effects and aroma (R35 #6, migration 0254) ---------------------------------

/** The attached-fact field names (attach-plan-core AttachField) per menu column. */
export const GOLDEN_SENSORY_FIELDS = { effects: "effects", aroma_notes: "aroma" } as const;

export interface PickedSensory {
  /** Storage form (menu-sensory-core sensoryForStorage): trimmed, deduped, <= 8, never empty. */
  values: string[];
  source: FactSource;
  confidence: number | null;
}

/**
 * The counted attached list for `field`, in storage form, or null. Same
 * survivorship gate as the description (countedAttachedFact). The SERVER
 * must still clear it: checkEffects() for effects, lintTerms() for aroma.
 */
export function pickAttachedSensory(attachedFacts: unknown, field: "effects" | "aroma"): PickedSensory | null {
  const f = countedAttachedFact(attachedFacts, field);
  if (!f) return null;
  const values = sensoryForStorage(f.value);
  if (!values) return null;
  return { values, source: f.source, confidence: f.confidence };
}

export type GoldenStrainSource = "human" | "attached_human" | "enrichment" | "attached" | "unknown";

/**
 * The strain type the menu row gets. `chosen` is the approver's validated pick
 * (0146); `enrichment` is the server's folded >= 90% verdict; `attached` is
 * pickAttachedStrainType()'s answer (undefined/null when S12 is off).
 */
export function resolveGoldenStrainType(input: {
  chosen: string | null | undefined;
  attached: PickedStrainType | null | undefined;
  enrichment: string | null | undefined;
}): { value: string; source: GoldenStrainSource } {
  const chosen = String(input.chosen ?? "").trim();
  if (chosen) return { value: chosen, source: "human" };
  const attached = input.attached ?? null;
  if (attached && attached.source === "human") return { value: attached.value, source: "attached_human" };
  const enrich = String(input.enrichment ?? "").trim();
  if (enrich) return { value: enrich, source: "enrichment" };
  if (attached) return { value: attached.value, source: "attached" };
  return { value: "unknown", source: "unknown" };
}

/** Plain-English label for a fact source in a diagnostic ("Gemini 94%"). */
export function goldenSourceText(source: FactSource, confidence: number | null): string {
  const pct = confidence === null ? "" : ` ${Math.round(confidence * 100)}%`;
  switch (source) {
    case "human":
      return "you";
    case "coa":
      return "the lab certificate";
    case "manifest":
      return "the manifest";
    case "kb_published":
      return "the knowledge base";
    case "kb_draft":
      return `a knowledge-base draft${pct}`;
    case "gemini":
      return `the AI lookup${pct}`;
    case "cultivera":
      return `Cultivera${pct}`;
    case "remembered":
      return "a remembered answer";
  }
}

// --- 6. Embedded self-tests ---------------------------------------------------------

export function __runGoldenRecordCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL golden-record-core: " + msg);
    }
  };
  const at = "2026-01-01T00:00:00Z";
  const fact = (value: unknown, source: string, confidence: number | null = null) => ({ value, source, confidence, at });

  // flag
  ok(goldenRecordEnabled(undefined) && goldenRecordEnabled("") && goldenRecordEnabled("on"), "flag default on");
  for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) ok(!goldenRecordEnabled(w), `flag off-word ${w}`);
  ok(goldenRecordEnabled("two"), "junk keeps it on");
  ok(GOLDEN_RECORD_ENV === "GOLDEN_RECORD_ON_APPROVE", "env name");

  // boilerplate
  const bp = boilerplateDescription("Blue Dream 1g", "Fairwinds");
  ok(bp === "Blue Dream 1g from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.", "boilerplate exact text");
  ok(boilerplateDescription("X", "  ") === "X. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.", "blank brand omitted");
  ok(isBoilerplateDescription(bp), "detects boilerplate");
  ok(isBoilerplateDescription(""), "empty = placeholder");
  ok(isBoilerplateDescription(null), "null = placeholder");
  ok(!isBoilerplateDescription("A bright citrus sativa."), "real copy is not boilerplate");
  ok(!isBoilerplateDescription("Pricing at Greenway Marijuana in Port Orchard is great"), "partial tail is not boilerplate");

  // survivorship gate
  ok(countedAttachedFact(null, "description") === null, "null facts");
  ok(countedAttachedFact([], "description") === null, "array facts");
  ok(countedAttachedFact({ description: fact("x", "human") }, "description")?.source === "human", "human counts");
  ok(countedAttachedFact({ description: fact("x", "coa") }, "description") !== null, "coa counts");
  ok(countedAttachedFact({ description: fact("x", "manifest") }, "description") !== null, "manifest counts");
  ok(countedAttachedFact({ description: fact("x", "kb_published") }, "description") !== null, "kb_published counts");
  ok(countedAttachedFact({ description: fact("x", "gemini", 0.9) }, "description") !== null, "gemini 90 counts");
  ok(countedAttachedFact({ description: fact("x", "gemini", 0.94) }, "description")?.confidence === 0.94, "gemini 94 counts");
  ok(countedAttachedFact({ description: fact("x", "gemini", 0.89) }, "description") === null, "gemini 89 does not");
  ok(countedAttachedFact({ description: fact("x", "gemini", 0.899) }, "description") === null, "gemini 89.9 does not");
  ok(countedAttachedFact({ description: fact("x", "gemini", null) }, "description") === null, "unscored gemini does not");
  ok(countedAttachedFact({ description: fact("x", "kb_draft", 0.95) }, "description") !== null, "kb_draft 95 counts");
  ok(countedAttachedFact({ description: fact("x", "cultivera", 0.5) }, "description") === null, "cultivera 50 does not");
  ok(countedAttachedFact({ description: fact("x", "remembered") }, "description") === null, "remembered never decides");
  ok(countedAttachedFact({ description: fact("x", "Gemini", 0.99) }, "description") === null, "unknown source rejected");
  ok(countedAttachedFact({ description: fact("x", "gemini", 95) }, "description") === null, "0..100 confidence rejected");
  ok(countedAttachedFact({ description: fact("x", "human", -1) }, "description") === null, "negative confidence rejected");
  ok(countedAttachedFact({ description: "x" }, "description") === null, "non-object entry rejected");
  ok(countedAttachedFact({ description: { value: "x", source: "human", at } }, "description") !== null, "missing confidence = null (human)");

  // description pick
  ok(pickAttachedDescription(null) === null, "no facts no description");
  const d1 = pickAttachedDescription({ description: fact("  Bright citrus.  ", "gemini", 0.93) });
  ok(d1?.text === "Bright citrus." && d1.field === "description" && d1.source === "gemini", "description trimmed + source");
  const d2 = pickAttachedDescription({ description: fact("low", "gemini", 0.5), short_description: fact("Short copy.", "human") });
  ok(d2?.text === "Short copy." && d2.field === "short_description", "falls to short_description when description does not count");
  ok(pickAttachedDescription({ description: fact("   ", "human") }) === null, "blank description ignored");
  ok(pickAttachedDescription({ description: fact(["a"], "human") }) === null, "non-string description ignored");
  ok(pickAttachedDescription({ description: fact(bp, "human") }) === null, "boilerplate attached value ignored");
  const d3 = pickAttachedDescription({ description: fact("Long copy.", "human"), short_description: fact("Short.", "human") });
  ok(d3?.field === "description", "description outranks short_description");

  // strain pick
  ok(pickAttachedStrainType({ strain_type: fact("Sativa", "gemini", 0.95) })?.value === "sativa", "strain canonical");
  ok(pickAttachedStrainType({ strain_type: fact("indica dominant hybrid", "human") })?.value === "indica-hybrid", "leaning hybrid canonical");
  ok(pickAttachedStrainType({ strain_type: fact("unknown", "human") }) === null, "unknown never travels");
  ok(pickAttachedStrainType({ strain_type: fact("banana", "human") }) === null, "junk never travels");
  ok(pickAttachedStrainType({ strain_type: fact("sativa", "gemini", 0.8) }) === null, "low score never travels");
  ok(pickAttachedStrainType({ strain_type: fact(3, "human") }) === null, "non-string strain");

  // resolve order
  const att = (value: string, source: FactSource) => ({ value, source, confidence: source === "human" ? null : 0.95 });
  ok(resolveGoldenStrainType({ chosen: "indica", attached: att("sativa", "human"), enrichment: "hybrid" }).source === "human", "chosen wins");
  ok(resolveGoldenStrainType({ chosen: " ", attached: att("sativa", "human"), enrichment: "hybrid" }).value === "sativa", "attached human beats enrichment");
  const r3 = resolveGoldenStrainType({ chosen: null, attached: att("sativa", "gemini"), enrichment: "hybrid" });
  ok(r3.value === "hybrid" && r3.source === "enrichment", "enrichment beats a machine attached value");
  const r4 = resolveGoldenStrainType({ chosen: null, attached: att("sativa", "gemini"), enrichment: null });
  ok(r4.value === "sativa" && r4.source === "attached", "attached fills the gap (F-067)");
  const r5 = resolveGoldenStrainType({ chosen: null, attached: undefined, enrichment: null });
  ok(r5.value === "unknown" && r5.source === "unknown", "unknown only when nothing is known");
  const r6 = resolveGoldenStrainType({ chosen: null, attached: null, enrichment: "indica" });
  ok(r6.value === "indica" && r6.source === "enrichment", "pre-S12 order kept when nothing attached");

  // R35 #6: effects / aroma pick
  ok(GOLDEN_SENSORY_FIELDS.effects === "effects" && GOLDEN_SENSORY_FIELDS.aroma_notes === "aroma", "sensory field names");
  ok(pickAttachedSensory(null, "effects") === null, "sensory: no facts");
  const se = pickAttachedSensory({ effects: fact([" Relaxed ", "relaxed", "happy"], "gemini", 0.92) }, "effects");
  ok(JSON.stringify(se?.values) === JSON.stringify(["Relaxed", "happy"]) && se?.source === "gemini" && se?.confidence === 0.92, "sensory: cleaned + source");
  ok(pickAttachedSensory({ effects: fact(["relaxed"], "gemini", 0.89) }, "effects") === null, "sensory: 89% never travels");
  ok(pickAttachedSensory({ aroma: fact(["pine"], "remembered") }, "aroma") === null, "sensory: remembered never travels");
  ok(pickAttachedSensory({ aroma: fact(["pine"], "human") }, "aroma")?.values[0] === "pine", "sensory: a person's aroma travels");
  ok(pickAttachedSensory({ aroma: fact(["pine"], "human") }, "effects") === null, "sensory: fields are not crossed");
  ok(pickAttachedSensory({ aroma: fact([], "human") }, "aroma") === null, "sensory: empty list = null");
  ok(pickAttachedSensory({ aroma: fact("pine", "human") }, "aroma") === null, "sensory: a string is not a list");
  ok(pickAttachedSensory({ aroma: fact(["a", "b", "c", "d", "e", "f", "g", "h", "i"], "coa") }, "aroma")?.values.length === 8, "sensory: capped at 8");

  // source text
  ok(goldenSourceText("gemini", 0.94) === "the AI lookup 94%", "gemini label");
  ok(goldenSourceText("human", null) === "you", "human label");
  ok(goldenSourceText("kb_published", null) === "the knowledge base", "kb label");

  return { passed, failed };
}
