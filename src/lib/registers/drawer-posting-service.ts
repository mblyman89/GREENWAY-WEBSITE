import "server-only";

/**
 * src/lib/registers/drawer-posting-service.ts
 *
 * books-94 / D-39 — the door books-93 deliberately left shut.
 *
 * books-93 answered Michael's four questions and built the entries, but ended
 * with an honest admission in its own header: "nothing calls `submitJournal`
 * with them yet: closing a shift still does not post." This file is that call.
 *
 * ── WHY RECONCILE AND NOT CLOSE ─────────────────────────────────────────────
 * A drawer is counted BLIND. `closeDrawerBlind` stores what the cashier counted
 * and deliberately does not reveal what was expected, so at close time the
 * over/short is genuinely unknown — not hidden, unknown. Posting there would
 * mean either inventing a shortage or posting an entry that has to be amended
 * moments later. `reconcileDrawer` is where the manager supplies the cash
 * sales, `expectedClose` becomes computable, and over/short becomes a fact.
 * That is the first honest moment to write to the ledger, so that is where the
 * post happens.
 *
 * ── WHY TIPS ARE NOT SWEPT ──────────────────────────────────────────────────
 * `drawer_sessions.tips_minor` is the cashier's own money. Migration 0134 says
 * so in the column comment, and the tip jar is counted separately from the
 * drawer, so the blind drawer count never contains it. This service therefore
 * never adds tips to the cash going to the safe: doing so would move an
 * employee's money into 10400 and then into the company's bank, which is both
 * an overstatement of company cash and somebody's wages going missing. A test
 * pins this, because it is the kind of mistake that balances perfectly.
 *
 * ── THE CHAIN, LINK BY LINK (rule 133b) ─────────────────────────────────────
 *   manager reconciles a drawer on /admin/registers
 *     -> app/admin/registers/actions.ts#reconcileDrawerAction
 *     -> store.ts#reconcileDrawer            (writes over_short, status)
 *     -> THIS FILE #postDrawerCloseForSession
 *     -> register-cash-journal-core.ts#buildTillCloseJournal   (books-93)
 *     -> posting-service.ts#submitJournal -> gl_submit_journal -> POSTED
 *     -> outcome returned to the action and shown in the redirect banner
 *
 * ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
 * The source ref is `till-close:<sessionId>`. Not the register and not the
 * business day: a register can legitimately be closed and reopened twice in one
 * day (a shift change, or a drawer pulled for a recount), and a
 * register-plus-date ref would silently merge two real closes into one and lose
 * a whole shift's cash — the exact shape of D-24. The session id is the only
 * identifier that is one-to-one with the event being posted.
 *
 * ── DELIBERATE LIMIT (rule 133f) ────────────────────────────────────────────
 * This posts the CLOSE only. Opening a till from the vault
 * (`buildTillOpenJournal`) still has no poster, because `openDrawer` records a
 * float without recording whether that cash came out of the vault or simply
 * stayed in the drawer overnight — and books-93 established those are different
 * answers. Guessing which one happened is exactly what rule 1 forbids. That
 * half of D-39 stays open and is stated as such in the census.
 */
import { submitJournal } from "@/lib/accounting/posting-service";
import {
  buildTillCloseJournal,
  type RegisterCashResult,
} from "@/lib/accounting/register-cash-journal-core";
import { getSession, getRegister, totalDropsMinor } from "@/lib/registers/store";

/** The stable source-ref prefix. One post per drawer session, ever. */
export const TILL_CLOSE_SOURCE_PREFIX = "till-close";

/**
 * Build the source ref for a session. Exported and pure so the test asserts
 * the SAME string the service uses, rather than re-typing the format and
 * proving only that two copies of a mistake agree (rule 39).
 */
export function tillCloseSourceRef(sessionId: string): string {
  return `${TILL_CLOSE_SOURCE_PREFIX}:${sessionId}`;
}

/**
 * What happened to one drawer. Every branch is named, because "the close did
 * not post" and "the close posted" must never be told apart by guesswork
 * (rule 134). `skipped` means correctly nothing-to-do; `refused` means we did
 * not trust the numbers; `failed` means the ledger rejected the write.
 */
export type DrawerPostOutcome =
  | {
      readonly kind: "posted";
      readonly sessionId: string;
      readonly sourceRef: string;
      readonly journalId: string | null;
      readonly journalNo: number | null;
      /** 'duplicate' means this session was already posted; nothing new written. */
      readonly outcome: "created" | "duplicate" | null;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly kind: "skipped";
      readonly sessionId: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly kind: "refused";
      readonly sessionId: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly kind: "failed";
      readonly sessionId: string;
      readonly sourceRef: string;
      readonly code: string;
      readonly message: string;
    };

/**
 * Post the closing entry for one reconciled drawer session.
 *
 * Safe to call twice: the second call returns `outcome: "duplicate"` from the
 * ledger's own idempotency, not from a check in this file, because a check here
 * would race with itself under two managers clicking at once.
 */
