/**
 * src/lib/atm/atm-posting-core.ts   (books-69 step 1)
 *
 * TURNING A DAY AT THE ATM INTO A JOURNAL ENTRY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG BEFORE THIS FILE EXISTED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The books-69 recon established a single fact and proved it two ways: the ATM
 * subsystem — fourteen modules, five test files, three migrations — had never
 * written a single journal entry. `grep -rn "posting-service|journal-entry-
 * service|posting-core" src/lib/atm src/app/admin/atm` returned nothing, and
 * `grep -rn "51000" src` returned nothing at all, meaning the account named
 * "ATM Surcharge Income" was referenced by zero lines of application code.
 *
 * It LOOKED connected because three separate readers — the ATM screen,
 * `net-income-store.ts`, and the B&O engine — each read `atm_settlements`
 * directly and totalled it themselves. Every one of those figures was correct
 * on screen and absent from the ledger. A number on a report that no journal
 * supports is not bookkeeping; it is a spreadsheet with better fonts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A PURE MODULE WITH NO DATABASE IN IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is a function from data to data. The proposal it returns is
 * inert: it does not write, it cannot write, and it holds no client. That is
 * deliberate, and it is the reason this file can be tested at all — the
 * defect class that produced D-22 was six private conversion helpers sealed
 * inside `server-only` modules where no unit test could reach them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ENTRY, AND WHY IT HAS THE SHAPE IT HAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A day at the machine produces two economically distinct things, and the
 * chart of accounts already knows they are distinct (migration 0173):
 *
 *   SURCHARGE — the fee. This is Michael's revenue, and it is revenue of the
 *   ATM business, not the cannabis business. Account `51000 ATM Surcharge
 *   Income`, whose own seed comment reads "Separate trade or business (CHAMP).
 *   Not cannabis revenue." `allowed_entity_codes` is `{atm}` — the database
 *   will refuse it on any other set of books.
 *
 *   DISPENSED CASH — the money the cardholder walked away with. This is NOT
 *   revenue and never was. The machine held Michael's cash, a stranger took
 *   some of it, and the card networks send it back. It is one asset becoming
 *   another asset, which nets to zero in the income statement and must.
 *
 * THE 280E POINT, WHICH IS THE WHOLE REASON THE ENTITY MATTERS. Surcharge
 * income booked to `greenway` would be cannabis income under §280E, where
 * essentially no deduction survives. Booked to `atm`, it is a separate trade
 * or business under CHAMP v. Commissioner, 128 T.C. 173, and its expenses are
 * ordinarily deductible. `coa-core.ts::defaultCostClass` already returns
 * `separate_business` for the `atm` entity, and `books-view-core.ts` already
 * suppresses the 280E badge there. This module posts into that existing,
 * already-correct structure rather than inventing a parallel one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS PROPOSES AND NEVER POSTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `posting-core.ts` already answers this, and it answered it before books-69
 * existed. `AUTOPOSTABLE_SOURCE_KINDS` is exactly `pos_sale`, `excise`,
 * `purchase`, `bank`. `atm` is not on it, and `NEVER_AUTOPOST_REASONS.atm`
 * gives the reason in Michael's own terms:
 *
 *     "ATM cash movements are reconciled against a physical count, by a
 *      person."
 *
 * That is not a limitation to work around, it is the correct rule, and this
 * module was written to obey a decision the system had already made rather
 * than to relitigate it. `decidePosting` will return `draft` with code
 * `AUTOPOST_NOT_ELIGIBLE` for every entry this file builds. The proposal
 * therefore carries `autoPost: false` explicitly — stating the intent at the
 * call site instead of relying on a default that could change underneath it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCE: WHY A SOURCE REF IS NOT OPTIONAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A settlement day can be re-imported. PAI reports get re-downloaded, syncs
 * get retried, and Michael may well click the button twice. Every proposal
 * carries a stable `sourceRef` derived from the settlement's own identity —
 * terminal and date, which is exactly the pair migration 0156 makes unique in
 * `idx_atm_settlements_date_terminal`. Re-running produces a byte-identical
 * key, `buildIdempotencyKey` produces the same string, and the database
 * recognises the duplicate instead of posting the money a second time.
 *
 * The ref is built from the settlement DATE and TERMINAL, never from the row's
 * `id` uuid. A re-import that deletes and re-inserts a row would mint a fresh
 * uuid for the same economic day, and a uuid-keyed entry would sail straight
 * past the duplicate check and post the day twice.
 */

