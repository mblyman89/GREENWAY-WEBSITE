/**
 * src/app/admin/books/payroll/page.tsx   (slice books-04)
 *
 * PAYROLL — and the honest answer to "can I write my employees off?"
 * Owner-only, like every books screen.
 *
 * WHY THIS PAGE EXISTS
 * Michael asked for this by name (standing rule 1 — verbatim):
 *
 *   "I would like the ability to assign employees as cogs so I can write them
 *    off"
 *
 * The researched answer is mostly NO, and the reason is not a limitation of
 * this software. Greenway is an I-502 RETAILER, which in tax language is a
 * RESELLER. Reg. §1.471-3(b) — the paragraph that governs a reseller's
 * inventory cost — contains no direct-labor clause at all. The paragraph that
 * does allow "expenditures for direct labor" is §1.471-3(c), which applies only
 * to merchandise "produced by the taxpayer" and excludes "any cost of selling"
 * even then.
 *
 * WHY THE PAGE LEADS WITH TEACHING RATHER THAN A FORM
 * Because a refusal that explains nothing is useless to him, and he said so:
 *
 *   "I want push back... rather than rejecting it out right"
 *   "not just block, but explain why, and even better, show me a way to do it
 *    properly"
 *
 * So this screen gives the wall AND the door. The wall is the law, quoted
 * verbatim. The door is receiving labor — time spent acquiring possession of
 * the goods — which rides the same clause inbound freight rides, and which is
 * available only on evidence.
 *
 * THE GATE
 * `requireBooksAccess()` — `is_owner()` in application form. It is deliberately
 * not the only protection: `gl_post_payroll_run()` is `security definer` and
 * re-checks `is_owner()` itself (migration 0188), so the books stay shut even
 * if this page were mis-gated. Belt and braces, on purpose.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  PAYROLL_AUTHORITIES,
  findPayrollAuthority,
  formatMilliPct,
  ACQUISITION_LABOR_CEILING_MILLI_PCT,
  ACQUISITION_LABOR_SCRUTINY_MILLI_PCT,
  MIN_SUBSTANTIATION_DAYS,
  evaluatePayrollRun,
  payrollBars,
  formatCents,
  type PayrollRunInput,
} from "@/lib/accounting/payroll-cogs-core";
import {
  LaborDecisionWalker,
  LaborRoleMap,
  PayrollMoneyBar,
} from "./PayrollCogsExplainer";

export const dynamic = "force-dynamic";

/**
 * The authorities to put in front of Michael first, in teaching order:
 * the rule that governs him, the rule that does not, the sentence that closes
 * the last escape hatch, the case that settled it, and the burden of proof.
 */
const HEADLINE_AUTHORITY_IDS = [
  "REG_1_471_3_B_RESELLER",
  "REG_1_471_3_C_PRODUCER",
  "REG_1_263A_1_E_2_II_RESELLER",
  "PATIENTS_MUTUAL_RESELLER",
  "IRC_6001_SUBSTANTIATION",
  "IRC_7501_TRUST",
] as const;

/**
 * A WORKED EXAMPLE, COMPUTED BY THE ENGINE ITSELF.
 *
 * Michael: "I learn best visually."
 *
 * The temptation here is to hand-write a nice-looking bar with round numbers.
 * That would be a lie with a chart on it: the moment the rules changed, the
 * picture on this page would keep showing the old answer, confidently.
 *
 * So the example crew is the only thing hard-coded. Every figure downstream of
 * it -- what rides into inventory, what §280E disallows, the percentages, the
 * widths of the bar -- is produced by evaluatePayrollRun() and payrollBars(),
 * the exact functions that will classify his real payroll. If the taxonomy is
 * ever edited, this illustration re-computes and stays honest automatically.
 *
 * Computed once at module scope: the inputs are constants, so re-deriving it on
 * every request would be waste.
 *
 * Deliberately realistic rather than flattering. Two budtenders and a manager
 * dwarf the one receiver, because that IS the shape of a retailer's payroll and
 * the picture should not imply otherwise.
 */