export async function postDrawerCloseForSession(
  sessionId: string,
  client?: Parameters<typeof submitJournal>[1],
): Promise<DrawerPostOutcome> {
  const session = await getSession(sessionId);
  if (!session) {
    // Rule 46: a failed read is NOT an empty result. We did not learn that
    // there is nothing to post; we learned nothing at all.
    return {
      kind: "refused",
      sessionId,
      code: "TILL_POST_NO_SESSION",
      message:
        "That drawer session could not be read, so nothing was posted. This is " +
        "not the same as a drawer with nothing in it.",
    };
  }

  if (session.status !== "reconciled") {
    return {
      kind: "skipped",
      sessionId,
      code: "TILL_POST_NOT_RECONCILED",
      message:
        `The drawer is ${session.status}, not reconciled. A blind count alone ` +
        "does not say what was expected, so there is no over/short to book yet.",
    };
  }

  // Rule 135: zero is an answer, missing is a question. A reconciled session
  // must have all three figures. A drawer that opened with a float of $0.00 is
  // a real (if odd) drawer; a drawer whose opening float is NULL is a row that
  // nobody ever counted. Coalescing the second into the first is exactly the
  // D-72 shape moved into cash, so all three are checked here and none of them
  // is defaulted below.
  if (
    session.closing_count_minor === null ||
    session.expected_close_minor === null ||
    session.opening_count_minor === null
  ) {
    return {
      kind: "refused",
      sessionId,
      code: "TILL_POST_INCOMPLETE_RECONCILE",
      message:
        "The session is marked reconciled but is missing its opening, counted or " +
        "expected figure. Something wrote the status without the numbers; " +
        "nothing was posted.",
    };
  }

  const register = await getRegister(session.register_id);
  const registerName = register?.name ?? "Register";
  const dropsMinor = await totalDropsMinor(sessionId);
  const openingMinor = session.opening_count_minor;

  // Derive cash sales back out of the figures reconcile already stored, rather
  // than asking the caller to pass them again. expected = opening + sales -
  // drops, so sales = expected - opening + drops. Re-passing them would let the
  // posted entry disagree with the reconciled row that Michael can see on the
  // history screen.
  const cashSalesMinor = session.expected_close_minor - openingMinor + dropsMinor;

  const built: RegisterCashResult = buildTillCloseJournal({
    journalDate: session.business_day,
    registerName,
    openingFloatMinor: openingMinor,
    cashSalesMinor,
    dropsMinor,
    countedMinor: session.closing_count_minor,
    // The float stays in the drawer overnight: migration 0077 pins every
    // register's default float at 16750 and the drawers are not emptied to the
    // vault nightly. Only the takings go to the safe.
    floatStaysInDrawer: true,
    sourceRef: tillCloseSourceRef(sessionId),
  });

  if (built.kind === "refused") {
    return {
      kind: "refused",
      sessionId,
      code: built.code,
      message: built.explanation,
    };
  }

  if (built.kind === "no_entry") {
    // A real, complete, correct outcome that happens to move no money. It is
    // reported as its own kind so it can never be read as a failure (rule 136).
    return {
      kind: "skipped",
      sessionId,
      code: built.code,
      message: built.explanation,
    };
  }

  const sourceRef = tillCloseSourceRef(sessionId);
  const result = await submitJournal(
    {
      entityCode: built.journal.entityCode,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: built.journal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        // JournalLineInput takes `string | undefined`; the draft allows null.
        description: l.description ?? undefined,
      })),
      // 'bank' is approval-exempt: the drawer count IS the human act, and a
      // second approval would hold up the deposit without adding a second pair
      // of eyes to the cash.
      autoPost: true,
    },
    client,
  );

  if (!result.ok) {
    return {
      kind: "failed",
      sessionId,
      sourceRef,
      code: result.code,
      message: result.message,
    };
  }

  return {
    kind: "posted",
    sessionId,
    sourceRef,
    journalId: result.journalId,
    journalNo: result.journalNo,
    outcome: result.outcome,
    code: result.code,
    message:
      result.outcome === "duplicate"
        ? `${registerName} was already posted for this close. Nothing was written twice.`
        : built.explanation,
  };
}

/**
 * A one-line summary for the redirect banner. Kept here, next to the outcome
 * type, so a new `kind` cannot be added without this switch failing to compile.
 */
export function describeDrawerPostOutcome(o: DrawerPostOutcome): string {
  switch (o.kind) {
    case "posted":
      return o.outcome === "duplicate"
        ? "Already posted to the ledger — not booked twice."
        : `Posted to the ledger${o.journalNo != null ? ` as entry #${o.journalNo}` : ""}.`;
    case "skipped":
      return `Not posted: ${o.message}`;
    case "refused":
      return `Not posted: ${o.message}`;
    case "failed":
      return `The ledger refused the entry: ${o.message}`;
  }
}