import {
  buildIdempotencyKey,
  type EntityCode,
  type SourceKind,
} from "@/lib/accounting/posting-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * THE ACCOUNTS, NAMED ONCE
 *
 * Hardcoded account strings scattered through a file are how `12000-GRWYE`
 * drifted to a negative cash balance of -45,230.00 in the old Sage chart. Each
 * constant below is annotated with what migration 0173 actually says about it,
 * measured from the seed rather than remembered.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `10300 Bank — ATM Vault Account`, an asset. CONTROL account, cash flavour,
 * `allowed_entity_codes = {atm, greenway}`.
 */
export const ACCOUNT_ATM_VAULT = "10300";

/**
 * `51000 ATM Surcharge Income`, income, `allowed_entity_codes = {atm}`.
 * Seed comment: "Separate trade or business (CHAMP). Not cannabis revenue."
 */
export const ACCOUNT_ATM_SURCHARGE_INCOME = "51000";

/** The ATM operation's own set of books. Not the store's. */
export const ATM_ENTITY: EntityCode = "atm";

/** Matches the `atm` member of 0172's `source_kind` CHECK constraint. */
export const ATM_SOURCE_KIND: SourceKind = "atm";

/* ═══════════════════════════════════════════════════════════════════════════
 * INPUT AND OUTPUT SHAPES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One settled day, reduced to only what an accounting entry needs.
 *
 * This is deliberately NOT `AtmSettlementRow` from the store. A pure core that
 * imports a `server-only` store's type drags a database shape into a module
 * whose whole value is that it has no database in it. The caller maps.
 *
 * Both money fields are `number | null` because migration 0156 declares them
 * nullable and its sibling 0183 is explicit about what that means: "NULL means
 * 'not reported' -- never zero." A null here is a missing reading, and this
 * module refuses to invent a figure for it.
 */
export type AtmSettlementFacts = {
  /** ISO `yyyy-mm-dd`, the settlement date. Part of the idempotency key. */
  readonly settlementDate: string;
  /** PAI's terminal id, e.g. `HG26499`. The other part of the key. */
  readonly terminalId: string;
  /** Fee revenue for the day, integer cents. Null = PAI did not report it. */
  readonly surchargeCents: number | null;
  /** Cash dispensed to cardholders, integer cents. Null = not reported. */
  readonly terminalTransactionCents: number | null;
};

/** A single line of a proposed entry. Positive = debit, negative = credit. */
export type ProposedLine = {
  readonly accountCode: string;
  /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit. */
  readonly amountCents: number;
  /** Plain English, written for Michael, not for a developer. */
  readonly description: string;
};

/**
 * An entry this module believes should exist, and the evidence for it.
 *
 * `postable` is always false and there is no code path that sets it true. It
 * exists as a field rather than being left implicit so that a screen renders a
 * refusal it can SEE, matching the `postable: false` owner gate that
 * `bank-match-core.ts` already established for proposed bank matches.
 */
export type AtmPostingProposal = {
  readonly entityCode: EntityCode;
  readonly journalDate: string;
  readonly sourceKind: SourceKind;
  readonly sourceRef: string;
  readonly idempotencyKey: string;
  readonly memo: string;
  readonly lines: readonly ProposedLine[];
  /** Always false. A person reconciles the ATM against a physical count. */
  readonly postable: false;
  /** Why a human is required, in words Michael can act on. */
  readonly whyNotAutomatic: string;
  /** Set when the day cannot be turned into an entry at all. */
  readonly refusal: string | null;
};

/**
 * The reason attached to every proposal, quoted from the system's own rule so
 * the explanation on screen and the rule in `posting-core` cannot drift into
 * two different answers.
 */
export const ATM_WHY_NOT_AUTOMATIC =
  "ATM cash movements are reconciled against a physical count, by a person.";

/* ═══════════════════════════════════════════════════════════════════════════
 * THE SOURCE REFERENCE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The stable external identity of one settled day: `atm-settle:<terminal>:<date>`.
 *
 * Terminal and date, because migration 0156 already declares that pair unique
 * for `atm_settlements`. Not the row uuid — see the header. The terminal is
 * upper-cased and trimmed so that `hg26499` and `HG26499 ` cannot produce two
 * different keys for one machine on one day, which would post the day twice.
 */
