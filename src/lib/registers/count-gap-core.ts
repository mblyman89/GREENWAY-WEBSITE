/**
 * src/lib/registers/count-gap-core.ts  (D216)
 *
 * Owner (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D216):
 *   "An employee this morning forgot to count their nickels and didn't
 *    realize. The system did warn her that the balance counted was wrong, but
 *    it did not tell her that there were no nickels entered into the box.
 *    Will you please protect the register from this in the future and help
 *    them out when they make a mistake like this."
 *
 * Production (2026-11-08): Sales Register 1 was counted in with 0 nickels and
 * 52 $1 bills. The old checks only looked at the TOTAL (float check) and, at
 * close, at "no coins at all", so a single empty box was never named.
 *
 * What lives here (PURE, no I/O):
 *   1. SALES_FLOAT_MIX: the owner's sales-register float, box by box
 *      (5 x $10, 10 x $5, 50 x $1, 40 quarters, 50 dimes, 40 nickels,
 *      50 pennies = $167.50; same figures as the accounting worked example).
 *   2. blankBoxes: every box left EMPTY that a drawer normally holds.
 *      - count-in: the boxes of the standard float (when the register uses
 *        the $167.50 float); otherwise the everyday boxes (pennies to $5).
 *      - close: the coin boxes and the $1 box (a drawer that started with 40
 *        nickels does not end the day with none, unless it really did).
 *   3. countGapHelp: the sentences for the screen, naming each empty box and,
 *      at count-in, the standard number for it. When the count-in is short by
 *      EXACTLY what the empty box(es) should hold, it says so ("short $2.00:
 *      exactly the 40 nickels a drawer starts with"). It also names boxes that
 *      are off the standard mix while the total matches (the 52 x $1 case).
 *
 * BLIND close: the close sentences never carry the expected figure, a gap or
 * the standard numbers; they only name the empty boxes.
 *
 * Never a hard block on its own: a drawer can really be out of nickels. The
 * screen asks to look again and needs "I counted again" ticked; the server
 * records the empty boxes and the confirmation in the audit for a manager.
 */
import { formatCents, DENOM_FIELDS, denomTotalMinor, type DenomCounts } from "./cash";

/** Owner's sales-register float, box by box. Sums to 16750 (self-tested). */
export const SALES_FLOAT_MIX: Readonly<DenomCounts> = Object.freeze({
  pennies: 50, nickels: 40, dimes: 50, quarters: 40, half_dollars: 0, dollar_coins: 0,
  ones: 50, twos: 0, fives: 10, tens: 5, twenties: 0, fifties: 0, hundreds: 0,
});
export const SALES_FLOAT_MINOR = 16750;

/** Boxes a drawer holds every day when its float mix is not known. */
export const EVERYDAY_OPEN_BOXES: readonly (keyof DenomCounts)[] = ["pennies", "nickels", "dimes", "quarters", "ones", "fives"];
/** Boxes a closing drawer still holds on a normal day (coins and $1s). */
export const CLOSE_BOXES: readonly (keyof DenomCounts)[] = ["pennies", "nickels", "dimes", "quarters", "ones"];

const CENTS: Record<keyof DenomCounts, number> = {
  pennies: 1, nickels: 5, dimes: 10, quarters: 25, half_dollars: 50, dollar_coins: 100,
  ones: 100, twos: 200, fives: 500, tens: 1000, twenties: 2000, fifties: 5000, hundreds: 10000,
};

/** Plain names, as an employee would say them. */
export const BOX_NAME: Record<keyof DenomCounts, string> = {
  pennies: "pennies (1\u00a2)",
  nickels: "nickels (5\u00a2)",
  dimes: "dimes (10\u00a2)",
  quarters: "quarters (25\u00a2)",
  half_dollars: "half dollars (50\u00a2)",
  dollar_coins: "$1 coins",
  ones: "$1 bills",
  twos: "$2 bills",
  fives: "$5 bills",
  tens: "$10 bills",
  twenties: "$20 bills",
  fifties: "$50 bills",
  hundreds: "$100 bills",
};

export type CountMode = "open" | "close";

/** The float mix to compare a count-in with, or null when it is not known. */
export function floatMixFor(standardFloatMinor: number | null | undefined): Readonly<DenomCounts> | null {
  return standardFloatMinor === SALES_FLOAT_MINOR ? SALES_FLOAT_MIX : null;
}

