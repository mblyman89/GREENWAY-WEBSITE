/**
 * src/app/admin/books/payroll/PayrollCogsExplainer.tsx   (slice books-04)
 *
 * THE PICTURE OF THE EMPLOYEE-AS-COGS QUESTION.
 *
 * Michael asked for this feature in his own words (standing rule 1 — record
 * requests verbatim):
 *
 *   "I would like the ability to assign employees as cogs so I can write them
 *    off"
 *
 * and asked for the platform to teach rather than merely refuse:
 *
 *   "I learn best visually... I have always needed a mentor, a cpa or cfo to
 *    shadow, I want our platform to be that mentor."
 *   "not just block, but explain why, and even better, show me a way to do it
 *    properly"
 *
 * The honest answer to the request is mostly NO — Greenway is a reseller, and
 * Reg. §1.471-3(b) contains no direct-labor clause. But "no" delivered as a
 * blank refusal teaches nothing and would be, in Michael's words, "rejecting it
 * out right". So this component does three things instead:
 *
 *   1. THE DECISION TREE — the five questions, in the order a CPA would ask
 *      them, each carrying the reason it sits at that point in the sequence.
 *      Answer them and it tells you the treatment AND why.
 *   2. THE ROLE MAP — all thirteen kinds of work, sorted by what each one does
 *      to the tax, with the account it posts to shown on the row.
 *   3. THE MONEY BAR — where each payroll dollar actually went, in §280E terms,
 *      with widths in integer milli-percent that sum to exactly 100%.
 *
 * WHY NONE OF THE LOGIC LIVES IN THIS FILE
 * Because a diagram that drifts from the engine is worse than no diagram: it
 * teaches the wrong thing with confidence. The tree, the role table and the bar
 * geometry are all DATA exported by `payroll-cogs-core.ts`, so the picture on
 * screen and the rule that runs at posting time are physically the same object.
 * Change the rule and the picture changes with it — or the tests fail.
 *
 * This is a client component only because the tree is interactive. It performs
 * no I/O, makes no decisions of its own, and touches no money.
 */

"use client";

import { useState, useMemo } from "react";

import {
  LABOR_DECISION_TREE,
  LABOR_ROLES,
  walkLaborDecisionTree,
  findLaborDecisionNode,
  findPayrollAuthority,
  formatCents,
  formatMilliPct,
  type PayrollBar,
  type LaborTreatment,
} from "@/lib/accounting/payroll-cogs-core";

// ---------------------------------------------------------------------------
// Presentation vocabulary. Colour carries meaning here, so it is defined once
// and only once. GREEN = the money you keep. RED = the money §280E takes.
// AMBER = money that belongs to someone else. Everything else is neutral,
// because it is neither.
// ---------------------------------------------------------------------------
const TREATMENT_STYLE: Record<
  LaborTreatment,
  { label: string; ring: string; text: string; bg: string; verdict: string }
> = {
  acquisition: {
    label: "Acquiring possession → inventory",
    ring: "border-emerald-400/40",
    text: "text-emerald-300",
    bg: "bg-emerald-400/10",
    verdict:
      "The one door a reseller has. Rides in on the same clause as inbound freight — and only with records behind it.",
  },
  selling: {
    label: "Selling — never inventoriable",
    ring: "border-rose-400/40",
    text: "text-rose-300",
    bg: "bg-rose-400/10",
    verdict:
      "Excluded by name, even for a grower: Reg. §1.471-3(c) says \u201cbut not including any cost of selling\u201d.",
  },
  admin: {
    label: "Running the store",
    ring: "border-rose-400/30",
    text: "text-rose-200",
    bg: "bg-rose-400/[0.07]",
    verdict:
      "Real, necessary work that §280E disallows anyway. A producer could argue some of it; a reseller has no such paragraph.",
  },
  production: {
    label: "Production labor",
    ring: "border-sky-400/40",
    text: "text-sky-300",
    bg: "bg-sky-400/10",
    verdict:
      "Capitalisable under §1.471-3(c) — but only for a producer. Greenway's I-502 retail licence does not permit producing.",
  },
  separate: {
    label: "Separate trade or business",
    ring: "border-emerald-400/30",
    text: "text-emerald-200",
    bg: "bg-emerald-400/[0.07]",
    verdict:
      "Deductible against THAT business under CHAMP. Keeping it separate is worth more than any allocation.",
  },
  owner: {
    label: "Owner / officer compensation",
    ring: "border-amber-400/40",
    text: "text-amber-300",
    bg: "bg-amber-400/10",
    verdict:
      "Disallowed like every other wage, and the most closely examined line on a closely-held return.",
  },
};

