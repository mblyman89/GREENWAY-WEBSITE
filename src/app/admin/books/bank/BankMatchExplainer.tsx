/**
 * src/app/admin/books/bank/BankMatchExplainer.tsx   (slice books-05)
 *
 * THE PICTURE OF BANK MATCHING — and of the two ways it goes silently wrong.
 *
 * Michael asked for this in his own words (standing rule 1 — record requests
 * verbatim):
 *
 *   "I learn best visually... I have always needed a mentor, a cpa or cfo to
 *    shadow, I want our platform to be that mentor."
 *   "not just block, but explain why, and even better, show me a way to do it
 *    properly"
 *   "I want verbatim text baked in just the same and the visual explanations
 *    and any other type of hand holding you can give me."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PARTICULAR SCREEN NEEDS A PICTURE MORE THAN ANY OTHER
 * ---------------------------------------------------------------------------
 * Everywhere else in the books, a mistake announces itself. An out-of-balance
 * entry will not post. A bill with no vendor will not post. Bank matching is
 * the exception, and it is the exception in the worst possible way:
 *
 *     A WRONGLY MATCHED BANK TRANSACTION STILL BALANCES.
 *
 * Flip the sign and BOTH lines flip together. Debits still equal credits. No
 * screen turns red. The books look perfect and the tax return is wrong.
 *
 * You cannot teach that with an error message, because there is no error. The
 * only way to make it visible is to draw it — which is what §1 and §2 below do.
 *
 * ---------------------------------------------------------------------------
 * WHY NONE OF THE ARITHMETIC LIVES IN THIS FILE
 * ---------------------------------------------------------------------------
 * A diagram that drifts away from the engine is worse than no diagram: it
 * teaches the wrong thing, confidently, forever. Every number rendered here is
 * computed by `bank-match-core.ts` — the exact functions that run at posting
 * time. Change the rule and the picture changes with it, or the tests fail.
 *
 * This is a client component only because two of the panels are interactive.
 * It performs no I/O, makes no decisions of its own, and touches no money.
 */

"use client";

import { useState, useMemo } from "react";

import {
  plaidToLedgerCashCents,
  evaluateMatch,
  reconcile,
  reconciliationBars,
  formatSignedCents,
  labelForKind,
  type BankEventKind,
  type ReconciliationInput,
  type ReconciliationBar,
} from "@/lib/accounting/bank-match-core";

// The verbatim-quotation component. Shared, not local -- see the note below
// where the private copy used to live.
import { Quote } from "@/components/admin/books/AuthorityPanel";

// ===========================================================================
// SHARED PRESENTATION
// ===========================================================================

const CARD =
  "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";
const MONO = "font-mono tabular-nums";

/**
 * How each reconciliation bar is drawn.
 *
 * The engine already classifies every bar as `bank`, `books` or `gap`, and that
 * classification carries a real lesson: the bank statement is a FACT produced by
 * a third party, the ledger is a CLAIM produced by us, and a gap is the distance
 * between the two. Throwing that away and painting every bar the same grey would
 * discard the most useful thing on the screen.
 *
 * This is deliberately typed as a total record over `ReconciliationBar["tone"]`
 * rather than an index signature. If someone adds a fourth tone to the engine,
 * this file fails to compile. The alternative - a lookup that quietly returns
 * `undefined` and renders an unstyled bar with no caption - is precisely the
 * kind of silent drift the header of this file warns about.
 */
const BAR_TONE: Record<
  ReconciliationBar["tone"],
  { box: string; caption: string }
> = {
  bank: {
    box: "border-sky-400/30 bg-sky-400/[0.10]",
    caption: "fact - from the bank",
  },
  books: {
    box: "border-violet-400/30 bg-violet-400/[0.10]",
    caption: "claim - from your ledger",
  },
  gap: {
    box: "border-amber-400/30 bg-amber-400/[0.10]",
    caption: "the distance between them",
  },
};

/**
 * The verbatim-quotation component now lives in one shared place
 * (components/admin/books/AuthorityPanel) so that every books screen renders
 * someone else's words identically. It used to be defined privately here, which
 * meant three screens had three answers to "what does a quote look like".
 */