const EXAMPLE_RUN: PayrollRunInput = {
  entityCode: "greenway",
  payDate: "2026-11-20",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-15",
  activityCodes: ["receive_manifest", "display_sell"],
  // Deliberately a FULLY SUBSTANTIATED example. Leaving this null produces a
  // hard block (PAY_ACQUISITION_UNSUBSTANTIATED), which is the correct engine
  // behaviour but the wrong teaching picture: it would show Michael a refusal
  // when what he needs to see is what a DEFENSIBLE claim looks like. The
  // requirements below are exactly what he must have on hand -- there is no
  // padding here, every field maps to a substantiation gap the engine checks.
  substantiation: {
    daysOfRecords: 90,
    contemporaneous: true,
    taskLevelDetail: true,
    tiedToManifests: true,
    documentRef: "allocation-study-2026-11",
    basisNote:
      "Receiving minutes taken from task-level time punches and matched to WSLCB manifests.",
    approvedBy: "Nicholas Mullan, CPA",
  },
  employees: [
    {
      // The one person with a genuine claim -- and only for part of her time.
      employeeId: "ex-1",
      employeeName: "Receiver",
      grossWagesCents: 240_000,
      employeeWithholdingCents: 48_000,
      employerTaxCents: 18_360,
      netPayCents: 192_000,
      allocations: [
        { roleCode: "receiving", shareMilliPct: 50_000 },
        { roleCode: "budtender", shareMilliPct: 50_000 },
      ],
    },
    {
      employeeId: "ex-2",
      employeeName: "Budtender",
      grossWagesCents: 208_000,
      employeeWithholdingCents: 41_600,
      employerTaxCents: 15_912,
      netPayCents: 166_400,
      allocations: [{ roleCode: "budtender", shareMilliPct: 100_000 }],
    },
    {
      employeeId: "ex-3",
      employeeName: "Budtender",
      grossWagesCents: 196_000,
      employeeWithholdingCents: 39_200,
      employerTaxCents: 14_994,
      netPayCents: 156_800,
      allocations: [{ roleCode: "budtender", shareMilliPct: 100_000 }],
    },
    {
      employeeId: "ex-4",
      employeeName: "Store manager",
      grossWagesCents: 320_000,
      employeeWithholdingCents: 64_000,
      employerTaxCents: 24_480,
      netPayCents: 256_000,
      allocations: [{ roleCode: "management", shareMilliPct: 100_000 }],
    },
  ],
};

const EXAMPLE_VERDICT = evaluatePayrollRun(EXAMPLE_RUN);
const EXAMPLE_BARS = payrollBars(EXAMPLE_VERDICT);

/** The crew table above the bar. Gross is formatted by the engine's formatter. */
const EXAMPLE_CREW = [
  {
    who: "Receiver",
    doing: "Half the period breaking down deliveries, half on the sales floor",
    gross: formatCents(240_000),
  },
  { who: "Budtender", doing: "Selling", gross: formatCents(208_000) },
  { who: "Budtender", doing: "Selling", gross: formatCents(196_000) },
  { who: "Store manager", doing: "Running the store", gross: formatCents(320_000) },
] as const;

