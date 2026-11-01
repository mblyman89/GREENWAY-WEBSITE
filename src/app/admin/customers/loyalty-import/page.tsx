import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import {
  getLoyaltyRun,
  isValidLoyaltyRunId,
  listLoyaltyRuns,
  loadLoyaltyRun,
  type LoyaltyRun,
} from "@/lib/customers/cultivera-loyalty-client";
import { buildApplyRows, crawlSummary, previewApply, type LoyaltyPreview } from "@/lib/customers/cultivera-loyalty-core";
import { creditedCultiveraIds, matchCultiveraIds } from "@/lib/customers/cultivera-loyalty-store";
import { applyLoyaltyAction, cancelLoyaltyCrawlAction, startLoyaltyCrawlAction } from "./actions";

/**
 * CVL - Customers -> Cultivera loyalty. Start the slow crawl of every Cultivera customer record, watch it,
 * review what it found, then apply it to our customers (matched by Cultivera Customer ID).
 */
export const dynamic = "force-dynamic";
// Apply downloads + verifies the files and runs ~34 batches of 500.
export const maxDuration = 300;

const n = (v: number) => v.toLocaleString("en-US");

export default async function LoyaltyImportPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; error?: string; applied?: string; credited?: string; already?: string; enrolled?: string }>;
}) {
  await requirePermission("menu.import");
  const sp = await searchParams;

  let loadError: string | null = null;
  let runId = sp.run && isValidLoyaltyRunId(sp.run) ? sp.run : null;
  let run: LoyaltyRun | null = null;
  try {
    if (!runId) runId = (await listLoyaltyRuns())[0] ?? null;
    if (runId) run = await getLoyaltyRun(runId);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not reach the crawler.";
  }
  const summary = crawlSummary(Boolean(run?.active), run?.state ?? null);

  let preview: LoyaltyPreview | null = null;
  let previewError: string | null = null;
  let badLines = 0;
  if (run && summary.canApply) {
    try {
      const loaded = await loadLoyaltyRun(run.runId);
      badLines = loaded.badLines;
      const built = buildApplyRows(loaded.records, loaded.accrual);
      const ids = built.rows.map((r) => r.external_id);
      const matches = await matchCultiveraIds(ids);
      const ours = new Set(matches.keys());
      const credited = await creditedCultiveraIds(matches);
      preview = previewApply(built.rows, ours, credited, built.problems, loaded.accrual);
    } catch (e) {
      previewError = e instanceof Error ? e.message : "Could not check the crawl.";
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Cultivera loyalty"
        subtitle="Read every customer's loyalty points from Cultivera (the export leaves them out), then add them to our customers."
        breadcrumbs={<Breadcrumbs items={[{ label: "Customers", href: "/admin/customers" }, { label: "Cultivera loyalty" }]} />}
        help={
          <HelpPanel
            id="cultivera-loyalty"
            title="How the loyalty crawl works"
            steps={[
              "Import the Cultivera customer spreadsheet first (Customers → Import). The loyalty is matched to those customers by Cultivera Customer ID.",
              "Press Start crawl. The crawler opens every customer record in Cultivera one at a time, slowly (about 2-3 seconds each, so 16,500 customers take most of a day). It only reads; it never changes Cultivera.",
              "It stops by itself after 8 hours; press Continue and it picks up where it stopped. Nothing is read twice.",
              "When it says Finished, read the preview. Then tick the box and press Apply.",
              "Apply adds each customer's Cultivera point balance to their loyalty account once, as an adjustment named “Cultivera opening balance”. Pressing Apply again never adds it twice.",
            ]}
          >
            <p>
              Cultivera keeps points with cents (509.13). Our points are whole, so each balance is rounded to the
              nearest point (509). The exact Cultivera numbers (balance, points spent, points earned) are saved and
              shown on the customer&apos;s page.
            </p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <FetchRunAutoRefresh active={Boolean(run?.active || run?.state?.status === "running")} everyMs={15_000} />

        {(sp.error || loadError || previewError) && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {sp.error ?? loadError ?? previewError}
          </div>
        )}
        {sp.applied && (
          <div data-testid="loyalty-applied" className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Applied to {n(Number(sp.applied))} customers: {n(Number(sp.credited ?? 0))} opening balances added,{" "}
            {n(Number(sp.already ?? 0))} already had theirs, {n(Number(sp.enrolled ?? 0))} newly enrolled in loyalty.
          </div>
        )}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{runId ? `Crawl ${runId}` : "No crawl yet"}</h2>
              <p data-testid="loyalty-crawl-line" className="mt-1 text-sm text-white/70">{summary.line}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {run?.active ? (
                <form action={cancelLoyaltyCrawlAction}>
                  <input type="hidden" name="run_id" value={run.runId} />
                  <Button type="submit" variant="neutral">Stop (resumable)</Button>
                </form>
              ) : (
                <form action={startLoyaltyCrawlAction} className="flex items-center gap-3">
                  {!summary.canResume && runId && (
                    <label className="flex items-center gap-1 text-xs text-white/60">
                      <input type="checkbox" name="fresh" defaultChecked /> new crawl
                    </label>
                  )}
                  <Button type="submit" variant="primary">{summary.canResume ? "Continue crawl" : "Start crawl"}</Button>
                </form>
              )}
            </div>
          </div>
        </section>

        {preview && run && (
          <section data-testid="loyalty-preview" className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">Preview (nothing has been changed yet)</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatCard label="Customers matched" value={n(preview.matched)} hint={`${n(preview.unmatched)} not in our customers`} accent="muted" />
              <StatCard label="Balances to add" value={n(preview.toCredit)} hint={`${n(preview.pointsToCredit)} points in total`} accent="green" />
              <StatCard label="Already added" value={n(preview.alreadyCredited)} hint="never added twice" accent="muted" />
              <StatCard label="Zero balance" value={n(preview.zeroBalance)} hint="history saved, nothing added" accent="muted" />
            </div>
            <p className="text-xs text-white/60">
              Cultivera totals for matched customers: balance {n(preview.totals.balance)} pts · spent {n(preview.totals.spent)} pts ·
              earned {n(preview.totals.earned)} pts. {n(preview.deletedInCultivera)} were deleted in Cultivera.
            </p>
            {preview.historyDiffers > 0 && (
              <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-3 py-2 text-xs text-[var(--admin-gold)]">
                For {n(preview.historyDiffers)} customers, Cultivera&apos;s balance is not what its own history adds up to
                (for example, Customer ID {preview.historyDiffersSample[0]?.externalId}: balance {preview.historyDiffersSample[0]?.balance}, history{" "}
                {preview.historyDiffersSample[0]?.history}). We use the balance on the Cultivera record, which is what the customer saw.
              </div>
            )}
            {(preview.problems.length > 0 || badLines > 0 || Object.keys(preview.unknownAccrualTypes).length > 0) && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {badLines > 0 && <p>{n(badLines)} lines in the crawl file could not be read.</p>}
                {Object.entries(preview.unknownAccrualTypes).map(([t, c]) => (
                  <p key={t}>{n(c)} Cultivera history rows have a type we do not know ({t}); they are not counted in earned.</p>
                ))}
                {preview.problems.slice(0, 20).map((p) => (
                  <p key={p.externalId + p.problem}>Customer ID {p.externalId}: {p.problem}</p>
                ))}
              </div>
            )}
            {preview.unmatched > 0 && (
              <p className="text-xs text-white/50">
                Not in our customers (import the latest Cultivera spreadsheet to include them): {preview.unmatchedSample.join(", ")}
                {preview.unmatched > preview.unmatchedSample.length ? ", …" : ""}
              </p>
            )}
            <form action={applyLoyaltyAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="run_id" value={run.runId} />
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" name="confirm" required /> I reviewed this preview
              </label>
              <Button type="submit" variant="confirm">Apply to {n(preview.matched)} customers</Button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