// ===========================================================================
// §1  THE SIGN WALL
// ===========================================================================
/**
 * The single most consequential idea in the slice, drawn.
 *
 * Standing rule 19 lists "backwards card signs" among the owner's real
 * historical failures. This panel exists so that the reason those happened is
 * obvious on sight rather than buried in a convention nobody wrote down.
 */
export function SignWall() {
  const [plaid, setPlaid] = useState(25_000);

  const ledger = useMemo(() => {
    try {
      return plaidToLedgerCashCents(plaid);
    } catch {
      return null;
    }
  }, [plaid]);

  /*
    Three states, not two.

    The slider can land exactly on zero (-100,000 + 40 x 2,500 = 0), and zero is
    neither an arrival nor a departure. A simple `plaid > 0` boolean would make
    this panel state, in confident bold type, that no money moved in either
    direction means money ARRIVED. The engine itself has a dedicated zero branch
    in `plaidToLedgerCashCents` - specifically so that negating zero cannot
    produce `-0` - and the picture has to respect the same three cases the
    engine does, or it is teaching something the engine does not do.
  */
  const direction: "out" | "in" | "none" =
    plaid > 0 ? "out" : plaid < 0 ? "in" : "none";

  return (
    <section className={CARD} aria-labelledby="signwall-h">
      <h2 id="signwall-h" className={H2}>
        The sign wall — why a backwards entry still balances
      </h2>

      <p className={`${P} mt-2`}>
        Your bank feed and your ledger use <strong>exactly opposite</strong>{" "}
        conventions for the same event. This is not a quirk of this software; it
        is the difference between how a bank describes your account and how
        double-entry bookkeeping describes it. One crossing has to happen, and it
        has to happen in exactly one place.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-sky-400/30/30 bg-sky-400/[0.10] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            The bank feed says
          </div>
          <div className={`mt-2 text-2xl font-bold ${MONO} text-sky-300`}>
            {formatSignedCents(plaid)}
          </div>
          <p className={`${MUTED} mt-2`}>
            <strong>Positive means money LEFT</strong> your account. The bank is
            describing what it did to your balance.
          </p>
        </div>

        <div className="rounded-md border border-violet-400/30/30 bg-violet-400/[0.10] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
            The ledger records
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${MONO} text-violet-300`}
          >
            {ledger === null ? "—" : formatSignedCents(ledger)}
          </div>
          <p className={`${MUTED} mt-2`}>
            <strong>Positive means DEBIT.</strong> A debit to cash means money
            arrived. So the same event carries the opposite sign.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-black/20 p-3">
        <div className="text-sm font-semibold text-white/85">
          {direction === "out"
            ? "Money LEFT the bank → the cash account is CREDITED"
            : direction === "in"
              ? "Money ARRIVED at the bank → the cash account is DEBITED"
              : "No money moved → there is nothing to debit and nothing to credit"}
        </div>
        <p className={`${MUTED} mt-1`}>
          The one sentence worth memorising:{" "}
          <em>money arriving in the bank debits the bank account; money leaving credits it.</em>
        </p>
      </div>

      <div className="mt-4">
        <label
          htmlFor="signwall-range"
          className="text-xs font-medium text-white/50"
        >
          Drag to see both directions
        </label>
        <input
          id="signwall-range"
          type="range"
          min={-100_000}
          max={100_000}
          step={2_500}
          value={plaid}
          onChange={(e) => setPlaid(Number(e.target.value))}
          className="mt-1 w-full accent-violet-600"
        />
      </div>

      <div className="mt-4 rounded-md border-l-4 border-rose-400/30 bg-rose-400/[0.10] p-3">
        <div className="text-sm font-semibold text-rose-300">
          Why this is the most dangerous mistake in the whole system
        </div>
        <p className={`${P} mt-1`}>
          If the sign is flipped, <strong>both lines of the entry flip together</strong>.
          The journal still balances. Debits still equal credits. Nothing turns
          red, no report complains, and no screen anywhere shows a problem. The
          only symptom is a wrong tax return — found, if ever, by an examiner
          rather than by you. That is exactly how the backwards card signs got
          into the old books and stayed there.
        </p>
        <p className={`${MUTED} mt-2`}>
          The books refuse a match whose direction disagrees with the bank, and
          the database refuses it a second time independently. A screen can be
          bypassed; a constraint cannot.
        </p>
      </div>
    </section>
  );
}

// ===========================================================================
// §2  TIES vs COMPLETE — the defect that looks like success
// ===========================================================================
/**
 * This panel exists because of a real defect found in this slice (D8).
 *
 * The engine reported a month as tying perfectly while an expense was missing
 * from the books entirely. That is not a rounding problem; it is a reconciliation
 * that congratulates you for work you have not done. The picture below is the
 * only way to make the mechanism obvious, because the arithmetic genuinely does
 * come to zero.
 */
export function TiesIsNotDone() {
  const [feeRecorded, setFeeRecorded] = useState(false);

  const result = useMemo(() => {
    const FEE = 7_700; // $77.00 service charge the bank has already taken
    const input: ReconciliationInput = feeRecorded
      ? {
          // The entry has been posted: books and bank agree, nothing outstanding.
          statementClosingCents: 1_000_000 - FEE,
          ledgerBalanceCents: 1_000_000 - FEE,
          unmatchedBankRows: [],
          unmatchedJournals: [],
        }
      : {
          // The bank took the fee. The books have never heard of it.
          statementClosingCents: 1_000_000 - FEE,
          ledgerBalanceCents: 1_000_000,
          unmatchedBankRows: [
            {
              transactionId: "demo-fee",
              accountId: "demo",
              amountCents: FEE,
              date: "2026-11-30",
              name: "MONTHLY SERVICE CHARGE",
              merchantName: null,
              pending: false,
              removed: false,
              categoryPrimary: null,
            },
          ],
          unmatchedJournals: [],
        };
    return reconcile(input);
  }, [feeRecorded]);

  const bars = useMemo(() => reconciliationBars(result), [result]);

  return (
    <section className={CARD} aria-labelledby="ties-h">
      <h2 id="ties-h" className={H2}>
        &ldquo;It ties&rdquo; is not the same as &ldquo;it&rsquo;s finished&rdquo;
      </h2>

      <p className={`${P} mt-2`}>
        A reconciliation has two kinds of loose end, and treating them as one
        thing is how a whole year of bank charges goes unclaimed. They are not
        interchangeable:
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-emerald-400/30/30 bg-emerald-400/[0.10] p-3">
          <div className="text-sm font-semibold text-emerald-300">
            Timing difference — nothing to do
          </div>
          <p className={`${MUTED} mt-1`}>
            A cheque you wrote that hasn&rsquo;t been cashed. A deposit still in
            transit. <strong>Your books are already right</strong>; the bank
            simply hasn&rsquo;t caught up. These clear themselves. Posting an
            entry for one would be wrong.
          </p>
        </div>
        <div className="rounded-md border border-rose-400/30/30 bg-rose-400/[0.10] p-3">
          <div className="text-sm font-semibold text-rose-300">
            Unrecorded item — an entry is required
          </div>
          <p className={`${MUTED} mt-1`}>
            A bank fee. Interest. An NSF return. A forgotten auto-debit.{" "}
            <strong>Your books are wrong until you post it.</strong> These never
            clear themselves, because nothing is coming to clear them.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setFeeRecorded((v) => !v)}
          className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          {feeRecorded
            ? "Un-post the $77.00 bank fee"
            : "Post the entry for the $77.00 bank fee"}
        </button>
        <span className={MUTED}>
          The bank has already taken the fee in both cases. The only thing that
          changes is whether your books know about it.
        </span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-black/20 p-3">
          <dt className={MUTED}>Difference</dt>
          <dd className={`mt-1 text-xl font-bold ${MONO} text-white/90`}>
            {formatSignedCents(result.differenceCents)}
          </dd>
        </div>
        <div
          className={`rounded-md p-3 ${
            result.ties
              ? "bg-emerald-400/[0.10]"
              : "bg-rose-400/[0.10]"
          }`}
        >
          <dt className={MUTED}>Does the arithmetic close?</dt>
          <dd className="mt-1 text-xl font-bold text-white/90">
            {result.ties ? "Yes — it ties" : "No"}
          </dd>
        </div>
        <div
          className={`rounded-md p-3 ${
            result.complete
              ? "bg-emerald-400/[0.10]"
              : "bg-amber-400/[0.10]"
          }`}
        >
          <dt className={MUTED}>Is the month finished?</dt>
          <dd className="mt-1 text-xl font-bold text-white/90">
            {result.complete ? "Yes — safe to sign off" : "No — work remains"}
          </dd>
        </div>
      </dl>

      {/*
        NOTE ON WHAT GATES THIS WARNING.

        It would be easier to write `{!feeRecorded && ...}` and gate the trap
        callout on the toggle. That would be a lie of convenience: the callout
        would be driven by which button was last pressed rather than by what
        the engine actually concluded. The condition below is the engine's own
        definition of the trap - the arithmetic closed, and the month is still
        not finished. If `reconcile()` ever stops producing that combination,
        this warning correctly stops appearing, instead of appearing forever
        because a boolean in a component said so.

        For the same reason the amount is read from `result.differenceCents`
        and not typed in as a literal zero. The whole point of this panel is
        that the difference really is zero; that claim has to be computed, or
        it is just a caption.
      */}
      {result.ties && !result.complete && (
        <div className="mt-4 rounded-md border-l-4 border-amber-400/30 bg-amber-400/[0.10] p-3">
          <div className="text-sm font-semibold text-amber-300">
            Look carefully: the difference is{" "}
            {formatSignedCents(result.differenceCents)} and the month is still
            not finished.
          </div>
          <p className={`${P} mt-1`}>
            This is the trap, and it is worth understanding once so it never
            catches you. The fee is <em>already inside</em> the closing balance
            the bank reported. When the reconciliation adds it to your side to
            compare like with like, it{" "}
            <strong>cancels itself out</strong> — so the arithmetic closes
            perfectly while the expense is missing from your profit and loss
            entirely. Balancing and being finished are two different questions,
            so this screen asks them separately and will not let you sign off on
            the first one alone.
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {result.narrative.map((line, i) => (
          <li key={i} className={P}>
            {line}
          </li>
        ))}
      </ul>

      {bars.length > 0 && (
        <div className="mt-4 space-y-2">
          {bars.map((b, i) => (
            <div
              key={i}
              className={`rounded-md border-l-4 p-3 ${BAR_TONE[b.tone].box}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-white/80">
                  {b.label}
                  <span className={`ml-2 ${MUTED} font-normal`}>
                    {BAR_TONE[b.tone].caption}
                  </span>
                </span>
                <span className={`text-sm ${MONO} text-white/70`}>
                  {formatSignedCents(b.cents)}
                </span>
              </div>
              {b.hint && <p className={`${MUTED} mt-1`}>{b.hint}</p>}
            </div>
          ))}
        </div>
      )}

      <Quote cite="Washington State Auditor's Office, BARS Manual §3.1.9.15(4)">
        &ldquo;Identifying transactions from the bank accounts need to be
        recorded in the accounting records. For example, some of these items
        could include interest earned, bank fees or charges, NSF checks, and
        unrecorded deposits ... Accounting records should be updated for all such
        transactions identified in the bank statements.&rdquo;
      </Quote>
    </section>
  );
}

