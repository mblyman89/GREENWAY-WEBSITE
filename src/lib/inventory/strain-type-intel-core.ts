/**
 * src/lib/inventory/strain-type-intel-core.ts  (SLICE 93)
 *
 * PURE strain-type intelligence for Product Onboarding. Owner's verbatim ask:
 * "the name sometimes has it built in it, look for terms like, s, I, h, sh,
 * ih, or sat, ind, sat hybrid, ind hybrid... Be clever about looking for
 * strain type... And I want to be able to edit it just in case, or set it if
 * is not listed."
 *
 * Three jobs, all pure (no I/O, no React) - registered in the self-test runner:
 *
 *  1. parseStrainTypeFromName - reads strain-type signals EMBEDDED IN THE
 *     PRODUCT NAME with a confidence score. Recognized spellings:
 *       - full words:  indica / sativa / hybrid (any combination - "Indica
 *         Hybrid" resolves to the leaning token via canonicalStrainType)  95%
 *       - bracketed codes: (S) [I] (H) (SH) (IH) (SAT) (IND)               95%
 *       - abbreviation tokens: sat / ind (word-bounded)                    90%
 *       - leaning tokens: sh / ih (standalone, delimited)                  90%
 *       - bare single letters s / i / h ONLY as their own delimited token  90%
 *     NEVER-GUESS boundaries:
 *       - word-bounded matching only ("Sherbet" is not SH, "Sativai" is not
 *         sativa, "Indoor" is not ind).
 *       - CBD is deliberately NOT a name signal - real strain names carry it
 *         ("Watermelon CBD") and ratio blurbs mention it ("2:1 THC/CBD");
 *         the CBD type comes from the KB or the human, never the name.
 *       - conflicting explicit signals (e.g. "(S)" AND "Indica" in one name)
 *         return null - we refuse to guess.
 *       - indica + sativa together (no hybrid word) hints "hybrid" at 80%,
 *         BELOW the auto threshold - shown as a hint, never auto-assigned.
 *
 *  2. suggestStrainType - folds the three machine signals into ONE verdict
 *     with provenance, in trust order: curated strain library (kb_strains,
 *     100%) > the manifest's stated fact (inventory_lots.strain_type from the
 *     [H]/[I]/[S] intake split, 95%) > the name parse (its own score).
 *     >= STRAIN_TYPE_AUTO_MIN_CONFIDENCE (90, the same bar as the house-type
 *     labeler) auto-assigns; anything below is surfaced but needs the human.
 *
 *  3. decideKbStrainTypeWrite - the gap-fill policy for "save to the kb so it
 *     auto attaches on that product when we get new lots in": a missing row
 *     is created, a null/unknown strain_type is filled, and ONLY an explicit
 *     human pick may flip a value the KB already holds (audited by the
 *     caller). The machine never overrides curation.
 */
import {
  canonicalStrainType,
  strainTypeLabel,
  strainTypeValues,
} from "@/lib/menu/strain-taxonomy";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** Auto-assign bar - matches HOUSE_TYPE_MIN_AUTO_CONFIDENCE (owner rule B3). */
export const STRAIN_TYPE_AUTO_MIN_CONFIDENCE = 90;

/** A strain-type reading from one source, with provenance for diagnostics. */
export type StrainTypeSignal = {
  value: GreenwayStrainType;
  /** 0-100. >= STRAIN_TYPE_AUTO_MIN_CONFIDENCE may auto-assign. */
  confidence: number;
  /** The exact token(s) that produced the reading (plain English, for audit). */
  evidence: string;
};

export type StrainTypeSuggestion = {
  value: GreenwayStrainType;
  confidence: number;
  /** Where the verdict came from - shown to the approver, never hidden. */
  source: "strain library" | "manifest" | "product name";
  evidence: string;
};

// Short codes -> canonical values (the owner's exact list).
const CODE_MAP: Record<string, GreenwayStrainType> = {
  s: "sativa",
  i: "indica",
  h: "hybrid",
  sh: "sativa-hybrid",
  ih: "indica-hybrid",
  sat: "sativa",
  ind: "indica",
};

