/**
 * src/app/admin/inventory/audits/AuditHubExplainer.tsx   (slice books-12)
 *
 * THE MENTOR. Michael asked, verbatim:
 *
 *   "I want this ui to surface and have and use the same level of professional
 *    guidance from any and all authoritative sources, federal, state, GAAP,
 *    industry standards, etc. I want to not just be blocked, but told why and
 *    how... I want our PhD level cpa/cfo to mentor and guide me as all the
 *    other features do. I want to shadow this genius expert so I can become an
 *    expert too."
 *
 * And: "What does the audit department from Deloitte use to audit inventory?"
 *
 * ---------------------------------------------------------------------------
 * THE ANSWER TO THAT QUESTION, AND WHY IT SHAPED THIS SCREEN
 * ---------------------------------------------------------------------------
 * A Big Four inventory observation is not a clever proprietary trick. It is a
 * published method, and the published method is what this page teaches:
 *
 *   1. Plan the scope and set MATERIALITY before anyone counts.
 *   2. Evaluate the client's COUNT INSTRUCTIONS before observing.
 *   3. OBSERVE the count being performed.
 *   4. Perform TEST COUNTS IN BOTH DIRECTIONS -- sheet-to-floor for existence,
 *      floor-to-sheet for completeness.
 *   5. Investigate DIFFERENCES, and treat the pattern of differences as
 *      evidence about the controls, not just about the shelf.
 *
 * Steps 2, 3 and 4 are ISA 501 almost verbatim; the two-direction test count is
 * ISA 501 A7. That is the part firms drill hardest, because each direction
 * tests a DIFFERENT assertion and neither can substitute for the other -- and
 * it is also the part an owner counting his own shop will skip without ever
 * knowing what he gave up.
 *
 * So this component does not say "counting is important". It teaches the
 * method, names each step the way a professional names it, and says what breaks
 * when the step is skipped.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE -- THE RULE THAT KEEPS THIS HONEST
 * ---------------------------------------------------------------------------
 * EVERY WORD OF SUBSTANCE BELOW IS DATA, exported from
 * audit-hub-guidance-core.ts and rendered here. This file lays out; it does not
 * teach. A lesson written in JSX drifts from the engine that enforces it, and a
 * diagram that disagrees with the code teaches the wrong thing confidently.
 *
 * The citations are likewise NOT typed here. `AuthorityPanel` resolves ids
 * against the shared registry and renders the real quoted text, so a citation
 * cannot be paraphrased into something the source does not say.
 */

import {
  AUDIT_METHOD,
  TRACE_DIRECTIONS,
  BLIND_COUNT_DOCTRINE,
  CADENCE_EXPLAINED,
  PROVES_AND_DOES_NOT,
  GLOSSARY,
  describeMateriality,
} from "@/lib/inventory/audit-hub-guidance-core";
import {
  AuthorityPanel,
  InlineAuthority,
} from "@/components/admin/books/AuthorityPanel";

/* The house card recipe, matched to /admin/books/ledger so the auditing hub
   does not look like a different product. */
const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

/** Derived from the data, never hand-listed, so a new citation cannot go missing. */
const HUB_AUTHORITY_IDS: readonly string[] = Array.from(
  new Set([
    ...AUDIT_METHOD.flatMap((s) => s.authorityIds),
    ...BLIND_COUNT_DOCTRINE.authorityIds,
    ...PROVES_AND_DOES_NOT.authorityIds,
  ]),
);

/* ══════════════════════════════════════════════════════════════════════════
   1) THE METHOD
   ══════════════════════════════════════════════════════════════════════════ */