// ===========================================================================
// §3  THE REFUSAL SANDBOX — try to break it, and see what it says
// ===========================================================================
/**
 * Michael asked to be shown "a way to do it properly", not merely stopped. This
 * panel lets him drive the engine into each refusal deliberately, in a place
 * where nothing posts, so the first time he meets a given block is here rather
 * than on a live entry at eleven at night.
 */
const SCENARIOS: {
  id: string;
  title: string;
  blurb: string;
  build: () => ReturnType<typeof evaluateMatch>;
}[] = [
  {
    id: "clean",
    title: "A clean, correct match",
    blurb:
      "A $250 supplier payment, same day, right entity, right direction. This is what a good match looks like — the engine says yes.",
    build: () =>
      evaluateMatch({
        row: mkRow({}),
        candidate: mkJournal({}),
        eventKind: "vendor_payment",
        entityCode: "greenway",
      }),
  },
  {
    id: "sign",
    title: "The sign is backwards",
    blurb:
      "Same amount, same day — but the entry says money came IN while the bank says it went OUT. This entry balances perfectly. Nothing else would ever catch it.",
    build: () =>
      evaluateMatch({
        row: mkRow({}),
        candidate: mkJournal({ cashLineCents: +25_000 }),
        eventKind: "vendor_payment",
        entityCode: "greenway",
      }),
  },
  {
    id: "twice",
    title: "The same bank line matched twice",
    blurb:
      "One line at the bank is one event in the world. Match it twice and the expense doubles — while both entries balance and the books look healthy.",
    build: () =>
      evaluateMatch({
        row: mkRow({}),
        candidate: mkJournal({}),
        eventKind: "vendor_payment",
        entityCode: "greenway",
        bankRowAlreadyMatched: true,
      }),
  },
  {
    id: "entity",
    title: "Money from the wrong set of books",
    blurb:
      "A shop bank line matched to a land-holding entry. Keeping the four sets of books genuinely separate is what protects the tax treatment of each one.",
    build: () =>
      evaluateMatch({
        row: mkRow({}),
        candidate: mkJournal({ entityCode: "landholding" }),
        eventKind: "vendor_payment",
        entityCode: "greenway",
      }),
  },
  {
    id: "loan",
    title: "A loan payment as a single number",
    blurb:
      "One payment leaves the bank, but three separate things happen and only one is an expense. Coding it all to an expense account overstates the deduction every month.",
    build: () =>
      evaluateMatch({
        row: mkRow({ amountCents: 150_000 }),
        candidate: null,
        eventKind: "loan_payment",
        entityCode: "greenway",
      }),
  },
  {
    id: "personal",
    title: "A personal cost inside the business",
    blurb:
      "If the company paid for something personal, that is an owner draw — not an expense. Recorded as an expense it is wrong in three places at once.",
    build: () =>
      evaluateMatch({
        row: mkRow({}),
        candidate: null,
        eventKind: "bank_fee",
        entityCode: "greenway",
        proposedCostClasses: ["personal"],
      }),
  },
  {
    id: "pre",
    title: "A date before the books begin",
    blurb:
      "Anything before the cut-over belongs to the Sage books and to years already closed and filed. Posting it here creates a second, contradictory record.",
    build: () =>
      evaluateMatch({
        row: mkRow({ date: "2025-12-31" }),
        candidate: mkJournal({ journalDate: "2025-12-31" }),
        eventKind: "vendor_payment",
        entityCode: "greenway",
      }),
  },
  {
    id: "unknown",
    title: "A line nobody has identified yet",
    blurb:
      "The engine will not guess. A guess that lands in the wrong account is worse than a line that waits for you, because a guess looks finished and nobody rechecks it.",
    build: () =>
      evaluateMatch({
        row: mkRow({ name: "ACH DEBIT 4471" }),
        candidate: null,
        eventKind: "unknown",
        entityCode: "greenway",
      }),
  },
];

