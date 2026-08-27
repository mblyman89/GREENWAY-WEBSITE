/**
 * src/lib/atm/atm-sweep-core.ts   (books-69 step 2)
 *
 * THE CASH SWEEP, AS AN ENTRY ON TWO SETS OF BOOKS AT ONCE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THE SWEEP IS
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Cash accumulates in the Timberland ATM account (6228) as the card networks
 * settle. Periodically Michael moves it to the cannabis operating account
 * (6048). On the bank statement it is one line:
 *
 *     TRANSFER FROM X6228 TO X6048     Debit     11,427.50
 *
 * One line on one statement, but TWO entries in the books, because 6228 and
 * 6048 belong to two different legal entities. The ATM operation's cash goes
 * down and it is now owed money by the store; the store's cash goes up and it
 * now owes the ATM operation. Recording only the side you happen to be looking
 * at is how intercompany balances drift, and a drifted intercompany balance is
 * the single most common finding in a related-party examination.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE POPULATION, WALKED — AND THE ROW THE RECON MISCOUNTED
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The books-69 recon reported 67 sweep rows, all `TRANSFER FROM X6228 TO
 * X6048`. Re-counting the actual statement (301 rows, 2026-05-01 to
 * 2026-08-23) gives 67 TRANSFER rows, but they are not all the same thing:
 *
 *     66  TRANSFER FROM X6228 TO X6048    $526,937.58   to the cannabis account
 *      1  TRANSFER FROM X6228 TO X3557      $5,242.50   to PERSONAL checking
 *
 * The sixty-seventh row is not a sweep to the store at all. On 2026-07-03,
 * $5,242.50 went from the ATM account to account 3557, which Michael has
 * identified as his personal checking. That is a different destination, a
 * different entity, and a completely different accounting treatment — an owner
 * distribution, not an intercompany advance. Counted as a sweep it would
 * overstate what the store owes the ATM business by $5,242.50 and would hide a
 * distribution that belongs on the equity statement.
 *
 * The miscount is stated here rather than quietly corrected (standing rule 89),
 * and it is exactly why rule 43 says to walk the population instead of
 * sampling it: one row in sixty-seven, and it is the one with a different
 * meaning.
 *
 * The other 234 rows are 230 `DLY SETTLE MVNT - HG26499 CCD`, 3 `ACCOUNT
 * ANALYSIS CHARGE` and 1 `EFTRANSACT PAYMENT ALLIANCE PPD`. None is a
 * transfer; all are somebody else's job.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE PERSONAL TRANSFER IS NOT AN INTERCOMPANY PAIR AT ALL
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `personal` IS one of the four entity codes, so it would be technically
 * possible to book 6228 → 3557 through `36000 Due To / From Related Entity`
 * like any other pair. That would be wrong, and wrong in a direction that
 * costs money.
 *
 * `36000` says an entity OWES another entity — it is a liability expected to be
 * settled. Money an owner takes out of his own business for his own use is not
 * a loan unless it is documented as one, with a rate and a term, and repaid. An
 * undocumented "loan" to an owner is one of the most reliably re-characterised
 * items there is: the examiner calls it a distribution anyway, and having
 * called it a loan first is worse than having called it a distribution.
 *
 * So it is `41000 Shareholder Distributions` — but on ONE set of books, not
 * two, and that distinction was a real defect in the first draft of this file.
 *
 * THE MISTAKE, WRITTEN DOWN SO IT IS NOT REPEATED. The first draft proposed a
 * PAIR for the personal transfer: debit 41000 on the ATM books, and on the
 * personal books debit 10200 / CREDIT 41000. Two things are wrong with that,
 * and both were proved against the migrations rather than guessed:
 *
 *   1. DIRECTION. Migration 0178 corrected an argument slip in 0173 and
 *      `41000` is genuinely `is_contra = true` on an `equity` account, so
 *      `gl_upsert_account` derives its normal balance as DEBIT. A credit to it
 *      on the personal books is a balance sitting opposite its normal side, and
 *      `gl_trial_balance` in 0175 flags exactly that as `is_abnormal`.
 *
 *   2. CONSOLIDATION. Worse. `41000` is not entity-scoped, so a +X debit on the
 *      ATM books and a −X credit on the personal books SUM TO ZERO across the
 *      group. The distribution would vanish from the consolidated equity
 *      statement — the report would say no distributions were taken. Michael's
 *      S-corporation basis and §1368 analysis are computed from distributions;
 *      a distribution that nets itself out understates them and is precisely
 *      the kind of silent, balanced, fictional report that migration 0175's own
 *      header warns about.
 *
 * A distribution is not a transfer between two businesses. It is money leaving
 * the business, full stop; where it lands afterwards is Michael's private
 * affair and not a claim on any entity. So it is proposed as a SINGLE entry on
 * the ATM books — debit 41000, credit 10300 — and `entityB` is null. If Michael
 * wants his personal cash tracked in this system too, that is a separate
 * decision about the `personal` books and it can be made on purpose, later,
 * without having corrupted the equity statement in the meantime.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE REFERENCE IS A UUID
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `gl_journals.intercompany_ref` is declared `uuid` in migration 0172, and
 * `gl_submit_intercompany_pair` takes `p_ref uuid`. The first draft of this
 * file produced `ref: "atm-sweep:2026-08-21:6048:1142750"` — a string that
 * Postgres would have rejected outright the first time anyone pressed the
 * button. Green unit tests would not have caught it, because nothing in a pure
 * test ever meets the column's type.
 *
 * So the ref is a UUID, and a DETERMINISTIC one (RFC 4122 version 5, SHA-1 over
 * a fixed namespace plus the natural key). Deterministic matters: a random
 * `randomUUID()` would mean re-importing the same statement mints a brand-new
 * ref every time, and the two halves of yesterday's transfer could no longer be
 * tied to today's re-import. The natural key stays human-readable in
 * `sourceRefA` / `sourceRefB`, which is where an auditor looks; the uuid is
 * only the join.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * TWO TRANSFERS ON ONE DAY — A REAL ROW IN THE REAL STATEMENT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 2026-05-26 has TWO sweeps to 6048: $3,522.50 and $20,610.00. That is not
 * hypothetical, it is in the file. It matters because `gl_submit_journal`
 * builds its idempotency key as `entity:source_kind:source_ref`, and when a key
 * already exists with the SAME line fingerprint the function returns
 * `GL_DUPLICATE_IGNORED` and writes nothing — correctly, that is what
 * idempotency is for.
 *
 * A key of date-plus-destination alone would therefore have merged those two
 * May 26 sweeps into one and SILENTLY DROPPED $3,522.50 of real money. Adding
 * the amount saves that particular pair, but not the general case: two
 * transfers of the same amount to the same account on the same day are
 * ordinary, and they would still collide, and the second one would still
 * disappear with a cheerful "already recorded" message.
 *
 * So the caller must supply an `occurrence` — the 1-based position of this row
 * among identical rows in the same statement — and it is part of the key. It is
 * a required field rather than an optional one with a default of 1, because a
 * default would make the dangerous case (a second identical row) look exactly
 * like the safe case at every call site.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * FLEXIBILITY, WHICH MICHAEL ASKED FOR BY NAME
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Michael: "Even after the start of the new year though, I don't know exactly
 * how the cash flow will work, so we will need a system that allows
 * flexibility."
 *
 * This module therefore classifies by DESTINATION ACCOUNT rather than by
 * assuming every debit out of 6228 is a sweep to the store. A transfer to an
 * account it does not recognise is refused and shown, never guessed into the
 * nearest familiar bucket. When vendors start being paid from 6228 on November
 * 1 and payroll on January 1, those are new destinations, and an unrecognised
 * destination surfacing for review is the correct behaviour — not a silent
 * mis-post into a sweep that never happened.
 */

