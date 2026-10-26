import type React from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { CountAuditStatsPanel } from "@/components/admin/CountAuditStatsPanel";
import { loadRoster, practiceListFor, practiceReport, rosterLotList, isRosterId, type PracticeReport } from "@/lib/pos/count-roster-store";
import { SHEET_STATUS_COPY, mailtoFor, rosterTally, sheetStatus, type RosterSheet, type SheetStatus } from "@/lib/pos/count-roster-core";
import {
  addSheetAction,
  archiveRosterAction,
  combineRosterAction,
  markSentAction,
  runPracticeAction,
  updateSheetAction,
  uploadRosterAction,
  voidSheetAction,
} from "./actions";

/**
 * R74 S50 — one count roster: the pre-numbered workbooks, who has each one, and whether each came
 * back. Owner flow: make the roster → assign a person (and their computer: Windows or Mac) to each
 * sheet → download → email it to them → they count and email it back → upload here (matched by the
 * hidden workbook id, not the file name) → the tracker shows exactly who is still missing.
 * A practice roster runs the same pipeline on a handful of real lots and ends in a dry-run check
 * with green marks; it never writes inventory.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ImportRow = { id: string; created_at: string; status: string; is_test: boolean | null };

const STATUS_STYLE: Record<SheetStatus, string> = {
  unassigned: "bg-white/10 text-white/60",
  assigned: "bg-sky-500/15 text-sky-300",
  downloaded: "bg-indigo-500/15 text-indigo-300",
  sent: "bg-amber-500/15 text-amber-300",
  received: "bg-emerald-500/20 text-emerald-300",
  void: "bg-red-500/10 text-red-300/70 line-through",
};

const STEPS: SheetStatus[] = ["assigned", "downloaded", "sent", "received"];

/** A plain <a> (never next/link): a prefetch of a download route would build a file and log a download. */
function DL({ href, children, tone = "neutral" }: { href: string; children: React.ReactNode; tone?: "primary" | "neutral" | "special" }) {
  const c =
    tone === "primary"
      ? "bg-[var(--admin-orange)] text-black hover:brightness-110"
      : tone === "special"
        ? "bg-[var(--admin-purple)] text-black hover:brightness-110"
        : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)] ring-1 ring-[var(--admin-orange)]/40 hover:bg-[var(--admin-orange)] hover:text-black";
  return (
    <a href={href} download className={`admin-focus inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.08em] transition ${c}`}>
      {children}
    </a>
  );
}

function Steps({ s }: { s: RosterSheet }) {
  const st = sheetStatus(s);
  const reached = (k: SheetStatus) =>
    k === "assigned" ? !!s.assignee : k === "downloaded" ? s.downloads.length > 0 || !!s.sentAt || !!s.received : k === "sent" ? !!s.sentAt || !!s.received : !!s.received;
  if (st === "void") return <span className="text-[11px] text-red-300/70">Void: {s.voidReason}</span>;
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((k) => (
        <span key={k} title={SHEET_STATUS_COPY[k]} className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${reached(k) ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-white/30"}`}>
          {reached(k) ? "✓ " : ""}{SHEET_STATUS_COPY[k]}
        </span>
      ))}
    </div>
  );
}