export default async function PayrollBooksPage() {
  await requireBooksAccess();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">Payroll &amp; §280E</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            owner only
          </span>
        </div>
        <p className="max-w-3xl text-sm text-white/55">
          You asked whether you can assign employees as cost of goods sold and write
          them off. This page gives you the real answer, the reasoning behind it in the
          actual words of the law, and the one narrow path that genuinely is available
          to you.
        </p>
      </header>

      {/* ── THE STRAIGHT ANSWER, FIRST ──────────────────────────────────── */}
      <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-5">
        <h2 className="text-sm font-semibold text-amber-300">
          The straight answer, before the detail
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            <strong className="text-white/90">Mostly no — and it is not this software
            saying no, it is the regulation.</strong> In tax language your store is a{" "}
            <em>reseller</em>: you buy finished product and sell it. The rule for a
            reseller&rsquo;s inventory cost lets you add to what you paid only{" "}
            <em>&ldquo;transportation or other necessary charges incurred in acquiring
            possession of the goods&rdquo;</em>. Read that twice, because what matters is
            what is <strong className="text-white/90">not</strong> in it: labor is never
            mentioned.
          </p>
          <p>
            The paragraph that <em>does</em> say &ldquo;expenditures for direct
            labor&rdquo; is the next one down, and it applies only to goods{" "}
            <em>&ldquo;produced by the taxpayer&rdquo;</em>. You do not produce, and your
            licence does not permit it. Even that paragraph then carves out{" "}
            <em>&ldquo;any cost of selling&rdquo;</em> — so a budtender&rsquo;s hour could
            not become COGS even if you were a grower.
          </p>
          <p>
            This has been litigated, and the taxpayers lost every time. Harborside tried
            it. Richmond Patients Group <em>trimmed and dried product</em> and the court
            still called them a reseller. If trimming and drying did not do it, nothing
            happening on your sales floor will.
          </p>
          <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3 text-white/80">
            <strong className="text-emerald-300">But there is one real door.</strong>{" "}
            Time spent <em>acquiring possession</em> — meeting the transporter, counting
            cases against the manifest, confirming the CCRS record, moving product into
            the vault — is the exact thing the reseller rule describes. It rides in on the
            same clause your inbound freight rides in on. That time can go into inventory
            cost, and this system will post it for you.
          </p>
        </div>
      </section>

      {/* ── THE PRICE OF THE DOOR ───────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/85">What the door costs you</h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Proof. Under §6001 the burden is yours, not theirs. Harborside did not lose
            because its theory was illegal — it lost because its numbers were not
            supported. So the system will not let an allocation through without the
            evidence behind it, and that refusal is a feature.
          </p>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Records required
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              At least <strong className="text-white/90">{MIN_SUBSTANTIATION_DAYS} days</strong>{" "}
              of task-level time records, made as the work happens, tied to the specific
              deliveries they belong to. A percentage taken from three days is a guess
              wearing a decimal point.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Gets a second look above
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">
                {formatMilliPct(ACQUISITION_LABOR_SCRUTINY_MILLI_PCT)}
              </strong>{" "}
              of paid time. Not wrong, but conspicuous — above roughly this, the
              allocation stops looking like a detail and starts looking like a tax
              position.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Refused above
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">
                {formatMilliPct(ACQUISITION_LABOR_CEILING_MILLI_PCT)}
              </strong>{" "}
              of paid time. A store taking a handful of deliveries a week does not spend a
              quarter of its wage bill on the dock. An overstated claim also poisons the
              honest part of it.
            </dd>
          </div>
        </dl>

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/45">
          Your time clock now records <em>what</em> someone was working on, not just that
          they were here — and a receiving task can be tied to the manifest it belongs to.
          That was the missing piece. Without it there is no evidence to support any
          allocation at all.
        </p>
      </section>

      {/* ── THE INTERACTIVE TREE ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">Walk it through with me</h2>
          <p className="text-xs leading-relaxed text-white/45">
            Five questions, in the order a CPA would actually ask them. The order is not
            arbitrary and each question says why it sits where it does. Selling is asked
            first because it is the only answer that is final. Learn this sequence and you
            can classify any hour without the software.
          </p>
        </div>
        <LaborDecisionWalker />
      </section>

      {/* ── THE ROLE MAP ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            Every kind of work, sorted by what it does to your tax
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            The number beside each one is the account it posts to, so this map and your
            chart of accounts are the same document. Anything marked{" "}
            <em>never inventory</em> cannot reach cost of goods sold under any
            circumstances, and the database physically refuses to store it that way.
          </p>
        </div>
        <LaborRoleMap />
      </section>

      {/* ── THE MISTAKE WORTH THE MOST ──────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            What this looks like on a real two-week payroll
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Michael said he learns best visually, so here is the whole argument as a
            single bar. These are not illustrative numbers typed into the page &mdash;
            they come out of <code className="text-white/60">evaluatePayrollRun()</code>,
            the same function that will classify your actual payroll, running on the
            example crew below. Green survives &sect;280E. Red does not.
          </p>
        </div>

        <div className="mb-5 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="text-white/40">
              <tr className="border-b border-white/10">
                <th className="pb-2 pr-4 font-medium">Person</th>
                <th className="pb-2 pr-4 font-medium">What they did</th>
                <th className="pb-2 text-right font-medium">Gross</th>
              </tr>
            </thead>
            <tbody className="text-white/70">
              {EXAMPLE_CREW.map((row) => (
                <tr key={row.who} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4">{row.who}</td>
                  <td className="py-2 pr-4 text-white/50">{row.doing}</td>
                  <td className="py-2 text-right font-mono">{row.gross}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PayrollMoneyBar bars={EXAMPLE_BARS} totalCents={EXAMPLE_VERDICT.totalGrossCents} />

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/45">
          Read the green sliver honestly: it is small, and it is supposed to be. One
          receiver spending half her shifts breaking down deliveries is close to the
          entire legitimate claim available to a retailer &mdash; here it is{" "}
          {formatMilliPct(EXAMPLE_BARS[0].milliPct)} of gross. Anyone selling you a way
          to move most of your payroll into cost of goods sold is describing a position
          the Tax Court has already rejected.
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-white/45">
          One thing this picture assumes, and it is the whole ballgame: the example
          carries {MIN_SUBSTANTIATION_DAYS}+ days of contemporaneous, task-level time
          records tied to specific manifests, plus a written allocation study. Strip that
          evidence out and the engine stops the run rather than posting it &mdash;
          because an unsupported allocation is not a smaller deduction, it is the
          deduction the cases actually threw out.
        </p>
      </section>

      <section className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-rose-300">
          The mistake worth the most money
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Putting a budtender&rsquo;s wages into the inventory-handling account. It
            balances perfectly, the books look right, and the return is indefensible. This
            is the single most common way cannabis retailers lose an audit — and it is
            precisely the error a well-meaning bookkeeper makes while trying to help you.
          </p>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs">
            <p className="text-rose-300">
              WRONG&nbsp;&nbsp; debit 61000 Payroll &ndash; Inventory Handling&nbsp;&nbsp;
              $1,600.00 &nbsp;&rarr; indefensible
            </p>
            <p className="text-emerald-300">
              RIGHT&nbsp;&nbsp; debit 71010 Wages &amp; Salaries&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              $1,600.00 &nbsp;&rarr; disallowed, but correct
            </p>
            <p className="text-white/45">
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; credit 31000 Accrued
              Payroll&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              $1,600.00
            </p>
          </div>
          <p className="text-xs text-white/45">
            The deduction is lost either way. The difference is whether the return survives
            being looked at. The system refuses the first entry and shows you the second,
            rather than simply saying no.
          </p>
        </div>
      </section>

      {/* ── THE TRUST-FUND WARNING ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-amber-300">
          The one that can reach your house
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Tax you withhold from an employee&rsquo;s cheque was never your money. §7501
            calls it <em>&ldquo;a special fund in trust for the United States&rdquo;</em>.
            It sits in account 31100 as a liability until you pay it over. If it is ever
            spent on something else, §6672 imposes a penalty equal to{" "}
            <strong className="text-white/90">100% of the money</strong> — assessed against
            a <em>person</em>, which the corporation does not shield you from.
          </p>
          <p className="text-xs text-white/45">
            In a cash business this is the one that can follow you home. Watch 31100 return
            to zero every cycle. A balance that keeps growing there is the earliest warning
            sign this system can give you.
          </p>
        </div>
      </section>

      {/* ── THE AUTHORITIES, VERBATIM ───────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">The actual words of the law</h2>
          <p className="text-xs leading-relaxed text-white/45">
            Not a summary — the text itself, transcribed and never paraphrased. Everything
            this system does to your payroll traces back to one of these.{" "}
            {PAYROLL_AUTHORITIES.length} authorities are carried in full; the six below are
            the ones that decide the most.
          </p>
        </div>

        <div className="space-y-3">
          {HEADLINE_AUTHORITY_IDS.map((id) => {
            const a = findPayrollAuthority(id);
            if (!a) return null;
            return (
              <article key={id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  {a.cite}
                </p>
                <blockquote className="mt-2 border-l-2 border-white/20 pl-3 text-sm italic leading-relaxed text-white/75">
                  &ldquo;{a.quote}&rdquo;
                </blockquote>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  <strong className="text-white/70">What it means for you: </strong>
                  {a.soWhat}
                </p>
                <p className="mt-1 text-[11px] text-white/25">{a.source}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── WHAT THIS IS ACTUALLY WORTH ─────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/85">
          What this is actually worth to you
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Less than you hoped, and more than nothing. The receiving allocation is a
            modest, defensible recovery against a tax rule that is genuinely brutal to your
            industry — and being modest is exactly what makes it defensible.
          </p>
          <p>
            The bigger win is quieter: every wage dollar is now{" "}
            <strong className="text-white/90">tagged</strong> rather than lumped together.
            When your CPA asks what is disallowed under §280E, the answer is a number you
            can produce in a second and defend line by line, instead of an afternoon of
            reconstruction. That is the difference between books that survive an
            examination and books that merely balance.
          </p>
        </div>
      </section>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/admin/books/bills"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Bills &amp; 280E
        </Link>
        <Link
          href="/admin/books/journal"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          General journal
        </Link>
        <Link
          href="/admin/books/accounts"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Chart of accounts
        </Link>
        {/*
          These two are the EVIDENCE routes, and they are deliberately last.
          Everything on this page is an argument about labor, and an argument
          about labor is only as good as the timekeeping behind it (IRC 6001:
          "shall keep such records ... as the Secretary may from time to time
          prescribe"). Verified to exist on 2026-08-17 by walking the tree:
            src/app/admin/staffing/hours/page.tsx  -> requirePermission("staffing.manage")
            src/app/admin/payroll/page.tsx         -> requirePermission("settings.manage")
          The owner holds both permissions, so neither link can dead-end for
          Michael. Do NOT "simplify" these to /admin/timeclock -- that route
          does not exist and never has.
        */}
        <Link
          href="/admin/staffing/hours"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Time punches (your evidence)
        </Link>
        <Link
          href="/admin/payroll"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Payroll runs
        </Link>
      </nav>
    </div>
  );
}
