/**
 * src/components/admin/compliance/CcrsScoreboardPanel.tsx  (R74 S48, Round 29)
 *
 * The CCRS PREprod test scoreboard: what has been tested, what passed, what
 * is still waiting on CCRS, what remains, and how to earn each green mark.
 * A loud green congratulations banner when every required CCRS event has
 * passed. Server component, read-only; the evidence is the hub's own record
 * (ccrs-scoreboard-store.ts). Dark admin theme.
 */
import Link from "next/link";
import { nextTests, STATUS_TEXT, type Scoreboard, type ScoreStatus, type TestResult } from "@/lib/compliance/ccrs-scoreboard-core";
import type { ScoreboardRead } from "@/lib/compliance/ccrs-scoreboard-store";

const BADGE: Record<ScoreStatus, string> = {
  passed: "bg-emerald-500 text-emerald-950",
  waiting: "bg-sky-500/25 text-sky-100 border border-sky-400/40",
  failed: "bg-rose-500/25 text-rose-100 border border-rose-400/50",
  "not-tested": "bg-white/5 text-white/50 border border-white/15",
};
const ICON: Record<ScoreStatus, string> = { passed: "✅", waiting: "⏳", failed: "❌", "not-tested": "⬜" };

function when(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Row({ r }: { r: TestResult }) {
  return (
    <li className={`rounded-xl border px-3 py-2 ${r.status === "passed" ? "border-emerald-400/40 bg-emerald-500/[0.07]" : "border-white/10 bg-white/[0.02]"}`} data-testid={`ccrs-score-${r.test.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{ICON[r.status]}</span>
        <span className="font-semibold text-white">{r.test.title}</span>
        {!r.test.required ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">optional</span> : null}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE[r.status]}`}>{STATUS_TEXT[r.status]}</span>
      </div>
      {r.status === "passed" && r.lastPass ? (
        <p className="mt-1 text-xs text-emerald-200/80">
          Accepted by CCRS in {r.lastPass.fileName}
          {r.lastPass.at ? ` (${when(r.lastPass.at)})` : ""}
          {r.passedCount > 1 ? ` · ${r.passedCount} accepted rows seen` : ""}
        </p>
      ) : null}
      {r.status === "waiting" && r.waitingFile ? (
        <p className="mt-1 text-xs text-sky-200/80">
          Sent in {r.waitingFile}. Upload it if you have not, then answer CCRS&apos;s email (Answer every waiting CCRS email). It turns green when CCRS accepts it.
        </p>
      ) : null}
      {r.status !== "passed" && r.failure ? (
        <p className="mt-1 text-xs text-rose-200/80">
          Last try ({r.failure.fileName}): {r.failure.why}.
        </p>
      ) : null}
      {r.status !== "passed" ? <p className="mt-1 text-xs text-white/55"><span className="font-semibold text-white/70">How to pass: </span>{r.test.howTo}</p> : null}
    </li>
  );
}

function Banner({ b }: { b: Scoreboard }) {
  if (!b.allRequiredPassed) return null;
  return (
    <div className="rounded-2xl border-4 border-emerald-300 bg-gradient-to-r from-emerald-600 via-emerald-500 to-green-500 p-5 text-center shadow-[0_0_40px_rgba(16,185,129,0.45)]" data-testid="ccrs-scoreboard-congrats">
      <p className="text-3xl font-black tracking-tight text-white drop-shadow">🎉 CONGRATULATIONS! 🎉</p>
      <p className="mt-2 text-lg font-bold text-emerald-50">
        Every required CCRS event has been tested, logged, recorded and accepted by CCRS. You are good to go.
      </p>
      <p className="mt-1 text-sm text-emerald-50/90">
        {b.allPassed
          ? "Every optional test passed too: the full scoreboard is green. 🏆"
          : `${b.optionalPassed} of ${b.optional} optional tests passed. They are nice-to-have; the required list is complete.`}
      </p>
    </div>
  );
}

export function CcrsScoreboardPanel({ read, compact = false }: { read: ScoreboardRead; compact?: boolean }) {
  if (!read.available) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs text-white/50" data-testid="ccrs-scoreboard">
        CCRS test scoreboard could not be read right now ({read.message}). Nothing else on this page is affected.
      </div>
    );
  }
  const b = read.board;
  const pct = b.required ? Math.round((b.requiredPassed / b.required) * 100) : 0;
  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2 text-xs ${b.allRequiredPassed ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100" : "border-white/10 bg-white/[0.02] text-white/60"}`} data-testid="ccrs-scoreboard">
        <span className="font-bold">{b.allRequiredPassed ? "🎉 PREprod testing complete:" : "PREprod test scoreboard:"}</span>
        <span>{b.requiredPassed} of {b.required} required CCRS events passed</span>
        <Link href="/admin/compliance/ccrs?env=preprod" className="ml-auto underline">Open the scoreboard</Link>
      </div>
    );
  }
  const groups = Array.from(new Set(b.results.map((r) => r.test.group)));
  const next = nextTests(b, 3);
  const waiting = b.results.filter((r) => r.status === "waiting").length;
  const failed = b.results.filter((r) => r.status === "failed").length;
  return (
    <section className="space-y-3 rounded-2xl border border-emerald-400/25 bg-[#0b1512] p-4" data-testid="ccrs-scoreboard">
      <Banner b={b} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-white">🏁 CCRS PREprod test scoreboard</h2>
          <p className="mt-0.5 text-xs text-white/50">
            Built from what this system actually sent and what CCRS answered. A test turns green only when CCRS accepted a row of that kind.
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-black ${b.allRequiredPassed ? "text-emerald-300" : "text-white"}`}>{b.requiredPassed}/{b.required}</p>
          <p className="text-[11px] text-white/50">required passed · {b.optionalPassed}/{b.optional} optional</p>
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-white/10" aria-label={`${pct}% of required tests passed`}>
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-white/60">
        {waiting ? `⏳ ${waiting} waiting for CCRS's answer. ` : ""}
        {failed ? `❌ ${failed} not passed yet (see why below). ` : ""}
        {!waiting && !failed && !b.allRequiredPassed ? "Nothing is waiting on CCRS right now." : ""}
      </p>
      {next.length && !b.allPassed ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100" data-testid="ccrs-scoreboard-next">
          <p className="font-bold">Next tests to do</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {next.map((r) => (
              <li key={r.test.id}><span className="font-semibold">{r.test.title}:</span> {r.test.howTo}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <details open={!b.allRequiredPassed} className="group">
        <summary className="cursor-pointer text-xs font-semibold text-white/70 hover:text-white">Every test, one by one</summary>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/40">{g}</p>
              <ul className="space-y-1.5">
                {b.results.filter((r) => r.test.group === g).map((r) => <Row key={r.test.id} r={r} />)}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