import { createHash } from "node:crypto";

import { type EntityCode } from "@/lib/accounting/posting-core";
import { formatMoneyCents } from "@/lib/atm/atm-core";

/* ═════════════════════════════════════════════════════════════════════════════
 * THE ACCOUNTS AND THE BANK ACCOUNT NUMBERS
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * `10300 Bank — ATM Vault Account`, an asset.
 * `allowed_entity_codes = {atm, greenway}`, so an ATM-books line is permitted.
 * DEBIT-normal after migration 0178 corrected 0173's is_contra slip.
 */
export const ACCOUNT_ATM_VAULT = "10300";

/**
 * `10200 Bank — Operating`, an asset. CONTROL, reconciled to the Plaid feed.
 * `allowed_entity_codes` is null (all entities). Also debit-normal per 0178.
 */
export const ACCOUNT_BANK_OPERATING = "10200";

/**
 * `36000 Due To / From Related Entity`, a liability, credit-normal.
 * Seed comment: "Must net to ZERO across all four on consolidation — a
 * standing close check." That netting is the whole design of the pair below.
 */
export const ACCOUNT_DUE_TO_FROM = "36000";

/**
 * `41000 Shareholder Distributions`, `equity` with `is_contra = true`, so
 * DEBIT-normal. Seed comment: "WHICH shareholder is a dimension
 * (shareholder_id), not an account."
 *
 * Used on ONE side only. See the header: a matching credit on another set of
 * books would net the distribution to zero across the group.
 */