// (S) [IH] ( sat ) ... - an explicit annotation someone typed on purpose.
const BRACKET_CODE_RE = /[([]\s*(sh|ih|sat|ind|s|i|h)\s*[)\]]/gi;
// Full type words anywhere (word-bounded).
const FULL_WORD_RE = /\b(indica|sativa|hybrid)\b/gi;
// Standalone abbreviation / letter tokens between delimiters. "Gelato - IH",
// "GG4 sat 1g", "Blue Dream S". Word chars on either side disqualify.
const TOKEN_RE = /(^|[\s\-–—/|:,])(sh|ih|sat|ind|s|i|h)(?=$|[\s\-–—/|:,.)])/gi;

/**
 * Read a strain type from a product NAME. Returns null when the name carries
 * no signal - or carries CONFLICTING signals (never guess).
 */
export function parseStrainTypeFromName(name: string | null | undefined): StrainTypeSignal | null {
  const text = String(name ?? "").trim();
  if (!text) return null;

  const evidence: string[] = [];
  let best = 0; // confidence of the strongest contributing signal family
  const leanings = new Set<GreenwayStrainType>();
  const bases = new Set<"indica" | "sativa" | "hybrid">();
  // Which bases arrived via an EXPLICIT code ((S), "- ih", "sat") vs prose
  // words. Two pures both spelled out in prose is a soft "probably hybrid"
  // hint; a code contradicting a prose word is a hard conflict.
  const codeBases = new Set<"indica" | "sativa" | "hybrid">();

  const take = (code: string, conf: number, shown: string) => {
    const value = CODE_MAP[code.toLowerCase()];
    if (!value) return;
    if (value === "indica-hybrid" || value === "sativa-hybrid") {
      leanings.add(value);
    } else {
      bases.add(value as "indica" | "sativa" | "hybrid");
      codeBases.add(value as "indica" | "sativa" | "hybrid");
    }
    evidence.push(shown);
    best = Math.max(best, conf);
  };

  // 1) Full words - strongest prose signal.
  for (const m of text.matchAll(FULL_WORD_RE)) {
    const w = m[1].toLowerCase() as "indica" | "sativa" | "hybrid";
    bases.add(w);
    evidence.push(`"${m[1]}"`);
    best = Math.max(best, 95);
  }

  // 2) Bracketed codes - explicit annotations, e.g. "Moonbow 1g (H)".
  for (const m of text.matchAll(BRACKET_CODE_RE)) {
    take(m[1], 95, `"(${m[1].toUpperCase()})"`);
  }

  // 3) Standalone tokens - "Gelato ih", "GG4 - sat", "Blue Dream S".
  //    Strip bracketed segments first so codes aren't double-counted.
  const withoutBrackets = text.replace(BRACKET_CODE_RE, " ");
  for (const m of withoutBrackets.matchAll(TOKEN_RE)) {
    take(m[2], 90, `"${m[2].toUpperCase()}" token`);
  }

  if (leanings.size === 0 && bases.size === 0) return null;

  // Conflicting leanings ("IH" and "SH" in one name) - refuse to guess.
  if (leanings.size > 1) return null;

  const shown = Array.from(new Set(evidence)).join(", ");

  if (leanings.size === 1) {
    const leaning = Array.from(leanings)[0];
    // A leaning code plus a CONTRADICTING base signal is a conflict.
    const leanBase = leaning === "indica-hybrid" ? "indica" : "sativa";
    const opposite = leanBase === "indica" ? "sativa" : "indica";
    if (bases.has(opposite)) return null;
    return { value: leaning, confidence: best, evidence: shown };
  }

  if (bases.has("indica") && bases.has("sativa")) {
    // An explicit code contradicting the other pure = a hard conflict -
    // "Indica Kush (S)" could be either a mislabel or a weird name: refuse.
    if (codeBases.has("indica") || codeBases.has("sativa")) return null;
    // Both pures in PROSE with the hybrid word too -> plain hybrid, full conf.
    if (bases.has("hybrid")) return { value: "hybrid", confidence: best, evidence: shown };
    // Both pures in prose, no hybrid word: a hint only - below the auto bar.
    return { value: "hybrid", confidence: 80, evidence: shown };
  }
  // Single-pure / hybrid combinations resolve exactly like canonicalStrainType:
  // indica+hybrid -> indica-hybrid, sativa+hybrid -> sativa-hybrid, etc.
  const value = canonicalStrainType(Array.from(bases).join(" "));
  if (value === "unknown") return null;
  return { value, confidence: best, evidence: shown };
}

