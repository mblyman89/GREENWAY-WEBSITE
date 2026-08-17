/**
 * src/app/admin/books/bills/Section280EExplainer.tsx   (slice books-03)
 *
 * THE PICTURE OF §280E.
 *
 * Michael, 2026-08-17, recorded verbatim (standing rule 1):
 *
 *   "I learn best visually, so if we can add visual elements and helpers that
 *    explain things visually that'd be great."
 *   "I have always needed a mentor, a cpa or cfo to shadow, I want our platform
 *    to be that mentor."
 *
 * WHAT THIS COMPONENT IS
 * A teaching surface, not a form. It renders TWO things, both computed by
 * `vendor-bill-core.ts` and both covered by that module's tests:
 *
 *   1. THE DECISION TREE — the six questions, in the order a CPA would actually
 *      ask them, each with the reason it sits at that point in the sequence.
 *      Answer them and the tree tells you the treatment AND why.
 *   2. THE MONEY BAR — where a bill's money actually went, in §280E terms,
 *      drawn from integer milli-percent widths that sum to exactly 100%.
 *
 * WHY THE LOGIC IS NOT IN THIS FILE
 * Because a diagram that drifts from the engine is worse than no diagram: it
 * teaches the wrong thing with confidence. The tree and the bar geometry are
 * DATA exported by the pure core, so the picture on screen and the rule that
 * runs at posting time are physically the same thing. If someone changes the
 * rule, the picture changes with it — or the tests fail.
 *
 * This is a client component only because the tree is interactive. It performs
 * no I/O and makes no decisions of its own.
 */

"use client";

import { useState, useMemo } from "react";

import {
  DECISION_TREE,
  PURCHASE_KINDS,
  walkDecisionTree,
  findAuthority,
  findPurchaseKind,
  formatCents,
  type BucketBar,
  type PurchaseTreatment,
} from "@/lib/accounting/vendor-bill-core";

// ---------------------------------------------------------------------------
// Presentation vocabulary. Colour carries meaning here, so it is defined once.
// GREEN = the money you keep. RED = the money §280E takes. Everything else is
// neutral because it is neither.
// ---------------------------------------------------------------------------
const TREATMENT_STYLE: Record<
  PurchaseTreatment,
  { label: string; ring: string; text: string; bg: string; verdict: string }
> = {
  inventory: {
    label: "Inventory → COGS",
    ring: "border-emerald-400/40",
    text: "text-emerald-300",
    bg: "bg-emerald-400/10",
    verdict: "§280E CANNOT touch this. It reduces your income when the goods sell.",
  },
  expense: {
    label: "Operating expense",
    ring: "border-rose-400/40",
    text: "text-rose-300",
    bg: "bg-rose-400/10",
    verdict: "§280E DISALLOWS this. Record it correctly anyway — it is still real money.",
  },
  asset: {
    label: "Asset",
    ring: "border-sky-400/40",
    text: "text-sky-300",
    bg: "bg-sky-400/10",
    verdict: "Capitalise and depreciate. This is not a §280E question at all.",
  },
  trust: {
    label: "Trust liability",
    ring: "border-amber-400/40",
    text: "text-amber-300",
    bg: "bg-amber-400/10",
    verdict: "The state's money passing through. It never touches your profit and loss.",
  },
  quarantine: {
    label: "Unclassified",
    ring: "border-white/25",
    text: "text-white/70",
    bg: "bg-white/5",
    verdict: "Parked where you can see it, because guessing here is what costs money.",
  },
};

const BAR_COLOUR: Record<BucketBar["key"], string> = {
  inventoriable: "bg-emerald-400",
  disallowed: "bg-rose-400",
  capitalised: "bg-sky-400",
  trust: "bg-amber-400",
  quarantined: "bg-white/30",
};

