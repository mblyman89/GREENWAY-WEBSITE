/**
 * R41 S10: "What is due to Timberland" on ACH operations.
 *
 *   1. Obligation clocks: every open item from the Timberland log (0277) and
 *      every open return / bank correction (0263), soonest and most urgent
 *      first, each with the contract section and what to do.
 *   2. The Timberland log: add an entry (owner at once; an admin's entry is a
 *      request for the owner), and the newest entries with a Done button.
 *   3. The fees card (Schedule B) with what this month's statement should
 *      show, and the 30-day statement check (section 17).
 *
 * A failed read says so: an empty list here must mean "nothing is due".
 */
import { Badge } from "@/components/admin/ui";
import {
  closedIds,
  COMMS_TYPES,
  COMMS_TYPE_SPECS,
  expectedMonthlyFees,
  FEE_ROWS,
  obligationClocks,
  usdCents,
  type CommsRow,
  type NoticeClockRow,
} from "@/lib/payments/timberland-obligations-core";
import { addTimberlandCommsAction, closeTimberlandCommsAction } from "../comms-actions";

const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";
const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";

function labelOf(r: CommsRow): string {
  return r.entry_type === "done" ? "Done" : COMMS_TYPE_SPECS[r.entry_type].label;
}

/** The log shows this many newest entries (the clocks use every row read). */
const LOG_SHOWN = 30;

