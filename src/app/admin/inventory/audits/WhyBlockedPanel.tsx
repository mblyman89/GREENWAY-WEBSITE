/**
 * src/app/admin/inventory/audits/WhyBlockedPanel.tsx   (slice books-12)
 *
 * "I want to not just be blocked, but told why and how." -- Michael, verbatim.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS COMPONENT ENFORCES
 * ---------------------------------------------------------------------------
 * A blocker without a way out is a dead end, and a dead end teaches nothing
 * except that the software is an obstacle. So every refusal rendered here has
 * three parts, and the type system requires all three:
 *
 *   WHAT  -- what happened, in his language, not the error code.
 *   WHY   -- the reasoning. Not "policy", not a rule number: the actual harm
 *            the refusal is preventing, so the next time he can see it coming.
 *   HOW   -- literal steps. "Open X and do Y", never "resolve the issue".
 *
 * The `Remedy` type in audit-hub-guidance-core.ts makes `how` a non-optional
 * array, which is why this cannot quietly degrade into a wall of red text.
 *
 * ---------------------------------------------------------------------------
 * WHEN WE DO NOT RECOGNISE THE BLOCKER
 * ---------------------------------------------------------------------------
 * `remedyForBlocker()` returns undefined rather than a generic fallback, and
 * this component shows the raw sentence the engine produced plus an honest
 * admission that we have no scripted fix.
 *
 * That is deliberate. A cheerful generic remedy -- "review the audit and try
 * again" -- would look like guidance while containing none, and it would train
 * him to ignore the panel. Saying "we do not have a scripted answer for this
 * one" is more useful, and it is also true.
 */

import {
  remediesForBlocker,
  remedyForBlocker,
  type Remedy,
} from "@/lib/inventory/audit-hub-guidance-core";
import { InlineAuthority } from "@/components/admin/books/AuthorityPanel";

const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

function RemedyCard({ remedy }: { remedy: Remedy }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-white">{remedy.what}</p>
        {/* Rule 19: a refusal that guards one of Michael's OWN documented
            disasters is marked, because for him it is not hypothetical. */}
        {remedy.fromOwnHistory ? (
          <span className="rounded-full bg-[var(--admin-danger-soft)] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-[var(--admin-danger)]">
            This has happened here before
          </span>
        ) : null}
      </div>

      <div className="mt-2">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-gold)]">
          Why the system will not continue
        </p>
        <p className={`mt-1 ${P}`}>{remedy.why}</p>
      </div>

      <div className="mt-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--admin-accent)]">
          How to clear it
        </p>
        <ol className="mt-1.5 space-y-1.5">
          {remedy.how.map((s, i) => (
            <li key={`${s.where}-${i}`} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-[0.6rem] font-black text-[var(--admin-accent)]">
                {i + 1}
              </span>
              <span className={P}>
                {s.action}
                <span className="ml-1.5 text-white/40">&mdash; {s.where}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {remedy.authorityIds.length > 0 ? (
        <p className={`mt-3 ${MUTED}`}>
          Authority:{" "}
          {remedy.authorityIds.map((id, i) => (
            <span key={id}>
              {i > 0 ? ", " : ""}
              <InlineAuthority id={id} />
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Render every blocker standing between this audit and the next step.
 *
 * `blockers` are the engine's own sentences (from `readinessOf` /
 * `gateSessionForPosting`). They are shown VERBATIM as well as matched to a
 * remedy, so the specific detail -- which lot, how much -- is never lost to a
 * generic template.
 */
export function WhyBlockedPanel({
  blockers,
  title = "Why this cannot move forward yet",
}: {
  blockers: readonly string[];
  title?: string;
}) {
  if (blockers.length === 0) return null;

  // remediesForBlocker, plural, on purpose. One engine sentence can carry two
  // faults at once — "either a shrink has no explanation, or a lot has no
  // cost on file" is a single blocker with two different ways out. Showing
  // only the first would document half the wall.
  // DEFECT D6, CAUGHT BY LOOKING AT THE RENDERED SCREEN RATHER THAN THE TESTS.
  // Two different engine blockers can legitimately share one remedy — "no count
  // sheet line at all" and "have not been counted" both end at UNCOUNTED_LINES.
  // The first version printed the full three-step card twice in a row. Nothing
  // was factually wrong, but a wall of repeated instructions reads like a bug
  // and buries the blockers that ARE different. Each remedy is therefore shown
  // in full once; later repeats collapse to a one-line back-reference that
  // still names the fix, so nothing is hidden.
  const seen = new Set<string>();
  const matched = blockers.map((b) => {
    const remedies = remediesForBlocker(b);
    const fresh = remedies.filter((r) => !seen.has(r.code));
    const repeated = remedies.filter((r) => seen.has(r.code));
    remedies.forEach((r) => seen.add(r.code));
    return { blocker: b, fresh, repeated, any: remedies.length > 0 };
  });

  return (
    <section className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5">
      <h2 className="text-sm font-bold text-white">{title}</h2>
      <p className={`mt-1 ${P}`}>
        Nothing has been changed. Each item below says what is in the way, why that matters, and the
        exact steps to clear it.
      </p>

      <div className="mt-4 space-y-3">
        {matched.map(({ blocker, fresh, repeated, any }, i) => (
          <div key={`${blocker}-${i}`}>
            {/* The engine's own sentence, first and unedited. It carries the
                specifics a scripted remedy cannot know. */}
            <p className="mb-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/80">
              {blocker}
            </p>
            {any ? (
              <div className="space-y-3">
                {fresh.map((remedy) => (
                  <RemedyCard key={remedy.code} remedy={remedy} />
                ))}
                {repeated.map((remedy) => (
                  <p
                    key={remedy.code}
                    className="rounded-xl border border-white/10 bg-white/[0.015] px-4 py-3 text-xs text-[var(--admin-text-muted)]"
                  >
                    Same fix as above &mdash;{" "}
                    <span className="text-white/80">{remedy.what}</span> The steps are listed once,
                    higher up this page.
                  </p>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.015] p-4">
                <p className={P}>
                  There is no scripted fix for this one yet, so rather than offer a vague
                  instruction that sounds helpful and is not, here is the plain position: the
                  sentence above is the engine&apos;s own reason, and it is accurate. If it is not
                  clear enough to act on, that is a gap worth reporting &mdash; the guidance should
                  never be thinner than the refusal.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A single named remedy, for screens that know exactly which one applies. */
export function RemedyFor({ code }: { code: string }) {
  const remedy = remedyForBlocker(code);
  if (!remedy) return null;
  return <RemedyCard remedy={remedy} />;
}
