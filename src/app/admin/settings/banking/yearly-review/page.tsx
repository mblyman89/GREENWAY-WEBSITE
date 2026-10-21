/**
 * /admin/settings/banking/yearly-review   (R41 S14)
 *
 * Nacha Fraud Monitoring Phase 2, the yearly obligations in one place:
 *   - the written fraud procedure and Greenway's risk assessment (higher- and
 *     lower-risk payments), each tied to the verbatim Nacha text;
 *   - the yearly review record (0288): who reviewed, when, what was found;
 *   - the segregation-of-duties report (who holds owner or admin, every ACH
 *     action by person, every request and its outcome). It reads the Security
 *     Log, so only the owner sees it (audit.view), as for /admin/audit;
 *   - a printable packet (yearly-review/packet).
 *
 * Owner or admin can open the page (settings.manage); only the owner records
 * the review (ach.act, in yearly-review-actions.ts).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import { ACH_FRAUD_PROCEDURE } from "@/lib/payments/ach-calendar-core";
import {
  buildSodReport,
  FIRST_REVIEW_YEAR,
  OUTCOME_WORD,
  PHASE2_FILE,
  PHASE2_QUOTES,
  RISK_ASSESSMENT,
  RISK_LEVEL_WORD,
  reviewedTextFingerprint,
  yearStatus,
  type SodReport,
} from "@/lib/payments/ach-yearly-review-core";
import { readAnnualReviews, readSodInputs, readStaff } from "@/lib/payments/ach-yearly-review-store";
import { BankingSubnav } from "../BankingHelpTabs";
import { recordYearlyReviewAction } from "../yearly-review-actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const LEVEL_TONE = { higher: "danger", lower: "gold", very_low: "neutral" } as const;

function Quote({ id }: { id: keyof typeof PHASE2_QUOTES }) {
  return (
    <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
      &ldquo;{PHASE2_QUOTES[id]}&rdquo;
      <span className="mt-1 block text-xs not-italic text-white/40">Verbatim from Nacha (mirrored at docs/authorities/{PHASE2_FILE})</span>
    </blockquote>
  );
}

function SodPanel({ sod }: { sod: SodReport }) {
  const c = sod.requests.counts;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="mb-1 font-semibold text-white">Who holds owner or admin</h3>
        <ul className="space-y-1 text-white/80">
          {sod.holders.map((h, i) => (
            <li key={i}>
              {h.who}: <span className="font-semibold">{h.role}</span>
              {h.active ? "" : " (inactive)"} · last sign-in {h.lastLogin ? h.lastLogin.slice(0, 10) : "never"}
            </li>
          ))}
          {sod.holders.length === 0 ? <li>Nobody.</li> : null}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-white">Findings</h3>
        {sod.findings.length === 0 ? (
          <p className="text-emerald-300">✓ Nothing to check: every ACH action was by the owner or an admin, no one approved their own request, and every stop action was checked off.</p>
        ) : (
          <ul className="space-y-1">
            {sod.findings.map((f, i) => (
              <li key={i} className={f.level === "warn" ? "text-amber-200" : "text-white/70"}>
                {f.level === "warn" ? "Check: " : "Note: "}
                {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-white">Every ACH action by person ({sod.year})</h3>
        {sod.people.length === 0 ? <p className="text-white/60">No ACH actions recorded this year.</p> : null}
        {sod.people.map((p, i) => (
          <details key={i} className="mb-1">
            <summary className="cursor-pointer text-white/85">
              {p.who} ({p.role}): {p.total}
            </summary>
            <ul className="ml-5 mt-1 list-disc text-xs text-white/70">
              {p.actions.map((a) => (
                <li key={a.action}>
                  {a.count} × {a.action}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-white">Owner-approval requests ({sod.requests.rows.length})</h3>
        <p className="text-white/70">
          Approved {c.approved ?? 0} · rejected {c.rejected ?? 0} · withdrawn {c.withdrawn ?? 0} · superseded {c.superseded ?? 0} · pending {c.pending ?? 0}. Stop actions taken by an admin: {sod.stopActions.total}, not yet checked off: {sod.stopActions.unchecked}.
        </p>
        {sod.requests.rows.length ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-emerald-300">Show every request</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-white/70">
              {sod.requests.rows.map((r, i) => (
                <li key={i}>
                  {r.requestedOn} {r.kind} ({r.target || "no label"}) asked by {r.requestedBy}: {r.status}
                  {r.decidedBy ? ` by ${r.decidedBy} on ${r.decidedOn}` : ""}
                  {r.applyError ? " (did not apply)" : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export default async function YearlyReviewPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; year?: string }> }) {
  const session = await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const thisYear = Number(today.slice(0, 4));
  const yParam = Number(sp.year);
  const year = Number.isInteger(yParam) && yParam >= FIRST_REVIEW_YEAR && yParam <= thisYear ? yParam : thisYear;
  const isOwner = can(session.profile.role, "ach.act");
  const seesLog = can(session.profile.role, "audit.view");
  const fp = reviewedTextFingerprint();

  const [reviews, staff, sodIn] = await Promise.all([readAnnualReviews(), readStaff(), seesLog ? readSodInputs(year) : Promise.resolve(null)]);
  const nameOf = (id: string) => {
    const s = staff.ok ? staff.rows.find((x) => x.id === id) : undefined;
    return (s?.full_name ?? "").trim() || s?.email || "Unknown staff";
  };
  const st = reviews.ok ? yearStatus(reviews.rows, year, fp) : null;
  const sod = sodIn && sodIn.ok ? buildSodReport({ year, ...sodIn }) : null;
  const years: number[] = [];
  for (let y = thisYear; y >= FIRST_REVIEW_YEAR; y -= 1) years.push(y);
  const recordable = [thisYear, thisYear - 1].filter((y) => y >= FIRST_REVIEW_YEAR);

  return (
    <div>
      <AdminPageHeader
        title="Yearly fraud-procedure review (Nacha)"
        subtitle="Once a year: re-read the fraud procedure and the risk assessment, look at who did what, and record that you reviewed it."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Yearly review" }]} />}
        help={
          <HelpPanel
            id="ach-yearly-review"
            title="What this page is for"
            steps={[
              "Nacha's fraud-monitoring rule (Phase 2, from June 2026) says every business that sends ACH payments must have written, risk-based fraud procedures and review them at least once a year.",
              "Read the procedure and the risk assessment below. Think back over the year: returns, bank-change requests, odd emails.",
              "Michael also sees the who-did-what report (it comes from the Security Log). Look for anything unexpected.",
              "Michael records the review: what he looked at and what he decided. It is kept forever and also ticks the Calendar task. Print the packet for your files.",
            ]}
          >
            <p>Stephen can read this page and print the packet without the who-did-what section. Only Michael records the review: it is the owner&apos;s sign-off.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="yearly" badge={st && !st.current && year === thisYear ? { yearly: "!" } : undefined} />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}

        <nav aria-label="Year" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/60">Year:</span>
          {years.map((y) => (
            <Link key={y} href={`/admin/settings/banking/yearly-review?year=${y}`} className={y === year ? "rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1 font-semibold text-emerald-950" : "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1 text-white/70"} aria-current={y === year ? "page" : undefined}>
              {y}
            </Link>
          ))}
          <a href={`/admin/settings/banking/yearly-review/packet?year=${year}`} target="_blank" rel="noopener" className={`${btnGhost} ml-auto`}>
            Print the {year} packet ↗
          </a>
        </nav>

        <section id="status" className={card} aria-label="Review status">
          <h2 className={h2}>Review record for {year}</h2>
          {!reviews.ok ? (
            <p role="alert" className="text-sm text-red-300">{reviews.error}</p>
          ) : !st?.current ? (
            <p className="text-sm text-amber-200">Not recorded yet for {year}. Nacha requires a review at least once a year.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-emerald-300">
                ✓ {OUTCOME_WORD[st.current.outcome]}, recorded {st.current.reviewed_on} by {nameOf(st.current.created_by)}
                {st.corrections.length ? ` (corrected ${st.corrections.length} time${st.corrections.length === 1 ? "" : "s"})` : ""}.
              </p>
              <p className="whitespace-pre-wrap text-white/80">{st.current.summary}</p>
              {st.textChangedSince ? <p className="text-amber-200">The procedure or risk-assessment wording has changed since this review. Consider recording a correction after re-reading it.</p> : null}
              {st.original && st.corrections.length ? (
                <details>
                  <summary className="cursor-pointer text-emerald-300">History</summary>
                  <ul className="mt-1 space-y-1 text-xs text-white/70">
                    {[st.original, ...st.corrections].map((r) => (
                      <li key={r.id}>
                        {r.reviewed_on} {r.corrects_id ? "correction" : "review"} by {nameOf(r.created_by)}: {OUTCOME_WORD[r.outcome]}. {r.summary}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </section>

        <section id="rule" className={card}>
          <h2 className={h2}>What Nacha requires</h2>
          <Quote id="requirement" />
          <Quote id="annual" />
          <Quote id="minimum" />
        </section>

        <section id="procedure" className={card}>
          <h2 className={h2}>1. The written fraud procedure</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-white/85">
            {ACH_FRAUD_PROCEDURE.map((p, i) => (
              <li key={i}>
                {p.rule}{" "}
                {p.enforcedBy ? <Link href={p.enforcedBy} className="text-xs font-semibold text-emerald-300 hover:underline">enforced here →</Link> : <span className="text-xs text-white/40">(a habit; the software cannot enforce it)</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-white/50">
            The same list is on the <Link href="/admin/settings/banking/calendar#fraud-procedure" className="text-emerald-300 hover:underline">Calendar page</Link>. A change to it is a code change: tell your developer.
          </p>
        </section>

        <section id="risk" className={card}>
          <h2 className={h2}>2. Risk assessment: higher-risk and lower-risk payments</h2>
          <Quote id="levels" />
          <p className="mb-3 text-sm text-white/70">Greenway only sends money out (payroll and vendor payments); it never takes money from anyone&apos;s account. The risk is money sent to the wrong account.</p>
          <ul className="space-y-3">
            {RISK_ASSESSMENT.map((r) => (
              <li key={r.id} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={LEVEL_TONE[r.level]}>{RISK_LEVEL_WORD[r.level]}</Badge>
                  <span className="font-semibold text-white">{r.payment}</span>
                </div>
                <p className="text-white/80">{r.why}</p>
                <p className="mt-1 text-xs text-white/50">Answered by procedure item{r.procedureItems.length === 1 ? "" : "s"} {r.procedureItems.join(", ")}.</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-white/50">These levels are Greenway&apos;s own assessment. Nacha does not prescribe one; the owner confirms it each year.</p>
        </section>

        <section id="duties" className={card}>
          <h2 className={h2}>3. Who did what in {year} (segregation of duties)</h2>
          {!seesLog ? (
            <p className="text-sm text-white/70">This report comes from the Security Log, which only the owner can read. Michael sees it here and in his packet.</p>
          ) : sodIn && !sodIn.ok ? (
            <p role="alert" className="text-sm text-red-300">{sodIn.error}</p>
          ) : sod ? (
            <SodPanel sod={sod} />
          ) : null}
        </section>

        <section id="record" className={card}>
          <h2 className={h2}>4. Record the review</h2>
          {!isOwner ? (
            <p className="text-sm text-white/70">Only Michael (the owner) records the yearly review. It is his sign-off. You can print the packet for him.</p>
          ) : !recordable.includes(year) ? (
            <p className="text-sm text-white/70">Only this year&apos;s or last year&apos;s review can be recorded. Choose {recordable.join(" or ")} above.</p>
          ) : !reviews.ok ? (
            <p className="text-sm text-red-300">The reviews could not be read, so recording is turned off until they can (to avoid a duplicate).</p>
          ) : (
            <form action={recordYearlyReviewAction} className="space-y-3 text-sm">
              <input type="hidden" name="review_year" value={year} />
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-white/70">What the review found</span>
                  <select name="outcome" defaultValue="no_changes" className={inputCls}>
                    <option value="no_changes">{OUTCOME_WORD.no_changes}</option>
                    <option value="changes_made">{OUTCOME_WORD.changes_made}</option>
                    <option value="changes_needed">{OUTCOME_WORD.changes_needed}</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-white/70">What you looked at and what you decided (no account numbers)</span>
                <textarea name="summary" required minLength={20} maxLength={2000} rows={4} className={inputCls} placeholder="e.g. Re-read all 12 items and the risk table. Two returns this year, both handled the same day. No bank-change emails got through. No changes." />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="risk_confirmed" value="1" required className="mt-1" />
                <span className="text-white/80">I read the fraud procedure and confirm the risk assessment above (or I described what should change).</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="sod_reviewed" value="1" required className="mt-1" />
                <span className="text-white/80">I read the who-did-what report for the year.</span>
              </label>
              {st?.original ? (
                <>
                  <input type="hidden" name="corrects_id" value={st.original.id} />
                  <p className="text-xs text-amber-200">{year} is already recorded, so this will be saved as a correction to it (the original stays).</p>
                </>
              ) : null}
              <button className={btnPrimary}>{st?.original ? `Record a correction for ${year}` : `Record the ${year} review`}</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