export const ACCOUNT_SHAREHOLDER_DISTRIBUTIONS = "41000";

/**
 * The bank accounts, as Michael named them.
 *
 * Verbatim from his message: "The atm account is 6228, 3557 is my personal
 * checking account and 6048 is the cannabis checking account."
 */
export const BANK_ATM = "6228";
export const BANK_CANNABIS = "6048";
export const BANK_PERSONAL = "3557";

/* ═════════════════════════════════════════════════════════════════════════════
 * SHAPES
 * ═════════════════════════════════════════════════════════════════════════════ */

/** One `TRANSFER FROM Xnnnn TO Xnnnn` line off the Timberland statement. */
export type SweepFacts = {
  /** ISO `yyyy-mm-dd`, the bank's processed date. */
  readonly processedDate: string;
  /** The statement description, VERBATIM. Parsed, never trusted blindly. */
  readonly description: string;
  /** Always positive integer cents. Direction comes from `creditOrDebit`. */
  readonly amountCents: number;
  /** The bank's own word: "Debit" leaves 6228, "Credit" arrives in it. */
  readonly creditOrDebit: string;
  /**
   * 1-based position of this row among IDENTICAL rows (same date, same
   * destination, same amount) in the same statement.
   *
   * Required, not defaulted. 2026-05-26 really does carry two sweeps, and two
   * identical ones would collide on the ledger's idempotency key and lose
   * money silently. A default of 1 would hide that at every call site.
   */
  readonly occurrence: number;
};

/** What kind of movement this turned out to be. */
export type SweepKind = "intercompany" | "distribution" | "unrecognised";

/** One line of a proposed entry. Positive = debit, negative = credit. */
export type SweepLine = {
  readonly accountCode: string;
  readonly amountCents: number;
  readonly description: string;
};

/**
 * A proposed entry, or pair of entries.
 *
 * `entityB` is null for a distribution, which has exactly one side. Making it
 * nullable rather than inventing a second, nearly-identical proposal type keeps
 * one shape to review on screen; making it NULL rather than a copy of `entityA`
 * means a caller cannot accidentally submit a one-sided entry through the
 * intercompany path, because that path requires two different entities.
 */
export type SweepProposal = {
  readonly kind: SweepKind;
  readonly journalDate: string;
  /**
   * The uuid tying the two halves together. Empty string when refused.
   * Deterministic — see `sweepRefUuid`.
   */
  readonly ref: string;
  /** The human-readable natural key. This is what an auditor reads. */
  readonly naturalKey: string;
  readonly memo: string;
  readonly entityA: EntityCode;
  readonly linesA: readonly SweepLine[];
  readonly sourceRefA: string;
  /** Null for a one-sided entry (a distribution). */
  readonly entityB: EntityCode | null;
  readonly linesB: readonly SweepLine[];
  readonly sourceRefB: string;
  /** Always false. Intercompany is never automatic. */
  readonly postable: false;
  readonly whyNotAutomatic: string;
  /** Set when this line cannot be turned into an entry at all. */
  readonly refusal: string | null;
  /** Stated on every proposal, so nothing rests on an unrecorded belief. */
  readonly assumptionNote: string | null;
};

/**
 * Quoted from `NEVER_AUTOPOST_REASONS.intercompany` in `posting-core`, so the
 * words on Michael's screen and the rule in the ledger cannot drift apart.
 * A test asserts this equality rather than trusting the copy.
 */
export const SWEEP_WHY_NOT_AUTOMATIC =
  "Money moving between your own books is the most drift-prone entry there is, and it is only about 24 entries a year — automation would save minutes and risk the balance sheet.";

/* ═════════════════════════════════════════════════════════════════════════════
 * READING THE BANK'S OWN WORDS
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Pull the two account tails out of `TRANSFER FROM X6228 TO X6048`.
 *
 * Returns null when the description is not a transfer at all, which is the
 * common case: 230 of the statement's 301 rows are `DLY SETTLE MVNT`, three are
 * `ACCOUNT ANALYSIS CHARGE` and one is `EFTRANSACT PAYMENT ALLIANCE PPD`. Those
 * are not this function's business and it says so by returning null rather than
 * by guessing.
 *
 * The regex is anchored and deliberately narrow. A looser "find any four
 * digits" would match the terminal id `HG26499` sitting in the settlement
 * descriptions and would invent transfers that never happened.
 */
