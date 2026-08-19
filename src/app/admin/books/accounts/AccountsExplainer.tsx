/**
 * src/app/admin/books/accounts/AccountsExplainer.tsx   (slice books-08)
 *
 * THE CHART OF ACCOUNTS, EXPLAINED AS A SET OF DECISIONS RATHER THAN A LIST.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "The chart of accounts is fairly solid, I'm guessing we just need GAAP
 *    specific methods and logic, plus mapping accounts I suppose."
 *
 * He is right, and the diagnosis is worth stating precisely because it shapes
 * this file. `coa-core.ts` is a thousand lines of genuine enforcement: block
 * rules, derived normal balances, contra handling, mirrored category codes,
 * confidence bands, and a hard `mayAutoPost() === false`. The STRUCTURE is
 * sound. What was missing is the part that cannot be enforced — the reason the
 * choice is consequential at all.
 *
 * So this page does not describe the chart. The chart is on screen already. It
 * explains what picking one of these accounts DECIDES, which in a §280E
 * business is frequently worth more money than the transaction itself: the same
 * dollar is deductible in block 6 and permanently non-deductible in block 7.
 *
 * THE ONE THING TO UNDERSTAND ABOUT THE NUMBERING: the first digit is not
 * decoration. It is enforced. An account code is five digits and its leading
 * digit determines which TYPES the account is allowed to have, which is why
 * excise tax physically cannot be booked to a revenue account — a 5xxxx code
 * cannot hold a liability. The mistake is not discouraged, it is
 * unrepresentable. That is the difference between a chart and a filing system.
 *
 * ARCHITECTURE: every claim here is DATA from books-ledger-guidance-core.ts,
 * and the block names come from `COA_BLOCKS` itself, so a rename in the chart
 * cannot leave a stale name on this page.
 */

import {
  COA_BLOCK_NOTES,
  ACCOUNT_CHOICE_CONSEQUENCES,
} from "@/lib/accounting/books-ledger-guidance-core";
import {
  AuthorityPanel,
  InlineAuthority,
} from "@/components/admin/books/AuthorityPanel";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

/** Derived rather than hand-listed, so a new citation cannot go missing. */
const COA_AUTHORITY_IDS: readonly string[] = Array.from(
  new Set([
    ...ACCOUNT_CHOICE_CONSEQUENCES.flatMap((c) => c.authorityIds),
    "REG_1_446_1_A_2_CLEARLY_REFLECT",
    "REG_1_6001_1_A_PERMANENT_BOOKS",
  ]),
);

/** What the five digits mean, and why the first one is enforced rather than advisory. */
export function HowTheNumberingWorks() {
  return (
    <section className={CARD}>
      <h2 className={H2}>What the numbers mean</h2>
      <p className={`${P} mt-2`}>
        Every account code is five digits, and the first digit is the one that
        matters: it says which family the account belongs to. That leading digit is
        not a naming convention, it is a rule the database enforces. An account
        beginning with 5 is revenue and can only ever be revenue, which is precisely
        why the excise tax you collect cannot be booked as income &mdash; excise is a
        liability, liabilities begin with 3, and a 5xxxx code is incapable of holding
        one. The wrong answer is not discouraged here, it is impossible to express.
      </p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {COA_BLOCK_NOTES.map((b) => (
          <li
            key={b.block}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
          >
            <p className="text-sm font-semibold text-white/90">
              <span className="tabular-nums text-[var(--admin-accent)]">{b.block}xxxx</span>{" "}
              &mdash; {b.name}
            </p>
            <p className={`${MUTED} mt-1`}>{b.plainEnglish}</p>
          </li>
        ))}
      </ul>

      <p className={`${MUTED} mt-4`}>
        The other thing the code decides is which side the account normally sits on.
        Things you own and money you spend normally carry debit balances; money you
        owe, your equity and your sales normally carry credits. That is not
        bookkeeping trivia &mdash; it is the basis of the fastest error check there
        is, and the general ledger now runs it for you on every account. An asset
        showing a credit balance means something got recorded backwards, or something
        real is missing.
      </p>
    </section>
  );
}

