/**
 * src/app/admin/inventory/audits/new/page.tsx   (slice books-12)
 *
 * THE PLANNING SCREEN -- where the scope gets decided BEFORE any number is known.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ORDER OF THIS PAGE MATTERS MORE THAN ITS LOOKS
 * ---------------------------------------------------------------------------
 * The single most common way an inventory count stops being evidence is that
 * somebody decides what to count AFTER seeing which numbers look uncomfortable.
 * Once that happens the count answers the question "can I find a set of shelves
 * that agree with my books" instead of "do my books describe the shop".
 *
 * So this page does things in a fixed order and will not let them be reordered:
 *
 *   1. The system PROPOSES a scope, ranked by risk, with its reasons stated.
 *   2. Michael reads WHY each product was selected.
 *   3. Michael writes down the reason for the scope, in his own words.
 *   4. Only then is a session created and the numbers frozen.
 *
 * The rationale box is mandatory and the action refuses anything under ten
 * characters. That is not bureaucracy: a scope with no recorded reason cannot
 * later be defended as anything except "we counted what we felt like counting",
 * which is exactly the accusation a documented scope exists to answer.
 *
 * ---------------------------------------------------------------------------
 * WHY WHOLE PRODUCTS, NEVER LOOSE LOTS
 * ---------------------------------------------------------------------------
 * The planner admits a product's lots ALL TOGETHER or not at all, and this page
 * presents them that way. Two packages of one product from different batches
 * are indistinguishable by eye. If you count one batch and not the other, the
 * counter has no way to know which pile they are looking at -- and the tidy
 * total that results is the lot-consolidation failure that has already happened
 * in this shop. Cohesion beats the lot budget, and when it does the planner
 * says so out loud instead of quietly trimming.
 */
import { requirePermission } from "@/lib/auth/session";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Field, Input, Textarea } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import {
  RISK_REASON_TEXT,
  type RiskReasonCode,
  type AuditPlan,
  type AuditPlanGroup,
  type CoverageReport,
} from "@/lib/inventory/inventory-audit-core";
import { proposeScope } from "@/lib/inventory/audit-hub-store";
import { createAuditAction } from "../actions";
import { HubRefusal } from "../HubRefusal";
import { WhyBlockedPanel } from "../WhyBlockedPanel";
import { AuditMethodPanel } from "../AuditHubExplainer";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";
const H2 = "text-sm font-bold text-white";

function defaultLabel(): string {
  const d = new Date();
  const month = d.toLocaleString("en-US", { month: "long" });
  return `${month} ${d.getFullYear()} count`;
}

export default async function NewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ refusal?: string; refusalCode?: string; all?: string }>;
}) {
  // books-23: owner only. Choosing what to count is the owner's decision.
  await requirePermission("inventory.audit");
  const sp = await searchParams;

  // `includeOnlyDue: false` widens the net to everything active. It is opt-in
  // via ?all=1 because the default view should be the disciplined one -- count
  // what the cadence says is due -- while still allowing a deliberate override
  // when Michael has a reason, such as the 2026-10-31 full physical.
  const wantsAll = sp.all === "1";
  const proposed = await proposeScope({
    maxLots: wantsAll ? 400 : 40,
    includeOnlyDue: !wantsAll,
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Auditing", href: "/admin/inventory/audits" },
          { label: "Plan a count" },
        ]}
      />

      <AdminPageHeader
        title="Plan a count"
        subtitle="The system proposes what to count and says why. You decide, and you write down the reason -- before anyone sees a single number."
        action={
          <Button href="/admin/inventory/audits" variant="neutral" size="sm">
            Back to the hub
          </Button>
        }
      />

      {/* A refusal bounced back from the action, shown with its remedy rather
          than as a bare red string. */}
      {sp.refusal ? (
        <WhyBlockedPanel blockers={[sp.refusal]} title="This could not be saved yet" />
      ) : null}

      {!proposed.ok ? (
        <HubRefusal refusal={proposed.refusal} context="the proposed scope" />
      ) : (
        <PlanBody
          plan={proposed.data.plan}
          coverage={proposed.data.coverage}
          wantsAll={wantsAll}
        />
      )}

      {/* The method sits BELOW the working area, not above it. Michael has
          asked to be mentored, but a person who came here to start a count
          should reach the form first and the lesson second. */}
      <AuditMethodPanel />
    </div>
  );
}

