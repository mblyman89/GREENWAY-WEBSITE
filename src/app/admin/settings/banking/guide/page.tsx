/**
 * R40 - Banking -> Guide & unblocker (/admin/settings/banking/guide).
 *
 * The "carry me through it" page (owner: "hand held, no, carried"). It reads
 * the same facts the vault, the employee pages and the operations page use
 * (ach-guide-store), and the rules live in the pure, self-tested
 * ach-guide-core. Four journeys with progress bars and green ticks, then a
 * list of everything that would stop a payment today with the exact fix and
 * a deep link, then a box that explains any refusal message in plain words.
 *
 * Owner/admin only (settings.manage). Shows names only, never bank numbers.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TimberlandRoomLeft } from "@/components/admin/payments/TimberlandRoomLeft";
import { FirstFileToTimberland } from "@/components/admin/payments/FirstFileToTimberland";
import { GoLiveBoard } from "@/components/admin/payments/GoLiveBoard";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { BankingSubnav } from "../BankingHelpTabs";
import { pacificToday } from "@/lib/reports/timezone";
import { loadGuideSnapshot } from "@/lib/payments/ach-guide-store";
import {
  buildBlockers,
  buildJourneys,
  explainPaymentMessage,
  PAY_BY_CHECK_FALLBACK,
  type BlockerSeverity,
  type StepStatus,
} from "@/lib/payments/ach-guide-core";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

const STEP_ICON: Record<StepStatus, { icon: string; cls: string; word: string }> = {
  done: { icon: "✓", cls: "bg-emerald-500 text-emerald-950", word: "Done" },
  todo: { icon: "→", cls: "bg-amber-400 text-amber-950", word: "To do" },
  blocked: { icon: "!", cls: "bg-red-500 text-white", word: "Blocked" },
  waiting: { icon: "…", cls: "bg-white/20 text-white", word: "Waiting" },
  optional: { icon: "○", cls: "border border-white/30 text-white/60", word: "Optional" },
};

const SEVERITY: Record<BlockerSeverity, { tone: "danger" | "orange" | "gold"; word: string }> = {
  stops_all: { tone: "danger", word: "Stops every payment" },
  stops_one: { tone: "orange", word: "Stops one payee" },
  warning: { tone: "gold", word: "Warning" },
};

/** Environment settings the ACH features read (names only; values are never shown). */
const ENV_VARS: { name: string; what: string; set: boolean }[] = [
  { name: "DATA_ENCRYPTION_KEY", what: "Encrypts bank numbers at rest. Without it nothing can be paid by ACH.", set: Boolean(process.env.DATA_ENCRYPTION_KEY) },
  { name: "ACH_NOTIFY_STEPHEN_PHONE", what: "Stephen's phone for urgent ACH alerts.", set: Boolean(process.env.ACH_NOTIFY_STEPHEN_PHONE) },
  { name: "ACH_NOTIFY_MICHAEL_PHONE", what: "Michael's phone for urgent ACH alerts.", set: Boolean(process.env.ACH_NOTIFY_MICHAEL_PHONE) },
  { name: "RESEND_API_KEY", what: "Sends the emails (notices, reminders, e-sign links).", set: Boolean(process.env.RESEND_API_KEY) },
  { name: "ORDER_EMAIL_FROM", what: "The 'from' address on those emails.", set: Boolean(process.env.ORDER_EMAIL_FROM) },
  { name: "ORDER_STAFF_EMAILS", what: "The store inbox that also gets ACH notices.", set: Boolean(process.env.ORDER_STAFF_EMAILS) },
  { name: "NEXT_PUBLIC_SITE_URL", what: "Your public web address, used in e-sign links (https://www.greenwaymarijuana.com once live).", set: Boolean(process.env.NEXT_PUBLIC_SITE_URL) },
  { name: "LLAMA_CLOUD_API_KEY", what: "Optional. Reads scanned forms with LlamaParse. Sign their DPA first (see Calendar).", set: Boolean(process.env.LLAMA_CLOUD_API_KEY) },
];

const MIGRATIONS = ["0258", "0259", "0260", "0261", "0262", "0263"];