function Progress({ label, done, total, tone = "emerald" }: { label: string; done: number; total: number; tone?: "emerald" | "sky" | "amber" | "indigo" }) {
  const p = total ? Math.round((done / total) * 100) : 0;
  const c = { emerald: "bg-emerald-500", sky: "bg-sky-500", amber: "bg-amber-400", indigo: "bg-indigo-500" }[tone];
  return (
    <div>
      <div className="flex justify-between text-xs text-white/60"><span>{label}</span><span className={done === total && total > 0 ? "font-bold text-emerald-300" : ""}>{done === total && total > 0 ? "✓ " : ""}{done} / {total}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-2 ${c}`} style={{ width: `${p}%` }} /></div>
    </div>
  );
}

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ id?: string; error?: string; notice?: string }> }) {
  const session = await requirePermission("menu.import");
  const sp = await searchParams;
  const id = sp.id && isRosterId(sp.id) ? sp.id : "";
  const admin = isSupabaseServiceConfigured ? createSupabaseAdminClient() : null;
  const r = admin && id ? await loadRoster(admin, id) : null;
  const crumbs = <Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Oct 30 count", href: "/admin/menu-imports/count" }, { label: "Roster" }]} />;
  if (!r) {
    return (
      <div>
        <AdminPageHeader title="Count roster" subtitle="Not found." breadcrumbs={crumbs} />
        <div className="px-5 py-6 text-sm text-white/60 sm:px-8">That roster was not found. <Link href="/admin/menu-imports/count#roster" className="underline">Back to the count page</Link></div>
      </div>
    );
  }
  const t = rosterTally(r);
  const practice = r.mode === "test";
  const base = `/admin/menu-imports/count/roster`;

  let imports: ImportRow[] = [];
  if (!practice && admin) {
    const { data } = await admin.from("pos_imports").select("id, created_at, status, is_test").order("created_at", { ascending: false }).limit(10);
    imports = ((data as ImportRow[] | null) ?? []).filter((x) => !x.is_test);
  }
  let report: PracticeReport | null = null;
  let reportError: string | null = null;
  let practiceLists: Record<number, { code: string; productName: string }[]> = {};
  if (practice && admin) {
    try {
      const lots = await rosterLotList(admin, r);
      practiceLists = Object.fromEntries(r.sheets.map((s) => [s.number, practiceListFor(s, lots.importLots ?? [])]));
      if (t.received > 0) report = await practiceReport(admin, r);
    } catch (e) {
      reportError = e instanceof Error ? e.message : String(e);
    }
  }
  const replyTo = session.email ?? "";

  return (
    <div>
      <AdminPageHeader
        title={practice ? `Practice: ${r.title}` : r.title}
        subtitle={practice ? "A small-scale run of the whole count pipeline on real lots. It never changes inventory." : `Count date ${r.countDate}. Every workbook, who has it, and whether it came back.`}
        breadcrumbs={crumbs}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{sp.error}</div>}
        {sp.notice && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{sp.notice}</div>}
        {practice && (
          <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-xs text-violet-200">
            PRACTICE ROSTER · {r.source.kind === "import" ? `${r.source.sampleCodes.length} real lots from import ${r.source.importId.slice(0, 8)}` : ""} · its workbooks say PRACTICE on every page, are refused by any live roster, and its check runs in memory only.
          </div>
        )}
        {r.archived && <div className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-xs text-white/60">This roster is archived (read-only downloads are off).</div>}

        {/* ---------------- tracker ---------------- */}
        <section id="tracker" className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="roster-tracker">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Tracker</h2>
            {t.allIn ? (
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">✓ All {t.active} sheets are in</span>
            ) : (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">{t.outstanding.length} of {t.active} still out</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-6">
            {[
              ["Sheets", t.total, "text-white"],
              ["Active", t.active, "text-white"],
              ["Assigned", t.assigned, "text-sky-300"],
              ["Out (downloaded)", t.downloaded, "text-indigo-300"],
              ["Uploaded", t.received, "text-emerald-300"],
              ["Void", t.void, "text-red-300/80"],
            ].map(([l, v, c]) => (
              <div key={String(l)} className="rounded-lg border border-white/10 bg-black/40 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{l}</p>
                <p className={`text-xl font-bold ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Progress label="Assigned to a person" done={t.assigned} total={t.active} tone="sky" />
            <Progress label="Downloaded / sent out" done={t.downloaded} total={t.active} tone="indigo" />
            <Progress label="Marked as emailed" done={t.sent} total={t.active} tone="amber" />
            <Progress label="Emailed back and uploaded" done={t.received} total={t.active} />
          </div>
          {t.outstanding.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <span className="font-semibold">Still missing:</span> {t.outstanding.map((o) => `#${o.number} ${o.assignee || "(unassigned)"}${o.zone ? ` (${o.zone})` : ""} — ${SHEET_STATUS_COPY[o.status].toLowerCase()}`).join(" · ")}
            </div>
          )}
          {t.needsFix.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-200">
              <span className="font-semibold">Uploaded but needs a fix:</span> {t.needsFix.map((o) => `#${o.number} ${o.assignee} (${o.blocking} blocking problem${o.blocking === 1 ? "" : "s"})`).join(" · ")}. Ask them to correct it and send it again; the new file replaces the old one.
            </div>
          )}
          <p className="text-xs text-white/40">{t.scans.toLocaleString("en-US")} scans and {t.handUnits.toLocaleString("en-US")} hand-counted units received so far.</p>
        </section>

        {/* ---------------- sheets ---------------- */}
        <section className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="roster-sheets">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Sheets: assign, download, email</h2>
            {!r.archived && (
              <div className="flex flex-wrap gap-2">
                <DL href={`${base}/zip?roster=${r.rosterId}&platform=assigned`}>Download all (each person&apos;s computer) .zip</DL>
                <DL href={`${base}/zip?roster=${r.rosterId}&platform=windows`}>All for Windows .zip</DL>
                <DL href={`${base}/zip?roster=${r.rosterId}&platform=mac`}>All for Mac .zip</DL>
              </div>
            )}
          </div>
          <p className="text-xs text-white/50">
            Pick the computer each person will count on. <b className="text-white/70">Windows</b> = the Excel desktop app (click Enable Editing on the yellow bar).{" "}
            <b className="text-white/70">Mac</b> = Microsoft Excel for Mac, never Numbers (Numbers drops the hidden sheet and the upload refuses the file). Both versions of a sheet carry the
            same id, so whichever one comes back checks off the same line, and two copies of one sheet are refused.
          </p>
          <div className="space-y-3">
            {r.sheets.map((s) => {
              const st = sheetStatus(s);
              const last = s.downloads[s.downloads.length - 1];
              return (
                <div key={s.workbookId} id={`sheet-${s.number}`} className={`rounded-lg border p-3 ${st === "received" ? "border-emerald-500/30 bg-emerald-500/5" : st === "void" ? "border-white/5 bg-black/20 opacity-70" : "border-white/10 bg-black/30"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-white">#{s.number}</span>
                      <span className="text-sm font-semibold text-white">{s.assignee || <span className="text-white/40">Not assigned</span>}</span>
                      {s.zone && <span className="text-xs text-white/50">· {s.zone}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[st]}`}>{SHEET_STATUS_COPY[st]}</span>
                    </div>
                    <Steps s={s} />
                  </div>
                  {st !== "void" && !r.archived && (
                    <form action={updateSheetAction} className="mt-2 flex flex-wrap items-end gap-2 text-xs text-white/70">
                      <input type="hidden" name="roster_id" value={r.rosterId} />
                      <input type="hidden" name="sheet" value={s.number} />
                      <label className="flex flex-col gap-0.5"><span className="text-white/40">Person</span><input name="assignee" defaultValue={s.assignee} maxLength={60} className="w-40 rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
                      <label className="flex flex-col gap-0.5"><span className="text-white/40">Area</span><input name="zone" defaultValue={s.zone} maxLength={80} className="w-48 rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
                      <label className="flex flex-col gap-0.5"><span className="text-white/40">Email (optional)</span><input name="email" type="email" defaultValue={s.email} className="w-48 rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
                      <label className="flex flex-col gap-0.5"><span className="text-white/40">Computer</span>
                        <select name="platform" defaultValue={s.platform} className="rounded border border-white/20 bg-black px-2 py-1 text-white"><option value="windows">Windows (Microsoft)</option><option value="mac">Mac (Apple)</option></select>
                      </label>
                      <Button type="submit" variant="save" size="sm">Save</Button>
                    </form>
                  )}
                  {st !== "void" && !r.archived && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <DL href={`${base}/sheet?roster=${r.rosterId}&sheet=${s.number}&platform=windows`} tone={s.platform === "windows" ? "primary" : "neutral"}>Windows .xlsx</DL>
                      <DL href={`${base}/sheet?roster=${r.rosterId}&sheet=${s.number}&platform=mac`} tone={s.platform === "mac" ? "primary" : "neutral"}>Mac .xlsx</DL>
                      {practice && <DL href={`${base}/sheet?roster=${r.rosterId}&sheet=${s.number}&platform=${s.platform}&prefill=1`} tone="special">Pre-filled practice copy</DL>}
                      {s.email && <a href={mailtoFor(r, s, replyTo)} className="rounded-full border border-white/20 px-3 py-1 text-white/80 hover:bg-white/10">✉ Draft email to {s.email}</a>}
                      <form action={markSentAction} className="inline">
                        <input type="hidden" name="roster_id" value={r.rosterId} />
                        <input type="hidden" name="sheet" value={s.number} />
                        {s.sentAt ? <input type="hidden" name="undo" value="1" /> : null}
                        <button type="submit" className="rounded-full border border-white/20 px-3 py-1 text-white/70 hover:bg-white/10">{s.sentAt ? `✓ Emailed ${s.sentAt.slice(5, 16).replace("T", " ")} (undo)` : "Mark as emailed"}</button>
                      </form>
                      {last && <span className="text-white/40">Last download {last.at.slice(5, 16).replace("T", " ")} UTC · {last.platform === "mac" ? "Mac" : "Windows"}{last.prefilled ? " · pre-filled" : ""} · {s.downloads.length}×</span>}
                    </div>
                  )}
                  {s.received && (
                    <p className="mt-2 text-xs text-emerald-200/90">
                      ✓ Uploaded {s.received.at.slice(5, 16).replace("T", " ")} UTC · {s.received.fileName} · {s.received.scans} scans + {s.received.handUnits} hand-counted
                      {s.received.counterInFile && s.received.counterInFile !== s.assignee ? ` · name in file: ${s.received.counterInFile}` : ""}
                      {s.received.replaced ? ` · replaced ${s.received.replaced}×` : ""}
                      {s.received.blocking ? <span className="text-red-300"> · {s.received.blocking} blocking problem(s)</span> : ""}
                      {s.received.warnings ? <span className="text-amber-300"> · {s.received.warnings} warning(s)</span> : ""}
                    </p>
                  )}
                  {practice && (practiceLists[s.number]?.length ?? 0) > 0 && (
                    <details className="mt-2 text-xs text-white/60">
                      <summary className="cursor-pointer text-white/70">What to count on this practice sheet ({practiceLists[s.number].length} items)</summary>
                      <ul className="mt-1 columns-1 gap-6 sm:columns-2">
                        {practiceLists[s.number].map((l) => <li key={l.code}>{l.productName} <span className="font-mono text-white/40">{l.code}</span></li>)}
                      </ul>
                    </details>
                  )}
                  {!r.archived && (
                    <form action={voidSheetAction} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/50">
                      <input type="hidden" name="roster_id" value={r.rosterId} />
                      <input type="hidden" name="sheet" value={s.number} />
                      {st === "void" ? (
                        <><input type="hidden" name="restore" value="1" /><button type="submit" className="underline">Restore this sheet</button></>
                      ) : (
                        <details><summary className="cursor-pointer">Void this sheet…</summary>
                          <div className="mt-1 flex items-center gap-2"><input name="reason" placeholder="why (e.g. called out sick)" maxLength={120} className="w-56 rounded border border-white/20 bg-black px-2 py-1 text-white" /><Button type="submit" variant="danger" size="sm">Void</Button></div>
                        </details>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {!r.archived && (
            <form action={addSheetAction} className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-3 text-xs text-white/70">
              <input type="hidden" name="roster_id" value={r.rosterId} />
              <span className="text-white/50">Add a sheet:</span>
              <input name="assignee" placeholder="person (optional)" maxLength={60} className="w-40 rounded border border-white/20 bg-black px-2 py-1 text-white" />
              <input name="zone" placeholder="area (optional)" maxLength={80} className="w-48 rounded border border-white/20 bg-black px-2 py-1 text-white" />
              <select name="platform" className="rounded border border-white/20 bg-black px-2 py-1 text-white"><option value="windows">Windows</option><option value="mac">Mac</option></select>
              <Button type="submit" variant="neutral" size="sm">Add sheet</Button>
            </form>
          )}
        </section>

        {/* ---------------- upload ---------------- */}
        <section id="upload" className="space-y-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Upload the emailed-back workbooks</h2>
          <p className="text-xs text-white/50">
            Drop in any number at once, in any order, with any file name. Each one is matched to its sheet by the id hidden inside it and checked off above. A corrected file
            replaces the earlier one; the same file twice changes nothing; a copy of a voided sheet, a sheet from another roster{practice ? ", or a live workbook" : ", or a practice workbook"} is refused.
          </p>
          <form action={uploadRosterAction} className="flex flex-wrap items-end gap-3 text-xs text-white/70">
            <input type="hidden" name="roster_id" value={r.rosterId} />
            <input type="file" name="workbooks" multiple required accept=".xlsx" className="text-white" />
            <Button type="submit" variant="primary">Upload and check off</Button>
          </form>
        </section>

        {/* ---------------- practice result ---------------- */}
        {practice && (
          <section id="practice-result" className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="practice-result">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Practice reconciliation (dry run)</h2>
              <form action={runPracticeAction}>
                <input type="hidden" name="roster_id" value={r.rosterId} />
                <Button type="submit" variant="confirm" size="sm">{r.practiceResult ? "Run the check again" : "Run the practice check"}</Button>
              </form>
            </div>
            <p className="text-xs text-white/50">
              Reads every uploaded practice workbook exactly as the real count will, compares it with each lot&apos;s on-hand in the system right now, and builds the same audit
              statistics. A <b className="text-white/70">pre-filled copy</b> proves the pipeline end to end: every unit written in must come back, and the deliberate short, over,
              hand-count and not-in-Cultivera entries must each be caught. A copy counted by hand shows real findings instead.
            </p>
            {r.practiceResult && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${r.practiceResult.verified ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                {r.practiceResult.verified ? "✓ VERIFIED — " : ""}Last check {r.practiceResult.at.slice(0, 16).replace("T", " ")} UTC: {r.practiceResult.checksPassed} of {r.practiceResult.checksTotal} checks passed.
                {r.practiceResult.verified ? " The pipeline works end to end on real data." : " Fix what is red and run it again."}
              </div>
            )}
            {reportError && <p className="text-xs text-red-300">{reportError}</p>}
            {report && (
              <>
                <ul className="space-y-1">
                  {report.checks.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${c.ok ? "bg-emerald-500 text-black" : "bg-red-500 text-white"}`}>{c.ok ? "✓" : "✕"}</span>
                      <span><span className={c.ok ? "text-emerald-200" : "text-red-200"}>{c.label}</span> <span className="text-white/40">— {c.detail}</span></span>
                    </li>
                  ))}
                </ul>
                {report.problems.length > 0 && <ul className="list-disc pl-5 text-xs text-red-200">{report.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                <table className="w-full text-left text-xs text-white/70">
                  <thead className="text-white/40"><tr><th>Sheet</th><th>Person</th><th>File</th><th>Scans</th><th>Hand</th><th>Notes</th></tr></thead>
                  <tbody>
                    {report.books.map((b) => (
                      <tr key={b.number} className="border-t border-white/5"><td className="py-1">#{b.number}</td><td>{b.assignee}</td><td className="text-white/50">{b.fileName}</td><td>{b.scans}</td><td>{b.handUnits}</td><td className="text-white/50">{b.problems.slice(0, 3).join(" ")}</td></tr>
                    ))}
                  </tbody>
                </table>
                <CountAuditStatsPanel stats={report.stats} title="Practice audit statistics" note="Practice compares with today's on-hand, with no sales roll-forward." />
              </>
            )}
            {!report && !reportError && <p className="text-xs text-white/40">Upload at least one practice workbook to see the check.</p>}
          </section>
        )}

        {/* ---------------- combine (live) ---------------- */}
        {!practice && (
          <section id="combine" className="space-y-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">After the count: combine every sheet into the preview</h2>
            <p className="text-xs text-white/50">
              After closing on the sales day, Fetch with the count date set and stage that harvest. Then pick that import here. Every uploaded sheet becomes one upload on the
              count page, with the full preview, audit statistics and the digest-checked Apply. It refuses while a sheet is missing unless you tick the box.
            </p>
            {r.combined && (
              <p className={`text-xs ${r.combined.canApply ? "text-emerald-300" : "text-amber-300"}`}>
                Last combined {r.combined.at.slice(0, 16).replace("T", " ")} UTC into import {r.combined.importId.slice(0, 8)} ·{" "}
                <Link href={`/admin/menu-imports/count?import=${r.combined.importId}&batch=${r.combined.batchId}&roster=${r.rosterId}#preview`} className="underline">open that preview</Link>
                {r.combined.missing.length ? ` · built without ${r.combined.missing.join(", ")}` : ""}
              </p>
            )}
            {r.applied && <p className="text-xs font-semibold text-emerald-300">✓ Applied {r.applied.at.slice(0, 16).replace("T", " ")} UTC · {r.applied.adjustments} lot(s) adjusted.</p>}
            {imports.length === 0 ? (
              <p className="text-xs text-white/50">No staged Cultivera import yet.</p>
            ) : (
              <form action={combineRosterAction} className="flex flex-wrap items-end gap-3 text-xs text-white/70">
                <input type="hidden" name="roster_id" value={r.rosterId} />
                <label className="flex flex-col gap-1">
                  <span>Cultivera import (staged from the count fetch)</span>
                  <select name="import_id" defaultValue={r.combined?.importId} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                    {imports.map((x) => <option key={x.id} value={x.id}>{x.created_at.slice(0, 16).replace("T", " ")} UTC · {x.status} · {x.id.slice(0, 8)}</option>)}
                  </select>
                </label>
                {t.outstanding.length > 0 && (
                  <label className="flex items-center gap-2 text-amber-300"><input type="checkbox" name="allow_missing" /> build it without the {t.outstanding.length} missing sheet(s)</label>
                )}
                <Button type="submit" variant="confirm" disabled={t.received === 0}>Combine and preview</Button>
              </form>
            )}
          </section>
        )}

        {/* ---------------- history ---------------- */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-white">History ({r.events.length})</summary>
            <ul className="mt-2 space-y-0.5 text-xs text-white/60">
              {[...r.events].reverse().map((e, i) => <li key={i}><span className="text-white/40">{e.at.slice(0, 16).replace("T", " ")} UTC · {e.by || "system"}</span> — {e.what}</li>)}
            </ul>
          </details>
          <form action={archiveRosterAction} className="mt-3 text-xs">
            <input type="hidden" name="roster_id" value={r.rosterId} />
            {r.archived && <input type="hidden" name="unarchive" value="1" />}
            <button type="submit" className="text-white/40 underline">{r.archived ? "Restore this roster" : "Archive this roster"}</button>
          </form>
          <p className="mt-2 text-xs text-white/30">Roster id {r.rosterId} · made {r.createdAt.slice(0, 16).replace("T", " ")} UTC by {r.createdBy || "—"}</p>
        </section>
      </div>
    </div>
  );
}
