import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Button } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { listManifests, countManifestsByStatus } from "@/lib/inventory/intake-store";
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
} from "./actions";
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
  resolveIntakeView,
  applyIntakeView,
  countProcessedRows,
} from "@/lib/inventory/manifest-table-core";
import { resolveReceivingTab } from "@/lib/inventory/receiving-tabs-core";

export const dynamic = "force-dynamic";

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
  }>;
}) {
  await requirePermission("inventory.manage");
  const { error, kbdone, kbnew, kberr, repdone, replots, repitems, reperr, tab, back, view } =
    await searchParams;

  // SLICE 101 — the owner's table filter: default hides accepted + partially
  // accepted rows (done processing) so the manifests still needing attention
  // are what staff see first; ?view=all shows everything, open rows first.
  const intakeView = resolveIntakeView(view);

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

  const [manifests, counts, inboundEmails] = await Promise.all([
    listManifests(),
    countManifestsByStatus(),
    listInboundEmails(15),
  ]);

  // Overdue in-transit manifests bubble up as a banner (the one summary the
  // single Incoming table doesn't call out on its own).
  const overdue = manifests.filter(
    (m) => normalizeStage(m.status) === "in_transit" && classifyEta(m.eta_date) === "overdue",
  );

  // PR-A — document-AI parse status per manifest (llama / FB) for the "AI"
  // column. Read-only over the ai_usage ledger; keyed by manifest_number.
  const parseStatusByManifest = await getParseStatusByManifestNumber(
    manifests.map((m) => m.manifest_number),
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
    manifests.map((m) => m.id),
  );

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
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            🚨 {overdue.length} in-transit manifest{overdue.length === 1 ? "" : "s"} past ETA — follow up with the transporter.
          </div>
        )}

        {/* Result banners stay ABOVE the tabs so they can never be hidden
            behind the other tab; resolveReceivingTab additionally auto-opens
            Manual tools so the form that produced the error is on screen. */}
        {errorMsg && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </div>
        )}

        {kbdone && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            KB backfill finished — {kbdone} manifest{kbdone === "1" ? "" : "s"} processed,{" "}
            {kbnew ?? 0} product fact{kbnew === "1" ? "" : "s"} promoted as KB drafts
            {kberr && kberr !== "0" ? ` (${kberr} manifest(s) had errors — see server logs)` : ""}.
            Nothing was published — validate the drafts in the KB review lanes.
          </div>
        )}

        {repdone && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Re-run finished — {replots ?? 0} lot{replots === "1" ? "" : "s"} and{" "}
            {repitems ?? 0} live menu item{repitems === "1" ? "" : "s"} were improved with verified
            facts, product types, or cleaner display names
            {reperr && reperr !== "0" ? ` (${reperr} row(s) failed to save — see server logs)` : ""}.
            Everything else already had its facts or gave the engines nothing verifiable — no guesses were written.
          </div>
        )}

        {/* H15d — two tabs: the "Incoming (email)" hero view staff live on,
            and the "Manual tools" drawer holding the wall of import forms. */}
        <ReceivingTabs active={activeTab} />

        {activeTab === "email" ? (
          <>
        {/* H15c — the hero table: one row per real manifest, moving badge,
            invoice # + downloads. The strict H15b gate guarantees only real
            manifests appear here. */}
        <EmailIntakeTable
          rows={applyIntakeView(manifests, intakeView)}
          linksByManifestId={linksByManifestId}
          docsByManifestId={docsByManifestId}
          parseStatusByManifest={parseStatusByManifest}
          view={intakeView}
          processedCount={countProcessedRows(manifests)}
        />

        {/* The single "Incoming (email)" table above is the one source of
            truth — one row per manifest with a moving status badge, and the
            stat cards at the top give the per-status counts. The old
            status-grouped queue tables listed the very same manifests again,
            so they were removed as redundant (owner request). */}
        {manifests.length === 0 ? (
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