export function AuditMethodPanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>How a professional audits inventory</h2>
      <p className={`mt-1 ${P}`}>
        This is the same five-step method a Big Four audit team runs when it observes a client&apos;s
        inventory count. Steps two through four come almost word for word from{" "}
        <InlineAuthority id="ISA_501_4_EXISTENCE_AND_CONDITION" />. Nothing here is our house
        preference dressed up as a standard.
      </p>

      <ol className="mt-4 space-y-3">
        {AUDIT_METHOD.map((step) => (
          <li
            key={step.n}
            className="rounded-xl border border-white/10 bg-white/[0.015] p-4"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-xs font-black text-[var(--admin-accent)]">
                {step.n}
              </span>
              <div className="min-w-0 flex-1">
                {/* The formal name FIRST, then the plain one. Michael asked to
                    become an expert, and experts know the words -- but the
                    plain name is what makes the formal one stick. */}
                <p className="text-sm font-bold text-white">{step.formalName}</p>
                <p className="mt-0.5 text-sm text-[var(--admin-accent)]">{step.plainName}</p>

                <p className={`mt-2 ${P}`}>{step.why}</p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.05] p-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-accent)]">
                      The system does this
                    </p>
                    <p className={`mt-1 ${MUTED}`}>{step.systemDoes}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.05] p-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-gold)]">
                      You still do this
                    </p>
                    <p className={`mt-1 ${MUTED}`}>{step.humanDoes}</p>
                  </div>
                </div>

                {step.authorityIds.length > 0 ? (
                  <p className={`mt-2 ${MUTED}`}>
                    Authority:{" "}
                    {step.authorityIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 ? ", " : ""}
                        <InlineAuthority id={id} />
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2) THE TWO DIRECTIONS -- the part that is genuinely hard to learn alone
   ══════════════════════════════════════════════════════════════════════════ */

export function TraceDirectionsPanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>Test counts go in two directions, and they prove different things</h2>
      <p className={`mt-1 ${P}`}>
        This is the single most useful idea on this page. Most people who count their own stock only
        ever go one direction, and they genuinely believe they have checked everything.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {TRACE_DIRECTIONS.map((d) => (
          <div
            key={d.id}
            className="rounded-xl border border-white/10 bg-white/[0.015] p-4"
          >
            <p className="text-sm font-bold text-white">{d.formalName}</p>
            <p className="mt-0.5 text-sm text-[var(--admin-accent)]">{d.plainName}</p>

            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-accent)]">
                  Proves
                </dt>
                <dd className={`mt-0.5 ${P}`}>{d.proves}</dd>
              </div>
              {/* CANNOT PROVE is given the same visual weight as PROVES on
                  purpose. The limitation is the lesson: an expert is precise
                  about the boundary of their evidence, and that precision is
                  most of what separates them from an amateur. */}
              <div>
                <dt className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-danger)]">
                  Cannot prove
                </dt>
                <dd className={`mt-0.5 ${P}`}>{d.cannotProve}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase tracking-wider text-white/50">
                  How to do it
                </dt>
                <dd className={`mt-0.5 ${MUTED}`}>{d.howTo}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold uppercase tracking-wider text-white/50">
                  Skip it and this happens
                </dt>
                <dd className={`mt-0.5 ${MUTED}`}>{d.whatBreaksWithoutIt}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <p className={`mt-3 ${MUTED}`}>
        Both directions are required by <InlineAuthority id="ISA_501_A7_TWO_WAY_TEST_COUNTS" />.
      </p>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BLIND COUNTS
   ══════════════════════════════════════════════════════════════════════════ */

export function BlindCountPanel() {
  return (
    <section className="rounded-2xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.04] p-5">
      <h2 className={H2}>Why the count sheet does not show the expected quantity</h2>
      <p className={`mt-2 ${P}`}>{BLIND_COUNT_DOCTRINE.why}</p>
      <p className={`mt-2 ${P}`}>{BLIND_COUNT_DOCTRINE.soWhat}</p>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-gold)]">
          On a recount
        </p>
        <p className={`mt-1 ${MUTED}`}>{BLIND_COUNT_DOCTRINE.exception}</p>
      </div>
      <p className={`mt-3 ${MUTED}`}>
        {/* Worth stating plainly: this is enforced in the TYPE, not the
            template. The count sheet has no field for the expected quantity,
            so revealing it is not a mistake anyone can make by accident. */}
        This is enforced in the data itself: the expected quantity is not sent to the counting
        screen at all, so it cannot be revealed by a styling change or a stray edit. Authority:{" "}
        <InlineAuthority id="ISA_501_A4_COUNT_CONTROLS" />.
      </p>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4) MATERIALITY + CADENCE
   ══════════════════════════════════════════════════════════════════════════ */

