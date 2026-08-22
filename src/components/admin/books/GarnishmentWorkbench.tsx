"use client";

/**
 * src/components/admin/books/GarnishmentWorkbench.tsx   (books-36)
 *
 * WAGE GARNISHMENTS AND CHILD SUPPORT, WITH THE CPA SITTING NEXT TO IT.
 *
 * WHY THIS SCREEN EXISTS, VERBATIM (standing rule 1)
 *
 *   "in the summary report, will you check and confirm that the child support
 *    is included in the garnishments page. I will need it as well."
 *
 * The answer at the time was uncomfortable: the child support ARITHMETIC was
 * built, correct, and mutation-tested - and there was no garnishments page. The
 * audit in phase A found that `garnishment-mentor.ts` (862 lines of teaching)
 * and `garnishment-authorities.ts` (11 verbatim legal texts) were imported by
 * NO screen in the application. Michael had never seen a word of it.
 *
 * On what every screen owes him:
 *
 *   "Keep adding all the mentoring and guidance walkthroughs from the PhD cpa
 *    we have been building. It is the single greatest thing we have included in
 *    this project in my opinion."
 *
 * and on how it must look:
 *
 *   "Please make sure you use our themes and colors and text and styles and
 *    such. I want the pages to match our style and to be as clean as possible
 *    so I don't get lost in the guidance helpers."
 *
 * So this is built to the SAME two-column shape as the timesheet and leave
 * workbenches - work on the left, reasons on the right - using the same
 * `@/components/admin/ui` primitives and the same `--admin-*` tokens. Standing
 * rule 25: extend the established pattern rather than invent a rival one. A
 * third visual language would be the thing that makes the guidance feel like
 * clutter instead of help.
 *
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING
 *
 * Every cent shown here was calculated by `garnishment-core.ts`. There is no
 * arithmetic in this file - no percentage, no cap, no comparison against a
 * floor. If this file did its own sums they would eventually disagree with the
 * engine's, silently, on somebody's child support.
 *
 * WHY BLOCKED ORDERS ARE SHOWN LOUDLY RATHER THAN HIDDEN
 *
 * An order the engine cannot compute is displayed WITH the question that would
 * unblock it. Hiding it would leave a live legal obligation invisible, and the
 * penalty for ignoring an income withholding order lands on the EMPLOYER, not
 * on the employee.
 */

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { GARNISHMENT_AUTHORITIES } from "@/lib/payroll/garnishment-authorities";
import {
  GARNISHMENT_REVIEW_CHECKS,
  GARNISHMENT_SCREEN_LESSONS,
} from "@/lib/payroll/garnishment-mentor";
import type { GarnishmentRefusal } from "@/lib/payroll/garnishment-core";
import type { WageOrderDetail, WorkedExample } from "@/lib/payroll/garnishment-store";

export type GarnishmentWorkbenchProps = {
  readonly orders: readonly WageOrderDetail[];
  readonly activeCount: number;
  readonly blockedCount: number;
  readonly worked: WorkedExample | null;
};

/**
 * Order kinds in Michael's language, with the ceiling that governs each.
 *
 * The ceiling is named on the chip because "which cap applies" is the decision
 * the whole calculation turns on, and it is decided entirely by the KIND. A
 * reader who sees "child support" and "up to 65%" together has learned the most
 * important thing about the row without opening anything.
 */
const KIND_WORDING: Record<string, { readonly label: string; readonly ceiling: string }> = {
  child_support: { label: "Child support", ceiling: "50-65% ceiling, not 25%" },
  spousal_support: { label: "Spousal maintenance", ceiling: "50-65% federal, 50% in WA" },
  creditor: { label: "Creditor garnishment", ceiling: "25% ceiling" },
  federal_tax_levy: { label: "Federal tax levy", ceiling: "No 25% ceiling - IRS table" },
  state_tax_levy: { label: "State tax levy", ceiling: "No 25% ceiling" },
};

/**
 * The kind, in words, with an honest fallback.
 *
 * The fallback prints the raw value rather than inventing a friendly label for
 * a kind this screen does not recognise. If 0198's CHECK ever gains a sixth
 * kind, Michael sees the unfamiliar value and asks about it, instead of seeing
 * a confident label over a number nobody validated (standing rule 62d).
 */
function kindLabel(kind: string): string {
  return KIND_WORDING[kind]?.label ?? `Recorded as "${kind}"`;
}

function kindCeiling(kind: string): string | null {
  return KIND_WORDING[kind]?.ceiling ?? null;
}

