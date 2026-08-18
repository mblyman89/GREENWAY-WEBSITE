/**
 * src/app/admin/books/trial-balance/TrialBalanceExplainer.tsx   (slice books-07)
 *
 * THE MOST DANGEROUS PAGE IN THE BOOKS, AND WHY.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "I have always needed a mentor, a cpa or cfo to shadow."
 *   "lay it all out in very plain English what we will be doing to keep me safe
 *    from the tax man."
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS FILE EXISTS TO SOLVE
 * ---------------------------------------------------------------------------
 * A trial balance that ties produces a feeling of completion that it has not
 * earned. Two big green totals agree, and the natural conclusion is "the books
 * are done." That conclusion is wrong, and it is wrong in the specific way that
 * costs the most money.
 *
 * Here is the mechanism, and it is worth being precise about because the whole
 * page turns on it. A transaction that was NEVER RECORDED is missing from the
 * debit column AND the credit column. It cancels itself. The totals still
 * agree. The trial balance is not failing to report the problem -- it is
 * structurally incapable of seeing it. This is the same trap the bank
 * reconciliation calls D8: an unrecorded bank line produces a difference of
 * zero, and the system cheerfully reports that everything ties.
 *
 * So the honest thing -- the thing a CPA would say out loud and a piece of
 * software usually does not -- is that footing proves exactly ONE thing out of
 * seven. This page says which one, and then says what to do about the other
 * six, because leaving a gap without a remedy is just anxiety.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 * Every claim below is DATA from books-guidance-core.ts. The `proven` flag on
 * each item drives the styling directly, so a claim can never be rendered green
 * unless the core says it is actually proven. If someone later flips one of
 * those flags, this page changes with it -- there is no second copy of the
 * verdict here to go stale.
 */

import {
  TRIAL_BALANCE_PROVES,
  TRIAL_BALANCE_MENTOR_STEPS,
  COMPLETENESS_CHECKS,
} from "@/lib/accounting/books-guidance-core";
import {
  AuthorityPanel,
  InlineAuthority,
} from "@/components/admin/books/AuthorityPanel";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

const PROVEN_COUNT = TRIAL_BALANCE_PROVES.filter((p) => p.proven).length;

/** Every authority this page relies on, derived rather than hand-listed. */
const TB_AUTHORITY_IDS: readonly string[] = Array.from(
  new Set([
    ...TRIAL_BALANCE_MENTOR_STEPS.flatMap((s) => s.authorityIds),
    ...TRIAL_BALANCE_PROVES.flatMap((p) => p.authorityIds),
    ...COMPLETENESS_CHECKS.flatMap((c) => c.authorityIds),
  ]),
);

// ===========================================================================
// WHAT "IT TIES" ACTUALLY PROVES
// ===========================================================================

/**
 * The heart of the page. One green row, six amber ones, and a remedy attached
 * to every amber.
 *
 * The visual asymmetry is the argument: a reader who takes nothing else from
 * this screen should still walk away knowing that the green total at the top of
 * the page answers one question out of seven.
 */