/**
 * Empty boxes a drawer normally holds. Nothing for a $0.00 count (the $0.00
 * close has its own confirm, D125; an open needs a count anyway).
 */
export function blankBoxes(d: DenomCounts, mode: CountMode, standardFloatMinor?: number | null): (keyof DenomCounts)[] {
  if (denomTotalMinor(d) <= 0) return [];
  const order = DENOM_FIELDS.map((f) => f.key).reverse(); // pennies first, as counted
  if (mode === "close") return order.filter((k) => CLOSE_BOXES.includes(k) && (d[k] ?? 0) === 0);
  const mix = floatMixFor(standardFloatMinor);
  if (mix) return order.filter((k) => mix[k] > 0 && (d[k] ?? 0) === 0);
  return order.filter((k) => EVERYDAY_OPEN_BOXES.includes(k) && (d[k] ?? 0) === 0);
}

export type CountGapHelp = {
  /** Empty boxes, pennies first. */
  blanks: (keyof DenomCounts)[];
  /** One sentence per empty box. */
  lines: string[];
  /** Count-in only: the short total is exactly what the empty boxes should hold. */
  explainsShort: string | null;
  /** Count-in only: boxes off the standard mix while the total still matches. */
  mixNote: string | null;
  /** True when the screen must ask "I counted again" before saving. */
  needsConfirm: boolean;
};

/** Everything the count screen shows about empty or off-mix boxes. */
export function countGapHelp(d: DenomCounts, mode: CountMode, standardFloatMinor?: number | null): CountGapHelp {
  const blanks = blankBoxes(d, mode, standardFloatMinor);
  const mix = mode === "open" ? floatMixFor(standardFloatMinor) : null;
  const lines = blanks.map((k) =>
    mix
      ? `The ${BOX_NAME[k]} box is empty. A drawer starts with ${mix[k]} ${BOX_NAME[k]} (${formatCents(mix[k] * CENTS[k])}). Count them and enter the number.`
      : `The ${BOX_NAME[k]} box is empty. Count the ${BOX_NAME[k]} and enter the number (leave it empty only if there really are none).`,
  );

  let explainsShort: string | null = null;
  let mixNote: string | null = null;
  if (mix) {
    const counted = denomTotalMinor(d);
    const shortBy = SALES_FLOAT_MINOR - counted;
    const blankValue = blanks.reduce((s, k) => s + mix[k] * CENTS[k], 0);
    if (blanks.length > 0 && shortBy > 0 && shortBy === blankValue) {
      const what = blanks.map((k) => `${mix[k]} ${BOX_NAME[k]}`).join(" and ");
      explainsShort = `The count is ${formatCents(shortBy)} short: exactly the ${what} a drawer starts with. Did you skip ${blanks.length === 1 ? "that box" : "those boxes"}?`;
    }
    if (counted === SALES_FLOAT_MINOR) {
      const off = DENOM_FIELDS.map((f) => f.key)
        .reverse()
        .filter((k) => (d[k] ?? 0) !== mix[k])
        .map((k) => `${BOX_NAME[k]} ${d[k] ?? 0} (normally ${mix[k]})`);
      if (off.length > 0) {
        mixNote = `The total matches, but the mix is off: ${off.join(", ")}. Check that each number went in the right box.`;
      }
    }
  }
  return { blanks, lines, explainsShort, mixNote, needsConfirm: blanks.length > 0 };
}

/** Short words for the audit (never money): "nickels, dimes". */
export function blankBoxWords(blanks: readonly (keyof DenomCounts)[]): string {
  return blanks.join(", ");
}

/**
 * The audit row the server writes when a saved count left a normal box empty
 * (drawer.count_blank_box). Null when nothing was empty. Box keys only, no
 * money, so it is safe on a blind close.
 */
export function countGapAudit(
  d: DenomCounts,
  mode: CountMode,
  standardFloatMinor: number | null | undefined,
  recountConfirmed: boolean,
): { mode: CountMode; blankBoxes: (keyof DenomCounts)[]; recountConfirmed: boolean } | null {
  const blanks = blankBoxes(d, mode, standardFloatMinor);
  if (blanks.length === 0) return null;
  return { mode, blankBoxes: blanks, recountConfirmed };
}

