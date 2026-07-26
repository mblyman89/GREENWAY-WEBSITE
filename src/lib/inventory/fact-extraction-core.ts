/**
 * src/lib/inventory/fact-extraction-core.ts  (PROGRAM 3 / SLICE 55)
 *
 * PURE extraction engine: the "word-by-word scientist" for Cultivera rows.
 *
 * Two stages (docs/data-governance.md, Rules 1.2 / 2.2 / 3.1):
 *
 *  1. `extractNameFacts(text)` — tokenizes a product name word by word and
 *     classifies every token: SKU code, ratio label, mg dose (attributed to a
 *     cannabinoid or not), pack count, package size, strain-type letter,
 *     cannabinoid mention, or plain word. Nothing is discarded; unclassified
 *     words are kept so callers can see exactly what was NOT understood.
 *
 *  2. `crossExamineRow(row)` — reconciles the name facts against the potency
 *     COLUMNS (Thc / Cbd — the Total column is KNOWN-INCONSISTENT per
 *     governance Rule 3.4 and is deliberately NOT trusted here). Every
 *     produced fact carries a source (where it came from) and a confidence:
 *       • "verified"      — corroborated by independent arithmetic
 *                           (name↔column, or name-internal ratio↔dose math)
 *       • "single-source" — stated once, nothing corroborates it → REVIEW
 *       • "conflict"      — two sources disagree → REVIEW
 *     Per Rule 3.1 nothing uncertain is ever auto-committed: `needsReview`
 *     is true whenever any fact is below "verified", with plain-English
 *     reasons for the back-office exception queue (SLICE 57).
 *
 * NEVER-GUESS boundaries:
 *   • The Total column is never used as evidence (known-inconsistent).
 *   • Percent-based types (flower, concentrates incl. RSO) stay in percent
 *     mode — no mg facts are invented for them.
 *   • A ratio split is accepted ONLY when the potency column confirms the
 *     resulting THC figure; otherwise the row goes to review.
 *   • Servings inferred purely from arithmetic (no pack count written in the
 *     name) are flagged for review even when the mg total is verified.
 *
 * No I/O, no React — registered in the pure self-test runner.
 */

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

export type Cannabinoid =
  | "THC" | "CBD" | "CBG" | "CBN" | "CBC" | "CBDA" | "THCA" | "THCV" | "CBDV";

/** Longest-first so THCA/THCV don't get eaten by THC, CBDA/CBDV by CBD. */
const CANNA = "THCV|THCA|THC|CBDV|CBDA|CBD|CBG|CBN|CBC";

/** Inventory types whose potency is dosed in milligrams (incl. topicals — SLICE 56 wires display). */
export const MG_FACT_TYPES = new Set(["Solid Edible", "Liquid Edible", "Tincture", "Topical Ointment"]);

export type FactSource = "name" | "column" | "name+column" | "name-internal";
export type FactConfidence = "verified" | "single-source" | "conflict";

export type Fact<T> = {
  value: T;
  source: FactSource;
  confidence: FactConfidence;
  /** Plain-English explanation of how the value was corroborated (or why not). */
  note: string | null;
};

export type NameFacts = {
  /** Leading vendor SKU code, e.g. "M-MT-400BAL" from "M-MT-400BAL - Moxey ...". */
  skuCode: string | null;
  /** Ratio label exactly as written: "3:1", "1:1:1", "CBD:CBC:CBG". */
  ratioLabel: string | null;
  /** Numeric ratio parts, e.g. [3, 1] — null for cannabinoid-list ratios. */
  ratioParts: number[] | null;
  /** Cannabinoid-list ratio members, e.g. ["CBD","CBC","CBG"] — null for numeric ratios. */
  ratioCannabinoids: Cannabinoid[] | null;
  /** "10 Pack" / "10pk" → 10; also the N of "N x Mmg". */
  packCount: number | null;
  /** Explicit "N x Mmg" statement (e.g. "10 x 20mg", "6 x 2.5mg") — the strongest name fact. */
  servingsTimesDose: { servings: number; mgPerServing: number } | null;
  /** Every mg figure in the name, attributed when a cannabinoid word follows it. */
  doses: { mg: number; cannabinoid: Cannabinoid | null }[];
  /** Slash-combined dose ("200mg THC/CBG") — a stated total across the listed members. */
  slashDose: { mg: number; members: Cannabinoid[] } | null;
  /** Package sizes written in the name, e.g. "1.7 oz" → { quantity: 1.7, unit: "oz" }. */
  sizes: { quantity: number; unit: "g" | "oz" | "floz" | "ml" }[];
  /** "(I)" / "(S)" / "(H)" markers. */
  strainType: "indica" | "sativa" | "hybrid" | null;
  /** Cannabinoids mentioned WITHOUT a dose (e.g. "CBN" in "Const HRG CBN 1:1:1"). */
  mentionedCannabinoids: Cannabinoid[];
  /** Words the tokenizer could not classify — the actual product wording. */
  words: string[];
};

// ---------------------------------------------------------------------------
// stage 1: tokenizer
// ---------------------------------------------------------------------------

