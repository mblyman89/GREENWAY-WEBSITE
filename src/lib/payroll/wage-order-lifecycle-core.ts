/**
 * src/lib/payroll/wage-order-lifecycle-core.ts   (books-40b)
 *
 * WHICH LIFECYCLE BUTTONS ARE LAWFUL FOR AN ORDER IN A GIVEN STATE.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Let's finish the garnishments and child support feature now"
 *
 * The books-38 gap report found three working, tested server actions -
 * `terminateWageOrderAction`, `suspendWageOrderAction`, `resumeWageOrderAction`
 * - with no caller anywhere in the application. The books-40 report printed the
 * count as a table: created 2, terminated 0, suspended 0, resumed 0. This slice
 * closes that gap, and this module is the part of it that can be tested without
 * a browser or a database.
 *
 * WHY THE DECISION LIVES HERE AND NOT IN THE COMPONENT
 *
 * "Which buttons may this order show?" is a legal question wearing a user
 * interface costume. Get it wrong in the permissive direction and you offer a
 * Resume button on an order that was RELEASED - and resuming a released order
 * takes money out of an employee's pay for a payee who is no longer entitled to
 * it. That is a conversion of wages, and it is worse than failing to withhold,
 * because the money has already gone.
 *
 * A rule that important does not belong inside JSX where the only way to test
 * it is to render it. It belongs in a pure function with no imports, which is
 * what this is. `wage-order-lifecycle-mentor-gates.ts` then proves the screen
 * actually asks this function rather than re-deciding for itself.
 *
 * THE SERVER STILL DECIDES. This module makes the SCREEN honest - it does not
 * make the screen an authority. Every transition is independently guarded in
 * `wage-order-write-store.ts` against the CURRENT database status
 * (`.in("status", ["active","suspended"])` for ending, `.eq("status","active")`
 * for pausing, `.eq("status","suspended")` for resuming). If this file were
 * wrong, or if the page were stale because somebody in another tab already
 * ended the order, the database still refuses. Hiding a button is a courtesy;
 * the guard is the control.
 *
 * WHY THERE IS NO DELETE, AND NEVER WILL BE
 *
 * There is no fourth option in this file and there is no code path anywhere in
 * the garnishment feature that deletes a wage order. A garnishment record is
 * the evidence that Greenway did what a court told it to do. Under
 * RCW 26.18.110(6) an employer who fails to withhold can be made to pay the
 * support debt itself, and the only defence is the record. Deleting the record
 * destroys the defence. Ending an order keeps every cent of history and adds
 * the reason it stopped, which is what answers the question if anybody ever
 * asks. `tests/compliance/wage-order-lifecycle.test.ts` asserts that no delete
 * exists, so this paragraph is checkable rather than aspirational.
 *
 * NO IMPORTS ON PURPOSE
 *
 * This module is imported by a `"use client"` component. The client bundle
 * purity gate (`tests/compliance/client-bundle-purity.test.ts`) fails the build
 * if a client component's import graph reaches `node:fs` or `server-only`, and
 * `wage-order-write-store.ts` begins with `import "server-only"`. So the shared
 * constant `MIN_TERMINATION_NOTE_CHARS` is DEFINED here, in the pure module,
 * and the server store imports it from here. The dependency points from the
 * node-only file to the pure one, never the other way.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE VOCABULARY, TAKEN FROM THE DATABASE RATHER THAN INVENTED
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The three states a wage order can be in.
 *
 * These are not names chosen here. They are the exact three values permitted by
 * migration 0198:
 *
 *     status text not null default 'active'
 *       check (status in ('active','suspended','terminated'))
 *
 * `tests/compliance/wage-order-lifecycle.test.ts` re-reads that CHECK constraint
 * off the migration and asserts this union matches it, so if a fourth state is
 * ever added to the database this file goes red instead of silently treating
 * the new value as unrecognised (standing rule 62d: never invent a default).
 */
export type WageOrderLifecycleStatus = "active" | "suspended" | "terminated";

