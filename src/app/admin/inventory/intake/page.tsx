import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Button } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { listManifests, countManifestsByStatus, findDuplicateTwinsFor } from "@/lib/inventory/intake-store";
import { getParseStatusByManifestNumber } from "@/lib/inbound-email/llamaparse-status-server";
import {
  listInboundEmails,
  extractLinksFromNote,
} from "@/lib/inbound-email/inbound-store";
import {
  normalizeStage,
  STAGE_META,
  classifyEta,
  INBOUND_SOURCE_NOTE,
  type ManifestStage,
} from "@/lib/inventory/manifest-pipeline-core";
import {
  importManifestAction,
  importManifestFromUrlAction,
  importManifestCsvAction,
  importManifestPdfAction,
  importManifestBatchAction,
  listKbBackfillManifestIdsAction,
  promoteManifestChunkToKbAction,
  reprocessIntelligenceAction,
  setInvoiceNumberAction,
  dismissDuplicateManifestAction,
  checkMailboxNowAction,
  findInboundEmailAction,
  retryInboundEmailAction,
  resolveInboundEmailAction,
} from "./actions";
import { InboundAttentionPanel } from "@/components/admin/inventory/InboundAttentionPanel";
import { loadAttention } from "@/lib/inbound-email/inbound-reconcile-store";
import { BatchTransferImport } from "@/components/admin/inventory/BatchTransferImport";
import { KbBackfillPanel } from "@/components/admin/inventory/KbBackfillPanel";
import {
  EmailIntakeTable,
  type ManifestDownloadLinks,
  type ArchivedDocLink,
} from "@/components/admin/inventory/EmailIntakeTable";
import { listManifestDocLinks } from "@/lib/inventory/manifest-docs";
import { ReceivingTabs } from "@/components/admin/inventory/ReceivingTabs";
import {
  applyIntakeView,
  countProcessedRows,
  invoiceNumberForRow,
} from "@/lib/inventory/manifest-table-core";
import {
  parseReceivingFilters,
  hasActiveFilters,
  applyNativeFilters,
  applyCultiveraFilters,
  receivingViewLinks,
  vendorOptions,
  filterSummary,
  summarizeCultivera,
  countSources,
  pageSlice,
  CULTIVERA_TABLE_PAGE_SIZE,
} from "@/lib/inventory/receiving-table-core";
import { loadReceivingCultiveraRows } from "@/lib/inventory/receiving-cultivera-store";
import { groupByVendor } from "@/lib/inventory/cultivera-vendor-core";
import { ReceivingFilterBar } from "@/components/admin/inventory/ReceivingFilterBar";
import { CultiveraManifestTable } from "@/components/admin/inventory/CultiveraManifestTable";
import { resolveReceivingTab } from "@/lib/inventory/receiving-tabs-core";
import { DismissibleBanner } from "@/components/admin/inventory/DismissibleBanner";
import { healLabelVendors, loadInvoiceAmounts } from "@/lib/inventory/invoice-adjustments-store";

export const dynamic = "force-dynamic";
/**
 * Fix Phase 3.2a: the mailbox actions (Check the mailbox now, Find an email,
 * Try again) run in this page's function and can read several emails in full
 * (RUN_BUDGET_MS 200 s), so the page gets the same 300 s ceiling as the cron.
 */