const BAR_TONE: Record<PayrollBar["tone"], string> = {
  good: "bg-emerald-400",
  bad: "bg-rose-400",
  neutral: "bg-white/30",
};

// ===========================================================================
// THE MONEY BAR — where every payroll dollar went.
// ===========================================================================
export function PayrollMoneyBar({
  bars,
  totalCents,
}: {
  bars: readonly PayrollBar[];
  totalCents: number;
}) {
  const shown = bars.filter((b) => b.cents > 0);
  if (shown.length === 0 || totalCents <= 0) {
    return (
      <p className="text-xs text-white/40">
        Nothing to show yet — enter a payroll run and the split appears here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* The bar itself. Widths come from the engine as integer milli-percent
          that sum to exactly 100000, so this never renders a 99.9% bar. */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
        {shown.map((b) => (
          <div
            key={b.label}
            className={BAR_TONE[b.tone]}
            style={{ width: `${b.milliPct / 1000}%` }}
            title={`${b.label} — ${formatCents(b.cents)}`}
          />
        ))}
      </div>

      <dl className="space-y-2">
        {shown.map((b) => (
          <div key={b.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${BAR_TONE[b.tone]}`}
              aria-hidden
            />
            <dt className="text-sm text-white/80">{b.label}</dt>
            <dd className="ml-auto font-mono text-sm text-white/70">
              {formatCents(b.cents)}
              <span className="ml-2 text-white/40">{formatMilliPct(b.milliPct)}</span>
            </dd>
            <p className="w-full pl-5 text-xs leading-relaxed text-white/45">
              {b.plainEnglish}
            </p>
          </div>
        ))}
      </dl>

      <p className="border-t border-white/10 pt-2 text-right font-mono text-sm text-white/60">
        Gross payroll {formatCents(totalCents)}
      </p>
    </div>
  );
}

// ===========================================================================
// THE DECISION TREE — the five questions, in the order they actually matter.
// ===========================================================================
export function LaborDecisionWalker() {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const result = useMemo(() => walkLaborDecisionTree(answers), [answers]);

  // Show only the questions actually on the current path. Rendering all five at
  // once turns a decision procedure into a quiz, and the ORDER is the lesson:
  // selling is asked first precisely because it is the only final answer.
  const visible = useMemo(() => {
    const path: string[] = [];
    let currentId: string | null = LABOR_DECISION_TREE[0]?.id ?? null;
    const guard = new Set<string>();

    while (currentId) {
      if (guard.has(currentId)) break;
      guard.add(currentId);

      const node = findLaborDecisionNode(currentId);
      if (!node) break;
      path.push(node.id);

      const given = answers[node.id];
      if (given === undefined) break;

      const branch = given ? node.yes : node.no;
      if (branch.next === null) break;
      currentId = branch.next;
    }
    return path;
  }, [answers]);

  function answer(id: string, value: boolean) {
    setAnswers((prev) => {
      // Answering a question invalidates everything downstream of it, so the
      // walker can never present a conclusion drawn from a stale later answer.
      const idx = LABOR_DECISION_TREE.findIndex((n) => n.id === id);
      const next: Record<string, boolean> = {};
      for (const node of LABOR_DECISION_TREE.slice(0, idx)) {
        if (node.id in prev) next[node.id] = prev[node.id];
      }
      next[id] = value;
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/85">
          Can this hour become cost of goods sold?
        </h3>
        {Object.keys(answers).length > 0 && (
          <button
            type="button"
            onClick={() => setAnswers({})}
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/5"
          >
            Start over
          </button>
        )}
      </div>

      <ol className="space-y-3">
        {visible.map((id, i) => {
          const node = findLaborDecisionNode(id);
          if (!node) return null;
          const given = answers[node.id];
          return (
            <li key={node.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/70">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-white/90">{node.question}</p>

                  {/* WHY THIS QUESTION IS HERE. This is the part that turns a
                      flowchart into a lesson. */}
                  <p className="text-xs leading-relaxed text-white/45">{node.whyAsked}</p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {([true, false] as const).map((v) => {
                      const active = given === v;
                      return (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => answer(node.id, v)}
                          className={[
                            "rounded-lg border px-3 py-1.5 text-left text-xs transition",
                            active
                              ? "border-white/40 bg-white/10 text-white"
                              : "border-white/12 text-white/60 hover:bg-white/5",
                          ].join(" ")}
                        >
                          <span className="font-semibold">{v ? "Yes" : "No"}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* The explanation for the branch actually taken. */}
                  {given !== undefined && (
                    <p className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs leading-relaxed text-white/60">
                      {(given ? node.yes : node.no).explanation}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {result.outcome && (
        <div className="rounded-xl border border-white/20 bg-white/[0.04] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
            Where this time lands
          </p>
          <p className="mt-1 text-sm font-medium text-white/90">{result.outcome}</p>
          {result.explanation && (
            <p className="mt-2 text-xs leading-relaxed text-white/55">{result.explanation}</p>
          )}
          {result.authorityIds.length > 0 && (
            <p className="mt-2 text-[11px] text-white/30">
              Authority:{" "}
              {result.authorityIds
                .map((a) => findPayrollAuthority(a)?.cite)
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// THE ROLE MAP — every kind of work, sorted by what it does to the tax.
// ===========================================================================
export function LaborRoleMap() {
  const groups: { treatment: LaborTreatment; heading: string; blurb: string }[] = [
    {
      treatment: "acquisition",
      heading: "Can reach inventory — with records",
      blurb:
        "Time spent acquiring possession of the goods. This is the whole of what a reseller may capitalise, and it is only available if you can show the minutes.",
    },
    {
      treatment: "separate",
      heading: "Belongs to a different business",
      blurb:
        "The ATM and the rental property are separate trades under CHAMP. Their wages are deductible against them — provided the separation is real and documented.",
    },
    {
      treatment: "selling",
      heading: "Never inventoriable, in any scenario",
      blurb:
        "Selling is the one cost the inventory rules exclude by name, and the exclusion binds a grower too. There is no version of the law in which these become COGS.",
    },
    {
      treatment: "admin",
      heading: "Running the store — disallowed by §280E",
      blurb:
        "Necessary work with no home in a reseller's inventory cost. Recorded honestly here rather than swept into 61000, which is the first place an examiner samples.",
    },
    {
      treatment: "owner",
      heading: "Owner and officer pay",
      blurb:
        "Disallowed like any other wage, and the most closely examined line on a closely-held return.",
    },
    {
      treatment: "production",
      heading: "Producer-only — shown so the fork is visible",
      blurb:
        "Real production labor IS capitalisable under §1.471-3(c). Greenway holds a RETAIL licence and cannot lawfully produce, so this branch is shown for understanding, not for use.",
    },
  ];

  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const roles = LABOR_ROLES.filter((r) => r.treatment === g.treatment);
        if (roles.length === 0) return null;
        const style = TREATMENT_STYLE[g.treatment];
        return (
          <section key={g.treatment} className={`rounded-xl border ${style.ring} ${style.bg} p-4`}>
            <h3 className={`text-sm font-semibold ${style.text}`}>{g.heading}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/50">{g.blurb}</p>

            <ul className="mt-3 space-y-2">
              {roles.map((r) => (
                <li
                  key={r.code}
                  className="rounded-lg border border-white/10 bg-black/20 p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-sm font-medium text-white/85">{r.label}</span>
                    <span className="font-mono text-xs text-white/40">
                      → {r.accountCode}
                    </span>
                    {r.neverInventoriable && (
                      <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-300">
                        never inventory
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/50">{r.plainEnglish}</p>
                  {r.authorityIds.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-white/25">
                      {r.authorityIds
                        .map((a) => findPayrollAuthority(a)?.cite)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11px] leading-relaxed text-white/35">{style.verdict}</p>
          </section>
        );
      })}
    </div>
  );
}
