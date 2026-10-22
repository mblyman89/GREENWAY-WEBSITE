import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import { readCutoverDone } from "@/lib/pos/cutover-guard";
import { getPosRun, isValidRunId, loadRunForImport, type LoadedRun } from "@/lib/pos/cultivera-fetch-client";
import { MAX_HARVEST_AGE_MINUTES, importDecision, runView } from "@/lib/pos/cultivera-fetch-button-core";
import { coverageCheck, missingToAcknowledge } from "@/lib/pos/cultivera-wcia-coverage-core";
import { cancelFetchAction, importFetchAction, startFetchAction } from "../../fetch-actions";
// R50 S10b: one plain "what to do now" line, from the same facts this page shows.
import { fetchRunNextStep } from "@/lib/pos/menu-imports-guide-core";

/**
 * R50 S9 — one "Fetch It All" run: live stage progress while the crawler harvests,
 * then the go/no-go report computed from the VERIFIED files (the import action
 * recomputes everything server-side; this page only shows it).
 */
export const dynamic = "force-dynamic";
// The import action (download + verify + assemble + runImport) inherits this.
export const maxDuration = 300;

const ROW_TONE: Record<string, string> = {
  done: "text-[var(--admin-accent)]",
  running: "text-[var(--admin-orange)]",
  partial: "text-[var(--admin-orange)]",
  incomplete: "text-red-300",
  pending: "text-white/40",
};