/**
 * ONE machine verdict from the three signals, in trust order. kb > lot > name.
 * Returns null when nothing is known ("Set strain type…" in the UI).
 */
export function suggestStrainType(input: {
  /** kb_strains.strain_type for the draft's strain (curated), raw spelling ok. */
  kbStrainType?: string | null;
  /** inventory_lots.strain_type - the manifest's stated fact, raw spelling ok. */
  lotStrainType?: string | null;
  /** The draft/product name to parse. */
  productName?: string | null;
}): StrainTypeSuggestion | null {
  const kb = canonicalStrainType(input.kbStrainType ?? "");
  if (kb !== "unknown") {
    return { value: kb, confidence: 100, source: "strain library", evidence: "curated kb_strains row" };
  }
  const lot = canonicalStrainType(input.lotStrainType ?? "");
  if (lot !== "unknown") {
    return { value: lot, confidence: 95, source: "manifest", evidence: "stated on the intake record" };
  }
  const parsed = parseStrainTypeFromName(input.productName);
  if (parsed) {
    return { value: parsed.value, confidence: parsed.confidence, source: "product name", evidence: parsed.evidence };
  }
  return null;
}

/**
 * Validate the approver's strain-type pick against the canonical taxonomy.
 * Empty and "unknown" both mean "no pick" (keep auto). Junk is REFUSED with a
 * plain-English error - the form is never trusted.
 */
export function validateStrainTypeChoice(
  raw: string | null | undefined,
): { ok: true; value: GreenwayStrainType | null } | { ok: false; error: string } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || trimmed === "unknown") return { ok: true, value: null };
  const value = trimmed as GreenwayStrainType;
  if ((strainTypeValues as readonly string[]).includes(value) && value !== "unknown") {
    return { ok: true, value };
  }
  return {
    ok: false,
    error: `"${trimmed}" isn't one of our strain types. Pick Indica, Sativa, Hybrid, Indica-Hybrid, Sativa-Hybrid, or CBD.`,
  };
}

/** The picker's empty-option text - honest about what "no pick" does. */
export function strainTypePickerPlaceholder(suggestion: StrainTypeSuggestion | null): string {
  if (!suggestion) return "Set strain type… (optional)";
  if (suggestion.confidence >= STRAIN_TYPE_AUTO_MIN_CONFIDENCE) {
    return `Keep auto: ${strainTypeLabel(suggestion.value)} (${suggestion.source}, ${suggestion.confidence}% confident)`;
  }
  return `Name hints ${strainTypeLabel(suggestion.value)} (${suggestion.confidence}%) — pick to confirm`;
}

// ---------------------------------------------------------------------------
// KB gap-fill policy - "save to the kb so it auto attaches on that product
// when we get new lots in."
// ---------------------------------------------------------------------------

export type KbStrainTypeWriteDecision =
  | { action: "create"; reason: string }
  | { action: "set"; reason: string }
  | { action: "flip"; reason: string }
  | { action: "skip"; reason: string };

/**
 * Decide what (if anything) to write to kb_strains.strain_type after an
 * approval carrying a strain-type verdict. The machine NEVER overrides
 * curation: only an explicit human pick may flip a value the KB already
 * holds (the caller audits it). Everything else is create-or-gap-fill.
 */
