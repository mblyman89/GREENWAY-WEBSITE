/**
 * /admin/atm/drops - ATM cash drops matched to PAI cash loads (D198 S5). OWNER ONLY (finances.view).
 *
 * Owner (2026-11-07, verbatim): "there should be a new owner only page for me to see the atm cash
 * loads being matched to the till drops. please go above and beyond for me here, we need a
 * professional enterprise grade solution for this. it is a lot of money and is easy to steal. so
 * matching is essential. ... put on your auditor cap, study the fraud triangle".
 *
 * Layout (top to bottom):
 *   1. Data health: PAI last load, Plaid ATM account + last sync, migration 0346, settings.
 *   2. Headline numbers + the money trail (tills -> ATM -> dispensed -> bank).
 *   3. Questions to answer: open fraud signals, highest first, each with a sign-off form.
 *   4. Drops (till side) and loads (machine side) side by side, each with its verdict.
 *   5. People: per-employee risk (who drops, who is always alone, who keeps coming up short).
 *   6. The fraud triangle: opportunity / pressure / rationalization, and the control that answers each.
 *   7. Settings (the register's ATM-drop rules) and the review history.
 * Every number comes from the pure, unit-tested atm-drop-match-core; this file only renders.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { dollars, matchAtmDrops, type Signal } from "@/lib/atm/atm-drop-match-core";
import { getAtmDropMatchInputs, resolveMatchWindow } from "@/lib/atm/atm-drop-match-store";
import { reviewAtmDropAction, saveAtmDropSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const input =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btn = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const ghost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";

const SEV_CLS: Record<Signal["severity"], string> = {
  high: "border-red-500/40 bg-red-500/[0.08] text-red-300",
  medium: "border-amber-500/40 bg-amber-500/[0.08] text-amber-300",
  low: "border-sky-500/30 bg-sky-500/[0.06] text-sky-300",
  info: "border-white/15 bg-white/[0.03] text-white/60",
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  matched: { text: "Matched", cls: "text-emerald-300" },
  matched_late: { text: "Matched (late)", cls: "text-amber-300" },
  linked: { text: "Linked by owner", cls: "text-emerald-300" },
  mismatch: { text: "Amount off", cls: "text-red-300" },
  awaiting_report: { text: "Waiting for PAI", cls: "text-white/50" },
  no_load: { text: "No load found", cls: "text-red-300" },
  short: { text: "Load SHORT", cls: "text-red-300" },
  over: { text: "Load over", cls: "text-amber-300" },
  no_drop: { text: "No till drop", cls: "text-amber-300" },
};

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Status({ s }: { s: string }) {
  const v = STATUS_LABEL[s] ?? { text: s, cls: "text-white/60" };
  return <span className={`text-xs font-semibold ${v.cls}`}>{v.text}</span>;
}

function ReviewForm({
  kind,
  id,
  codes,
  from,
  to,
  loadOptions,
}: {
  kind: "drop" | "load" | "day";
  id: string;
  codes: string[];
  from: string;
  to: string;
  loadOptions?: { id: string; label: string }[];
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Sign off / explain</summary>
      <form action={reviewAtmDropAction} className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <input type="hidden" name="subject_kind" value={kind} />
        <input type="hidden" name="subject_id" value={id} />
        <input type="hidden" name="signal_codes" value={codes.join(" ")} />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <select name="decision" className={input} defaultValue="explained">
          <option value="accepted">Accepted - it is fine</option>
          <option value="explained">Explained (write why)</option>
          <option value="investigating">Investigating</option>
          <option value="escalated">Escalated</option>
          {kind === "drop" && loadOptions && loadOptions.length ? <option value="linked">Link to a load</option> : null}
        </select>
        <input name="note" required minLength={3} maxLength={2000} placeholder="Reason (required, permanent)" className={input} />
        <button className={btn}>Save</button>
        {kind === "drop" && loadOptions && loadOptions.length ? (
          <select name="link_load_id" className={`${input} sm:col-span-3`} defaultValue="">
            <option value="">(only for &quot;Link to a load&quot;) pick the load</option>
            {loadOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
      </form>
    </details>
  );
}

export default async function AtmDropsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; msg?: string; error?: string; tab?: string }>;
}) {
  await requirePermission("finances.view");
  const sp = await searchParams;
  const w = resolveMatchWindow(sp.from, sp.to);
  const inp = await getAtmDropMatchInputs(w);
  const nowIso = new Date().toISOString();
  const r = matchAtmDrops({
    drops: inp.drops,
    loads: inp.loads,
    settlements: inp.settlements,
    deposits: inp.deposits,
    reviews: inp.reviews,
    options: {
      matchWindowMinutes: inp.settings.matchWindowMinutes,
      terminalId: inp.settings.terminalId,
      witnessPolicy: inp.settings.witness,
      nowIso,
      plaidLastSyncedAt: inp.plaidLastSyncedAt,
      hasAtmAccount: inp.hasAtmAccount,
    },
  });
  const sevRank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const open = r.signals.filter((s) => !s.reviewed).sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  const reviewed = r.signals.filter((s) => s.reviewed);
  const loadOptions = r.loads
    .filter((l) => l.status !== "matched")
    .map((l) => ({ id: l.id, label: `${when(l.loadedAt) !== "-" ? when(l.loadedAt) : l.loadDate} - ${dollars(l.cashLoadCents)} (${l.status})` }));
  const csvHref = `/admin/atm/drops/csv?from=${w.fromDay}&to=${w.toDay}`;
  const plaidAge = inp.plaidLastSyncedAt ? Math.round((Date.parse(nowIso) - Date.parse(inp.plaidLastSyncedAt)) / 3_600_000) : null;

  return (
    <div>
      <AdminPageHeader
        title="ATM drops matched to cash loads"
        subtitle="Every $20 taken from a till for the ATM, matched to the cash load PAI reports and the ATM bank account in Plaid. Owner only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "ATM", href: "/admin/atm" }, { label: "Drops" }]} />}
        help={
          <HelpPanel
            id="atm-drops"
            title="How the match works"
            steps={[
              "On the iPad, an employee taps Drop, picks ATM and types how many $20 bills they took from the till. The app works out the amount, so it is always a multiple of $20.",
              "PAI reports every cash load the machine sees. Each night the app pulls that report, and it syncs the ATM bank account through Plaid.",
              "Each load is matched to the drop (or drops) that add up to it EXACTLY, within the match window. Bills are counted, so a match is to the penny or it is not a match.",
              "Anything that does not tie out becomes a question in 'Questions to answer'. They are questions, not accusations: a typo'd count, a late PAI report or a second load all have honest answers. Write the answer and sign it off. Sign-offs are permanent and also go in the Security Log.",
              "The fraud triangle panel shows the three things that make theft likely (a chance to do it, a reason to, and a way to excuse it) and how the store's controls answer each one.",
            ]}
          >
            <p>
              Nothing here moves money or changes the books. ATM drops still count toward each register&apos;s $2,000 drop, and they are
              kept out of the safe deposit bag and the night sheet because that cash never reaches the safe.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</div>
        ) : null}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</div>
        ) : null}

        {/* 1. Data health */}
        <section className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Data health</h2>
            <form className="flex flex-wrap items-end gap-2" method="get">
              <div>
                <label className={label} htmlFor="from">From</label>
                <input id="from" name="from" type="date" defaultValue={w.fromDay} className={input} />
              </div>
              <div>
                <label className={label} htmlFor="to">To</label>
                <input id="to" name="to" type="date" defaultValue={w.toDay} className={input} />
              </div>
              <button className={ghost}>Show</button>
              <a href={csvHref} className={ghost}>Download CSV</a>
            </form>
          </div>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <li className={inp.paiLatestLoadDay ? "text-white/80" : "text-amber-300"}>
              PAI cash loads: {inp.paiLatestLoadDay ? `newest ${inp.paiLatestLoadDay}` : "none yet - check the ATM page Health tab"}
            </li>
            <li className={inp.hasAtmAccount ? "text-white/80" : "text-red-300"}>
              Plaid ATM account: {inp.hasAtmAccount ? inp.atmAccountNames.join(", ") : <Link className="underline" href="/admin/plaid">not tagged - tag it as ATM on Bank Feeds</Link>}
            </li>
            <li className={plaidAge !== null && plaidAge <= 48 ? "text-white/80" : "text-amber-300"}>
              Bank last synced: {inp.plaidLastSyncedAt ? `${when(inp.plaidLastSyncedAt)} (${plaidAge}h ago)` : "unknown"}
            </li>
            <li className={inp.reviewsTableReady ? "text-white/80" : "text-amber-300"}>
              Sign-offs: {inp.reviewsTableReady ? "ready" : "run migration 0346 (docs/MIGRATIONS_TO_RUN.md)"}
            </li>
          </ul>
          <p className="mt-2 text-xs text-white/45">
            Register rules: ATM drops {inp.settings.enabled ? "ON" : "OFF"} · terminal {inp.settings.terminalId} · witness {inp.settings.witness} · max{" "}
            {inp.settings.maxTwentiesPerDrop} x $20 · match window {inp.settings.matchWindowMinutes} min.{" "}
            <a href="#settings" className="underline">Change</a>
          </p>
          {inp.errors.length ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-300">
              {inp.errors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* 2. Headline + money trail */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { k: "ATM drops", v: `${r.summary.drops} · ${dollars(r.summary.droppedCents)}` },
            { k: "Matched", v: `${r.summary.matched} of ${r.summary.drops}`, tone: r.summary.matched === r.summary.drops ? "text-emerald-300" : "" },
            { k: "Waiting for PAI", v: String(r.summary.awaiting) },
            { k: "Problems", v: String(r.summary.problems), tone: r.summary.problems ? "text-red-300" : "text-emerald-300" },
            { k: "Open questions", v: `${r.summary.openHigh} high · ${r.summary.openMedium} medium`, tone: r.summary.openHigh ? "text-red-300" : "" },
          ].map((x) => (
            <div key={x.k} className={card}>
              <div className={label}>{x.k}</div>
              <div className={`text-lg font-bold text-white ${x.tone ?? ""}`}>{x.v}</div>
            </div>
          ))}
        </section>
        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Money trail ({w.fromDay} to {w.toDay})</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <div>Taken from tills<br /><b className="text-white">{dollars(r.trail.dropsCents)}</b></div>
            <div>Loaded into the ATM (PAI)<br /><b className="text-white">{dollars(r.trail.loadsCents)}</b></div>
            <div>Dispensed to customers<br /><b className="text-white">{r.trail.dispensedCents === null ? "-" : dollars(r.trail.dispensedCents)}</b></div>
            <div>Deposited to the ATM bank<br /><b className="text-white">{dollars(r.trail.bankDepositsCents)}</b></div>
          </div>
          <p className={`mt-3 text-sm font-semibold ${r.trail.dropsVsLoadsCents === 0 ? "text-emerald-300" : "text-amber-300"}`}>
            Tills vs ATM: {r.trail.dropsVsLoadsCents === 0 ? "ties out to the penny" : `${dollars(Math.abs(r.trail.dropsVsLoadsCents))} ${r.trail.dropsVsLoadsCents > 0 ? "more left the tills than reached the ATM" : "more reached the ATM than the tills recorded"}`}
            {r.trail.dispensedVsBankCents !== null ? ` · Dispensed vs bank: ${dollars(r.trail.dispensedVsBankCents)}` : ""}
          </p>
        </section>

        {/* 3. Questions to answer */}
        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Questions to answer ({open.length})</h2>
          {open.length === 0 ? <p className="mt-2 text-sm text-emerald-300">Nothing open. Every ATM drop in this window ties out or is signed off.</p> : null}
          <ul className="mt-3 space-y-2">
            {open.slice(0, 80).map((s, i) => (
              <li key={`${s.code}-${s.subjectId}-${i}`} className={`rounded-[var(--admin-radius)] border px-3 py-2 ${SEV_CLS[s.severity]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{s.title}</span>
                  <span className="text-[10px] uppercase tracking-wide opacity-70">
                    {s.severity} · {s.triangle} · {s.code}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-90">{s.detail}</p>
                {s.subjectKind === "drop" || s.subjectKind === "load" || s.subjectKind === "day" ? (
                  <ReviewForm kind={s.subjectKind} id={s.subjectId} codes={[s.code]} from={w.fromDay} to={w.toDay} loadOptions={s.subjectKind === "drop" ? loadOptions : undefined} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* 4. Drops and loads */}
        <section className="grid gap-6 xl:grid-cols-2">
          <div className={card}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Till drops to the ATM ({r.drops.length})</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-white/45">
                  <tr><th className="py-1">When</th><th>Register / who</th><th>$20s</th><th>Amount</th><th>Verdict</th><th>Risk</th></tr>
                </thead>
                <tbody>
                  {r.drops.map((d) => (
                    <tr key={d.id} className="border-t border-white/5 align-top">
                      <td className="py-1.5">{when(d.droppedAt)}</td>
                      <td>
                        {d.registerName} · {d.employeeName ?? "?"}
                        <div className="text-white/40">{d.witnessName ? `witness ${d.witnessName}` : "no witness"}{d.recordedVia === "offline" ? " · offline" : ""}{d.storedAs === "note_tag" ? " · pre-0346" : ""}</div>
                      </td>
                      <td>{d.twenties ?? "-"}</td>
                      <td>{dollars(d.amountCents)}</td>
                      <td>
                        <Status s={d.status} />
                        {d.minutesToLoad !== null ? <div className="text-white/40">{d.minutesToLoad} min to load</div> : null}
                        {d.review ? <div className="text-white/40">signed: {d.review.decision}</div> : null}
                      </td>
                      <td className={d.riskScore >= 60 ? "font-bold text-red-300" : d.riskScore >= 30 ? "text-amber-300" : "text-white/60"}>{d.riskScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={card}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">PAI cash loads ({r.loads.length})</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-white/45">
                  <tr><th className="py-1">When</th><th>Loaded</th><th>From tills</th><th>Difference</th><th>Verdict</th></tr>
                </thead>
                <tbody>
                  {r.loads.map((l) => (
                    <tr key={l.id} className="border-t border-white/5 align-top">
                      <td className="py-1.5">{l.loadedAt ? when(l.loadedAt) : l.loadDate}{l.source === "manual" ? <div className="text-white/40">typed by hand</div> : null}</td>
                      <td>{dollars(l.cashLoadCents)}</td>
                      <td>{dollars(l.dropsCents)}<div className="text-white/40">{l.dropIds.length} drop{l.dropIds.length === 1 ? "" : "s"}</div></td>
                      <td className={l.diffCents < 0 ? "font-bold text-red-300" : l.diffCents > 0 ? "text-amber-300" : "text-emerald-300"}>{l.diffCents === 0 ? "$0.00" : dollars(l.diffCents)}</td>
                      <td><Status s={l.status} />{l.review ? <div className="text-white/40">signed: {l.review.decision}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 5. People */}
        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">People</h2>
          <p className="mt-1 text-xs text-white/45">A pattern over many drops matters more than any single one. A high score means &quot;look closer&quot;, never &quot;guilty&quot;.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/45">
                <tr><th className="py-1">Employee</th><th>Drops</th><th>Amount</th><th>Matched</th><th>Problems</th><th>Alone</th><th>Offline</th><th>Late night</th><th>Explained</th><th>Score</th></tr>
              </thead>
              <tbody>
                {r.employees.map((e) => (
                  <tr key={e.employeeId} className="border-t border-white/5">
                    <td className="py-1.5">{e.employeeName}</td>
                    <td>{e.drops}</td>
                    <td>{dollars(e.droppedCents)}</td>
                    <td>{e.matched}</td>
                    <td className={e.problems ? "text-red-300" : ""}>{e.problems}</td>
                    <td>{e.unwitnessed}</td>
                    <td>{e.offline}</td>
                    <td>{e.oddHours}</td>
                    <td>{e.explainedReviews}</td>
                    <td className={e.riskScore >= 60 ? "font-bold text-red-300" : e.riskScore >= 30 ? "text-amber-300" : "text-white/60"}>{e.riskScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. Fraud triangle */}
        <section className="grid gap-3 lg:grid-cols-4">
          <div className={card}>
            <div className={label}>Opportunity (the chance)</div>
            <p className="text-sm text-white/80">{r.triangle.opportunity.unwitnessedPct}% of drops had no witness · {r.triangle.opportunity.offlinePct}% recorded offline · {r.triangle.opportunity.manualLoadPct}% of loads typed by hand · {r.triangle.opportunity.aloneEmployees} always alone</p>
            <p className="mt-2 text-xs text-white/45">Control: a second person on each ATM drop (Settings: witness &quot;required&quot;), the $20 count on the iPad, PAI&apos;s own load record.</p>
          </div>
          <div className={card}>
            <div className={label}>Pressure (the reason)</div>
            <p className="text-sm text-white/80">{r.triangle.pressure.repeatShortfallEmployees} people with repeat shortfalls · {r.triangle.pressure.openHighSignals} open high-severity questions</p>
            <p className="mt-2 text-xs text-white/45">Control: repeat shortfalls by one person are flagged even when each one is small.</p>
          </div>
          <div className={card}>
            <div className={label}>Rationalization (the excuse)</div>
            <p className="text-sm text-white/80">{r.triangle.rationalization.explainedReviews} items &quot;explained&quot; · {r.triangle.rationalization.explainedRepeatEmployees} people explained more than once</p>
            <p className="mt-2 text-xs text-white/45">Control: every sign-off needs a written reason and is permanent; repeated explanations for the same person are counted.</p>
          </div>
          <div className={card}>
            <div className={label}>Control health</div>
            <p className="text-sm text-white/80">{r.triangle.control.matchedPct}% matched · {r.triangle.control.awaiting} waiting · bank feed {r.triangle.control.plaidFresh ? "fresh" : "STALE"}</p>
            <p className="mt-2 text-xs text-white/45">The match only works while PAI and Plaid both sync. Both run every morning automatically.</p>
          </div>
        </section>

        {/* 7. Settings + history */}
        <section id="settings" className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Register rules for ATM drops</h2>
          <form action={saveAtmDropSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-5">
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" name="enabled" defaultChecked={inp.settings.enabled} /> ATM drops on
            </label>
            <div>
              <label className={label} htmlFor="terminal_id">ATM terminal</label>
              <input id="terminal_id" name="terminal_id" defaultValue={inp.settings.terminalId} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="witness">Witness</label>
              <select id="witness" name="witness" defaultValue={inp.settings.witness} className={input}>
                <option value="required">Required</option>
                <option value="recommended">Recommended (flag if missing)</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="max_twenties">Max $20s per drop</label>
              <input id="max_twenties" name="max_twenties" type="number" min={1} max={2500} defaultValue={inp.settings.maxTwentiesPerDrop} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="match_window">Match window (min)</label>
              <input id="match_window" name="match_window" type="number" min={15} max={1440} defaultValue={inp.settings.matchWindowMinutes} className={input} />
            </div>
            <div className="sm:col-span-5">
              <button className={btn}>Save rules</button>
            </div>
          </form>
        </section>

        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Sign-off history ({inp.reviews.length})</h2>
          <p className="mt-1 text-xs text-white/45">{reviewed.length} signal{reviewed.length === 1 ? "" : "s"} in this window are answered. Nothing here can be edited or deleted.</p>
          <ul className="mt-3 space-y-1 text-xs text-white/70">
            {[...inp.reviews].reverse().slice(0, 50).map((v) => (
              <li key={v.id}>
                {when(v.reviewedAt)} · {v.reviewedByEmail ?? "owner"} · {v.subjectKind} {v.subjectId.slice(0, 8)} · <b>{v.decision}</b> · {v.note}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
