/**
 * src/app/admin/compliance/ccrs/records/page.tsx - R74 S40 (owner, Round 20).
 *
 * CCRS RECORDS: upload a data copy received from the LCB Service Desk
 * (Inventory / Product / Strain / Area) and see, side by side, what the State
 * holds against what we hold:
 *
 *   Our lots     live inventory vs the copy (quantity drift, E52 lots CCRS
 *                does not hold, Cultivera ghosts open only in CCRS, ...)
 *   Ledger       the S-15 merge plan (what a merge writes; what to review)
 *   Our filings  the S-16 check that what we sent landed as sent
 *
 * Then merge the copy into the ledger with one guarded button (replaces the
 * S-15 command line), download every finding as CSV, and keep a history of
 * every copy for periodic comparisons.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { pacificToday } from "@/lib/reports/timezone";
import { getCopy, listCopies, type CopyRow } from "@/lib/compliance/ccrs-records-store";
import { BUCKET_MEANING } from "@/lib/compliance/ccrs-copy-verify-core";
import { LOT_BUCKET_META, PLAN_BUCKET_META, bucketMeta, type CompareArea, type CompareSummary } from "@/lib/compliance/ccrs-records-compare-core";
import { CcrsCopyUploader } from "@/components/admin/compliance/CcrsCopyUploader";
import { CcrsCopyActions } from "@/components/admin/compliance/CcrsCopyActions";
import { CcrsFindingsExplorer } from "@/components/admin/compliance/CcrsFindingsExplorer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function Section({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-white/45">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  uploading: "bg-sky-400/15 text-sky-200",
  ready: "bg-emerald-400/15 text-emerald-200",
  failed: "bg-red-500/15 text-red-200",
  applied: "bg-violet-400/15 text-violet-200",
  discarded: "bg-white/10 text-white/40",
};
const STATUS_LABEL: Record<string, string> = { uploading: "Uploading", ready: "Compared", failed: "Failed", applied: "Merged", discarded: "Discarded" };

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString();
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) : "—");

function Gauge({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const tone = score === null ? "#6b7280" : pct >= 95 ? "#34d399" : pct >= 80 ? "#fbbf24" : "#f87171";
  const deg = Math.round((pct / 100) * 360);
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0 rounded-full" style={{ background: `conic-gradient(${tone} ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)` }}>
        <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full bg-[#0b0f0d]">
          <span className="text-xl font-black text-white">{score === null ? "—" : `${score}%`}</span>
          <span className="text-[9px] uppercase tracking-wider text-white/40">in sync</span>
        </div>
      </div>
      <p className="text-xs text-white/55">
        Share of our stocked lots that CCRS holds with exactly the same quantity on hand. Sales after the copy date lower it a little; the findings below
        say where the rest of the gap is.
      </p>
    </div>
  );
}

function BucketBars({ area, rows, href }: { area: CompareArea; rows: { key: string; count: number; problem: boolean }[]; href: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const meta = bucketMeta(area, r.key, BUCKET_MEANING as Record<string, string>);
        return (
          <Link key={r.key} href={href(r.key)} title={meta.meaning} className="group block">
            <div className="flex items-center justify-between text-xs">
              <span className={`${r.problem && r.count > 0 ? "text-amber-100" : "text-white/65"} group-hover:underline`}>{meta.label}</span>
              <span className="font-mono text-white/80">{n(r.count)}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-white/[0.06]">
              <div className={`h-full ${r.problem && r.count > 0 ? "bg-amber-400/80" : "bg-emerald-400/60"}`} style={{ width: `${Math.max(r.count > 0 ? 2 : 0, (r.count / max) * 100)}%` }} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function PartError({ error }: { error: string | null }) {
  return error ? <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-100">Could not run: {error}</div> : null;
}

function CopyDashboard({ copy, canEdit }: { copy: CopyRow; canEdit: boolean }) {
  const s = copy.summary as CompareSummary | null;
  const link = (k: string) => `/admin/compliance/ccrs/records?copy=${copy.id}&finding=${encodeURIComponent(k)}#findings`;
  const lc = s?.lots.counts;
  const pc = s?.ledger.counts;
  const vt = s?.filings.total;
  return (
    <div className="space-y-5">
      <Section
        title={`Copy current through ${copy.as_of}`}
        subtitle={`Uploaded ${when(copy.created_at)}${copy.uploaded_by_email ? ` by ${copy.uploaded_by_email}` : ""} · compared ${when(copy.compared_at)}${copy.notes ? ` · ${copy.notes}` : ""}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${STATUS_TONE[copy.status]}`}>{STATUS_LABEL[copy.status]}</span>
            {s ? (
              <>
                <a href={`/admin/compliance/ccrs/records/${copy.id}/export?problems=1`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5">⬇ Needs-action CSV</a>
                <a href={`/admin/compliance/ccrs/records/${copy.id}/export`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5">⬇ Full CSV</a>
              </>
            ) : null}
          </div>
        }
      >
        {copy.error ? <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{copy.error}</div> : null}
        {copy.status === "applied" && copy.apply_result ? (
          <div className="mb-4 rounded-xl border border-violet-400/30 bg-violet-400/5 px-3 py-2 text-xs text-violet-100">
            Merged {when(copy.applied_at)}{copy.applied_by_email ? ` by ${copy.applied_by_email}` : ""}: {n(copy.apply_result.added)} added, {n(copy.apply_result.updated)} updated
            {copy.apply_result.source ? <> (source <code>{copy.apply_result.source}</code>)</> : null}.
          </div>
        ) : null}
        {s ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
              <Gauge score={s.syncScore} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Needs action" value={n(s.problems)} accent={s.problems > 0 ? "orange" : "green"} hint="findings across all three checks" />
                <StatCard label="CCRS lots" value={n(s.copy.entities.Inventory)} hint={`${n(s.copy.inventoryOpen)} open · ${n(s.copy.inventoryClosed)} closed`} />
                <StatCard label="Our lots" value={n(s.lots.liveLots)} hint="every lot we hold a record of" />
                <StatCard label="Products / strains / areas" value={`${n(s.copy.entities.Product)} / ${n(s.copy.entities.Strain)} / ${n(s.copy.entities.Area)}`} hint="in the copy" />
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-[11px] text-white/45 sm:grid-cols-4">
              {copy.files.map((f) => (
                <div key={f.source} className="rounded-lg border border-white/10 px-3 py-2">
                  <div className="font-bold text-white/70">{f.source}.csv</div>
                  <div>{n(f.rows)} rows · {(f.bytes / 1048576).toFixed(1)} MB</div>
                  <div className="truncate font-mono" title={f.sha256}>sha256 {f.sha256.slice(0, 16)}…</div>
                </div>
              ))}
            </div>
          </>
        ) : copy.status === "uploading" ? (
          <p className="text-xs text-white/55">The upload did not finish comparing. Use “Compare again” below once all four files are uploaded, or discard it.</p>
        ) : null}
      </Section>

      {s ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Section title="Our lots vs CCRS" subtitle="Live inventory against the copy's Inventory, by the id each lot is filed under.">
            <PartError error={s.lots.error} />
            {lc ? (
              <BucketBars area="lots" href={(k) => link(`lots:${k}`)} rows={(Object.keys(LOT_BUCKET_META) as (keyof typeof LOT_BUCKET_META)[]).map((k) => ({ key: k, count: lc[k], problem: LOT_BUCKET_META[k].problem }))} />
            ) : null}
          </Section>
          <Section title="Ledger merge plan" subtitle="Our record of what CCRS holds (the ledger) against the copy.">
            <PartError error={s.ledger.error} />
            {pc ? (
              <>
                <BucketBars
                  area="ledger"
                  href={(k) => link(`ledger:${k}`)}
                  rows={[
                    ...(["add", "refresh", "settleLink", "settleUncertain"] as const).map((k) => ({ key: k, count: pc[k], problem: false })),
                    ...(Object.keys(pc.review) as (keyof typeof pc.review)[]).map((k) => ({ key: k, count: pc.review[k], problem: PLAN_BUCKET_META[k]?.problem ?? true })),
                  ]}
                />
                <p className="mt-3 text-[11px] text-white/40">{n(pc.unchanged)} already the same · {n(pc.linkStillUnfiled)} migration lots still not on the record.</p>
              </>
            ) : null}
          </Section>
          <Section title="Our filings vs CCRS" subtitle="Did each record we sent land the way we sent it?">
            <PartError error={s.filings.error} />
            {vt ? (
              <>
                <BucketBars area="filings" href={(k) => link(`filings:${k}`)} rows={Object.entries(vt).map(([k, v]) => ({ key: k, count: v, problem: ["mismatched", "zeroedNotZero", "missing", "deletedPresent"].includes(k) }))} />
                <p className="mt-3 text-[11px] text-white/40">{n(s.filings.sentRecords)} records sent by us were checked.</p>
              </>
            ) : null}
          </Section>
        </div>
      ) : null}

      {canEdit && copy.status !== "applied" && copy.status !== "discarded" ? (
        <Section title="Act on this copy" subtitle="Merging teaches our ledger what CCRS holds, so the weekly upload sends Updates (not duplicate Inserts) and releases held-back Cultivera lots.">
          <CcrsCopyActions
            id={copy.id}
            status={copy.status}
            canMerge={!!pc}
            add={pc?.add ?? 0}
            upd={(pc?.refresh ?? 0) + (pc?.settleLink ?? 0) + (pc?.settleUncertain ?? 0)}
            seedMissing={pc?.review.seedMissing ?? 0}
            linkStillUnfiled={pc?.linkStillUnfiled ?? 0}
          />
        </Section>
      ) : null}
    </div>
  );
}

export default async function CcrsRecordsPage({ searchParams }: { searchParams: Promise<{ copy?: string; finding?: string }> }) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;
  const list = isSupabaseServiceConfigured ? await listCopies() : { available: false, rows: [], error: null };
  const pickId = sp.copy ?? list.rows.find((r) => r.status !== "discarded")?.id;
  const copy = pickId && list.available ? await getCopy(pickId) : null;
  const latestApplied = list.rows.find((r) => r.status === "applied");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/compliance/ccrs" className="text-[11px] font-semibold text-white/40 hover:text-white/70">← CCRS Command Center</Link>
          <h1 className="text-lg font-black tracking-tight text-white">🗂️ CCRS Records: State copy vs our records</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Upload the data copy the LCB Service Desk sends you, see exactly where CCRS and Greenway disagree, and merge it into our ledger.
            Use it for the Cultivera clean-up and then periodically to stay in sync with the State.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-xl border border-white/10 px-3 py-2"><div className="font-black text-white">{n(list.rows.filter((r) => r.status !== "discarded").length)}</div><div className="text-white/40">copies</div></div>
          <div className="rounded-xl border border-white/10 px-3 py-2"><div className="font-black text-white">{latestApplied?.as_of ?? "—"}</div><div className="text-white/40">last merged</div></div>
          <div className="rounded-xl border border-white/10 px-3 py-2"><div className="font-black text-white">{list.rows[0]?.as_of ?? "—"}</div><div className="text-white/40">latest copy</div></div>
        </div>
      </div>

      {!list.available ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs text-amber-100">
          {list.error ? `Couldn't read the copies: ${list.error}` : "Apply migration 0298_ccrs_record_copies.sql to turn this page on."}
        </div>
      ) : null}

      {canEdit && list.available ? (
        <Section title="Upload a new CCRS copy" subtitle="Ask the LCB Service Desk for a full data copy for your license. You get four CSVs: Inventory, Product, Strain and Area. Nothing changes until you press Merge.">
          <CcrsCopyUploader defaultAsOf={pacificToday()} />
        </Section>
      ) : null}

      {copy ? <CopyDashboard copy={copy} canEdit={canEdit} /> : null}

      {copy?.summary ? (
        <Section
          title="Every finding"
          subtitle={Object.keys(copy.summary.truncated).length ? `Large buckets are capped at 5,000 rows on the page; the counts above are complete.` : "Filter, search and page through everything the comparison found."}
        >
          <div id="findings" />
          <CcrsFindingsExplorer items={copy.summary.items} verifyMeaning={BUCKET_MEANING as Record<string, string>} initialBucket={sp.finding} />
        </Section>
      ) : null}

      {list.rows.length ? (
        <Section title="History" subtitle="Every copy uploaded, newest first. Compare a newer copy against an older one by its sync score and needs-action count.">
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/45">
                <tr><th className="px-3 py-2">As of</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">In sync</th><th className="px-3 py-2">Needs action</th><th className="px-3 py-2">Uploaded</th><th className="px-3 py-2">Merged</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {list.rows.map((r) => (
                  <tr key={r.id} className={r.id === copy?.id ? "bg-emerald-400/[0.05]" : "hover:bg-white/[0.03]"}>
                    <td className="px-3 py-2 font-bold text-white/85">{r.as_of}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="px-3 py-2 text-white/70">{r.score === null || r.score === undefined ? "—" : `${r.score}%`}</td>
                    <td className="px-3 py-2 text-white/70">{r.problems === null || r.problems === undefined ? "—" : n(r.problems)}</td>
                    <td className="px-3 py-2 text-white/50">{when(r.created_at)}{r.uploaded_by_email ? ` · ${r.uploaded_by_email}` : ""}</td>
                    <td className="px-3 py-2 text-white/50">{r.applied_at ? `${when(r.applied_at)} · +${n(r.apply_result?.added)} / ${n(r.apply_result?.updated)}` : "—"}</td>
                    <td className="px-3 py-2 text-right"><Link href={`/admin/compliance/ccrs/records?copy=${r.id}`} className="font-semibold text-emerald-300 hover:underline">Open →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="How it works">
        <div className="grid gap-3 text-xs text-white/55 md:grid-cols-3">
          <p><b className="text-white/80">1. Request.</b> Email the LCB Service Desk for a full CCRS data copy for your license. Note the date it is current through.</p>
          <p><b className="text-white/80">2. Upload &amp; compare.</b> Drop the four CSVs here. Files go straight to private storage. Nothing in our records changes. Every finding links to the rows behind it and downloads as CSV.</p>
          <p><b className="text-white/80">3. Merge &amp; fix.</b> Merge to teach our ledger what CCRS holds. This releases held-back Cultivera lots. Then work the needs-action list: adjustments, id corrections, and questions for the examiner.</p>
        </div>
      </Section>
    </div>
  );
}