export default async function FetchRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("menu.import");
  const { runId } = await params;
  const sp = await searchParams;
  if (!isValidRunId(runId)) notFound();

  let loadError: string | null = null;
  let run: Awaited<ReturnType<typeof getPosRun>> = null;
  try {
    run = await getPosRun(runId);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not reach the crawler.";
  }
  if (!run && !loadError) notFound();
  const view = run ? runView(run) : null;

  let loaded: LoadedRun | null = null;
  let checkError: string | null = null;
  if (view?.canImport) {
    try {
      loaded = await loadRunForImport(runId);
    } catch (e) {
      checkError = e instanceof Error ? e.message : "Could not check the harvest.";
    }
  }
  const report = loaded?.assembled?.report ?? null;
  const age = loaded ? loaded.ageMinutes : null;
  const realDecision = loaded
    ? importDecision({ isTest: false, go: Boolean(report?.go), cutoverDone: await readCutoverDone(), ageMinutes: age, filesVerified: loaded.verified, vendorFilesMissing: missingToAcknowledge(loaded.vendorCoverage), acknowledgeMissingVendorFiles: true })
    : null;
  // R74 S2: missing vendor transfer files, LOUD. (realDecision above assumes the tick, so it shows the
  // other reasons; the tick itself is required on the form below.)
  const vendorMissing = loaded ? missingToAcknowledge(loaded.vendorCoverage) : 0;
  const vendorLine = loaded ? coverageCheck(loaded.vendorCoverage) : null;

  const next = fetchRunNextStep({
    view: view ? { status: view.status, canImport: view.canImport } : null,
    loadError,
    checkError,
    checked: loaded !== null,
    go: loaded ? Boolean(report?.go) : null,
    realAllowed: realDecision ? realDecision.allowed : null,
    vendorFilesMissing: vendorMissing,
  });
  const NEXT_TONE = {
    wait: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 text-[var(--admin-orange)]",
    go: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
    fix: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  } as const;

  return (
    <div>
      <AdminPageHeader title="Fetch It All, Fuck Cultivera" subtitle={`Harvest run ${runId}`} />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Fetch run" }]} />
        <FetchRunAutoRefresh active={Boolean(view?.poll)} />

        <div data-testid="fetch-run-next" data-tone={next.tone} className={`rounded-lg border px-4 py-3 text-sm ${NEXT_TONE[next.tone]}`}>
          <span className="font-semibold">What to do now: </span>
          {next.text}{" "}
          <Link href="/admin/menu-imports#migration-guide" className="whitespace-nowrap text-xs underline">
            See all steps
          </Link>
        </div>

        {(sp.error || loadError || checkError) && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {sp.error ? decodeURIComponent(sp.error) : loadError ?? checkError}
          </div>
        )}

        {view && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">
                Harvest: <span className="uppercase">{view.status}</span> · {view.doneStages} / {view.totalStages} stages ({view.percent}%)
                {view.seconds !== null && <> · {Math.round(view.seconds)} s</>}
              </h2>
              <div className="flex gap-2">
                {view.canCancel && (
                  <form action={cancelFetchAction}>
                    <input type="hidden" name="run_id" value={runId} />
                    <Button type="submit" variant="neutral">Stop (resumable)</Button>
                  </form>
                )}
                {view.canResume && (
                  <form action={startFetchAction}>
                    <Button type="submit" variant="primary">Resume this harvest</Button>
                  </form>
                )}
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-valuenow={view.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-2 bg-[var(--admin-accent)]" style={{ width: `${view.percent}%` }} />
            </div>
            {view.error && <p className="mt-3 text-xs text-red-300">{view.error}</p>}
            {view.warnings.length > 0 && (
              <div data-testid="fetch-run-warnings" className="mt-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
                {view.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
              </div>
            )}
            <table className="mt-4 w-full text-left text-xs">
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.stage} className="border-t border-white/5">
                    <td className="py-1.5 text-white/80">{r.label}</td>
                    <td className={`py-1.5 font-semibold uppercase ${r.loud ? "text-red-300" : ROW_TONE[r.status]}`}>{r.loud ? `${r.status} · MISSING` : r.status}</td>
                    <td className="py-1.5 text-white/50">{r.detail}</td>
                    <td className="py-1.5 text-right text-white/40">{r.seconds !== null ? `${r.seconds} s` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-white/40">
              Read-only: the harvester can only log in and read. Nothing in Cultivera changes. The page refreshes itself while the harvest runs.
            </p>
          </section>
        )}

        {loaded && (
          <section className={`rounded-xl border p-5 ${report?.go ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5" : "border-red-500/40 bg-red-500/5"}`}>
            <h2 className="text-sm font-semibold text-white">
              Go / no-go: {report ? (report.go ? "GO" : "NO-GO") : "NOT CHECKED"}
            </h2>
            {loaded.verifyProblems.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-red-300">
                {loaded.verifyProblems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {report && (
              <>
                {vendorLine && (
                  <p data-testid="vendor-files-check" className={`mt-3 text-xs ${vendorLine.pass ? "text-[var(--admin-accent)]" : "rounded border border-red-500/50 bg-red-500/10 px-2 py-1 font-semibold text-red-300"}`}>
                    {vendorLine.pass ? "✓" : "✗"} <strong>{vendorLine.id}</strong> — {vendorLine.detail}
                    {!vendorLine.pass && loaded.vendorCoverage.missingTransferIds.length > 0 && (
                      <> Transfers: {loaded.vendorCoverage.missingTransferIds.join(", ")}{loaded.vendorCoverage.missing > loaded.vendorCoverage.missingTransferIds.length ? " …" : ""}</>
                    )}
                  </p>
                )}
                <ul className="mt-3 space-y-1 text-xs">
                  {report.checks.map((c) => (
                    <li key={c.id} className={c.pass ? "text-[var(--admin-accent)]" : "text-red-300"}>
                      {c.pass ? "✓" : "✗"} <strong>{c.id}</strong> — {c.detail}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-white/60">
                  {report.counts.listLots.toLocaleString("en-US")} lots · {report.counts.items.toLocaleString("en-US")} menu items ({report.counts.visibleItems.toLocaleString("en-US")} visible) ·{" "}
                  {report.counts.variants.toLocaleString("en-US")} variants · {report.counts.supplemented} lots restored from the list ·{" "}
                  {report.reconcile.unitsRows.toLocaleString("en-US")} units · ${(report.reconcile.costValueRowsCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} at cost
                </p>
                {report.reconcile.mismatches.length > 0 && (
                  <details className="mt-2 text-xs text-white/60">
                    <summary>{report.reconcile.mismatches.length} lots changed between the export and the list (a sale mid-harvest) — fetch again</summary>
                    <ul className="mt-1 pl-4">
                      {report.reconcile.mismatches.slice(0, 50).map((m) => (
                        <li key={`${m.id}-${m.field}`}>lot {m.id} ({m.barcode}) {m.field}: list {m.list} · export {m.row}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {report.manifestPlan && (
                  <details className="mt-2 text-xs text-white/60">
                    <summary>
                      Original manifests: {report.manifestPlan.summary.matched.toLocaleString("en-US")} lots on{" "}
                      {report.manifestPlan.summary.transfersUsed.toLocaleString("en-US")} real Cultivera transfers ·{" "}
                      {(report.manifestPlan.summary.lots - report.manifestPlan.summary.matched).toLocaleString("en-US")} on{" "}
                      {report.manifestPlan.summary.fallbackGroups} rebuilt (no transfer on record)
                    </summary>
                    <p className="mt-1">
                      Filed later by the manifest step (S2); staging the menu does not wait for it. {report.manifestPlan.summary.matchedVendorByLink} lots were
                      shipped by a distributor under another name and are filed on the distributor&apos;s manifest because Cultivera links them there.{" "}
                      {report.manifestPlan.summary.lotsAlsoOn} re-received barcodes are filed on their first delivery and remember the others.
                    </p>
                    {report.manifestPlan.gate.multiReceiptDiffers.length > 0 && (
                      <p className="mt-1">
                        Cultivera points {report.manifestPlan.gate.multiReceiptDiffers.length} re-received lots at their latest top-up; we file them on the first
                        delivery: {report.manifestPlan.gate.multiReceiptDiffers.slice(0, 10).map((d) => `${d.barcode} → ${d.transferId} (Cultivera ${d.linkIds.join("/")})`).join(", ")}
                      </p>
                    )}
                    <ul className="mt-1 pl-4">
                      {report.manifestPlan.biggest.map((g) => (
                        <li key={g.transferId}>
                          {g.manifestNumber} · {g.vendorLabel} · {g.acceptedAt.slice(0, 10)} · {g.lots} lots
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
            {realDecision && !realDecision.allowed && (
              <ul className="mt-3 list-disc pl-5 text-xs text-[var(--admin-gold)]">
                {realDecision.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="mt-2 text-xs text-white/40">
              Harvest finished {age !== null ? `${Math.round(age)} min ago` : "at an unknown time"} (a real import needs ≤ {MAX_HARVEST_AGE_MINUTES} min).
            </p>

            <form action={importFetchAction} className="mt-4 flex flex-wrap items-center gap-4">
              <input type="hidden" name="run_id" value={runId} />
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" name="test_mode" defaultChecked={!realDecision?.allowed} />
                <span><strong>Test mode</strong>: flag it as rehearsal data (Clean Slate removes it)</span>
              </label>
              {vendorMissing > 0 && (
                <label className="flex items-center gap-2 text-xs font-semibold text-red-300">
                  <input type="checkbox" name="ack_missing_vendor_files" />
                  <span>Stage without the missing vendor files ({vendorMissing}). The ones it got still stage; the rest have no lab results until fetched.</span>
                </label>
              )}
              <Button type="submit" variant="confirm">Stage this harvest for review</Button>
            </form>
            <p className="mt-2 text-xs text-white/40">
              Staging runs the same import a manual upload does: intake, enrichment and the review screen. Nothing publishes until you press Publish. No payables are created, because every Cultivera manifest is already paid.
            </p>
          </section>
        )}

        <p className="text-xs text-white/40">
          <Link href="/admin/menu-imports" className="underline">Back to Menu Imports</Link>
        </p>
      </div>
    </div>
  );
}