/**
 * THE HEART OF THE PAGE. The same data the ledger explainer renders, because it
 * is one lesson read from two directions: here you meet it BEFORE choosing an
 * account, there you meet it after, looking at what the choice did.
 */
export function WhatTheChoiceDecides() {
  return (
    <section className={CARD}>
      <h2 className={H2}>Choosing an account is not filing &mdash; it is a tax decision</h2>
      <p className={`${P} mt-2`}>
        This is the part worth reading twice. The regulation does not treat the
        account you pick as an administrative detail: it requires expenditures to be
        properly classified, and names capital-versus-expense as the example
        <InlineAuthority id="REG_1_446_1_A_4_II_CAPITAL_VS_EXPENSE" />. In a cannabis
        business the stakes are higher still, because §280E makes one column of this
        chart deductible and another column permanently not. The transaction is the
        same either way. The account is what decides.
      </p>

      <ul className="mt-4 space-y-3">
        {ACCOUNT_CHOICE_CONSEQUENCES.map((c) => (
          <li key={c.family} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm font-semibold text-white/90">{c.family}</p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">Decides:</span> {c.decides}
            </p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">The mistake people make:</span>{" "}
              {c.commonMistake}
            </p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">How to tell:</span> {c.tellTale}
            </p>
            {c.authorityIds.length > 0 ? (
              <p className={`${MUTED} mt-2`}>
                {c.authorityIds.map((id, n) => (
                  <span key={id}>
                    {n > 0 ? " " : ""}
                    <InlineAuthority id={id} />
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * WHY ACCOUNTS ARE RETIRED RATHER THAN DELETED.
 *
 * Worth its own section because the instinct is always to tidy up, and tidying
 * a chart of accounts is how history stops adding up.
 */
export function WhyNothingIsEverDeleted() {
  return (
    <section className={CARD}>
      <h2 className={H2}>Why old accounts are retired instead of deleted</h2>
      <p className={`${P} mt-2`}>
        An account that has ever been used cannot be removed, only retired. It stops
        appearing when you are choosing where to post something, and it keeps
        appearing on any report covering a period when it was in use. That is
        deliberate: deleting an account does not delete what went through it, it just
        removes the label, and a ledger line whose account no longer exists is a
        number with no explanation attached.
      </p>
      <p className={`${P} mt-2`}>
        The records rule is about sufficiency &mdash; whether what you kept is enough
        to establish the figures on your return{" "}
        <InlineAuthority id="REG_1_6001_1_A_PERMANENT_BOOKS" />. A tidy chart that no
        longer explains last year&rsquo;s numbers fails that test while looking
        immaculate. Washington sets the retention period at the state level too, so
        the chart has to stay readable for years after an account stops being used.
      </p>
      <p className={`${MUTED} mt-3`}>
        Your old Sage chart carried 287 accounts of which 115 were never used at all,
        and 18 more were tagged to an entity that did not exist because of a
        four-letter typo &mdash; which quietly hid every payroll account. Retiring is
        how that gets cleaned up without losing the history: the account stops being
        offered, and the past stays intact.
      </p>
    </section>
  );
}

/** Everything, in reading order. */
export function AccountsExplainer() {
  return (
    <div className="space-y-5">
      <HowTheNumberingWorks />
      <WhatTheChoiceDecides />
      <WhyNothingIsEverDeleted />
      <AuthorityPanel
        ids={COA_AUTHORITY_IDS}
        title="The rules behind this page, in full"
        intro="Quoted word for word from the primary sources, so you are reading what the regulation actually says rather than somebody's summary of it. Where a document is persuasive rather than binding, the badge says so."
      />
    </div>
  );
}