function mkRow(over: Record<string, unknown>) {
  return {
    transactionId: "demo",
    accountId: "demo",
    amountCents: 25_000,
    date: "2026-11-05",
    name: "SUPPLIER PAYMENT",
    merchantName: null,
    pending: false,
    removed: false,
    categoryPrimary: null,
    ...over,
  } as Parameters<typeof evaluateMatch>[0]["row"];
}

function mkJournal(over: Record<string, unknown>) {
  return {
    journalId: "demo",
    entityCode: "greenway",
    journalDate: "2026-11-05",
    cashLineCents: -25_000,
    cashAccountCode: "10200",
    memo: "supplier payment",
    sourceKind: "purchase",
    alreadyMatched: false,
    ...over,
  } as NonNullable<Parameters<typeof evaluateMatch>[0]["candidate"]>;
}

export function RefusalSandbox() {
  const [active, setActive] = useState(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === active) ?? SCENARIOS[0];
  const verdict = useMemo(() => scenario.build(), [scenario]);

  return (
    <section className={CARD} aria-labelledby="sandbox-h">
      <h2 id="sandbox-h" className={H2}>
        Try to break it — every refusal, with the reason
      </h2>
      <p className={`${P} mt-2`}>
        Nothing here posts anything. These are the real checks, running on
        deliberately broken input, so that the first time you meet a given block
        is here and not on a live entry late at night.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            aria-pressed={active === s.id}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              active === s.id
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>

      <p className={`${P} mt-4`}>{scenario.blurb}</p>

      <div
        className={`mt-3 rounded-md p-3 ${
          verdict.postable
            ? "bg-emerald-400/[0.10]"
            : "bg-rose-400/[0.10]"
        }`}
      >
        <div className="text-sm font-semibold text-white/90">
          {verdict.postable
            ? "Allowed — this match may post."
            : "Refused — this match cannot post."}
        </div>
        <div className={`${MUTED} mt-1`}>
          Cash line this would post:{" "}
          <span className={MONO}>{formatSignedCents(verdict.ledgerCashCents)}</span>{" "}
          ({verdict.direction === "money_out" ? "money out" : "money in"})
        </div>
      </div>

      {verdict.findings.length > 0 && (
        <ul className="mt-3 space-y-3">
          {verdict.findings.map((f, i) => (
            <li
              key={i}
              className="rounded-xl border border-white/10 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    f.hardBlock
                      ? "bg-rose-400/[0.10] text-rose-300"
                      : "bg-amber-400/[0.10] text-amber-300"
                  }`}
                >
                  {f.hardBlock ? "BLOCKED" : "WORTH CHECKING"}
                </span>
                <span className={`text-xs ${MONO} text-white/45`}>
                  {f.code}
                </span>
              </div>
              <p className={`${P} mt-2`}>{f.message}</p>
              {f.remedy && (
                <p className={`${P} mt-2`}>
                  <strong>How to do it properly: </strong>
                  {f.remedy}
                </p>
              )}
              {f.authority && (
                <p className={`${MUTED} mt-2 italic`}>{f.authority}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ===========================================================================
// §4  WHAT KIND OF EVENT IS THIS? — the classification that drives everything
// ===========================================================================
/**
 * The event kind is the single most consequential field on the screen, because
 * it decides whether a dollar becomes income, an expense, a transfer, or
 * nothing at all. Two of these are the classic silent errors, and they are
 * called out rather than left in the list to be discovered.
 */
const KIND_NOTES: Partial<Record<BankEventKind, string>> = {
  deposit_of_sales:
    "Already on the books from the point of sale. The bank line is proof it landed — not a second sale.",
  own_transfer:
    "Not income and not an expense — the same dollar in a different pocket. Record only one side and the deposit looks like revenue you never earned.",
  owner_draw:
    "Money out to you personally. In an S corporation this changes your basis, so it is not merely a cosmetic label.",
  loan_payment:
    "Three things at once: interest (an expense), principal (not an expense) and escrow (still your money).",
  atm_vault:
    "The ATM is a separate business. Its money must never be mixed into the shop's books.",
  unknown:
    "Deliberately not guessed. An unlabelled line you review is safer than a labelled one you trust.",
};

/*
  WHY THIS IS A RECORD AND NOT AN ARRAY.

  Written as `const ALL_KINDS: BankEventKind[] = [...]`, this list would compile
  perfectly while being INCOMPLETE. TypeScript checks that every entry is a
  valid kind; it does not check that every kind is an entry. Add a thirteenth
  event kind to the engine and this screen would quietly stop teaching it -
  the one event Michael had never seen before would be the one the mentor
  never mentioned.

  Declaring the keys of a total `Record` inverts that: the compiler now demands
  every member of the union. Missing one is a build failure, not a silent gap.
  (Proven by deliberately deleting a key and watching tsc fail - standing rule
  15: a guard nobody has seen fail is not a guard.)
*/
const KIND_ORDER: Record<BankEventKind, true> = {
  deposit_of_sales: true,
  vendor_payment: true,
  payroll_funding: true,
  loan_payment: true,
  own_transfer: true,
  owner_draw: true,
  owner_contribution: true,
  bank_fee: true,
  interest_income: true,
  tax_payment: true,
  atm_vault: true,
  unknown: true,
};

const ALL_KINDS = Object.keys(KIND_ORDER) as BankEventKind[];

export function EventKindMap() {
  return (
    <section className={CARD} aria-labelledby="kinds-h">
      <h2 id="kinds-h" className={H2}>
        What kind of event is this?
      </h2>
      <p className={`${P} mt-2`}>
        This is the field that decides everything downstream — whether a dollar
        becomes income, an expense, a transfer between your own pockets, or
        nothing at all. It is the one worth slowing down for.
      </p>
      <ul className="mt-4 divide-y divide-white/10">
        {ALL_KINDS.map((k) => (
          <li key={k} className="py-3">
            <div className="text-sm font-medium text-white/90">
              {labelForKind(k)}
            </div>
            {KIND_NOTES[k] && <p className={`${MUTED} mt-1`}>{KIND_NOTES[k]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
