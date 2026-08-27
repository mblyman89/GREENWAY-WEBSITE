/**
 * src/lib/accounting/related-party-loan-authorities.ts   (books-76)
 *
 * THE LAW THAT APPLIES THE MOMENT MICHAEL CALLS THE ATM CASH A LOAN.
 *
 * WHY THIS FILE EXISTS.
 *
 * Michael said, verbatim: "I want to classify the cash in the atm as a loan.
 * It doesn't need to be interest bearing or have a term limit, but I suppose I
 * could create a contract spelling out the cash loan and repayment method."
 *
 * That is a decision he is entitled to make, and it closes D-41, which had been
 * sitting on UNKNOWN for three slices waiting for exactly this answer. Standing
 * rule 28 gives him executive authority over his own return.
 *
 * But the sentence contains two assumptions that are not his to make, because
 * they are not opinions. They are rules, and both of them are in the same
 * regulation:
 *
 *   1. "It doesn't need to be interest bearing." As a matter of what he charges,
 *      true. As a matter of what the return reports, FALSE. §1.482-2(a)(2)(iii)(B)(2)
 *      says that where no interest is charged on a loan between commonly
 *      controlled entities, an arm's length rate of interest SHALL BE EQUAL TO
 *      the lower limit — 100 percent of the applicable Federal rate, compounded
 *      semiannually. The IRS does not have to prove a better number. The number
 *      is supplied by the regulation, and it is supplied against him.
 *
 *   2. "Or have a term limit." A loan with no term is a DEMAND loan, and
 *      §1.482-2(a)(2)(iii)(C) gives demand loans their own rate: the Federal
 *      short-term rate under §1274(d), in effect FOR EACH DAY any amount is
 *      outstanding. So the absence of a term does not remove the rate question;
 *      it replaces one annual rate with a daily series of them.
 *
 * AND THE THIRD THING, WHICH IS THE ONE THAT ACTUALLY MATTERS.
 *
 * Everything above assumes the loan is real. §1.482-2(a)(1)(ii)(B) says the
 * whole regime — safe havens included — "does not apply to so much of an
 * alleged indebtedness which is not in fact a bona fide indebtedness," and that
 * payments on alleged indebtedness "shall be treated according to their
 * substance." The regulation names the two substances it has in mind, and they
 * are precisely the two Michael is exposed to: a contribution to capital, or a
 * distribution with respect to shares.
 *
 * That is why the contract he offered to write is not paperwork. It is the
 * thing that decides whether the label survives. Michael's own description of
 * the practice — books-75, verbatim: "When one account needs cash, I move it
 * there. If the other needs cash, I move it back" — describes a cash pool, not
 * a loan. A cash pool with no note, no rate, no term, no schedule and no
 * demand ever made is the fact pattern the IRS recharacterises. The contract is
 * what converts it, and `related-party-loan-core.ts` lists what it must contain.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * §482 itself, §1.482-1's arm's length standard, §6662's penalties and
 * §1.6662-6's documentation requirements are cited by other modules or belong
 * to slices not yet built. Standing rule 2 forbids a second copy of a citation
 * that already has one. This file adds only §1.482-2(a), which nothing in this
 * repository had ever cited.
 *
 * PURE DATA. No I/O, no clock, no server imports. Every `quote` below is an
 * exact substring of docs/authorities/federal/cfr-1.482-2.txt, which was pulled
 * from the eCFR renderer (the government's own text, not a mirror of a mirror),
 * and `scripts/verify-verbatim-quotes.ts` proves it by machine.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

export const RELATED_PARTY_LOAN_AUTHORITIES: readonly GuidanceAuthority[] = [
  // -------------------------------------------------------------------------
  // 1) THE HOOK. NO INTEREST IS ITSELF THE TRIGGER.
  // -------------------------------------------------------------------------
  {
    id: "REG_1_482_2_A_1_I_NO_INTEREST_IS_THE_TRIGGER",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(1)(i)",
    quote:
      "Where one member of a group of controlled entities makes a loan or advance directly or " +
      "indirectly to, or otherwise becomes a creditor of, another member of such group and either " +
      "charges no interest, or charges interest at a rate which is not equal to an arm's length rate " +
      "of interest (as defined in paragraph (a)(2) of this section) with respect to such loan or " +
      "advance, the district director may make appropriate allocations to reflect an arm's length rate " +
      "of interest for the use of such loan or advance.",
    soWhat:
      "Read \"either charges no interest\" first. Charging nothing is not the safe, modest, " +
      "nothing-to-see-here option — it is one of the two things that expressly switches this " +
      "regulation on. Michael's four entities are a group of controlled entities (he owns all of " +
      "them), so when the ATM entity funds Greenway and no interest changes hands, this sentence " +
      "already applies. Nothing has gone wrong yet. But the IRS now has a lever it would not have " +
      "had if a rate had simply been stated.",
    source:
      "26 C.F.R. §1.482-2(a)(1)(i). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },

  // -------------------------------------------------------------------------
  // 2) THE ONE THAT CONTRADICTS "IT DOESN'T NEED TO BE INTEREST BEARING".
  // -------------------------------------------------------------------------
  {
    id: "REG_1_482_2_A_2_III_B_AFR_IS_IMPUTED",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(2)(iii)(B)",
    quote:
      "If either no interest is charged or if the rate of interest charged is less than the lower " +
      "limit, then an arm's length rate of interest shall be equal to the lower limit, compounded " +
      "semiannually",
    soWhat:
      "This is the sentence Michael needs to see. \"SHALL BE EQUAL TO\" is not a power the IRS has to " +
      "argue for — it is the answer the regulation supplies on its own. The lower limit is defined two " +
      "lines up as 100 percent of the applicable Federal rate. So a zero-interest loan between his " +
      "entities is not a zero-interest loan for tax purposes; it is an AFR loan on which he charged " +
      "nothing, and the difference is income to the lender. Practically: interest income lands in the " +
      "ATM entity, which is NOT a cannabis business, so it is taxed and is B&O service-rate revenue; " +
      "the matching interest expense lands in Greenway, which IS a cannabis business, where §280E " +
      "disallows it. The imputation is therefore not a wash. It manufactures income on one side and a " +
      "dead deduction on the other. That asymmetry is the whole reason this matters to him and not to " +
      "an ordinary two-company owner.",
    source:
      "26 C.F.R. §1.482-2(a)(2)(iii)(B)(2). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },
  {
    id: "REG_1_482_2_A_2_III_B_SAFE_HAVEN_BAND",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(2)(iii)(B)(1)",
    quote:
      "Not less than 100 percent of the applicable Federal rate (lower limit); and",
    soWhat:
      "The good news in an otherwise unhelpful regulation. There is a SAFE HAVEN: a rate anywhere from " +
      "100% to 130% of the AFR is accepted without further argument. Michael does not need to hire " +
      "anyone to determine an arm's length rate, and he does not need to guess. If the contract he " +
      "offered to write simply states \"interest accrues at the applicable Federal short-term rate, " +
      "compounded semiannually,\" he is inside the safe haven permanently and automatically, and this " +
      "entire exposure disappears. The cost of charging the rate is bookkeeping. The cost of not " +
      "charging it is the imputation above, applied by someone else, years later, with penalties.",
    source:
      "26 C.F.R. §1.482-2(a)(2)(iii)(B)(1)(i). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },

  // -------------------------------------------------------------------------
  // 3) THE ONE THAT ANSWERS "OR HAVE A TERM LIMIT".
  // -------------------------------------------------------------------------
  {
    id: "REG_1_482_2_A_2_III_C_DEMAND_LOAN_SHORT_TERM_RATE",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(2)(iii)(C)",
    quote:
      "In the case of a demand loan or advance to which this section applies, the applicable Federal " +
      "rate means the Federal short-term rate determined under section 1274(d) (determined without " +
      "regard to the lowest 3-month short term rate determined under section 1274(d)(2)) in effect for " +
      "each day on which any amount of such loan or advance (including unpaid accrued interest " +
      "determined under paragraph (a)(2) of this section) is outstanding.",
    soWhat:
      "Michael said the loan does not need a term limit. A loan with no term is a DEMAND loan, so this " +
      "is the paragraph that governs it, and it changes the arithmetic in a way that is easy to miss. " +
      "A term loan gets ONE rate, fixed when the loan is made. A demand loan gets the Federal " +
      "short-term rate IN EFFECT FOR EACH DAY the balance is outstanding — the rate moves quarterly " +
      "and the computation has to move with it. Note also the parenthetical: unpaid accrued interest " +
      "is itself part of the outstanding amount, so interest that is never paid starts earning " +
      "interest. This is why the app cannot store a single `rateMilliPct` for this loan and call it " +
      "done, and it is why `FEDERAL_SHORT_TERM_RATES` being empty stops the computation cold rather " +
      "than producing a plausible wrong number.",
    source:
      "26 C.F.R. §1.482-2(a)(2)(iii)(C)(3). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },

  // -------------------------------------------------------------------------
  // 4) THE ONE THAT DECIDES WHETHER ANY OF THE ABOVE EVEN APPLIES.
  // -------------------------------------------------------------------------
  {
    id: "REG_1_482_2_A_1_II_B_BONA_FIDE_OR_SUBSTANCE",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(1)(ii)(B)",
    quote:
      "This paragraph (a) does not apply to so much of an alleged indebtedness which is not in fact a " +
      "bona fide indebtedness, even if the stated rate of interest thereon would be within the safe " +
      "haven rates prescribed in paragraph (a)(2)(iii) of this section. For example, paragraph (a) of " +
      "this section does not apply to payments with respect to all or a portion of such alleged " +
      "indebtedness where in fact all or a portion of an alleged indebtedness is a contribution to the " +
      "capital of a corporation or a distribution by a corporation with respect to its shares.",
    soWhat:
      "The most important authority in this slice, and the one Michael did not ask about. Everything " +
      "else here assumes the loan is REAL. This says the safe haven cannot rescue a loan that is not " +
      "bona fide — \"even if the stated rate of interest thereon would be within the safe haven " +
      "rates.\" So writing a perfect contract with a perfect AFR rate does not, by itself, win. And " +
      "the two substitutes the regulation names are exactly Michael's two risks: a CONTRIBUTION TO " +
      "CAPITAL (money he put in, which changes his basis and is not repayable) or a DISTRIBUTION (money " +
      "he took out, which is taxable to the extent it exceeds basis). His own description of the " +
      "practice in books-75 — move cash whichever way the need runs, no note, no repayment expected — " +
      "is a description of one of those two, not of a loan. The label is the easy part. The contract, " +
      "and then actually behaving as though the contract exists, is the part that has to be done.",
    source:
      "26 C.F.R. §1.482-2(a)(1)(ii)(B). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },
  {
    id: "REG_1_482_2_A_1_II_A_WRITING_NOT_REQUIRED",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(1)(ii)(A)",
    quote:
      "Loans or advances of money or other consideration (whether or not evidenced by a written " +
      "instrument); and",
    soWhat:
      "Cuts both ways, and Michael should understand both. In his favour: the absence of a written " +
      "note does not automatically mean there is no loan — the regulation expressly covers advances " +
      "\"whether or not evidenced by a written instrument,\" so twelve years of undocumented transfers " +
      "are not fatal on that ground alone. Against him: the same words mean a piece of paper is not " +
      "what creates the loan either. Since the writing is neither necessary nor sufficient, what is " +
      "left is CONDUCT — whether the balance is tracked, whether it moves both ways, whether repayment " +
      "is ever actually made. That is a fact the books can prove or disprove, which is why this slice " +
      "puts the loan on the ledger with a settlement history instead of just adding an account.",
    source:
      "26 C.F.R. §1.482-2(a)(1)(ii)(A)(1). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },

  // -------------------------------------------------------------------------
  // 5) HOW REPAYMENTS ARE APPLIED. RELEVANT BECAUSE HE MOVES CASH BOTH WAYS.
  // -------------------------------------------------------------------------
  {
    id: "REG_1_482_2_A_1_IV_A_FIFO_APPLICATION",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(1)(iv)(A)",
    quote:
      "in determining the period of time for which an amount owed by one member of the group to " +
      "another member is outstanding, payments or other credits to an account are considered to be " +
      "applied against the earliest amount outstanding, that is, payments or credits are applied " +
      "against amounts in a first-in, first-out (FIFO) order.",
    soWhat:
      "Michael moves cash back and forth as each account needs it, so the practical question is which " +
      "advance a given transfer-back repays. The regulation answers it and removes the discretion: " +
      "FIFO, oldest first. This is genuinely helpful — it means he does not have to trace individual " +
      "transfers or remember intent, and the app can compute the outstanding balance and its age " +
      "mechanically from the transfer dates alone. It also means the answer is not his to choose after " +
      "the fact, which is the point: a balance whose age is computed by rule is evidence, and a balance " +
      "whose age is asserted later is not.",
    source:
      "26 C.F.R. §1.482-2(a)(1)(iv)(A). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },
  {
    id: "REG_1_482_2_A_1_III_A_INTEREST_PERIOD",
    kind: "regulation",
    cite: "26 C.F.R. §1.482-2(a)(1)(iii)(A)",
    quote:
      "the period for which interest shall be charged with respect to a bona fide indebtedness between " +
      "controlled entities begins on the day after the day the indebtedness arises and ends on the day " +
      "the indebtedness is satisfied (whether by payment, offset, cancellation, or otherwise).",
    soWhat:
      "Fixes the clock precisely: day after the advance, through the day it is satisfied. Two words are " +
      "worth Michael's attention. OFFSET means a transfer running the other way can extinguish the debt " +
      "without any cash being labelled a repayment — which is literally how he already operates, and is " +
      "the honest way to book his back-and-forth. CANCELLATION means forgiving the balance also ends the " +
      "period, but forgiving a related-party debt is a taxable event, not a tidy-up; it is the moment " +
      "the loan becomes a distribution or a contribution. If the balance is ever going to be written " +
      "off, that decision belongs in front of the CPA before it is made, not after.",
    source:
      "26 C.F.R. §1.482-2(a)(1)(iii)(A). Mirrored at docs/authorities/federal/cfr-1.482-2.txt.",
  },
];
