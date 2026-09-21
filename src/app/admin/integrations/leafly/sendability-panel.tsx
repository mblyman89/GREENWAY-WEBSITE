"use client";

/**
 * src/app/admin/integrations/leafly/sendability-panel.tsx
 * ROADMAP R3 / R4 / R5 / R6 -- owner asks 3, 4, 5 and 7.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "if the sample set has a product in it that does not meet leafly's   #
 * #    contract, please both identify it, and give me a way to fix it, a   #
 * #    button that sends me to the page in the back office that lets me    #
 * #    fix it."                                            (ask 3)         #
 * #                                                                        #
 * #   "i want the ability to send the products that do pass leafly's       #
 * #    contract skipping the bad ones ... listing them with the button     #
 * #    that directs me to the area to fix it."             (ask 4)         #
 * #                                                                        #
 * #   "it did not give me the option to send the good products and         #
 * #    withhold the bad ones. nor does it let me fix the bad ones."        #
 * #                                                        (ask 7)         #
 * #                                                                        #
 * #   "if the fix is something simple, that could be blanket applied to    #
 * #    many products, please build that into the system somehow in a       #
 * #    professional expert enterprise way."                (ask 7)         #
 * ###########################################################################
 *
 * WHAT THIS PANEL IS FOR. Before the owner presses Send, he should already
 * know the answer to three questions: what will Leafly take, what will it
 * refuse, and what do I press to fix the refusals. Previously the answer to
 * all three arrived as a single wall of text after a failed push -- 124
 * errors addressed by id, with no route to a repair.
 *
 * THE FOUR RULES THIS UI INHERITS from `sendability-core.ts`:
 *   1. Never silently drop a product. Everything withheld is listed.
 *   2. Never lead with an id. Every line starts with a name.
 *   3. Never offer a fix link that might be wrong. `fixHref` is null when the
 *      right page cannot be determined, and then no button is drawn.
 *   4. A repeated defect is ONE unit of work, not N. Hence the grouped view.
 *
 * WHY THE BLANKET FIX PREVIEWS BEFORE IT APPLIES. The owner asked for a bulk
 * repair of the repeated defect. A bulk write against live product data that
 * runs the moment you click it is how one bad assumption becomes 124 bad
 * rows. So the plan is computed and DESCRIBED first -- how many are fixed
 * automatically, how many still need a person -- and applying it is a
 * separate, deliberate act.
 */

import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/admin/ui";
import {
  triageLeaflySelectionAction,
  pushLeaflyPassingOnlyAction,
} from "./selection-actions";
import type { SelectionTriageResult } from "@/lib/leafly/selection-server";