export function parseTransferDescription(
  description: string,
): { readonly from: string; readonly to: string } | null {
  const m = /^TRANSFER\s+FROM\s+X(\d{4})\s+TO\s+X(\d{4})\s*$/i.exec((description ?? "").trim());
  if (!m) return null;
  return { from: m[1] as string, to: m[2] as string };
}

/** `yyyy-mm-dd`, and a real day. */
function isIsoDate(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split("-").map((p) => Number(p));
  const y = parts[0] as number;
  const m = parts[1] as number;
  const d = parts[2] as number;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Why a statement line cannot become an entry, or null when it can.
 *
 * The unrecognised-destination case is the one that earns its keep. Michael is
 * about to start paying vendors from 6228 on November 1 and payroll on
 * January 1. Those payments will appear here as debits out of the ATM account
 * to destinations this module has never seen, and the right response is to stop
 * and show him, not to assume the nearest familiar shape.
 */
export function sweepRefusal(f: SweepFacts): string | null {
  if (!isIsoDate(f.processedDate)) {
    return `"${String(f.processedDate)}" is not a real calendar date, so this transfer cannot be dated in the ledger.`;
  }
  if (!Number.isSafeInteger(f.amountCents)) {
    return "This transfer's amount is not a whole number of cents, so it is not a figure the ledger can hold exactly.";
  }
  if (f.amountCents <= 0) {
    return "This transfer has no amount, and an entry for zero moves no money.";
  }
  if (!Number.isSafeInteger(f.occurrence) || f.occurrence < 1) {
    return (
      "This transfer has no position recorded among the identical transfers on its day. " +
      "Two transfers of the same amount to the same account on the same day are ordinary, " +
      "and without telling them apart the ledger would treat the second as a repeat of the " +
      "first and record only one of them."
    );
  }
  const parsed = parseTransferDescription(f.description);
  if (parsed === null) {
    return `"${String(f.description)}" is not a transfer between two accounts, so it is not a sweep. It is being left alone rather than guessed at.`;
  }
  if (parsed.from !== BANK_ATM) {
    return `This transfer leaves account ${parsed.from}, not the ATM account (${BANK_ATM}). Only movements out of the ATM account are handled here.`;
  }
  if (parsed.to !== BANK_CANNABIS && parsed.to !== BANK_PERSONAL) {
    return (
      `Money left the ATM account for account ${parsed.to}, which is not the cannabis ` +
      `account (${BANK_CANNABIS}) or your personal checking (${BANK_PERSONAL}). Nothing is ` +
      `assumed about where it went or why, so this is being shown to you to classify.`
    );
  }
  if ((f.creditOrDebit ?? "").trim().toLowerCase() !== "debit") {
    return (
      `The bank recorded this as a "${String(f.creditOrDebit)}" rather than a debit, so money ` +
      `moved INTO the ATM account rather than out of it. That is the reverse of a sweep and ` +
      `is being shown to you rather than posted backwards.`
    );
  }
  return null;
}

/* ═════════════════════════════════════════════════════════════════════════════
 * THE KEYS
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * `atm-sweep:<date>:<destination>:<cents>#<occurrence>`.
 *
 * Every component is load-bearing. Date and destination and amount identify the
 * movement; the occurrence distinguishes two identical movements on one day,
 * which the real statement shows happens.
 */
export function sweepNaturalKey(f: SweepFacts, to: string): string {
  return `atm-sweep:${f.processedDate}:${to}:${f.amountCents}#${f.occurrence}`;
}

/**
 * A fixed, arbitrary namespace for ATM sweep refs. Generated once and frozen
 * here: if it ever changes, every previously-issued ref changes with it and
 * yesterday's two halves stop pointing at each other.
 */
const SWEEP_UUID_NAMESPACE = "3f2a7c14-9b8e-4d55-a1c2-6e0f5b83d907";

/**
 * RFC 4122 version 5 UUID (SHA-1, name-based) over the fixed namespace.
 *
 * Written out rather than pulled from a dependency because it is fifteen lines
 * and the repository has no uuid library; `node:crypto` is already used by
 * eight modules here.
 *
 * Deterministic on purpose: re-importing the same bank statement must produce
 * the SAME ref, or the two halves of an entry could no longer be tied together
 * after a re-import. Verified against Python's `uuid.uuid5` for the four real
 * statement keys — the self-tests below assert the measured values.
 */
export function sweepRefUuid(naturalKey: string): string {
  const nsHex = SWEEP_UUID_NAMESPACE.replace(/-/g, "");
  const nsBytes = Buffer.from(nsHex, "hex");
  const digest = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(naturalKey, "utf8")])).digest();
  const b = Buffer.from(digest.subarray(0, 16));
  // Version 5 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/* ═════════════════════════════════════════════════════════════════════════════
 * THE BUILDER
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Build the proposal for one transfer off the ATM account.
 *
 * THE SWEEP TO THE STORE (6228 → 6048), in plain English:
 *
 *   ON THE ATM BOOKS    debit  36000  the store now owes the ATM business
 *                       credit 10300  cash left the vault account
 *
 *   ON THE STORE BOOKS  debit  10200  cash arrived in the operating account
 *                       credit 36000  the store now owes the ATM business
 *
 * The two `36000` legs are equal and opposite, which is what makes the account
 * net to zero across all four entities on consolidation — the standing close
 * check its own seed comment describes.
 *
 * THE TRANSFER TO PERSONAL (6228 → 3557) is not that, and is not a pair:
 *
 *   ON THE ATM BOOKS    debit  41000  a distribution to the owner
 *                       credit 10300  cash left the vault account
 *
 * One entry, one set of books. The header explains at length why the second
 * half the first draft proposed would have netted the distribution to zero
 * across the group and understated Michael's §1368 basis analysis.
 */