/** The three statuses, as data, for tests and for exhaustive iteration. */
export const WAGE_ORDER_LIFECYCLE_STATUSES: readonly WageOrderLifecycleStatus[] = [
  "active",
  "suspended",
  "terminated",
];

/**
 * Read a raw database string as a status, or admit it is unrecognised.
 *
 * Returns `null` rather than falling back to "active". The fallback would be
 * the dangerous direction: an unrecognised status treated as active would offer
 * an End button and a Pause button on a row nobody understands. `null` makes
 * the screen say "this order is in a state this screen does not recognise" and
 * offer nothing, which is the safe direction to be wrong in.
 */
export function readLifecycleStatus(raw: string): WageOrderLifecycleStatus | null {
  const trimmed = raw.trim();
  return (WAGE_ORDER_LIFECYCLE_STATUSES as readonly string[]).includes(trimmed)
    ? (trimmed as WageOrderLifecycleStatus)
    : null;
}

/**
 * The three things a person can do to a live order.
 *
 * Named for what Michael would say out loud, not for the database verb. He ends
 * an order; the column says "terminated". He pauses one; the column says
 * "suspended". The mapping is stated once, here, so the screen never has to
 * translate.
 */
export type LifecycleActionKey = "end" | "pause" | "resume";

/** Which database status each action moves the order INTO. */
export const LIFECYCLE_TARGET_STATUS: Readonly<Record<LifecycleActionKey, WageOrderLifecycleStatus>> =
  {
    end: "terminated",
    pause: "suspended",
    resume: "active",
  };

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHAT A BUTTON IS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One offered action, with everything the screen needs to render it honestly.
 *
 * The interesting fields are the last three. A button that says "End" and
 * nothing else is a trap: the person clicking it does not know whether it is
 * reversible, whether the money already withheld is affected, or whether they
 * are about to destroy something. So every option carries:
 *
 *   `whatHappens`  - the consequence, in one sentence, before the click.
 *   `reversible`   - whether this can be undone, stated as a fact not implied.
 *   `beforeYouClick` - the single check worth doing first.
 */
export type LifecycleOption = {
  readonly key: LifecycleActionKey;
  /** The word on the button. */
  readonly label: string;
  /**
   * The house Button variant. Only three are used, and the choice is meaning
   * rather than decoration: `danger` for the irreversible one, `neutral` for
   * the quiet reversible one, `confirm` for putting something back into effect.
   */
  readonly variant: "danger" | "neutral" | "confirm";
  /** Heading for the confirmation panel this action opens. */
  readonly confirmTitle: string;
  readonly whatHappens: string;
  readonly reversible: boolean;
  readonly beforeYouClick: string;
  /** True only for `end`, which the database will not accept without a note. */
  readonly requiresReason: boolean;
};

/**
 * ENDING AN ORDER.
 *
 * `danger` red, because it is the only one of the three that cannot be undone
 * through this screen. Note carefully what "cannot be undone" means here: it
 * does NOT mean the record is destroyed. The record is permanent. It means
 * withholding cannot be restarted under this order - a new order has to be
 * entered - and that asymmetry is deliberate, for the reason in `resume`.
 */
const END_OPTION: LifecycleOption = {
  key: "end",
  label: "End this order",
  variant: "danger",
  confirmTitle: "End this order permanently",
  whatHappens:
    "Withholding stops. No future pay run will calculate anything for this order. The order " +
    "and every cent already withheld under it stay on file permanently - ending an order " +
    "records why it stopped, it does not erase anything.",
  reversible: false,
  beforeYouClick:
    "Have the paper that ended it in front of you - the release, the satisfaction of judgment, " +
    "the registry's letter, or the date the writ expired - because you are about to type what " +
    "it says and that sentence is the entire answer if anybody asks later.",
  requiresReason: true,
};

/**
 * PAUSING AN ORDER.
 *
 * `neutral` rather than `danger`, because it is reversible - but the wording is
 * deliberately discouraging. Pausing is the weaker tool and it is the wrong one
 * far more often than it is the right one. The honest use is narrow: the
 * employee is on unpaid leave, or the issuing authority has told you in writing
 * to hold. Everything else is an ending.
 */