// ===========================================================================
// THE MONEY BAR
// ===========================================================================
export function MoneyBar({ bars, totalCents }: { bars: readonly BucketBar[]; totalCents: number }) {
  const shown = bars.filter((b) => b.cents !== 0);

  if (shown.length === 0) {
    return (
      <p className="text-sm text-white/40">
        Nothing to show yet — add a line and the picture appears here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* The bar itself. Widths are integer milli-percent, so this always
          fills exactly — never 99.9%, which is what makes a chart look broken. */}
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-white/10 bg-black/30">
        {shown.map((b) => (
          <div
            key={b.key}
            className={`${BAR_COLOUR[b.key]} h-full transition-all`}
            style={{ width: `${b.milliPercent / 1000}%` }}
            title={`${b.label}: ${formatCents(b.cents)}`}
          />
        ))}
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        {shown.map((b) => (
          <div key={b.key} className="flex items-start gap-2 text-xs">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${BAR_COLOUR[b.key]}`} />
            <div className="min-w-0">
              <dt className="font-medium text-white/80">
                {b.label} — {formatCents(b.cents)}{" "}
                <span className="text-white/40">({(b.milliPercent / 1000).toFixed(1)}%)</span>
              </dt>
              <dd className="text-white/45">{b.meaning}</dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="border-t border-white/10 pt-2 text-xs text-white/40">
        Bill total {formatCents(totalCents)}. Every cent lands in exactly one bucket — the
        buckets are checked against the total on every calculation, so money can never be
        invented or lost in this picture.
      </p>
    </div>
  );
}

// ===========================================================================
// THE DECISION TREE
// ===========================================================================
export function DecisionTreeWalker() {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const result = useMemo(() => walkDecisionTree(answers), [answers]);

  // Only show questions actually on the current path. Showing all six at once
  // turns a decision procedure into a quiz, and the ORDER is the lesson.
  const visible = useMemo(() => {
    const path: string[] = [];
    let current = DECISION_TREE[0];
    for (let i = 0; i < DECISION_TREE.length && current; i += 1) {
      path.push(current.id);
      const a = answers[current.id];
      if (a === undefined) break;
      const branch = a ? current.yes : current.no;
      if (branch.leafTreatment || !branch.nextId) break;
      const next = DECISION_TREE.find((n) => n.id === branch.nextId);
      if (!next) break;
      current = next;
    }
    return path;
  }, [answers]);

  function answer(id: string, value: boolean) {
    setAnswers((prev) => {
      // Answering a question invalidates everything downstream of it, so the
      // walker can never show a conclusion drawn from a stale later answer.
      const idx = DECISION_TREE.findIndex((n) => n.id === id);
      const next: Record<string, boolean> = {};
      for (const node of DECISION_TREE.slice(0, idx)) {
        if (node.id in prev) next[node.id] = prev[node.id];
      }
      next[id] = value;
      return next;
    });
  }

  const style = result.leafTreatment ? TREATMENT_STYLE[result.leafTreatment] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/85">
          Which bucket does this cost belong in?
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
          const node = DECISION_TREE.find((n) => n.id === id)!;
          const given = answers[node.id];
          return (
            <li
              key={node.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/70">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-white/90">{node.question}</p>

                  {/* WHY THIS QUESTION IS HERE. This is the part that turns a
                      flowchart into a lesson. */}
                  <p className="text-xs leading-relaxed text-white/45">{node.whyHere}</p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {([true, false] as const).map((v) => {
                      const branch = v ? node.yes : node.no;
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
                          <span className="ml-2 text-white/45">{branch.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {node.authorityIds.length > 0 && (
                    <p className="pt-1 text-[11px] text-white/30">
                      Authority:{" "}
                      {node.authorityIds
                        .map((a) => findAuthority(a)?.cite)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {style && (
        <div className={`rounded-xl border ${style.ring} ${style.bg} p-4`}>
          <p className={`text-sm font-semibold ${style.text}`}>{style.label}</p>
          <p className="mt-1 text-sm text-white/75">{result.leafLabel}</p>
          <p className="mt-2 text-xs text-white/55">{style.verdict}</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// THE ONE-SCREEN MAP — the whole taxonomy, sorted by what it does to the tax.
// ===========================================================================
export function TreatmentMap() {
  const groups: { treatment: PurchaseTreatment; heading: string; blurb: string }[] = [
    {
      treatment: "inventory",
      heading: "Survives §280E",
      blurb:
        "These costs ride into inventory and come out as cost of goods sold. COGS is subtracted before income is even measured (Reg. §1.61-3(a)), so §280E never reaches it. Every dollar you correctly land here is a dollar you are not taxed on.",
    },
    {
      treatment: "trust",
      heading: "Not yours at all",
      blurb:
        "Money you collect for the state. It is a liability the moment you take it. It is neither income nor expense, and mixing it into either distorts every margin you look at.",
    },
    {
      treatment: "asset",
      heading: "Capitalise",
      blurb:
        "Long-lived things. Not a §280E question — but expensing them throws away basis and hides real value from your balance sheet.",
    },
    {
      treatment: "expense",
      heading: "§280E takes these",
      blurb:
        "Genuine, ordinary, necessary business costs that §280E disallows anyway. They still belong on your books: they are real, they matter to running the business, and if the law changes they become deductible.",
    },
    {
      treatment: "quarantine",
      heading: "Unclassified on purpose",
      blurb:
        "Where a purchase waits when nobody has decided yet. Visible, countable, and never silently absorbed into one of the buckets above.",
    },
  ];

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const kinds = KIND_CODES_BY_TREATMENT[g.treatment] ?? [];
        const style = TREATMENT_STYLE[g.treatment];
        return (
          <section key={g.treatment} className={`rounded-xl border ${style.ring} ${style.bg} p-4`}>
            <h4 className={`text-sm font-semibold ${style.text}`}>{g.heading}</h4>
            <p className="mt-1 text-xs leading-relaxed text-white/55">{g.blurb}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {kinds.map((code) => {
                const k = findPurchaseKind(code);
                if (!k) return null;
                return (
                  <li
                    key={code}
                    title={k.why}
                    className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/70"
                  >
                    {k.label}{" "}
                    <span className="text-white/30">{k.debitAccountCode}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Grouped once at module load rather than on every render. Derived from
 * PURCHASE_KINDS itself, so a purchase kind added to the core appears on this
 * map automatically — a hand-typed list here would silently go stale, which is
 * the exact failure mode this whole slice exists to prevent.
 */
const KIND_CODES_BY_TREATMENT: Record<PurchaseTreatment, string[]> = (() => {
  const out: Record<PurchaseTreatment, string[]> = {
    inventory: [], expense: [], asset: [], trust: [], quarantine: [],
  };
  for (const k of PURCHASE_KINDS) out[k.treatment].push(k.code);
  return out;
})();