export function ClocksPanel(props: {
  todayIso: string;
  now: Date;
  isOwner: boolean;
  comms: { ok: true; rows: CommsRow[]; capped: boolean } | { ok: false; error: string };
  notices: readonly NoticeClockRow[];
  noticesOk: boolean;
  monthCounts: { returns: number; nocs: number } | null;
}) {
  const rows = props.comms.ok ? props.comms.rows : [];
  const clocks = props.comms.ok ? obligationClocks({ todayIso: props.todayIso, nowUtc: props.now, comms: rows, notices: props.notices }) : [];
  const closed = closedIds(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fees = props.monthCounts ? expectedMonthlyFees(props.monthCounts.returns, props.monthCounts.nocs) : null;
  const submitWord = props.isOwner ? "Add to the log" : "Send to Michael for approval";

  return (
    <>
      <section id="clocks" className={card}>
        <h2 className={h2}>What is due to Timberland ({props.comms.ok ? clocks.length : "?"} open)</h2>
        {!props.comms.ok ? (
          <p role="alert" className="mb-3 rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
            The Timberland log could not be read, so this list may be missing items: {props.comms.error}
          </p>
        ) : null}
        {!props.noticesOk ? <p className="mb-3 text-sm text-amber-200">Returns and bank corrections could not be read, so their deadlines are not listed here.</p> : null}
        {props.comms.ok && props.comms.capped ? <p className="mb-3 text-xs text-amber-200">Only the newest entries were read; older open items may be missing. Mark old items done.</p> : null}
        {clocks.length ? (
          <ul className="space-y-2">
            {clocks.map((c) => (
              <li key={c.key} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm text-white/80">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.tone}>{c.dueText}</Badge>
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-xs text-white/40">{c.section}</span>
                </div>
                <p className="mt-1 text-xs text-white/60">{c.action}</p>
                {c.commsId ? (
                  <form action={closeTimberlandCommsAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="comms_id" value={c.commsId} />
                    <input name="summary" required minLength={5} maxLength={1000} placeholder="What you did (no account numbers)" className={`${inputCls} max-w-md`} />
                    <button className={btnGhost}>{props.isOwner ? "Done" : "Ask Michael to mark done"}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : props.comms.ok && props.noticesOk ? (
          <p className="text-sm text-white/50">Nothing is due to Timberland right now.</p>
        ) : null}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-emerald-300">Log a message from Timberland (or a call you made)</summary>
          <form action={addTimberlandCommsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelCls}>What was it</span>
              <select name="entry_type" required className={inputCls} defaultValue="">
                <option value="" disabled>Pick one</option>
                {COMMS_TYPES.map((t) => (
                  <option key={t} value={t}>{COMMS_TYPE_SPECS[t].label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Date it arrived or happened (Pacific)</span>
              <input name="received_on" type="date" required max={props.todayIso} defaultValue={props.todayIso} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Time, HH:MM Pacific (calls and reversals)</span>
              <input name="time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="09:30" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Second date (file date, last day, or settlement date)</span>
              <input name="effective_on" type="date" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Amount, dollars (reserve or higher limit)</span>
              <input name="amount" inputMode="decimal" placeholder="5,000.00" className={inputCls} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelCls}>Short note: who, what, and how it arrived</span>
              <textarea name="summary" required minLength={5} maxLength={1000} rows={3} placeholder="Never type an account or card number here." className={inputCls} />
            </label>
            <details className="sm:col-span-2 text-xs text-white/60">
              <summary className="cursor-pointer">What each one starts (and the contract words)</summary>
              <ul className="mt-2 space-y-2">
                {COMMS_TYPES.map((t) => {
                  const s = COMMS_TYPE_SPECS[t];
                  return (
                    <li key={t}>
                      <span className="font-semibold text-white/75">{s.label}:</span> {s.hint}
                      {s.quote ? <span className="block italic text-white/45">&ldquo;{s.quote.text}&rdquo; ({s.quote.section})</span> : null}
                    </li>
                  );
                })}
              </ul>
            </details>
            <div className="sm:col-span-2">
              <button className={btnPrimary}>{submitWord}</button>
            </div>
          </form>
        </details>

        {rows.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-white/70">The Timberland log (newest {Math.min(rows.length, LOG_SHOWN)} of {rows.length}{props.comms.ok && props.comms.capped ? "+" : ""})</summary>
            <ul className="mt-2 space-y-1 text-xs text-white/65">
              {rows.slice(0, LOG_SHOWN).map((r) => {
                const target = r.entry_type === "done" ? byId.get(r.closes_id ?? "") : undefined;
                const label = r.entry_type === "done" ? `Done: ${target ? labelOf(target) : "an earlier item"}` : labelOf(r);
                return (
                  <li key={r.id}>
                    <span className="text-white/45">{r.received_on}</span> · <span className="font-semibold">{label}</span>
                    {r.effective_on ? ` · ${r.effective_on}` : ""}
                    {r.amount_cents !== null ? ` · ${usdCents(r.amount_cents)}` : ""}
                    {r.entry_type !== "done" && closed.has(r.id) ? " · ✓ done" : ""} · {r.summary}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </section>

      <section id="fees" className={card}>
        <h2 className={h2}>Timberland fees (Schedule B)</h2>
        <table className="mb-3 w-full max-w-lg text-sm text-white/75">
          <tbody>
            {FEE_ROWS.map((f) => (
              <tr key={f.label} className="border-b border-white/5">
                <td className="py-1">{f.label}</td>
                <td className="py-1 text-right font-semibold">{usdCents(f.cents)}</td>
                <td className="py-1 pl-3 text-white/45">{f.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fees ? (
          <div className="text-sm text-white/75">
            <p className="font-semibold">This month&apos;s statement should show about {usdCents(fees.totalCents)} in ACH fees:</p>
            <ul className="ml-5 list-disc text-xs text-white/60">
              {fees.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <p className="mt-1 text-xs text-white/45">Counted from the returns and corrections logged on this page. The yearly Nacha CD fee is extra in the month Timberland charges it.</p>
          </div>
        ) : (
          <p className="text-sm text-amber-200">Could not count this month&apos;s returns and corrections, so the expected total is not shown.</p>
        )}
        <p className="mt-2 text-xs text-white/55">
          When the statement arrives, log it above as &ldquo;{COMMS_TYPE_SPECS.statement_received.label}&rdquo;: any difference must be reported within 30 calendar days.
          {COMMS_TYPE_SPECS.statement_received.quote ? <span className="block italic text-white/45">&ldquo;{COMMS_TYPE_SPECS.statement_received.quote.text}&rdquo; ({COMMS_TYPE_SPECS.statement_received.quote.section})</span> : null}
        </p>
      </section>
    </>
  );
}
