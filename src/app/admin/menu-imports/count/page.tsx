import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCrawlerConfigured } from "@/lib/ai/crawler-client";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { listPosRuns } from "@/lib/pos/cultivera-fetch-client";
import { buildCountPreview, isCountBatchId, type CountPreview } from "@/lib/pos/cultivera-count-store";
import type { UncountedPolicy } from "@/lib/pos/cultivera-count-core";
import { ScannerSetupSection } from "@/components/admin/ScannerSetupSection";
import { CountAuditStatsPanel } from "@/components/admin/CountAuditStatsPanel";
import { auditStatsFor, isRosterId, listRosters, loadManualTicks, loadRoster, type ManualTicks, type RosterIndexRow } from "@/lib/pos/count-roster-store";
import { MANUAL_STEPS, ROSTER_LIMITS, readinessChecklist, rosterTally, type CountRoster } from "@/lib/pos/count-roster-core";
import type { AuditStats } from "@/lib/pos/count-audit-stats-core";
import { applyCountAction, uploadCountAction } from "./actions";
import { createLiveRosterAction, createPracticeRosterAction, toggleTickAction } from "./roster/actions";

/**
 * R50 S11 — the Oct 30 shelf count, the last step of the Cultivera menu upload pipeline
 * (harvest → assemble → import → lots → count). Owner clarification #4 (R50 §0.6): back stock is
 * counted while open with nothing pulled, the floor after the 6 pm close; the only roll-forward is
 * Cultivera's 10/31 sales. Lot quantity after apply = counted − sold on 10/31.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ImportRow = { id: string; created_at: string; status: string; is_test: boolean | null };

const EXCEPTION_COPY: Record<string, string> = {
  unknown_barcode: "Scanned, but no imported Cultivera lot has this barcode. Set the item aside and check it.",
  ambiguous_barcode: "Two imported lots share this barcode. Left alone.",
  negative_rolled: "More sold on the sales day than were counted. Recount this item.",
  unknown_order_status: "A sale has a Cultivera order status never seen before. Left alone.",
  uncounted: "Has stock in Cultivera but nobody scanned it. Go and look.",
  moved_since_import: "Changed since the import by something other than this count (a sale, a disposition). Left alone.",
  autocomplete_risk: "Excel AutoComplete could have turned a scan of a shorter barcode into this one (or this one into it). Left alone: recount it by hand on the Hand Count sheet.",
};

export default async function CountPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string; batch?: string; policy?: string; error?: string; notice?: string; roster?: string }>;
}) {
  await requirePermission("menu.import");
  const sp = await searchParams;
  const importId = sp.import && isSafeImportId(sp.import) ? sp.import : "";
  const batchId = sp.batch && isCountBatchId(sp.batch) ? sp.batch : "";
  const policy: UncountedPolicy = sp.policy === "zero" ? "zero" : "leave";

  let imports: ImportRow[] = [];
  if (isSupabaseServiceConfigured) {
    const { data } = await createSupabaseAdminClient()
      .from("pos_imports")
      .select("id, created_at, status, is_test")
      .order("created_at", { ascending: false })
      .limit(10);
    imports = ((data as ImportRow[] | null) ?? []).filter((r) => !r.is_test);
  }
  let runs: string[] = [];
  let runsError: string | null = null;
  if (isCrawlerConfigured()) {
    try {
      runs = (await listPosRuns()).slice(0, 8);
    } catch (e) {
      runsError = e instanceof Error ? e.message : String(e);
    }
  }

  let preview: CountPreview | null = null;
  let previewError: string | null = null;
  if (importId && batchId) {
    try {
      preview = await buildCountPreview(createSupabaseAdminClient(), importId, batchId, policy);
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e);
    }
  }
  // R74 S50: rosters (assignment + tracker), the practice run and the audit-day checklist.
  let rosters: RosterIndexRow[] = [];
  let ticks: ManualTicks = {};
  let practiceRoster: CountRoster | null = null;
  let liveRoster: CountRoster | null = null;
  const tallies: Record<string, ReturnType<typeof rosterTally>> = {};
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      [rosters, ticks] = await Promise.all([listRosters(admin), loadManualTicks(admin)]);
      const active = rosters.filter((x) => !x.archived).slice(0, 8);
      const loaded = (await Promise.all(active.map((x) => loadRoster(admin, x.rosterId)))).filter((x): x is CountRoster => !!x);
      for (const x of loaded) tallies[x.rosterId] = rosterTally(x);
      practiceRoster = loaded.find((x) => x.mode === "test" && x.practiceResult?.verified) ?? loaded.find((x) => x.mode === "test") ?? null;
      liveRoster = loaded.find((x) => x.mode === "live") ?? null;
    } catch {
      /* the roster store is optional; the rest of the page still works */
    }
  }
  const checklist = readinessChecklist({ practice: practiceRoster, live: liveRoster, manual: ticks });
  const fromRoster = sp.roster && isRosterId(sp.roster) ? sp.roster : "";
  let stats: AuditStats | null = null;
  if (preview?.plan) {
    try {
      stats = await auditStatsFor(createSupabaseAdminClient(), preview.plan.lines);
    } catch {
      stats = null;
    }
  }
  const allImports: ImportRow[] = [];
  if (isSupabaseServiceConfigured) {
    const { data } = await createSupabaseAdminClient().from("pos_imports").select("id, created_at, status, is_test").order("created_at", { ascending: false }).limit(10);
    allImports.push(...((data as ImportRow[] | null) ?? []));
  }

  const s = preview?.plan?.summary;
  const flagged = preview?.plan?.lines.filter((l) => l.exception) ?? [];
  const moves = preview?.plan?.lines.filter((l) => l.adjust) ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Oct 30 shelf count"
        subtitle="Scan workbooks in, Cultivera's 10/31 sales out, every imported lot set to what is on the shelf."
        breadcrumbs={<Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Oct 30 count" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{sp.error}</div>}
        {sp.notice && <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">{sp.notice}</div>}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-steps">
          <h2 className="text-sm font-semibold text-white">How the count works</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-white/60">
            <li>Before 10/30: set up and test every scanner (step 0). Then download one workbook per counter (step 1). Each counter gets their own file. Never copy one.</li>
            <li>10/30: count the back stock while open (nothing is pulled from it) and finish before 6 pm. Close at 6 pm and count the floor.</li>
            <li>Scan each item once per unit into the Scan sheet. Items with no barcode go on the Hand Count sheet with a quantity.</li>
            <li>After closing on 10/31 and before opening on 11/01: on Menu Imports, set the count date to 10/30 and press Fetch. Stage that harvest.</li>
            <li>Pick that import here, upload every workbook at once (step 2), read the preview, then apply.</li>
          </ol>
        </section>

        <section id="checklist" className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-checklist">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Audit-day readiness checklist</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${checklist.done === checklist.total ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/70"}`}>
              {checklist.done === checklist.total ? "✓ Ready and done" : `${checklist.done} of ${checklist.total} done`}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-2.5 bg-emerald-500 transition-all" style={{ width: `${checklist.pct}%` }} /></div>
          {checklist.next && <p className="text-xs text-[var(--admin-gold)]">Next: {checklist.next.label}.</p>}
          {[...new Set(checklist.items.map((i) => i.phase))].map((phase) => {
            const items = checklist.items.filter((i) => i.phase === phase);
            const d = items.filter((i) => i.state === "done").length;
            return (
              <div key={phase} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="mb-1 flex justify-between text-xs font-semibold text-white/80"><span>{phase}</span><span className={d === items.length ? "text-emerald-300" : "text-white/40"}>{d === items.length ? "✓ " : ""}{d}/{items.length}</span></p>
                <ul className="space-y-1">
                  {items.map((i) => {
                    const manual = i.key.startsWith("manual_") ? i.key.slice(7) : null;
                    return (
                      <li key={i.key} className="flex items-start gap-2 text-xs">
                        <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i.state === "done" ? "bg-emerald-500 text-black" : i.state === "warn" ? "bg-amber-400 text-black" : "border border-white/30 text-transparent"}`}>{i.state === "done" ? "✓" : i.state === "warn" ? "!" : "·"}</span>
                        <span className="flex-1"><span className={i.state === "done" ? "text-emerald-200" : "text-white/80"}>{i.label}</span> <span className="text-white/40">— {i.detail}</span></span>
                        {manual && (
                          <form action={toggleTickAction}>
                            <input type="hidden" name="key" value={manual} />
                            <button type="submit" className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/10">{i.state === "done" ? "Untick" : "Tick"}</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-white/40">
            Green ticks come from what actually happened (rosters, uploads, the practice check, the apply); the {MANUAL_STEPS.length} floor tasks are ticked by you. Run the practice
            first: it proves the whole pipeline on real lots without touching inventory.
          </p>
        </section>

        <section id="practice" className="space-y-3 rounded-xl border border-violet-500/30 bg-[#0a0a0a] p-5" data-testid="count-practice">
          <h2 className="text-sm font-semibold text-white">Practice run: test the whole pipeline on a few real products</h2>
          <p className="text-xs text-white/60">
            Picks a spread of real lots with stock from an import you already made (different categories, small and large quantities) and makes a small roster for 1–{ROSTER_LIMITS.maxPracticeSheets} people.
            Download each sheet for Windows or Mac, count those items on the shelf (or download a <b>pre-filled copy</b> that is filled in for you, with a few deliberate mistakes the
            check must catch), upload them back, and run the practice check. Green marks prove it works. It never changes inventory or the menu.
          </p>
          {allImports.length === 0 ? (
            <p className="text-xs text-white/50">No import yet.</p>
          ) : (
            <form action={createPracticeRosterAction} className="flex flex-wrap items-end gap-3 text-xs text-white/70">
              <label className="flex flex-col gap-1">
                <span>Import to take real lots from</span>
                <select name="import_id" className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  {allImports.map((r) => <option key={r.id} value={r.id}>{r.created_at.slice(0, 16).replace("T", " ")} UTC · {r.status}{r.is_test ? " · test" : ""} · {r.id.slice(0, 8)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1"><span>Lots</span><input type="number" name="lots" min={4} max={ROSTER_LIMITS.maxPracticeLots} defaultValue={ROSTER_LIMITS.defaultPracticeLots} className="w-20 rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
              <label className="flex flex-col gap-1"><span>Sheets</span><input type="number" name="sheets" min={1} max={ROSTER_LIMITS.maxPracticeSheets} defaultValue={2} className="w-20 rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
              <label className="flex flex-col gap-1"><span>People (optional, one per line: name | area | email | mac)</span><textarea name="people" rows={2} className="w-80 rounded border border-white/20 bg-black px-2 py-1 font-mono text-white" placeholder={"Michael | | | mac\nAna"} /></label>
              <Button type="submit" variant="special">Make a practice roster</Button>
            </form>
          )}
        </section>

        <section id="roster" className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-rosters">
          <h2 className="text-sm font-semibold text-white">Workbook rosters: generate, assign, track</h2>
          <p className="text-xs text-white/60">
            Make every workbook yourself, one per person and area, then email each person their file. The tracker shows how many are assigned, out and back, by name, so none is missed.
            Workbooks are matched by the id hidden inside them, so a renamed attachment still checks off the right line, and a copied workbook is refused.
          </p>
          {rosters.filter((x) => !x.archived).length > 0 && (
            <table className="w-full text-left text-xs text-white/70">
              <thead className="text-white/40"><tr><th>Roster</th><th>Count date</th><th>Assigned</th><th>Out</th><th>Uploaded</th><th>Status</th></tr></thead>
              <tbody>
                {rosters.filter((x) => !x.archived).slice(0, 8).map((x) => {
                  const t = tallies[x.rosterId];
                  return (
                    <tr key={x.rosterId} className="border-t border-white/5">
                      <td className="py-1"><Link href={`/admin/menu-imports/count/roster?id=${x.rosterId}`} className="text-white underline">{x.title}</Link>{x.mode === "test" && <span className="ml-2 rounded bg-violet-500/20 px-1.5 text-[10px] text-violet-300">PRACTICE</span>}</td>
                      <td>{x.countDate}</td>
                      <td>{t ? `${t.assigned}/${t.active}` : "—"}</td>
                      <td>{t ? `${t.downloaded}/${t.active}` : "—"}</td>
                      <td className="w-40">{t && (<div className="flex items-center gap-2"><span className="w-10">{t.received}/{t.active}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-1.5 bg-emerald-500" style={{ width: `${t.receivedPct}%` }} /></div></div>)}</td>
                      <td>{t ? (t.allIn ? <span className="text-emerald-300">✓ all in</span> : <span className="text-amber-300">{t.outstanding.length} missing</span>) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!isCrawlerConfigured() ? (
            <p className="text-xs text-[var(--admin-gold)]">The crawler is not connected, so there is no harvest to build a live roster&apos;s product list from. The practice run above still works.</p>
          ) : runsError ? (
            <p className="text-xs text-red-300">Could not list the harvests: {runsError}</p>
          ) : runs.length === 0 ? (
            <p className="text-xs text-white/60">No harvest yet. Press Fetch on Menu Imports first; the product list comes from it.</p>
          ) : (
            <form action={createLiveRosterAction} className="grid gap-3 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1"><span>Name</span><input name="title" maxLength={80} placeholder="Oct 30 inventory count" className="rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
              <label className="flex flex-col gap-1"><span>Count date</span><input type="date" name="date" required defaultValue="2026-10-30" className="rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
              <label className="flex flex-col gap-1"><span>Harvest (product list)</span><select name="run" className="rounded border border-white/20 bg-black px-2 py-1 text-white">{runs.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span>Extra blank sheets (assign later)</span><input type="number" name="blank" min={0} max={ROSTER_LIMITS.maxSheets} defaultValue={0} className="rounded border border-white/20 bg-black px-2 py-1 text-white" /></label>
              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3"><span>People, one per line: name | area | email | mac or windows (only the name is needed)</span>
                <textarea name="people" rows={5} className="rounded border border-white/20 bg-black px-2 py-1 font-mono text-white" placeholder={"Ana | Back room shelves 1-4 | ana@example.com | mac\nJoe | Sales floor cases A-C | | windows\nSam | Vault"} />
              </label>
              <div className="flex items-end"><Button type="submit" variant="primary">Generate the roster</Button></div>
            </form>
          )}
          <p className="text-xs text-white/40">
            Professional practice: give every area exactly one sheet (no gaps, no overlaps), keep a couple of blank sheets for surprises, and void a sheet (with a reason) instead of
            deleting it, so every workbook ever issued is accounted for.
          </p>
        </section>

        <ScannerSetupSection />

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">1. Quick single workbook (no roster)</h2>
          <p className="mt-1 text-xs text-white/40">For the real count, use a roster above: it tracks who has which workbook and whether it came back.</p>
          {!isCrawlerConfigured() ? (
            <p className="mt-2 text-xs text-[var(--admin-gold)]">The crawler is not connected, so there is no harvest to build the product list from.</p>
          ) : runsError ? (
            <p className="mt-2 text-xs text-red-300">Could not list the harvests: {runsError}</p>
          ) : runs.length === 0 ? (
            <p className="mt-2 text-xs text-white/60">No harvest yet. Press Fetch on Menu Imports first; the product list comes from it.</p>
          ) : (
            <form method="get" action="/admin/menu-imports/count/workbook" className="mt-3 flex flex-wrap items-end gap-3 text-xs text-white/70">
              <label className="flex flex-col gap-1">
                <span>Harvest (product list)</span>
                <select name="run" className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  {runs.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span>Counter&apos;s name</span>
                <input name="counter" required maxLength={60} className="rounded border border-white/20 bg-black px-2 py-1 text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span>Count date</span>
                <input type="date" name="date" required defaultValue="2026-10-30" className="rounded border border-white/20 bg-black px-2 py-1 text-white" />
              </label>
              <Button type="submit" variant="neutral">Download workbook</Button>
            </form>
          )}
          <p className="mt-2 text-xs text-white/40">
            Use a harvest that finished. The workbook only shows product names, never quantities (a blind count).
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">2. Upload the counters&apos; workbooks</h2>
          {imports.length === 0 ? (
            <p className="mt-2 text-xs text-white/60">No staged Cultivera import yet.</p>
          ) : (
            <form action={uploadCountAction} className="mt-3 flex flex-wrap items-end gap-3 text-xs text-white/70">
              <label className="flex flex-col gap-1">
                <span>Cultivera import (the one staged from the count fetch)</span>
                <select name="import_id" defaultValue={importId} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  {imports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.created_at.slice(0, 16).replace("T", " ")} UTC · {r.status} · {r.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span>Every counter&apos;s workbook (.xlsx), all at once</span>
                <input type="file" name="workbooks" multiple required accept=".xlsx" className="text-white" />
              </label>
              <Button type="submit" variant="primary">Upload and preview</Button>
            </form>
          )}
        </section>

        {previewError && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{previewError}</div>}

        {preview && (
          <section id="preview" className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-preview">
            <h2 className="text-sm font-semibold text-white">3. Preview</h2>
            <p className="text-xs text-white/60">
              Count date {preview.countDate ?? "?"} · sales day {preview.salesDay ?? "?"} · {preview.books.length} workbooks ·{" "}
              {preview.lotsLoad.lots.toLocaleString("en-US")} imported lots · Cultivera sales from harvest {preview.sales.runId ?? "none"}
              {preview.sales.snapshotPacific ? `, quantities read from ${preview.sales.snapshotPacific} Pacific` : ""}.
            </p>

            <table className="w-full text-left text-xs text-white/70">
              <thead className="text-white/40"><tr><th>Counter</th><th>File</th><th>Scans</th><th>Hand count</th></tr></thead>
              <tbody>
                {preview.books.map((b) => (
                  <tr key={b.workbookId}><td>{b.counter}</td><td>{b.fileName}</td><td>{b.scans}</td><td>{b.handUnits}</td></tr>
                ))}
              </tbody>
            </table>

            {(preview.problems.length > 0 || preview.refusals.length > 0) && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                <p className="font-semibold">Fix these, then upload again:</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.refusals.map((m, i) => <li key={`r${i}`}>{m}</li>)}
                  {preview.problems.map((p, i) => (
                    <li key={`p${i}`}>{p.severity === "warning" ? "(warning) " : ""}{p.message}{p.row ? ` (row ${p.row})` : ""}</li>
                  ))}
                  {preview.sales.rollup && preview.sales.rollup.linesAfterDay > 0 && (
                    <li>{preview.sales.rollup.linesAfterDay} Cultivera sales are dated after {preview.salesDay}. Fetch after closing on {preview.salesDay} and before opening the next day.</li>
                  )}
                  {preview.sales.rollup && preview.sales.rollup.linesAfterSnapshot > 0 && (
                    <li>{preview.sales.rollup.linesAfterSnapshot} sales were rung up after the harvest started reading quantities. Fetch again after closing.</li>
                  )}
                  {preview.sales.rollup?.unusable.slice(0, 10).map((m, i) => <li key={`u${i}`}>Sales line unusable: {m}</li>)}
                  {preview.lotsLoad.skipped.slice(0, 20).map((k) => <li key={k.lotId}>Lot {k.lotId.slice(0, 8)}: {k.reason}</li>)}
                </ul>
              </div>
            )}

            {s && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-white/70 sm:grid-cols-4">
                <dt>Units counted</dt><dd>{s.countedUnits}</dd>
                <dt>Lots counted</dt><dd>{s.countedLots}</dd>
                <dt>Sold on {preview.salesDay} (net)</dt><dd>{s.salesUnitsNet}</dd>
                <dt>Sold, not on any lot</dt><dd>{s.salesUnitsNotOnAnyLot}</dd>
                <dt>Lots to adjust</dt><dd>{s.adjustedLots}</dd>
                <dt>Units up / down</dt><dd>+{s.unitsUp} / -{s.unitsDown}</dd>
                <dt>Already right</dt><dd>{s.unchangedLots}</dd>
                <dt>Not scanned (with stock)</dt><dd>{s.uncountedLots} lots, {s.uncountedUnits} units</dd>
                <dt>Unknown barcodes</dt><dd>{s.unknownBarcodes} ({s.unknownUnits} units)</dd>
                <dt>Recount (sold &gt; counted)</dt><dd>{s.negativeRolled}</dd>
                <dt>Changed since import</dt><dd>{s.movedSinceImport}</dd>
                <dt>Shared barcode / odd status</dt><dd>{s.ambiguous} / {s.unknownStatus}</dd>
              </dl>
            )}

            {stats && <CountAuditStatsPanel stats={stats} title="Audit statistics (this count vs the system)" note="Shelf = counted minus sold after the count; system = Cultivera's quantity at the import." />}

            <form method="get" className="flex items-center gap-3 text-xs text-white/70">
              <input type="hidden" name="import" value={preview.importId} />
              <input type="hidden" name="batch" value={preview.batchId} />
              {fromRoster && <input type="hidden" name="roster" value={fromRoster} />}
              <label className="flex items-center gap-2">
                <span>A lot nobody scanned:</span>
                <select name="policy" defaultValue={policy} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  <option value="leave">keeps Cultivera&apos;s quantity and is listed (default)</option>
                  <option value="zero">is set to 0 (only if the count covered every shelf)</option>
                </select>
              </label>
              <Button type="submit" variant="neutral">Recheck</Button>
            </form>

            {flagged.length > 0 && (
              <details open={flagged.length <= 50}>
                <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-gold)]">Left alone ({flagged.length}). Each needs a look.</summary>
                <table className="mt-2 w-full text-left text-xs text-white/70">
                  <thead className="text-white/40"><tr><th>Barcode</th><th>Product</th><th>Counted</th><th>Sold</th><th>Cultivera</th><th>Why</th></tr></thead>
                  <tbody>
                    {flagged.slice(0, 500).map((l, i) => (
                      <tr key={`${l.lotCode}-${i}`}><td className="font-mono">{l.lotCode}</td><td>{l.productName}</td><td>{l.counted}</td><td>{l.netSold}</td><td>{l.onHand ?? "-"}</td><td>{EXCEPTION_COPY[l.exception ?? ""] ?? l.exception}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {moves.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-white/80">Lots that change ({moves.length})</summary>
                <table className="mt-2 w-full text-left text-xs text-white/70">
                  <thead className="text-white/40"><tr><th>Barcode</th><th>Product</th><th>Cultivera</th><th>Counted</th><th>Sold</th><th>New qty</th><th>Change</th></tr></thead>
                  <tbody>
                    {moves.slice(0, 1000).map((l) => (
                      <tr key={l.lotId ?? l.lotCode}><td className="font-mono">{l.lotCode}</td><td>{l.productName}</td><td>{l.onHand}</td><td>{l.counted}</td><td>{l.netSold}</td><td>{l.rolled}</td><td>{l.delta > 0 ? `+${l.delta}` : l.delta}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {preview.canApply ? (
              <form action={applyCountAction} className="flex flex-wrap items-center gap-4 border-t border-white/10 pt-4 text-xs text-white/70">
                <input type="hidden" name="import_id" value={preview.importId} />
                <input type="hidden" name="batch_id" value={preview.batchId} />
                <input type="hidden" name="digest" value={preview.digest ?? ""} />
                <input type="hidden" name="policy" value={policy} />
                {fromRoster && <input type="hidden" name="roster_id" value={fromRoster} />}
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirm" />
                  <span>I checked the preview. Set {s?.adjustedLots} lots to the shelf count.</span>
                </label>
                <Button type="submit" variant="confirm">Apply the count</Button>
              </form>
            ) : (
              <p className="border-t border-white/10 pt-4 text-xs text-white/50">
                {preview.plan && preview.plan.adjustments.length === 0 && preview.refusals.length === 0 && !preview.plan.blocked
                  ? "Every counted lot already matches. Nothing to apply."
                  : "Apply is off until everything above is fixed."}
              </p>
            )}
            <p className="text-xs text-white/40">
              Each change is a CCRS reconciliation adjustment (reason &ldquo;count&rdquo;) with the barcode, count, sales and Cultivera quantity in its note.
              Applying again with the same files changes nothing. The Sage adjustments export leaves these out: migrated stock is opening inventory.{" "}
              <Link href="/admin/menu-imports" className="underline">Back to Menu Imports</Link>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
