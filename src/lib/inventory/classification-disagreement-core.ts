/**
 * src/lib/inventory/classification-disagreement-core.ts   (SLICE 18E)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ANSWERS
 *
 * The four compliance flags now live in two places: on `menu_items`, where the
 * register enforces them, and mirrored onto `inventory_lots`, where they record
 * what THIS lot's receiving paperwork said (migration 0219).
 *
 * Two copies can disagree. This module decides whether they do, and — when they
 * do — says so in a sentence a manager can act on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY SHOW IT AT ALL, GIVEN 18A DELIBERATELY HID THE LOT COLUMNS
 *
 * The lot detail page says, at page.tsx:157:
 *
 *     "We deliberately do NOT show lot.otherwise_taken here."
 *
 * That decision was right and it still stands. Its reason was specific: every
 * lot from the one-time Cultivera import carries NULL lot flags whether or not
 * a human had already classified the product, so displaying the lot column as
 * if it were the status would report settled work as unclassified and send the
 * owner to re-do it.
 *
 * This module does NOT reintroduce that. The STATUS still comes from the menu,
 * and a NULL lot value is explicitly NOT a disagreement — it is silence, and
 * silence is exactly what an un-mirrored historical lot has to say. What gets
 * surfaced is the one case 18A could not produce and 18E now can: the lot row
 * holds a REAL answer and it CONTRADICTS the menu.
 *
 * That case matters because the two answers come from different humans at
 * different times. The lot value is what the receiving paperwork said when the
 * product came through the door; the menu value is what the register is
 * enforcing right now. When they differ, one of two things is true:
 *
 *   - somebody corrected the classification after receiving (fine, expected —
 *     but the reader deserves to know the invoice says otherwise), or
 *   - the invoice contradicts what is being enforced, which is a compliance
 *     question somebody should look at.
 *
 * Reporting a disagreement AS a disagreement is the honest move. The
 * alternative — showing two numbers on one screen with no comment — makes the
 * reader adjudicate it themselves, and a second scoreboard nobody can
 * reconcile is worse than one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS NEVER DOES
 *
 * It never decides a limit, and it must never be wired into one. The doctrine
 * on the columns (0219) is:
 *
 *        ENFORCEMENT READS MENU. PROVENANCE READS LOT. NEVER THE REVERSE.
 *
 * So this returns display text and nothing else. A disagreement is information
 * for a human, never an input to the cart engine.
 *
 * PURE: no I/O, no Supabase, no clock.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The four flags, from either side of the mirror. */
export type ClassificationFlagSet = {
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
};

export type FlagDisagreement = {
  /** Which flag disagrees, as the human-facing question. */
  label: string;
  /** What the register is enforcing. */
  menu: string;
  /** What this lot's paperwork says. */
  lot: string;
};

export type DisagreementVerdict = {
  /** True when at least one flag holds a real, conflicting answer. */
  disagrees: boolean;
  /** One entry per disagreeing flag, in a stable, statute-ordered sequence. */
  items: FlagDisagreement[];
  /**
   * A sentence for the panel, or null when there is nothing to say. Written to
   * be actionable rather than alarming: a disagreement is usually a
   * correction, not a violation.
   */
  message: string | null;
};

/** Render a yes/no flag the way the form words it. */
function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

/** Render a number without inventing precision. */
function num(v: number): string {
  return String(v);
}

/**
 * Compare the enforced (menu) copy against the lot's provenance copy.
 *
 * NULL ON EITHER SIDE IS NEVER A DISAGREEMENT. This is the single rule that
 * keeps the panel quiet on the thousands of historical lots that were never
 * mirrored — and it is the rule that 18A's reasoning demands. "Nobody wrote it
 * down here" is not a contradiction of anything.
 */