const SKU_RE = /^\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s+-\s+/;
const STRAIN_LETTER_RE = /\(\s*([HIS])\s*\)/i;
const CANNA_RATIO_RE = new RegExp(`\\b(?:${CANNA})(?::(?:${CANNA}))+`, "gi");
const NUM_RATIO_RE = /\b(\d+(?::\d+)+)\b/g;
const SERVINGS_X_DOSE_RE = /\b(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*mg\b/g;
const SLASH_DOSE_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*mg\\s+((?:${CANNA})(?:\\s*/\\s*(?:${CANNA}))+)`, "gi");
const DOSE_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*mg\\s*(?:of\\s+)?(${CANNA})?\\b`, "gi");
const BARE_DOSE_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(${CANNA})\\b`, "gi");
const PACK_RE = /\b(\d+)\s*-?\s*(?:pack|pk)\b/gi;
const FLOZ_RE = /\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|fluid\s*ounces?|floz)\b/gi;
const OZ_RE = /\b(\d+(?:\.\d+)?)\s*(?:oz\b|ounces?\b)/gi;
const G_RE = /\b(\d+(?:\.\d+)?)\s*(?:g\b|grams?\b)/gi;
const ML_RE = /\b(\d+(?:\.\d+)?)\s*(?:ml\b|milliliters?\b)/gi;
const MENTION_RE = new RegExp(`\\b(${CANNA})\\b`, "gi");

/** Replace a matched span with spaces so later passes cannot re-read it. */
function mask(text: string, start: number, length: number): string {
  return text.slice(0, start) + " ".repeat(length) + text.slice(start + length);
}

function consumeAll(
  text: string,
  re: RegExp,
  onMatch: (m: RegExpExecArray) => void,
): string {
  re.lastIndex = 0;
  let out = text;
  let m: RegExpExecArray | null;
  // exec against the ORIGINAL text; masking preserves indices exactly.
  while ((m = re.exec(text)) !== null) {
    onMatch(m);
    out = mask(out, m.index, m[0].length);
  }
  return out;
}

export function extractNameFacts(rawText: string | null | undefined): NameFacts {
  const original = String(rawText ?? "").trim();
  const facts: NameFacts = {
    skuCode: null, ratioLabel: null, ratioParts: null, ratioCannabinoids: null,
    packCount: null, servingsTimesDose: null, doses: [], slashDose: null,
    sizes: [], strainType: null,
    mentionedCannabinoids: [], words: [],
  };
  if (!original) return facts;

  let text = original;

  // 1. leading SKU code ("M-MT-400BAL - Moxey ...")
  const sku = SKU_RE.exec(text);
  if (sku) {
    facts.skuCode = sku[1];
    text = mask(text, sku.index, sku[0].length);
  }

  // 2. strain-type letter markers "(I)" / "(S)" / "(H)"
  const letter = STRAIN_LETTER_RE.exec(text);
  if (letter) {
    const l = letter[1].toUpperCase();
    facts.strainType = l === "I" ? "indica" : l === "S" ? "sativa" : "hybrid";
    text = mask(text, letter.index, letter[0].length);
  }

  // 3. cannabinoid-list ratios ("CBD:CBC:CBG") — before bare mentions.
  text = consumeAll(text, CANNA_RATIO_RE, (m) => {
    if (facts.ratioLabel === null) {
      facts.ratioLabel = m[0].toUpperCase();
      facts.ratioCannabinoids = m[0].toUpperCase().split(":") as Cannabinoid[];
    }
  });

  // 4. numeric ratios ("3:1", "1:1:1")
  text = consumeAll(text, NUM_RATIO_RE, (m) => {
    if (facts.ratioLabel === null) {
      facts.ratioLabel = m[1];
      facts.ratioParts = m[1].split(":").map(Number);
    }
  });

  // 4b. "N x Mmg" — an explicit servings-times-dose statement ("10 x 20mg").
  text = consumeAll(text, SERVINGS_X_DOSE_RE, (m) => {
    if (facts.servingsTimesDose === null) {
      facts.servingsTimesDose = { servings: Number(m[1]), mgPerServing: Number(m[2]) };
      if (facts.packCount === null) facts.packCount = Number(m[1]);
    }
  });

  // 4c. slash-combined dose ("200mg THC/CBG") — a total across the members.
  text = consumeAll(text, SLASH_DOSE_RE, (m) => {
    if (facts.slashDose === null) {
      facts.slashDose = {
        mg: Number(m[1]),
        members: m[2].toUpperCase().split(/\s*\/\s*/) as Cannabinoid[],
      };
    }
  });

  // 5. mg doses, attributed when a cannabinoid follows ("300mg CBG", "400mg")
  text = consumeAll(text, DOSE_RE, (m) => {
    facts.doses.push({ mg: Number(m[1]), cannabinoid: (m[2]?.toUpperCase() as Cannabinoid) ?? null });
  });

  // 6. bare number + cannabinoid ("50 CBN", "1000 CBD" — Cultivera drops "mg")
  text = consumeAll(text, BARE_DOSE_RE, (m) => {
    facts.doses.push({ mg: Number(m[1]), cannabinoid: m[2].toUpperCase() as Cannabinoid });
  });

  // 7. pack count ("10 Pack", "10pk")
  text = consumeAll(text, PACK_RE, (m) => {
    if (facts.packCount === null) facts.packCount = Number(m[1]);
  });

  // 8. package sizes — fl oz before oz before g/ml so "1.7 fl oz" isn't read as oz.
  text = consumeAll(text, FLOZ_RE, (m) => facts.sizes.push({ quantity: Number(m[1]), unit: "floz" }));
  text = consumeAll(text, OZ_RE, (m) => facts.sizes.push({ quantity: Number(m[1]), unit: "oz" }));
  text = consumeAll(text, G_RE, (m) => facts.sizes.push({ quantity: Number(m[1]), unit: "g" }));
  text = consumeAll(text, ML_RE, (m) => facts.sizes.push({ quantity: Number(m[1]), unit: "ml" }));

  // 9. cannabinoids mentioned without a dose ("CBN" in "Const HRG CBN 1:1:1")
  text = consumeAll(text, MENTION_RE, (m) => {
    const c = m[1].toUpperCase() as Cannabinoid;
    if (!facts.mentionedCannabinoids.includes(c)) facts.mentionedCannabinoids.push(c);
  });

  // 10. everything left is honest product wording.
  facts.words = text.split(/[\s\-–—(),/+]+/).map((w) => w.trim()).filter((w) => w.length > 0);

  return facts;
}

// ---------------------------------------------------------------------------
// stage 2: cross-examiner
// ---------------------------------------------------------------------------

export type RowFacts = {
  productText: string;
  inventoryType: string;
  /** Thc potency column (semantics vary: per-serving mg, package mg, or garbage). */
  thcColumn: number | null;
  /** Cbd potency column (same caveat). */
  cbdColumn: number | null;
};

export type MinorFact = {
  cannabinoid: Cannabinoid;
  /** null when the cannabinoid is named but its mg cannot be determined without guessing. */
  mg: number | null;
  source: FactSource;
  confidence: FactConfidence;
  note: string | null;
};

export type CrossExamResult = {
  name: NameFacts;
  /** true for flower/concentrates — potency stays in percent, no mg facts produced. */
  percentMode: boolean;
  servingsPerPack: Fact<number> | null;
  mgPerServing: Fact<number> | null;
  packageThcMg: Fact<number> | null;
  packageCbdMg: Fact<number> | null;
  minorCannabinoids: MinorFact[];
  ratioLabel: Fact<string> | null;
  needsReview: boolean;
  reviewReasons: string[];
};

/** Tolerant equality: potency columns round (9.1 vs 10) — allow 10% or 1mg. */
function approx(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.1 * Math.max(Math.abs(a), Math.abs(b)));
}

function fact<T>(value: T, source: FactSource, confidence: FactConfidence, note: string | null): Fact<T> {
  return { value, source, confidence, note };
}

export function crossExamineRow(row: RowFacts): CrossExamResult {
  const name = extractNameFacts(row.productText);
  const result: CrossExamResult = {
    name,
    percentMode: !MG_FACT_TYPES.has(String(row.inventoryType ?? "").trim()),
    servingsPerPack: null, mgPerServing: null,
    packageThcMg: null, packageCbdMg: null,
    minorCannabinoids: [],
    ratioLabel: name.ratioLabel ? fact(name.ratioLabel, "name", "verified", null) : null,
    needsReview: false,
    reviewReasons: [],
  };

  // Flower / concentrates (incl. RSO) keep the existing percent pipeline.
  if (result.percentMode) return result;

  const flag = (reason: string) => {
    result.needsReview = true;
    if (!result.reviewReasons.includes(reason)) result.reviewReasons.push(reason);
  };

  const thcCol = row.thcColumn !== null && Number.isFinite(row.thcColumn) && row.thcColumn > 0 ? row.thcColumn : null;
  const cbdCol = row.cbdColumn !== null && Number.isFinite(row.cbdColumn) && row.cbdColumn > 0 ? row.cbdColumn : null;
  const pack = name.packCount;
  const attributed = name.doses.filter((d) => d.cannabinoid !== null) as { mg: number; cannabinoid: Cannabinoid }[];
  const unattributed = name.doses.filter((d) => d.cannabinoid === null);
  const attributedThc = attributed.find((d) => d.cannabinoid === "THC") ?? null;
  const nonThcDoses = attributed.filter((d) => d.cannabinoid !== "THC");

  /**
   * Confirms a candidate PACKAGE THC total against the Thc column.
   * `strict` (used for ratio-DERIVED candidates) disallows the implied-
   * servings path: inventing a serving count to make a derived number fit
   * would be a guess stacked on a guess (governance Rule 3.1).
   */
  const columnConfirms = (pkgThc: number, strict = false): { how: string; servings: number | null } | null => {
    if (thcCol === null) return null;
    if (approx(thcCol, pkgThc)) return { how: "the Thc column states the same package total", servings: null };
    if (pack !== null && approx(thcCol * pack, pkgThc)) {
      return { how: `the Thc column (${thcCol}mg per serving) times the ${pack}-pack equals the package total`, servings: pack };
    }
    if (strict) return null;
    if (thcCol < pkgThc) {
      // Implied-servings division must be NEAR-EXACT — a loose tolerance here
      // would let garbage columns (Moxey's 4.7 on a 100mg pack) "confirm"
      // anything via rounding (never-guess, governance Rule 3.1).
      const q = pkgThc / thcCol;
      const rq = Math.round(q);
      // When the name STATES a pack count, implied servings must agree with
      // it — otherwise a wrong candidate could be "confirmed" by inventing a
      // different serving count (never-guess, governance Rule 3.1).
      if (rq >= 2 && rq <= 200 && Math.abs(q - rq) <= 0.15 && (pack === null || rq === pack)) {
        return { how: `the Thc column reads as per-serving (${thcCol}mg), implying ${rq} servings`, servings: rq };
      }
    }
    return null;
  };

  const setThc = (pkgThc: number, source: FactSource, confidence: FactConfidence, note: string | null, servings: number | null, servingsStated: boolean) => {
    result.packageThcMg = fact(pkgThc, source, confidence, note);
    const effServings = pack ?? servings;
    if (effServings !== null && effServings > 0) {
      const stated = servingsStated || pack !== null;
      result.servingsPerPack = fact(
        effServings,
        stated ? "name" : "name+column",
        stated ? "verified" : "single-source",
        stated ? null : "pack count not written in the name; inferred from arithmetic — confirm",
      );
      if (!stated) flag("Pack count is not written in the product name; it was inferred from mg arithmetic and needs a human eye.");
      result.mgPerServing = fact(pkgThc / effServings, "name+column", confidence, null);
    }
  };

  const setMinor = (c: Cannabinoid, mg: number | null, source: FactSource, confidence: FactConfidence, note: string | null) => {
    if (c === "CBD") {
      if (mg !== null) result.packageCbdMg = fact(mg, source, confidence, note);
      return;
    }
    if (c === "THC") return;
    result.minorCannabinoids.push({ cannabinoid: c, mg, source, confidence, note });
  };

  // -------------------------------------------------------------------
  // Strategy 0 — explicit "N x Mmg" in the name (the strongest statement:
  // "Gummy - Rainbow - 10 x 10mg - 100mg THC", "Sungaze - 6 x 2.5mg - 15mg").
  // -------------------------------------------------------------------
  if (name.servingsTimesDose) {
    const { servings, mgPerServing } = name.servingsTimesDose;
    const total = servings * mgPerServing;

    // Which cannabinoid(s) does the per-serving dose cover?
    const totalIsThc = attributedThc !== null && approx(attributedThc.mg, total);
    const totalIsCombined = name.slashDose !== null && approx(name.slashDose.mg, total);
    const soleUnattributed = unattributed.length === 1 && attributed.length === 0 ? unattributed[0].mg : null;
    const totalRestated = soleUnattributed !== null && approx(soleUnattributed, total);

    if (totalIsThc) {
      // "10 x 10mg - 100mg THC": arithmetic + restated THC total agree.
      result.servingsPerPack = fact(servings, "name", "verified", "written as N x Mmg in the name");
      result.mgPerServing = fact(mgPerServing, "name", "verified", null);
      result.packageThcMg = fact(total, "name-internal", "verified",
        `${servings} x ${mgPerServing}mg equals the ${total}mg THC restated in the name`);
      if (thcCol !== null && !approx(thcCol, mgPerServing) && !approx(thcCol, total)) {
        flag(`The Thc column (${thcCol}) matches neither the ${mgPerServing}mg serving nor the ${total}mg package written in the name — confirm which is right.`);
      }
      return result;
    }

    if (totalIsCombined && name.slashDose) {
      // "10 x 20mg - 200mg THC/CBG" (+ ratio 1:1): split the combined total.
      const members = name.slashDose.members;
      const parts = name.ratioParts && name.ratioParts.length === members.length
        ? name.ratioParts
        : members.map(() => 1);
      const partsSum = parts.reduce((a, b) => a + b, 0);
      const thcIdx = members.indexOf("THC");
      if (thcIdx >= 0) {
        const thcPkg = (parts[thcIdx] / partsSum) * total;
        const colOk = thcCol !== null && (approx(thcCol, thcPkg / servings) || approx(thcCol, thcPkg));
        result.servingsPerPack = fact(servings, "name", "verified", "written as N x Mmg in the name");
        result.mgPerServing = fact(mgPerServing, "name", "verified", "combined per-serving dose across " + members.join("/"));
        result.packageThcMg = fact(thcPkg, colOk ? "name+column" : "name-internal", colOk ? "verified" : "single-source",
          colOk ? `the ${total}mg ${members.join("/")} splits ${parts.join(":")}; the Thc column confirms the THC share`
            : `the ${total}mg ${members.join("/")} splits ${parts.join(":")}, but the Thc column does not confirm the THC share`);
        for (const c of members) {
          if (c === "THC") continue;
          setMinor(c, (parts[members.indexOf(c)] / partsSum) * total, "name-internal",
            colOk ? "verified" : "single-source", `share of the ${total}mg ${members.join("/")} total`);
        }
        if (!colOk) flag(`The ${total}mg ${members.join("/")} split could not be confirmed by the Thc column — confirm the THC share.`);
        return result;
      }
    }

    if (totalRestated || name.doses.length === 0 || (soleUnattributed !== null && approx(soleUnattributed, total))) {
      // "6 x 2.5mg - 15mg" (restated, no cannabinoid named) or a bare "N x Mmg".
      const colOk = thcCol !== null && (approx(thcCol, mgPerServing) || approx(thcCol, total));
      result.servingsPerPack = fact(servings, "name", "verified", "written as N x Mmg in the name");
      result.mgPerServing = fact(mgPerServing, "name", colOk ? "verified" : "single-source", null);
      result.packageThcMg = fact(total, colOk ? "name+column" : "name", colOk ? "verified" : "single-source",
        colOk ? `${servings} x ${mgPerServing}mg; the Thc column confirms the figure`
          : `${servings} x ${mgPerServing}mg, but no cannabinoid is named and the Thc column does not confirm it`);
      if (!colOk) flag(`The name states ${servings} x ${mgPerServing}mg but never says WHICH cannabinoid, and the Thc column does not confirm it — confirm this is THC.`);
      return result;
    }
  }

  // -------------------------------------------------------------------
  // Strategy 1 — attributed THC dose in the name.
  // -------------------------------------------------------------------
  if (attributedThc) {
    const confirm = columnConfirms(attributedThc.mg);
    if (confirm) {
      setThc(attributedThc.mg, "name+column", "verified", confirm.how, confirm.servings, false);
    } else if (name.ratioParts && name.ratioParts.length >= 2 && nonThcDoses.length >= 1) {
      // name-internal check: do the written doses sit in the written ratio?
      const doses = [attributedThc.mg, ...nonThcDoses.map((d) => d.mg)].sort((a, b) => b - a);
      const parts = [...name.ratioParts].sort((a, b) => b - a);
      const scale = doses[0] / parts[0];
      const ratioAgrees = doses.length === parts.length && doses.every((d, i) => approx(d, parts[i] * scale));
      if (ratioAgrees) {
        setThc(attributedThc.mg, "name-internal", "verified", `the written ratio ${name.ratioLabel} matches the written doses exactly`, null, false);
      } else {
        setThc(attributedThc.mg, "name", "single-source", "no column or ratio corroborates this figure", null, false);
        flag(`The name says ${attributedThc.mg}mg THC but neither the potency columns nor the ratio confirm it.`);
      }
      if (thcCol !== null && !confirm) {
        flag(`The Thc column (${thcCol}) does not reconcile with the ${attributedThc.mg}mg THC written in the name — confirm which is right.`);
      }
    } else {
      setThc(attributedThc.mg, "name", "single-source", "stated once in the name; nothing corroborates it", null, false);
      flag(`The name says ${attributedThc.mg}mg THC but the potency columns are empty or don't reconcile — confirm the figure.`);
    }
    // Non-THC attributed doses: verified when the ratio corroborates them.
    for (const d of nonThcDoses) {
      let ok = false;
      if (name.ratioParts && result.packageThcMg && result.packageThcMg.confidence === "verified") {
        const parts = [...name.ratioParts].sort((a, b) => b - a);
        const scale = Math.max(attributedThc.mg, ...nonThcDoses.map((x) => x.mg)) / parts[0];
        ok = parts.some((p) => approx(p * scale, d.mg));
      }
      if (d.cannabinoid === "CBD" && cbdCol !== null && (approx(cbdCol, d.mg) || (pack !== null && approx(cbdCol * pack, d.mg)))) ok = true;
      setMinor(d.cannabinoid, d.mg, "name", ok ? "verified" : "single-source", ok ? "corroborated by the written ratio or the Cbd column" : "stated once in the name");
      if (!ok) flag(`The ${d.mg}mg ${d.cannabinoid} written in the name has no corroboration — confirm it.`);
    }
    return result;
  }

  // -------------------------------------------------------------------
  // Strategy 2 — ratio arithmetic (no attributed THC dose).
  // -------------------------------------------------------------------
  const soleMg = unattributed.length === 1 ? unattributed[0].mg
    : (unattributed.length === 0 && attributed.length === 1 ? attributed[0].mg : null);

  if (name.ratioParts && name.ratioParts.length >= 2) {
    const parts = name.ratioParts;
    const partsSum = parts.reduce((a, b) => a + b, 0);

    // 2a. scale assignment: a written dose is one ratio part; THC takes another.
    if (attributed.length >= 1) {
      for (const d of attributed) {
        for (const dosePart of [...new Set(parts)]) {
          const scale = d.mg / dosePart;
          for (const thcPart of [...new Set(parts)]) {
            const candidate = thcPart * scale;
            const confirm = columnConfirms(candidate, true);
            if (confirm) {
              setThc(candidate, "name+column", "verified",
                `ratio ${name.ratioLabel}: ${d.mg}mg ${d.cannabinoid} is one part and ${confirm.how}`, confirm.servings, false);
              for (const other of attributed) {
                setMinor(other.cannabinoid as Cannabinoid, other.mg, "name-internal", "verified", `fits the written ratio ${name.ratioLabel}`);
              }
              return result;
            }
          }
        }
      }
    }

    // 2b. combined-total split: the single mg figure is ALL cannabinoids combined.
    if (soleMg !== null) {
    const share = soleMg / partsSum;
    for (const thcPart of [...new Set(parts)]) {
      const candidate = thcPart * share;
      const confirm = columnConfirms(candidate, true);
      if (confirm) {
        setThc(candidate, "name+column", "verified",
          `the ${soleMg}mg reads as the combined total split ${name.ratioLabel}; ${confirm.how}`, confirm.servings, false);
        // Distribute remaining parts to the named cannabinoids when unambiguous.
        const others = parts.filter((_, i) => i !== parts.indexOf(thcPart));
        const named = [
          ...attributed.map((d) => d.cannabinoid as Cannabinoid),
          ...name.mentionedCannabinoids,
          ...(name.ratioCannabinoids ?? []),
        ].filter((c, i, arr) => c !== "THC" && arr.indexOf(c) === i);
        // One member short with equal parts? The Cbd COLUMN can supply the
        // missing member — but only when it independently states that exact
        // equal share (evidence, not a guess). Real case: "Const HRG CBN
        // 1:1:1 ... 300mg" names only CBN; Cbd column 9.1 x 10-pack ≈ 100.
        if (
          named.length === others.length - 1 &&
          !named.includes("CBD") &&
          others.every((p) => p === others[0]) &&
          cbdCol !== null
        ) {
          const equalShare = others[0] * share;
          if (approx(cbdCol, equalShare) || (pack !== null && approx(cbdCol * pack, equalShare))) {
            named.push("CBD");
          }
        }
        if (named.length === others.length && others.every((p) => p === others[0])) {
          for (const c of named) {
            let conf: FactConfidence = "verified";
            let note = `equal ${name.ratioLabel} split of the ${soleMg}mg combined total, THC share confirmed by the Thc column`;
            if (c === "CBD" && cbdCol !== null) {
              const cbdPkg = others[0] * share;
              if (!(approx(cbdCol, cbdPkg) || (pack !== null && approx(cbdCol * pack, cbdPkg)))) {
                conf = "conflict";
                note = `the Cbd column (${cbdCol}) does not match the ${cbdPkg}mg split`;
                flag(`The CBD share of the split (${cbdPkg}mg) conflicts with the Cbd column (${cbdCol}).`);
              }
            }
            setMinor(c, others[0] * share, "name-internal", conf, note);
          }
        } else if (named.length > 0) {
          for (const c of named) {
            setMinor(c, null, "name", "single-source", "named in the ratio but its exact mg cannot be determined without guessing");
          }
          flag(`The name splits ${soleMg}mg by ${name.ratioLabel} across ${named.join(", ")} but the individual amounts cannot be pinned down — confirm them.`);
        }
        return result;
      }
    }
    }
  }

  // -------------------------------------------------------------------
  // Strategy 3 — cannabinoid-list ratio (e.g. "CBD:CBC:CBG ... 400mg").
  // -------------------------------------------------------------------
  if (name.ratioCannabinoids && soleMg !== null && thcCol !== null && pack !== null) {
    const thcPkg = thcCol * pack;
    const remainder = soleMg - thcPkg;
    const others = name.ratioCannabinoids.filter((c) => c !== "THC");
    if (remainder > 0 && others.length > 0) {
      const share = remainder / others.length;
      let corroborated = false;
      if (others.includes("CBD") && cbdCol !== null && approx(cbdCol * pack, share)) corroborated = true;
      if (corroborated) {
        setThc(thcPkg, "name+column", "verified",
          `the ${soleMg}mg total minus the Thc-column THC (${thcPkg}mg) splits evenly across ${others.join("/")}; the CBD share matches the Cbd column`, pack, true);
        for (const c of others) {
          setMinor(c, share, "name+column", "verified", `equal share of the remaining ${remainder}mg, anchored by the Cbd column`);
        }
        return result;
      }
      setThc(thcPkg, "column", "single-source", "taken from the Thc column alone; the name total could not be fully reconciled", pack, true);
      for (const c of others) setMinor(c, null, "name", "single-source", "named in the ratio; exact mg unknown");
      flag(`The ${soleMg}mg total names ${others.join(", ")} but their individual amounts could not be confirmed — confirm the split.`);
      return result;
    }
  }

  // -------------------------------------------------------------------
  // Strategy 4 — sole unattributed mg figure, column corroborated.
  // -------------------------------------------------------------------
  if (soleMg !== null && !name.ratioParts && !name.ratioCannabinoids) {
    const confirm = columnConfirms(soleMg);
    if (confirm) {
      setThc(soleMg, "name+column", "verified", confirm.how, confirm.servings, false);
      return result;
    }
    setThc(soleMg, "name", "single-source", "a lone mg figure with no corroboration", null, false);
    flag(`The name carries ${soleMg}mg but nothing confirms whether it is THC, per-serving, or per-package — confirm.`);
    return result;
  }

  // -------------------------------------------------------------------
  // Strategy 5 — no usable mg facts in the name at all.
  // -------------------------------------------------------------------
  if (name.doses.length === 0) {
    if (thcCol !== null) {
      // WA caps adult-use edibles at 10 mg THC per serving (WAC 314-55; see
      // trade-samples-core.ts maxServingThc). A column above that cap can
      // ONLY be a package total — the law pins the semantics. The VALUE is
      // still single-source (nothing corroborates the number itself), so the
      // row goes to review, but the reviewer sees a sharper explanation.
      if (thcCol > 10.5 && thcCol <= 1000) {
        result.packageThcMg = fact(thcCol, "column", "single-source",
          `read as a package total — ${thcCol}mg exceeds WA's 10mg-per-serving cap, so it cannot be a per-serving figure`);
        if (pack !== null) {
          result.servingsPerPack = fact(pack, "name", "verified", "pack count written in the name");
          result.mgPerServing = fact(thcCol / pack, "name+column", "single-source", "package total divided by the written pack count");
        }
        flag(`Only the Thc column states the dose (${thcCol}mg, read as a package total per WA's 10mg serving cap); nothing else confirms the number — confirm it.`);
      } else {
        flag("The name carries no mg figures; only the potency columns speak, and their per-serving/per-package meaning cannot be confirmed — review needed.");
        result.packageThcMg = fact(thcCol, "column", "single-source", "column value with unknown per-serving/per-package semantics");
      }
    } else {
      flag("Neither the name nor the potency columns carry a usable THC figure — this row needs human data entry.");
    }
    return result;
  }

  // Multiple uncorroborated figures.
  flag("The name carries several mg figures that could not be reconciled with each other or the columns — review needed.");
  for (const d of name.doses) {
    if (d.cannabinoid !== null && d.cannabinoid !== "THC") setMinor(d.cannabinoid, d.mg, "name", "single-source", "unreconciled");
  }
  return result;
}