export function MaterialityPanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>What counts as a difference worth chasing</h2>
      {/* Rendered from the SAME policy object the engine assesses lines with.
          Re-typing "2%" into prose here is exactly the drift that would
          survive a policy change and quietly start lying. */}
      <p className={`mt-2 ${P}`}>{describeMateriality()}</p>
      <p className={`mt-2 ${MUTED}`}>
        A variance is a signal about your controls, not merely a number to correct --{" "}
        <InlineAuthority id="ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL" />.
      </p>
    </section>
  );
}

export function CadencePanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>How often each kind of stock gets counted</h2>
      <p className={`mt-1 ${P}`}>
        Counting by value rather than by shelf. Your attention is finite, so it follows the dollars.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {CADENCE_EXPLAINED.map((c) => (
          <div
            key={c.abcClass}
            className="rounded-xl border border-white/10 bg-white/[0.015] p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-white">
                <span className="text-[var(--admin-accent)]">{c.abcClass}</span> &mdash; {c.label}
              </p>
              <span className="shrink-0 text-xs font-semibold text-white/50">
                every {c.everyNDays} days
              </span>
            </div>
            <p className={`mt-1 ${MUTED}`}>{c.inPractice}</p>
            <p className={`mt-1 ${MUTED}`}>{c.why}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   5) THE LIMITS OF THE EVIDENCE
   ══════════════════════════════════════════════════════════════════════════ */

export function ProvesPanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>What a count proves &mdash; and what it does not</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.05] p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-accent)]">
            It does prove
          </p>
          <ul className="mt-2 space-y-1.5">
            {PROVES_AND_DOES_NOT.proves.map((t) => (
              <li key={t} className={P}>
                &bull; {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--admin-danger)]/25 bg-[var(--admin-danger)]/[0.05] p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-danger)]">
            It does not prove
          </p>
          <ul className="mt-2 space-y-1.5">
            {PROVES_AND_DOES_NOT.doesNotProve.map((t) => (
              <li key={t} className={P}>
                &bull; {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={`mt-3 ${MUTED}`}>
        The last one is worth sitting with: most differences are paperwork, not people. Treating
        every variance as theft is the fastest way to lose good staff over a data-entry error.
      </p>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   6) GLOSSARY + AUTHORITIES
   ══════════════════════════════════════════════════════════════════════════ */

export function GlossaryPanel() {
  return (
    <section className={CARD}>
      <h2 className={H2}>The words, so the room does not get to use them against you</h2>
      <dl className="mt-3 space-y-3">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="border-l-2 border-white/10 pl-3">
            <dt className="text-sm font-bold text-white">{g.term}</dt>
            <dd className={`mt-0.5 ${P}`}>{g.plain}</dd>
            <dd className={`mt-0.5 ${MUTED}`}>{g.why}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AuditHubAuthorities() {
  return (
    <div className={CARD}>
      <AuthorityPanel
        ids={HUB_AUTHORITY_IDS}
        title="The authority behind this"
        intro="Quoted, not paraphrased. Where a source is persuasive rather than binding on a Washington cannabis retailer, it is labelled that way — borrowing the method of a public-company audit is sound practice, but it is not a rule anyone can cite against you."
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   THE WHOLE LESSON, IN READING ORDER
   ══════════════════════════════════════════════════════════════════════════ */

export function AuditHubExplainer() {
  return (
    <div className="space-y-4">
      <AuditMethodPanel />
      <TraceDirectionsPanel />
      <BlindCountPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <MaterialityPanel />
        <CadencePanel />
      </div>
      <ProvesPanel />
      <GlossaryPanel />
      <AuditHubAuthorities />
    </div>
  );
}
