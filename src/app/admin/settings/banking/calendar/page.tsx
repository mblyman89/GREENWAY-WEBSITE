/**
 * R40 - Banking -> Calendar & reminders (/admin/settings/banking/calendar).
 *
 * Record keeping the owner must not forget (monthly statement check,
 * quarterly rule watch, yearly reviews, the Timberland agreement, the
 * LlamaParse DPA), the written fraud procedure (Nacha Phase 2 / C6), and the
 * Nacha rule-change watch list with verbatim quotes. Reminder emails come
 * from the 6th planner in compliance-reminders.ts using the same core.
 *
 * Owner/admin only (settings.manage).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { BankingSubnav } from "../BankingHelpTabs";
import { achTaskDoneAction } from "../calendar-actions";
import { pacificToday } from "@/lib/reports/timezone";
import { isLlamaParseConfigured } from "@/lib/inbound-email/llamaparse-provider";
import { getAchDoneMap } from "@/lib/payments/ach-guide-store";
import { opsPageView } from "@/lib/payments/ach-ops-store";
import { ACH_LEGAL_LIBRARY } from "@/lib/payments/ach-legal-library";
import {
  ACH_FRAUD_PROCEDURE,
  evaluateAchCalendar,
  LLAMAPARSE_DPA_URL,
  NACHA_RULE_WATCH,
  ruleWatchStatus,
  type AchCalStatus,
  type RuleImpact,
} from "@/lib/payments/ach-calendar-core";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

const STATUS_TONE: Record<AchCalStatus, "danger" | "orange" | "gold" | "neutral" | "green" | "outline"> = {
  overdue: "danger",
  due: "orange",
  due_soon: "gold",
  upcoming: "neutral",
  done: "green",
  not_needed: "outline",
};
const CADENCE_WORD = { once: "One time", monthly: "Every month", quarterly: "Every 3 months", annual: "Every year" } as const;
const IMPACT: Record<RuleImpact, { tone: "green" | "neutral" | "gold"; word: string }> = {
  done: { tone: "green", word: "✓ Code already updated" },
  none: { tone: "neutral", word: "No change needed" },
  watch: { tone: "gold", word: "Watching" },
};

const lawTitle = (id: string) => ACH_LEGAL_LIBRARY.find((l) => l.id === id)?.title ?? id;

export default async function AchCalendarPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const [{ map, readError }, ops] = await Promise.all([getAchDoneMap(), opsPageView(today).catch(() => null)]);
  const entries = evaluateAchCalendar(today, map, { llamaParseConfigured: isLlamaParseConfigured() });
  const counts = {
    overdue: entries.filter((e) => e.status === "overdue").length,
    soon: entries.filter((e) => e.status === "due" || e.status === "due_soon").length,
    done: entries.filter((e) => e.status === "done").length,
    counted: entries.filter((e) => e.status !== "not_needed").length,
  };
  const pct = counts.counted ? Math.round((counts.done / counts.counted) * 100) : 100;
  const reviewsOverdue = (ops?.reviews ?? []).filter((r) => r.status === "overdue").length;
  const reviewsMissing = (ops?.reviews ?? []).filter((r) => r.status === "missing_date").length;
  const rules = NACHA_RULE_WATCH.map((r) => ({ r, s: ruleWatchStatus(r, today) })).sort((a, b) => a.r.effective.localeCompare(b.r.effective));
  const adopted = entries.find((e) => e.task.id === "fraud_procedure_adopt");

  return (
    <div>
      <AdminPageHeader
        title="ACH calendar & reminders"
        subtitle="Record keeping and yearly to-dos, the written fraud procedure, and Nacha rule changes that could need a code update."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Calendar" }]} />}
        help={
          <HelpPanel
            id="ach-calendar"
            title="How reminders work"
            steps={[
              "Each task shows when it is due. Red means overdue, orange is due now, yellow is coming up, green is done.",
              "Do the steps, then press \"Mark done\". It is saved with your name and the date, for your records.",
              "Stephen, Michael and the store are emailed when something is due, and every week while it is overdue. The emails stop once it is marked done.",
              "Nacha (the ACH rule maker) changes rules a few times a year. The rule watch list shows each change, what it means for you, and whether the code already handles it.",
            ]}
          >
            <p>If the calendar cannot be read, tasks show as not done (you get more reminders, never fewer), and Mark done refuses to save so history is never overwritten.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        <BankingSubnav active="calendar" badge={counts.overdue ? { calendar: String(counts.overdue) } : undefined} />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}
        {readError ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">Could not read the calendar ({readError}). Everything shows as not done until this is fixed.</p> : null}

        <section className={card} aria-label="Summary">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-white">{counts.done} of {counts.counted} up to date</span>
            <span className="text-white/60">
              {counts.overdue ? <span className="font-semibold text-red-300">{counts.overdue} overdue · </span> : null}
              {counts.soon} due soon · Today (Pacific): {today}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Calendar ${pct}% up to date`}>
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          {reviewsOverdue + reviewsMissing > 0 ? (
            <p className="mt-3 text-sm text-amber-200">
              Also: {reviewsOverdue} payee authorization review{reviewsOverdue === 1 ? "" : "s"} overdue{reviewsMissing ? `, ${reviewsMissing} without a review date` : ""}.{" "}
              <Link href="/admin/settings/banking/operations#reviews" className="font-semibold underline">Open reviews →</Link>
            </p>
          ) : ops?.ready ? (
            <p className="mt-3 text-sm text-emerald-300">✓ All payee authorization reviews are current.</p>
          ) : null}
        </section>

        {/* Tasks */}
        <section id="tasks" className="space-y-4">
          <h2 className="text-base font-semibold text-white">To-do list</h2>
          {entries.map((e) => (
            <article key={e.task.id} id={`task-${e.task.id}`} className={`${card} ${e.status === "done" ? "border-emerald-500/30 bg-emerald-500/[0.03]" : e.status === "overdue" ? "border-red-500/30" : ""}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[e.status]}>{e.status === "done" ? "✓ " : ""}{e.statusText}</Badge>
                <span className="text-xs text-white/50">{CADENCE_WORD[e.task.cadence]} · {e.periodLabel}</span>
              </div>
              <h3 className={`text-base font-semibold ${e.status === "done" ? "text-emerald-200" : "text-white"}`}>{e.task.title}</h3>
              <p className="mb-2 text-sm text-white/70">{e.task.why}</p>
              <details open={e.status !== "done" && e.status !== "not_needed"}>
                <summary className="cursor-pointer text-sm font-semibold text-emerald-300">Steps</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-white/80">
                  {e.task.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                {e.task.quote ? (
                  <blockquote className="mt-3 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
                    &ldquo;{e.task.quote.text}&rdquo;
                    <span className="mt-1 block text-xs not-italic text-white/40">Verbatim from docs/authorities/{e.task.quote.file}</span>
                  </blockquote>
                ) : null}
                {e.task.lawIds.length ? (
                  <p className="mt-2 text-xs text-white/50">
                    The law behind this:{" "}
                    {e.task.lawIds.map((id, i) => (
                      <span key={id}>{i ? ", " : ""}<Link href={`/admin/settings/banking/library#law-${id}`} className="text-emerald-300 hover:underline">{lawTitle(id)}</Link></span>
                    ))}
                  </p>
                ) : null}
              </details>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {e.task.href.startsWith("http") ? (
                  <a href={e.task.href} target="_blank" rel="noopener noreferrer" className={btnPrimary}>{e.task.hrefLabel} ↗</a>
                ) : (
                  <Link href={e.task.href} className={btnPrimary}>{e.task.hrefLabel} →</Link>
                )}
                {e.status === "done" ? (
                  <form action={achTaskDoneAction}>
                    <input type="hidden" name="task_id" value={e.task.id} />
                    <input type="hidden" name="period_key" value={e.periodKey} />
                    <input type="hidden" name="done" value="0" />
                    <button className={btnGhost}>Undo</button>
                  </form>
                ) : e.status !== "not_needed" ? (
                  <form action={achTaskDoneAction} className="flex flex-1 flex-wrap items-end gap-2">
                    <input type="hidden" name="task_id" value={e.task.id} />
                    <input type="hidden" name="period_key" value={e.periodKey} />
                    <input type="hidden" name="done" value="1" />
                    <label className="min-w-[14rem] flex-1">
                      <span className="sr-only">Note</span>
                      <input
                        name="note"
                        maxLength={500}
                        required={e.task.id === "fraud_procedure_adopt"}
                        minLength={e.task.id === "fraud_procedure_adopt" ? 3 : undefined}
                        placeholder={e.task.id === "fraud_procedure_adopt" ? "Type your full name to adopt" : "Optional note (no account numbers)"}
                        className={inputCls}
                      />
                    </label>
                    <button className={btnGhost}>Mark done</button>
                  </form>
                ) : null}
              </div>
              {e.done?.note ? <p className="mt-2 text-xs text-white/50">Note: {e.done.note}</p> : null}
            </article>
          ))}
        </section>

        {/* Fraud procedure */}
        <section id="fraud-procedure" className={card}>
          <h2 className={h2}>Greenway&apos;s written ACH fraud procedure</h2>
          <p className="mb-3 text-sm text-white/70">
            Nacha&apos;s 2026 fraud-monitoring rules expect every business that sends ACH payments to have written, risk-based procedures. These are yours. Most are enforced by the software itself (follow the link to see where).
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-white/85">
            {ACH_FRAUD_PROCEDURE.map((p, i) => (
              <li key={i}>
                {p.rule}{" "}
                {p.enforcedBy ? <Link href={p.enforcedBy} className="text-xs font-semibold text-emerald-300 hover:underline">enforced here →</Link> : <span className="text-xs text-white/40">(your habit; the software cannot enforce it)</span>}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm">
            {adopted?.status === "done" ? (
              <span className="font-semibold text-emerald-300">✓ Adopted {adopted.done?.doneAt.slice(0, 10)}{adopted.done?.note ? ` by ${adopted.done.note}` : ""}.</span>
            ) : (
              <a href="#task-fraud_procedure_adopt" className="font-semibold text-amber-300 underline">Not adopted yet: type your name in the to-do above →</a>
            )}
          </p>
          <p className="mt-2 text-sm text-white/70">
            The yearly review of this procedure, the risk assessment (which payments are higher risk) and who did what with ACH are on{" "}
            <Link href="/admin/settings/banking/yearly-review" className="font-semibold text-emerald-300 hover:underline">Yearly review →</Link>
          </p>
        </section>

        {/* Rule watch */}
        <section id="rule-watch" className={card}>
          <h2 className={h2}>Nacha rule watch</h2>
          <p className="mb-3 text-sm text-white/70">Each rule change, quoted word for word from Nacha, and what it means for Greenway. You get a reminder 60 days before a rule marked &quot;Watching&quot; takes effect.</p>
          <ul className="space-y-3">
            {rules.map(({ r, s }) => (
              <li key={r.id} id={`rule-${r.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={IMPACT[r.impact].tone}>{IMPACT[r.impact].word}</Badge>
                  <span className="font-semibold text-white">{r.title}</span>
                  <span className={`text-xs ${s.remind ? "font-semibold text-amber-300" : "text-white/50"}`}>{s.label}</span>
                </div>
                <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 italic text-white/70">
                  &ldquo;{r.quote}&rdquo;
                  <span className="mt-1 block text-xs not-italic text-white/40">Verbatim from Nacha (mirrored at docs/authorities/{r.quoteFile})</span>
                </blockquote>
                <p className="text-white/80"><span className="font-semibold">For Greenway:</span> {r.greenway}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/40">Source: <a href="https://www.nacha.org/newrules" target="_blank" rel="noopener noreferrer" className="hover:underline">nacha.org/newrules</a>. The quarterly &quot;rule watch&quot; task above reminds you to check it for anything new.</p>
        </section>

        {/* LlamaParse */}
        <section id="llamaparse" className={card}>
          <h2 className={h2}>LlamaParse data protection agreement (DPA)</h2>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-white/80">
            <li>Only needed if you turn on LlamaParse (it reads scanned paper forms). Right now it is {isLlamaParseConfigured() ? <span className="font-semibold text-amber-300">ON</span> : <span className="font-semibold text-white">off</span>}.</li>
            <li>It is not signed in this back office. LlamaIndex uses a DocuSign form: press the button, type Greenway&apos;s legal name, your name and title, and sign.</li>
            <li>DocuSign emails you the signed copy. Save it in your records, then mark the LlamaParse task done above.</li>
          </ol>
          <a href={LLAMAPARSE_DPA_URL} target="_blank" rel="noopener noreferrer" className={btnPrimary}>Open the LlamaParse DPA (DocuSign) ↗</a>
        </section>
      </div>
    </div>
  );
}
