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
import { applyCountAction, uploadCountAction } from "./actions";

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
  searchParams: Promise<{ import?: string; batch?: string; policy?: string; error?: string; notice?: string }>;
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

        <ScannerSetupSection />

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">1. Download a scan workbook (one per counter)</h2>
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
          <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-preview">
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

            <form method="get" className="flex items-center gap-3 text-xs text-white/70">
              <input type="hidden" name="import" value={preview.importId} />
              <input type="hidden" name="batch" value={preview.batchId} />
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
