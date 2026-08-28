/**
 * src/lib/atm/atm-settlement-service.ts   (slice books-89)
 *
 * THE MISSING LINK BETWEEN "PROPOSED" AND "BOOKED" (D-40).
 *
 * books-69 built `atm-posting-core.ts`: given one settled day it returns the
 * exact entry that should exist — debit 10300 for the money that arrived,
 * credit 51000 for the fee portion, and the dispensed-cash leg in and out of
 * 10300 so the vault reconciles line by line against the Timberland feed. It is
 * pure, effective-dated, and proven.
 *
 * It returns a PROPOSAL. Nothing ever turned a proposal into a journal. D-40
 * has said so since books-70 in plain terms: "the ATM classifier decides
 * correctly and posts nothing." The surcharge income of an entire separate
 * business has never reached the books.
 *
 * This file is that conversion, and it is deliberately thin. It contains no
 * accounting judgment whatsoever — every account code, every sign, every
 * refusal comes out of the core. What it adds is the three things a pure
 * function cannot do: read the settled days, hand each proposal to
 * `submitJournal`, and report honestly on what happened to each one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `postable: false` IS NOT A CONTRADICTION
 *
 * Every proposal the core returns carries `postable: false` and the sentence
 * "ATM cash movements are reconciled against a physical count, by a person."
 * That flag means EXACTLY what it says: no machine may post this on its own.
 * It does not mean the entry can never exist.
 *
 * So this service never auto-posts. `autoPost` is not passed, which means every
 * entry lands as a DRAFT on /admin/books/drafts for Michael to approve. The
 * person is still in the loop; what changes is that the loop now has an exit.
 * Refusing to even create the draft was not caution — it was a dead end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DISPENSED-CASH LEG LOOKS WRONG AND IS RIGHT
 *
 * A settled day debits 10300 and credits 10300 for the same dispensed figure.
 * That is the core's decision and its reasoning is recorded there: netting them
 * would throw away the only record of how much cash the machine handed out, and
 * the Timberland feed reports the two movements separately too. This service
 * passes the lines through untouched. If it ever "helpfully" collapsed them the
 * bank reconciliation would stop tying, which is precisely the failure mode
 * that still BALANCES and therefore announces itself to nobody.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY
 *
 * The core's `sourceRef` is `atm-settle:<TERMINAL>:<date>`, built from the pair
 * migration 0156 already declares unique for `atm_settlements`. Re-importing a
 * PAI report and pressing the button again therefore produces `duplicate`, not
 * a second entry. This matters more here than almost anywhere else: PAI reports
 * overlap by design, and posting a settlement day twice would double the
 * surcharge income of a whole separate tax entity.
 *
 * STANDING RULE 133 — the chain this file completes, stated link by link:
 *   src/app/admin/atm/page.tsx (Post to books tab)
 *     -> src/components/admin/atm/PostAtmSettlementsPanel.tsx
 *     -> src/app/admin/atm/actions.ts#postAtmSettlementsAction
 *     -> THIS FILE #postAtmSettlements
 *     -> atm-posting-core.ts#buildAtmSettlementProposals
 *     -> posting-service.ts#submitJournal -> gl_submit_journal -> draft
 */

import { submitJournal } from "@/lib/accounting/posting-service";
import {
  ACCOUNT_ATM_SURCHARGE_INCOME,
  ATM_SOURCE_KIND,
  buildAtmSettlementProposals,
  type AtmPostingProposal,
  type AtmSettlementFacts,
} from "@/lib/atm/atm-posting-core";
import { listAtmSettlements } from "@/lib/atm/store";

/** What happened to one settled day. */
export type AtmPostOutcome =
  | {
      readonly kind: "recorded";
      readonly sourceRef: string;
      readonly settlementDate: string;
      readonly terminalId: string;
      readonly surchargeCents: number;
      readonly journalId: string | null;
      readonly journalNo: number | null;
      /** 'duplicate' when this day had already been filed. */
      readonly outcome: "created" | "duplicate" | null;
    }
  | {
      readonly kind: "refused";
      readonly sourceRef: string;
      readonly settlementDate: string;
      readonly terminalId: string;
      readonly surchargeCents: number;
      /** Plain English. Either the core's refusal or the ledger's. */
      readonly message: string;
      /** 'CORE' when the day was never postable; otherwise the GL_ code. */
      readonly code: string;
    };

export type AtmPostRunResult = {
  readonly ok: boolean;
  readonly scanned: number;
  readonly recorded: number;
  readonly duplicates: number;
  readonly refused: number;
  readonly outcomes: readonly AtmPostOutcome[];
  readonly error: string | null;
};

function emptyRun(error: string | null): AtmPostRunResult {
  return {
    ok: error === null,
    scanned: 0,
    recorded: 0,
    duplicates: 0,
    refused: 0,
    outcomes: [],
    error,
  };
}

