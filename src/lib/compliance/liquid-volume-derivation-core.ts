/**
 * SLICE L3 — deriving a liquid's PER-PACKAGE net volume from its product name.
 *
 * WHY THIS FILE EXISTS (and why it is not three lines of `sizes[0]`)
 * ─────────────────────────────────────────────────────────────────────────────
 * L1 fixed the sales-limit BASIS (ml, not grams) and L2 taught every size
 * parser to read litres. Neither one put a volume on a receiving line, so the
 * register still had nothing to measure. This is that derivation.
 *
 * The obvious implementation — take the first ml/fl-oz/L size the name
 * extractor found — OVERSELLS BY 4x TO 6x on real product names. Measured
 * against the live extractor (scripts/compliance/probe-l3-sizes.ts):
 *
 *   "Ray's Lemonade 4 x 50ml"   -> sizes [50 ml], packCount NULL   (truth 200 ml)
 *   "Ray's Lemonade 4x50ml"     -> sizes [],      packCount NULL   (truth 200 ml)
 *   "Legal Cherry 6 Pack 12 fl oz" -> sizes [12 floz], packCount 6 (truth 72 fl oz)
 *
 * The first two are the dangerous ones: the extractor reports a SINGLE 50 ml
 * fact and NO pack count, so a naive reader records a 200 ml four-pack as
 * 50 ml and the register then allows four times the legal volume. The third
 * hides the whole daily limit inside one carton.
 *
 * So the rule here is: a stated volume is a PER-UNIT volume, and a pack
 * multiplier multiplies it. Both readings of "4 x 50ml" — four 50 ml bottles,
 * or four 50 ml servings inside one bottle — give the same 200 ml package
 * total, so multiplying is correct under either reading, not a guess.
 *
 * FAIL DIRECTION. For volume, BIGGER IS SAFER: a larger recorded per-package
 * volume means fewer packages fit under the 72 fl oz cap. So where a name
 * states the same volume twice in different units ("100ml 3.4 fl oz") we take
 * the maximum rather than averaging, and where two stated volumes genuinely
 * disagree we take the maximum AND mark the result `ambiguous` so the SLICE L5
 * receiving gate puts a human on it.
 *
 * BARE OUNCES ARE NEVER A VOLUME. "12 oz" on a root beer is almost certainly
 * fluid ounces, but "1.7 oz" on a salve is weight, and this module cannot tell
 * them apart from the name alone. L1 made that call deliberately: `toMl()` has
 * no `oz` case and `VolumeUnit` excludes it. Guessing here would either
 * under-count a drink (oversell) or invent a volume for a salve. Instead we
 * return null and report `bare_ounces_present`, which is exactly the signal
 * the receiving gate needs to ask "is that 12 oz by weight or by volume?".
 *
 * NULL MEANS "NOBODY KNOWS", NEVER "ZERO". Same rule as the SLICE 62 facts.
 */

import {
  ML_PER_FLUID_OUNCE,
  ML_PER_LITRE,
  toMl,
  type VolumeUnit,
} from "@/lib/compliance/liquid-volume-core";

/** True avoirdupois grams per ounce (GW-016), for the weight half. */
export const AVOIRDUPOIS_GRAMS_PER_OUNCE = 28.349523125;

/**
 * The LCB inventory types whose sales limit is measured in VOLUME, so a
 * missing net_volume_ml is a compliance hole worth a diagnostic.
 *
 * Drawn from the four values of MG_FACT_TYPES (fact-extraction-core.ts:49),
 * minus the two that are not volume-limited:
 *   - "Solid Edible" is a weight/dose limit, not a volume.
 *   - "Topical Ointment" stays on WEIGHTED ounces by owner decision; moving
 *     topicals out of the liquid bucket to industry-standard practice is its
 *     own later slice, and pre-empting it here would change limits nobody
 *     asked to change yet.
 *
 * Exported because the SLICE L5 receiving gate needs the same list, and two
 * copies of a compliance scope is how they drift apart.
 */
export const LIQUID_VOLUME_TYPES = new Set(["Liquid Edible", "Tincture"]);

/**
 * A size fact as `extractNameFacts` reports it (fact-extraction-core.ts:80).
 * Declared structurally so this pure module does not depend on the extractor.
 */
