"use client";

/**
 * src/components/admin/books/LeaveInboxWorkbench.tsx   (books-35)
 *
 * THE SICK-LEAVE APPROVAL INBOX, WITH THE CPA SITTING NEXT TO IT.
 *
 * WHAT MICHAEL DECIDED, VERBATIM (standing rule 1)
 *
 *   "Thank you. I like option 1 as well. It should reach me in accounting
 *    somewhere logical."
 *
 * and, on what every screen in this build owes him:
 *
 *   "Please make sure the last slice has expert cpa mentoring like the others...
 *    But I want rich mentorship and expert guidance. Please keep including that
 *    including the verbatim source text."
 *
 * So this screen is built like the timesheet workbench: the left column is the
 * work, the right column is the reason for the work (standing rule 25 - extend
 * the established pattern rather than invent a rival one).
 *
 * THE ONE IDEA THIS SCREEN EXISTS TO PROTECT
 *
 * Paid sick leave reaches a paycheque because MICHAEL APPROVED IT, and for no
 * other reason. That is option 1. The alternative - hours appearing on a
 * timesheet and being unpicked later - means the reversal is the thing that can
 * be forgotten, and a forgotten reversal is a wage overpayment nobody can
 * recover politely.
 *
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING
 *
 * Every number here arrives from the server, from `sick-leave-core.ts`. There
 * is no arithmetic in this file - not a multiplication, not a rounding, not a
 * comparison against forty. A balance rendered here was summed from the ledger
 * by the engine. If this file did its own sums they would eventually disagree
 * with the engine's, silently, on somebody's pay.
 *
 * A REFUSED REQUEST IS STILL SHOWN
 *
 * Requests the engine will not approve are rendered WITH their reasons rather
 * than hidden. Hiding one would leave an employee waiting indefinitely on a
 * request Michael never knew existed - and under WAC 296-128-770 the employee's
 * remedy for that is not a conversation.
 */

import { useState, useTransition } from "react";

import { Badge, Button, Card, CardHeader, Textarea } from "@/components/admin/ui";
import type { PendingRequest } from "@/lib/payroll/sick-leave-store";
import type { SickLeaveRefusal } from "@/lib/payroll/sick-leave-core";
import {
  SICK_LEAVE_REFUSAL_LESSONS,
  SICK_LEAVE_REVIEW_CHECKS,
} from "@/lib/payroll/sick-leave-mentor";
import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";

type DecisionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; refusals: readonly SickLeaveRefusal[] };

export type LeaveInboxWorkbenchProps = {
  readonly requests: readonly PendingRequest[];
  readonly clearCount: number;
  readonly blockedCount: number;
  readonly policyRefusals: readonly SickLeaveRefusal[];
  readonly decideAction: (input: {
    requestId: string;
    decision: "approve" | "deny";
    note: string | null;
  }) => Promise<DecisionResult>;
};

/** Whole minutes to the "7 hours 30 minutes" wording used across the engine. */
function minutesLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} minutes`;
  if (m === 0) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${h} ${h === 1 ? "hour" : "hours"} ${m} minutes`;
}

const PURPOSE_WORDING: Record<string, string> = {
  own_health: "Their own health",
  family_care: "Caring for a family member",
  closure: "Workplace or school closure",
  immigration: "Immigration proceedings",
  domestic_violence: "Domestic violence, sexual assault or stalking",
};

/**
 * The purpose, in words, with an honest fallback.
 *
 * The fallback says the raw value rather than inventing a friendly label for a
 * purpose this screen does not recognise. If migration 0198's CHECK ever gains
 * a sixth purpose, Michael sees the new value and asks about it, instead of
 * seeing a blank where a reason should be (standing rule 62d).
 */
function purposeWording(purpose: string): string {
  return PURPOSE_WORDING[purpose] ?? `Recorded as "${purpose}"`;
}

