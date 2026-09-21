// Leafly Menu Integration API v2.0 — READING A POTENCY WITHOUT INVENTING ONE.
//
// ###########################################################################
// # WHY THIS FILE EXISTS                                                    #
// #                                                                         #
// # A full-menu push failed with 128 validation errors. Four of them, all   #
// # on one item, read:                                                      #
// #                                                                         #
// #   `content` is 1000 with unit "percent". A potency above 100% is        #
// #   impossible; this is almost always a mg value in a percent field.      #
// #                                                                         #
// # That message was right, and it was our own pre-flight validator         #
// # catching our own builder. The payload never reached Leafly.             #
// #                                                                         #
// # THE MECHANISM, reproduced rather than assumed:                          #
// #                                                                         #
// #   toCompound("thc", "1000mg", "Flower")                                 #
// #     -> { type: "thc", content: 1000, unit: "percent" }                  #
// #                                                                         #
// # The old parser did two things in sequence, each defensible alone and    #
// # catastrophic together:                                                  #
// #                                                                         #
// #   1. It chose the unit from the ITEM TYPE. Leafly's own matrix ties     #
// #      Flower/PreRoll/Concentrate/Cartridge to `percent` and Edible to    #
// #      `mg`, so this is correct as far as it goes.                        #
// #   2. It then stripped every non-digit from the source text:             #
// #        "1000mg".replace(/[^0-9.]/g, "") === "1000"                      #
// #                                                                         #
// # Step 2 throws away the single most important word in the string. The    #
// # source SAID milligrams. We deleted that, kept the bare number, and      #
// # stapled on the unit we expected to see. The result asserts that a       #
// # flower product is one thousand percent THC.                             #
// #                                                                         #
// # This is worse than a crash, because the number is well-formed. Had the  #
// # validator not existed, Leafly would have been told something absurd     #
// # about a real product on a real menu.                                    #
// #                                                                         #
// # THE RULE THIS MODULE ENFORCES                                           #
// #                                                                         #
// #   When the source text states a unit, that unit is EVIDENCE, not noise. #
// #   If it disagrees with the unit Leafly expects for this product type,   #
// #   we do not convert, we do not coerce, and above all we do not keep the #
// #   number and swap the label. We report the reading as UNKNOWN.          #
// #                                                                         #
// # WHY UNKNOWN, AND NOT A CONVERSION                                       #
// #                                                                         #
// # It is tempting to convert. mg -> percent needs the net weight of the    #
// # product, which we do not reliably have at this layer, and a percent     #
// # computed from a guessed weight is a fabricated lab result printed next  #
// # to a regulated product. That is not a rounding error; it is inventing   #
// # a compliance-relevant fact. We will not do it.                          #
// #                                                                         #
// # Leafly's specification sanctions the honest answer explicitly:          #
// #                                                                         #
// #   "If cannabinoid information is absent the value `null` should be      #
// #    submitted rather than `0`. Transmitting `0` results in a display of  #
// #    \"0mg\" to shoppers rather than the preferable \"unknown\"."          #
// #                                                                         #
// # So `null` is not a failure mode we invented to dodge the problem. It is #
// # the schema's own word for "we do not know", and it renders to shoppers  #
// # as "unknown" rather than as a false zero.                               #
// #                                                                         #
// # WHAT WE DO NOT DO: SILENTLY SWALLOW IT                                  #
// #                                                                         #
// # Turning a bad reading into `null` unblocks the push, and if that were   #
// # all we did we would have traded a loud failure for a quiet one. Every   #
// # refusal is therefore RECORDED with the product, the raw text, and the   #
// # reason, so the owner gets a worklist of exactly which products need a   #
// # human to look at them. A fix that hides the data problem is not a fix.  #
// ###########################################################################
//
// GROUND TRUTH
// ------------
// docs/leafly-specs/menu-integration-v2.openapi.json
//   - `info.description` -> "Cannabinoids: If cannabinoid information is absent
//     the value `null` should be submitted rather than `0`."
//   - the compound `unit` enum is exactly ["percent","mg"]
// src/lib/leafly/contract-core.ts -> LEAFLY_TYPE_UNIT_MATRIX, the type->unit tie
//
// PURITY
// ------
// Zero imports. No React, no DOM, no `server-only`, no I/O, no clock, no
// randomness. Every function here is a total function of its arguments, which
// is what lets the embedded self-tests run under plain `tsx` and what lets the
// mutation harness trust its own results.