export const COUNT_BLANK_BOX_AUDIT = "drawer.count_blank_box";

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCountGapTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };
  const zero: DenomCounts = {
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: 0, twos: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
  };
  const std = { ...SALES_FLOAT_MIX } as DenomCounts;

  ok("float mix sums to $167.50", denomTotalMinor(std) === SALES_FLOAT_MINOR);
  ok("full standard count-in: nothing", (() => { const h = countGapHelp(std, "open", 16750); return h.blanks.length === 0 && !h.needsConfirm && h.mixNote === null && h.explainsShort === null; })());

  // The owner's case, first entry: no nickels, everything else standard.
  const noNickels = { ...std, nickels: 0 };
  const h1 = countGapHelp(noNickels, "open", 16750);
  ok("no nickels: nickels named", h1.blanks.length === 1 && h1.blanks[0] === "nickels");
  ok("no nickels: needs confirm", h1.needsConfirm);
  ok("no nickels: says 40 nickels ($2.00)", /40 nickels/.test(h1.lines[0]) && /\$2\.00/.test(h1.lines[0]));
  ok("no nickels: short explained", h1.explainsShort !== null && /\$2\.00 short/.test(h1.explainsShort) && /40 nickels/.test(h1.explainsShort));

  // What production saved: 0 nickels, 52 ones -> total matches, mix off.
  const saved = { ...std, nickels: 0, ones: 52 };
  const h2 = countGapHelp(saved, "open", 16750);
  ok("saved count: total matches", denomTotalMinor(saved) === SALES_FLOAT_MINOR);
  ok("saved count: still flags the empty nickel box", h2.blanks[0] === "nickels" && h2.needsConfirm);
  ok("saved count: mix note names nickels and $1s", h2.mixNote !== null && /nickels \(5\u00a2\) 0 \(normally 40\)/.test(h2.mixNote) && /\$1 bills 52 \(normally 50\)/.test(h2.mixNote));
  ok("saved count: no 'short' sentence when total matches", h2.explainsShort === null);

  // Two empty boxes, short by both.
  const two = { ...std, nickels: 0, pennies: 0 };
  const h3 = countGapHelp(two, "open", 16750);
  ok("two empty boxes, pennies first", h3.blanks.join(",") === "pennies,nickels");
  ok("two empty: short explained with both", h3.explainsShort !== null && /50 pennies/.test(h3.explainsShort) && /those boxes/.test(h3.explainsShort));
  // Short by something else: do not claim it.
  const other = { ...std, nickels: 0, ones: 49 };
  ok("short by more than the empty box: not 'exactly'", countGapHelp(other, "open", 16750).explainsShort === null);

  // Unknown float (manager till 300): everyday boxes, no standard numbers.
  const mgr = { ...zero, tens: 20, fives: 10, ones: 40, quarters: 40, dimes: 50, pennies: 50 };
  const h4 = countGapHelp(mgr, "open", 30000);
  ok("unknown float: nickels still named", h4.blanks.join(",") === "nickels");
  ok("unknown float: no standard number given", !/starts with/.test(h4.lines[0]) && h4.mixNote === null);
  ok("no float known at all: same everyday boxes", blankBoxes(mgr, "open", null).join(",") === "nickels");

  // Close (blind): coins and $1 only, no figures.
  const close = { ...zero, twenties: 40, tens: 3, fives: 6, ones: 30, quarters: 12, dimes: 40, pennies: 50 };
  const h5 = countGapHelp(close, "close");
  ok("close: empty nickels named", h5.blanks.join(",") === "nickels" && h5.needsConfirm);
  ok("close: never shows a figure", !/\$[\d,]+\.\d\d/.test(h5.lines.join(" ")) && h5.explainsShort === null && h5.mixNote === null);
  ok("close: tens/fives empty are not flagged", blankBoxes({ ...close, tens: 0, fives: 0 }, "close").join(",") === "nickels");
  ok("close: $1s empty flagged", blankBoxes({ ...close, nickels: 5, ones: 0 }, "close").join(",") === "ones");
  ok("$0 count: nothing (D125 handles it)", blankBoxes(zero, "close").length === 0 && blankBoxes(zero, "open", 16750).length === 0);
  ok("audit words are box keys, no money", blankBoxWords(["pennies", "nickels"]) === "pennies, nickels");
  ok("audit row: owner's count-in", (() => { const a = countGapAudit(saved, "open", 16750, true); return a !== null && a.blankBoxes.join(",") === "nickels" && a.recountConfirmed; })());
  ok("audit row: none for a full count", countGapAudit(std, "open", 16750, false) === null);

  return { passed, failed };
}