/**
 * The surcharge carried by one proposal, as a positive figure.
 *
 * Read off the built lines rather than the raw facts, so the number Michael
 * sees on screen is the number that was actually credited to 51000. Income is
 * a credit and therefore negative in signed-cents terms; the sign is flipped
 * here and nowhere else.
 */
function surchargeOf(p: AtmPostingProposal): number {
  let cents = 0;
  for (const l of p.lines) {
    if (l.accountCode === ACCOUNT_ATM_SURCHARGE_INCOME) cents += -l.amountCents;
  }
  return cents;
}

/**
 * Turn already-built proposals into draft journals.
 *
 * Split out from the reading below so the whole decision path is testable
 * without a database: the caller supplies the days.
 */
export async function postAtmSettlementProposals(
  proposals: readonly AtmPostingProposal[],
  client?: Parameters<typeof submitJournal>[1],
): Promise<AtmPostRunResult> {
  const outcomes: AtmPostOutcome[] = [];
  let recorded = 0;
  let duplicates = 0;
  let refused = 0;

  for (const p of proposals) {
    const terminalId = p.sourceRef.split(":")[1] ?? "";
    const surchargeCents = surchargeOf(p);

    // A day the core refused is REPORTED, not skipped. A refusal that never
    // reaches the screen is a day Michael thinks was posted.
    if (p.refusal !== null) {
      refused += 1;
      outcomes.push({
        kind: "refused",
        sourceRef: p.sourceRef,
        settlementDate: p.journalDate,
        terminalId,
        surchargeCents,
        message: p.refusal,
        code: "CORE",
      });
      continue;
    }

    // Belt and braces. The core cannot return a balanced-looking entry with no
    // lines, but if it ever did, `submitJournal` would refuse it with a message
    // about double-entry that would read as a system fault rather than a data
    // problem. Refusing here names the real cause.
    if (p.lines.length < 2) {
      refused += 1;
      outcomes.push({
        kind: "refused",
        sourceRef: p.sourceRef,
        settlementDate: p.journalDate,
        terminalId,
        surchargeCents,
        message:
          "This day produced fewer than two lines, so it is not a double-entry transaction. Nothing was written.",
        code: "CORE",
      });
      continue;
    }

    const result = await submitJournal(
      {
        entityCode: p.entityCode,
        journalDate: p.journalDate,
        // The core's own constant. 10300 is a control account and migration
        // 0172 check (6) refuses a 'manual' journal that touches one, so this
        // MUST stay 'atm'. Reading the constant rather than typing the string
        // means the screen and the engine cannot drift apart.
        sourceKind: ATM_SOURCE_KIND,
        sourceRef: p.sourceRef,
        memo: p.memo,
        lines: p.lines.map((l) => ({
          accountCode: l.accountCode,
          amountCents: l.amountCents,
          description: l.description,
        })),
        // autoPost is deliberately absent. `postable: false` on every proposal
        // means a person reconciles against a physical count; the draft is how
        // that person gets asked.
      },
      client,
    );

    if (!result.ok) {
      refused += 1;
      outcomes.push({
        kind: "refused",
        sourceRef: p.sourceRef,
        settlementDate: p.journalDate,
        terminalId,
        surchargeCents,
        message: result.message,
        code: result.code,
      });
      continue;
    }

    if (result.outcome === "duplicate") duplicates += 1;
    else recorded += 1;

    outcomes.push({
      kind: "recorded",
      sourceRef: p.sourceRef,
      settlementDate: p.journalDate,
      terminalId,
      surchargeCents,
      journalId: result.journalId,
      journalNo: result.journalNo,
      outcome: result.outcome,
    });
  }

  return {
    ok: true,
    scanned: proposals.length,
    recorded,
    duplicates,
    refused,
    outcomes,
    error: null,
  };
}

/**
 * THE DOOR. Read every settled day and file each as a draft journal.
 *
 * Reads the same rows `listAtmSettlementProposals` shows on screen, through the
 * same builder, so what Michael reviewed is what gets filed.
 */
export async function postAtmSettlements(limit = 400): Promise<AtmPostRunResult> {
  let settlements: Awaited<ReturnType<typeof listAtmSettlements>>;
  try {
    settlements = await listAtmSettlements(limit);
  } catch (e) {
    // Standing rule 46: a failed read is NOT an empty result. Reporting zero
    // days here would read as "the ATM had no activity", which is a different
    // and much worse statement than "the settlements could not be read".
    return emptyRun(
      `The settled days could not be read, so nothing was written: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (settlements.length === 0) {
    return emptyRun(
      "No settled days have been imported yet, so there is nothing to file. Import a PAI settlement report first.",
    );
  }

  const facts: AtmSettlementFacts[] = settlements.map((s) => ({
    settlementDate: s.settlementDate,
    terminalId: s.terminalId,
    surchargeCents: s.surchargeCents,
    terminalTransactionCents: s.terminalTransactionCents,
  }));

  return postAtmSettlementProposals(buildAtmSettlementProposals(facts));
}