/* -------------------------------------------------------------------------- */
/* What a source reading can turn out to be                                   */
/* -------------------------------------------------------------------------- */

/**
 * The unit a human actually wrote in the source text, as opposed to the unit
 * Leafly expects for the product type.
 *
 * `none` means the text carried a bare number with no unit at all ("22"). That
 * is not the same as a disagreement: a bare number is most naturally read in
 * whatever unit the product type uses, so it is allowed through. It IS still
 * range-checked afterwards, so a bare "1000" on a percent type is caught by the
 * impossible-value rule rather than by the unit rule.
 */
export type StatedUnit = "percent" | "mg" | "none";

/** What Leafly will accept in the `unit` field. Mirrors their enum exactly. */
export type PotencyUnit = "percent" | "mg";

/**
 * Why a reading was refused. Every value is a distinct, human-checkable cause,
 * because "invalid" on its own tells the owner nothing they can act on.
 */
export type PotencyRefusal =
  /** Text said mg, product type reports percent (or the reverse). */
  | "unit_mismatch"
  /** A percent reading above 100. Impossible, not merely unusual. */
  | "percent_above_100"
  /** Negative. */
  | "negative"
  /** Text present but no number could be found in it at all. */
  | "unreadable";

export type PotencyReading = {
  /** The number to send, or null for "unknown" (Leafly's sanctioned value). */
  content: number | null;
  /** The unit to send. Always the type's unit; never the stated one. */
  unit: PotencyUnit;
  /** Null when the reading was accepted. Set when we refused to trust it. */
  refusal: PotencyRefusal | null;
  /** The unit the source text actually claimed, for the owner's worklist. */
  stated: StatedUnit;
};

/* -------------------------------------------------------------------------- */
/* Reading the unit out of the text                                           */
/* -------------------------------------------------------------------------- */

/**
 * What unit does this text CLAIM?
 *
 * Deliberately conservative. We only report a unit when the text is
 * unambiguous, because a wrong reading here causes a silent data loss (we would
 * null out a perfectly good value). When in doubt we return "none" and let the
 * numeric range checks do the work.
 *
 * Handled, all verified by self-test rather than by eyeballing the regex:
 *   "22%", "22 %", "22percent", "22 pct"      -> percent
 *   "1000mg", "1000 MG", "1000 milligrams"    -> mg
 *   "22", "22.5", ""                          -> none
 *   "1000mg THC", "THC: 1000 mg"              -> mg   (unit anywhere in string)
 *
 * The "%" check runs FIRST and wins outright. A string containing both markers
 * is contradictory source data, and percent is the safer reading: it is the one
 * that gets range-checked against 100 immediately afterwards, so a contradictory
 * string cannot slip a huge number through as milligrams.
 */
export function statedUnitOf(raw: string): StatedUnit {
  const text = raw.toLowerCase();
  if (text.includes("%") || /\bp(?:ct|ercent)\b/.test(text) || text.includes("percent")) {
    return "percent";
  }
  // `mg` must not match the `mg` inside an unrelated word. Require that it is
  // not directly followed by another letter, so "mg" and "mgs" count but a word
  // like "mgx" does not. Also matches "milligram"/"milligrams".
  if (/\bmilligrams?\b/.test(text) || /\bmgs?\b/.test(text) || /\d\s*mgs?\b/.test(text)) {
    return "mg";
  }
  return "none";
}