export function decideKbStrainTypeWrite(input: {
  /** Whether a kb_strains row exists for this strain slug. */
  exists: boolean;
  /** The existing row's strain_type (raw), when it exists. */
  existingType?: string | null;
  /** The approval's verdict (canonical, never "unknown" here). */
  verdict: GreenwayStrainType;
  /** "human" = the approver picked it; "auto" = machine >=90 ratified by the approval. */
  source: "human" | "auto";
}): KbStrainTypeWriteDecision {
  if (!input.exists) {
    return { action: "create", reason: "no strain row yet — creating one so the type auto-attaches on future lots" };
  }
  const existing = canonicalStrainType(input.existingType ?? "");
  if (existing === "unknown") {
    return { action: "set", reason: "strain row had no type — gap-filled" };
  }
  if (existing === input.verdict) {
    return { action: "skip", reason: "the KB already says the same thing" };
  }
  if (input.source === "human") {
    return { action: "flip", reason: `the approver picked ${input.verdict} over the KB's ${existing} — the human outranks the record` };
  }
  return { action: "skip", reason: `the KB says ${existing} and the machine never overrides curation` };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) - registered in the runner
// ---------------------------------------------------------------------------

export function __runStrainTypeIntelTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL strain-type-intel-core: " + msg);
    passed += 1;
  };
  const p = (name: string | null | undefined) => parseStrainTypeFromName(name);
  const val = (name: string) => p(name)?.value ?? null;
  const conf = (name: string) => p(name)?.confidence ?? 0;

  // Full words - 95%.
  ok(val("Grape Ape Indica 3.5g") === "indica" && conf("Grape Ape Indica 3.5g") === 95, "full word Indica @95");
  ok(val("Chocolate Turtle Sativa") === "sativa", "full word Sativa");
  ok(val("Guava Hybrid 1g") === "hybrid", "full word Hybrid");
  ok(val("Grease Monkey Indica Hybrid") === "indica-hybrid", "Indica Hybrid -> leaning");
  ok(val("Super Silver Sativa Hybrid Cart") === "sativa-hybrid", "Sativa Hybrid -> leaning");

  // Bracketed codes - 95%.
  ok(val("Moonbow - 1g (H)") === "hybrid" && conf("Moonbow - 1g (H)") === 95, "(H) @95");
  ok(val("Trufflez [ I ] 1g") === "indica", "[ I ] with spaces");
  ok(val("Maui Waui (S)") === "sativa", "(S)");
  ok(val("Gelato 41 (IH)") === "indica-hybrid", "(IH) leaning code");
  ok(val("Green Crack (SH) 1g") === "sativa-hybrid", "(SH) leaning code");
  ok(val("Cookies (sat)") === "sativa", "(sat)");
  ok(val("Blueberry (ind) 3.5g") === "indica", "(ind)");

  // Standalone tokens - 90%.
  ok(val("GG4 - sat 1g") === "sativa" && conf("GG4 - sat 1g") === 90, "sat token @90");
  ok(val("Blueberry ind 3.5g") === "indica", "ind token");
  ok(val("Gelato ih") === "indica-hybrid", "ih token");
  ok(val("Green Crack sh 1g") === "sativa-hybrid", "sh token");
  ok(val("Blue Dream S") === "sativa", "trailing bare S");
  ok(val("Grape Ape - I 1g") === "indica", "delimited bare I");
  ok(val("Moonbow h") === "hybrid", "trailing bare h");

  // Word boundaries - never mangle real names.
  ok(p("Sunset Sherbet 1g") === null, "Sherbet is not SH");
  ok(p("Sativai Kush") === null, "Sativai is not sativa");
  ok(p("Hybridge") === null, "Hybridge is not hybrid");
  ok(p("Indoor Grown OG") === null, "Indoor is not ind");
  ok(p("Wedding Cake 3.5g") === null, "clean name -> null");
  ok(p("Shark Shock") === null, "Sh inside words ignored");
  ok(p("High Society") === null, "H inside words ignored");

  // CBD deliberately not a name signal.
  ok(p("Watermelon CBD") === null, "CBD never parsed from the name");
  ok(p("Raspberry 60:1 CBD:THC") === null, "ratio blurb never parsed");

  // Conflicts - never guess.
  ok(p("Indica Kush (S)") === null, "conflicting word + code -> null");
  ok(p("Gelato (IH) (SH)") === null, "two leanings -> null");
  ok(p("Sativa Blend ih") === null, "leaning vs opposite base -> null");
  {
    const both = p("Indica Sativa Blend");
    ok(both?.value === "hybrid" && both.confidence === 80, "indica+sativa -> hybrid hint @80 (below auto)");
  }

  // Empty / null.
  ok(p("") === null && p(null) === null && p(undefined) === null, "empty -> null");

  // suggestStrainType precedence: kb > lot > name.
  {
    const s = suggestStrainType({ kbStrainType: "Indica Dominant Hybrid", lotStrainType: "sativa", productName: "X (H)" });
    ok(s?.value === "indica-hybrid" && s.source === "strain library" && s.confidence === 100, "kb wins, canonicalized");
  }
  {
    const s = suggestStrainType({ kbStrainType: null, lotStrainType: "hybrid", productName: "X (S)" });
    ok(s?.value === "hybrid" && s.source === "manifest" && s.confidence === 95, "lot beats name");
  }
  {
    const s = suggestStrainType({ kbStrainType: "unknown", lotStrainType: "", productName: "Blue Dream (S) 1g" });
    ok(s?.value === "sativa" && s.source === "product name" && s.confidence === 95, "name parse last");
  }
  ok(suggestStrainType({ kbStrainType: null, lotStrainType: null, productName: "Wedding Cake" }) === null, "no signal -> null");

  // validateStrainTypeChoice - closed vocabulary, junk refused.
  {
    const v = validateStrainTypeChoice("sativa-hybrid");
    ok(v.ok === true && v.value === "sativa-hybrid", "canonical accepted");
  }
  {
    const v = validateStrainTypeChoice("");
    ok(v.ok === true && v.value === null, "empty = no pick");
  }
  {
    const v = validateStrainTypeChoice("unknown");
    ok(v.ok === true && v.value === null, "unknown = no pick");
  }
  {
    const v = validateStrainTypeChoice("purple");
    ok(v.ok === false && /isn't one of our strain types/.test(v.ok === false ? v.error : ""), "junk refused in plain English");
  }

  // Placeholder honesty.
  ok(
    strainTypePickerPlaceholder(null) === "Set strain type… (optional)",
    "no-signal placeholder invites a pick",
  );
  ok(
    strainTypePickerPlaceholder({ value: "indica", confidence: 95, source: "product name", evidence: "x" }) ===
      "Keep auto: Indica (product name, 95% confident)",
    "confident placeholder says Keep auto",
  );
  ok(
    strainTypePickerPlaceholder({ value: "hybrid", confidence: 80, source: "product name", evidence: "x" }).startsWith("Name hints Hybrid (80%)"),
    "below-bar placeholder is a hint, not an auto",
  );

  // KB write policy: create / gap-fill / human-only flip / machine never flips.
  ok(decideKbStrainTypeWrite({ exists: false, verdict: "indica", source: "auto" }).action === "create", "missing row -> create");
  ok(decideKbStrainTypeWrite({ exists: true, existingType: null, verdict: "sativa", source: "auto" }).action === "set", "null type -> set");
  ok(decideKbStrainTypeWrite({ exists: true, existingType: "unknown", verdict: "hybrid", source: "human" }).action === "set", "unknown type -> set");
  ok(decideKbStrainTypeWrite({ exists: true, existingType: "indica", verdict: "indica", source: "human" }).action === "skip", "same value -> skip");
  ok(decideKbStrainTypeWrite({ exists: true, existingType: "indica", verdict: "sativa", source: "human" }).action === "flip", "human pick flips");
  ok(decideKbStrainTypeWrite({ exists: true, existingType: "indica", verdict: "sativa", source: "auto" }).action === "skip", "machine NEVER flips curation");

  return { passed };
}