export function LeaveInboxWorkbench({
  requests,
  clearCount,
  blockedCount,
  policyRefusals,
  decideAction,
}: LeaveInboxWorkbenchProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    requests.length > 0 ? requests[0].id : null,
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  function decide(request: PendingRequest, decision: "approve" | "deny") {
    const note = (notes[request.id] ?? "").trim();
    setResult(null);
    startTransition(async () => {
      const res = await decideAction({
        requestId: request.id,
        decision,
        note: note.length > 0 ? note : null,
      });
      setResult(res);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ══ LEFT: the work ══════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* The outcome of the last decision, good or bad. */}
        {result ? (
          <Card>
            <CardHeader
              title={result.ok ? "Recorded" : "Nothing was changed"}
            />
            <p
              className={
                result.ok
                  ? "text-sm text-[var(--admin-accent)]"
                  : "text-sm text-[var(--admin-danger)]"
              }
            >
              {result.message}
            </p>
            {!result.ok && result.refusals.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {result.refusals.map((r) => (
                  <RefusalBlock key={r.code} refusal={r} />
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {/* Policy problems appear ONCE, not once per row. */}
        {policyRefusals.length > 0 ? (
          <Card>
            <CardHeader
              title="Your sick leave policy is incomplete, and it blocks every request below"
              subtitle="These are settings, not employee problems. Fixing them here clears all of the requests at once."
            />
            <ul className="space-y-3">
              {policyRefusals.map((r) => (
                <RefusalBlock key={r.code} refusal={r} />
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Requests waiting for you"
            subtitle={
              requests.length === 0
                ? "Nothing is waiting."
                : `${requests.length} waiting - ${clearCount} ready to approve, ${blockedCount} with something to sort out first.`
            }
            action={
              requests.length > 0 ? (
                <div className="flex gap-2">
                  <Badge tone="green">{clearCount} ready</Badge>
                  {blockedCount > 0 ? (
                    <Badge tone="orange">{blockedCount} blocked</Badge>
                  ) : null}
                </div>
              ) : null
            }
          />

          {requests.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              No sick leave is waiting for a decision. When an employee asks for a
              sick day it arrives here first, and it does not reach a timesheet or a
              paycheque until you approve it.
            </p>
          ) : (
            <ul className="space-y-3">
              {requests.map((req) => {
                const isSelected = req.id === selectedId;
                const blocked = req.refusals.length > 0 || req.blockedBy !== null;
                return (
                  <li
                    key={req.id}
                    className={`rounded-[var(--admin-radius-sm)] border p-4 ${
                      isSelected
                        ? "border-[var(--admin-accent)] bg-[var(--admin-surface-2)]"
                        : "border-[var(--admin-border)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(req.id)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--admin-text)]">
                          {req.employeeName}
                        </span>
                        {blocked ? (
                          <Badge tone="orange">Needs attention</Badge>
                        ) : (
                          <Badge tone="green">Ready to approve</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                        {minutesLabel(req.minutesRequested)} on {req.leaveDate} -{" "}
                        {purposeWording(req.purpose)}
                        {req.noticeKind === "unforeseeable"
                          ? " (unforeseeable)"
                          : " (foreseeable)"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                        Balance today: {minutesLabel(Math.max(0, req.balance.totalMinutes))}{" "}
                        ({minutesLabel(Math.max(0, req.balance.statutoryMinutes))} earned,{" "}
                        {minutesLabel(Math.max(0, req.balance.awardedMinutes))} awarded)
                      </p>
                      {req.employeeNote ? (
                        <p className="mt-2 text-sm italic text-[var(--admin-text-muted)]">
                          &ldquo;{req.employeeNote}&rdquo;
                        </p>
                      ) : null}
                    </button>

                    {/* A DATA problem, deliberately not dressed up as an
                        engine refusal - the engine was never asked. */}
                    {req.blockedBy ? (
                      <p className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-orange-soft)] p-3 text-sm text-[var(--admin-orange)]">
                        {req.blockedBy}
                      </p>
                    ) : null}

                    {req.refusals.length > 0 ? (
                      <ul className="mt-3 space-y-3">
                        {req.refusals.map((r) => (
                          <RefusalBlock key={r.code} refusal={r} />
                        ))}
                      </ul>
                    ) : null}

                    {/* The engine's own explanation of what approving does. */}
                    {req.review ? (
                      <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3">
                        <p className="text-sm text-[var(--admin-text)]">
                          {req.review.explanation}
                        </p>
                        {req.review.noticeShortfallNote ? (
                          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                            {req.review.noticeShortfallNote}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-3">
                      <Textarea
                        rows={2}
                        placeholder="Reason - required to deny, optional to approve"
                        value={notes[req.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [req.id]: e.target.value }))
                        }
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="confirm"
                        disabled={pending || blocked}
                        onClick={() => decide(req, "approve")}
                      >
                        Approve this day
                      </Button>
                      <Button
                        variant="danger"
                        disabled={pending}
                        onClick={() => decide(req, "deny")}
                      >
                        Deny
                      </Button>
                    </div>
                    {blocked ? (
                      <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                        Approving is unavailable until the point above is resolved.
                        Denying is always available, and always needs a reason.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ══ RIGHT: the reason for the work ══════════════════════════════ */}
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="What you are deciding"
            subtitle="The order these questions get asked in, and why that order."
          />
          <ol className="space-y-4">
            {[...SICK_LEAVE_REVIEW_CHECKS]
              .sort((a, b) => a.order - b.order)
              .map((check) => (
                <li key={check.key}>
                  <p className="text-sm font-semibold text-[var(--admin-text)]">
                    {check.order}. {check.question}
                  </p>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    {check.whyThisOrder}
                  </p>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    <span className="font-semibold">If it fails: </span>
                    {check.ifItFails}
                  </p>
                </li>
              ))}
          </ol>
        </Card>

        {/* THE VERBATIM SOURCE TEXT. Michael asked for this by name and it is
            rendered as a quotation with its citation, never paraphrased. */}
        <Card>
          <CardHeader
            title="The rules themselves, word for word"
            subtitle="Quoted exactly. The plain-English reading is underneath each one, kept separate on purpose so you can always see which is the law and which is us."
          />
          <ul className="space-y-4">
            {SELECTED_AUTHORITY_IDS.map((id) => {
              const a = SICK_LEAVE_AUTHORITIES.find((x) => x.id === id);
              if (!a) return null;
              return (
                <li key={a.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    {a.cite}
                  </p>
                  <blockquote className="mt-1 border-l-2 border-[var(--admin-accent)] pl-3 text-sm italic text-[var(--admin-text)]">
                    {a.quote}
                  </blockquote>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    {a.soWhat}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>

        {selected && selected.refusals.length > 0 ? (
          <Card>
            <CardHeader title="Why this one is being held up" />
            <ul className="space-y-4">
              {selected.refusals.map((r) => {
                const lesson = SICK_LEAVE_REFUSAL_LESSONS.find(
                  (l) => l.code === r.code,
                );
                if (!lesson) return null;
                return (
                  <li key={r.code}>
                    <p className="text-sm font-semibold text-[var(--admin-text)]">
                      {lesson.headline}
                    </p>
                    <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                      {lesson.whyWeStop}
                    </p>
                    <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                      <span className="font-semibold">What to do: </span>
                      {lesson.whatToDo}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The authorities worth having permanently on screen for an approval decision.
 *
 * A SHORT LIST ON PURPOSE. All sixteen would be a wall of text nobody reads,
 * which is the same as no mentoring at all. These four are the ones that decide
 * whether a request may be approved, what it must be paid at, and the two
 * traps - notice and verification - where a well-meaning employer most often
 * refuses leave they actually owe.
 *
 * The ids are checked at build time by tests/compliance/leave-inbox-screen.test.ts
 * against the real registry, so a typo here cannot render a blank card.
 */
const SELECTED_AUTHORITY_IDS = [
  "wac-296-128-630-usable",
  "wac-296-128-630-employee-chooses",
  "wac-296-128-670-rate",
  "wac-296-128-660-no-burden",
] as const;

/** One refusal, with its message and the single action that clears it. */
function RefusalBlock({ refusal }: { refusal: SickLeaveRefusal }) {
  return (
    <li className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-danger-soft)] p-3">
      <p className="text-sm text-[var(--admin-danger)]">{refusal.message}</p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        <span className="font-semibold">What to do: </span>
        {refusal.fix}
      </p>
    </li>
  );
}
