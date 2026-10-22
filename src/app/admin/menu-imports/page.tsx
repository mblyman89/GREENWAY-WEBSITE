import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { listImports, listVersions, getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";
import { countTestData } from "@/lib/pos/import-service";
import { formatDateTime } from "@/lib/pos/format";
import { describeIntakeVersion } from "@/lib/pos/intake-version-copy-core";
import { flagDraftFreshness, FRESHNESS_CHIP } from "@/lib/pos/publish-guard-core";
import { QUEUE_EMPTY_COPY } from "@/lib/pos/publish-queue-core";
import type { PosImportStatus, MenuVersionStatus } from "@/lib/pos/db-types";
import { withBackParam } from "@/lib/admin/back-link-core";
// S00: shared post-approve story (Menu Imports is the one-time Cultivera door).
import { MENU_IMPORTS_PURPOSE_COPY } from "@/lib/catalog/publish-story-core";
// S18: the cutover runbook (publish Cultivera first, then receive).
import { CUTOVER_RUNBOOK_HREF } from "@/lib/inventory/cutover-guard-core";
// S21: once the one-time import went live, say when and collapse the upload.
import { completedSubtitle, storeDate, type MenuImportsCutover } from "@/lib/inventory/menu-imports-cutover-core";
import { readMenuImportsCutover } from "@/lib/pos/menu-imports-cutover";
import { readCutoverDone } from "@/lib/pos/cutover-guard";
import { OneTimeImportTools } from "@/components/admin/catalog/OneTimeImportTools";
import { uploadAndStageImport, cleanSlateTestDataAction } from "./actions";
import { startFetchAction } from "./fetch-actions";
import { harvestMailboxBatchAction, probeHarvestMailboxAction, readKeptDocumentsAction } from "./mail-harvest-actions";
import { readHarvestStatus } from "@/lib/pos/cultivera-mail-harvest-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { harvestConfigLine, harvestMailConfigFromEnv } from "@/lib/pos/cultivera-mail-harvest-core";
import { isCrawlerConfigured } from "@/lib/ai/crawler-client";
import { listPosRuns } from "@/lib/pos/cultivera-fetch-client";
// R50 S10b: the step-by-step migration guide (status only from facts this page reads).
import { buildMenuImportsGuide, MENU_IMPORTS_HELP_STEPS, GUIDE_HREF } from "@/lib/pos/menu-imports-guide-core";
import { MenuImportsGuide } from "@/components/admin/catalog/MenuImportsGuide";

export const dynamic = "force-dynamic";
// R74 S7: "Harvest the next batch" runs inside this page's function (a 200-second batch budget).
export const maxDuration = 300;

const IMPORT_STATUS_STYLE: Record<PosImportStatus, string> = {
  uploaded: "bg-white/10 text-white/70",
  processing: "bg-[var(--admin-gold)]/15 text-[var(--admin-gold)]",
  staged: "bg-[var(--admin-orange)]/15 text-[var(--admin-orange)]",
  published: "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]",
  failed: "bg-red-500/15 text-red-400",
};

const VERSION_STATUS_STYLE: Record<MenuVersionStatus, string> = {
  staged: "bg-[var(--admin-orange)]/15 text-[var(--admin-orange)]",
  published: "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]",
  archived: "bg-white/10 text-white/50",
};

export default async function MenuImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; published?: string; staged?: string; cleaned?: string; notice?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const params = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Menu Imports" subtitle="Upload POS exports and publish the live menu." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5 text-sm text-[var(--admin-gold)]">
            Supabase service-role key is not configured yet. Add the env vars from
            <code className="mx-1 rounded bg-black/40 px-1">docs/BACK_OFFICE_SETUP.md</code>
            to enable menu imports.
          </div>
        </div>
      </div>
    );
  }

  // Load page data defensively. Each helper already returns safe defaults on
  // failure, but we wrap the whole load so a single unexpected throw renders a
  // friendly diagnostic card instead of the full-page "did not load" error.
  let published: Awaited<ReturnType<typeof getPublishedVersion>> = null;
  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  let imports: Awaited<ReturnType<typeof listImports>> = [];
  let intakeStaged: Awaited<ReturnType<typeof listIntakeStagedVersions>> = [];
  let testCounts = { imports: 0, versions: 0 };
  let loadError: string | null = null;

  try {
    [published, versions, imports, intakeStaged, testCounts] = await Promise.all([
      getPublishedVersion(),
      listVersions(30),
      listImports(30),
      listIntakeStagedVersions(30),
      countTestData().catch(() => ({ imports: 0, versions: 0 })),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load menu data.";
    console.error("[menu-imports] page load error:", err);
  }

  // S21: separate bounded reads (listVersions(30) loses the import after ~30
  // auto-publishes). Both fail safe on their own: unknown -> the pre-S21 page.
  const [cutover, uploadRefused]: [MenuImportsCutover, boolean] = await Promise.all([
    readMenuImportsCutover(),
    readCutoverDone(),
  ]);
  // R74 S7: what the email harvest has kept so far (fails soft: 0293 not applied -> says so).
  const harvestCfg = harvestMailConfigFromEnv(process.env);
  const harvestStatus = await readHarvestStatus(createSupabaseAdminClient(), harvestCfg.mailbox).catch(
    (e: unknown) => ({ ready: false as const, why: e instanceof Error ? e.message : String(e) }),
  );
  // R50 S9: recent fetch runs (a crawler outage never breaks the page).
  const recentRuns: string[] = isCrawlerConfigured() ? await listPosRuns().catch(() => []) : [];
  // R50 S10b: the guide. An unknown cutover read never claims progress (every step = "check").
  const guideSteps = buildMenuImportsGuide({
    cutover: cutover.done
      ? { done: true, first: { importId: cutover.first.importId, publishedAt: cutover.first.publishedAt } }
      : { done: false, unknown: cutover.unknown || loadError !== null },
    crawlerConfigured: isCrawlerConfigured(),
    recentRuns,
    imports,
  });

  return (
    <div>
      <AdminPageHeader
        title="Menu Imports"
        subtitle={cutover.done ? completedSubtitle(storeDate(cutover.first.publishedAt)) : MENU_IMPORTS_PURPOSE_COPY}
        breadcrumbs={<Breadcrumbs items={[{ label: "Menu Imports" }]} />}
        help={
          <HelpPanel
            id="menu-imports"
            title="How the Cultivera migration works"
            steps={[...MENU_IMPORTS_HELP_STEPS]}
          >
            <p>
              This page does the one-time move from Cultivera. The step-by-step guide below shows where you are and
              links straight to each next screen. After the import is live, your menu is built from what you receive
              and approve, with no more spreadsheet uploads. Prices come from your invoices, manifests and COAs at
              approval, and stock comes from the quantity you received.
            </p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Migrated lots that are dead in Cultivera (no product master, no barcode, no received date) are expected. They are flagged
              on the{" "}
              <Link href={GUIDE_HREF.ccrsCleanup} className="text-[var(--admin-accent)] hover:underline">
                CCRS migration clean-up panel
              </Link>{" "}
              and zeroed out by Reconciliation in your first CCRS upload. Nothing is ever sent as a Delete.
            </p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Doing the one-time Cultivera upload?{" "}
              <Link href={CUTOVER_RUNBOOK_HREF} className="text-[var(--admin-accent)] hover:underline">
                Follow the Cultivera cutover runbook
              </Link>{" "}
              &mdash; publish Cultivera first, then receive.
            </p>
            <SopSheetLink slug="publish" />
          </HelpPanel>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {loadError && (
          <div className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5 text-sm text-[var(--admin-gold)]">
            <p className="font-semibold">We couldn&apos;t load your existing menu history just now.</p>
            <p className="mt-1 text-[var(--admin-gold)]/80">
              This is usually a brief connection hiccup — your data is safe. You can still upload below,
              or reload the page in a moment. (Technical detail: {loadError})
            </p>
          </div>
        )}
        {params.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(params.error)}
          </div>
        )}
        {/* S18: the cutover release / rebuild outcome, told plainly. */}
        {params.notice && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">
            {decodeURIComponent(params.notice)}
          </div>
        )}
        {params.published && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Menu published. The public site now reflects this version.
          </div>
        )}
        {params.staged && (
          <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-orange)]">
            Import staged for review. Open it from the history list at the bottom, work Fact Review and the warnings, then
            publish. The guide above shows the next step.
          </div>
        )}
        {params.cleaned && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Clean Slate complete — {decodeURIComponent(params.cleaned)} Real data and your knowledge base were untouched.
          </div>
        )}

        {/* R50 S10b: where you are in the migration, and the next screen to open. */}
        <MenuImportsGuide steps={guideSteps} importLive={cutover.done} />

        {/* Live status */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Live menu version"
            value={published ? `${published.item_count}` : "None"}
            hint={published ? `Published ${formatDateTime(published.published_at)}` : "No version published yet"}
            accent={published ? "green" : "muted"}
          />
          <StatCard
            label="Live variants"
            value={published ? `${published.variant_count}` : "—"}
            hint={published ? `${published.vendor_count} vendors` : "—"}
            accent="muted"
          />
          <StatCard
            label="Staged drafts"
            value={`${versions.filter((v) => v.status === "staged").length}`}
            hint="Awaiting review / publish"
            accent="orange"
          />
        </div>

        {/* Menu drafts auto-carried from receiving (intake-origin, no POS upload) */}
        <section className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-5">
          <h2 className="text-sm font-semibold text-white">Menu drafts from receiving</h2>
          <p className="mt-1 text-xs text-white/50">
            When you approve a received product with a price, it&apos;s published to the live menu
            automatically &mdash; <strong>no upload, no publish click needed</strong>. This section is
            the safety net: if an automatic publish ever hiccups, the staged menu update lands here so
            you can press Publish yourself.
          </p>
          <p className="mt-2 text-xs text-white/50">
            Prefer the new{" "}
            <Link href="/admin/publish" className="text-[var(--admin-accent)] hover:underline">
              Publish command center
            </Link>{" "}
            &mdash; it compares each draft with the live menu and marks the one that keeps everything.
            Drafts created before the live menu are archived automatically.
          </p>
          {intakeStaged.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">
              {QUEUE_EMPTY_COPY}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
              {/* S15: no diff is read on this page (zero extra reads), so the
                  only fact shown is the time-derived one - superseded. The
                  item comparison lives on the Publish command center. */}
              {flagDraftFreshness(intakeStaged, {
                liveCreatedAt: published?.created_at ?? null,
                removedById: new Map(),
              }).map((v) => {
                // S01: pure, no I/O — reads the summary_json this row carries.
                const story = describeIntakeVersion(v);
                return (
                  <div
                    key={v.id}
                    className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1.4fr_1fr_auto]"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {story.source ?? formatDateTime(v.created_at)}
                      </p>
                      <p className="text-xs text-white/40">
                        {story.source ? <>{formatDateTime(v.created_at)} &middot; </> : null}
                        {story.counts}
                      </p>
                      <p
                        className={`mt-0.5 text-xs ${
                          story.tone === "failed" ? "text-red-300" : "text-[var(--admin-gold)]"
                        }`}
                      >
                        {story.headline}
                        {story.action ? <> &mdash; {story.action}</> : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                      {v.freshness === "superseded" && (
                        <span
                          className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/50"
                          title="Created before the live menu. It is archived automatically the next time a menu goes live."
                        >
                          {FRESHNESS_CHIP.superseded}
                        </span>
                      )}
                      <span className="rounded bg-[var(--admin-orange)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-orange)]">
                        staged
                      </span>
                      {v.item_count} items &middot; {v.variant_count} variants
                      {v.warning_count > 0 && (
                        <span className="text-[var(--admin-gold)]">{v.warning_count} to fix</span>
                      )}
                    </div>
                    <Link
                      href={withBackParam(`/admin/menu-imports/version/${v.id}`, params)}
                      className="admin-focus justify-self-end rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)] transition hover:bg-[var(--admin-accent)]/20"
                    >
                      Review &amp; publish
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Upload (S21: behind "Show one-time import tools" once the import went live) */}
        <div id="fetch-cultivera" className="scroll-mt-6">
        <OneTimeImportTools cutover={cutover} refused={uploadRefused}>
        {/* R50 S9: the one button. Logs in to Cultivera POS (read-only), harvests everything, and checks it before staging. */}
        <section className="rounded-xl border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5 p-5">
          <h2 className="text-sm font-semibold text-white">Fetch everything from Cultivera POS</h2>
          <p className="mt-1 text-xs text-white/50">
            One press logs in to Cultivera POS and reads every lot, product, manifest and batch. It only reads, so
            nothing in Cultivera changes. It cleans the data to Greenway conventions and checks it: every lot
            present, units and cost matching to the cent, nothing hidden. Then you stage it for review, the same
            way a manual upload works. Nothing publishes on its own. It takes about 8 minutes.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-white/60" data-testid="fetch-what-next">
            <li>Press the button. You land on the run page, which shows live progress. You can leave and come back.</li>
            <li>When it finishes, read the go / no-go report. GO means every lot, unit and cent matched.</li>
            <li>On a GO, press &ldquo;Stage this harvest for review&rdquo;. On a NO-GO, fix what it names and fetch again.</li>
          </ol>
          {isCrawlerConfigured() ? (
            <>
            <form action={startFetchAction} className="mt-4 flex flex-wrap items-center gap-4">
              <Button type="submit" variant="primary">Fetch It All, Fuck Cultivera</Button>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" name="fresh" />
                <span>Start fresh. Leave this off to resume an unfinished fetch.</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-white/60" data-testid="fetch-count-date">
                <span>Shelf count date (only for the Oct 30 count fetch):</span>
                <input type="date" name="count_date" className="rounded border border-white/20 bg-black px-2 py-1 text-white" />
              </label>
            </form>
            <p className="mt-2 text-xs text-white/40">
              The count fetch: set the count date (10/30) and press after the store closes on 10/31 and before it opens
              on 11/01. It also reads Cultivera&apos;s Sales Details for 10/31, which the{" "}
              <Link href="/admin/menu-imports/count" className="underline">count page</Link> takes off the shelf count. After you publish, the{" "}
              <Link href="/admin/menu-imports/reconcile" className="underline">go / no-go check</Link> shows whether every Cultivera unit became a lot.
            </p>
            </>
          ) : (
            <p className="mt-3 text-xs text-[var(--admin-gold)]">
              The crawler is not connected. Set CRAWLER_BASE_URL and CRAWLER_SHARED_SECRET on the site, and
              CULTIVERA_POS_USERNAME and CULTIVERA_POS_PASSWORD on the crawler.
            </p>
          )}
          {recentRuns.length > 0 && (
            <p className="mt-3 text-xs text-white/40">
              Recent fetches (newest first, open one to see its go / no-go):{" "}
              {recentRuns.slice(0, 5).map((r, i) => (
                <span key={r}>
                  {i > 0 && " · "}
                  <Link href={`/admin/menu-imports/fetch/${r}`} className="underline">{r}</Link>
                </span>
              ))}
            </p>
          )}
        </section>

        {/* R74 S5: the vendor mailbox the email harvest will read (stephen@ by default). Read-only test. */}
        <section id="mail-harvest" className="scroll-mt-6 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="mail-harvest">
          <h2 className="text-sm font-semibold text-white">Vendor mailbox (email harvest)</h2>
          <p className="mt-1 text-xs text-white/50">
            Every Cultivera manifest was emailed to this mailbox. The email harvest reads it, back as far as it goes, to
            find the vendor files Cultivera does not have. Google must be set up first (docs/CULTIVERA_GMAIL_HARVEST_SETUP.md).
            The test signs in and runs the search once. It opens no email and stores nothing.
          </p>
          {(() => {
            const line = harvestConfigLine(harvestCfg);
            return (
              <p className={`mt-2 text-xs ${line.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`} data-testid="mail-harvest-config">
                {line.text}
              </p>
            );
          })()}
          <form action={probeHarvestMailboxAction} className="mt-3">
            <Button type="submit" variant="neutral">Test the vendor mailbox</Button>
          </form>
          {/* R74 S7: the harvest itself, one batch per press (up to 47 emails, resumable). */}
          <div className="mt-4 border-t border-white/10 pt-4" data-testid="mail-harvest-run">
            <p className="text-xs text-white/50">
              Each press reads up to 47 more emails, oldest page first, and keeps every vendor file it finds (attached
              JSON, CSV, PDF or spreadsheet, and the WCIA transfer link in Cultivera&apos;s emails). Files are kept
              privately; nothing in the mailbox changes. Press again until it says Finished. A second press while one is
              running stores nothing twice.
            </p>
            {harvestStatus.ready ? (
              <p className="mt-2 text-xs text-white/70" data-testid="mail-harvest-status">
                {harvestStatus.cursorLine} Kept so far: {harvestStatus.emails} email{harvestStatus.emails === 1 ? "" : "s"},{" "}
                {harvestStatus.parsed} document{harvestStatus.parsed === 1 ? "" : "s"} with barcodes, {harvestStatus.stored} PDF /
                spreadsheet kept to read later, {harvestStatus.unreadable} without barcodes, {harvestStatus.failed} that
                could not be downloaded.
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--admin-gold)]" data-testid="mail-harvest-status">{harvestStatus.why}</p>
            )}
            <form action={harvestMailboxBatchAction} className="mt-3">
              <Button type="submit" variant="neutral" disabled={!harvestCfg.configured || !harvestStatus.ready}>
                Harvest the next batch
              </Button>
            </form>
          </div>
          {/* R74 S9: read the kept PDFs (LlamaParse, checked against the PDF's own text) and spreadsheets (exact cells). */}
          <div className="mt-4 border-t border-white/10 pt-4" data-testid="mail-read-run">
            <p className="text-xs text-white/50">
              Reads the kept PDFs and spreadsheets, up to 12 per press, oldest email first. PDFs are read by LlamaParse
              (the same reader as the inbox intake; the PDF&apos;s own text is used if LlamaParse is unavailable), and any
              barcode LlamaParse sees that the PDF&apos;s own text does not contain is dropped, never guessed.
              Spreadsheets are read cell by cell; a barcode is only taken from a column headed Barcode, Inventory ID,
              Lot ID or similar. A file with no barcodes is marked &ldquo;without barcodes&rdquo; with the reason.
            </p>
            {harvestStatus.ready ? (
              <p className="mt-2 text-xs text-white/70" data-testid="mail-read-status">
                {harvestStatus.stored === 0
                  ? "Nothing waiting to be read."
                  : `${harvestStatus.stored} kept PDF / spreadsheet${harvestStatus.stored === 1 ? "" : "s"} waiting to be read.`}
              </p>
            ) : null}
            <form action={readKeptDocumentsAction} className="mt-3">
              <Button type="submit" variant="neutral" disabled={!harvestStatus.ready || harvestStatus.stored === 0}>
                Read the kept PDFs and spreadsheets
              </Button>
            </form>
          </div>
        </section>

        <details className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white/70">Fallback: upload the two exports by hand</summary>
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-white">Upload a new POS export</h2>
          <p className="mt-1 text-xs text-white/40">
            Select the two spreadsheets exported from your POS. We&apos;ll transform them into a
            staged menu you can review before anything goes live. Nothing publishes automatically.
          </p>
          <p className="mt-2 text-xs text-[var(--admin-gold)]">
            One time only.{" "}
            <Link href={CUTOVER_RUNBOOK_HREF} className="font-semibold underline">
              Read the Cultivera cutover runbook
            </Link>{" "}
            first: publish the Cultivera upload before approving anything in receiving.
          </p>
          <form action={uploadAndStageImport} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-white/70">PRODUCTS.xlsx</span>
              <input
                name="products"
                type="file"
                accept=".xlsx,.xls"
                required
                className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white/80 file:mr-3 file:rounded file:border-0 file:bg-[var(--admin-accent)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-white/70">INVENTORIES.xlsx</span>
              <input
                name="inventories"
                type="file"
                accept=".xlsx,.xls"
                required
                className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white/80 file:mr-3 file:rounded file:border-0 file:bg-[var(--admin-accent)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
              />
            </label>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" name="test_mode" />
                <span>
                  <strong>Test mode</strong> — flag this upload as test/rehearsal data. Test uploads can
                  be wiped later with Clean Slate without touching real data.
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary">
                Upload &amp; stage for review
              </Button>
            </div>
          </form>
        </section>
        </details>
        </OneTimeImportTools>
        </div>

        {/* Clean Slate — remove only test data */}
        {canPublish && (
          <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-5">
            <h2 className="text-sm font-semibold text-white">Clean Slate — reset test data</h2>
            <p className="mt-1 text-xs text-white/50">
              Permanently deletes <strong>only</strong> the imports and menu versions marked as
              test data ({testCounts.imports} test import{testCounts.imports === 1 ? "" : "s"} ·{" "}
              {testCounts.versions} test version{testCounts.versions === 1 ? "" : "s"} right now). It never
              touches your <strong>real</strong> imports, your real menu, or your validated cannabis
              knowledge base.
            </p>
            <p className="mt-2 text-xs text-[var(--admin-gold)]/90">
              If a <strong>test</strong> version is currently LIVE on the shop, this removes it and
              automatically restores your previous real menu (or leaves the menu empty if there was
              never a real one). Your real published menu is never deleted.
            </p>
            {testCounts.imports === 0 && testCounts.versions === 0 ? (
              <p className="mt-3 text-xs text-white/40">No test data to clean right now.</p>
            ) : (
              <form action={cleanSlateTestDataAction} className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-white/70">
                    Type <code className="rounded bg-black/40 px-1">DELETE TEST DATA</code> to confirm
                  </span>
                  <input
                    name="confirm"
                    type="text"
                    autoComplete="off"
                    placeholder="DELETE TEST DATA"
                    className="w-64 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white/80"
                  />
                </label>
                <Button type="submit" variant="danger">
                  Wipe test data
                </Button>
              </form>
            )}
          </section>
        )}

        {/* Versions / history */}
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
          <div className="border-b border-white/10 px-5 py-3 text-sm font-semibold text-white">
            Import history
          </div>
          <div className="divide-y divide-white/10">
            {imports.map((imp) => {
              const version = versions.find((v) => v.import_id === imp.id);
              return (
                <div
                  key={imp.id}
                  className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{formatDateTime(imp.created_at)}</p>
                    <p className="text-xs text-white/40">
                      {imp.products_filename ?? "PRODUCTS"} + {imp.inventories_filename ?? "INVENTORIES"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {imp.is_test && (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                        test
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${IMPORT_STATUS_STYLE[imp.status] ?? "bg-white/10 text-white/70"}`}>
                      {imp.status}
                    </span>
                    {version && (
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${VERSION_STATUS_STYLE[version.status] ?? "bg-white/10 text-white/50"}`}>
                        v: {version.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/60">
                    {version ? (
                      <>
                        {version.item_count} items · {version.variant_count} variants
                        {version.error_count > 0 && (
                          <span className="ml-2 text-red-400">{version.error_count} err</span>
                        )}
                        {version.warning_count > 0 && (
                          <Link
                            href={`${withBackParam(`/admin/menu-imports/${imp.id}`, params)}#diagnostics`}
                            data-testid="import-warn-link"
                            className="ml-2 text-[var(--admin-gold)] underline-offset-2 hover:underline"
                          >
                            {version.warning_count} warn — fix
                          </Link>
                        )}
                      </>
                    ) : imp.error_message ? (
                      <span className="text-red-400">{imp.error_message.slice(0, 60)}</span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <Link
                    href={withBackParam(`/admin/menu-imports/${imp.id}`, params)}
                    className="admin-focus justify-self-end rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)] hover:text-[var(--admin-text)]"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
            {imports.length === 0 && (
              <p className="px-5 py-8 text-sm text-[var(--admin-text-faint)]">
                No imports yet. Press Fetch above (step 1 of the guide) to stage your Cultivera menu.
              </p>
            )}
          </div>
        </section>

        {!canPublish && (
          <p className="text-xs text-white/40">
            Your role can upload and review imports, but publishing the live menu requires a manager
            or admin.
          </p>
        )}
      </div>
    </div>
  );
}