export function WhatBalancingProves() {
  return (
    <section className={CARD}>
      <h2 className={H2}>
        What a balanced trial balance actually proves &mdash; {PROVEN_COUNT} of{" "}
        {TRIAL_BALANCE_PROVES.length} things
      </h2>
      <p className={`${P} mt-2`}>
        This is the single most misunderstood number in bookkeeping. When the two
        totals agree it feels like the books are finished. They are not, and the
        reason is mechanical rather than a matter of opinion: a transaction you
        never recorded is missing from <em>both</em> columns, so it cancels itself
        out and the totals still agree. A trial balance cannot detect something
        that was never written down.
      </p>

      <ul className="mt-4 space-y-3">
        {TRIAL_BALANCE_PROVES.map((item) => (
          <li
            key={item.claim}
            className={`rounded-xl border p-4 ${
              item.proven
                ? "border-[var(--admin-accent)]/35 bg-[var(--admin-accent)]/[0.07]"
                : "border-[var(--admin-orange)]/30 bg-[var(--admin-orange)]/[0.05]"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  item.proven
                    ? "bg-[var(--admin-accent)]/25 text-[var(--admin-accent)]"
                    : "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]"
                }`}
              >
                {item.proven ? "\u2713" : "\u2717"}
              </span>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-white/90">
                  {item.claim}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      item.proven
                        ? "bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                        : "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]"
                    }`}
                  >
                    {item.proven ? "proven" : "not proven"}
                  </span>
                </p>
                <p className={P}>{item.because}</p>
                {item.insteadDoThis ? (
                  <p className="text-sm leading-relaxed text-white/75">
                    <span className="text-[var(--admin-accent)]/80">
                      What proves it instead:{" "}
                    </span>
                    {item.insteadDoThis}
                  </p>
                ) : null}
                {item.authorityIds.length > 0 ? (
                  <p className={MUTED}>
                    <span className="text-white/35">Authority: </span>
                    {item.authorityIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 && "; "}
                        <InlineAuthority id={id} />
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===========================================================================
// THE CHECKS THAT DO WHAT FOOTING CANNOT
// ===========================================================================

/**
 * Each of these compares the books to something the business did not write.
 * That is the entire point: an outside record is the only thing that can prove
 * a MISSING entry, because it contains the entry you forgot.
 */
export function CompletenessChecklist() {
  return (
    <section className={CARD}>
      <h2 className={H2}>The checks that catch what this page can&apos;t</h2>
      <p className={`${P} mt-2`}>
        Every one of these compares your books against a record{" "}
        <strong className="text-white/85">someone else wrote</strong> &mdash; the bank,
        the state, the count in the vault. That is what makes them able to find a
        transaction that is missing entirely, which is the one thing the totals
        above will never do for you{" "}
        <InlineAuthority id="AS_1105_11_COMPLETENESS" />.
      </p>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {COMPLETENESS_CHECKS.map((c) => (
          <li
            key={c.code}
            className="rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium text-white/90">{c.title}</h3>
              <span className="font-mono text-[10px] text-white/25">{c.code}</span>
            </div>
            <p className={`${MUTED} mt-2`}>
              <span className="text-white/35">Measured against: </span>
              {c.outsideRecord}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/60">
              <span className="text-white/35">Catches: </span>
              {c.catches}
            </p>
            {c.href ? (
              <a
                href={c.href}
                className="mt-3 inline-block text-xs text-[var(--admin-accent)] hover:underline"
              >
                Go and do this &rarr;
              </a>
            ) : (
              <p className="mt-3 text-[11px] text-white/30">
                No screen for this yet &mdash; do it by hand for now.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===========================================================================
// HOW TO READ THE PAGE ABOVE
// ===========================================================================

/**
 * The reading order that catches problems earliest. Step one is "check it isn't
 * empty", because an empty trial balance ties perfectly -- zero equals zero --
 * and is the most complete failure possible.
 */
export function HowToReadIt() {
  return (
    <section className={CARD}>
      <h2 className={H2}>How to read the numbers above, in order</h2>
      <p className={`${MUTED} mt-1`}>
        This order is deliberate. It puts the cheapest, highest-value checks
        first, so you find a problem before you have spent an hour reading down a
        page that was never going to tell you.
      </p>

      <ol className="mt-4 space-y-3">
        {TRIAL_BALANCE_MENTOR_STEPS.map((s) => (
          <li key={s.step} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)]/20 text-xs font-semibold text-[var(--admin-accent)]">
              {s.step}
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-medium text-white/85">{s.action}</p>
              <p className={P}>
                <span className="text-white/40">Why: </span>
                {s.why}
              </p>
              <p className="text-sm leading-relaxed text-white/65">
                <span className="text-[var(--admin-orange)]/80">If you skip it: </span>
                {s.ifSkipped}
              </p>
              {s.authorityIds.length > 0 ? (
                <p className={MUTED}>
                  <span className="text-white/35">Authority: </span>
                  {s.authorityIds.map((id, i) => (
                    <span key={id}>
                      {i > 0 && "; "}
                      <InlineAuthority id={id} />
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ===========================================================================

/** Everything the trial balance page shows below the numbers. */
export function TrialBalanceExplainer() {
  return (
    <div className="space-y-6">
      <WhatBalancingProves />
      <CompletenessChecklist />
      <HowToReadIt />
      <AuthorityPanel
        ids={TB_AUTHORITY_IDS}
        title="The actual words, so you never have to take mine for it"
        intro={
          "Everything above is built on these. They are quoted exactly as written " +
          "so you can read the source yourself rather than trusting a summary of it."
        }
      />
    </div>
  );
}