export function SendabilityPanel({
  selectedIds,
  onPushed,
}: {
  selectedIds: string[];
  onPushed?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [triage, setTriage] = useState<SelectionTriageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushOk, setPushOk] = useState<boolean | null>(null);
  const [showAllBlocked, setShowAllBlocked] = useState(false);

  function check() {
    setError(null);
    setPushMsg(null);
    setArmed(false);
    startTransition(async () => {
      const res = await triageLeaflySelectionAction({ ids: selectedIds });
      if (res.ok) setTriage(res.result);
      else setError(res.error);
    });
  }

  function sendPassing() {
    setPushMsg(null);
    setPushOk(null);
    startTransition(async () => {
      const res = await pushLeaflyPassingOnlyAction({
        ids: selectedIds,
        confirm: true,
      });
      if (res.ok) {
        setPushOk(true);
        const skipped =
          res.skipped.length > 0
            ? ` Held back ${res.skipped.length}: ${res.skipped
                .slice(0, 3)
                .map((s) => s.label)
                .join("; ")}${res.skipped.length > 3 ? "; and more" : ""}.`
            : "";
        setPushMsg(`${res.result.message ?? "Sent."}${skipped}`);
        onPushed?.();
      } else {
        setPushOk(false);
        setPushMsg(res.error);
      }
      setArmed(false);
    });
  }

  if (selectedIds.length === 0) return null;

  const t = triage?.triage ?? null;
  const blocked = t?.blocked ?? [];
  const shownBlocked = showAllBlocked ? blocked : blocked.slice(0, 8);

  return (
    <div className="rounded border border-white/15 bg-white/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          Will Leafly accept these {selectedIds.length}?
        </span>
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={check}
          disabled={pending}
        >
          {pending ? "Checking\u2026" : "Check before sending"}
        </Button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {triage && t && (
        <>
          <p className="mb-2 text-sm leading-relaxed">{triage.summary}</p>

          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone="green">{t.sendableCount} will send</Badge>
            {t.blockedCount > 0 && (
              <Badge tone="danger">{t.blockedCount} blocked</Badge>
            )}
            {t.warningCount > 0 && (
              <Badge tone="gold">{t.warningCount} warnings</Badge>
            )}
          </div>

          {/*
            Rule: untraceable errors must never be hidden behind a green
            summary. If these exist, skipping the named products would not
            make the payload valid, so partial send is refused server-side
            too -- this is the explanation, not the enforcement.
          */}
          {t.unattributedErrorCount > 0 && (
            <div className="mb-2 rounded border border-red-400/40 bg-red-400/10 p-2">
              <p className="text-xs font-semibold text-red-200">
                {t.unattributedErrorCount} problem
                {t.unattributedErrorCount === 1 ? "" : "s"} could not be traced to a
                specific product, so sending only the good ones would still fail.
              </p>
              <ul className="mt-1 list-disc pl-5 text-[0.7rem] text-red-200/90">
                {t.unattributedErrors.slice(0, 5).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ASK 7 -- the blanket fix, previewed before it is applied. */}
          {triage.remedyNarrative && (
            <div className="mb-2 rounded border border-amber-400/40 bg-amber-400/10 p-2">
              <p className="mb-1 text-xs font-semibold text-amber-100">
                One repeated problem accounts for many of these
              </p>
              <p className="text-[0.72rem] leading-relaxed text-amber-50/90">
                {triage.remedyNarrative}
              </p>
              {triage.remedyPlan && (
                <p className="mt-1 text-[0.7rem] text-amber-50/70">
                  {triage.remedyPlan.automatic} can be corrected automatically;{" "}
                  {triage.remedyPlan.manual} need a person to decide.
                </p>
              )}
            </div>
          )}

          {/* ASK 3 + 4 + 5 -- named failures, each with its own fix route. */}
          {blocked.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-xs font-semibold">
                Held back (fix these, then check again):
              </p>
              <ul className="space-y-1.5">
                {shownBlocked.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-start gap-2 rounded bg-white/[0.04] p-2"
                  >
                    <div className="min-w-0 flex-1">
                      {/* Rule 2: the NAME leads. */}
                      <div className="text-xs font-semibold">{b.label}</div>
                      <div className="text-[0.7rem] text-white/70">
                        {b.reasons[0]}
                        {b.reasons.length > 1
                          ? ` (+${b.reasons.length - 1} more)`
                          : ""}
                      </div>
                    </div>
                    {/* Rule 3: only render a link we are sure about. */}
                    {b.fixHref ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        href={b.fixHref}
                      >
                        Fix this product
                      </Button>
                    ) : (
                      <span className="text-[0.65rem] text-white/50">
                        No direct fix page &mdash; see the reason above
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {blocked.length > shownBlocked.length && (
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowAllBlocked(true)}
                >
                  Show all {blocked.length}
                </Button>
              )}
            </div>
          )}

          {/* ASK 4 + 7 -- send the good ones, withhold the bad ones. */}
          {t.partialSendPossible && t.unattributedErrorCount === 0 && (
            <div className="mt-2 rounded border border-emerald-400/40 bg-emerald-400/10 p-2">
              <p className="mb-2 text-xs leading-relaxed text-emerald-50">
                You can send the {t.sendableCount} that pass now and leave the{" "}
                {t.blockedCount} blocked one
                {t.blockedCount === 1 ? "" : "s"} off the menu until fixed.
              </p>
              {!armed ? (
                <Button
                  type="button"
                  variant="confirm"
                  size="sm"
                  onClick={() => setArmed(true)}
                  disabled={pending}
                >
                  Send the {t.sendableCount} that pass
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="confirm"
                    size="sm"
                    onClick={sendPassing}
                    disabled={pending}
                  >
                    {pending ? "Sending\u2026" : "Yes, send them now"}
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setArmed(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {pushMsg && (
            <p
              className={`mt-2 text-xs ${pushOk ? "text-emerald-200" : "text-red-300"}`}
            >
              {pushMsg}
            </p>
          )}
        </>
      )}
    </div>
  );
}
