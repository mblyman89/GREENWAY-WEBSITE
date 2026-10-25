/**
 * R74 S41 - Batch Mission Control (default Batch Lookups tab).
 *
 * Everything the owner needs to run the Gemini Batch API without a terminal:
 * the heartbeat, the big buttons (Stop everything, Send 1 test batch, Allow,
 * One at a time / Automatic, Re-run stopped, Check now), each batch on the
 * 7-step pipeline in Google's words with batchStats, Google's own list
 * (GET v1beta/batches) checked against ours, the Ask Google console with
 * the full raw reply + the matching terminal command, every message Google
 * sent in plain English with the fix, a glossary and a start-fresh guide.
 */
import { Badge } from "@/components/admin/ui";
import { CopyCommandButton } from "@/components/admin/orders/CopyCommandButton";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { batchEventById, type BatchEvent } from "@/lib/ai/batch-events-server";
import { listGoogleBatches } from "@/lib/ai/gemini-batch-server";
import type { BatchConsole, BatchRow } from "@/lib/ai/batch-console-server";
import { BATCH_MAX_FAMILIES } from "@/lib/ai/gemini-batch-core";
import { MAX_BUDGET, fmtMinutes } from "@/lib/ai/batch-console-core";
import {
  GOOGLE_EXPIRE_HOURS,
  GOOGLE_STATES,
  GOOGLE_TARGET_HOURS,
  OPEN_BATCH_STATES,
  PIPELINE_STEPS,
  curlFor,
  isGoogleOpen,
  pipelineFor,
  type GoogleStateKey,
  type Severity,
} from "@/lib/ai/gemini-batch-explain-core";
import { allowBatchesAction, askGoogleAction, cancelBatchAction, checkNowAction, deleteBatchAction, rerunStoppedAction, setModeAction, setPausedAction, stopEverythingAction } from "./actions";

const btn = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--admin-surface-2)] disabled:opacity-40";
const btnPrimary = "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black hover:opacity-90 disabled:opacity-40";
const btnDanger = "rounded-[var(--admin-radius-sm)] bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500";
const card = "rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-4";
const muted = "text-[var(--admin-text-muted)]";
const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const td = "px-2 py-1.5 align-top";
const TONE: Record<Severity, "green" | "outline" | "gold" | "danger"> = { ok: "green", info: "outline", warn: "gold", bad: "danger" };
const SEV_WORD: Record<Severity, string> = { ok: "Good", info: "FYI", warn: "Heads up", bad: "Action needed" };
const ago = (iso: string | null | undefined, now: number) => (iso ? `${fmtMinutes((now - Date.parse(iso)) / 60_000)} ago` : "never");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Pipeline({ b }: { b: BatchRow }) {
  const p = pipelineFor(b);
  return (
    <div>
      <div className="flex gap-0.5" aria-label={`Step ${p.step + 1} of 7: ${p.label}`}>
        {PIPELINE_STEPS.map((s, i) => (
          <div key={s.key} title={`${s.label}${s.google ? ` (Google: ${s.google})` : ""} - ${s.help}`} className={`h-2 w-7 rounded ${i < p.step ? "bg-[var(--admin-accent)]" : i === p.step ? (p.tone === "bad" ? "bg-red-500" : p.tone === "warn" ? "bg-amber-400" : "bg-[var(--admin-accent)] animate-pulse") : "bg-white/10"}`} />
        ))}
      </div>
      <div className="mt-1 text-xs">
        <b>{p.label}</b>
        {p.ended && <span className={muted}> · Google: {p.ended.word}</span>}
      </div>
    </div>
  );
}