export function atmSettlementSourceRef(terminalId: string, settlementDate: string): string {
  const t = (terminalId ?? "").trim().toUpperCase();
  const d = (settlementDate ?? "").trim();
  if (t === "" || d === "") {
    throw new Error(
      "ATM_NO_SOURCE_REF: a settlement needs both a terminal id and a settlement date to " +
        "be identified. Without a stable identity, re-importing the same PAI report would " +
        "post the same day's money a second time. Nothing was assumed.",
    );
  }
  return `atm-settle:${t}:${d}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * VALIDATION — WHAT THIS MODULE REFUSES TO GUESS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** `yyyy-mm-dd`, and a real day. `2026-02-30` is refused. */
function isIsoDate(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((p) => Number(p));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Why a settled day might not be postable, or null when it is.
 *
 * Separated from the builder so the reasons can be tested one at a time and so
 * a screen can explain a skipped day without having to build an entry first.
 *
 * A NEGATIVE SURCHARGE IS REFUSED, AND THAT IS A JUDGMENT WORTH STATING. The
 * Funds Movement report does contain correction rows — the books-69 recon
 * measured three of them, on 6/27, 7/2 and 7/9. A correction is real and will
 * eventually need to be booked. But a negative fee arriving through the
 * ordinary settlement path is far more likely to be a misread column than a
 * refund, and the cost of the two mistakes is not symmetric: refusing a real
 * correction surfaces a day for Michael to look at, while accepting a misread
 * one silently reverses revenue. Corrections are step 3's job, with the
 * disagreeing dates shown rather than absorbed.
 */
export function atmSettlementRefusal(f: AtmSettlementFacts): string | null {
  if (!isIsoDate(f.settlementDate)) {
    return `"${String(f.settlementDate)}" is not a real calendar date, so this day cannot be dated in the ledger.`;
  }
  if ((f.terminalId ?? "").trim() === "") {
    return "This settlement has no terminal id, so there is no stable way to identify it. Re-importing would post it twice.";
  }
  if (f.surchargeCents === null && f.terminalTransactionCents === null) {
    return (
      "PAI reported neither a surcharge nor a dispensed-cash figure for this day. A blank is " +
      "not a zero — it means the report did not carry the number, so nothing is posted rather " +
      "than posting a day that appears to have had no activity."
    );
  }
  for (const [label, v] of [
    ["surcharge", f.surchargeCents],
    ["dispensed cash", f.terminalTransactionCents],
  ] as const) {
    if (v === null) continue;
    if (!Number.isSafeInteger(v)) {
      return `The ${label} figure for this day is not a whole number of cents, so it is not a figure this ledger can hold exactly.`;
    }
    if (v < 0) {
      return `The ${label} figure for this day is negative (${v} cents). A settlement day should not remove money, so this is being shown to you rather than posted.`;
    }
  }
  if ((f.surchargeCents ?? 0) === 0 && (f.terminalTransactionCents ?? 0) === 0) {
    return "This day settled zero in both legs. An entry for zero moves no money and does not belong in the ledger.";
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE BUILDER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the proposed entry for one settled day.
 *
 * THE ENTRY, IN PLAIN ENGLISH. Money arrived in the vault account, and it
 * arrived for two different reasons:
 *
 *   DEBIT  10300  (surcharge + dispensed cash)   the bank account went up
 *   CREDIT 51000  (surcharge)                    that part is fee revenue
 *   CREDIT 10300  (dispensed cash)               that part is cash coming back
 *
 * The dispensed-cash leg is a debit and a credit to the SAME account, and that
 * is not a mistake — it is the honest shape. The vault account rises when the
 * network settles and falls by the cash the machine physically handed out.
 * Netting those two into one line would make the entry smaller and would throw
 * away the only place the books record how much cash the machine dispensed.
 * Keeping both means `10300` reconciles line by line against the Timberland
 * feed, where the two legs also arrive separately.
 *
 * Every line carries its own plain-English description, because Michael reads
 * these, and "the form as it would look if I were holding it in my hand" is
 * the standard for the ledger too.
 */
export function buildAtmSettlementProposal(f: AtmSettlementFacts): AtmPostingProposal {
  const refusal = atmSettlementRefusal(f);
  const terminal = (f.terminalId ?? "").trim().toUpperCase();

  // A refused day still returns a proposal, so a screen can show the day and
  // the reason side by side instead of the row silently disappearing. It
  // carries no lines, so there is nothing that could be posted by accident.
  if (refusal !== null) {
    return {
      entityCode: ATM_ENTITY,
      journalDate: f.settlementDate,
      sourceKind: ATM_SOURCE_KIND,
      sourceRef: "",
      idempotencyKey: "",
      memo: `ATM settlement ${terminal || "(no terminal)"} ${f.settlementDate} — not posted`,
      lines: [],
      postable: false,
      whyNotAutomatic: ATM_WHY_NOT_AUTOMATIC,
      refusal,
    };
  }

  const surcharge = f.surchargeCents ?? 0;
  const dispensed = f.terminalTransactionCents ?? 0;
  const sourceRef = atmSettlementSourceRef(terminal, f.settlementDate);

  const lines: ProposedLine[] = [];

  // Leg 1 — the fee. Revenue of the ATM business (CHAMP), not the store.
  if (surcharge > 0) {
    lines.push({
      accountCode: ACCOUNT_ATM_VAULT,
      amountCents: surcharge,
      description: `Surcharge fees settled into the ATM account for ${f.settlementDate}.`,
    });
    lines.push({
      accountCode: ACCOUNT_ATM_SURCHARGE_INCOME,
      amountCents: -surcharge,
      description:
        "Fee income of the ATM business. A separate trade or business under CHAMP, so this is not cannabis revenue and not subject to 280E.",
    });
  }

  // Leg 2 — the cash the machine handed out, coming back from the networks.
  // Not revenue: one asset becoming another.
  if (dispensed > 0) {
    lines.push({
      accountCode: ACCOUNT_ATM_VAULT,
      amountCents: dispensed,
      description: `Cash dispensed by the machine on ${f.settlementDate}, reimbursed by the card networks.`,
    });
    lines.push({
      accountCode: ACCOUNT_ATM_VAULT,
      amountCents: -dispensed,
      description:
        "The same cash leaving the vault when the cardholder took it. Not revenue — the machine's cash became a receivable and then became bank money again.",
    });
  }

  return {
    entityCode: ATM_ENTITY,
    journalDate: f.settlementDate,
    sourceKind: ATM_SOURCE_KIND,
    sourceRef,
    idempotencyKey: buildIdempotencyKey(ATM_ENTITY, ATM_SOURCE_KIND, sourceRef),
    memo: `ATM settlement ${terminal} ${f.settlementDate}`,
    lines,
    postable: false,
    whyNotAutomatic: ATM_WHY_NOT_AUTOMATIC,
    refusal: null,
  };
}

/**
 * Sum a proposal's lines. A balanced entry sums to exactly zero.
 *
 * Present as an exported function rather than an inline check in a test,
 * because a screen that shows Michael an entry should be able to show him it
 * balances, using the same arithmetic the gate uses.
 */
export function proposalBalanceCents(p: AtmPostingProposal): number {
  return p.lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/**
 * Build proposals for many days, newest first preserved as given.
 *
 * Refused days are KEPT, not filtered out. A day that cannot be posted is
 * exactly the day Michael needs to see; dropping it here would make the screen
 * quietly shorter and the problem invisible (standing rule 43 — walk the
 * population).
 */
export function buildAtmSettlementProposals(
  facts: readonly AtmSettlementFacts[],
): readonly AtmPostingProposal[] {
  return facts.map(buildAtmSettlementProposal);
}

/**
 * A one-line summary for a screen or a report.
 *
 * Deliberately says how many were refused, rather than reporting only the
 * happy count. "112 days ready" beside a silent 3 refusals is the report that
 * hides the problem.
 */
export function summariseProposals(proposals: readonly AtmPostingProposal[]): {
  readonly total: number;
  readonly ready: number;
  readonly refused: number;
  readonly surchargeCents: number;
  readonly sentence: string;
} {
  let ready = 0;
  let refused = 0;
  let surchargeCents = 0;
  for (const p of proposals) {
    if (p.refusal !== null) {
      refused += 1;
      continue;
    }
    ready += 1;
    for (const l of p.lines) {
      if (l.accountCode === ACCOUNT_ATM_SURCHARGE_INCOME) {
        // Income is credited, so it is negative in signed-cents terms.
        surchargeCents += -l.amountCents;
      }
    }
  }
  const total = proposals.length;
  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sentence =
    total === 0
      ? "No settled days were found, so there is nothing to post."
      : refused === 0
        ? `${ready} settled ${ready === 1 ? "day" : "days"} ready for your review, carrying ${money(surchargeCents)} of surcharge income. Nothing posts until you approve it.`
        : `${ready} settled ${ready === 1 ? "day" : "days"} ready for your review, carrying ${money(surchargeCents)} of surcharge income. ${refused} ${refused === 1 ? "day was" : "days were"} not turned into an entry — each one says why.`;
  return { total, ready, refused, surchargeCents, sentence };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS (tsx-runnable; PURE)
 *
 * Registered with the pure self-test runner so they execute in the same gate
 * as the rest of the pure cores, not only under vitest.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function __runAtmPostingCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const day: AtmSettlementFacts = {
    settlementDate: "2026-07-15",
    terminalId: "HG26499",
    surchargeCents: 32500,
    terminalTransactionCents: 1_250_00,
  };

  const p = buildAtmSettlementProposal(day);
  ok(p.refusal === null, "a good day is not refused");
  ok(p.entityCode === "atm", "posts to the ATM books, never the store's");
  ok(proposalBalanceCents(p) === 0, "the entry balances");
  ok(p.postable === false, "nothing is postable without a person");
  ok(
    p.sourceRef === "atm-settle:HG26499:2026-07-15",
    "the source ref is terminal + date",
  );
  // The backslashes are not a defect and are not cosmetic. `buildIdempotencyKey`
  // escapes colons inside a component so that two different events cannot
  // collide on one key ("a:b" + "c" vs "a" + "b:c"), and this source ref
  // contains colons. The MEASURED value is asserted here rather than the value
  // that looked right: the first draft of this line expected an unescaped key,
  // and this self-test is what caught it.
  ok(
    p.idempotencyKey === "atm:atm:atm-settle\\:HG26499\\:2026-07-15",
    "the idempotency key is built from the source ref, with colons escaped",
  );

  // Idempotence: the same day twice is the same key.
  const again = buildAtmSettlementProposal({ ...day });
  ok(again.idempotencyKey === p.idempotencyKey, "re-running produces the same key");
  // Case and padding on the terminal must not mint a second key.
  const messy = buildAtmSettlementProposal({ ...day, terminalId: " hg26499 " });
  ok(messy.idempotencyKey === p.idempotencyKey, "terminal casing cannot forge a second key");

  // The surcharge reaches 51000, credited, on the atm books.
  const income = p.lines.filter((l) => l.accountCode === ACCOUNT_ATM_SURCHARGE_INCOME);
  ok(income.length === 1, "exactly one surcharge income line");
  ok(income[0]?.amountCents === -32500, "surcharge is CREDITED to 51000");

  // Cash legs land on 10300 and net to the surcharge alone.
  const vault = p.lines.filter((l) => l.accountCode === ACCOUNT_ATM_VAULT);
  ok(vault.length === 3, "three vault legs: fee in, cash in, cash out");
  ok(
    vault.reduce((s, l) => s + l.amountCents, 0) === 32500,
    "the vault nets to the fee, because dispensed cash washes out",
  );

  // Refusals.
  ok(
    atmSettlementRefusal({ ...day, settlementDate: "2026-02-30" }) !== null,
    "an impossible date is refused",
  );
  ok(atmSettlementRefusal({ ...day, terminalId: "  " }) !== null, "a blank terminal is refused");
  ok(
    atmSettlementRefusal({ ...day, surchargeCents: null, terminalTransactionCents: null }) !== null,
    "a day PAI did not report is refused, not read as zero",
  );
  ok(
    atmSettlementRefusal({ ...day, surchargeCents: 0, terminalTransactionCents: 0 }) !== null,
    "a genuinely zero day is refused",
  );
  ok(atmSettlementRefusal({ ...day, surchargeCents: -100 }) !== null, "a negative fee is refused");
  ok(
    atmSettlementRefusal({ ...day, surchargeCents: 1.5 }) !== null,
    "a fractional cent is refused",
  );

  // A refused day still comes back, carrying no lines.
  const bad = buildAtmSettlementProposal({ ...day, terminalId: "" });
  ok(bad.refusal !== null && bad.lines.length === 0, "a refused day carries no postable lines");

  // A day with only a fee (no dispensed cash) is still a valid entry.
  const feeOnly = buildAtmSettlementProposal({ ...day, terminalTransactionCents: 0 });
  ok(feeOnly.refusal === null, "a fee-only day is postable");
  ok(proposalBalanceCents(feeOnly) === 0, "a fee-only day balances");
  ok(feeOnly.lines.length === 2, "a fee-only day has exactly two lines");

  // The summary counts refusals out loud.
  const s = summariseProposals([p, bad]);
  ok(s.ready === 1 && s.refused === 1, "the summary counts both");
  ok(s.surchargeCents === 32500, "the summary totals surcharge income");
  ok(s.sentence.includes("1 day was not turned into an entry"), "refusals are said out loud");

  console.log(`atm-posting-core self-tests: ${fail === 0 ? "all passed" : `${fail} FAILED`} (${pass} ok)`);
  if (fail > 0) throw new Error(`atm-posting-core: ${fail} self-test(s) failed`);
}