export function buildSweepProposal(f: SweepFacts): SweepProposal {
  const refusal = sweepRefusal(f);
  const parsed = parseTransferDescription(f.description);
  const to = parsed?.to ?? "";

  if (refusal !== null) {
    return {
      kind: "unrecognised",
      journalDate: f.processedDate,
      ref: "",
      naturalKey: "",
      memo: `Transfer out of the ATM account on ${f.processedDate} — not posted`,
      entityA: "atm",
      linesA: [],
      sourceRefA: "",
      entityB: null,
      linesB: [],
      sourceRefB: "",
      postable: false,
      whyNotAutomatic: SWEEP_WHY_NOT_AUTOMATIC,
      refusal,
      assumptionNote: null,
    };
  }

  const cents = f.amountCents;
  const naturalKey = sweepNaturalKey(f, to);
  const ref = sweepRefUuid(naturalKey);

  if (to === BANK_PERSONAL) {
    return {
      kind: "distribution",
      journalDate: f.processedDate,
      ref,
      naturalKey,
      memo: `Owner distribution from the ATM account on ${f.processedDate}`,
      entityA: "atm",
      linesA: [
        {
          accountCode: ACCOUNT_SHAREHOLDER_DISTRIBUTIONS,
          amountCents: cents,
          description: `Distribution to you from the ATM business on ${f.processedDate}.`,
        },
        {
          accountCode: ACCOUNT_ATM_VAULT,
          amountCents: -cents,
          description: `Cash leaving the ATM account for your personal checking (${BANK_PERSONAL}).`,
        },
      ],
      sourceRefA: `${naturalKey}:atm`,
      entityB: null,
      linesB: [],
      sourceRefB: "",
      postable: false,
      whyNotAutomatic: SWEEP_WHY_NOT_AUTOMATIC,
      refusal: null,
      assumptionNote:
        `Treated as an owner distribution rather than a loan between your businesses. Money you ` +
        `take from your own company for your own use is only a loan if it is documented as one, ` +
        `with a rate and a term, and actually repaid — and an undocumented loan to an owner is ` +
        `routinely re-characterised as a distribution anyway. Recorded on the ATM books only: ` +
        `money left the business, and where it went afterwards is not a claim on any of your ` +
        `entities. If this was meant to be a repayable advance, say so and it moves to ` +
        `${ACCOUNT_DUE_TO_FROM} instead.`,
    };
  }

  return {
    kind: "intercompany",
    journalDate: f.processedDate,
    ref,
    naturalKey,
    memo: `ATM cash sweep to the cannabis account on ${f.processedDate}`,
    entityA: "atm",
    linesA: [
      {
        accountCode: ACCOUNT_DUE_TO_FROM,
        amountCents: cents,
        description: `Owed to the ATM business by the store for the ${f.processedDate} cash sweep.`,
      },
      {
        accountCode: ACCOUNT_ATM_VAULT,
        amountCents: -cents,
        description: `Cash swept out of the ATM account (${BANK_ATM}) to the cannabis account (${BANK_CANNABIS}).`,
      },
    ],
    sourceRefA: `${naturalKey}:atm`,
    entityB: "greenway",
    linesB: [
      {
        accountCode: ACCOUNT_BANK_OPERATING,
        amountCents: cents,
        description: `Cash arriving in the cannabis account (${BANK_CANNABIS}) from the ATM sweep.`,
      },
      {
        accountCode: ACCOUNT_DUE_TO_FROM,
        amountCents: -cents,
        description: `Owed by the store to the ATM business for the ${f.processedDate} cash sweep.`,
      },
    ],
    sourceRefB: `${naturalKey}:greenway`,
    postable: false,
    whyNotAutomatic: SWEEP_WHY_NOT_AUTOMATIC,
    refusal: null,
    assumptionNote:
      `Recorded as an advance between two businesses you own, which is what a transfer between ` +
      `their bank accounts is. ${ACCOUNT_DUE_TO_FROM} must net to zero across all four sets of ` +
      `books when they are consolidated, so both halves have to exist and be posted together.`,
  };
}