function EventCard({ e, open }: { e: BatchEvent; open?: boolean }) {
  return (
    <li className="border-t border-[var(--admin-border)] py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[e.severity]}>{SEV_WORD[e.severity]}</Badge>
        <b className="text-sm">{e.title}</b>
        <span className={`ml-auto text-xs ${muted}`}>{when(e.at)}{e.http_status !== null ? ` · HTTP ${e.http_status}` : ""}{e.actor_email ? ` · ${e.actor_email}` : ""}</span>
      </div>
      {e.plain && <p className="mt-1 text-sm">{e.plain}</p>}
      {e.fix && <p className="mt-1 text-sm"><b>What to do:</b> {e.fix}</p>}
      {(e.raw || e.command) && (
        <details open={open} className="mt-1">
          <summary className={`cursor-pointer text-xs ${muted}`}>Show Google&apos;s exact reply{e.command ? " and the terminal command" : ""}</summary>
          {e.command && (
            <div className="mt-1 flex items-start gap-2">
              <code className="block flex-1 whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-xs">{e.command}</code>
              <CopyCommandButton command={e.command} />
            </div>
          )}
          {e.raw && (
            <div className="mt-1">
              <textarea readOnly value={e.raw} rows={open ? 16 : 8} className="w-full rounded border border-[var(--admin-border)] bg-black/40 p-2 font-mono text-xs" aria-label="Google's exact reply" />
              <CopyCommandButton command={e.raw} describeAs="Google reply" idleLabel="Copy Google's reply" />
            </div>
          )}
        </details>
      )}
    </li>
  );
}

