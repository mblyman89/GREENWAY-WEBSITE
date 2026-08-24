/**
 * src/lib/ui/screen-tone-core.ts   (books-46, slice A)
 *
 * THE ONE TONE VOCABULARY THE BOOKS SCREENS SPEAK.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND WHY IT WAS WRITTEN IN THE MIDDLE OF A W-2 SLICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Slice A needed a tone type for the W-2 screen. Four identical ones already
 * existed:
 *
 *   `PayRunTone`    src/lib/payroll/pay-run-ui-core.ts
 *   `Form941Tone`   src/lib/payroll/form-941-ui-core.ts
 *   `WaQuarterTone` src/lib/payroll/wa-quarterly-ui-core.ts
 *   `FsTone`        src/lib/accounting/financial-statements-ui-core.ts
 *
 * Same five members, same order, four names, four files, no import between any
 * of them. Declaring a fifth would have been the cheapest thing to do and would
 * have made the problem worse by exactly one, which is standing rule 25 (extend,
 * never duplicate) and standing rule 23 (fix the class, then USE the fixed
 * thing) both being ignored in a single stroke.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THE MEASUREMENT ACTUALLY FOUND, AND WHY IT IS BIGGER THAN RECORDED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `docs/BOOKS_ROADMAP.md` item R2 records sixteen duplicate type definitions,
 * found by scanning for THE SAME NAME declared in two files. That scan cannot
 * see this case, because these four have four DIFFERENT names. Re-measuring by
 * NORMALISED BODY instead of by name - whitespace collapsed and union members
 * sorted, so member order is not mistaken for a difference - found
 * **35 duplicated bodies across 48 redundant declarations**, of which R2's
 * sixteen are a subset.
 *
 * The distinction matters because the two kinds fail differently. Two copies of
 * `AccountType` (R2's dangerous case) disagree when somebody adds a member to
 * one. Two DIFFERENTLY-NAMED copies of the same union are worse in one specific
 * way: nothing will ever flag them, because there is no name collision to
 * notice, and a reader has no reason to suspect that `FsTone` and `Form941Tone`
 * are the same idea.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * It does not touch the other 31 duplicated bodies. The roadmap is explicit
 * that R2 "needs its owning module chosen and the other call sites repointed,
 * which is a slice, not a footnote", and half-doing it here would leave the
 * codebase in a state nobody planned. This file fixes exactly the one class
 * slice A had to touch anyway, and the measurement is recorded so the remaining
 * work is sized rather than rediscovered.
 *
 * It is also NOT `BadgeTone`. `BadgeTone`, in `@/components/admin/ui/Badge`,
 * carries a sixth member (`outline`) and lives in a React component file. Two
 * reasons not to reuse it: a pure `*-ui-core.ts` must not import from a
 * component (that is the rule that keeps these modules testable), and a screen
 * that can legally set a tone to `outline` has a tone the tone-to-meaning
 * functions do not answer for. The pages map `ScreenTone -> BadgeTone` at the
 * edge, which is a widening and therefore always safe.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FIVE MEMBERS, AND WHY GOLD IS THE LOAD-BEARING ONE
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   green   - correct, and nothing needs attention.
 *   gold    - CORRECT, and wants attention. Nothing is wrong.
 *   orange  - correct, and close to a deadline or carrying money owed.
 *   danger  - cannot proceed, or the deadline has passed.
 *   neutral - a figure with no verdict attached to it.
 *
 * Gold exists because a state that is RIGHT but wants attention has to look
 * different from a state that is WRONG. If they share a colour, Michael learns
 * to treat both the same way, and the day the colour means something he has
 * already stopped reading it. Every screen in the books area made this choice
 * independently and identically, which is the clearest possible argument that
 * it belongs in one place.
 *
 * This module is PURE: no React, no `node:fs`, no database, no `server-only`.
 * It is a type and two total functions over it.
 */

/**
 * The tone vocabulary. Five members, no more.
 *
 * Deliberately NOT extensible by convenience. A sixth tone would need a meaning
 * that none of these five already carries, and `toneMeaning` below would have
 * to answer for it - which is the check that stops a palette becoming decoration.
 */
export type ScreenTone = "green" | "gold" | "orange" | "danger" | "neutral";

/**
 * Every tone, in escalation order.
 *
 * Exported as DATA so a test can walk the whole vocabulary without hand-typing
 * it. A coverage test that lists the members itself is testing its own copy of
 * the list (standing rule 43).
 */
export const ALL_SCREEN_TONES: readonly ScreenTone[] = [
  "neutral",
  "green",
  "gold",
  "orange",
  "danger",
];

/**
 * How alarming a tone is, as a number, so screens can sort or pick the worst.
 *
 * `neutral` is 0 rather than being ranked between green and gold, because it is
 * not a verdict at all - it is the absence of one. Ranking it inside the scale
 * would make "no opinion" sortable as though it were mild approval.
 */
export function toneSeverity(tone: ScreenTone): number {
  switch (tone) {
    case "neutral":
      return 0;
    case "green":
      return 1;
    case "gold":
      return 2;
    case "orange":
      return 3;
    case "danger":
      return 4;
  }
}

/**
 * The worst tone in a list, or `neutral` for an empty list.
 *
 * WHY AN EMPTY LIST IS `neutral` AND NOT `green`. An empty list means nothing
 * was assessed. Returning green would report "all clear" for a screen that
 * checked nothing, which is standing rule 39 - a check that inspects nothing
 * approves everything - rendered in colour.
 */
export function worstTone(tones: readonly ScreenTone[]): ScreenTone {
  let worst: ScreenTone = "neutral";
  for (const t of tones) {
    if (toneSeverity(t) > toneSeverity(worst)) worst = t;
  }
  return worst;
}

/**
 * What a tone MEANS, in words, for the legend on a screen.
 *
 * A colour key that only shows swatches teaches nothing. This is the sentence
 * that makes gold usable - it has to say "nothing is wrong" out loud, because
 * the reader's instinct on any warm colour is that something is.
 */
export function toneMeaning(tone: ScreenTone): string {
  switch (tone) {
    case "green":
      return "Correct, and nothing needs your attention.";
    case "gold":
      return (
        "Correct, and worth a look. Nothing is wrong - gold never means a mistake. It means a " +
        "deadline is approaching or a figure is unusual enough to be worth reading twice."
      );
    case "orange":
      return (
        "Correct, and close to something. Either a deadline is within a week or there is money " +
        "owed that needs arranging. Still not a mistake."
      );
    case "danger":
      return (
        "This cannot go forward as it stands, or a deadline has already passed. Red is the only " +
        "colour on these screens that means something is actually wrong."
      );
    case "neutral":
      return "A figure with no verdict attached to it. Shown for reference.";
  }
}