/** Cents to dollars for DISPLAY only. No rounding decision is made here. */
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function GarnishmentWorkbench({
  orders,
  activeCount,
  blockedCount,
  worked,
}: GarnishmentWorkbenchProps) {
  const supportOrders = orders.filter(
    (o) => o.order.orderKind === "child_support" || o.order.orderKind === "spousal_support",
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ══ LEFT: the work ══════════════════════════════════════════════ */}
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Active wage orders"
            subtitle={
              activeCount === 0
                ? "No active orders are on file."
                : `${activeCount} active - ${activeCount - blockedCount} ready to calculate, ${blockedCount} needing an answer first.`
            }
            action={
              activeCount > 0 ? (
                <div className="flex gap-2">
                  <Badge tone="green">{activeCount - blockedCount} ready</Badge>
                  {blockedCount > 0 ? <Badge tone="orange">{blockedCount} blocked</Badge> : null}
                </div>
              ) : null
            }
          />

          {activeCount === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              Nothing is on file. When a court, the Division of Child Support, or the
              IRS sends an order, it is recorded here and every pay run from that day
              forward withholds against it automatically - within the legal ceilings
              set out on the right.
            </p>
          ) : (
            <ul className="space-y-4">
              {orders.map((o) => {
                const blocked = o.missingFacts.length > 0;
                const ceiling = kindCeiling(o.order.orderKind);
                return (
                  <li
                    key={o.order.id}
                    className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--admin-text)]">
                          {o.employeeName}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
                          {kindLabel(o.order.orderKind)} &middot; case {o.order.caseNumber}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ceiling ? <Badge tone="neutral">{ceiling}</Badge> : null}
                        {blocked ? (
                          <Badge tone="orange">Needs an answer</Badge>
                        ) : (
                          <Badge tone="green">Ready</Badge>
                        )}
                      </div>
                    </div>

                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <Detail label="Issued by" value={o.issuingAuthority} />
                      <Detail label="Pay to" value={o.payeeName} />
                      <Detail label="Order dated" value={o.orderDate} />
                      <Detail
                        label="Amount"
                        value={
                          o.order.amountCents !== null
                            ? `${money(o.order.amountCents)} per pay period`
                            : o.order.percentOfDisposableBasisPoints !== null
                              ? `${o.order.percentOfDisposableBasisPoints / 100}% of disposable earnings`
                              : "Not stated on the order"
                        }
                      />
                      {o.arrearsCents !== null ? (
                        <Detail label="Arrears owed" value={money(o.arrearsCents)} />
                      ) : null}
                      <Detail label="In force from" value={o.effectiveFrom} />
                    </dl>

                    {/* The unanswered questions, next to the order they block. */}
                    {blocked ? (
                      <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-orange-soft)] p-3">
                        <p className="text-xs font-semibold text-[var(--admin-orange)]">
                          This order is not being calculated yet
                        </p>
                        <ul className="mt-1 space-y-1">
                          {o.missingFacts.map((f) => (
                            <li key={f} className="text-xs text-[var(--admin-text-muted)]">
                              {f}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                          It has been left out of the totals rather than guessed at. Guessing
                          low under-withholds, and an employer who under-withholds a support
                          order can be made to pay the difference personally.
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* The worked calculation, when a pay period has been supplied. */}
        {worked ? (
          <Card>
            <CardHeader
              title="What this pay period would withhold"
              subtitle="Every figure below was produced by the calculator, with its reasoning shown. Nothing on this screen does its own arithmetic."
            />
            {worked.ok ? (
              <>
                <p className="text-sm text-[var(--admin-text-muted)]">
                  {worked.result.disposable.explanation}
                </p>
                <ul className="mt-4 space-y-3">
                  {worked.result.lines.map((line) => (
                    <li
                      key={line.orderId}
                      className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--admin-text)]">
                          {kindLabel(line.orderKind)} &middot; case {line.caseNumber}
                        </p>
                        <p className="text-sm font-semibold text-[var(--admin-accent)]">
                          {money(line.withheldCents)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                        {line.explanation}
                      </p>
                      {line.shortfallCents > 0 ? (
                        <p className="mt-1 text-xs text-[var(--admin-orange)]">
                          The order asked for {money(line.requestedCents)}. The law caps it at{" "}
                          {money(line.lawfulMaximumCents)}, so {money(line.shortfallCents)} could
                          not be taken. That shortfall is not forgiven - it stays owed.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm font-semibold text-[var(--admin-text)]">
                  Total withheld this period: {money(worked.result.totalWithheldCents)}
                </p>
                {worked.result.notes.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {worked.result.notes.map((n) => (
                      <li key={n} className="text-xs text-[var(--admin-orange)]">
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <ul className="space-y-3">
                {worked.refusals.map((r) => (
                  <RefusalBlock key={`${r.code}-${r.orderId ?? "all"}`} refusal={r} />
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {/* ══ RIGHT: the reason for the work ══════════════════════════════ */}
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="How a garnishment is worked out"
            subtitle="The order these questions get asked in, and why that order."
          />
          <ol className="space-y-4">
            {[...GARNISHMENT_REVIEW_CHECKS]
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

        {/* CHILD SUPPORT, GIVEN ITS OWN CARD because Michael asked for it by
            name and because it is the kind that breaks the rule everyone
            thinks they know. Shown whenever a support order is on file. */}
        {supportOrders.length > 0 ? (
          <Card>
            <CardHeader
              title="Child support does not stop at 25%"
              subtitle="The one thing to know before checking any support order."
            />
            <p className="text-xs text-[var(--admin-text-muted)]">
              The familiar 25% ceiling is for ordinary creditor garnishments. Support
              orders are governed by a different subsection entirely, and the ceiling
              is 50% if the employee supports another spouse or child and 60% if not -
              each rising five points when arrears are more than twelve weeks old. So
              50, 55, 60 or 65.
            </p>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              Washington then caps support withholding at 50% flat, and the employee
              keeps the benefit of whichever ceiling is stricter. The calculator works
              out both and uses the lower one.
            </p>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              Support is also paid FIRST. If two orders compete for the same cheque,
              the support order is satisfied before any creditor garnishment sees a
              cent.
            </p>
          </Card>
        ) : null}

        {/* THE VERBATIM SOURCE TEXT. Michael asked for this by name, and it is
            rendered as a quotation with its citation, never paraphrased. */}
        <Card>
          <CardHeader
            title="The rules themselves, word for word"
            subtitle="Quoted exactly. The plain-English reading is underneath each one, kept separate on purpose so you can always see which is the law and which is us."
          />
          <ul className="space-y-4">
            {SELECTED_AUTHORITY_IDS.map((id) => {
              const a = GARNISHMENT_AUTHORITIES.find((x) => x.id === id);
              if (!a) return null;
              return (
                <li key={a.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    {a.cite}
                  </p>
                  <blockquote className="mt-1 border-l-2 border-[var(--admin-accent)] pl-3 text-sm italic text-[var(--admin-text)]">
                    {a.quote}
                  </blockquote>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{a.soWhat}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="The traps in this area"
            subtitle="Mistakes competent people actually make, not definitions."
          />
          <ul className="space-y-4">
            {GARNISHMENT_SCREEN_LESSONS.map((lesson) => (
              <li key={lesson.topic}>
                <p className="text-sm font-semibold text-[var(--admin-text)]">{lesson.topic}</p>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  {lesson.plainEnglish}
                </p>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  <span className="font-semibold">Why it matters: </span>
                  {lesson.whyItMatters}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/**
 * The authorities worth having permanently on screen for a garnishment.
 *
 * A SHORT LIST ON PURPOSE. All eleven would be a wall of text nobody reads,
 * which is the same as no mentoring at all - and Michael asked specifically not
 * to "get lost in the guidance helpers." These four are the ones that decide
 * the base, the ordinary ceiling, the support ceiling, and Washington's
 * stricter support cap.
 *
 * These ids are resolved against the real registry by
 * `tests/compliance/garnishment-screen.test.ts`, in the test named
 * "every selected authority id resolves in the real registry", so a typo here
 * cannot silently render a blank card.
 *
 * THAT SENTENCE WAS A LIE WHEN IT WAS FIRST WRITTEN. The draft of this file
 * claimed the gate existed and named a section of a file that had not been
 * created. That is precisely the defect the phase A audit was built to find -
 * a comment asserting a verification nobody performed - so the gate was written
 * before this file was committed, and the claim above is now checkable by
 * opening the named test. If you ever delete that test, delete this paragraph
 * with it.
 */
const SELECTED_AUTHORITY_IDS = [
  "usc-15-1672-disposable",
  "usc-15-1673-max-garnishment",
  "usc-15-1673-support-cap",
  "rcw-26-18-090-fifty-percent",
] as const;

/** One labelled fact in the order summary. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--admin-text-muted)]">{label}:</dt>
      <dd className="text-[var(--admin-text)]">{value}</dd>
    </div>
  );
}

/** One refusal, with its message and the single action that clears it. */
function RefusalBlock({ refusal }: { refusal: GarnishmentRefusal }) {
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