/**
 * Pull the first number out of the text.
 *
 * Returns null when there is no number to find. Handles thousands separators
 * ("1,000") because a human typing a four-digit milligram value very often
 * writes the comma, and dropping the comma silently is how "1,000" would have
 * become 1000 by luck rather than by intent. Here it is deliberate.
 *
 * Only the FIRST number is taken. A string like "10mg per piece, 100mg total"
 * is genuinely ambiguous, and picking the first is at least predictable; the
 * range and unit checks still apply to whatever we picked.
 *
 * ON THE THOUSANDS REGEX, which a self-test caught being wrong:
 * the lookahead is `(?=\d{3}(?!\d))` — exactly three digits NOT followed by a
 * fourth — rather than `(?=\d{3}\b)`. The `\b` version looks equivalent and is
 * not: in "1,000mg" there is no word boundary between the final "0" and the
 * "m", because both are word characters. So "1,000mg" kept its comma, the
 * number parsed as 1, and a 1000mg edible would have been published as 1mg.
 * That is a silent tenfold-and-then-some understatement of a dose on a public
 * menu. The test that caught it is `"1,000mg" -> 1000`, and it is kept
 * alongside `"1,5" -> 1` so the fix cannot regress in either direction.
 */
export function firstNumberIn(raw: string): number | null {
  const cleaned = raw.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (match === null) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* The decision                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turn one raw source reading into something we are willing to put on a public
 * menu next to a regulated product.
 *
 * `expected` is the unit Leafly ties to this product type. It is ALWAYS the
 * unit we send, in every branch, including every refusal branch. That is not an
 * accident of the code: Leafly's schema requires `unit`, and the unit is a
 * property of the product type rather than of the individual reading. Sending
 * `{ content: null, unit: "percent" }` says "this flower's THC is unknown",
 * which is true and useful. Sending the stated unit instead would say "this
 * flower is measured in milligrams", which is a different and false claim.
 */
export function readPotency(
  raw: string | number | null | undefined,
  expected: PotencyUnit,
): PotencyReading {
  // Absent is absent. Not a refusal — there was nothing to refuse.
  if (raw == null) {
    return { content: null, unit: expected, refusal: null, stated: "none" };
  }

  const text = String(raw).trim();
  if (text.length === 0) {
    return { content: null, unit: expected, refusal: null, stated: "none" };
  }

  const stated = statedUnitOf(text);
  const value = firstNumberIn(text);

  // Text present, no number in it. "N/A", "pending", "see COA" all land here.
  if (value === null) {
    return { content: null, unit: expected, refusal: "unreadable", stated };
  }

  // THE CENTRAL RULE. The source stated a unit and it is not the one this
  // product type uses. Do not convert. Do not relabel. Report unknown.
  if (stated !== "none" && stated !== expected) {
    return { content: null, unit: expected, refusal: "unit_mismatch", stated };
  }

  if (value < 0) {
    return { content: null, unit: expected, refusal: "negative", stated };
  }

  // Impossible percentage. This catches the bare-number case that the unit rule
  // above deliberately lets through: "1000" with no unit on a Flower item is
  // still not a potency, whatever the typist meant by it.
  if (expected === "percent" && value > 100) {
    return { content: null, unit: expected, refusal: "percent_above_100", stated };
  }

  return { content: value, unit: expected, refusal: null, stated };
}

/* -------------------------------------------------------------------------- */
/* Telling the owner, in words                                                */
/* -------------------------------------------------------------------------- */

/**
 * One sentence explaining a refusal to somebody who does not read code.
 *
 * Returns null when there is nothing wrong, so a caller can map over every
 * reading and filter. A function that always produces a sentence trains the
 * reader to skip all of them.
 */
export function describePotencyRefusal(
  reading: PotencyReading,
  context: { productName?: string; raw?: string } = {},
): string | null {
  if (reading.refusal === null) return null;

  const who = context.productName ? `"${context.productName}"` : "This product";
  const said = context.raw ? ` (the saved value is "${context.raw}")` : "";
  const expectedWord = reading.unit === "percent" ? "a percentage" : "milligrams";

  switch (reading.refusal) {
    case "unit_mismatch": {
      const statedWord = reading.stated === "mg" ? "milligrams" : "a percentage";
      return (
        `${who} has its potency written in ${statedWord}${said}, but Leafly reports this ` +
        `kind of product in ${expectedWord}. Rather than guess at a conversion — which would ` +
        `mean inventing a lab result — the potency is being sent as "unknown". Correcting the ` +
        `saved value will put the real number back on the menu.`
      );
    }
    case "percent_above_100":
      return (
        `${who} has a potency above 100%${said}, which is not possible. This is almost always ` +
        `a milligram value typed into a percentage field. It is being sent as "unknown" until ` +
        `the saved value is corrected.`
      );
    case "negative":
      return `${who} has a negative potency${said}, which is not possible. It is being sent as "unknown".`;
    case "unreadable":
      return (
        `${who} has a potency field with no number in it${said}. It is being sent as "unknown", ` +
        `which is what Leafly asks for when a value has not been tested.`
      );
  }
}

/**
 * Group refusals into a short owner-facing summary.
 *
 * Takes already-built refusal records rather than doing the reading itself, so
 * the caller decides what a "product" is. Pure counting.
 */
export type PotencyRefusalRecord = {
  productId: string;
  productName: string;
  field: string;
  raw: string;
  refusal: PotencyRefusal;
  /**
   * The unit Leafly expects for this product's type, and the unit the saved
   * text actually claimed.
   *
   * These are carried on the record rather than recomputed by whoever renders
   * it, because recomputing means re-deciding, and a screen that re-decides is
   * a screen that can contradict the payload it is supposed to be explaining.
   * They are also exactly what turns "this reading was refused" into "it says
   * milligrams and Leafly wants a percentage", which is the difference between
   * a warning and an instruction.
   */
  expected: PotencyUnit;
  stated: StatedUnit;
};

/**
 * The owner-facing sentence for a collected refusal.
 *
 * `describePotencyRefusal` takes a live reading; this takes the stored record.
 * Both exist because the reading is available at build time and the record is
 * what survives to the screen, and forcing the UI to reconstruct a synthetic
 * reading in order to get a sentence is how the two drift apart. This delegates
 * so there is still only ONE set of words.
 */
export function describeRefusalRecord(record: PotencyRefusalRecord): string {
  const sentence = describePotencyRefusal(
    {
      content: null,
      unit: record.expected,
      refusal: record.refusal,
      stated: record.stated,
    },
    { productName: record.productName, raw: record.raw },
  );
  // Unreachable in practice: a record only exists when a refusal occurred, and
  // describePotencyRefusal returns null only for `refusal === null`. Handled
  // rather than asserted because a screen must never render "null".
  return sentence ?? `"${record.productName}" has a potency value that could not be used.`;
}

export type PotencySummary = {
  total: number;
  byReason: Record<PotencyRefusal, number>;
  /** Distinct products affected, which is what the owner actually has to fix. */
  productCount: number;
  /** A handful of concrete examples. Bounded so a log line stays readable. */
  examples: PotencyRefusalRecord[];
};

export const POTENCY_EXAMPLE_LIMIT = 5;

export function summarizePotencyRefusals(
  records: readonly PotencyRefusalRecord[],
): PotencySummary {
  const byReason: Record<PotencyRefusal, number> = {
    unit_mismatch: 0,
    percent_above_100: 0,
    negative: 0,
    unreadable: 0,
  };
  const products = new Set<string>();

  for (const r of records) {
    byReason[r.refusal] += 1;
    products.add(r.productId);
  }

  return {
    total: records.length,
    byReason,
    productCount: products.size,
    examples: records.slice(0, POTENCY_EXAMPLE_LIMIT),
  };
}

/** Headline sentence for the summary, or null when there is nothing to say. */
export function describePotencySummary(summary: PotencySummary): string | null {
  if (summary.total === 0) return null;
  const readings = summary.total === 1 ? "reading" : "readings";
  const products = summary.productCount === 1 ? "product" : "products";
  return (
    `${summary.total} potency ${readings} across ${summary.productCount} ${products} could not ` +
    `be trusted and are being sent to Leafly as "unknown". The menu is still publishing; these ` +
    `products just show no THC/CBD figure until the saved values are corrected.`
  );
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyPotencyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // ---- statedUnitOf ------------------------------------------------------
  ok("percent sign detected", statedUnitOf("22%") === "percent");
  ok("percent spaced", statedUnitOf("22 %") === "percent");
  ok("percent word", statedUnitOf("22 percent") === "percent");
  ok("pct abbreviation", statedUnitOf("22 pct") === "percent");
  ok("mg detected", statedUnitOf("1000mg") === "mg");
  ok("mg spaced", statedUnitOf("1000 mg") === "mg");
  ok("mg uppercase", statedUnitOf("1000MG") === "mg");
  ok("mgs plural", statedUnitOf("1000 mgs") === "mg");
  ok("milligrams word", statedUnitOf("1000 milligrams") === "mg");
  ok("milligram singular", statedUnitOf("1 milligram") === "mg");
  ok("bare number states nothing", statedUnitOf("22") === "none");
  ok("bare decimal states nothing", statedUnitOf("22.5") === "none");
  ok("empty states nothing", statedUnitOf("") === "none");
  ok("unit anywhere in string", statedUnitOf("THC: 1000 mg per package") === "mg");
  ok("percent wins a contradiction", statedUnitOf("22% (1000mg)") === "percent");

  // A word merely CONTAINING the letters mg must not be read as milligrams.
  ok("mgx is not mg", statedUnitOf("22 mgx") === "none");

  // ---- firstNumberIn -----------------------------------------------------
  ok("plain integer", firstNumberIn("1000") === 1000);
  ok("decimal", firstNumberIn("22.5") === 22.5);
  ok("number with unit", firstNumberIn("1000mg") === 1000);
  ok("thousands comma", firstNumberIn("1,000mg") === 1000);
  ok("comma not a decimal point", firstNumberIn("1,000") === 1000);
  ok("no number at all", firstNumberIn("not tested") === null);
  ok("empty has no number", firstNumberIn("") === null);
  ok("first of several", firstNumberIn("10mg per piece, 100mg total") === 10);
  ok("negative read as negative", firstNumberIn("-5") === -5);
  ok("leading text", firstNumberIn("THC 22.5%") === 22.5);
  // A comma that is NOT a thousands separator must be left alone rather than
  // silently deleted; "1,5" is not 15.
  ok("non-thousands comma not merged", firstNumberIn("1,5") === 1);

  // ---- readPotency: the bug that started this ---------------------------
  const theBug = readPotency("1000mg", "percent");
  ok("1000mg on a percent type is refused", theBug.content === null);
  ok("1000mg refusal is a unit mismatch", theBug.refusal === "unit_mismatch");
  ok("1000mg still reports the type's unit", theBug.unit === "percent");
  ok("1000mg records what the source said", theBug.stated === "mg");

  // The exact four paths from the owner's error message, all now safe.
  for (const raw of ["1000mg", "1000 mg", "1000MG", "1,000mg"]) {
    const r = readPotency(raw, "percent");
    ok(`"${raw}" never yields a percent above 100`, !(r.content !== null && r.content > 100));
  }

  // ---- readPotency: the normal, happy cases still work -------------------
  const normal = readPotency("22%", "percent");
  ok("22% accepted", normal.content === 22);
  ok("22% not refused", normal.refusal === null);
  ok("22% unit percent", normal.unit === "percent");

  const edible = readPotency("100mg", "mg");
  ok("100mg on an edible accepted", edible.content === 100);
  ok("100mg on an edible not refused", edible.refusal === null);
  ok("100mg on an edible unit mg", edible.unit === "mg");

  // A big milligram number on an mg type is entirely legitimate.
  const bigEdible = readPotency("1000mg", "mg");
  ok("1000mg on an edible is fine", bigEdible.content === 1000);
  ok("1000mg on an edible not refused", bigEdible.refusal === null);

  // ---- the mirror-image mistake -----------------------------------------
  const backwards = readPotency("22%", "mg");
  ok("percent on an mg type is refused", backwards.content === null);
  ok("percent on an mg type is a unit mismatch", backwards.refusal === "unit_mismatch");
  ok("percent on an mg type still sends mg", backwards.unit === "mg");

  // ---- bare numbers: allowed by the unit rule, caught by the range rule --
  const bare22 = readPotency("22", "percent");
  ok("bare 22 accepted on percent", bare22.content === 22 && bare22.refusal === null);

  const bare1000 = readPotency("1000", "percent");
  ok("bare 1000 refused on percent", bare1000.content === null);
  ok("bare 1000 refused for range not unit", bare1000.refusal === "percent_above_100");
  ok("bare 1000 stated nothing", bare1000.stated === "none");

  const bare1000mg = readPotency("1000", "mg");
  ok("bare 1000 accepted on mg", bare1000mg.content === 1000 && bare1000mg.refusal === null);

  // 100 exactly is possible; 100.01 is not. Boundary on both sides.
  ok("100 percent accepted", readPotency("100", "percent").content === 100);
  ok("100.01 percent refused", readPotency("100.01", "percent").content === null);
  ok(
    "100.01 percent refused for range",
    readPotency("100.01", "percent").refusal === "percent_above_100",
  );

  // ---- absent vs unreadable ---------------------------------------------
  ok("null is absent, not a refusal", readPotency(null, "percent").refusal === null);
  ok("null yields unknown", readPotency(null, "percent").content === null);
  ok("undefined is absent", readPotency(undefined, "percent").refusal === null);
  ok("empty string is absent", readPotency("", "percent").refusal === null);
  ok("whitespace is absent", readPotency("   ", "percent").refusal === null);
  ok("text with no number is unreadable", readPotency("not tested", "percent").refusal === "unreadable");
  ok("N/A is unreadable", readPotency("N/A", "percent").refusal === "unreadable");
  ok("unreadable still yields unknown", readPotency("pending", "percent").content === null);

  // ---- negatives ---------------------------------------------------------
  ok("negative refused", readPotency("-5", "percent").refusal === "negative");
  ok("negative yields unknown", readPotency("-5", "percent").content === null);
  ok("negative on mg refused", readPotency("-5", "mg").refusal === "negative");

  // ---- numeric input (not just strings) ---------------------------------
  ok("numeric 22 accepted on percent", readPotency(22, "percent").content === 22);
  ok("numeric 1000 refused on percent", readPotency(1000, "percent").content === null);
  ok("numeric 1000 accepted on mg", readPotency(1000, "mg").content === 1000);
  ok("numeric 0 accepted", readPotency(0, "percent").content === 0);

  // ---- THE INVARIANT THAT MATTERS ---------------------------------------
  // Whatever goes in, what comes out can never be an impossible percentage.
  // This is the property the validator was rejecting the whole menu over, so
  // it is asserted as a property across a wide input space rather than as a
  // handful of examples.
  const rawSamples = [
    "1000mg", "1000 mg", "1000", "100mg", "10mg", "22%", "22", "0", "-5",
    "not tested", "", "   ", "1,000mg", "99.9%", "100", "100.01", "150",
    "1000mg THC", "THC: 1,000 mg", "0.5%", "1 milligram", "N/A", "22 pct",
  ];
  let violations = 0;
  let unitDrift = 0;
  for (const raw of rawSamples) {
    for (const expected of ["percent", "mg"] as const) {
      const r = readPotency(raw, expected);
      if (expected === "percent" && r.content !== null && r.content > 100) violations += 1;
      if (r.content !== null && r.content < 0) violations += 1;
      // The unit we send is ALWAYS the type's unit, in every branch.
      if (r.unit !== expected) unitDrift += 1;
    }
  }
  ok("PROPERTY: no output is ever an impossible percent or negative", violations === 0);
  ok("PROPERTY: output unit always matches the product type", unitDrift === 0);

  // A refusal ALWAYS means content is null. If these two ever disagree we
  // would be sending a number we just declared untrustworthy.
  let refusalWithValue = 0;
  for (const raw of rawSamples) {
    for (const expected of ["percent", "mg"] as const) {
      const r = readPotency(raw, expected);
      if (r.refusal !== null && r.content !== null) refusalWithValue += 1;
    }
  }
  ok("PROPERTY: a refusal never carries a value", refusalWithValue === 0);

  // ---- describePotencyRefusal -------------------------------------------
  ok("no sentence when nothing is wrong", describePotencyRefusal(readPotency("22%", "percent")) === null);

  const mismatchText = describePotencyRefusal(readPotency("1000mg", "percent"), {
    productName: "Blue Dream",
    raw: "1000mg",
  });
  ok("mismatch sentence exists", mismatchText !== null);
  ok("mismatch names the product", (mismatchText ?? "").includes("Blue Dream"));
  ok("mismatch quotes the saved value", (mismatchText ?? "").includes("1000mg"));
  ok("mismatch says unknown", (mismatchText ?? "").includes("unknown"));
  ok("mismatch refuses to invent", (mismatchText ?? "").includes("inventing a lab result"));
  ok("mismatch names milligrams", (mismatchText ?? "").includes("milligrams"));

  const overText = describePotencyRefusal(readPotency("150", "percent"), { productName: "X" });
  ok("over-100 sentence exists", overText !== null);
  ok("over-100 says not possible", (overText ?? "").includes("not possible"));

  const negText = describePotencyRefusal(readPotency("-5", "percent"));
  ok("negative sentence exists", negText !== null);
  ok("negative falls back to generic subject", (negText ?? "").startsWith("This product"));

  const unreadText = describePotencyRefusal(readPotency("N/A", "percent"));
  ok("unreadable sentence exists", unreadText !== null);
  ok("unreadable mentions not tested", (unreadText ?? "").includes("not been tested"));

  // Every refusal reason must produce a sentence. A new reason added without a
  // sentence would otherwise fall through and say nothing at all.
  const allReasons: PotencyRefusal[] = [
    "unit_mismatch",
    "percent_above_100",
    "negative",
    "unreadable",
  ];
  let missingSentence = 0;
  for (const reason of allReasons) {
    const fake: PotencyReading = {
      content: null,
      unit: "percent",
      refusal: reason,
      stated: "none",
    };
    if (describePotencyRefusal(fake) === null) missingSentence += 1;
  }
  ok("PROPERTY: every refusal reason has a sentence", missingSentence === 0);

  // ---- summarize ---------------------------------------------------------
  const rec = (
    productId: string,
    refusal: PotencyRefusal,
  ): PotencyRefusalRecord => ({
    productId,
    productName: `P-${productId}`,
    field: "thc",
    raw: "1000mg",
    refusal,
    expected: "percent",
    stated: "mg",
  });

  const empty = summarizePotencyRefusals([]);
  ok("empty summary total 0", empty.total === 0);
  ok("empty summary no products", empty.productCount === 0);
  ok("empty summary no examples", empty.examples.length === 0);
  ok("empty summary says nothing", describePotencySummary(empty) === null);

  const many = summarizePotencyRefusals([
    rec("a", "unit_mismatch"),
    rec("a", "unit_mismatch"),
    rec("b", "percent_above_100"),
    rec("c", "unreadable"),
    rec("c", "negative"),
  ]);
  ok("summary counts readings", many.total === 5);
  ok("summary counts DISTINCT products", many.productCount === 3);
  ok("summary counts mismatches", many.byReason.unit_mismatch === 2);
  ok("summary counts over-100", many.byReason.percent_above_100 === 1);
  ok("summary counts unreadable", many.byReason.unreadable === 1);
  ok("summary counts negative", many.byReason.negative === 1);

  const manyText = describePotencySummary(many);
  ok("summary sentence exists", manyText !== null);
  ok("summary quotes reading count", (manyText ?? "").includes("5 potency readings"));
  ok("summary quotes product count", (manyText ?? "").includes("3 products"));
  ok("summary reassures menu still publishes", (manyText ?? "").includes("still publishing"));

  // Singular grammar, because "1 potency readings across 1 products" reads as
  // sloppiness and sloppiness is how people stop trusting a tool.
  const one = summarizePotencyRefusals([rec("a", "unit_mismatch")]);
  const oneText = describePotencySummary(one) ?? "";
  ok("singular reading", oneText.includes("1 potency reading across"));
  ok("singular product", oneText.includes("1 product "));
  ok("singular not pluralised", !oneText.includes("readings"));

  // Examples are bounded.
  const lots = summarizePotencyRefusals(
    Array.from({ length: 50 }, (_, i) => rec(`p${i}`, "unit_mismatch")),
  );
  ok("examples bounded", lots.examples.length === POTENCY_EXAMPLE_LIMIT);
  ok("total not bounded", lots.total === 50);
  ok("product count not bounded", lots.productCount === 50);

  // ---- describeRefusalRecord --------------------------------------------
  //
  // This is what the admin screen actually renders, so it is tested against
  // the same standard as the payload: it must name the product, quote the
  // saved text, and never be empty or say "null". The last of those is not
  // paranoia -- the function delegates to one that legitimately returns null,
  // and the fallback branch is otherwise unreachable and therefore untested.
  const mismatchRecord: PotencyRefusalRecord = {
    productId: "p1",
    productName: "Blue Dream 1g",
    field: "thc",
    raw: "1000mg",
    refusal: "unit_mismatch",
    expected: "percent",
    stated: "mg",
  };
  const recordText = describeRefusalRecord(mismatchRecord);
  ok("record sentence names the product", recordText.includes("Blue Dream 1g"));
  ok("record sentence quotes the saved value", recordText.includes("1000mg"));
  ok("record sentence names the stated unit", recordText.includes("milligrams"));
  ok("record sentence names the expected unit", recordText.includes("percentage"));
  ok("record sentence never says null", !recordText.toLowerCase().includes("null"));
  ok("record sentence is a real sentence", recordText.length > 40);

  // The SAME record must produce the SAME words as the live reading it came
  // from. If these two ever diverge, the screen is explaining a decision the
  // payload did not make.
  const liveEquivalent = describePotencyRefusal(
    { content: null, unit: "percent", refusal: "unit_mismatch", stated: "mg" },
    { productName: "Blue Dream 1g", raw: "1000mg" },
  );
  ok("record and reading agree word for word", recordText === liveEquivalent);

  // Every reason must survive the record path, not just the one we happened
  // to hit in the field.
  for (const reason of [
    "unit_mismatch",
    "percent_above_100",
    "negative",
    "unreadable",
  ] as const) {
    const text = describeRefusalRecord({ ...mismatchRecord, refusal: reason });
    ok(`record sentence exists for ${reason}`, text.length > 20);
    ok(`record sentence for ${reason} names the product`, text.includes("Blue Dream 1g"));
    ok(`record sentence for ${reason} is not the fallback`, !text.includes("could not be used."));
  }

  // An mg-expected type must be described in mg terms, not percent terms.
  // Reversing `expected` in the record would otherwise go unnoticed because
  // the common case in the field is percent.
  const mgRecord = describeRefusalRecord({
    ...mismatchRecord,
    expected: "mg",
    stated: "percent",
    raw: "22%",
  });
  ok("mg-expected record says milligrams", mgRecord.includes("milligrams"));
  ok("mg-expected record quotes its own value", mgRecord.includes("22%"));
  ok("mg-expected record differs from percent-expected", mgRecord !== recordText);

  return { passed, failed };
}