export type SizeFact = { quantity: number; unit: "g" | "oz" | "floz" | "ml" | "l" };

/**
 * Why a derivation came out the way it did. These are the inputs to the
 * SLICE L5 receiving question, so each one is a distinct, actionable reason.
 */
export type VolumeReason =
  | "no_size_in_name"
  | "no_volume_in_name"
  | "bare_ounces_present"
  | "single_volume"
  | "pack_multiplier_applied"
  | "conflicting_volumes";

export type VolumeDerivation = {
  /** PER-PACKAGE net volume in ml — the number the limit engine measures. */
  netVolumeMl: number | null;
  /** Volume of ONE unit (one bottle/can) in ml, before any pack multiplier. */
  perUnitMl: number | null;
  /** The multiplier applied, or null when none was stated. */
  packCount: number | null;
  /**
   * Provenance string for `fact_provenance.net_volume_ml`. Mirrors the
   * vocabulary transform.ts already uses ("column"), extended for this path.
   */
  source: "name" | "name-pack" | null;
  /**
   * `verified` = one unambiguous reading. `ambiguous` = we produced a
   * fail-closed number but a human must confirm it. null = nothing derived.
   */
  confidence: "verified" | "ambiguous" | null;
  reasons: VolumeReason[];
};

/**
 * "4 x 50ml", "4x50ml", "2 x 2 fl oz" — a multiplier bound directly to a
 * volume. Deliberately NOT `\d+\s*x\s*\d+` in general: "10 x 20mg" is a dose
 * statement (servingsTimesDose) and must not be read as a volume.
 *
 * The litre alternative uses a `(?=$|[^a-z])` lookahead rather than `\b` so a
 * bare "l" cannot swallow the L of "Lemonade" or "Lime" — the same safeguard
 * L2 put on LITRE_RE in fact-extraction-core.ts. `[\s\S]` is never needed here
 * (no dotAll), which keeps the root tsconfig's pre-es2018 target happy.
 */
const PACK_TIMES_VOLUME_RE =
  /(\d+)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*(ml|milliliters?|millilitres?|fl\.?\s*oz|floz|fluid\s*ounces?|liters?|litres?|l)(?=$|[^a-z])/i;

/** Normalise a matched unit word to the canonical VolumeUnit. */
function unitWordToVolumeUnit(word: string): VolumeUnit | null {
  const w = word.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (w === "ml" || w === "milliliter" || w === "milliliters" || w === "millilitre" || w === "millilitres") {
    return "ml";
  }
  if (w === "floz" || w === "fluidounce" || w === "fluidounces") return "floz";
  if (w === "l" || w === "liter" || w === "liters" || w === "litre" || w === "litres") return "l";
  return null;
}

