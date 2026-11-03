/**
 * /admin/settings/banking/test-day   (R41 S21)
 *
 * The runbook for the first-file test with Timberland Cash Management, live
 * on a Zoom call (Brenda: "she can watch it happen on our system", owner's
 * note 2026-11-02). Shows, from live state: whether the system is ready,
 * each step of the prenote test (done / now / later) with the exact button
 * and where it is on ACH operations, the dates for a release now, what Brenda
 * will see in the file, the Zoom script and the questions for her.
 *
 * READ ONLY: every button that changes anything stays on ACH operations,
 * where its safety checks live. Owner or admin (settings.manage). The
 * printable sheet is at test-day/sheet. No account numbers on this page.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, InfoHint } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import { TIMBERLAND_PHONE } from "@/lib/payments/ach-bank-setup-core";
import { BRENDA_SAMPLE_SENDER } from "@/lib/payments/ach-notice-mail-core";
import { LINKS, PORTAL_NOTES, callQuestions, nextStep, testDaySteps, testTimeline, whatBrendaSees, zoomScript, type StepState } from "@/lib/payments/ach-test-day-core";
import { encryptionKeySet, readTestDayState } from "@/lib/payments/ach-test-day-store";
import { BankingSubnav } from "../BankingHelpTabs";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 flex items-center gap-2 text-base font-semibold text-white";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";
const link = "font-semibold text-emerald-300 hover:underline";

const TONE: Record<StepState, "green" | "orange" | "neutral"> = { done: "green", now: "orange", later: "neutral" };
const WORD: Record<StepState, string> = { done: "done", now: "next", later: "later" };

export default async function TestDayPage() {
  await requirePermission("settings.manage");
  const today = pacificToday();
  const now = new Date();
  const state = await readTestDayState(today);
  const steps = testDaySteps(state);
  const next = nextStep(steps);
  const tl = testTimeline(now);
  const keySet = encryptionKeySet();

  const ready: { ok: boolean | null; text: string; fix: string; href: string }[] = [
    { ok: state.originator?.ready ?? null, text: "Greenway's ACH company details match Timberland", fix: "Open My banking and fix what it lists.", href: LINKS.company },
    { ok: keySet, text: "The server can read stored bank numbers (encryption key set)", fix: "Set DATA_ENCRYPTION_KEY on the server (Vercel) and redeploy. Without it no file can be built.", href: LINKS.company },
    { ok: state.checks === null ? null : state.checks.length > 0 || (state.prenoteFiles?.length ?? 0) > 0, text: "Your own account is listed under Account checks", fix: "Sign your ACH authorization on your employee page (e-sign), or add it through Documents to review.", href: LINKS.checks },
    { ok: state.prenoteFiles === null ? null : true, text: "The ACH file ledger is set up", fix: "Apply the migrations in docs/MIGRATIONS_TO_RUN.md (through 0292).", href: LINKS.files },
    { ok: state.noticeSendersOk, text: `Notice email catches Brenda's sample return email (${BRENDA_SAMPLE_SENDER})`, fix: `Open Notice email, add ${BRENDA_SAMPLE_SENDER} to the senders and save.`, href: LINKS.noticeEmail },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Test day with Timberland"
        subtitle="The first-file test, step by step, on a Zoom call with Brenda: what to press, where, and what she will see."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Test day" }]} />}
        help={
          <HelpPanel
            id="ach-test-day"
            title="How to run the test"
            steps={[
              "Fix anything red under Ready before the call.",
              "On the call, share this screen and follow the steps. Each step links to the button on ACH operations.",
              "The test is a prenote: a $0 entry to your own account. No money moves.",
              "Print the sheet for the questions and write Brenda's answers on it.",
            ]}
          >
            <p>This page only reads. Every button that changes anything is on ACH operations, with its usual checks.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="testday" badge={next ? { testday: "1" } : undefined} />

        <section className={card} aria-label="Next step">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-white">Today ({today})</h2>
            {next ? <Badge tone="orange">Next: {next.title}</Badge> : <Badge tone="green">First-file test passed</Badge>}
            <a href="/admin/settings/banking/test-day/sheet" target="_blank" rel="noopener" className={`${btnGhost} ml-auto`}>
              Print the test-day sheet &#8599;
            </a>
          </div>
          {state.gate ? <p className="mt-3 text-sm text-white/70">{state.gate.line}</p> : <p role="alert" className="mt-3 text-sm text-amber-200">The first-file gate could not be read. Reload the page.</p>}
          <p className="mt-2 text-sm text-white/70">
            Timberland Bank: <strong>{TIMBERLAND_PHONE}</strong>
          </p>
        </section>

        <section id="ready" className={card}>
          <h2 className={h2}>
            Ready?
            <InfoHint text="Checked live each time the page loads. Grey means it could not be read: reload, and never treat grey as ready." />
          </h2>
          <ul className="space-y-2 text-sm">
            {ready.map((r) => (
              <li key={r.text} data-ready={r.ok === null ? "unknown" : r.ok ? "yes" : "no"} className="flex flex-wrap items-start gap-2">
                <Badge tone={r.ok === null ? "neutral" : r.ok ? "green" : "danger"}>{r.ok === null ? "unknown" : r.ok ? "ready" : "fix"}</Badge>
                <span className="text-white/85">{r.text}</span>
                {r.ok ? null : (
                  <span className="basis-full pl-1 text-xs text-amber-200">
                    {r.fix}{" "}
                    <Link href={r.href} className={link}>Open &rarr;</Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="steps" className={card}>
          <h2 className={h2}>
            The steps
            <InfoHint text="Worked out from what the system has recorded. A step turns done only when its record exists." />
          </h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.id} id={`step-${s.id}`} data-state={s.state} className={`rounded-[var(--admin-radius)] border p-3 ${s.state === "now" ? "border-amber-400/50 bg-amber-400/[0.05]" : "border-white/10"}`}>
                <h3 className="flex flex-wrap items-center gap-2 font-semibold text-white">
                  <span className="text-white/40">{i + 1}.</span>
                  {s.title}
                  <Badge tone={TONE[s.state]}>{WORD[s.state]}</Badge>
                  {s.onZoom ? <span className="text-xs font-normal text-white/40">on the call</span> : null}
                </h3>
                <p className="mt-1 text-sm text-white/75">{s.detail}</p>
                {s.href ? (
                  <Link href={s.href} className={`mt-1 inline-block text-xs ${link}`}>
                    {s.button ? `Go to "${s.button}"` : "Open"} &rarr;
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-white/50">
            Before uploading, drop the downloaded file on the <Link href={LINKS.checker} className={link}>File checker</Link>. A file cannot be cancelled after upload.
          </p>
        </section>

        <section id="timeline" className={card}>
          <h2 className={h2}>
            The dates, if you release now
            <InfoHint text="The same date rules the release button uses: 2 banking days ahead, 4:00 pm Pacific cutoff (we aim for 3:30), and the 6-banking-day prenote wait." />
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
            {tl.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>

        <section id="brenda-sees" className={card}>
          <h2 className={h2}>What Brenda will see in the file</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
            {whatBrendaSees().map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>

        <section id="zoom" className={card}>
          <h2 className={h2}>
            Zoom script
            <InfoHint text="Brenda wants to watch the test happen on Greenway's system. Share this browser window, not the whole desktop." />
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-white/80">
            {zoomScript(tl).map((l) => <li key={l}>{l}</li>)}
          </ol>
        </section>

        <section id="questions" className={card}>
          <h2 className={h2}>
            Questions for Brenda
            <InfoHint text="The open items from the Bank setup checklist. Dual approval is not asked: you decided to keep it off." />
          </h2>
          <div className="space-y-3">
            {callQuestions().map((q) => (
              <div key={q.title}>
                <p className="text-sm font-semibold text-white">{q.title}</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100">
                  {q.ask.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-white">Note from the portal</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/75">
            {PORTAL_NOTES.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <p className="mt-3 text-xs text-white/50">
            Send the answers to your developer; they go on the <Link href={LINKS.bankSetup} className={link}>Bank setup</Link> record in Brenda&apos;s own words.
          </p>
        </section>
      </div>
    </div>
  );
}
