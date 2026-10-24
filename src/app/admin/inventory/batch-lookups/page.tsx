/**
 * R74 S35 - Batch Lookups console: smart batching (gift-wrapped batches of
 * 200 product families, sent 4 at a time), live monitor with pause / resume
 * / cancel / re-run, and costs + health (ledger by vendor and manifest,
 * search health, vendor schedule to the target date).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, PageTabs } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/admin/ux/Breadcrumbs";
import { BatchLookupAutoRefresh } from "@/components/admin/catalog/BatchLookupAutoRefresh";
import { resolveTab, type TabSpec } from "@/lib/admin/page-tabs-core";
import { loadBatchConsole, batchesLeft } from "@/lib/ai/batch-console-server";
import {
  BATCH_CONSOLE_PATH,
  BATCH_WAVE,
  DEFAULT_TARGET_DATE,
  batchEtaMin,
  daysUntil,
  ledgerBasis,
  fmtCents,
  fmtMinutes,
  planBatches,
  scheduleVendors,
  type VendorLoad,
} from "@/lib/ai/batch-console-core";
import { BATCH_MAX_FAMILIES, BATCH_PRICE } from "@/lib/ai/gemini-batch-core";
import { ConfidenceTab } from "./ConfidenceTab";
import { cancelBatchAction, cancelJobAction, rerunFailedAction, sendSelectedAction, sendWaveAction, setJobPausedAction, setPausedAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Tab = "smart" | "monitor" | "costs" | "confidence";
const TABS: readonly TabSpec<Tab>[] = [
  { key: "smart", label: "Smart batching", icon: "\ud83c\udf81", blurb: "Plan and send batches of 200 products" },
  { key: "monitor", label: "Monitor", icon: "\ud83d\udce1", blurb: "Live batches, progress, pause, failures, activity" },
  { key: "costs", label: "Costs & health", icon: "\ud83d\udcca", blurb: "Cost ledger, search health, schedule, settings" },
  { key: "confidence", label: "Vendor confidence", icon: "\ud83c\udfaf", blurb: "Cultivera: score each vendor, attach facts at 85%+" },
];

const n = (x: number) => x.toLocaleString("en-US");
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const ago = (iso: string | null, now: number) => (iso ? `${fmtMinutes((now - Date.parse(iso)) / 60_000)} ago` : "-");
const STATE_TONE: Record<string, "neutral" | "green" | "gold" | "orange" | "danger" | "outline"> = { submitting: "outline", pending: "outline", running: "gold", succeeded: "green", ingesting: "gold", ingested: "green", failed: "danger", canceled: "neutral", expired: "danger" };
const btn = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--admin-surface-2)]";
const btnPrimary = "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black hover:opacity-90";
const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const td = "px-2 py-1.5 align-top";

export default async function BatchLookupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const tab = resolveTab(TABS, sp, "smart");
  const c = await loadBatchConsole();
  const now = Date.now();
  const target = /^\d{4}-\d{2}-\d{2}$/.test(sp.target ?? "") ? (sp.target as string) : DEFAULT_TARGET_DATE;
  const vendorFilter = (sp.vendor ?? "").trim();

  const open = c.batches.filter((b) => ["submitting", "pending", "running", "succeeded", "ingesting"].includes(b.state));
  const openJobs = c.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const live = open.length > 0 || openJobs.length > 0;
  const planAll = planBatches(vendorFilter ? c.plan.filter((m) => m.vendor === vendorFilter) : c.plan);
  const left = batchesLeft(c.waiting.families);
  const waves = Math.ceil(left / Math.max(1, c.inflightCap));
  const etaAllMin = waves * (c.pace.turnaroundMin + 1);
  const costAll = c.waiting.families * c.pace.centsPerFamily;
  const days = daysUntil(target, now);
  const needPerDay = days > 0 ? Math.ceil(c.waiting.families / days) : c.waiting.families;
  const onTrack = c.pace.familiesPerDay >= needPerDay;
  const vendorLoads = new Map<string, VendorLoad>();
  for (const m of c.plan) {
    const v = vendorLoads.get(m.vendor) ?? { vendor: m.vendor, families: 0, lots: 0, manifests: 0 };
    v.families += m.families;
    v.lots += m.lots;
    v.manifests += 1;
    vendorLoads.set(m.vendor, v);
  }
  const perDayPlan = Math.max(needPerDay, Math.min(c.pace.familiesPerDay, needPerDay * 2));
  const schedule = scheduleVendors([...vendorLoads.values()], perDayPlan, now, c.pace.centsPerFamily);
  const queuedOpenItems = openJobs.reduce((s, j) => s + j.queued, 0);
  const inBatchItems = open.reduce((s, b) => s + Math.max(0, b.items - b.answered - b.failed), 0);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Batch Lookups"
        subtitle="Gemini Batch API product lookups: plan, send, watch and pay for them in one place."
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Onboarding", href: "/admin/inventory/drafts" }, { label: "Batch Lookups" }]} />}
      />
      <BatchLookupAutoRefresh active={live} />

      {sp.msg && <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)] px-3 py-2 text-sm text-[var(--admin-accent)]">{sp.msg}</p>}
      {sp.err && <p className="rounded-[var(--admin-radius-sm)] border border-red-500/60 px-3 py-2 text-sm text-red-300">{sp.err}</p>}
      {c.error && <p className="rounded-[var(--admin-radius-sm)] border border-amber-500/60 px-3 py-2 text-sm text-amber-300">{c.error}</p>}

      {/* Always-on status strip + master switch */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-3">
        <Badge tone={c.control.paused ? "danger" : c.engine === "batch" ? "green" : "gold"}>{c.control.paused ? "Paused" : c.engine === "batch" ? "Batch engine on" : "Live engine (batch off)"}</Badge>
        <span className="text-sm">
          {open.length} batch{open.length === 1 ? "" : "es"} at Gemini (cap {c.inflightCap}) · {n(inBatchItems)} lots inside · {n(queuedOpenItems)} lots queued · last activity {ago(c.lastTickAt, now)}
        </span>
        {c.control.paused && c.control.at && <span className="text-xs text-[var(--admin-text-muted)]">paused {ago(c.control.at, now)}{c.control.by ? ` by ${c.control.by}` : ""}{c.control.note ? `: ${c.control.note}` : ""}</span>}
        <form action={setPausedAction} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="paused" value={c.control.paused ? "0" : "1"} />
          {!c.control.paused && <input name="note" placeholder="Reason (optional)" className="w-40 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-sm" />}
          <button className={c.control.paused ? btnPrimary : btn}>{c.control.paused ? "\u25b6 Resume all" : "\u23f8 Pause all"}</button>
        </form>
      </div>
      {c.engine !== "batch" && <p className="text-sm text-amber-300">The Batch engine is off: set <code>AI_LOOKUP_ENGINE=batch</code> in Vercel and redeploy. Until then queued products run through the live (full price) lookup.</p>}

      <PageTabs base={BATCH_CONSOLE_PATH} tabs={TABS} active={tab} ariaLabel="Batch lookup views" />

      {tab === "smart" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Waiting lots" value={n(c.waiting.lots)} hint={`${c.waiting.manifests} manifests · ${c.waiting.vendors} vendors`} />
            <StatCard label="Unique products" value={n(c.waiting.families)} hint="lots + size variants share one question" accent="green" />
            <StatCard label="Batches of 200" value={n(left)} hint={`${waves} wave${waves === 1 ? "" : "s"} of ${c.inflightCap}`} />
            <StatCard label="Est. cost" value={fmtCents(costAll)} hint={c.pace.costMeasured ? `measured ${fmtCents(c.pace.centsPerFamily)}/product` : `estimate ${fmtCents(c.pace.centsPerFamily)}/product`} accent="gold" />
            <StatCard label="Est. time" value={fmtMinutes(etaAllMin)} hint={`${c.pace.measured ? "measured" : "assumed"} ${fmtMinutes(c.pace.turnaroundMin)} per wave`} />
            <StatCard label={`By ${target}`} value={onTrack ? "On track" : "Behind"} hint={`${days} days · need ${n(needPerDay)}/day · can ${n(c.pace.familiesPerDay)}/day`} accent={onTrack ? "green" : "orange"} />
          </div>

          <div className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-4">
            <h2 className="text-base font-bold">{"\ud83c\udf81"} Send the next wave</h2>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">Picks whole manifests (vendor by vendor) that fill the next {BATCH_WAVE} batches of {BATCH_MAX_FAMILIES} unique products and queues them. The engine sends {c.inflightCap} batches at once and the next one each time a batch comes back. Products already done or queued are skipped; products whose facts are all on file never reach Gemini.</p>
            <form action={sendWaveAction} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">Batches<br />
                <select name="batches" defaultValue={String(BATCH_WAVE)} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1">
                  {[1, 2, 4, 8, 12, 20, 40].map((x) => <option key={x} value={x}>{x} ({n(x * BATCH_MAX_FAMILIES)} products)</option>)}
                </select>
              </label>
              <label className="text-sm">Vendor<br />
                <select name="vendor" defaultValue={vendorFilter} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1">
                  <option value="">All vendors (alphabetical)</option>
                  {[...vendorLoads.values()].sort((a, b) => a.vendor.localeCompare(b.vendor)).map((v) => <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.families})</option>)}
                </select>
              </label>
              <button className={btnPrimary} disabled={c.waiting.families === 0}>Gift-wrap &amp; send</button>
            </form>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">The one-at-a-time, whole-manifest and all-by-vendor buttons on Product Onboarding still work the same way and feed the same queue.</p>
          </div>

          <form action={sendSelectedAction} className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] p-3">
              <h2 className="text-base font-bold">Proposed batches{vendorFilter ? ` · ${vendorFilter}` : ""}</h2>
              <span className="text-sm text-[var(--admin-text-muted)]">{planAll.length} batches · tick manifests to send just those</span>
              <span className="ml-auto flex gap-2">
                {vendorFilter && <Link className={btn} href={`${BATCH_CONSOLE_PATH}?tab=smart`}>All vendors</Link>}
                <button className={btn}>Send ticked</button>
              </span>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Batch</th><th className={th}></th><th className={th}>Vendor</th><th className={th}>Manifest</th><th className={th}>Products</th><th className={th}>Lots</th><th className={th}>Est. cost</th></tr></thead>
                <tbody>
                  {planAll.slice(0, 60).flatMap((b) =>
                    b.manifests.map((m, i) => (
                      <tr key={`${b.n}-${m.manifestId}`} className={i === 0 ? "border-t-2 border-[var(--admin-border)]" : ""}>
                        <td className={td}>{i === 0 ? <><b>#{b.n}</b> <span className="text-xs text-[var(--admin-text-muted)]">{b.families}/{BATCH_MAX_FAMILIES}{b.n <= BATCH_WAVE ? " · next wave" : ""}</span></> : null}</td>
                        <td className={td}><input type="checkbox" name="m" value={m.manifestId} aria-label={`Send ${m.label}`} /></td>
                        <td className={td}><Link href={`${BATCH_CONSOLE_PATH}?tab=smart&vendor=${encodeURIComponent(m.vendor)}`} className="underline-offset-2 hover:underline">{m.vendor}</Link></td>
                        <td className={td}><Link href={`/admin/inventory/drafts?manifest=${m.manifestId}`} className="underline-offset-2 hover:underline">{m.label}</Link></td>
                        <td className={td}>{m.families}</td>
                        <td className={td}>{m.lots}</td>
                        <td className={td}>{fmtCents(m.families * c.pace.centsPerFamily)}</td>
                      </tr>
                    )),
                  )}
                  {planAll.length === 0 && <tr><td className={td} colSpan={7}>Nothing waiting in Needs review. Start manifests on Receiving first.</td></tr>}
                </tbody>
              </table>
              {planAll.length > 60 && <p className="p-2 text-xs text-[var(--admin-text-muted)]">Showing the first 60 batches of {planAll.length}.</p>}
            </div>
          </form>
        </div>
      )}

      {tab === "monitor" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="At Gemini" value={`${open.length} / ${c.inflightCap}`} hint={`${n(inBatchItems)} lots inside`} accent={open.length ? "gold" : "muted"} />
            <StatCard label="Queued" value={n(queuedOpenItems)} hint={`${openJobs.length} open manifests`} />
            <StatCard label="Answered" value={n(c.totals.answered)} hint={`answer rate ${pct(c.pace.answerRate)}`} accent="green" />
            <StatCard label="Failed" value={n(c.failures.length)} hint={`${c.rateFailures} from rate limits`} accent={c.failures.length ? "orange" : "muted"} />
            <StatCard label="Searches" value={c.pace.searchHealth === "good" ? "Working" : c.pace.searchHealth === "unknown" ? "No data yet" : c.pace.searchHealth === "none" ? "NOT searching" : "Low"} hint={c.pace.searchesPerFamily === null ? "after the first batch" : `${c.pace.searchesPerFamily.toFixed(1)} per product`} accent={c.pace.searchHealth === "good" ? "green" : c.pace.searchHealth === "unknown" ? "muted" : "orange"} />
            <StatCard label="Turnaround" value={fmtMinutes(c.pace.turnaroundMin)} hint={c.pace.measured ? "median of finished batches" : "assumed until one finishes"} />
          </div>

          <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
            <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Gemini batches</h2>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>State</th><th className={th}>Sent</th><th className={th}>Elapsed</th><th className={th}>ETA</th><th className={th}>Products / lots</th><th className={th}>Answered</th><th className={th}>Failed</th><th className={th}>Searches</th><th className={th}>Tokens in / out</th><th className={th}>Cost</th><th className={th}></th></tr></thead>
                <tbody>
                  {c.batches.slice(0, 40).map((b) => {
                    const start = b.submitted_at ?? b.created_at;
                    const end = b.ingested_at ?? b.finished_at;
                    const eta = batchEtaMin(b, c.pace.turnaroundMin, now);
                    const isOpen = ["pending", "running"].includes(b.state);
                    const prog = b.items ? Math.round(((b.answered + b.failed) / b.items) * 100) : 0;
                    return (
                      <tr key={b.id} className="border-t border-[var(--admin-border)]">
                        <td className={td}><Badge tone={STATE_TONE[b.state] ?? "neutral"}>{b.state}</Badge>{b.state === "ingesting" && <div className="mt-1 h-1.5 w-20 rounded bg-white/10"><div className="h-1.5 rounded bg-[var(--admin-accent)]" style={{ width: `${prog}%` }} /></div>}</td>
                        <td className={td} title={b.name ?? ""}>{new Date(start).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                        <td className={td}>{fmtMinutes(((end ? Date.parse(end) : now) - Date.parse(start)) / 60_000)}</td>
                        <td className={td}>{eta === null ? "-" : `~${fmtMinutes(eta)}`}</td>
                        <td className={td}>{b.families} / {b.items}</td>
                        <td className={td}>{b.answered}</td>
                        <td className={td}>{b.failed}</td>
                        <td className={td}>{b.state === "ingested" ? n(b.search_queries) : "-"}</td>
                        <td className={td}>{b.state === "ingested" ? `${n(b.prompt_tokens)} / ${n(b.output_tokens)}` : "-"}</td>
                        <td className={td}>{b.state === "ingested" ? fmtCents(Number(b.cost_cents)) : "-"}</td>
                        <td className={td}>
                          {isOpen && b.name && (
                            <form action={cancelBatchAction}><input type="hidden" name="name" value={b.name} /><button className={btn} title="Stop this batch at Gemini; its products go back in the queue">Cancel</button></form>
                          )}
                          {b.error && <span className="text-xs text-red-300">{b.error.slice(0, 80)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {c.batches.length === 0 && <tr><td className={td} colSpan={11}>No batches yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
            <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Manifests in the queue</h2>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Vendor</th><th className={th}>Manifest</th><th className={th}>Progress</th><th className={th}>Queued</th><th className={th}>In batch</th><th className={th}>Done</th><th className={th}>Failed</th><th className={th}>Age</th><th className={th}></th></tr></thead>
                <tbody>
                  {openJobs.map((j) => {
                    const p = j.total ? Math.round(((j.done + j.failed + j.canceled) / j.total) * 100) : 0;
                    return (
                      <tr key={j.id} className="border-t border-[var(--admin-border)]">
                        <td className={td}>{j.vendor}</td>
                        <td className={td}><Link href={`/admin/inventory/drafts?manifest=${j.manifestId}`} className="hover:underline">{j.label}</Link>{j.paused && <> <Badge tone="danger">on hold</Badge></>}</td>
                        <td className={td}><div className="h-2 w-28 rounded bg-white/10"><div className="h-2 rounded bg-[var(--admin-accent)]" style={{ width: `${p}%` }} /></div><span className="text-xs">{p}% of {j.total}</span></td>
                        <td className={td}>{j.queued}</td>
                        <td className={td}>{j.running}</td>
                        <td className={td}>{j.done}</td>
                        <td className={td}>{j.failed}</td>
                        <td className={td}>{ago(j.createdAt, now)}</td>
                        <td className={`${td} flex gap-1`}>
                          <form action={setJobPausedAction}><input type="hidden" name="jobId" value={j.id} /><input type="hidden" name="paused" value={j.paused ? "0" : "1"} /><button className={btn}>{j.paused ? "Resume" : "Hold"}</button></form>
                          <form action={cancelJobAction}><input type="hidden" name="jobId" value={j.id} /><button className={btn} title="Cancel the products still queued">Stop</button></form>
                        </td>
                      </tr>
                    );
                  })}
                  {openJobs.length === 0 && <tr><td className={td} colSpan={9}>Nothing queued. Send a wave from Smart batching.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--admin-border)] p-3">
                <h2 className="text-base font-bold">Failed products ({c.failures.length})</h2>
                <form action={rerunFailedAction} className="ml-auto"><input type="hidden" name="scope" value="rate" /><button className={btn} disabled={c.rateFailures === 0}>Re-run {c.rateFailures} rate-limit failures</button></form>
                <form action={rerunFailedAction}><input type="hidden" name="scope" value="all" /><button className={btn} disabled={c.failures.length === 0}>Re-run all</button></form>
              </div>
              <div className="max-h-[24rem] overflow-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {c.failures.slice(0, 100).map((f) => (
                      <tr key={f.itemId} className="border-t border-[var(--admin-border)]">
                        <td className={td}>{f.vendor}<div className="text-xs text-[var(--admin-text-muted)]">{f.label} · {ago(f.at, now)}</div></td>
                        <td className={td}>{f.rateLimited && <Badge tone="gold">429</Badge>} <span className="text-xs">{f.error.slice(0, 140)}</span></td>
                        <td className={td}><form action={rerunFailedAction}><input type="hidden" name="itemId" value={f.itemId} /><button className={btn}>Re-run</button></form></td>
                      </tr>
                    ))}
                    {c.failures.length === 0 && <tr><td className={td}>No failures.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
              <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Live activity</h2>
              <ul className="max-h-[24rem] divide-y divide-[var(--admin-border)] overflow-auto text-sm">
                {c.activity.map((a, i) => (
                  <li key={i} className="flex gap-2 px-3 py-1.5">
                    <span className="w-24 shrink-0 text-xs text-[var(--admin-text-muted)]">{ago(a.at, now)}</span>
                    <span>{a.kind === "done" ? "\u2705" : a.kind === "failed" ? "\u274c" : a.kind === "canceled" ? "\u23f9" : "\ud83d\udce6"}</span>
                    <span>{a.text}</span>
                  </li>
                ))}
                {c.activity.length === 0 && <li className="px-3 py-2">No activity yet.</li>}
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === "confidence" && <ConfidenceTab vendor={vendorFilter} view={sp.view ?? ""} />}

      {tab === "costs" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Batch spend" value={fmtCents(c.totals.cents)} hint={`${c.totals.batches} batches`} accent="gold" />
            <StatCard label="Per product" value={fmtCents(c.pace.centsPerFamily)} hint={c.pace.costMeasured ? "measured" : "estimate"} />
            <StatCard label="Searches" value={n(c.totals.searches)} hint={fmtCents((c.totals.searches / 1000) * BATCH_PRICE.searchPerK * 100)} />
            <StatCard label="Tokens in" value={n(c.totals.promptTokens)} hint={fmtCents((c.totals.promptTokens / 1e6) * BATCH_PRICE.inputPerM * 100)} />
            <StatCard label="Tokens out" value={n(c.totals.outputTokens)} hint={fmtCents((c.totals.outputTokens / 1e6) * BATCH_PRICE.outputPerM * 100)} />
            <StatCard label="Live lookups (30 d)" value={n(c.liveUsage30d.calls)} hint={`${n(c.liveUsage30d.tokens)} tokens at full price`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
              <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Cost ledger by vendor</h2>
              <p className="px-3 pt-2 text-xs text-[var(--admin-text-muted)]">Exact = priced from Google&apos;s own token and search counts for each product (Batch prices). "est." = live lookups or older rows, priced at the average per product.</p>
              <div className="max-h-[26rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Vendor</th><th className={th}>Lots</th><th className={th}>Paid questions</th><th className={th}>Answered</th><th className={th}>Failed</th><th className={th}>Cost</th></tr></thead>
                  <tbody>
                    {c.ledgerVendor.map((r) => (
                      <tr key={r.key} className="border-t border-[var(--admin-border)]"><td className={td}>{r.label}</td><td className={td}>{r.items}</td><td className={td}>{r.families}</td><td className={td}>{r.answered}</td><td className={td}>{r.failed}</td><td className={td}>{fmtCents(r.cents)}{ledgerBasis(r) !== "exact" && <span className="ml-1 text-xs text-[var(--admin-text-muted)]">{ledgerBasis(r) === "mixed" ? "part est." : "est."}</span>}</td></tr>
                    ))}
                    {c.ledgerVendor.length === 0 && <tr><td className={td} colSpan={6}>No lookups yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
              <h2 className="border-b border-[var(--admin-border)] p-3 text-base font-bold">Cost ledger by manifest</h2>
              <div className="max-h-[26rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Manifest</th><th className={th}>Lots</th><th className={th}>Paid questions</th><th className={th}>Answered</th><th className={th}>Cost</th></tr></thead>
                  <tbody>
                    {c.ledgerJob.map((r) => (
                      <tr key={r.key} className="border-t border-[var(--admin-border)]"><td className={td}>{r.label}</td><td className={td}>{r.items}</td><td className={td}>{r.families}</td><td className={td}>{r.answered}</td><td className={td}>{fmtCents(r.cents)}{ledgerBasis(r) !== "exact" && <span className="ml-1 text-xs text-[var(--admin-text-muted)]">{ledgerBasis(r) === "mixed" ? "part est." : "est."}</span>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] p-3">
              <h2 className="text-base font-bold">Vendor schedule to {target}</h2>
              <span className="text-sm text-[var(--admin-text-muted)]">{n(c.waiting.families)} products over {days} days · ~{n(perDayPlan)}/day · {fmtCents(costAll)} total</span>
              <form className="ml-auto flex gap-2" action={BATCH_CONSOLE_PATH}>
                <input type="hidden" name="tab" value="costs" />
                <input type="date" name="target" defaultValue={target} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-sm" />
                <button className={btn}>Re-plan</button>
              </form>
            </div>
            <div className="max-h-[26rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--admin-surface)]"><tr><th className={th}>Send on</th><th className={th}>Vendor</th><th className={th}>Manifests</th><th className={th}>Products</th><th className={th}>Lots</th><th className={th}>Est. cost</th><th className={th}></th></tr></thead>
                <tbody>
                  {schedule.map((s) => (
                    <tr key={s.vendor} className="border-t border-[var(--admin-border)]">
                      <td className={td}>{s.date}</td><td className={td}>{s.vendor}</td><td className={td}>{s.manifests}</td><td className={td}>{s.families}</td><td className={td}>{s.lots}</td><td className={td}>{fmtCents(s.cents)}</td>
                      <td className={td}><Link className={btn} href={`${BATCH_CONSOLE_PATH}?tab=smart&vendor=${encodeURIComponent(s.vendor)}`}>Plan</Link></td>
                    </tr>
                  ))}
                  {schedule.length === 0 && <tr><td className={td} colSpan={7}>Nothing waiting.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[var(--admin-radius-md,8px)] border border-[var(--admin-border)] p-3 text-sm">
            <h2 className="mb-2 text-base font-bold">Engine settings &amp; health</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              <div><dt className="inline font-semibold">Engine:</dt> <dd className="inline">{c.engine} (<code>AI_LOOKUP_ENGINE</code>)</dd></div>
              <div><dt className="inline font-semibold">Batches at once:</dt> <dd className="inline">{c.inflightCap} (<code>AI_BATCH_MAX_INFLIGHT</code>)</dd></div>
              <div><dt className="inline font-semibold">Products per batch:</dt> <dd className="inline">{BATCH_MAX_FAMILIES}</dd></div>
              <div><dt className="inline font-semibold">Thinking:</dt> <dd className="inline">{c.thinking} (<code>AI_BATCH_THINKING_LEVEL</code>)</dd></div>
              <div><dt className="inline font-semibold">Gemini key:</dt> <dd className="inline">{c.keySet ? "set" : "MISSING"}</dd></div>
              <div><dt className="inline font-semibold">Polling:</dt> <dd className="inline">every minute (cron), last activity {ago(c.lastTickAt, now)}</dd></div>
              <div><dt className="inline font-semibold">Prices (Batch):</dt> <dd className="inline">${BATCH_PRICE.inputPerM}/M in · ${BATCH_PRICE.outputPerM}/M out · ${BATCH_PRICE.searchPerK}/1k searches (double from Jan 1 2027)</dd></div>
              <div><dt className="inline font-semibold">Spend limit:</dt> <dd className="inline">Tier 2, set in the Gemini console</dd></div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