/** Round to 4 dp so float noise never manufactures a "conflict". */
function r4(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * Derive the per-package net volume in ml.
 *
 * @param rawName  the product name as received (for the "N x volume" pattern,
 *                 which the extractor does not report — verified by probe).
 * @param sizes    `extractNameFacts(rawName).sizes`
 * @param packCount `extractNameFacts(rawName).packCount` ("6 Pack" -> 6)
 */
export function deriveNetVolumeMl(input: {
  rawName: string | null | undefined;
  sizes: SizeFact[];
  packCount: number | null;
}): VolumeDerivation {
  const none: VolumeDerivation = {
    netVolumeMl: null,
    perUnitMl: null,
    packCount: null,
    source: null,
    confidence: null,
    reasons: [],
  };
  const name = (input.rawName ?? "").trim();
  const sizes = Array.isArray(input.sizes) ? input.sizes : [];
  const reasons: VolumeReason[] = [];

  // ── 1. An explicit "N x <volume>" outranks everything ────────────────────
  // It is the only construction that states the multiplier AND the per-unit
  // volume in one breath, and it is the construction the extractor loses.
  const times = name.match(PACK_TIMES_VOLUME_RE);
  if (times) {
    const n = Number(times[1]);
    const qty = Number(times[2]);
    const unit = unitWordToVolumeUnit(times[3]);
    const perUnit = unit ? toMl(qty, unit) : null;
    if (perUnit !== null && Number.isFinite(n) && n > 0) {
      return {
        netVolumeMl: r4(perUnit * n),
        perUnitMl: r4(perUnit),
        packCount: n,
        source: "name-pack",
        // A human confirms the multiplier at receiving. We still record the
        // fail-closed product rather than null, so an unanswered question can
        // never be the thing that lets an oversell through.
        confidence: n > 1 ? "ambiguous" : "verified",
        reasons: n > 1 ? ["pack_multiplier_applied"] : ["single_volume"],
      };
    }
  }

  // ── 2. Otherwise use the extractor's volume sizes ────────────────────────
  const volumes: number[] = [];
  let sawBareOunces = false;
  for (const s of sizes) {
    if (s.unit === "oz") {
      sawBareOunces = true;
      continue;
    }
    if (s.unit === "g") continue;
    if (!Number.isFinite(s.quantity) || s.quantity <= 0) continue;
    const ml = toMl(s.quantity, s.unit);
    if (ml !== null) volumes.push(ml);
  }

  if (volumes.length === 0) {
    if (sizes.length === 0) return { ...none, reasons: ["no_size_in_name"] };
    return {
      ...none,
      reasons: sawBareOunces ? ["bare_ounces_present"] : ["no_volume_in_name"],
    };
  }

  // Same physical volume written twice ("100ml 3.4 fl oz") vs two genuinely
  // different volumes. 2 % tolerance absorbs the rounding vendors do when
  // they print both units on a label; anything wider is a real conflict.
  const maxMl = Math.max(...volumes);
  const minMl = Math.min(...volumes);
  const conflicting = volumes.length > 1 && maxMl - minMl > maxMl * 0.02;
  if (conflicting) reasons.push("conflicting_volumes");
  else reasons.push("single_volume");

  // Bigger is safer, so the maximum is both the conflict resolution and the
  // no-op for restatements of one volume.
  const perUnitMl = maxMl;
  const pack = Number.isFinite(input.packCount ?? NaN) && (input.packCount ?? 0) > 1
    ? (input.packCount as number)
    : null;
  if (pack !== null) reasons.push("pack_multiplier_applied");

  return {
    netVolumeMl: r4(pack !== null ? perUnitMl * pack : perUnitMl),
    perUnitMl: r4(perUnitMl),
    packCount: pack,
    source: pack !== null ? "name-pack" : "name",
    confidence: conflicting || pack !== null ? "ambiguous" : "verified",
    reasons,
  };
}

/**
 * The weight half, for symmetry with transform.ts SLICE 56. Purely additive:
 * `net_weight_grams` on an intake row was hardcoded null before this slice and
 * the register measures weight from the variant label, so filling it in
 * changes no limit arithmetic — it just stops the golden record from lying.
 */
export function deriveNetWeightGrams(sizes: SizeFact[]): number | null {
  const list = Array.isArray(sizes) ? sizes : [];
  const grams: number[] = [];
  for (const s of list) {
    if (!Number.isFinite(s.quantity) || s.quantity <= 0) continue;
    if (s.unit === "g") grams.push(s.quantity);
    else if (s.unit === "oz") grams.push(s.quantity * AVOIRDUPOIS_GRAMS_PER_OUNCE);
  }
  if (grams.length === 0) return null;
  return r4(Math.max(...grams));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (AGENTS.md rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export function __runLiquidVolumeDerivationTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL: ${msg}`);
    }
  };
  const near = (a: number | null, b: number, msg: string) =>
    ok(a !== null && Math.abs(a - b) < 0.01, `${msg} (got ${a}, want ${b})`);

  // --- the oversell cases that motivated this module --------------------
  {
    // "4 x 50ml": extractor reports ONE 50 ml size and NO pack count.
    const d = deriveNetVolumeMl({ rawName: "Ray's Lemonade 4 x 50ml", sizes: [{ quantity: 50, unit: "ml" }], packCount: null });
    near(d.netVolumeMl, 200, "4 x 50ml is a 200 ml package, not 50");
    near(d.perUnitMl, 50, "per-unit stays 50 ml");
    ok(d.packCount === 4, "multiplier 4 recorded");
    ok(d.source === "name-pack", "provenance says a pack multiplier was used");
    ok(d.confidence === "ambiguous", "a multiplied pack wants human confirmation");
    ok(d.reasons.includes("pack_multiplier_applied"), "reason is actionable");
  }
  {
    // "4x50ml": the extractor finds NOTHING (verified by probe), so the
    // raw-name pattern is the only thing standing between us and a null.
    const d = deriveNetVolumeMl({ rawName: "Ray's Lemonade 4x50ml", sizes: [], packCount: null });
    near(d.netVolumeMl, 200, "no-space 4x50ml still resolves to 200 ml");
  }
  {
    // "6 Pack 12 fl oz" = 72 fl oz = the ENTIRE daily limit in one carton.
    const d = deriveNetVolumeMl({ rawName: "Legal Cherry 6 Pack 12 fl oz", sizes: [{ quantity: 12, unit: "floz" }], packCount: 6 });
    near(d.netVolumeMl, 6 * 12 * ML_PER_FLUID_OUNCE, "6-pack of 12 fl oz is 72 fl oz");
    ok(d.packCount === 6, "packCount from the extractor is honoured");
    ok(d.confidence === "ambiguous", "6-pack flagged for confirmation");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Vitalis Shot 2 x 2 fl oz", sizes: [{ quantity: 2, unit: "floz" }], packCount: null });
    near(d.netVolumeMl, 4 * ML_PER_FLUID_OUNCE, "2 x 2 fl oz is 4 fl oz");
  }

  // --- plain single volumes ---------------------------------------------
  {
    const d = deriveNetVolumeMl({ rawName: "Fairwinds Sleepy Time Tincture 30ml", sizes: [{ quantity: 30, unit: "ml" }], packCount: null });
    near(d.netVolumeMl, 30, "30ml tincture");
    ok(d.packCount === null && d.source === "name", "no multiplier, plain name provenance");
    ok(d.confidence === "verified", "unambiguous single volume is verified");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Happy Apple Cider 1L", sizes: [{ quantity: 1, unit: "l" }], packCount: null });
    near(d.netVolumeMl, ML_PER_LITRE, "1L is 1000 ml (the L2 fix reaching the limit)");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Ceres Quencher Lemonade 12 fl oz", sizes: [{ quantity: 12, unit: "floz" }], packCount: null });
    near(d.netVolumeMl, 12 * ML_PER_FLUID_OUNCE, "12 fl oz converts by the statute constant");
  }

  // --- weights must NEVER become volumes --------------------------------
  {
    const d = deriveNetVolumeMl({ rawName: "A.C. Topical Salve 1.7 oz", sizes: [{ quantity: 1.7, unit: "oz" }], packCount: null });
    ok(d.netVolumeMl === null, "bare ounces yield NO volume");
    ok(d.reasons.includes("bare_ounces_present"), "and say why, so L5 can ask");
    near(deriveNetWeightGrams([{ quantity: 1.7, unit: "oz" }]), 1.7 * AVOIRDUPOIS_GRAMS_PER_OUNCE, "1.7 oz weighs 48.2 g");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Mirth Legal Root Beer 12 oz", sizes: [{ quantity: 12, unit: "oz" }], packCount: null });
    ok(d.netVolumeMl === null, "even an obvious drink in bare oz stays unknown, never guessed");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Cannasol RSO 1g", sizes: [{ quantity: 1, unit: "g" }], packCount: null });
    ok(d.netVolumeMl === null && d.reasons.includes("no_volume_in_name"), "grams are not a volume");
    ok(deriveNetWeightGrams([{ quantity: 1, unit: "g" }]) === 1, "1g weight passes through");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Wyld Sparkling Water 10mg", sizes: [], packCount: null });
    ok(d.netVolumeMl === null && d.reasons.includes("no_size_in_name"), "mg is potency, not size");
    ok(deriveNetWeightGrams([]) === null, "no sizes means no weight");
  }

  // --- two units, one bottle, and real conflicts ------------------------
  {
    const d = deriveNetVolumeMl({ rawName: "Elixir 100ml 3.4 fl oz", sizes: [{ quantity: 3.4, unit: "floz" }, { quantity: 100, unit: "ml" }], packCount: null });
    near(d.netVolumeMl, 3.4 * ML_PER_FLUID_OUNCE, "same volume twice resolves to the larger restatement");
    ok(!d.reasons.includes("conflicting_volumes"), "within 2 % is not a conflict");
    ok(d.confidence === "verified", "a restatement is still verified");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Mystery Syrup 100ml 750ml", sizes: [{ quantity: 100, unit: "ml" }, { quantity: 750, unit: "ml" }], packCount: null });
    near(d.netVolumeMl, 750, "a genuine conflict resolves to the LARGER (fail-closed)");
    ok(d.reasons.includes("conflicting_volumes") && d.confidence === "ambiguous", "and is flagged");
  }
  {
    const d = deriveNetVolumeMl({ rawName: "Tincture 1 oz 30ml", sizes: [{ quantity: 1, unit: "oz" }, { quantity: 30, unit: "ml" }], packCount: null });
    near(d.netVolumeMl, 30, "the ml wins; the ambiguous oz is ignored, not converted");
  }

  // --- degenerate input --------------------------------------------------
  {
    ok(deriveNetVolumeMl({ rawName: null, sizes: [], packCount: null }).netVolumeMl === null, "null name is safe");
    ok(deriveNetVolumeMl({ rawName: "x", sizes: [{ quantity: 0, unit: "ml" }], packCount: null }).netVolumeMl === null, "zero ml is not a volume");
    ok(deriveNetVolumeMl({ rawName: "y", sizes: [{ quantity: -5, unit: "ml" }], packCount: null }).netVolumeMl === null, "negative ml is not a volume");
    ok(deriveNetVolumeMl({ rawName: "Single 1 Pack 50ml", sizes: [{ quantity: 50, unit: "ml" }], packCount: 1 }).netVolumeMl === 50, "a 1-pack multiplies by nothing");
    ok(deriveNetVolumeMl({ rawName: "z 50ml", sizes: [{ quantity: 50, unit: "ml" }], packCount: 0 }).netVolumeMl === 50, "packCount 0 is not a multiplier");
  }

  // --- the "l" lookahead must not eat a word ----------------------------
  {
    ok(deriveNetVolumeMl({ rawName: "4 x 2 Lemonade", sizes: [], packCount: null }).netVolumeMl === null, "'2 Lemonade' is not 2 litres");
    ok(deriveNetVolumeMl({ rawName: "10 x 20mg Gummies", sizes: [], packCount: null }).netVolumeMl === null, "a dose statement is not a volume");
    near(deriveNetVolumeMl({ rawName: "2 x 1 Liter", sizes: [], packCount: null }).netVolumeMl, 2000, "2 x 1 Liter is 2000 ml");
    near(deriveNetVolumeMl({ rawName: "3 \u00d7 250 ml", sizes: [], packCount: null }).netVolumeMl, 750, "unicode multiplication sign works");
  }

  // --- the oracle: does the derived volume actually cap the sale? --------
  {
    const REC_ML = 72 * 29.5735; // derived here, not imported, on purpose
    const cases: { name: string; sizes: SizeFact[]; packCount: number | null; legalUnits: number }[] = [
      { name: "Drink 4 x 50ml", sizes: [{ quantity: 50, unit: "ml" }], packCount: null, legalUnits: 10 },
      { name: "Cider 1L", sizes: [{ quantity: 1, unit: "l" }], packCount: null, legalUnits: 2 },
      { name: "Soda 6 Pack 12 fl oz", sizes: [{ quantity: 12, unit: "floz" }], packCount: 6, legalUnits: 1 },
      { name: "Shot 2 fl oz", sizes: [{ quantity: 2, unit: "floz" }], packCount: null, legalUnits: 36 },
    ];
    for (const c of cases) {
      const d = deriveNetVolumeMl({ rawName: c.name, sizes: c.sizes, packCount: c.packCount });
      ok(d.netVolumeMl !== null, `${c.name}: a volume was derived at all`);
      const allowed = Math.floor(REC_ML / (d.netVolumeMl as number));
      ok(allowed === c.legalUnits, `${c.name}: ${allowed} packages fit under 72 fl oz (want ${c.legalUnits})`);
    }
  }

  if (fail > 0) {
    throw new Error(`liquid-volume-derivation-core self-tests: ${fail} failed, ${pass} passed`);
  }
  console.log(`liquid-volume-derivation-core: ${pass} assertions passed`);
}