/**
 * Net of a proposal's sides, and whether each side actually had any lines.
 *
 * `hasA` / `hasB` exist because `[].reduce(…, 0)` is zero, so a balance check
 * on an empty proposal passes for the wrong reason — an assertion that cannot
 * fail (standing rule 39). A caller must ask whether there were lines at all.
 */
export function sweepBalance(p: SweepProposal): {
  readonly a: number;
  readonly b: number;
  readonly hasA: boolean;
  readonly hasB: boolean;
} {
  return {
    a: p.linesA.reduce((s, l) => s + l.amountCents, 0),
    b: p.linesB.reduce((s, l) => s + l.amountCents, 0),
    hasA: p.linesA.length > 0,
    hasB: p.linesB.length > 0,
  };
}

/**
 * Build proposals for a whole statement, keeping only the transfer lines.
 *
 * `DLY SETTLE MVNT` and `ACCOUNT ANALYSIS CHARGE` rows are dropped here, and
 * that is a filter rather than a refusal on purpose: they are not failed
 * sweeps, they are simply not sweeps, and listing 234 "this is not a transfer"
 * refusals would bury the one row that genuinely needs attention.
 *
 * A row that IS a transfer and still cannot be handled is kept, with its
 * reason — including the unrecognised destinations that November and January
 * will start producing.
 */
export function buildSweepProposals(rows: readonly SweepFacts[]): readonly SweepProposal[] {
  return rows.filter((r) => parseTransferDescription(r.description) !== null).map(buildSweepProposal);
}

/**
 * Assign each row its 1-based position among IDENTICAL rows.
 *
 * Offered here so no call site has to invent the occurrence itself. Identity is
 * date + description + amount, which is everything the bank gives us; two rows
 * agreeing on all three are indistinguishable in the statement and must still
 * be distinguishable in the ledger.
 */
export function withOccurrences(
  rows: readonly Omit<SweepFacts, "occurrence">[],
): readonly SweepFacts[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.processedDate}|${r.description.trim().toUpperCase()}|${r.amountCents}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, occurrence: n };
  });
}