export default async function AchGuidePage({ searchParams }: { searchParams: Promise<{ explain?: string; firstPayday?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const { snapshot, problems } = await loadGuideSnapshot(today);
  const journeys = buildJourneys(snapshot);
  const blockers = buildBlockers(snapshot);
  const explainText = (sp.explain ?? "").slice(0, 2000);
  const explained = explainText.trim() ? explainPaymentMessage(explainText) : null;
  const allDone = journeys.every((j) => j.next === null) && blockers.length === 0;
  const stopsAll = blockers.filter((b) => b.severity === "stops_all").length;

  return (
    <div>
      <AdminPageHeader
        title="ACH guide & unblocker"
        subtitle="One step at a time: what is done (green), what to do next, and the fix for anything that would stop a payment."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Guide" }]} />}
        help={
          <HelpPanel
            id="ach-guide"
            title="How to use this page"
            steps={[
              "Start at the top. Each box is a short checklist. Green ticks are done; the orange arrow is the next thing to do.",
              "Press the button on a step: it takes you to the exact place to do it, then come back here.",
              "\"What is blocking a payment\" lists everything that would stop money going out today, with the fix in plain words.",
              "If payroll or a vendor payment shows an error you do not understand, paste it in the box at the bottom.",
              "Payday never waits: if a direct deposit cannot be fixed in time, pay that person by paper check.",
            ]}
          >
            <p>This page only reads. It never changes anything by itself, so it is always safe to open.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        <BankingSubnav active="guide" />
        <p className="text-xs text-white/40">Today (Pacific): {today}</p>
        {/* R41 S9: the go-live readiness board (read-only; never blocks paying by check). */}
        <GoLiveBoard today={today} now={new Date()} />
        {/* R41 S4: Timberland's daily and monthly room (the release refuses anything over). */}
        <TimberlandRoomLeft today={today} />
        {/* R41 S7: the first-file gate and the backwards plan for the first payday (Timberland section 6). */}
        <FirstFileToTimberland today={today} firstPayday={sp.firstPayday} now={new Date()} />

        {problems.length ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
            <p className="font-semibold">Some information could not be read, so parts of this page may be incomplete (never falsely green):</p>
            <ul className="mt-2 list-disc pl-5">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        ) : null}

        {allDone ? (
          <p className="rounded-[var(--admin-radius)] border border-emerald-500/40 bg-emerald-500/[0.10] px-4 py-3 text-base font-semibold text-emerald-300">
            ✓ Everything is set up and nothing is blocking a payment. Nice work.
          </p>
        ) : stopsAll ? (
          <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {stopsAll} problem{stopsAll === 1 ? "" : "s"} would stop every ACH payment. <a href="#blockers" className="underline">See the fix</a>.
          </p>
        ) : null}

        {/* Journeys */}
        <div className="grid gap-6 lg:grid-cols-2">
          {journeys.map((j) => (
            <section key={j.id} id={`journey-${j.id}`} className={card} aria-labelledby={`journey-${j.id}-title`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 id={`journey-${j.id}-title`} className="text-base font-semibold text-white">{j.title}</h2>
                <span className={`text-sm font-bold ${j.percent === 100 ? "text-emerald-300" : "text-white/70"}`}>
                  {j.done} of {j.total} done
                </span>
              </div>
              <p className="mb-3 text-sm text-white/60">{j.intro}</p>
              <div
                className="mb-4 h-3 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={j.percent}
                aria-label={`${j.title}: ${j.percent}% done`}
              >
                <div className={`h-full rounded-full ${j.percent === 100 ? "bg-emerald-500" : "bg-emerald-500/70"}`} style={{ width: `${j.percent}%` }} />
              </div>
              {j.next ? (
                <p className="mb-3 rounded-[var(--admin-radius)] border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-100">
                  <span className="font-semibold">Next step:</span> {j.next.title}.{" "}
                  <Link href={j.next.href} className="font-semibold text-amber-300 underline">{j.next.hrefLabel} →</Link>
                </p>
              ) : (
                <p className="mb-3 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-sm font-semibold text-emerald-300">✓ All done here.</p>
              )}
              <ol className="space-y-2">
                {j.steps.map((s, i) => {
                  const ic = STEP_ICON[s.status];
                  return (
                    <li key={s.id} id={`step-${s.id}`} className={`flex gap-3 rounded-[var(--admin-radius)] p-2 ${s.status === "done" ? "bg-emerald-500/[0.05]" : ""}`}>
                      <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ic.cls}`}>{ic.icon}</span>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className={`font-semibold ${s.status === "done" ? "text-emerald-200" : "text-white"}`}>
                          <span className="sr-only">Step {i + 1}, {ic.word}: </span>{s.title}
                        </p>
                        <p className="text-white/60">{s.detail}</p>
                        {s.status !== "done" ? (
                          <Link href={s.href} className="mt-1 inline-block text-xs font-semibold text-emerald-300 hover:underline">{s.hrefLabel} →</Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        {/* Blockers */}
        <section id="blockers" className={card}>
          <h2 className={h2}>What is blocking a payment ({blockers.length})</h2>
          {blockers.length === 0 ? (
            <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-sm font-semibold text-emerald-300">✓ Nothing is blocking a payment right now.</p>
          ) : (
            <ul className="space-y-3">
              {blockers.map((b) => (
                <li key={b.id} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm text-white/80">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY[b.severity].tone}>{SEVERITY[b.severity].word}</Badge>
                    <span className="font-semibold text-white">{b.who}</span>
                  </div>
                  <p className="mb-2">{b.problem}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/50">How to fix it</p>
                  <ol className="mb-2 list-decimal pl-5">
                    {b.fix.map((f, i) => <li key={i}>{f}</li>)}
                  </ol>
                  <Link href={b.href} className={btnPrimary}>{b.hrefLabel} →</Link>
                  {b.fallback ? <p className="mt-3 rounded-[var(--admin-radius)] border border-sky-400/20 bg-sky-400/[0.05] px-3 py-2 text-xs text-sky-100"><span className="font-semibold">Payday can&apos;t wait?</span> {b.fallback}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Explain */}
        <section id="explain" className={card}>
          <h2 className={h2}>Explain an error message</h2>
          <p className="mb-3 text-sm text-white/60">Paste the red message from payroll, vendor payments or the vault. You&apos;ll get what it means and what to do. Do not paste bank numbers.</p>
          <form method="get" action="/admin/settings/banking/guide#explain" className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="explain">Error message</label>
            <textarea id="explain" name="explain" defaultValue={explainText} maxLength={2000} rows={2} className={inputCls} placeholder="e.g. Jane Doe: ON HOLD - a bank change must be confirmed..." />
            <button className={btnPrimary}>Explain</button>
          </form>
          {explained ? (
            <div className={`mt-4 rounded-[var(--admin-radius)] border p-3 text-sm ${explained.matched === "unknown" ? "border-amber-400/30 bg-amber-400/[0.05] text-amber-100" : "border-emerald-500/30 bg-emerald-500/[0.05] text-white/85"}`}>
              <p className="font-semibold text-white">{explained.title}</p>
              <p className="mb-2">{explained.why}</p>
              <ol className="mb-2 list-decimal pl-5">
                {explained.fix.map((f, i) => <li key={i}>{f}</li>)}
              </ol>
              <Link href={explained.href} className="font-semibold text-emerald-300 underline">{explained.hrefLabel} →</Link>
              {explained.fallback ? <p className="mt-2 text-xs text-sky-100"><span className="font-semibold">Payday can&apos;t wait?</span> {explained.fallback}</p> : null}
            </div>
          ) : null}
        </section>

        {/* Migrations & settings */}
        <section id="migrations" className={card}>
          <h2 className={h2}>One-time setup (for you or your developer)</h2>
          <p className="mb-2 text-sm text-white/70">
            Database: {snapshot.migrationsReady ? <span className="font-semibold text-emerald-300">✓ ACH tables are in place.</span> : <span className="font-semibold text-red-300">ACH tables are missing.</span>}
            {snapshot.migrationError ? <span className="text-white/50"> ({snapshot.migrationError})</span> : null}
          </p>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-white/70">
            <li>Open Supabase → SQL editor.</li>
            <li>Run the migration files in <code>supabase/migrations</code> in this order: {MIGRATIONS.join(", ")} (one at a time, each must say &quot;Success&quot;).</li>
            <li>The full list with notes is in <code>docs/MIGRATIONS_TO_RUN.md</code>.</li>
            <li>Reload this page. The first box above turns green.</li>
          </ol>
          <p className="mb-2 text-sm font-semibold text-white">Settings in Vercel (Project → Settings → Environment Variables)</p>
          <ul className="space-y-1 text-sm">
            {ENV_VARS.map((v) => (
              <li key={v.name} className="flex flex-wrap items-baseline gap-2">
                <span className={v.set ? "text-emerald-300" : "text-amber-300"}>{v.set ? "✓" : "○"}</span>
                <code className="text-white">{v.name}</code>
                <span className="text-white/60">{v.what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/40">Only whether each setting exists is shown, never its value. After changing a setting, redeploy in Vercel.</p>
        </section>

        <p className="text-xs text-white/40">{PAY_BY_CHECK_FALLBACK}</p>
      </div>
    </div>
  );
}