function PlanBody({
  plan,
  coverage,
  wantsAll,
}: {
  plan: AuditPlan;
  coverage: CoverageReport;
  wantsAll: boolean;
}) {
  const nothingDue = plan.groups.length === 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Products proposed"
          value={String(plan.groups.length)}
          hint="Whole products, never half a product"
          accent="green"
        />
        <StatCard
          label="Lots to count"
          value={String(plan.lotCount)}
          hint={`${plan.totalUnits.toLocaleString()} units on the shelf`}
          accent="gold"
        />
        <StatCard
          label="Value in scope"
          value={plan.totalCostCents === null ? "Not calculable" : formatCents(plan.totalCostCents)}
          hint={
            plan.totalCostCents === null
              ? "One lot has no cost on file, so a total would be invented"
              : "At recorded invoice cost"
          }
          accent={plan.totalCostCents === null ? "orange" : "muted"}
        />
        <StatCard
          label="Products with several open lots"
          value={String(plan.multiLotGroupCount)}
          hint="The pattern that broke the books before"
          accent={plan.multiLotGroupCount > 0 ? "orange" : "muted"}
        />
      </div>

      {/* The planner's own notes. These are the sentences that explain why the
          plan is not simply "the top 40 by value", and they are shown rather
          than kept in a log nobody reads. */}
      {plan.notes.length > 0 ? (
        <section className={CARD}>
          <h2 className={H2}>How this list was chosen</h2>
          <ul className="mt-2 space-y-1.5">
            {plan.notes.map((n: string) => (
              <li key={n} className={`${P} flex gap-2`}>
                <span className="text-[var(--admin-accent)]">&bull;</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
          {plan.budgetOverriddenForCohesion ? (
            <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] px-3 py-2 text-xs text-white/85">
              One product pushed this list over its usual size, and it was kept whole on purpose.
              Splitting a product across two counts is how two batches of the same thing get
              counted as one pile.
            </p>
          ) : null}
          {plan.deferredGroups > 0 ? (
            <p className={`mt-3 ${P}`}>
              {plan.deferredGroups} more product{plan.deferredGroups === 1 ? "" : "s"} qualified but
              did not fit in this session. Nothing has been dropped &mdash; they stay due and will
              be proposed next time.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Coverage lives on the planning screen as well as the hub, because the
          moment you are choosing a scope is the moment the annual-coverage
          question is actually actionable. */}
      <section
        className={`rounded-2xl border p-5 ${
          coverage.meetsAnnualStandard
            ? "border-[var(--admin-accent)]/35 bg-[var(--admin-accent)]/[0.05]"
            : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/[0.06]"
        }`}
      >
        <h2 className={H2}>Where the programme stands right now</h2>
        <p className={`mt-1 ${P}`}>{coverage.verdict}</p>
        {coverage.beyondOneYear > 0 ? (
          <p className="mt-2 text-sm text-white/85">
            {coverage.beyondOneYear} lot{coverage.beyondOneYear === 1 ? " has" : "s have"} not been
            counted within a year. Cycle counting only substitutes for a full annual count while
            the cycles genuinely cover everything &mdash; these are the lots that break that claim,
            so they are the ones worth counting first.
          </p>
        ) : null}
      </section>

      {nothingDue ? (
        <section className={CARD}>
          <h2 className={H2}>Nothing is due for a count today</h2>
          <p className={`mt-1 ${P}`}>
            Every lot is inside its cadence window. That is a good outcome and not a reason to
            invent work &mdash; counting things that were just counted uses the staff time the
            overdue stock will need later.
          </p>
          <p className={`mt-2 ${P}`}>
            If you are starting the full physical count, or you want to look at something specific
            anyway, you can widen the list to every active lot.
          </p>
          <div className="mt-4">
            <Button href="/admin/inventory/audits/new?all=1" variant="neutral" size="sm">
              Show every active lot
            </Button>
          </div>
        </section>
      ) : (
        <form action={createAuditAction} className="space-y-5">
          <section className={CARD}>
            <h2 className={H2}>Name it and say why</h2>
            <p className={`mt-1 ${P}`}>
              Both of these are read back to you months from now, when something does not add up.
              Write them for that version of yourself.
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Field
                label="What to call this count"
                htmlFor="audit-label"
                required
                help={"\u201CFlower back stock, August\u201D beats \u201CAudit 4\u201D."}
              >
                <Input
                  id="audit-label"
                  name="label"
                  required
                  defaultValue={defaultLabel()}
                  placeholder="Flower back stock, August"
                />
              </Field>

              <Field
                label="Why these products"
                htmlFor="audit-rationale"
                required
                help={
                  "Written now, before any number is known. That is what makes the result " +
                  "evidence instead of an opinion."
                }
              >
                <Textarea
                  id="audit-rationale"
                  name="scopeRationale"
                  required
                  minLength={10}
                  rows={3}
                  placeholder="Highest value and longest since counted, plus every product holding more than one open lot."
                />
              </Field>
            </div>
          </section>

          <section className={CARD}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={H2}>What the system proposes, and why</h2>
              {!wantsAll ? (
                <Link
                  href="/admin/inventory/audits/new?all=1"
                  className="text-xs text-[var(--admin-text-muted)] underline decoration-dotted underline-offset-2 hover:text-white"
                >
                  Show every active lot instead
                </Link>
              ) : (
                <Link
                  href="/admin/inventory/audits/new"
                  className="text-xs text-[var(--admin-text-muted)] underline decoration-dotted underline-offset-2 hover:text-white"
                >
                  Back to only what is due
                </Link>
              )}
            </div>
            <p className={`mt-1 ${P}`}>
              Ranked by risk, highest first. Every lot listed here will be included &mdash; a
              product goes in whole or not at all, so there is deliberately no way to tick half of
              one.
            </p>

            <div className="mt-4 space-y-3">
              {plan.groups.map((g: AuditPlanGroup) => (
                <div
                  key={g.productKey}
                  className={`rounded-xl border p-4 ${
                    g.isMultiLot
                      ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.05]"
                      : "border-white/10 bg-white/[0.015]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {g.productName ?? "Unnamed product"}
                      </p>
                      <p className="text-xs text-[var(--admin-text-muted)]">
                        {g.vendorName ?? "Vendor not recorded"} &middot; {g.lots.length} open lot
                        {g.lots.length === 1 ? "" : "s"} &middot; {g.totalUnits.toLocaleString()}{" "}
                        units
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {g.totalCostCents === null ? "Value unknown" : formatCents(g.totalCostCents)}
                      </p>
                      {g.isMultiLot ? (
                        <Badge tone="orange">Several open lots &mdash; count separately</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* WHY this product was chosen. Not a score, a sentence. A
                      number like "score 71" tells Michael nothing he can act on. */}
                  {g.reasons.length > 0 ? (
                    <ul className="mt-3 space-y-1">
                      {g.reasons.map((r: RiskReasonCode) => (
                        <li key={r} className="flex gap-2 text-xs text-white/75">
                          <span className="text-[var(--admin-gold)]">&bull;</span>
                          <span>{RISK_REASON_TEXT[r]}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.lots.map((lr) => (
                      <span
                        key={lr.lot.lotId}
                        className="rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white/70"
                      >
                        {lr.lot.lotCode ?? "NO LOT CODE"}
                        <input type="hidden" name="lotId" value={lr.lot.lotId} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg">
              Create this count &mdash; {plan.lotCount} lots
            </Button>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Creating it freezes today&apos;s quantities and costs onto the sheet. Nothing moves
              on the shelf and nothing reaches the ledger.
            </p>
          </div>
        </form>
      )}
    </>
  );
}