// ---------------------------------------------------------------------------
// self-tests — pinned on REAL rows from the owner's INVENTORIES.xlsx
// (Cultivera export, verified by direct read July 2026)
// ---------------------------------------------------------------------------

export function __runFactExtractionCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL fact-extraction-core: " + msg);
    passed += 1;
  };

  // ---- tokenizer -----------------------------------------------------
  const moxeyName = extractNameFacts("M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)");
  ok(moxeyName.skuCode === "M-MT-400BAL", "Moxey SKU");
  ok(moxeyName.ratioLabel === "3:1", "Moxey ratio label");
  ok(moxeyName.doses.length === 2 && moxeyName.doses[0].mg === 300 && moxeyName.doses[0].cannabinoid === "CBG", "Moxey CBG dose");
  ok(moxeyName.doses[1].mg === 100 && moxeyName.doses[1].cannabinoid === "THC", "Moxey THC dose");
  ok(moxeyName.words.includes("Moxey") && moxeyName.words.includes("Peppermints"), "Moxey words kept");

  const yuzuName = extractNameFacts("Const HRG EFCT 2:1:1 Yuzu Blackberry + Lemon Balm (50 CBN, 50mg CBD) 10 Pack (I)");
  ok(yuzuName.ratioLabel === "2:1:1", "Yuzu ratio");
  ok(yuzuName.packCount === 10, "Yuzu pack count");
  ok(yuzuName.strainType === "indica", "Yuzu (I) marker");
  ok(yuzuName.doses.some((d) => d.mg === 50 && d.cannabinoid === "CBN"), "Yuzu bare '50 CBN' dose");
  ok(yuzuName.doses.some((d) => d.mg === 50 && d.cannabinoid === "CBD"), "Yuzu '50mg CBD' dose");

  const cantinaName = extractNameFacts("Cantina Gummies - CBD:CBC:CBG Guava 10 Pack 400mg");
  ok(cantinaName.ratioLabel === "CBD:CBC:CBG", "Cantina cannabinoid ratio");
  ok(cantinaName.ratioCannabinoids?.join(",") === "CBD,CBC,CBG", "Cantina ratio members");
  ok(cantinaName.packCount === 10 && cantinaName.doses[0]?.mg === 400 && cantinaName.doses[0]?.cannabinoid === null, "Cantina 400mg unattributed");

  const acName = extractNameFacts("A.C. Topical Drops 4:1 - 1000mg THC 250mg CBN - 1.7 oz");
  ok(acName.ratioLabel === "4:1", "A.C. ratio");
  ok(acName.doses.some((d) => d.mg === 1000 && d.cannabinoid === "THC"), "A.C. THC dose");
  ok(acName.doses.some((d) => d.mg === 250 && d.cannabinoid === "CBN"), "A.C. CBN dose");
  ok(acName.sizes.some((s) => s.quantity === 1.7 && s.unit === "oz"), "A.C. 1.7 oz size");

  const kellyName = extractNameFacts("Kelly's Sweet Hash Edibles - Kellys - 10pk Cookie Dough - 100mg THC - Peanut Butter");
  ok(kellyName.packCount === 10, "Kelly's 10pk");
  ok(kellyName.doses.some((d) => d.mg === 100 && d.cannabinoid === "THC"), "Kelly's THC dose");

  const constName = extractNameFacts("Const HRG CBN 1:1:1 Blueberry 10 Pack 300mg");
  ok(constName.ratioLabel === "1:1:1" && constName.packCount === 10, "Const HRG ratio + pack");
  ok(constName.mentionedCannabinoids.includes("CBN"), "Const HRG CBN mention (no dose)");
  ok(constName.doses[0]?.mg === 300 && constName.doses[0]?.cannabinoid === null, "Const HRG 300mg unattributed");

  const cannasolName = extractNameFacts("CannaSol RSO Aliens on Moonshine 1g");
  ok(cannasolName.sizes.some((s) => s.quantity === 1 && s.unit === "g"), "CannaSol 1g size");
  ok(cannasolName.doses.length === 0, "CannaSol no mg doses");

  const flozName = extractNameFacts("Canna Cantina Shot - Dankchata - 100mg");
  ok(flozName.doses[0]?.mg === 100 && flozName.doses[0]?.cannabinoid === null, "Shot 100mg unattributed");

  // ---- cross-examiner (real potency columns) -------------------------

  // Moxey: Thc column 4.7 is garbage → ratio↔dose name-internal check wins, but review flags the column.
  const moxey = crossExamineRow({
    productText: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
    inventoryType: "Solid Edible", thcColumn: 4.7, cbdColumn: 0.37,
  });
  ok(moxey.packageThcMg?.value === 100 && moxey.packageThcMg?.confidence === "verified", "Moxey THC 100 verified via ratio");
  ok(moxey.packageThcMg?.source === "name-internal", "Moxey source name-internal");
  ok(moxey.minorCannabinoids.some((m) => m.cannabinoid === "CBG" && m.mg === 300 && m.confidence === "verified"), "Moxey CBG 300 verified");
  ok(moxey.needsReview === true, "Moxey flagged (Thc column 4.7 unexplained)");

  // Const HRG Blueberry: Thc column 10 per-serving, 10 pack, 300mg combined 1:1:1.
  const constHrg = crossExamineRow({
    productText: "Const HRG CBN 1:1:1 Blueberry 10 Pack 300mg",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 9.1,
  });
  ok(constHrg.packageThcMg?.value === 100 && constHrg.packageThcMg?.confidence === "verified", "Const HRG THC 100 verified");
  ok(constHrg.servingsPerPack?.value === 10 && constHrg.servingsPerPack?.confidence === "verified", "Const HRG servings 10");
  ok(constHrg.mgPerServing?.value === 10, "Const HRG 10mg per serving");
  ok(constHrg.minorCannabinoids.some((m) => m.cannabinoid === "CBN" && m.mg === 100), "Const HRG CBN 100");
  ok(constHrg.packageCbdMg?.value === 100, "Const HRG CBD 100 (Cbd column 9.1 within tolerance)");
  ok(constHrg.needsReview === false, "Const HRG fully reconciled");

  // Yuzu: doses 50 CBN + 50mg CBD as the "1" parts of 2:1:1 → THC 100, Thc column 10 x 10-pack.
  const yuzu = crossExamineRow({
    productText: "Const HRG EFCT 2:1:1 Yuzu Blackberry + Lemon Balm (50 CBN, 50mg CBD) 10 Pack (I)",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 6.8,
  });
  ok(yuzu.packageThcMg?.value === 100 && yuzu.packageThcMg?.confidence === "verified", "Yuzu THC 100 via scale assignment");
  ok(yuzu.servingsPerPack?.value === 10, "Yuzu servings 10");

  // Cantina: 400mg over THC + CBD:CBC:CBG, columns 10/10 per serving.
  const cantina = crossExamineRow({
    productText: "Cantina Gummies - CBD:CBC:CBG Guava 10 Pack 400mg",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 10,
  });
  ok(cantina.packageThcMg?.value === 100 && cantina.packageThcMg?.confidence === "verified", "Cantina THC 100 verified");
  ok(cantina.packageCbdMg?.value === 100, "Cantina CBD 100");
  ok(cantina.minorCannabinoids.some((m) => m.cannabinoid === "CBC" && m.mg === 100 && m.confidence === "verified"), "Cantina CBC 100");
  ok(cantina.minorCannabinoids.some((m) => m.cannabinoid === "CBG" && m.mg === 100 && m.confidence === "verified"), "Cantina CBG 100");
  ok(cantina.needsReview === false, "Cantina fully reconciled");

  // A.C. topical: Thc column 1000 matches the name exactly.
  const ac = crossExamineRow({
    productText: "A.C. Topical Drops 4:1 - 1000mg THC 250mg CBN - 1.7 oz",
    inventoryType: "Topical Ointment", thcColumn: 1000, cbdColumn: 12,
  });
  ok(ac.percentMode === false, "topicals are mg-mode in the engine");
  ok(ac.packageThcMg?.value === 1000 && ac.packageThcMg?.confidence === "verified", "A.C. THC 1000 verified by column");
  ok(ac.minorCannabinoids.some((m) => m.cannabinoid === "CBN" && m.mg === 250 && m.confidence === "verified"), "A.C. CBN 250 verified by ratio");
  ok(ac.needsReview === false, "A.C. fully reconciled");

  // Moonshot: "200mg CBG 1:1" reads as combined (100 THC + 100 CBG), Thc column 100 confirms.
  const moonshot = crossExamineRow({
    productText: "Const Moonshot Strawberry Kiwi 200mg CBG 1:1",
    inventoryType: "Liquid Edible", thcColumn: 100, cbdColumn: 0,
  });
  ok(moonshot.packageThcMg?.value === 100 && moonshot.packageThcMg?.confidence === "verified", "Moonshot THC 100 via combined split");
  ok(moonshot.minorCannabinoids.some((m) => m.cannabinoid === "CBG" && m.mg === 100), "Moonshot CBG 100");

  // Kelly's: potency columns are all ZERO → single-source, must go to review.
  const kelly = crossExamineRow({
    productText: "Kelly's Sweet Hash Edibles - Kellys - 10pk Cookie Dough - 100mg THC - Peanut Butter",
    inventoryType: "Solid Edible", thcColumn: 0, cbdColumn: 0,
  });
  ok(kelly.packageThcMg?.value === 100 && kelly.packageThcMg?.confidence === "single-source", "Kelly's THC single-source");
  ok(kelly.needsReview === true && kelly.reviewReasons.length > 0, "Kelly's goes to review");
  ok(kelly.servingsPerPack?.value === 10 && kelly.servingsPerPack?.confidence === "verified", "Kelly's pack count stated in name");

  // Journeyman: no pack count in the name; Thc column 10 reads per-serving → verified total, servings flagged.
  const journeyman = crossExamineRow({
    productText: "J-HR-100SBJ - Journeyman Hash Strawberry Jellies (100mg THC)",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 0,
  });
  ok(journeyman.packageThcMg?.value === 100 && journeyman.packageThcMg?.confidence === "verified", "Journeyman THC 100 verified");
  ok(journeyman.servingsPerPack?.value === 10 && journeyman.servingsPerPack?.confidence === "single-source", "Journeyman servings inferred");
  ok(journeyman.needsReview === true, "Journeyman inferred servings flagged for review");

  // "N x Mmg" tokenizer facts (real rows).
  const rainbowName = extractNameFacts("Gummy - Rainbow (Variety) - 10 x 10mg - 100mg THC");
  ok(rainbowName.servingsTimesDose?.servings === 10 && rainbowName.servingsTimesDose?.mgPerServing === 10, "Rainbow 10 x 10mg tokenized");
  const pogName = extractNameFacts("Gummy - POG 1:1 CBG - 10 x 20mg - 200mg THC/CBG");
  ok(pogName.slashDose?.mg === 200 && pogName.slashDose?.members.join(",") === "THC,CBG", "POG 200mg THC/CBG slash dose");
  ok(pogName.servingsTimesDose?.mgPerServing === 20, "POG 10 x 20mg");

  // Rainbow: 10 x 10mg = 100mg THC restated; Thc column 10 agrees → fully verified.
  const rainbow = crossExamineRow({
    productText: "Gummy - Rainbow (Variety) - 10 x 10mg - 100mg THC",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 0,
  });
  ok(rainbow.packageThcMg?.value === 100 && rainbow.packageThcMg?.confidence === "verified", "Rainbow THC 100 verified");
  ok(rainbow.servingsPerPack?.value === 10 && rainbow.servingsPerPack?.confidence === "verified", "Rainbow servings written in name");
  ok(rainbow.mgPerServing?.value === 10, "Rainbow 10mg per serving");
  ok(rainbow.needsReview === false, "Rainbow fully reconciled");

  // POG: 10 x 20mg = 200mg THC/CBG split 1:1 → 100mg THC, Thc column 10 per-serving confirms.
  const pog = crossExamineRow({
    productText: "Gummy - POG 1:1 CBG - 10 x 20mg - 200mg THC/CBG",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 0,
  });
  ok(pog.packageThcMg?.value === 100 && pog.packageThcMg?.confidence === "verified", "POG THC 100 via slash split");
  ok(pog.minorCannabinoids.some((m) => m.cannabinoid === "CBG" && m.mg === 100 && m.confidence === "verified"), "POG CBG 100");
  ok(pog.needsReview === false, "POG fully reconciled");

  // Sungaze: "6 x 2.5mg - 15mg" restated but NO cannabinoid named; Thc column 2.5 confirms per-serving.
  const sungaze = crossExamineRow({
    productText: "Sungaze Beverage - Lemon Ginger - 12oz - 6 x 2.5mg - 15mg",
    inventoryType: "Liquid Edible", thcColumn: 2.5, cbdColumn: 5,
  });
  ok(sungaze.packageThcMg?.value === 15 && sungaze.packageThcMg?.confidence === "verified", "Sungaze THC 15 verified");
  ok(sungaze.servingsPerPack?.value === 6 && sungaze.mgPerServing?.value === 2.5, "Sungaze 6 x 2.5mg");

  // Root Beer Float: NO mg in the name, Thc column 100 → above WA's 10mg
  // serving cap so it reads as a package total, but still single-source review.
  const rootBeer = crossExamineRow({
    productText: "A.C. Sugar-Free Root Beer Float Beverage",
    inventoryType: "Liquid Edible", thcColumn: 100, cbdColumn: 0,
  });
  ok(rootBeer.packageThcMg?.value === 100 && rootBeer.packageThcMg?.confidence === "single-source", "Root Beer THC 100 single-source");
  ok(rootBeer.packageThcMg?.note !== null && rootBeer.packageThcMg!.note!.includes("package total"), "Root Beer note explains package-total reading");
  ok(rootBeer.needsReview === true, "Root Beer goes to review");

  // Cantina Mandarin: no mg in name, Thc column 10 could be per-serving OR total → review, no cap help.
  const mandarin = crossExamineRow({
    productText: "Canna Cantina Gummies 10 Pack - Mandarin",
    inventoryType: "Solid Edible", thcColumn: 10, cbdColumn: 0,
  });
  ok(mandarin.packageThcMg?.confidence === "single-source" && mandarin.needsReview === true, "Mandarin ambiguous column goes to review");

  // CannaSol RSO: Concentrate for Inhalation stays percent-mode, no mg facts, no review.
  const rso = crossExamineRow({
    productText: "CannaSol RSO Aliens on Moonshine 1g",
    inventoryType: "Concentrate for Inhalation", thcColumn: 15.16, cbdColumn: 19.5,
  });
  ok(rso.percentMode === true && rso.packageThcMg === null && rso.needsReview === false, "RSO stays percent-mode");

  // Flower stays percent-mode too.
  const flower = crossExamineRow({
    productText: "A.C. Flower - Gelato Cake - 3.5g (I)",
    inventoryType: "Usable Marijuana", thcColumn: 24, cbdColumn: 0,
  });
  ok(flower.percentMode === true && flower.name.sizes.some((s) => s.quantity === 3.5 && s.unit === "g"), "flower percent-mode + 3.5g size");
  ok(flower.name.strainType === "indica", "flower (I) marker");

  console.log(`fact-extraction-core: ${passed} assertions passed`);
}