const PAUSE_OPTION: LifecycleOption = {
  key: "pause",
  label: "Pause it",
  variant: "neutral",
  confirmTitle: "Pause withholding without ending the order",
  whatHappens:
    "Withholding stops for now and the order stays live. It drops off the active board and " +
    "moves to the paused list, where it will sit until somebody resumes it.",
  reversible: true,
  beforeYouClick:
    "Check that this is really a pause. If the order has been RELEASED, end it with the reason " +
    "instead - a paused order is easy to forget, and a support order that is paused when it " +
    "should not be is an under-withholding Greenway can be made to pay for personally.",
  requiresReason: false,
};

/**
 * RESUMING AN ORDER.
 *
 * `confirm` green, and offered ONLY from paused. There is no path from ended
 * back to active anywhere in this system, by design and not by omission.
 *
 * Also note what resuming does not do: it does not go back and collect the
 * periods that were missed. Catching up missed withholding changes somebody's
 * take-home pay retroactively, and that is a decision that comes from the
 * issuing authority in writing and gets entered as arrears. It is not something
 * a green button should do silently.
 */
const RESUME_OPTION: LifecycleOption = {
  key: "resume",
  label: "Resume it",
  variant: "confirm",
  confirmTitle: "Put this order back into effect",
  whatHappens:
    "The order goes back on the active board and the next pay run will withhold against it " +
    "again. Nothing is collected for the periods it was paused - resuming does not catch up.",
  reversible: true,
  beforeYouClick:
    "If the issuing authority wants the missed periods collected, that has to come from them in " +
    "writing and it is entered as arrears on the order. Do not try to make up the gap by " +
    "resuming and hoping.",
  requiresReason: false,
};