export const maxDuration = 300;

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    kbdone?: string;
    kbnew?: string;
    kberr?: string;
    repdone?: string;
    replots?: string;
    repitems?: string;
    reperr?: string;
    tab?: string;
    back?: string;
    view?: string;
    invoice?: string;
    /** R36: the Dismiss duplicate result (summary) or refusal (message). */
    dismissed?: string;
    dismisserr?: string;
    /** Fix Phase 3.2a (G-17): mailbox check / Find / Try again / Resolved results. */
    mailcheck?: string;
    mailcheckerr?: string;
    mailfind?: string;
    mailfinderr?: string;
    mailretry?: string;
    mailretryerr?: string;
    mailresolved?: string;
    mailresolveerr?: string;
    /** R50 S10a: table filters + sorting (receiving-table-core). */
    q?: string;
    vendor?: string;
    status?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const {
    error,
    kbdone,
    kbnew,
    kberr,
    repdone,
    replots,
    repitems,
    reperr,
    tab,
    back,
    view,
    invoice,
    dismissed,
    dismisserr,
    mailcheck,
    mailcheckerr,
    mailfind,
    mailfinderr,
    mailretry,
    mailretryerr,
    mailresolved,
    mailresolveerr,
  } = sp;

  // SLICE 101 — the owner's table filter: default hides accepted + partially
  // accepted rows (done processing) so the manifests still needing attention
  // are what staff see first; ?view=all shows everything, open rows first.
  // R50 S10a: a third view lists the manifests rebuilt from Cultivera, and
  // every view gets filters + sorting (all parsed by receiving-table-core).
  const filters = parseReceivingFilters({ ...sp, view });
  const intakeView = filters.view === "all" ? "all" : "action";
  const isCultiveraView = filters.view === "cultivera";

  // H15d — which tab is showing. Explicit ?tab= wins; a manual-form error
  // redirect (or a KB-backfill result banner) auto-opens Manual tools so its
  // banner lands next to the form that produced it; default is the email hero.
  const activeTab = resolveReceivingTab({ tab, error, kbdone, repdone });

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Receiving"
          subtitle="Import vendor JSON manifests."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Receiving" },
              ]}
            />
          }
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migration 0023 to enable intake.
          </div>
        </div>
      </div>
    );
  }

  // R50 S10a: with a filter active the native list reads deeper (newest
  // 1,000 instead of 200) so a vendor or date filter can reach older
  // deliveries; the table still renders at most NATIVE_DISPLAY_CAP rows.
  const NATIVE_DISPLAY_CAP = 200;
  const nativeLimit = !isCultiveraView && hasActiveFilters(filters) ? 1000 : 200;
  const nowMs = Date.now();
  const [manifests, counts, inboundEmails, cultivera, attention] = await Promise.all([
    listManifests({ limit: nativeLimit }),
    countManifestsByStatus(),
    listInboundEmails(15),
    isCultiveraView ? loadReceivingCultiveraRows() : Promise.resolve(null),
    // Fix Phase 3.2a (G-17): emails that did not make a manifest + the mailbox check's health.
    loadAttention(nowMs),
  ]);

  // The rows the native table shows: view (open/all) -> filters -> sort -> cap.
  const viewRows = applyIntakeView(manifests, intakeView);
  const filteredNative = applyNativeFilters(
    viewRows.map((m) => ({ ...m, invoice: invoiceNumberForRow(m) })),
    filters,
  );
  const tableRows = isCultiveraView ? [] : filteredNative.slice(0, NATIVE_DISPLAY_CAP);
  const nativeVendors = vendorOptions(viewRows.map((m) => m.vendor_label));

  // The Cultivera view: every rebuilt manifest, filtered, sorted, paged.
  const cultiveraFiltered = cultivera && cultivera.ok ? applyCultiveraFilters(cultivera.rows, filters) : [];
  const cultiveraPage = pageSlice(cultiveraFiltered, filters.page, CULTIVERA_TABLE_PAGE_SIZE);
  const cultiveraSummary = cultivera && cultivera.ok ? summarizeCultivera(cultivera.rows) : null;
  // R74 S11: where each manifest came from (chips), and the by-vendor roll-up
  // of the filtered rows (every row, not one page) when grouped by vendor.
  const cultiveraSources = cultivera && cultivera.ok ? countSources(cultivera.rows) : null;
  const cultiveraVendors =
    cultivera && cultivera.ok && filters.group === "vendor" ? groupByVendor(cultiveraFiltered, cultivera.tallyRead) : null;
  const viewLinks = receivingViewLinks(filters, {
    processed: countProcessedRows(manifests),
    cultivera: counts.migrated,
  });

  // R36 #2 - rows that are a second copy of the same manifest (same manifest
  // # + vendor, both live): flagged "Duplicate" with a Dismiss button. Looked
  // up across ALL rows with those numbers, not just the rows listed.
  const twinsById = await findDuplicateTwinsFor(
    tableRows.filter((m) => m.status !== "dismissed"),
  );

  // Overdue in-transit manifests bubble up as a banner (the one summary the
  // single Incoming table doesn't call out on its own).
  const overdue = manifests.filter(
    (m) => normalizeStage(m.status) === "in_transit" && classifyEta(m.eta_date) === "overdue",
  );

  // PR-A — document-AI parse status per manifest (llama / FB) for the "AI"
  // column. Read-only over the ai_usage ledger; keyed by manifest_number.
  const parseStatusByManifest = await getParseStatusByManifestNumber(
    tableRows.map((m) => m.manifest_number),
  );

  // H15c — join the email fetch trail's download links (manifest/invoice PDFs)
  // onto their staged manifests for the hero table's ⬇ buttons.
  const linksByManifestId = new Map<string, ManifestDownloadLinks>();
  for (const r of inboundEmails) {
    if (!r.manifest_id || linksByManifestId.has(r.manifest_id)) continue;
    const links = extractLinksFromNote(r.note);
    if (links.invoiceUrl || links.manifestUrl) {
      linksByManifestId.set(r.manifest_id, links);
    }
  }

  // SLICE 69 — OUR archived copies of every document each email carried
  // (private bucket, signed URLs). Preferred over the vendor's links above,
  // which expire within hours; these buttons work for EVERY row, forever.
  const docsByManifestId: Map<string, ArchivedDocLink[]> = await listManifestDocLinks(
    tableRows.map((m) => m.id),
  );

  // Fix 3.4 (owner: "i want the system to keep trying to find the name of the
  // vendor for that manifest ... no exceptions"): every page load re-tries any
  // row whose Vendor is a label ("Manifest ID") - documents, license lookup,
  // the sender's name. Healed names show on the next load (best-effort).
  void healLabelVendors(tableRows, 10).catch(() => 0);
  // Fix 3.4 (owner: "i want the invoice amount to be shown on the receiving
  // table"): lines minus credits found on the invoice / added by hand.
  const invoiceAmountByManifestId = await loadInvoiceAmounts(tableRows.map((m) => m.id));

  const errorMsg =
    error === "empty"
      ? "Paste the vendor JSON before importing."
      : error === "emptyurl"
        ? "Paste the Transfer Data Link before importing."
        : error === "fetch"
          ? "Couldn't fetch that link — it may have expired or be unreachable. Paste the JSON directly instead."
          : error === "parse"
            ? "That text isn't valid JSON."
            : error === "nolines"
              ? "No line items were found in that file."
              : error === "emptycsv"
                ? "Paste the CCRS manifest.csv before importing."
                : error === "csvparse"
                  ? "That text isn't a valid CCRS manifest.csv (no item header row found)."
                  : error === "emptypdf"
                    ? "Choose a PDF manifest file before uploading."
                    : error === "notpdf"
                      ? "That file isn't a PDF. Upload the manifest PDF the vendor emailed."
                      : error === "pdfscanned"
                        ? "That PDF has no readable text (it looks like a scanned image). Paste the JSON/CSV manifest instead."
                        : error === "pdfparse"
                          ? "Couldn't read a WA LCB shipping document from that PDF (no Manifest ID / item table found)."
                          : error === "save"
                            ? "Something went wrong staging the manifest."
                            : error === "kbbackfill"
                              ? "The KB backfill couldn't run — check the server logs."
                              : error === "reprocess"
                                ? "The re-run couldn't read your data — check the server logs."
                                : null;

  const stageMeta = (s: ManifestStage) => STAGE_META[s];

  return (
    <div>
      <AdminPageHeader
        title="Receiving"
        subtitle="Every incoming transfer, grouped by where it is right now — pending, in transit, awaiting intake, accepted. Nothing goes live until you accept it."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Receiving" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="intake"
            title="How inbound transfers work in Washington"
            steps={[
              "There is NO automatic CCRS inbound feed — the sending licensee uploads the manifest and everyone gets an email.",
              "So build the inbound record two ways: paste the vendor's Transfer Data Link / WCIA JSON, or enter it by hand.",
              "We stage a DRAFT: pending status, lots in quarantine, COAs captured to the KB.",
              "Move it along the pipeline (in transit → received), verify counts, then accept to activate or reject to discard.",
            ]}
          >
            <p>{INBOUND_SOURCE_NOTE}</p>
            <SopSheetLink slug="receive" />
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        <CatalogStageStrip current="intake" />

        {/* Pipeline stat cards — full lifecycle, not just 3 */}
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label={stageMeta("pending").label}
            value={counts.pending}
            accent={counts.pending > 0 ? "gold" : "muted"}
          />
          <StatCard
            label={stageMeta("in_transit").label}
            value={counts.in_transit}
            accent={counts.in_transit > 0 ? "gold" : "muted"}
          />
          <StatCard
            label={stageMeta("received").label}
            value={counts.received}
            accent={counts.received > 0 ? "gold" : "muted"}
          />
          <StatCard label={stageMeta("accepted").label} value={counts.accepted} accent="green" />
          <StatCard label={stageMeta("rejected").label} value={counts.rejected} accent="muted" />
        </div>
        {counts.migrated > 0 ? (
          <p className="text-xs text-[var(--admin-text-faint)]" data-testid="intake-migrated-note">
            Moved from Cultivera: {counts.migrated.toLocaleString("en-US")} rebuilt manifest
            {counts.migrated === 1 ? "" : "s"}. They are history, not deliveries, so the counts above leave
            them out. See them all, with Complete / Needs attention, under{" "}
            <Link href={viewLinks[2].href} className="font-semibold text-[var(--admin-accent)] hover:underline">
              Cultivera manifests
            </Link>
            . The full intake export includes them.
          </p>
        ) : null}

        {/* Export: full intake picture (manifests + every lot line) */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm">
          <span className="font-semibold text-[var(--admin-text)]">Export intake</span>
          <span className="text-xs text-[var(--admin-text-faint)]">
            Two sheets — every manifest and every lot line, with all fields.
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Link
              href="/admin/inventory/intake/export?format=xlsx"
              className="rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)] hover:brightness-105"
              title="Download Excel (.xlsx)"
            >
              ⬇ Excel (.xlsx)
            </Link>
            <Link
              href="/admin/inventory/intake/export?format=csv"
              className="rounded border border-[var(--admin-border)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
              title="Download CSV"
            >
              ⬇ CSV
            </Link>
          </span>
        </div>

        {overdue.length > 0 && (
          <DismissibleBanner
            rememberKey={`overdue:${overdue.map((m) => m.id).sort().join(",")}`}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
          >
            🚨 {overdue.length} in-transit manifest{overdue.length === 1 ? "" : "s"} past ETA — follow up with the transporter.
          </DismissibleBanner>
        )}

        {/* Fix Phase 3.2a (G-17): an email that did not make a manifest is never
            silent - it is counted here on every tab and listed under Needs attention. */}
        {attention.summary.total > 0 && (
          <DismissibleBanner
            rememberKey={`attention:${attention.summary.total}:${attention.summary.needPerson}`}
            className="rounded-[var(--admin-radius)]"
          >
          <a
            href="/admin/inventory/intake?tab=email#needs-attention"
            data-testid="attention-banner"
            className="block rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)] hover:brightness-105"
          >
            📭 {attention.summary.total} vendor email{attention.summary.total === 1 ? "" : "s"} did not make a manifest
            {attention.summary.needPerson > 0
              ? ` (${attention.summary.needPerson} need${attention.summary.needPerson === 1 ? "s" : ""} you)`
              : " (the system is fetching again by itself)"}
            . Open Needs attention &rarr;
          </a>
          </DismissibleBanner>
        )}
        {(
          [
            [mailcheck, "ok", "Mailbox checked."],
            [mailcheckerr, "err", "Mailbox check:"],
            [mailfind, "ok", "Find an email:"],
            [mailfinderr, "err", "Find an email:"],
            [mailretry, "ok", "Try again:"],
            [mailretryerr, "err", "Try again:"],
            [mailresolved, "ok", "Resolved:"],
            [mailresolveerr, "err", "Not resolved:"],
          ] as const
        ).map(([text, tone, title]) =>
          text ? (
            <DismissibleBanner
              key={title + tone}
              testId={`mail-banner-${tone}`}
              className={
                tone === "ok"
                  ? "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
                  : "rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
              }
            >
              <strong>{title}</strong> {text}
            </DismissibleBanner>
          ) : null,
        )}

        {/* Result banners stay ABOVE the tabs so they can never be hidden
            behind the other tab; resolveReceivingTab additionally auto-opens
            Manual tools so the form that produced the error is on screen. */}
        {errorMsg && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </DismissibleBanner>
        )}

        {kbdone && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            KB backfill finished — {kbdone} manifest{kbdone === "1" ? "" : "s"} processed,{" "}
            {kbnew ?? 0} product fact{kbnew === "1" ? "" : "s"} promoted as KB drafts
            {kberr && kberr !== "0" ? ` (${kberr} manifest(s) had errors — see server logs)` : ""}.
            Nothing was published — validate the drafts in the KB review lanes.
          </DismissibleBanner>
        )}

        {repdone && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Re-run finished — {replots ?? 0} lot{replots === "1" ? "" : "s"} and{" "}
            {repitems ?? 0} live menu item{repitems === "1" ? "" : "s"} were improved with verified
            facts, product types, or cleaner display names
            {reperr && reperr !== "0" ? ` (${reperr} row(s) failed to save — see server logs)` : ""}.
            Everything else already had its facts or gave the engines nothing verifiable — no guesses were written.
          </DismissibleBanner>
        )}

        {invoice === "saved" && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Invoice # updated — your correction now shows on this manifest everywhere the invoice number appears.
          </DismissibleBanner>
        )}
        {invoice === "cleared" && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Invoice # correction cleared — this manifest is back to the value read from its documents.
          </DismissibleBanner>
        )}
        {/* R36 #2 - Dismiss duplicate result. Text comes from our own server
            action (describeDismissResult / the SQL refusal), rendered as
            text (React escapes it). */}
        {dismissed && (
          <DismissibleBanner
            testId="dismiss-banner"
            className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
          >
            <strong>Duplicate dismissed.</strong> {dismissed}
          </DismissibleBanner>
        )}
        {dismisserr && (
          <DismissibleBanner
            testId="dismiss-error"
            className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
          >
            <strong>Not dismissed.</strong> {dismisserr}
          </DismissibleBanner>
        )}
        {invoice === "error" && (
          <DismissibleBanner className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Couldn&apos;t save that Invoice # correction. Please try again — if it keeps failing, the change did not persist.
          </DismissibleBanner>
        )}

        {/* H15d — two tabs: the "Incoming (email)" hero view staff live on,
            and the "Manual tools" drawer holding the wall of import forms. */}
        <ReceivingTabs active={activeTab} />

        {activeTab === "email" ? (
          <>
        {/* H15c — the hero table: one row per real manifest, moving badge,
            invoice # + downloads. The strict H15b gate guarantees only real
            manifests appear here. */}
        {/* Fix Phase 3.2a (G-17 / F-04-4): every email that did not make a
            manifest, the mailbox check's health, Check now / Find / Try again /
            Resolved. Above the table so a failure is the first thing seen. */}
        <InboundAttentionPanel
          view={attention}
          nowMs={nowMs}
          checkAction={checkMailboxNowAction}
          findAction={findInboundEmailAction}
          retryAction={retryInboundEmailAction}
          resolveAction={resolveInboundEmailAction}
        />
        {/* R50 S10a: one filter bar for all three views (GET form, so a
            filtered list can be bookmarked and Back works). */}
        <ReceivingFilterBar
          filters={filters}
          viewLinks={viewLinks}
          vendors={isCultiveraView ? vendorOptions(cultivera && cultivera.ok ? cultivera.rows.map((r) => r.vendor) : []) : nativeVendors}
          summary={
            isCultiveraView
              ? cultivera && cultivera.ok
                ? filterSummary(filters, cultiveraFiltered.length, cultivera.rows.length)
                : null
              : filterSummary(filters, tableRows.length, viewRows.length)
          }
          capNote={
            !isCultiveraView && filteredNative.length > tableRows.length
              ? `Only the first ${NATIVE_DISPLAY_CAP} matches are shown. Narrow the filters to see the rest.`
              : !isCultiveraView && hasActiveFilters(filters) && manifests.length >= nativeLimit
                ? `Filters search the newest ${nativeLimit.toLocaleString("en-US")} deliveries.`
                : null
          }
        />
        {isCultiveraView ? (
          <CultiveraManifestTable
            load={cultivera}
            rows={cultiveraPage.rows}
            summary={cultiveraSummary}
            sources={cultiveraSources}
            vendorGroups={cultiveraVendors}
            filters={filters}
            page={cultiveraPage.page}
            pageCount={cultiveraPage.pageCount}
          />
        ) : (
        <EmailIntakeTable
          rows={tableRows}
          linksByManifestId={linksByManifestId}
          docsByManifestId={docsByManifestId}
          invoiceAmountByManifestId={invoiceAmountByManifestId}
          parseStatusByManifest={parseStatusByManifest}
          setInvoiceAction={setInvoiceNumberAction}
          view={intakeView}
          processedCount={countProcessedRows(manifests)}
          twinsById={twinsById}
          dismissAction={dismissDuplicateManifestAction}
          filtered={hasActiveFilters(filters)}
        />
        )}

        {/* The single "Incoming (email)" table above is the one source of
            truth — one row per manifest with a moving status badge, and the
            stat cards at the top give the per-status counts. The old
            status-grouped queue tables listed the very same manifests again,
            so they were removed as redundant (owner request). */}
        {manifests.length === 0 && !isCultiveraView ? (
          <EmptyState
            icon="📥"
            title="No imports yet"
            description="Manifests emailed to vendor_intake@ appear here automatically — or stage one yourself under Manual tools."
          />
        ) : null}
          </>
        ) : (
          <>
        {/* Import by Transfer Data Link (preferred) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Import from Transfer Data Link <span className="text-[var(--admin-accent)]">(recommended)</span>
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Copy the &ldquo;Transfer Data Link&rdquo; from the order email and paste it here. We fetch the
            full transfer — every product and every COA — so you never click the per-product COA links.
          </p>
          <form action={importManifestFromUrlAction} className="space-y-4">
            <Field
              label="Transfer Data Link"
              help="The single link from the vendor email that contains all products + COAs."
              htmlFor="transfer_url"
              required
            >
              <Input
                id="transfer_url"
                name="transfer_url"
                type="url"
                placeholder="https://app.cultivera.com/..."
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Fetch & stage for review
            </Button>
          </form>
        </div>

        {/* Slice H11b — batch import: hundreds of Transfer Data Links at once */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Batch import — paste many Transfer Data Links{" "}
            <span className="text-[var(--admin-accent)]">(for the historical archive)</span>
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Collect the &ldquo;Transfer Data Link&rdquo; from each order email (12+ months of
            them, one per line) and import them all in one run. Links already imported are
            detected and skipped, so re-running an overlapping list never double-stages. Every
            manifest lands as a <strong>pending draft</strong> for review — nothing activates.
          </p>
          <BatchTransferImport importBatch={importManifestBatchAction} />
        </div>

        {/* Import by pasting raw JSON (fallback) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Or paste the JSON directly</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            If the link won&apos;t fetch, paste the raw transfer JSON from the email instead.
          </p>
          <form action={importManifestAction} className="space-y-4">
            <Field
              label="Vendor JSON"
              help="Paste the full JSON the vendor sent (product + COA/QA)."
              htmlFor="json_text"
              required
            >
              <Textarea
                id="json_text"
                name="json_text"
                rows={10}
                placeholder='{ "manifest_number": "...", "vendor": "...", "items": [ ... ] }'
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Parse & stage for review
            </Button>
          </form>
        </div>

        {/* Import the official CCRS manifest.csv (state format) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Or paste the CCRS manifest.csv
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Paste the official Washington CCRS Transportation Manifest CSV (the file the sending
            licensee uploads to CCRS). We read the manifest header + item rows and seed the transport
            details and ETA. Note: the CCRS manifest carries only identifiers, quantities, UOM,
            weight, and lab-test IDs — <strong>no product names, prices, or COAs</strong> — so each
            staged line is a sparse draft you enrich during review.
          </p>
          <form action={importManifestCsvAction} className="space-y-4">
            <Field
              label="CCRS manifest.csv"
              help="Paste the full contents of the manifest_*.csv (header block + item table)."
              htmlFor="csv_text"
              required
            >
              <Textarea
                id="csv_text"
                name="csv_text"
                rows={10}
                placeholder={
                  "SubmittedBy,...\nExternalManifestIdentifier,MAN-1001,...\n...\nInventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,...\nINV-A,,10,Each,..."
                }
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Parse CSV & stage for review
            </Button>
          </form>
        </div>

        {/* H14a — Upload a PDF manifest (WA LCB Internal Shipping Document) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Or upload a PDF manifest
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Upload the WA LCB <strong>Internal Shipping Document (Third Party)</strong> PDF a
            vendor emailed you. We read the Manifest ID, sending licensee, date, and every item
            row (lot ID, product, type, shipped qty). The PDF carries{" "}
            <strong>no prices or COAs</strong>, so each staged line is a sparse draft you enrich
            during review. Prefer the JSON when you have it — this is for PDF-only manifests. Text
            (not scanned/image) PDFs only.
          </p>
          <form action={importManifestPdfAction} className="space-y-4">
            <Field
              label="Manifest PDF"
              help="Select the .pdf file the vendor attached to their email."
              htmlFor="pdf_file"
              required
            >
              <input
                id="pdf_file"
                name="pdf_file"
                type="file"
                accept="application/pdf,.pdf"
                required
                className="block w-full text-sm text-[var(--admin-text)] file:mr-3 file:rounded-[var(--admin-radius)] file:border-0 file:bg-[var(--admin-accent)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:opacity-90"
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Parse PDF & stage for review
            </Button>
          </form>
        </div>

        {/* Slice H11a — Manifest → KB bridge backfill (drafts-only) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Promote manifests → Knowledge Base{" "}
            <span className="text-[var(--admin-text-faint)]">(drafts-only)</span>
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Every product line on your staged manifests carries verified facts from the signed
            transfer document — product name, strain, category, vendor, and COA-backed potency.
            This promotes them all into <strong>KB product drafts</strong> so the crawler and AI
            suggester have skeletons to enrich. New intakes do this automatically on accept; run
            this after bulk-uploading historical transfer JSONs. Idempotent — safe to re-run;
            existing KB data is gap-filled, never overwritten, and nothing is published.
          </p>
          {/* H12g: chunked client panel — live progress + unmissable
              confirmation with a link to the KB Review inbox. Replaces the
              one-shot form action whose redirect banner could be lost to a
              serverless timeout on big backlogs. */}
          <KbBackfillPanel
            listIds={listKbBackfillManifestIdsAction}
            promoteChunk={promoteManifestChunkToKbAction}
          />
        </div>

        {/* SLICE 67 — re-run intelligence over existing lots + the live menu */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Re-run intelligence{" "}
            <span className="text-[var(--admin-text-faint)]">(existing lots &amp; live menu)</span>
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Products received before the latest smarts shipped never met the fact extractor, the
            product-type labeler, or the display-name builder. This re-reads every lot and every
            item on the live menu and fills in what they can PROVE — package totals, servings,
            ratios, product types, cleaner names. Fill-only and safe to re-run: verified facts only,
            nothing a reviewer set is ever overwritten, and uncertain rows are left alone.
          </p>
          <form action={reprocessIntelligenceAction}>
            <Button type="submit" variant="save" size="sm">
              Re-run intelligence now
            </Button>
          </form>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
