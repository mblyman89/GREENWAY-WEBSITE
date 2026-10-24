/**
 * src/lib/catalog/cultivera-confidence-core.ts  (R74 S38)
 *
 * Owner (round 18): "for Cultivera products specifically, after I run the ai
 * and collect every detail I can get, I want to create a score card for each
 * vendor. If the system is at least 85% confident in the search results for
 * all facts except for the images, then there should be a button to auto
 * attach all facts equal to or greater than 85% ... It should auto approve
 * the product after it auto attaches the facts, IF and only if, it has a
 * strain type picked."
 *
 * Pure: plain data in, plain data out. The server half is
 * cultivera-confidence-server.ts. The bar is a CODE constant (no env var):
 * it applies only to drafts on manifests rebuilt from the Cultivera export
 * (raw_payload.kind = RECONSTRUCTED_MANIFEST_KIND); every other product keeps
 * the house ATTACH_POLICY_RING / 90% rule.
 *
 * Scored facts (images excluded on purpose - a person always picks images):
 *   description, short line, effects, aroma, flavor  -> attached to the
 *                                                       product's own record
 *   strain type                                      -> the approval's pick
 * A product's score is its LOWEST scored fact (one weak fact = unsure).
 */

/** The Cultivera auto-attach bar (owner: "auto attach if at or above 85%"). */
export const CULTIVERA_AUTO_ATTACH_MIN = 85;

/** Facts the scorecard grades and the attach can land. Images never. */
export const SCORED_FACTS = ["description", "short_description", "effects", "aroma", "flavor", "strain_type"] as const;
export type ScoredFact = (typeof SCORED_FACTS)[number];
export const SCORED_FACT_LABEL: Readonly<Record<ScoredFact, string>> = Object.freeze({
  description: "Description",
  short_description: "Short line",
  effects: "Effects",
  aroma: "Aroma",
  flavor: "Flavor",
  strain_type: "Strain type",
});

/** Batch-lookups tab key + audit action. */
export const CONFIDENCE_TAB = "confidence";
export const CONFIDENCE_AUDIT_ACTION = "cultivera.confidence_attach";
/** Server time budget per click (the action reports what is left). */
export const CONFIDENCE_BUDGET_MS = 240_000;

const STRAIN_TYPES = new Set(["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd"]);

export type ScoredValue = { field: ScoredFact; value: string | string[]; confidence: number | null };