export function assessClassificationDisagreement(input: {
  menu: ClassificationFlagSet | null;
  lot: ClassificationFlagSet | null;
}): DisagreementVerdict {
  const none: DisagreementVerdict = { disagrees: false, items: [], message: null };
  const { menu, lot } = input;
  if (!menu || !lot) return none;

  const items: FlagDisagreement[] = [];

  // Statute order: the ten-unit bucket first (it is the one with the inverted
  // fail-safe), then its divisor, then the low-THC pair.
  if (
    menu.otherwiseTaken !== null &&
    lot.otherwiseTaken !== null &&
    menu.otherwiseTaken !== lot.otherwiseTaken
  ) {
    items.push({
      label: "Taken otherwise into the body",
      menu: yesNo(menu.otherwiseTaken),
      lot: yesNo(lot.otherwiseTaken),
    });
  }
  if (
    menu.unitsPerPackage !== null &&
    lot.unitsPerPackage !== null &&
    menu.unitsPerPackage !== lot.unitsPerPackage
  ) {
    items.push({
      label: "Units per package",
      menu: num(menu.unitsPerPackage),
      lot: num(lot.unitsPerPackage),
    });
  }
  if (
    menu.lowThcLiquid !== null &&
    lot.lowThcLiquid !== null &&
    menu.lowThcLiquid !== lot.lowThcLiquid
  ) {
    items.push({
      label: "Low-THC beverage",
      menu: yesNo(menu.lowThcLiquid),
      lot: yesNo(lot.lowThcLiquid),
    });
  }
  if (menu.unitThcMg !== null && lot.unitThcMg !== null && menu.unitThcMg !== lot.unitThcMg) {
    items.push({
      label: "Active delta-9 THC per unit (mg)",
      menu: num(menu.unitThcMg),
      lot: num(lot.unitThcMg),
    });
  }

  if (items.length === 0) return none;

  return {
    disagrees: true,
    items,
    message:
      "This lot's receiving paperwork recorded a different answer from the one the register is " +
      "enforcing. That usually means somebody corrected the classification after the product " +
      "was received, which is fine — the register always uses the menu answer shown above. " +
      "If the paperwork is the one that's right, correct it here and the register will follow.",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runClassificationDisagreementTests(): { passed: number } {
  let failures = 0;
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      passed += 1;
    } else {
      failures += 1;
      console.error(`  CLASSIFICATION-DISAGREEMENT FAIL: ${msg}`);
    }
  };

  const empty: ClassificationFlagSet = {
    otherwiseTaken: null,
    unitsPerPackage: null,
    lowThcLiquid: null,
    unitThcMg: null,
  };

  // --- silence is never a disagreement (the 18A promise) -------------------
  {
    const v = assessClassificationDisagreement({ menu: empty, lot: empty });
    ok(!v.disagrees, "two silences do not disagree");
    ok(v.message === null, "nothing to say when nothing is known");
  }
  {
    // The historical case: menu classified, lot never mirrored.
    const v = assessClassificationDisagreement({
      menu: { ...empty, otherwiseTaken: true, unitsPerPackage: 6 },
      lot: empty,
    });
    ok(
      !v.disagrees,
      "an un-mirrored historical lot must NOT be reported as a disagreement",
    );
  }
  {
    // The reverse: lot has paperwork, menu not yet classified.
    const v = assessClassificationDisagreement({
      menu: empty,
      lot: { ...empty, otherwiseTaken: true },
    });
    ok(!v.disagrees, "a lot answer against menu silence is not a contradiction");
  }
  {
    const v = assessClassificationDisagreement({ menu: null, lot: empty });
    ok(!v.disagrees, "a missing menu row yields no verdict");
    const v2 = assessClassificationDisagreement({ menu: empty, lot: null });
    ok(!v2.disagrees, "a missing lot row yields no verdict");
  }

  // --- agreement is not a disagreement -------------------------------------
  {
    const same: ClassificationFlagSet = {
      otherwiseTaken: true,
      unitsPerPackage: 6,
      lowThcLiquid: false,
      unitThcMg: 2,
    };
    const v = assessClassificationDisagreement({ menu: same, lot: { ...same } });
    ok(!v.disagrees, "identical answers agree");
    ok(v.items.length === 0, "no items when everything matches");
  }

  // --- real contradictions, one per flag -----------------------------------
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, otherwiseTaken: false },
      lot: { ...empty, otherwiseTaken: true },
    });
    ok(v.disagrees, "true vs false is a disagreement");
    ok(v.items.length === 1, "exactly one flag disagrees");
    ok(v.items[0].label === "Taken otherwise into the body", "the flag is named");
    ok(v.items[0].menu === "No" && v.items[0].lot === "Yes", "both sides are reported");
    ok((v.message ?? "").length > 80, "the message is a usable sentence");
  }
  {
    // false vs true in the OTHER direction, so the test cannot pass by
    // accident of ordering.
    const v = assessClassificationDisagreement({
      menu: { ...empty, otherwiseTaken: true },
      lot: { ...empty, otherwiseTaken: false },
    });
    ok(v.items[0].menu === "Yes" && v.items[0].lot === "No", "direction is not swapped");
  }
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, unitsPerPackage: 6 },
      lot: { ...empty, unitsPerPackage: 1 },
    });
    ok(v.disagrees, "a different unit count is a disagreement");
    ok(v.items[0].menu === "6" && v.items[0].lot === "1", "counts are reported verbatim");
  }
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, lowThcLiquid: true },
      lot: { ...empty, lowThcLiquid: false },
    });
    ok(v.disagrees, "a low-THC contradiction is reported");
  }
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, unitThcMg: 2 },
      lot: { ...empty, unitThcMg: 4 },
    });
    ok(v.disagrees, "a per-unit mg contradiction is reported");
  }

  // --- several at once, in statute order -----------------------------------
  {
    const v = assessClassificationDisagreement({
      menu: { otherwiseTaken: true, unitsPerPackage: 6, lowThcLiquid: true, unitThcMg: 2 },
      lot: { otherwiseTaken: false, unitsPerPackage: 1, lowThcLiquid: false, unitThcMg: 4 },
    });
    ok(v.items.length === 4, "every disagreeing flag is listed");
    ok(
      v.items[0].label === "Taken otherwise into the body",
      "the ten-unit bucket is listed first (inverted fail-safe)",
    );
    ok(v.items[1].label === "Units per package", "its divisor comes second");
  }

  // --- 0 and false must not be mistaken for absent -------------------------
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, unitThcMg: 0 },
      lot: { ...empty, unitThcMg: 4 },
    });
    ok(v.disagrees, "a menu value of 0 is a value, not an absence");
    ok(v.items[0].menu === "0", "zero renders as zero");
  }
  {
    const v = assessClassificationDisagreement({
      menu: { ...empty, otherwiseTaken: false },
      lot: { ...empty, otherwiseTaken: false },
    });
    ok(!v.disagrees, "false equals false");
  }

  if (failures > 0) {
    throw new Error(`classification-disagreement-core: ${failures} failure(s)`);
  }
  return { passed };
}