/** Counts for a screen. Distributions are reported separately, never merged. */
export function summariseSweeps(proposals: readonly SweepProposal[]): {
  readonly total: number;
  readonly intercompany: number;
  readonly intercompanyCents: number;
  readonly distributions: number;
  readonly distributionCents: number;
  readonly refused: number;
  readonly sentence: string;
} {
  let intercompany = 0;
  let intercompanyCents = 0;
  let distributions = 0;
  let distributionCents = 0;
  let refused = 0;
  for (const p of proposals) {
    if (p.refusal !== null) {
      refused += 1;
      continue;
    }
    const cents = p.linesA.reduce((s, l) => s + Math.max(0, l.amountCents), 0);
    if (p.kind === "distribution") {
      distributions += 1;
      distributionCents += cents;
    } else {
      intercompany += 1;
      intercompanyCents += cents;
    }
  }
  const money = formatMoneyCents;
  const parts: string[] = [];
  if (intercompany > 0) {
    parts.push(
      `${intercompany} ${intercompany === 1 ? "sweep" : "sweeps"} to the cannabis account totalling ${money(intercompanyCents)}`,
    );
  }
  if (distributions > 0) {
    parts.push(
      `${distributions} ${distributions === 1 ? "transfer" : "transfers"} to your personal checking totalling ${money(distributionCents)}, proposed as ${distributions === 1 ? "a distribution" : "distributions"}`,
    );
  }
  if (refused > 0) {
    parts.push(
      `${refused} ${refused === 1 ? "transfer that needs" : "transfers that need"} your classification`,
    );
  }
  const sentence =
    parts.length === 0
      ? "No transfers out of the ATM account were found."
      : `${parts.join(", and ")}. Nothing posts until you approve it.`;
  return {
    total: proposals.length,
    intercompany,
    intercompanyCents,
    distributions,
    distributionCents,
    refused,
    sentence,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * SELF-TESTS (tsx-runnable; PURE)
 * ═════════════════════════════════════════════════════════════════════════════ */

export function __runAtmSweepCoreTests(): void {
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

  // The real 2026-08-21 sweep, measured from the statement.
  const sweep: SweepFacts = {
    processedDate: "2026-08-21",
    description: "TRANSFER FROM X6228 TO X6048",
    amountCents: 1_142_750,
    creditOrDebit: "Debit",
    occurrence: 1,
  };
  // The real 2026-07-03 transfer to personal, measured from the statement.
  const personal: SweepFacts = {
    processedDate: "2026-07-03",
    description: "TRANSFER FROM X6228 TO X3557",
    amountCents: 524_250,
    creditOrDebit: "Debit",
    occurrence: 1,
  };

  const p = buildSweepProposal(sweep);
  ok(p.refusal === null, "the real sweep is accepted");
  ok(p.kind === "intercompany", "a transfer to 6048 is intercompany");
  ok(p.entityA === "atm" && p.entityB === "greenway", "it spans the ATM and store books");
  const bal = sweepBalance(p);
  ok(bal.a === 0 && bal.b === 0, "both halves balance");
  ok(bal.hasA && bal.hasB, "both halves actually have lines, so the balance means something");
  ok(p.postable === false, "intercompany never posts itself");

  // The two 36000 legs must be equal and opposite, or consolidation will not net.
  const a36 = p.linesA.find((l) => l.accountCode === ACCOUNT_DUE_TO_FROM)?.amountCents ?? 0;
  const b36 = p.linesB.find((l) => l.accountCode === ACCOUNT_DUE_TO_FROM)?.amountCents ?? 0;
  ok(a36 === -b36 && a36 !== 0, "the two 36000 legs are equal and opposite");
  ok(p.sourceRefA !== p.sourceRefB, "each half carries its own source ref");

  // Direction: cash LEAVES the ATM vault, ARRIVES in the operating account.
  ok(
    (p.linesA.find((l) => l.accountCode === ACCOUNT_ATM_VAULT)?.amountCents ?? 0) < 0,
    "the ATM vault is credited — cash left it",
  );
  ok(
    (p.linesB.find((l) => l.accountCode === ACCOUNT_BANK_OPERATING)?.amountCents ?? 0) > 0,
    "the operating account is debited — cash arrived",
  );

  // --- the distribution -----------------------------------------------------
  const d = buildSweepProposal(personal);
  ok(d.kind === "distribution", "a transfer to 3557 is a distribution, not a sweep");
  ok(d.entityB === null, "a distribution is ONE entry, not an intercompany pair");
  ok(d.linesB.length === 0, "there is no second half to a distribution");
  ok(
    d.linesA.some((l) => l.accountCode === ACCOUNT_SHAREHOLDER_DISTRIBUTIONS),
    "it hits 41000, not 36000",
  );
  ok(
    !d.linesA.some((l) => l.accountCode === ACCOUNT_DUE_TO_FROM),
    "an owner draw is not booked as a debt owed to the business",
  );
  // 41000 is contra-equity and therefore DEBIT-normal (0173 + 0178). A credit
  // would be flagged abnormal by gl_trial_balance and would net the
  // distribution to zero across the group.
  ok(
    (d.linesA.find((l) => l.accountCode === ACCOUNT_SHAREHOLDER_DISTRIBUTIONS)?.amountCents ?? 0) > 0,
    "41000 is DEBITED — it is contra-equity, so a credit would be an abnormal balance",
  );
  ok((d.assumptionNote ?? "").includes("re-characterised"), "the judgment is stated, not hidden");
  const dbal = sweepBalance(d);
  ok(dbal.a === 0, "the distribution balances");
  ok(dbal.hasA && !dbal.hasB, "it has a first side and genuinely no second one");

  // --- the refs -------------------------------------------------------------
  // MEASURED against Python's uuid.uuid5 over namespace
  // 3f2a7c14-9b8e-4d55-a1c2-6e0f5b83d907, not asserted from memory.
  ok(
    p.naturalKey === "atm-sweep:2026-08-21:6048:1142750#1",
    `the natural key is human-readable (got ${p.naturalKey})`,
  );
  ok(
    p.ref === "335bca7a-305d-5f60-9553-14432d1d49d1",
    `the ref is the measured v5 uuid (got ${p.ref})`,
  );
  ok(
    d.ref === "85d434d7-bf2c-59b0-8208-3348d9f2e641",
    `the distribution ref is the measured v5 uuid (got ${d.ref})`,
  );
  ok(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.ref),
    "the ref is a syntactically valid version-5 uuid, which is what the uuid column requires",
  );
  ok(
    sweepRefUuid("atm-sweep:2026-08-21:6048:1142750#1") === p.ref,
    "the ref is deterministic — a re-import produces the same one",
  );

  // --- the two real transfers on 2026-05-26 --------------------------------
  const may26a: SweepFacts = {
    processedDate: "2026-05-26",
    description: "TRANSFER FROM X6228 TO X6048",
    amountCents: 352_250,
    creditOrDebit: "Debit",
    occurrence: 1,
  };
  const may26b: SweepFacts = { ...may26a, amountCents: 2_061_000 };
  ok(
    buildSweepProposal(may26a).ref !== buildSweepProposal(may26b).ref,
    "the two real 2026-05-26 sweeps get different refs",
  );
  ok(
    buildSweepProposal(may26a).ref === "d4d8b054-af33-582a-87fa-1fef1f7c60d7",
    "the first 2026-05-26 sweep's ref is the measured value",
  );
  // The dangerous case: two IDENTICAL transfers on one day.
  const twinA: SweepFacts = { ...sweep, occurrence: 1 };
  const twinB: SweepFacts = { ...sweep, occurrence: 2 };
  ok(
    buildSweepProposal(twinA).ref !== buildSweepProposal(twinB).ref,
    "two identical same-day transfers get different refs, so neither is swallowed as a duplicate",
  );
  ok(
    buildSweepProposal(twinA).sourceRefA !== buildSweepProposal(twinB).sourceRefA,
    "and different source refs, which is what the ledger's idempotency key is built from",
  );

  // --- occurrence assignment ------------------------------------------------
  const numbered = withOccurrences([
    { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 100, creditOrDebit: "Debit" },
    { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 100, creditOrDebit: "Debit" },
    { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 200, creditOrDebit: "Debit" },
  ]);
  ok(
    numbered[0]?.occurrence === 1 && numbered[1]?.occurrence === 2,
    "identical rows are numbered in order",
  );
  ok(numbered[2]?.occurrence === 1, "a different amount starts its own count");

  // --- parsing --------------------------------------------------------------
  ok(parseTransferDescription("TRANSFER FROM X6228 TO X6048")?.to === "6048", "parses the tail");
  ok(parseTransferDescription("DLY SETTLE MVNT - HG26499 CCD") === null, "a settlement is not a transfer");
  ok(parseTransferDescription("ACCOUNT ANALYSIS CHARGE") === null, "a fee is not a transfer");
  ok(
    parseTransferDescription("EFTRANSACT PAYMENT ALLIANCE PPD") === null,
    "the payment-alliance line is not a transfer either",
  );

  // --- refusals -------------------------------------------------------------
  ok(
    sweepRefusal({ ...sweep, description: "TRANSFER FROM X6228 TO X9999" }) !== null,
    "an unknown destination is refused, not guessed",
  );
  ok(
    sweepRefusal({ ...sweep, creditOrDebit: "Credit" }) !== null,
    "money moving the other way is refused rather than posted backwards",
  );
  ok(sweepRefusal({ ...sweep, amountCents: 0 }) !== null, "a zero transfer is refused");
  ok(sweepRefusal({ ...sweep, processedDate: "2026-02-30" }) !== null, "an impossible date is refused");
  ok(sweepRefusal({ ...sweep, occurrence: 0 }) !== null, "a missing occurrence is refused");
  ok(
    sweepRefusal({ ...sweep, description: "TRANSFER FROM X6048 TO X6228" }) !== null,
    "a transfer that does not leave the ATM account is refused",
  );

  // --- the population filter ------------------------------------------------
  const all = buildSweepProposals([
    sweep,
    personal,
    { ...sweep, description: "DLY SETTLE MVNT - HG26499 CCD" },
    { ...sweep, description: "ACCOUNT ANALYSIS CHARGE" },
  ]);
  ok(all.length === 2, "non-transfer rows are filtered, not refused one by one");

  const s = summariseSweeps(all);
  ok(s.intercompany === 1 && s.distributions === 1, "the summary keeps the two kinds apart");
  ok(s.distributionCents === 524_250, "the distribution total is the real figure");
  ok(s.sentence.includes("personal checking"), "the summary names the personal transfer");

  console.log(`atm-sweep-core self-tests: ${fail === 0 ? "all passed" : `${fail} FAILED`} (${pass} ok)`);
  if (fail > 0) throw new Error(`atm-sweep-core: ${fail} self-test(s) failed`);
}