export type ProductScore = {
  draftId: string;
  name: string;
  manifestId: string;
  /** No usable per-fact scores came back (no lookup yet, an old v1 lookup, or memory only). */
  scored: boolean;
  facts: ScoredValue[];
  /** Lowest fact confidence (null = unscored). */
  score: number | null;
  confident: ScoredValue[];
  unsure: ScoredValue[];
  /** Strain type the approval would use (null = a person must pick it). */
  strain: string | null;
  strainFrom: "pick" | "lookup" | "record" | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

function cleanValue(field: ScoredFact, v: unknown): string | string[] | null {
  if (field === "effects" || field === "aroma" || field === "flavor") {
    if (!Array.isArray(v)) return null;
    const l = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
    return l.length ? l : null;
  }
  if (typeof v !== "string" || !v.trim()) return null;
  if (field === "strain_type") return STRAIN_TYPES.has(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null;
  return v.trim();
}

/** The compact snapshot facts (lookup-snapshot-core `facts.f`) -> scored values. */
export function scoredFactsOf(compact: unknown): ScoredValue[] {
  if (!compact || typeof compact !== "object" || Array.isArray(compact)) return [];
  const f = compact as Record<string, unknown>;
  const out: ScoredValue[] = [];
  for (const field of SCORED_FACTS) {
    const c = f[field];
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const cf = c as Record<string, unknown>;
    if (cf.w) continue; // withheld by the compliance gate
    const value = cleanValue(field, cf.v);
    if (value === null) continue;
    out.push({ field, value, confidence: num(cf.c) });
  }
  return out;
}

/**
 * The strain type an auto-approval may use. A person's pick wins; a record
 * (strain library / manifest) that CONTRADICTS the lookup means a person
 * decides (null); otherwise the lookup at the bar, else the record.
 */
export function strainForApproval(input: {
  chosen: string | null;
  lookup: string | null;
  lookupConfidence: number | null;
  kb: string | null;
  manifest: string | null;
  min?: number;
}): { value: string | null; from: ProductScore["strainFrom"] } {
  const ok = (v: string | null) => (v && STRAIN_TYPES.has(v.toLowerCase()) ? v.toLowerCase() : null);
  const chosen = ok(input.chosen);
  if (chosen) return { value: chosen, from: "pick" };
  const lookup = ok(input.lookup);
  const kb = ok(input.kb);
  const manifest = ok(input.manifest);
  if (lookup && ((kb && kb !== lookup) || (manifest && manifest !== lookup))) return { value: null, from: null };
  if (lookup && (input.lookupConfidence ?? -1) >= (input.min ?? CULTIVERA_AUTO_ATTACH_MIN)) return { value: lookup, from: "lookup" };
  if (kb && (!manifest || manifest === kb)) return { value: kb, from: "record" };
  if (manifest && !kb) return { value: manifest, from: "record" };
  return { value: null, from: null };
}

export function scoreProduct(input: {
  draftId: string;
  name: string;
  manifestId: string;
  compactFacts: unknown;
  chosenStrain: string | null;
  kbStrain: string | null;
  manifestStrain: string | null;
  min?: number;
}): ProductScore {
  const min = input.min ?? CULTIVERA_AUTO_ATTACH_MIN;
  const facts = scoredFactsOf(input.compactFacts);
  const confident = facts.filter((f) => f.confidence !== null && f.confidence >= min);
  const unsure = facts.filter((f) => f.confidence === null || f.confidence < min);
  const scores = facts.map((f) => f.confidence ?? 0);
  const st = facts.find((f) => f.field === "strain_type");
  const strain = strainForApproval({
    chosen: input.chosenStrain,
    lookup: st ? (st.value as string) : null,
    lookupConfidence: st?.confidence ?? null,
    kb: input.kbStrain,
    manifest: input.manifestStrain,
    min,
  });
  return {
    draftId: input.draftId,
    name: input.name,
    manifestId: input.manifestId,
    scored: facts.length > 0,
    facts,
    score: scores.length ? Math.min(...scores) : null,
    confident,
    unsure,
    strain: strain.value,
    strainFrom: strain.from,
  };
}

/** A product the "at or above the bar" button may approve: scored, nothing unsure, a strain type. */
export function autoApprovable(p: ProductScore): boolean {
  return p.scored && p.unsure.length === 0 && p.strain !== null;
}

export type VendorScorecard = {
  products: number;
  scored: number;
  /** Mean of every scored fact's confidence (null = nothing scored). */
  confidence: number | null;
  factsTotal: number;
  factsAtBar: number;
  /** Products whose every fact is at/above the bar. */
  confidentProducts: number;
  /** Products the bar button holds back (an unsure fact, or no scores). */
  heldBack: number;
  /** Of the confident ones, those still needing a strain type pick. */
  needStrain: number;
  /** Would auto-approve now. */
  approvable: number;
  ready: boolean;
};

export function vendorScorecard(products: readonly ProductScore[], min = CULTIVERA_AUTO_ATTACH_MIN): VendorScorecard {
  let sum = 0;
  let factsTotal = 0;
  let factsAtBar = 0;
  let scored = 0;
  let confidentProducts = 0;
  let needStrain = 0;
  let approvable = 0;
  for (const p of products) {
    if (!p.scored) continue;
    scored += 1;
    for (const f of p.facts) {
      factsTotal += 1;
      sum += f.confidence ?? 0;
      if (f.confidence !== null && f.confidence >= min) factsAtBar += 1;
    }
    if (p.unsure.length === 0) {
      confidentProducts += 1;
      if (p.strain === null) needStrain += 1;
      else approvable += 1;
    }
  }
  const confidence = factsTotal ? Math.round(sum / factsTotal) : null;
  return {
    products: products.length,
    scored,
    confidence,
    factsTotal,
    factsAtBar,
    confidentProducts,
    heldBack: products.length - confidentProducts,
    needStrain,
    approvable,
    ready: confidence !== null && confidence >= min,
  };
}

export type AttachMode = "confident" | "all" | "selected";

export function parseAttachMode(v: unknown): AttachMode | null {
  return v === "confident" || v === "all" || v === "selected" ? v : null;
}

/**
 * What one click does to one product: the facts to attach and whether to
 * approve. "confident" lands only facts at the bar and approves only a fully
 * confident product; "all"/"selected" is a person accepting every fact found.
 * Approval always needs a strain type.
 */
export function planProduct(p: ProductScore, mode: AttachMode): { attach: ScoredValue[]; approve: boolean } {
  const pool = mode === "confident" ? p.confident : p.facts;
  const attach = pool.filter((f) => f.field !== "strain_type");
  const approve = p.strain !== null && p.scored && (mode === "confident" ? p.unsure.length === 0 : true);
  return { attach, approve };
}

export function confidenceButtonLabel(s: VendorScorecard, min = CULTIVERA_AUTO_ATTACH_MIN): string {
  return `Attach all facts at or above ${min}% \u2014 hold back ${s.heldBack} product${s.heldBack === 1 ? "" : "s"} for review`;
}

export type RunTally = { products: number; attached: number; approved: number; waitingStrain: number; refused: number; skipped: number; left: number; errors: string[] };

export function runSentence(t: RunTally): string {
  const parts = [
    `${t.products} product${t.products === 1 ? "" : "s"} processed`,
    `${t.attached} fact${t.attached === 1 ? "" : "s"} attached`,
    `${t.approved} approved and published`,
  ];
  if (t.waitingStrain) parts.push(`${t.waitingStrain} waiting for a strain type pick`);
  if (t.refused) parts.push(`${t.refused} need a category/type pick on the approve form`);
  if (t.skipped) parts.push(`${t.skipped} held back for review`);
  let s = parts.join(" \u00b7 ") + ".";
  if (t.left) s += ` ${t.left} left - press the button again to continue.`;
  if (t.errors.length) s += ` Problems: ${t.errors.slice(0, 3).join("; ")}`;
  return s;
}

// ─── self-tests ────────────────────────────────────────────────────────────

export function __runCultiveraConfidenceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL cultivera-confidence-core: ${m}`);
    }
  };
  const F = (o: Record<string, unknown>) => o;
  const compact = F({
    description: { v: "Bright citrus.", c: 92 },
    effects: { v: ["happy", " "], c: 88 },
    aroma: { v: ["pine"], c: 70 },
    strain_type: { v: "Hybrid", c: 95 },
    images: { v: ["https://x.test/a.jpg"], c: 10 },
    flavor: { v: ["sweet"], c: 99, w: "compliance" },
  });
  const sf = scoredFactsOf(compact);
  ok(sf.length === 4 && !sf.some((f) => (f.field as string) === "images"), "images never scored; withheld dropped");
  ok(JSON.stringify(sf.find((f) => f.field === "effects")?.value) === '["happy"]', "lists cleaned");
  ok(sf.find((f) => f.field === "strain_type")?.value === "hybrid", "strain type canonical lower");
  ok(scoredFactsOf(null).length === 0 && scoredFactsOf([]).length === 0, "junk -> none");

  const base = { draftId: "d", name: "N", manifestId: "m", chosenStrain: null, kbStrain: null, manifestStrain: null };
  const p = scoreProduct({ ...base, compactFacts: compact });
  ok(p.score === 70 && p.unsure.length === 1 && p.confident.length === 3, "score = lowest fact");
  ok(p.strain === "hybrid" && p.strainFrom === "lookup", "strain from lookup at bar");
  ok(!autoApprovable(p), "one unsure fact -> not auto-approvable");
  const good = scoreProduct({ ...base, compactFacts: F({ description: { v: "D", c: 85 }, strain_type: { v: "indica", c: 90 } }) });
  ok(autoApprovable(good), "85 exactly is at the bar");
  const noStrain = scoreProduct({ ...base, compactFacts: F({ description: { v: "D", c: 95 } }) });
  ok(noStrain.strain === null && !autoApprovable(noStrain), "no strain -> waits for a pick");
  ok(scoreProduct({ ...base, compactFacts: null }).scored === false, "no lookup = unscored");

  // strain rules
  ok(strainForApproval({ chosen: "sativa", lookup: "indica", lookupConfidence: 99, kb: null, manifest: null }).value === "sativa", "pick wins");
  ok(strainForApproval({ chosen: null, lookup: "indica", lookupConfidence: 99, kb: "sativa", manifest: null }).value === null, "contradiction -> person");
  ok(strainForApproval({ chosen: null, lookup: "indica", lookupConfidence: 80, kb: null, manifest: null }).value === null, "below bar -> person");
  ok(strainForApproval({ chosen: null, lookup: null, lookupConfidence: null, kb: "indica", manifest: "indica" }).from === "record", "record agrees");
  ok(strainForApproval({ chosen: null, lookup: null, lookupConfidence: null, kb: "indica", manifest: "sativa" }).value === null, "records disagree -> person");
  ok(strainForApproval({ chosen: "unknown", lookup: null, lookupConfidence: null, kb: null, manifest: null }).value === null, "unknown is no pick");

  // vendor
  const sc = vendorScorecard([p, good, noStrain, scoreProduct({ ...base, compactFacts: null })]);
  ok(sc.products === 4 && sc.scored === 3 && sc.heldBack === 2, "held back = unsure + unscored");
  ok(sc.confidentProducts === 2 && sc.approvable === 1 && sc.needStrain === 1, "approvable vs need strain");
  ok(sc.factsTotal === 7 && sc.factsAtBar === 6, "fact counts");
  ok(sc.confidence === Math.round((92 + 88 + 70 + 95 + 85 + 90 + 95) / 7) && sc.ready, "mean confidence + ready");
  ok(vendorScorecard([]).confidence === null && !vendorScorecard([]).ready, "empty not ready");
  ok(confidenceButtonLabel(sc) === "Attach all facts at or above 85% \u2014 hold back 2 products for review", "button copy");

  // plan
  const pc = planProduct(p, "confident");
  ok(pc.attach.length === 2 && !pc.approve, "confident: bar facts only, no approve with an unsure fact");
  const pa = planProduct(p, "all");
  ok(pa.attach.length === 3 && pa.approve, "all: every fact, approve with strain");
  ok(!planProduct(noStrain, "all").approve, "never approve without strain");
  ok(parseAttachMode("confident") === "confident" && parseAttachMode("x") === null, "mode parse");
  ok(runSentence({ products: 2, attached: 5, approved: 1, waitingStrain: 1, refused: 0, skipped: 0, left: 3, errors: [] }).includes("3 left"), "sentence");
  return { passed, failed };
}