/** Every option, keyed, for tests and for lookup. */
export const LIFECYCLE_OPTIONS: Readonly<Record<LifecycleActionKey, LifecycleOption>> = {
  end: END_OPTION,
  pause: PAUSE_OPTION,
  resume: RESUME_OPTION,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE DECISION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which actions are lawful for an order in this state.
 *
 * THE TABLE, AND THE REASON FOR EVERY CELL:
 *
 *   active     -> end, pause    A live order can be stopped either way.
 *   suspended  -> end, resume   A paused order can be restarted or finished.
 *                               It cannot be paused again; it already is.
 *   terminated -> (nothing)     An ended order is finished. Not resumable, not
 *                               pausable, and not deletable.
 *   unknown    -> (nothing)     Offer no action on a row nobody understands.
 *
 * The order within each list matters for the screen: the reversible option is
 * listed first and the irreversible one last, so the red button is never the
 * one nearest the thumb.
 *
 * Mirrors `wage-order-write-store.ts` exactly. That mirroring is not left to
 * good intentions - the gate re-reads the store's PostgREST status filters and
 * asserts they agree with this table, so the two cannot drift.
 */
export function lifecycleOptionsFor(
  status: WageOrderLifecycleStatus | null,
): readonly LifecycleOption[] {
  switch (status) {
    case "active":
      return [PAUSE_OPTION, END_OPTION];
    case "suspended":
      return [RESUME_OPTION, END_OPTION];
    case "terminated":
      return [];
    default:
      // `null` - a status the database produced that this screen does not know.
      return [];
  }
}

/**
 * Why an order is showing no buttons, in words, so a blank row is never a
 * mystery.
 *
 * A screen that simply renders nothing has told Michael nothing. Standing rule
 * 64a: detection is not explanation. If there are no actions, the screen says
 * which of the two reasons applies.
 */
export function noActionsExplanation(status: WageOrderLifecycleStatus | null): string | null {
  if (status === "terminated") {
    return (
      "This order has been ended, so there is nothing further to do to it. It cannot be " +
      "resumed - deliberately. Restarting withholding under an order that was released would " +
      "take money from the employee for a payee no longer entitled to it. If withholding has " +
      "to start again, that means new paperwork arrived, and the new paperwork is entered as " +
      "a new order. The record stays here permanently either way."
    );
  }
  if (status === null) {
    return (
      "This order is recorded in a state this screen does not recognise, so no action is " +
      "offered on it. Nothing is broken about the money - it simply is not safe to offer an " +
      "End or a Pause button when it is not clear what the order is currently doing. Send this " +
      "case number to the developer."
    );
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE REASON FOR ENDING, CHECKED BEFORE IT IS SENT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The shortest reason that is actually a reason.
 *
 * DEFINED HERE rather than in the write store, and the write store imports it
 * from this file. Three separate places enforce the same number and they are
 * not redundant - they fail at different moments to different audiences:
 *
 *   1. THIS FILE, in the browser, before anything is sent. Instant, and it can
 *      explain itself at length.
 *   2. `wage-order-write-store.ts`, on the server, because a browser check is
 *      not a control - anyone can call a server action directly.
 *   3. Migration 0198's `wage_orders_terminated_has_note` CHECK, which is the
 *      actual guarantee:
 *
 *          check (status <> 'terminated'
 *                 or (termination_note is not null
 *                     and length(btrim(termination_note)) >= 5))
 *
 * The gate asserts all three read the same number from the same constant, so a
 * change in one cannot leave the others behind.
 */
export const MIN_TERMINATION_NOTE_CHARS = 5;

/** A refusal to end an order, with the fix. Never a bare boolean (rule 48). */
export type TerminationReasonRefusal = {
  readonly code: "REASON_TOO_SHORT";
  readonly message: string;
  readonly fix: string;
};

export type TerminationReasonCheck =
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly refusal: TerminationReasonRefusal };

/**
 * Is this a reason, or is it a keystroke?
 *
 * Trims first, so five spaces is not a reason. Beyond that it does NOT try to
 * judge the content - there is no word list, no "must mention a date", no
 * cleverness. A rule that guesses at whether prose is meaningful would refuse
 * real reasons, and a person blocked by a machine that will not say what it
 * wants types "xxxxx" and moves on. That outcome is worse than a short reason,
 * because it puts a lie in the permanent record.
 *
 * So the check is the database's check and nothing more, and the persuasion is
 * done by the examples in the message rather than by refusing harder.
 */
export function validateTerminationReason(raw: string): TerminationReasonCheck {
  const reason = raw.trim();
  if (reason.length < MIN_TERMINATION_NOTE_CHARS) {
    return {
      ok: false,
      refusal: {
        code: "REASON_TOO_SHORT",
        message:
          "Ending an order needs a written reason of at least a few words, so nothing has been " +
          "changed and withholding continues exactly as it was. That is the safe direction to " +
          "fail in: money withheld under a released order can be given back, money not withheld " +
          "under a live one can land on Greenway.",
        fix:
          "Write what actually happened, in the words you would use out loud - 'released by the " +
          "registry 2026-04-02', 'balance paid in full', 'writ expired 60 days after service', " +
          "'employee no longer employed'. If the court or the employee asks in two years why " +
          "withholding stopped, this sentence is the entire answer.",
      },
    };
  }
  return { ok: true, reason };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE THING THAT IS NOT HERE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Stated as a value so a test can assert on it, not merely as a comment.
 *
 * Standing rule 66: an owner document makes checkable claims. The owner report
 * for this slice tells Michael, in as many words, that nothing in this system
 * can delete a wage order. This constant is the sentence, and
 * `tests/compliance/wage-order-lifecycle.test.ts` proves it by grepping the
 * whole garnishment feature for a delete path and finding none.
 */
export const WAGE_ORDER_NEVER_DELETED =
  "A wage order is never deleted. There is no delete button, no delete action and no delete " +
  "query anywhere in this feature. The record of a court order and everything withheld under " +
  "it is the proof that Greenway did what it was told to do, and under RCW 26.18.110(6) an " +
  "employer who cannot prove that can be made to pay the support debt itself. Ending an order " +
  "keeps all of it and adds the reason it stopped.";
