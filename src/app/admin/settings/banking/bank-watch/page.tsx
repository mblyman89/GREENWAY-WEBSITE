/**
 * /admin/settings/banking/bank-watch   (R41 S16)
 *
 * The daily bank watch on the Timberland Main account, from the Plaid feed
 * the site already pulls. Four sections (ach-bank-watch-core.ts):
 *   1. feed health (connection status, last sync, account last four vs the
 *      signed agreement, Trial plan slots);
 *   2. money out that nothing explains, with a review form per line;
 *   3. possible returned ACH payments (money back for the exact amount sent);
 *   4. return/NOC fee debits vs notices logged, per month;
 * plus the owner's known-payee list (0289) and what Plaid can and cannot do
 * for ACH on the free Trial plan.
 *
 * Gate: finances.view (the bank feed's own gate; the owner today). Adding or
 * retiring a known payee is the owner's (ach.act, in bank-watch-actions.ts).
 * Nothing on this page ever blocks a payment.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, InfoHint } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import {
  buildBankWatch,
  explanationWord,
  usd,
  STALE_SYNC_DAYS,
  TRIAL_ITEM_CAP,
  TRIAL_PLAN_FILE,
  SAO_FILE,
  AGREEMENT_FILE,
  VERDICT_WORD,
  WATCH_DAYS,
  WATCH_QUOTES,
  type WatchLine,
  type WatchVerdict,
} from "@/lib/payments/ach-bank-watch-core";
import { loadBankWatch } from "@/lib/payments/ach-bank-watch-store";
import { BankingSubnav } from "../BankingHelpTabs";
import { addRuleAction, recordReviewAction, retireRuleAction } from "../bank-watch-actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 flex items-center text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const HEALTH_TONE = { ok: "text-emerald-300", warn: "text-amber-200", bad: "text-red-300" } as const;
const HEALTH_MARK = { ok: "\u2713", warn: "!", bad: "\u2717" } as const;

const VERDICT_HINT: Record<WatchVerdict, string> = {
  known: "It is ours and expected (a bill, a card, a transfer we made). If it will happen again, ask Michael to add a known payee so it stops being listed.",
  reported_to_bank: "You called Timberland about it and are waiting. Write who you spoke to and what they said.",
  returned_payment: "Money that came back from a payment we sent. Also log the notice on ACH operations so the payee's account is fixed.",
  fee: "A Timberland charge (Schedule B), for example the per-return/NOC fee.",
  not_ours: "Nobody here recognises it. Call Timberland Cash Management at 1-800-562-8761 the same day and say it is unauthorised.",
};

function Quote({ id, file }: { id: keyof typeof WATCH_QUOTES; file: string }) {
  return (
    <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
      &ldquo;{WATCH_QUOTES[id]}&rdquo;
      <span className="mt-1 block text-xs not-italic text-white/40">Verbatim, mirrored at docs/authorities/{file}</span>
    </blockquote>
  );
}

function ReviewForm({ line }: { line: Pick<WatchLine, "transactionId"> }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Say what this is</summary>
      <form action={recordReviewAction} className="mt-2 space-y-2 text-sm">
        <input type="hidden" name="transaction_id" value={line.transactionId} />
        <fieldset className="space-y-1">
          <legend className="text-white/70">What is it?</legend>
          {(Object.keys(VERDICT_WORD) as WatchVerdict[]).map((v) => (
            <label key={v} className="flex items-start gap-2">
              <input type="radio" name="verdict" value={v} required className="mt-1" />
              <span className="text-white/85">
                {VERDICT_WORD[v]}
                <InfoHint text={VERDICT_HINT[v]} position="right" />
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="text-white/70">How you know (who you called, what they said). No account numbers.</span>
          <textarea name="note" required minLength={10} maxLength={500} rows={2} className={inputCls} placeholder="e.g. Called Timberland 1-800-562-8761, spoke to the cash management desk: it is the October return fee." />
        </label>
        <button className={btnPrimary}>Record</button>
      </form>
    </details>
  );
}

export default async function BankWatchPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const session = await requirePermission("finances.view");
  const sp = await searchParams;
  const today = pacificToday();
  const isOwner = can(session.profile.role, "ach.act");
  const load = await loadBankWatch(today);
  const r = buildBankWatch(load.input);
  const explained = r.outLines.filter((l) => l.explanation !== null);
  const pending = r.outLines.filter((l) => l.explanation === null && l.pending);
  const liveRules = load.rules.filter((x) => !x.retired);
  const retiredRules = load.rules.filter((x) => x.retired);
  const attention = r.counts.unexplained + r.counts.possibleReturns + r.counts.feeGaps + r.health.filter((h) => h.level === "bad").length;

  return (
    <div>
      <AdminPageHeader
        title="Bank watch (Timberland Main account)"
        subtitle="Every money-out line on the account the payroll and vendor payments come from, checked each morning against what the site knows. It never blocks a payment."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Bank watch" }]} />}
        help={
          <HelpPanel
            id="ach-bank-watch"
            title="What this page is for"
            steps={[
              "Each morning the site refreshes the Timberland Main account from Plaid (the same connection as Bank Feeds; no new connection is used).",
              "It explains every money-out line it can: an ACH file settling, something already in the books, a Timberland fee, or a known payee Michael added.",
              "Anything left over is listed under \u201cNot explained\u201d and emailed to Michael. Look at each one and say what it is. If nobody recognises it, call Timberland at 1-800-562-8761 the same day.",
              "Money coming back for the exact amount of a payment we sent may be a returned ACH payment: check the Timberland notice and log it on ACH operations.",
            ]}
          >
            <p>This is the site&apos;s version of the &ldquo;ACH filter&rdquo; the State Auditor recommends. It reports after a line posts; it cannot stop one. Whether Timberland offers a filter at the bank itself is not confirmed yet: it is on the list of questions for Brenda.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="bankwatch" badge={attention ? { bankwatch: String(attention) } : undefined} />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}
        {load.problems.length ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            <p className="font-semibold">Some of the picture is missing, so this is not an all clear:</p>
            <ul className="ml-5 list-disc">{load.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        ) : null}

        <section id="summary" className="grid gap-3 sm:grid-cols-4" aria-label="Summary">
          {[
            { n: r.counts.unexplained, label: "Not explained", sub: usd(r.counts.unexplainedCents), hint: "Settled money-out lines nothing on the site accounts for. Pending lines are listed below but never counted: they can still change or drop off.", bad: r.counts.unexplained > 0 },
            { n: r.counts.possibleReturns, label: "Possible returns", sub: "not logged yet", hint: "Money that came back for exactly the amount of an ACH payment we sent on or before that day, with no return logged for it yet.", bad: r.counts.possibleReturns > 0 },
            { n: r.counts.feeGaps, label: "Fee/notice gaps", sub: "months", hint: "Months with more debits the size of Timberland's return/NOC fee than notices logged. A notice may have been missed.", bad: r.counts.feeGaps > 0 },
            { n: r.counts.explained, label: "Explained", sub: `of ${r.counts.out} in ${WATCH_DAYS} days`, hint: "Lines matched to an ACH file, the books, a Timberland fee, a known payee or a review.", bad: false },
          ].map((c) => (
            <div key={c.label} className={`${card} ${c.bad ? "border-amber-400/40" : ""}`}>
              <p className="flex items-center text-xs uppercase tracking-wide text-white/50">
                {c.label}
                <InfoHint text={c.hint} />
              </p>
              <p className={`text-2xl font-bold ${c.bad ? "text-amber-200" : "text-white"}`}>{c.n}</p>
              <p className="text-xs text-white/50">{c.sub}</p>
            </div>
          ))}
        </section>

        <section id="health" className={card}>
          <h2 className={h2}>
            Is the feed working?
            <InfoHint text={`The watch is only as good as the feed. A sync older than ${STALE_SYNC_DAYS} days is flagged. The last four digits are compared with the account named in the signed Timberland agreement, so the watch never reads the wrong account.`} />
          </h2>
          <ul className="space-y-1 text-sm">
            {r.health.map((h, i) => (
              <li key={i} className={HEALTH_TONE[h.level]}>
                <span aria-hidden className="mr-1 font-bold">{HEALTH_MARK[h.level]}</span>
                {h.text}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-white/50">
            <Link href="/admin/plaid" className="text-emerald-300 hover:underline">Open Bank Feeds</Link> to sync or reconnect. Reconnecting the same connection does not use another of the {TRIAL_ITEM_CAP} slots.
          </p>
        </section>

        <section id="unexplained" className={card}>
          <h2 className={h2}>
            Money out that nothing explains ({r.unexplained.length})
            <InfoHint text="Checked in this order: an ACH file settling (ACH Payments report), already in the books, a Timberland fee amount (Schedule B), a known payee within its limit, or a review someone recorded (the newest review stands)." />
          </h2>
          {r.unexplained.length === 0 ? (
            <p className="text-sm text-emerald-300">{load.problems.length ? "Nothing unexplained in what could be read." : `\u2713 Every settled money-out line in the last ${WATCH_DAYS} days is explained.`}</p>
          ) : (
            <ul className="space-y-3">
              {r.unexplained.map((l) => (
                <li key={l.transactionId} className="rounded-[var(--admin-radius)] border border-amber-400/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-white/70">{l.date}</span>
                    <span className="font-semibold text-white">{usd(l.amountCents)}</span>
                    <span className="text-white/85">{l.description ?? "(no description)"}</span>
                    {l.ruleOverLimit ? <Badge tone="orange">over the {usd(l.ruleOverLimit.maxCents)} limit</Badge> : null}
                  </div>
                  <ReviewForm line={l} />
                </li>
              ))}
            </ul>
          )}
          {pending.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-white/70">Pending, not counted yet ({pending.length})</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-white/60">
                {pending.map((l) => <li key={l.transactionId}>{l.date} {usd(l.amountCents)} {l.description ?? ""}</li>)}
              </ul>
            </details>
          ) : null}
          <p className="mt-3 text-xs text-white/50">
            Don&apos;t recognise one? Call Timberland Cash Management at 1-800-562-8761 the same day. The agreement gives a limited time to report a statement error:
          </p>
          <Quote id="agreementStatement" file={AGREEMENT_FILE} />
        </section>

        <section id="returns" className={card}>
          <h2 className={h2}>
            Possible returned payments ({r.possibleReturns.length})
            <InfoHint text="Money in for exactly the amount of an ACH payment we sent on or before that day, within the window. Each payment and each logged return is used once. It says 'possible' because the bank wording of a return is not known yet." />
          </h2>
          {r.possibleReturns.length === 0 ? (
            <p className="text-sm text-white/70">No money came back for the amount of a payment we sent.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {r.possibleReturns.map((p) => (
                <li key={p.transactionId} className={`rounded-[var(--admin-radius)] border p-3 ${p.logged || p.reviewed ? "border-white/10" : "border-amber-400/30"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-white/70">{p.date}</span>
                    <span className="font-semibold text-white">{usd(p.amountCents)} back</span>
                    <span className="text-white/80">sent {p.payment.date} to {p.payment.payee} ({p.payment.detail})</span>
                    {p.logged ? <Badge tone="green">return logged</Badge> : p.reviewed ? <Badge tone="neutral">reviewed</Badge> : <Badge tone="orange">not logged</Badge>}
                  </div>
                  {!p.logged && !p.reviewed ? (
                    <>
                      <p className="mt-1 text-xs text-white/60">
                        Check the Timberland notice, then <Link href="/admin/settings/banking/operations" className="text-emerald-300 hover:underline">log it on ACH operations</Link>. Timberland notifies within 1 banking day:
                      </p>
                      <Quote id="agreementReturnNotice" file={AGREEMENT_FILE} />
                      <ReviewForm line={p} />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="fees" className={card}>
          <h2 className={h2}>
            Return/NOC fees vs notices logged
            <InfoHint text="Schedule B of the agreement charges a fixed fee for each return or NOC. If a month has more fee-sized debits than notices logged, a notice may have been missed. A fee-sized debit can also be something else; check before acting." />
          </h2>
          {r.feeMonths.length === 0 ? (
            <p className="text-sm text-white/70">No fee-sized debits and no notices in the last {WATCH_DAYS} days.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-white/50">
                <tr><th className="py-1">Month</th><th>Return/NOC fee debits ({usd(load.input.fees.perReturnOrNoc)})</th><th>Notices logged</th><th>Monthly service fee ({usd(load.input.fees.serviceMonthly)})</th><th>Gap</th></tr>
              </thead>
              <tbody>
                {r.feeMonths.map((f) => (
                  <tr key={f.month} className="border-t border-white/5">
                    <td className="py-1 font-mono">{f.month}</td>
                    <td>{f.returnFeeDebits}</td>
                    <td>{f.noticesLogged}</td>
                    <td>{f.serviceFeeDebits}</td>
                    <td className={f.gap ? "font-semibold text-amber-200" : "text-white/60"}>{f.gap ? `${f.gap} missing?` : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section id="rules" className={card}>
          <h2 className={h2}>
            Known payees (the site&apos;s ACH filter list)
            <InfoHint text="Payees that may take money out of the Main account (power, phone, card processor). A line whose description contains the name, at or under the limit, is not reported. Over the limit it is reported again. Only Michael adds or retires one; nothing is ever deleted." />
          </h2>
          <Quote id="saoFilter" file={SAO_FILE} />
          <Quote id="saoList" file={SAO_FILE} />
          {!load.tablesReady ? (
            <p className="text-sm text-amber-200">Apply migration 0289 to turn on known payees and reviews.</p>
          ) : (
            <>
              {liveRules.length === 0 ? <p className="text-sm text-white/70">No known payees yet. Every unmatched debit is listed.</p> : null}
              <ul className="space-y-2 text-sm">
                {liveRules.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-white/10 p-2">
                    <span className="font-semibold text-white">&ldquo;{x.matchText}&rdquo;</span>
                    <span className="text-white/70">{x.maxCents === null ? "any amount" : `up to ${usd(x.maxCents)}`}</span>
                    <span className="text-white/60">{x.note}</span>
                    <span className="text-xs text-white/40">added {x.createdAt.slice(0, 10)} by {x.createdBy}</span>
                    {isOwner ? (
                      <form action={retireRuleAction} className="ml-auto">
                        <input type="hidden" name="rule_id" value={x.id} />
                        <button className={btnGhost}>Retire</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {retiredRules.length ? (
                <details className="mt-2 text-xs text-white/60">
                  <summary className="cursor-pointer">Retired ({retiredRules.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {retiredRules.map((x) => <li key={x.id}>&ldquo;{x.matchText}&rdquo; added {x.createdAt.slice(0, 10)} by {x.createdBy}; retired {x.retiredAt?.slice(0, 10)} by {x.retiredBy}</li>)}
                  </ul>
                </details>
              ) : null}
              {isOwner ? (
                <form action={addRuleAction} className="mt-3 grid gap-2 text-sm sm:grid-cols-[2fr_1fr_3fr_auto] sm:items-end">
                  <label className="block">
                    <span className="flex items-center text-white/70">Name on the statement<InfoHint text="3 to 60 characters, copied from the bank line (for example PUGET SOUND ENERGY). Capitals and punctuation do not matter. No account numbers." /></span>
                    <input name="match_text" required minLength={3} maxLength={60} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="flex items-center text-white/70">Limit ($)<InfoHint text="The largest single debit you expect. Leave empty for any amount, but a limit catches a payee who suddenly takes much more." /></span>
                    <input name="max_dollars" inputMode="decimal" placeholder="optional" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="text-white/70">Who it is and why it takes money</span>
                    <input name="note" required minLength={10} maxLength={300} className={inputCls} />
                  </label>
                  <button className={btnPrimary}>Add</button>
                </form>
              ) : (
                <p className="mt-2 text-xs text-white/50">Only Michael adds or retires known payees.</p>
              )}
            </>
          )}
        </section>

        <details className={card}>
          <summary className="cursor-pointer text-sm font-semibold text-white">Explained lines ({explained.length})</summary>
          <ul className="mt-2 space-y-0.5 text-xs text-white/70">
            {explained.map((l) => (
              <li key={l.transactionId}>
                <span className="font-mono">{l.date}</span> {usd(l.amountCents)} {l.description ?? ""} <span className="text-white/45">&mdash; {explanationWord(l.explanation)}</span>
              </li>
            ))}
          </ul>
        </details>

        <section id="plaid" className={card}>
          <h2 className={h2}>What Plaid does (and doesn&apos;t) do for ACH here</h2>
          <div className="space-y-2 text-sm text-white/80">
            <p>
              <strong>Daily statement reading:</strong> yes, this page. Every morning the Main connection is refreshed and read. That costs nothing on the Trial plan:
            </p>
            <Quote id="trialCalls" file={TRIAL_PLAN_FILE} />
            <p>
              <strong>Instant account checks for payees:</strong> Plaid&apos;s account checks work when the account holder links their own account through Plaid, and every link is a new connection on our Plaid account. The Trial plan allows {TRIAL_ITEM_CAP}, and a removed one is not given back:
            </p>
            <Quote id="trialCap" file={TRIAL_PLAN_FILE} />
            <Quote id="trialRemove" file={TRIAL_PLAN_FILE} />
            <p>
              So employees and vendors are not asked to link their banks here. Their accounts are checked the way the agreement and Nacha already allow: the prenote on <Link href="/admin/settings/banking?tab=vendors" className="text-emerald-300 hover:underline">the banking pages</Link>, plus the call-back on every bank change.
            </p>
            <p>
              <strong>PDF statements from Plaid:</strong> the Trial plan page lists &ldquo;Statements &mdash; retrieve bank statements&rdquo;. Whether Timberland supports it through Plaid is not confirmed, so it is not turned on here. The daily read above already covers every transaction; the official statement still comes from Timberland.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