export async function MissionTab({ c, now, eventId }: { c: BatchConsole; now: number; eventId: string | null }) {
  const open = c.batches.filter((b) => (OPEN_BATCH_STATES as readonly string[]).includes(b.state));
  const queued = c.jobs.filter((j) => j.status === "queued" || j.status === "running").reduce((s, j) => s + j.queued, 0);
  const [google, picked] = await Promise.all([
    c.keySet ? listGoogleBatches(3) : Promise.resolve(null),
    eventId && /^[0-9a-f-]{36}$/i.test(eventId) && isSupabaseServiceConfigured ? batchEventById(createSupabaseAdminClient(), eventId) : Promise.resolve(null),
  ]);
  const ourNames = new Set(c.batches.map((b) => b.name).filter(Boolean) as string[]);
  const googleByName = new Map((google?.rows ?? []).map((r) => [r.name, r]));
  const orphans = (google?.rows ?? []).filter((r) => r.ours && !ourNames.has(r.name) && isGoogleOpen(r.state));
  const ghosts = open.filter((b) => b.name && google?.ok && google.rows.length < 300 && !googleByName.has(b.name));
  const googleOpen = (google?.rows ?? []).filter((r) => isGoogleOpen(r.state));
  const lastPoll = c.batches.map((b) => b.last_polled_at).filter(Boolean).sort().pop() ?? null;
  const backoffOn = c.backoff.until && Date.parse(c.backoff.until) > now;
  const needsYou = c.events.filter((e) => e.severity === "bad" && Date.parse(e.at) > now - 24 * 3_600_000).slice(0, 3);

  // What is the engine doing right now, in one sentence.
  const doing = c.engine !== "batch"
    ? "The batch engine is OFF (AI_LOOKUP_ENGINE is not \"batch\" in Vercel), so nothing goes to Google's batch line."
    : c.control.paused
      ? "PAUSED. Nothing new goes to Google. Batches already at Google are still checked every minute and their answers saved."
      : backoffOn
        ? `Waiting until ${when(c.backoff.until as string)} because Google refused the last ${c.backoff.streak} send${c.backoff.streak === 1 ? "" : "s"} (see Messages). It tries again by itself then.`
        : c.control.mode === "manual" && c.control.budget <= 0
          ? "One at a time, and no sends are allowed right now. It is idle and waiting for you to press a Send button."
          : open.length >= c.inflightCap
            ? `The line at Google is full (${open.length} of ${c.inflightCap}). The next batch goes when one comes back.`
            : queued === 0
              ? "Nothing is queued. Press Send 1 test batch and it queues the next 200 products for you."
              : c.control.mode === "manual"
                ? `Sending: ${c.control.budget} more batch${c.control.budget === 1 ? "" : "es"} allowed. The next one goes within a minute.`
                : "Automatic: it sends the next batch within a minute.";

  return (
    <div className="space-y-5">
      {!c.missionReady && (
        <div className="rounded-[var(--admin-radius-md,8px)] border border-amber-500/60 p-4 text-sm text-amber-200">
          <b>One setup step first:</b> open Supabase → SQL editor, paste the file <code>supabase/migrations/0299_ai_batch_mission_control.sql</code> and press Run. Until then the message log, the Send buttons and the one-sender lock are off (the engine keeps checking batches already at Google).
        </div>
      )}

      {/* Heartbeat */}
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold">{"\ud83d\udef0\ufe0f"} Right now</h2>
          <Badge tone={c.control.paused ? "danger" : backoffOn ? "gold" : "green"}>{c.control.paused ? "Paused" : backoffOn ? "Waiting (Google refused)" : "Running"}</Badge>
          <Badge tone="outline">{c.control.mode === "auto" ? "Automatic" : `One at a time · ${c.control.budget} allowed`}</Badge>
          {!c.keySet && <Badge tone="danger">No Gemini key</Badge>}
        </div>
        <p className="mt-2 text-sm">{doing}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4 xl:grid-cols-7">
          <div><div className={`text-xs ${muted}`}>At Google (open)</div><b>{open.length} of {c.inflightCap}</b></div>
          <div><div className={`text-xs ${muted}`}>Google lists open</div><b>{google ? (google.ok ? googleOpen.length : "can't read") : "-"}</b></div>
          <div><div className={`text-xs ${muted}`}>Products in line</div><b>{queued.toLocaleString("en-US")}</b></div>
          <div><div className={`text-xs ${muted}`}>Set aside (stopped)</div><b>{c.held.toLocaleString("en-US")}</b></div>
          <div><div className={`text-xs ${muted}`}>Last check with Google</div><b>{ago(lastPoll, now)}</b></div>
          <div><div className={`text-xs ${muted}`}>Last activity</div><b>{ago(c.lastTickAt, now)}</b></div>
          <div><div className={`text-xs ${muted}`}>Products answered (all time)</div><b>{c.totals.answered.toLocaleString("en-US")}</b></div>
        </div>
        {needsYou.length > 0 && (
          <div className="mt-3 rounded border border-red-500/60 p-2 text-sm">
            <b className="text-red-300">Google needs you:</b>
            {needsYou.map((e) => <p key={e.id} className="mt-1">{e.title}. <b>What to do:</b> {e.fix}</p>)}
          </div>
        )}
      </section>

      {/* Big buttons */}
      <section className={card}>
        <h2 className="text-base font-bold">The controls</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded border border-red-500/40 p-3">
            <form action={stopEverythingAction}><button className={btnDanger}>{"\u23f9"} Stop everything</button></form>
            <p className="mt-2 text-xs">Pauses the engine, asks Google to cancel every open batch (ours in our records <i>and</i> any of ours Google still lists), and stops every queued manifest. Answers Google already made are still saved. Nothing is resent until you say so. Safe to press twice.</p>
          </div>
          <div className="rounded border border-[var(--admin-accent)]/40 p-3">
            <form action={allowBatchesAction}><input type="hidden" name="n" value="1" /><button className={btnPrimary} disabled={!c.missionReady}>{"\ud83e\uddea"} Send 1 test batch ({BATCH_MAX_FAMILIES} products)</button></form>
            <p className="mt-2 text-xs">Un-pauses, switches to One at a time with exactly 1 send allowed, and (if nothing is queued) queues the next {BATCH_MAX_FAMILIES} products. One batch goes to Google within a minute, then the engine stops by itself.</p>
          </div>
          <div className="rounded border border-[var(--admin-border)] p-3">
            <form action={allowBatchesAction} className="flex flex-wrap items-center gap-2">
              <label className="text-sm">Allow
                <select name="n" defaultValue="2" className="mx-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1">
                  {[1, 2, 3, 4, 6, 8, 10, 14, MAX_BUDGET].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                batches
              </label>
              <button className={btn} disabled={!c.missionReady}>Send</button>
            </form>
            <p className="mt-2 text-xs">Same as the test button but for more batches. They go one per minute while there is room (at most {c.inflightCap} at Google at once), then it stops.</p>
          </div>
          <div className="rounded border border-[var(--admin-border)] p-3">
            <div className="flex flex-wrap gap-2">
              <form action={setModeAction}><input type="hidden" name="mode" value={c.control.mode === "auto" ? "manual" : "auto"} /><button className={btn}>{c.control.mode === "auto" ? "Switch to One at a time" : "Switch to Automatic"}</button></form>
              <form action={setPausedAction}><input type="hidden" name="paused" value={c.control.paused ? "0" : "1"} /><button className={btn}>{c.control.paused ? "\u25b6 Resume" : "\u23f8 Pause"}</button></form>
              <form action={checkNowAction}><button className={btn}>{"\ud83d\udd04"} Check now</button></form>
              <form action={rerunStoppedAction}><button className={btn} disabled={c.held === 0}>Re-run {c.held} stopped</button></form>
            </div>
            <p className="mt-2 text-xs"><b>One at a time</b> only sends what you allow (recommended while testing). <b>Automatic</b> keeps sending by itself. <b>Check now</b> asks Google about open batches immediately instead of waiting a minute. <b>Re-run stopped</b> puts products from cancelled / lost batches back in line.</p>
          </div>
        </div>
      </section>

      {/* Batches on the pipeline */}
      <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
        <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Your batches, step by step</h2>
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Where it is</th><th className={th}>Google&apos;s progress</th><th className={th}>Sent</th><th className={th}>Last checked</th><th className={th}>Batch name</th><th className={th}></th></tr></thead>
            <tbody>
              {c.batches.slice(0, 30).map((b) => {
                const isOpen = ["submitting", "pending", "running"].includes(b.state);
                const st = b.batch_stats;
                const pct = st && st.total ? Math.round(((st.succeeded + st.failed) / st.total) * 100) : null;
                const ageH = (now - Date.parse(b.submitted_at ?? b.created_at)) / 3_600_000;
                return (
                  <tr key={b.id} className="border-t border-[var(--admin-border)]">
                    <td className={td}><Pipeline b={b} />{isOpen && ageH > GOOGLE_TARGET_HOURS && <div className="mt-1 text-xs text-amber-300">Over {GOOGLE_TARGET_HOURS} h. Google gives up at {GOOGLE_EXPIRE_HOURS} h.</div>}</td>
                    <td className={td}>
                      {st ? (
                        <>
                          <div className="h-2 w-32 rounded bg-white/10"><div className="h-2 rounded bg-[var(--admin-accent)]" style={{ width: `${pct ?? 0}%` }} /></div>
                          <div className="text-xs">{st.succeeded} answered · {st.failed} failed · {st.pending} waiting of {st.total}</div>
                        </>
                      ) : <span className={`text-xs ${muted}`}>{b.families} products · {b.answered} answered</span>}
                    </td>
                    <td className={td}>{when(b.submitted_at ?? b.created_at)}<div className={`text-xs ${muted}`}>{fmtMinutes(ageH * 60)} ago</div></td>
                    <td className={td}>{ago(b.last_polled_at, now)}{b.poll_error && <div className="text-xs text-red-300">{b.poll_error.slice(0, 140)}</div>}</td>
                    <td className={td}>{b.name ? <code className="text-xs">{b.name}</code> : <span className={muted}>not sent</span>}{b.error && <div className="text-xs text-red-300">{b.error.slice(0, 140)}</div>}</td>
                    <td className={td}>
                      {isOpen && b.name && <form action={cancelBatchAction}><input type="hidden" name="name" value={b.name} /><input type="hidden" name="tab" value="mission" /><button className={btn} title="Ask Google to stop this batch. Answers already made are saved; the rest are set aside (not resent).">Cancel</button></form>}
                      {!isOpen && b.name && b.state !== "lost" && !(OPEN_BATCH_STATES as readonly string[]).includes(b.state) && <form action={deleteBatchAction}><input type="hidden" name="name" value={b.name} /><button className={`${btn} text-xs`} title="Google forgets this finished batch. Your saved facts stay.">Delete at Google</button></form>}
                    </td>
                  </tr>
                );
              })}
              {c.batches.length === 0 && <tr><td className={td} colSpan={6}>No batches yet. Press Send 1 test batch.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Google's own list */}
      <section className={card}>
        <h2 className="text-base font-bold">What Google itself lists</h2>
        <p className={`mt-1 text-xs ${muted}`}>Read live from Google (GET v1beta/batches) each time this page loads, and checked against our records.</p>
        {!google && <p className="mt-2 text-sm">No Gemini key is set, so Google cannot be asked.</p>}
        {google && !google.ok && <p className="mt-2 text-sm text-red-300">Google did not answer the list: {google.error}</p>}
        {google?.ok && (
          <>
            <p className="mt-2 text-sm">Google has <b>{google.rows.length}</b> batch{google.rows.length === 1 ? "" : "es"} on this key ({googleOpen.length} open). {orphans.length === 0 && ghosts.length === 0 ? "They match our records." : ""}</p>
            {orphans.length > 0 && <p className="mt-1 text-sm text-amber-300">{orphans.length} open batch{orphans.length === 1 ? "" : "es"} made by this app {orphans.length === 1 ? "is" : "are"} at Google but not in our records (left over from before). Stop everything cancels {orphans.length === 1 ? "it" : "them"}: {orphans.map((o) => o.name).join(", ")}</p>}
            {ghosts.length > 0 && <p className="mt-1 text-sm text-amber-300">{ghosts.length} batch{ghosts.length === 1 ? "" : "es"} we think are open {ghosts.length === 1 ? "is" : "are"} not on Google&apos;s list. The next check marks {ghosts.length === 1 ? "it" : "them"} lost and sets the products aside.</p>}
            {google.rows.length > 0 && (
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Google&apos;s word</th><th className={th}>Plain English</th><th className={th}>Name</th><th className={th}>Made by</th><th className={th}>Created</th><th className={th}>Progress</th></tr></thead>
                  <tbody>
                    {google.rows.slice(0, 50).map((r) => (
                      <tr key={r.name} className="border-t border-[var(--admin-border)]">
                        <td className={td}><code className="text-xs">BATCH_STATE_{r.state}</code></td>
                        <td className={td}><Badge tone={TONE[GOOGLE_STATES[r.state].severity]}>{GOOGLE_STATES[r.state].plain}</Badge></td>
                        <td className={td}><code className="text-xs">{r.name}</code></td>
                        <td className={td}>{r.ours ? (ourNames.has(r.name) ? "This app" : "This app (old)") : "Something else"}</td>
                        <td className={td}>{r.createTime ? when(r.createTime) : "-"}</td>
                        <td className={td}>{r.stats ? `${r.stats.succeeded + r.stats.failed} / ${r.stats.total}` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Ask Google console */}
      <section id="ask" className={card}>
        <h2 className="text-base font-bold">{"\ud83d\udcac"} Ask Google (no terminal needed)</h2>
        <p className={`mt-1 text-sm ${muted}`}>Pick a question and press Ask. The app sends the same request the terminal command would, using the key already saved in Vercel (it is never shown). Google&apos;s full reply appears below, with a Copy button, so you can paste it to your developer.</p>
        <form action={askGoogleAction} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">Question<br />
            <select name="cmd" defaultValue="list" className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1">
              <option value="list">List every batch Google has (batches.list)</option>
              <option value="get">Check one batch (batches.get)</option>
              <option value="cancel">Cancel one batch (batches.cancel)</option>
              <option value="delete">Delete one finished batch (batches.delete)</option>
              <option value="model">Can my key use the model? (models.get)</option>
            </select>
          </label>
          <label className="text-sm">Batch name (for check / cancel / delete) or model<br />
            <input name="arg" placeholder="batches/abc123" className="w-72 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 font-mono text-sm" />
          </label>
          <button className={btnPrimary} disabled={!c.keySet}>Ask</button>
        </form>
        <div className={`mt-2 text-xs ${muted}`}>
          Terminal equivalent of the list question (only if a developer ever asks): <code className="break-all">{curlFor("list", "")}</code>
        </div>
        {picked && <ul className="mt-3"><EventCard e={picked} open /></ul>}
      </section>

      {/* Messages */}
      <section className={card}>
        <h2 className="text-base font-bold">{"\ud83d\udcec"} Messages from Google (newest first)</h2>
        <p className={`mt-1 text-xs ${muted}`}>Every send, check, cancel and reply, in plain English with what to do. Open any one to see Google&apos;s exact words.</p>
        {c.events.length === 0 ? <p className="mt-2 text-sm">{c.missionReady ? "No messages yet." : "Apply migration 0299 to start the message log."}</p> : <ul className="mt-2 max-h-[40rem] overflow-auto">{c.events.map((e) => <EventCard key={e.id} e={e} />)}</ul>}
      </section>

      {/* Glossary */}
      <section className={card}>
        <h2 className="text-base font-bold">{"\ud83d\udcd6"} What the words mean</h2>
        <h3 className="mt-3 text-sm font-bold">The 7 steps every batch goes through</h3>
        <ol className="mt-1 list-decimal pl-5 text-sm">
          {PIPELINE_STEPS.map((s) => <li key={s.key}><b>{s.label}</b>{s.google ? <span className={muted}> (Google: {s.google})</span> : null} - {s.help}</li>)}
        </ol>
        <h3 className="mt-3 text-sm font-bold">Google&apos;s states</h3>
        <dl className="mt-1 space-y-2 text-sm">
          {(Object.keys(GOOGLE_STATES) as GoogleStateKey[]).map((k) => (
            <div key={k}>
              <dt><code className="text-xs">BATCH_STATE_{k}</code> = <b>{GOOGLE_STATES[k].plain}</b></dt>
              <dd>{GOOGLE_STATES[k].meaning} <i>What to do:</i> {GOOGLE_STATES[k].todo}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-3 text-sm font-bold">Good to know</h3>
        <ul className="mt-1 list-disc pl-5 text-sm">
          <li>Google aims to finish each batch within {GOOGLE_TARGET_HOURS} hours (usually much sooner) and gives up at {GOOGLE_EXPIRE_HOURS} hours. Batch costs half the normal price.</li>
          <li>Google keeps answers for 6 weeks; this app saves them onto your products within a minute or two of Google finishing.</li>
          <li>Sending the same batch twice is never done automatically: Google charges for each send, so this app only sends one batch per minute, with a lock so two copies can never go at once.</li>
          <li>If Google refuses a send (money, limits, an outage), the app waits 5, then 10, 20, 40 and 60 minutes before trying again, and tells you why here.</li>
          <li>You are on Gemini paid Tier 2: hundreds of millions of tokens can wait in Google&apos;s batch line, so 200-product batches never come near the limit.</li>
        </ul>
      </section>

      {/* Start fresh */}
      <section className={card}>
        <h2 className="text-base font-bold">{"\ud83e\uddf9"} How to stop everything and start fresh with one test batch</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Press <b>Stop everything</b> (red button above).</li>
          <li>Wait 2 to 5 minutes, then press <b>Check now</b>. Every batch above should say <i>Cancelled</i> and &quot;What Google itself lists&quot; should say 0 open.</li>
          <li>If any are still open, press Stop everything once more. If one still will not stop, use Ask Google → Cancel one batch with its name and copy the reply to your developer.</li>
          <li>Press <b>Send 1 test batch</b>. Within a minute a new batch appears above at &quot;Waiting in Google&apos;s line&quot;.</li>
          <li>Leave it. Check back in a few hours: it should walk through Google is working → Google finished → Saving facts → Facts saved. The Messages list tells you each step.</li>
          <li>When it says Facts saved and the products look right on Product Onboarding, press Send again (or Allow 2, 3 …) for the next ones. The products you stopped can go back with <b>Re-run stopped</b>.</li>
        </ol>
      </section>
    </div>
  );
}
