import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, StickyActionBar } from "@/components/admin/ux";
import { Button, Field, Input, Textarea, Select, IssuesList, IssuesSummaryLine, PageTabs } from "@/components/admin/ui";
// S28: the Issues tab (held lots, missing COAs, unmapped categories, waiting drafts).
import { buildManifestIssues, manifestHeldAutoOpen, issuesTabBadge, summarizeIssues } from "@/lib/admin/issues-core";
import { resolveTab, tabHref } from "@/lib/admin/page-tabs-core";
import { MANIFEST_PAGE_TABS, manifestPageBase } from "@/lib/admin/page-tab-sets";
import { evaluateLotActivation } from "@/lib/inventory/lot-activation-gate-core";
import { getManifestById } from "@/lib/inventory/store";
import { getParseStatusForManifestNumber } from "@/lib/inbound-email/llamaparse-status-server";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
// S02 (F-080): the accept/finalize banners open THIS delivery's drafts.
import { draftsForManifestHref } from "@/lib/catalog/draft-deep-link-core";
// R31: the old strain-name KB matcher is gone. Each line now gets ONE identity
// chip keyed on product identity (brand + product + variant, the same key the
// KB and the menu cards use) — see line-identity-chip-core.
import { loadLineIdentityChips } from "@/lib/inventory/line-identity-server";
import { summarizeLineChips } from "@/lib/inventory/line-identity-chip-core";
// R31: the Finalize button names exactly what it will do ("Accept All & Finalize").
import { planFinalize } from "@/lib/inventory/finalize-label-core";
// R31: the Document AI card says whether pressing "Run AI extract" is worth it.
import { adviseAiExtract } from "@/lib/inventory/ai-extract-advice-core";
import { listManifestDocMeta } from "@/lib/inventory/manifest-docs";
import { getVendorById } from "@/lib/vendors/store";
import { listManifestLots, listManifestEvents, listLabFactsByIds } from "@/lib/inventory/intake-store";
import { summarizeStagedIntake } from "@/lib/inventory/intake-review-adapter";
import { IntakeReviewFlagsPanel } from "@/components/admin/inventory/IntakeReviewFlagsPanel";
import { ManifestTimeline } from "@/components/admin/inventory/ManifestTimeline";
import { ManifestAccountingPanel } from "@/components/admin/inventory/ManifestAccountingPanel";
import { accountingStatus, booksNeedsAttention, booksRefusalNextStep, booksResultText } from "@/lib/inventory/manifest-event-labels-core";
import { ManifestLotDisposition } from "@/components/admin/inventory/ManifestLotDisposition";
import { manifestStatusBadge } from "@/lib/inventory/intake-disposition-core";
import { finalizeBanner } from "@/lib/inventory/finalize-banner-core";
import {
  parseUsualTransport,
  suggestTransportDefaults,
  describeSuggestion,
} from "@/lib/inventory/vendor-transport-core";
import {
  transportWasAutoFilled,
  fromManifestChips,
  CONCIERGE_HINTS,
} from "@/lib/inventory/guided-accept-core";
import { GuidedAcceptRibbon } from "@/components/admin/inventory/GuidedAcceptRibbon";
import { fmtPacificDateTime } from "@/lib/inventory/manifest-table-core";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { IntakeChecklistPanel } from "@/components/admin/inventory/IntakeChecklistPanel";
import { buildIntakeChecklist } from "@/lib/inventory/intake-checklist-core";
import { menuStep } from "@/lib/inventory/menu-live-step-core";
import { intakeMenuStepSnapshot } from "@/lib/pos/intake-menu-staging";
import { getManifestPoLinkState } from "@/lib/inventory/po-link-store";
import { ManifestPoLinkPanel } from "@/components/admin/inventory/ManifestPoLinkPanel";
import {
  rejectManifestAction,
  updateManifestTransportAction,
  setLotDispositionAction,
  finalizeManifestAction,
  promoteManifestToKbAction,
  notifyVendorSampleCapAction,
  linkManifestPoAction,
  reExtractManifestAiAction,
} from "../actions";

/** Format an ISO timestamp into the value a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // YYYY-MM-DDTHH:mm in UTC (stable, no TZ surprises for the form default).
  return d.toISOString().slice(0, 16);
}

export const dynamic = "force-dynamic";
// R28: finalize now also reads every lab certificate (lab JSON + COA PDF,
// LlamaParse when the PDF text layer has no numbers), bounded to 120s inside
// the finalize. Vercel Pro allows 300s, the same budget the drafts page uses.
export const maxDuration = 300;

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

export default async function ManifestReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    staged?: string;
    /** S31: set by the CCRS-CSV / LCB-PDF importers (sparse drafts, no price/COA). */
    csv?: string;
    pdf?: string;
    /** S31: set by "Mark in transit" / "Mark received" (setManifestLifecycleAction). */
    lifecycle?: string;
    accepted?: string;
    drafts?: string;
    rejected?: string;
    archived?: string;
    transport?: string;
    error?: string;
    capmsg?: string;
    notified?: string;
    finalized?: string;
    lot?: string;
    held?: string;
    kb?: string;
    kbstrains?: string;
    kblicense?: string;
    polink?: string;
    ai?: string;
    filled?: string;
    role?: string;
    inv?: string;
    /** books-81/books-83: the ledger's own answer, surfaced not swallowed. */
    books?: string;
    booksError?: string;
    /** S28: Delivery | Issues; S29 adds Accounting. */
    tab?: string;
  }>;
}) {
  // S29: the session is kept so owner-only books links render only for a
  // viewer who can open them (a manager sees this page via inventory.manage).
  const session = await requirePermission("inventory.manage");
  const canBooks = can(session.profile.role, "books.view");
  const { id } = await params;
  const {
    staged,
    csv,
    pdf,
    lifecycle,
    accepted,
    drafts,
    rejected,
    archived,
    transport,
    error,
    capmsg,
    notified,
    finalized,
    held,
    kb,
    kbstrains,
    kblicense,
    polink,
    ai,
    filled,
    role,
    inv,
    books,
    booksError,
    tab,
  } = await searchParams;

  const manifest = await getManifestById(id);
  if (!manifest) notFound();

  // E7: auto-fill the manifest origin-license fields (WAC 314-55-085) from the
  // linked vendor record so staff don't retype them each delivery. The manifest's
  // own saved value always wins (manual override preserved); the vendor supplies
  // only the DEFAULT when the manifest field is still blank.
  const linkedVendor = manifest.vendor_id ? await getVendorById(manifest.vendor_id) : null;

  // H15e: layer in the vendor's remembered "usual transport" (carrier/driver/
  // vehicle from their last accepted delivery). Precedence per field:
  // manifest's own saved/auto-filled value (the record) → vendor usual
  // transport (a SUGGESTION, flagged below) → E7 origin-license fallback.
  const usualTransport = parseUsualTransport(linkedVendor?.usual_transport);
  const transportSuggestion = suggestTransportDefaults(manifest, usualTransport);
  const td = transportSuggestion.defaults;
  const suggested = new Set(transportSuggestion.suggestedFields);
  const vendorDisplay =
    linkedVendor?.display_name ?? manifest.vendor_label ?? "this vendor";
  const originLicenseDefault = td.transporter_license ?? linkedVendor?.license_number ?? "";
  const originNameDefault =
    td.transporter_name ??
    linkedVendor?.legal_name ??
    linkedVendor?.display_name ??
    manifest.vendor_label ??
    "";

  const lots = await listManifestLots(id);
  const events = await listManifestEvents(id);

  // SLICE 39: Slice 97's intake REVIEW summary, finally connected. Built from
  // the STAGED rows (what acceptance would actually commit), not by
  // re-parsing raw_payload. Vendor license comes from the linked vendor
  // record — the manifest row does not store it.
  const labFacts = await listLabFactsByIds(
    lots.map((l) => l.lab_result_id).filter((v): v is string => Boolean(v)),
  );
  const reviewSummary = summarizeStagedIntake(
    {
      manifest_number: manifest.manifest_number,
      vendor_label: manifest.vendor_label,
      vendor_license: linkedVendor?.license_number ?? null,
      source_format: manifest.source_format,
    },
    lots.map((l) => ({
      product_name: l.product_name,
      lot_code: l.lot_code,
      pos_product_key: l.pos_product_key,
      received_qty: Number(l.received_qty),
      unit: l.unit,
      unit_cost_minor_units: l.unit_cost_minor_units,
      lab_result_id: l.lab_result_id,
      is_sample: l.is_sample,
      strain_name: l.strain_name,
      strain_type: l.strain_type ?? null,
      category: l.category,
      inventory_type: l.inventory_type,
      expires_on: l.expires_on,
      // SLICE 18-0: pass the stored answer straight through. NOT `?? false` —
      // null ("nobody has been asked") and false ("a person said no") are
      // different facts, and the unclassified-suspect warning keys on exactly
      // that difference. Defaulting here would make the dock nag forever about
      // lots that were already settled, which trains staff to ignore it.
      otherwise_taken: l.otherwise_taken,
    })),
    labFacts,
  );

  // W5: manifest ↔ PO link state (suggest-and-confirm). {available:false}
  // pre-migration-0102 — the panel simply doesn't render until it's applied.
  const poLink = await getManifestPoLinkState(manifest);

  // H15f — the guided-accept ribbon's green "from the manifest" chips.
  // Identity fields always come from the parsed document; transport fields are
  // chipped ONLY when the H15a auto-fill audit event proves the system seeded
  // them (never guess whether a human typed a value).
  const autoFilled = transportWasAutoFilled(events);
  const manifestChips = fromManifestChips(manifest, autoFilled);

  // ④ "On menu" ribbon step (intake auto-publish): draft/staged counts for
  // THIS manifest decide whether the delivery's products are live, still need
  // pricing, or are stuck staged (publish fallback). Snapshot is null on read
  // failure — the core then renders a neutral todo rather than guessing.
  const menuSnapshot = await intakeMenuStepSnapshot(id);
  const menuStepView = menuStep(manifest.status, menuSnapshot ? { ...menuSnapshot, manifestId: id } : null);

  // Convert each intake line's raw LCB classification to OUR website category
  // for display (Request B). Read-only — never mutates the stored CCRS values.
  const categoryResolutions = await resolveWebsiteCategories(
    lots.map((l) => ({
      posProductKey: l.pos_product_key,
      productName: l.product_name,
      inventoryType: l.inventory_type,
      category: l.category,
    })),
  );
  const categoryByLotId = new Map(
    lots.map((l, i) => [l.id, categoryResolutions[i]] as const),
  );

  // R31: one identity chip per line (on the menu / restocks a card / known in
  // the KB / new — onboarding will build it). Keyed on product identity, the
  // same brand+product+variant key the KB and the register use; never throws.
  const identityChips = await loadLineIdentityChips(
    id,
    new Map(lots.map((l, i) => [l.id, categoryResolutions[i]?.websiteCategory ?? null] as const)),
  );
  const identitySummary = summarizeLineChips(identityChips);
  const inProgress = manifest.status === "pending" || manifest.status === "in_transit" || manifest.status === "received";

  const withCoa = lots.filter((l) => l.lab_result_id).length;
  const missingCoa = lots.length - withCoa;
  const sampleCount = lots.filter((l) => l.is_sample).length;
  // SLICE 101 — any line already marked refused makes this a PARTIAL finalize,
  // so the why-partial note field becomes required up front (the server also
  // validates, catching partials caused by dirty lots being held).
  // R31: the same per-line facts the server finalize uses (undecided = accept,
  // the activation gate predicts holds). planFinalize names the button and the
  // sticky-bar sentence; noteRequired is the server's partial-note rule.
  const finalizePlan = planFinalize(
    lots.map((l) => ({
      id: l.id,
      disposition: l.disposition,
      gate: {
        ccrsExternalId: l.ccrs_inventory_external_id,
        hasLabResult: l.lab_result_id != null,
        labPassed: l.lab_result_id ? (labFacts.get(l.lab_result_id)?.passed ?? null) : null,
      },
    })),
  );
  const hasRefusedLine = finalizePlan.noteRequired;
  const coaLinks = Array.isArray(manifest.coa_links) ? manifest.coa_links : [];

  const rejectAction = rejectManifestAction.bind(null, id);
  const poLinkAction = linkManifestPoAction.bind(null, id);
  const finalizeAction = finalizeManifestAction.bind(null, id);
  const notifyVendorAction = notifyVendorSampleCapAction.bind(null, id);
  // R31: no Mark in transit / Mark received / Archive COAs buttons — Finalize
  // does all of it. Promote-to-KB stays bound ONLY for the rare retry case.
  const promoteKbAction = promoteManifestToKbAction.bind(null, id);
  const transportAction = updateManifestTransportAction.bind(null, id);
  const reExtractAiAction = reExtractManifestAiAction.bind(null, id);
  // PR-A: document-AI parse status for the plain-English statement in the
  // transport section (what LlamaParse read, or the honest reason it didn't).
  const parseStatus = await getParseStatusForManifestNumber(manifest.manifest_number);
  // R31: what we already have vs. what the AI button would try to read, from
  // which archived PDFs — so the owner knows whether pressing it is worth it.
  const manifestDocs = await listManifestDocMeta(id);
  const aiAdvice = adviseAiExtract({
    docs: manifestDocs,
    saved: {
      transporter_name: manifest.transporter_name,
      transporter_license: manifest.transporter_license,
      driver_name: manifest.driver_name,
      driver_license_number: manifest.driver_license_number,
      vehicle_description: manifest.vehicle_description,
      vehicle_plate: manifest.vehicle_plate,
      vehicle_vin: manifest.vehicle_vin,
      departed_at: manifest.departed_at,
      eta_date: manifest.eta_date,
      route_notes: manifest.route_notes,
    },
    invoiceNumberOverride: manifest.invoice_number_override ?? null,
    invoiceNumberDetected: manifest.invoice_number_detected ?? null,
    parse: { ok: parseStatus.ok, engine: parseStatus.engine, shortReason: parseStatus.shortReason },
  });
  const hasTransport = Boolean(
    manifest.transporter_name ||
      manifest.driver_name ||
      manifest.vehicle_plate ||
      manifest.vehicle_description ||
      manifest.departed_at ||
      manifest.arrived_at,
  );

  // Slice AO — the command-center checklist: every done/todo state derived
  // from REAL recorded facts (status, lot dispositions, transport fields, the
  // kb_writeback audit event). Logic lives in intake-checklist-core (tested).
  const checklist = buildIntakeChecklist({
    status: manifest.status,
    lotDispositions: lots.map((l) => l.disposition),
    hasTransport,
    events,
  });
  // R31: the KB retry button renders ONLY when finalize ran but no
  // kb_writeback reached the timeline (the checklist's promote_kb todo).
  const kbRetryNeeded = checklist.items.find((it) => it.id === "promote_kb")?.state === "todo";

  // S28: the Issues tab, from STORED state only. A lot finalize held back is
  // still `quarantine` with disposition `accepted` (intake-store finalize:
  // "Keep it OUT of sellable inventory. Record the accept intent"); its
  // reasons come from the SAME gate the finalize ran, on today's facts, so a
  // row disappears as soon as the lot is fixed — no `?held=` needed.
  const heldLots = inProgress
    ? []
    : lots
        .filter((l) => l.status === "quarantine" && l.disposition === "accepted")
        .map((l) => {
          const label = l.product_name || l.lot_code || "Unnamed lot";
          const verdict = evaluateLotActivation({
            id: l.id,
            label,
            ccrsExternalId: l.ccrs_inventory_external_id,
            hasLabResult: l.lab_result_id != null,
            labPassed: l.lab_result_id ? (labFacts.get(l.lab_result_id)?.passed ?? null) : null,
          });
          return { id: l.id, label, reasons: verdict.reasons };
        });
  const issues = buildManifestIssues({
    manifestId: id,
    inProgress,
    heldLots,
    missingCoaLines: missingCoa,
    unmappedCategoryLines: lots.filter((l) => categoryByLotId.get(l.id)?.unmapped).length,
    menu: menuSnapshot
        ? { pendingDrafts: menuSnapshot.pendingDrafts, stagedWaiting: menuSnapshot.stagedWaiting, waitingVersion: menuSnapshot.waitingVersion }
        : null,
  });
  const issueSummary = summarizeIssues(issues);
  const pageBase = manifestPageBase(id);
  // S29: the Accounting tab reads the durable timeline, not the URL, so a
  // receiving-time refusal is still there after a reload (F-120).
  const booksState = accountingStatus(events);
  const tabs = MANIFEST_PAGE_TABS.map((t) =>
    t.key === "issues"
      ? { ...t, ...issuesTabBadge(issueSummary) }
      : t.key === "accounting"
        ? {
            ...t,
            ...(booksState.open > 0 ? { count: booksState.open, countTone: "neutral" as const } : {}),
            // R19 (bible S19.18): a refusal QUIETLY marks the tab (gold ring +
            // a short glow) instead of jumping to it.
            attention: booksNeedsAttention(booksState.open, booksError),
          }
        : t,
  );
  // `held=0` is a clean finalize and must NOT auto-open Issues (manifestHeldAutoOpen).
  // R19: a books refusal (`booksError`) no longer opens Accounting; the page
  // stays where the owner was working and the Accounting tab glows instead.
  const finalBanner = finalizeBanner({ finalized, accepted, rejected, drafts, held });
  const activeTab = resolveTab(MANIFEST_PAGE_TABS, { tab, held: manifestHeldAutoOpen(held) }, "delivery");

  return (
    <div>
      <AdminPageHeader
        title={manifest.manifest_number ?? "Vendor manifest"}
        subtitle={`${manifest.vendor_label ?? "Unknown vendor"} · ${manifest.transfer_date ?? "no date"} · ${
          manifest.source_format === "wcia" ? "WCIA transfer" : "generic JSON"
        }${manifest.source_url ? " (fetched by link)" : ""}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: "Vendor intake", href: "/admin/inventory/intake" },
              { label: manifest.manifest_number ?? "Manifest" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* W1 journey strip — where Receive sits in the pipeline, with the
            next stage (Onboard) one click away after accepting. */}
        <CatalogStageStrip current="intake" />

        {/* S26: #manifest-vendor is where the menu draft's "No vendor on the
            manifest" fix link lands. Products are grouped per vendor, so this
            says which vendor the manifest named and whether it is linked. */}
        <div
          id="manifest-vendor"
          data-testid="manifest-vendor"
          className="scroll-mt-24 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Vendor</p>
          {linkedVendor ? (
            <p className="mt-1 text-[var(--admin-text)]">
              <Link href={`/admin/vendors/${linkedVendor.id}`} className="font-medium underline-offset-2 hover:underline">
                {linkedVendor.display_name}
              </Link>
              {manifest.vendor_label && manifest.vendor_label !== linkedVendor.display_name && (
                <span className="text-[var(--admin-text-muted)]">{` (manifest says \u201c${manifest.vendor_label}\u201d)`}</span>
              )}
              <span className="block text-xs text-[var(--admin-text-faint)]">
                Linked {"\u2014"} this delivery&apos;s products group with that vendor&apos;s other cards.
              </span>
            </p>
          ) : (
            <div className="mt-1 space-y-1.5">
              <p className="text-[var(--admin-gold)]">
                {manifest.vendor_label
                  ? `The manifest names \u201c${manifest.vendor_label}\u201d, but it isn\u2019t linked to a vendor record yet.`
                  : "The manifest names no vendor."}
              </p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                Nothing is lost {"\u2014"} these products sell as their own menu cards, because cards are only
                grouped per vendor. Accepting a delivery links the vendor the manifest names automatically; if that
                name is spelled differently from your vendor record, find it or combine the duplicates so the next
                delivery groups correctly.
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {manifest.vendor_label && (
                  <Link
                    href={`/admin/vendors?q=${encodeURIComponent(manifest.vendor_label)}`}
                    className="text-[var(--admin-accent)] underline-offset-2 hover:underline"
                  >
                    Find this vendor {"\u2192"}
                  </Link>
                )}
                <Link href="/admin/vendors/merge" className="text-[var(--admin-accent)] underline-offset-2 hover:underline">
                  Combine duplicate vendors {"\u2192"}
                </Link>
              </div>
            </div>
          )}
        </div>

        {staged && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Manifest staged as a draft. Review the lines below, then accept to activate the lots.
          </div>
        )}
        {staged && (csv || pdf) && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            {/* S31: the importers redirect with ?csv=1 / ?pdf=1 (intake/actions.ts);
                the page used to drop the flag. Both formats carry no price or
                COA, so every line needs those before it is accepted. */}
            Imported from the {csv ? "CCRS manifest CSV" : "LCB shipping PDF"} — that file carries no
            prices or COAs, so each line below is a sparse draft. Fill in cost and COA before accepting.
          </div>
        )}
        {(lifecycle === "in_transit" || lifecycle === "received") && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            {/* S31: confirmation for setManifestLifecycleAction's redirect. The
                books result for "received" is on the Accounting tab. */}
            {lifecycle === "received" ? "Marked received." : "Marked in transit."} (Finalize now does this for you.)
          </div>
        )}
        {/* R23: ONE calm banner per outcome (finalize-banner-core). The old
            three independent banners keyed on raw strings, so `rejected=0`
            from every finalize lit a red "Whole manifest rejected" bar. */}
        {finalBanner && (
          <div
            data-finalize-banner={finalBanner.kind}
            data-tone={finalBanner.tone}
            className={
              finalBanner.tone === "green"
                ? "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
                : finalBanner.tone === "gold"
                  ? "rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-text)]"
                  : "rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text)]"
            }
          >
            <div className="font-semibold">{finalBanner.headline}</div>
            {finalBanner.details.map((d) => (
              <div key={d} className="mt-0.5 text-[var(--admin-text-muted)]">
                {d}
              </div>
            ))}
            {finalBanner.drafts > 0 && (
              <div className="mt-0.5">
                {finalBanner.drafts} new product{finalBanner.drafts === 1 ? "" : "s"} weren&apos;t on the live
                menu yet →{" "}
                <Link href={draftsForManifestHref(id)} className="font-semibold underline">
                  onboard {finalBanner.drafts === 1 ? "it" : "them"}
                </Link>
                .
              </div>
            )}
          </div>
        )}
        {/* S29: the books/booksError banners moved to the Accounting tab below
            (neutral styling, bible S19.4). Finalizing never shows an
            accounting banner on the Delivery tab. */}
        {/* S28: the old red "held in quarantine" banner is now one Issues row
            PER held lot (what it is missing + Open lot), computed from the lot
            rows themselves, so it stays until each lot is fixed. `?held=N`
            only decides which tab opens first. */}
        {/* R31: the per-line "Line marked …" banner is gone — the line itself
            now shows Will accept / Rejected, so a banner was just noise. */}
        {archived && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Archived {archived} COA PDF{archived === "1" ? "" : "s"} to our records.
          </div>
        )}
        {transport && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Transport details saved to the chain-of-custody record.
          </div>
        )}
        {ai === "1" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            <strong>AI extract finished.</strong>{" "}
            Read the {role && role !== "document" ? role : "document"} PDF
            {inv ? ` — invoice/order # ${inv}` : ""}
            {filled && filled !== "0"
              ? `; filled ${filled} empty transport field${filled === "1" ? "" : "s"} (driver license / vehicle where present).`
              : "; no new transport fields to fill (already complete or not present)."}{" "}
            See the Document AI card above for the engine and any honest reason.
          </div>
        )}
        {ai === "nodocs" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            <strong>Nothing to extract.</strong> No archived PDF documents are on file for this
            manifest yet. If the email just arrived, give the attachments a few seconds to finish
            archiving, then try again.
          </div>
        )}
        {error === "aiextract" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            <strong>AI extract couldn&apos;t run.</strong> That manifest could not be loaded. Refresh
            and try again.
          </div>
        )}
        {error === "sample_cap" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            <strong>Accept refused — quarterly sample cap.</strong>{" "}
            {capmsg
              ? capmsg
              : "Accepting this manifest would exceed the processor's 120-unit quarterly sample cap (WAC 314-55-096). Nothing was activated."}{" "}
            No lots were activated and no sample event was recorded. The processor must not send more sample
            units this quarter, or an owner may adjust the sample-cap enforcement settings.
            <form action={notifyVendorAction} className="mt-3">
              <Button type="submit" variant="neutral" size="sm">
                ✉️ Notify vendor (sample delivery on hold)
              </Button>
            </form>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              Emails the processor that their delivery is on hold and asks them to hold the samples until
              next quarter. Cites WAC 314-55-096 — no dollar amounts or customer data. An internal copy is
              kept for staff.
            </p>
          </div>
        )}
        {notified === "sent" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Sample-cap notice emailed to the vendor (an internal copy was kept). Logged on the timeline.
          </div>
        )}
        {notified === "noemail" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            No email is on file for this vendor — an internal copy was sent to staff instead. Add a vendor
            email to notify them directly next time.
          </div>
        )}
        {notified === "unconfigured" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            Email is not configured, so no notice was sent. The refusal is still recorded on the timeline.
          </div>
        )}
        {notified === "failed" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            The notice could not be delivered to the vendor. Please try again or contact them directly.
          </div>
        )}
        {error === "partial_note" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-orange)]">
            <strong>Note required.</strong> This intake is partial — some lines were refused or held
            — so a note explaining why is required for the audit trail. Nothing was changed; add the
            note next to the Finalize button and finalize again.
          </div>
        )}
        {error && error !== "sample_cap" && error !== "polink" && error !== "partial_note" && !error.startsWith("notify_") && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Something went wrong with that action.
          </div>
        )}
        {error === "notify_notblocked" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            This manifest is no longer over the quarterly sample cap, so no vendor notice was sent.
          </div>
        )}
        {error === "notify_unavailable" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            The vendor notice is unavailable right now (the records service is not configured).
          </div>
        )}
        {kb != null && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            KB write-back complete — {kb} product fact{kb === "1" ? "" : "s"} promoted as KB drafts
            {kbstrains && kbstrains !== "0" ? `, ${kbstrains} strain(s) gap-filled` : ""}
            {kblicense === "1" ? ", vendor license number captured" : ""}. Nothing was published —
            validate the drafts in the KB review lanes.
          </div>
        )}

        {polink === "linked" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Linked to its purchase order — the paper trail from order to delivery is now connected. Logged on the timeline.
          </div>
        )}
        {polink === "unlinked" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Unlinked from its purchase order. Logged on the timeline.
          </div>
        )}
        {error === "polink" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Couldn&apos;t update the purchase-order link{capmsg ? ` — ${capmsg}` : "."}
          </div>
        )}

        {/* S28: Delivery | Issues; S29: Accounting. Result banners above show on every tab. */}
        {/* R19: `keep` hands the books result params to the Accounting link only
            (its keepParams); every other tab still drops them (allow=[]). */}
        <PageTabs base={pageBase} tabs={tabs} active={activeTab} ariaLabel="Manifest views" allow={[]} keep={{ booksError, books }} />

        {activeTab === "issues" && (
          <IssuesList
            issues={issues}
            emptyText="Nothing needs attention on this delivery. Every accepted lot passed the go-live check."
          />
        )}

        {activeTab === "accounting" && (
          <section id="manifest-accounting" aria-label="Accounting" className="space-y-4">
            {/*
              books-83 / S29. The receiving wire (books-81) and the vendor-bill
              wire both push their result onto this URL; these two banners are
              the other half of "never swallow a refusal". S29 moved them here
              in NEUTRAL styling: the delivery itself is fine, so this is a
              to-do, not an alarm.
            */}
            {booksError && (
              <div
                data-testid="books-refusal"
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-sm text-[var(--admin-text)]"
              >
                <strong>Books: not recorded yet</strong> {"\u2014"} {booksError} The delivery itself
                is fine. {booksRefusalNextStep(inProgress)}
              </div>
            )}
            {books && !booksError && (
              <div
                data-testid="books-recorded"
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]"
              >
                {booksResultText(books)}
              </div>
            )}

            <ManifestAccountingPanel events={events} canBooks={canBooks} />
          </section>
        )}

        {activeTab === "delivery" && (
          <>
        {/* S28 (D-R2-2): at most ONE line, only when something blocks. */}
        <IssuesSummaryLine summary={issueSummary} href={tabHref(pageBase, "issues", {}, [])} />

        {/* R31: Document AI at the TOP, with an honest verdict: what we already
            have, what the button would try to find, and from which archived
            PDFs. The button only shows when there is something for it to read,
            and it is purple (worth pressing) only when it can add facts. */}
        <section
          id="manifest-ai"
          data-ai-verdict={aiAdvice.verdict}
          className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--admin-text)]">
                {parseStatus.badge === "llama" ? "\ud83e\udd99" : "\ud83d\udcc4"} Document AI {"\u2014"} {aiAdvice.headline}
              </p>
              <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{aiAdvice.detail}</p>
            </div>
            {aiAdvice.showButton && (
              <form action={reExtractAiAction}>
                <Button type="submit" variant={aiAdvice.buttonVariant} size="sm">
                  🤖 Run AI extract
                </Button>
              </form>
            )}
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {aiAdvice.have.length > 0 && (
              <div>
                <dt className="inline font-semibold text-[var(--admin-text-muted)]">Already have: </dt>
                <dd className="inline text-[var(--admin-text)]">{aiAdvice.have.join(", ")}</dd>
              </div>
            )}
            {aiAdvice.missing.length > 0 && (
              <div>
                <dt className="inline font-semibold text-[var(--admin-text-muted)]">Would try to find: </dt>
                <dd className="inline text-[var(--admin-text)]">{aiAdvice.missing.join(", ")}</dd>
              </div>
            )}
            {aiAdvice.reads.length > 0 && (
              <div>
                <dt className="inline font-semibold text-[var(--admin-text-muted)]">Reads: </dt>
                <dd className="inline text-[var(--admin-text)]">{aiAdvice.reads.join(", ")}</dd>
              </div>
            )}
            {aiAdvice.skips.length > 0 && (
              <div>
                <dt className="inline font-semibold text-[var(--admin-text-muted)]">Skips: </dt>
                <dd className="inline text-[var(--admin-text-faint)]">{aiAdvice.skips.join(", ")}</dd>
              </div>
            )}
          </dl>
          <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
            Last read: {parseStatus.statement} The button only fills EMPTY transport fields and re-checks the
            invoice/order # for this one delivery {"\u2014"} it never overwrites what you typed.
          </p>
        </section>

        {/* H15f — guided accept: ① Arrived → ② Verify counts → ③ Accept → ④ On menu,
            plain-English stage guidance + green "from the manifest" chips. */}
        <GuidedAcceptRibbon
          status={manifest.status}
          etaDate={manifest.eta_date}
          chips={manifestChips}
          menuStep={menuStepView}
        />

        {/* Slice AO — the command-center checklist: everything this page needs,
            with honest done/todo/automatic states and jump links. */}
        <IntakeChecklistPanel checklist={checklist} />

        {/* SLICE 39 — the Slice 97 review summary, finally connected: per-line
            compliance flags (vendor license, lot codes, COAs, failed labs,
            samples, quantities) the receiver eyeballs BEFORE accepting.
            Renders nothing when the staged intake is clean. */}
        <IntakeReviewFlagsPanel summary={reviewSummary} />

        {/* W5: which order is this delivery for? (suggest-and-confirm; hidden
            entirely until migration 0102 is applied) */}
        {poLink.available && <ManifestPoLinkPanel state={poLink} linkAction={poLinkAction} />}

        {/* R31: the five stat cards became ONE quiet line — the walk is the lines. */}
        <p
          data-testid="manifest-walk-summary"
          className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-xs text-[var(--admin-text-muted)]"
        >
          <span className="font-semibold text-[var(--admin-text)]">{lots.length} line{lots.length === 1 ? "" : "s"}</span>
          {" \u00b7 "}
          <span className={missingCoa > 0 ? "text-[var(--admin-orange)]" : undefined}>
            COA {withCoa}/{lots.length}
          </span>
          {sampleCount > 0 && <>{" \u00b7 "}{sampleCount} sample{sampleCount === 1 ? "" : "s"} ($0, not for resale)</>}
          {" \u00b7 "}
          {manifestStatusBadge(manifest.status).label}
          {manifest.status === "partially_accepted" &&
            ` (${manifest.accepted_lot_count ?? 0} in \u00b7 ${manifest.rejected_lot_count ?? 0} refused)`}
          {identitySummary.text && <>{" \u00b7 "}{identitySummary.text}</>}
        </p>

        {/* S28: "N lines have no COA" is an Issues row while receiving is open
            (Review the lines → #manifest-lines), not a banner. */}

        {/* Parsed lines */}
        <div id="manifest-lines" className="scroll-mt-24 overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Product / lot</th>
                <th className="cursor-help px-4 py-3 text-right" title={CONCIERGE_HINTS.qty}>
                  Qty
                </th>
                <th className="cursor-help px-4 py-3 text-center" title={CONCIERGE_HINTS.coa}>
                  COA
                </th>
                <th className="px-4 py-3 text-center">Catalog</th>
                <th className="px-4 py-3">Expires</th>
                {inProgress && (
                  <th className="cursor-help px-4 py-3" title={CONCIERGE_HINTS.decision}>
                    Decision
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {lots.map((l) => (
                <tr key={l.id} className="bg-[var(--admin-surface)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/inventory/${l.id}`}
                      className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {l.product_name ?? "(unnamed)"}
                    </Link>
                    <div className="text-xs text-[var(--admin-text-faint)]">
                      {l.lot_code ?? "no lot code"}
                      {l.strain_name && <span> · {l.strain_name}</span>}
                      {l.is_sample && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                          sample
                        </span>
                      )}
                    </div>
                    {(() => {
                      // R31: ONE identity chip keyed on brand+product+variant.
                      const chip = identityChips.get(l.id);
                      if (!chip) return null;
                      const tone =
                        chip.tone === "accent"
                          ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                          : chip.tone === "gold"
                            ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                            : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]";
                      const cls = `rounded px-1.5 py-0.5 font-semibold ${tone}`;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" data-line-identity={chip.kind}>
                          {chip.href ? (
                            <Link href={chip.href} className={`${cls} hover:brightness-110`} title={chip.title}>
                              {chip.label}
                            </Link>
                          ) : (
                            <span className={cls} title={chip.title}>
                              {chip.label}
                            </span>
                          )}
                          {chip.kbHref && (
                            <Link href={chip.kbHref} className="text-[var(--admin-accent)] underline hover:brightness-110">
                              KB record {"\u2192"}
                            </Link>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const cat = categoryByLotId.get(l.id);
                      if (!cat) return null;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {cat.unmapped ? (
                            <span className="rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 font-semibold uppercase text-[var(--admin-gold)]">
                              Unmapped category
                            </span>
                          ) : (
                            <span className="rounded bg-[var(--admin-surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--admin-text-muted)]">
                              {cat.label}
                            </span>
                          )}
                          {cat.raw ? (
                            <span
                              className="uppercase tracking-wide text-[var(--admin-text-faint)]"
                              title={`LCB inventory type: ${l.inventory_type ?? "—"}`}
                            >
                              LCB: {cat.raw}
                            </span>
                          ) : null}
                          {cat.unmapped ? (
                            <Link
                              href="/admin/settings/types"
                              className="text-[var(--admin-accent)] underline hover:brightness-110"
                            >
                              Map it →
                            </Link>
                          ) : null}
                        </div>
                      );
                    })()}
                    <Link
                      href={`/admin/inventory/lots/${l.id}/label`}
                      target="_blank"
                      className="mt-1 inline-block text-[11px] font-semibold text-[var(--admin-accent)] underline hover:brightness-110"
                    >
                      🏷 Print 4×6 label
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{fmtQty(l.received_qty, l.unit)}</td>
                  <td className="px-4 py-3 text-center">
                    {l.lab_result_id ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {l.pos_product_key ? "🔗" : <span className="text-[var(--admin-text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">{l.expires_on ?? "—"}</td>
                  {inProgress && (
                    <td className="px-4 py-3">
                      <ManifestLotDisposition
                        manifestId={id}
                        lotId={l.id}
                        disposition={l.disposition}
                        rejectReason={l.reject_reason}
                        acceptAction={setLotDispositionAction}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Captured COAs (knowledge-base snapshot) */}
        {coaLinks.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">
                Certificates of analysis ({coaLinks.length})
              </h2>
            </div>
            <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
              Pulled from the single transfer file — no need to open each product&apos;s COA link in the
              email. Finalize downloads and keeps a copy of each on file (so you can print them for LCB
              enforcement) and reads the numbers into the lab results {"\u2014"} no button needed.
            </p>
            <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Lab result ID</th>
                    <th className="px-4 py-2">Expires</th>
                    <th className="px-4 py-2 text-right">COA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {coaLinks.map((c, i) => (
                    <tr key={`${c.coa_url}-${i}`} className="bg-[var(--admin-surface)]">
                      <td className="px-4 py-2 text-[var(--admin-text)]">{c.product_name ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[var(--admin-text-muted)]">
                        {c.lab_result_id ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{c.expire_date ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={c.coa_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--admin-accent)] hover:underline"
                        >
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transport / chain-of-custody (Slice 33, Feature L) */}
        <div id="manifest-transport" className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="mb-1 flex items-start justify-between gap-3">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">
              🚚 Transport &amp; chain of custody
            </h2>
            {hasTransport && manifest.transport_recorded_at && (
              <span className="text-xs text-[var(--admin-text-faint)]">
                last updated {fmtPacificDateTime(manifest.transport_recorded_at)}
              </span>
            )}
          </div>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            WA WAC 314-55-085 requires keeping transportation manifest records. Record who
            actually delivered this load and on what vehicle. Saved with the manifest so it
            prints with the intake record.
          </p>
          {/* R31: the Document AI status + "Run AI extract" moved to the top of
              the Delivery tab (#manifest-ai), with a worth-pressing verdict. */}
          {transportSuggestion.usedUsual && (
            <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-xs text-[var(--admin-gold)]">
              💡 {describeSuggestion(vendorDisplay, transportSuggestion.suggestedFields)}{" "}
              <span className="opacity-80">
                (Remembered from their last accepted delivery — nothing is saved until you hit
                Save.)
              </span>
            </div>
          )}
          <form action={transportAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Transporter / carrier"
                help={
                  suggested.has("transporter_name")
                    ? `Suggested — ${vendorDisplay}'s usual carrier from their last accepted delivery`
                    : linkedVendor
                      ? "Pre-filled from the linked vendor — edit if a different carrier delivered"
                      : "Business that moved the load"
                }
              >
                <div title={CONCIERGE_HINTS.transporter}>
                  <Input
                    name="transporter_name"
                    defaultValue={originNameDefault}
                    placeholder="e.g. Acme Cannabis Logistics"
                  />
                </div>
              </Field>
              <Field
                label="Origin / transporter license #"
                help={
                  suggested.has("transporter_license")
                    ? "Suggested from the vendor's usual transport"
                    : linkedVendor?.license_number
                      ? "Auto-filled from the vendor's WA license number"
                      : undefined
                }
              >
                <Input
                  name="transporter_license"
                  defaultValue={originLicenseDefault}
                  placeholder="WA license number"
                />
              </Field>
              <Field
                label="Driver name"
                help={suggested.has("driver_name") ? `Suggested — ${vendorDisplay}'s usual driver` : undefined}
              >
                <Input
                  name="driver_name"
                  defaultValue={td.driver_name ?? ""}
                  placeholder="Person who delivered"
                />
              </Field>
              <Field
                label="Driver license #"
                help={suggested.has("driver_license_number") ? "Suggested from the vendor's usual transport" : undefined}
              >
                <Input
                  name="driver_license_number"
                  defaultValue={td.driver_license_number ?? ""}
                  placeholder="Driver's license number"
                />
              </Field>
              <Field
                label="Vehicle description"
                help={suggested.has("vehicle_description") ? `Suggested — ${vendorDisplay}'s usual vehicle` : "Make / model / color"}
              >
                <Input
                  name="vehicle_description"
                  defaultValue={td.vehicle_description ?? ""}
                  placeholder="e.g. White Ford Transit van"
                />
              </Field>
              <Field
                label="License plate"
                help={suggested.has("vehicle_plate") ? "Suggested from the vendor's usual transport" : undefined}
              >
                <Input
                  name="vehicle_plate"
                  defaultValue={td.vehicle_plate ?? ""}
                  placeholder="Plate number"
                />
              </Field>
              <Field
                label="Vehicle VIN"
                help={suggested.has("vehicle_vin") ? "Suggested from the vendor's usual transport" : undefined}
              >
                <Input
                  name="vehicle_vin"
                  defaultValue={td.vehicle_vin ?? ""}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Expected arrival (ETA)" help="When you expect it to reach the store">
                <div title={CONCIERGE_HINTS.eta}>
                  <Input
                    type="date"
                    name="eta_date"
                    defaultValue={manifest.eta_date ?? ""}
                  />
                </div>
              </Field>
              <div className="hidden sm:block" />
              <Field label="Departed" help="When it left the vendor">
                <div title={CONCIERGE_HINTS.departed}>
                  <Input
                    type="datetime-local"
                    name="departed_at"
                    defaultValue={toLocalInput(manifest.departed_at)}
                  />
                </div>
              </Field>
              <Field label="Arrived" help="When it reached the store">
                <Input
                  type="datetime-local"
                  name="arrived_at"
                  defaultValue={toLocalInput(manifest.arrived_at)}
                />
              </Field>
            </div>
            <Field label="Route notes" help="Stops, conditions, seal numbers, etc.">
              <Textarea
                name="route_notes"
                rows={2}
                defaultValue={manifest.route_notes ?? ""}
                placeholder="Anything noteworthy about the delivery"
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="save" size="sm">
                💾 Save transport details
              </Button>
            </div>
          </form>
        </div>

        {/* Lifecycle timeline (Cultivera-style) */}
        <div id="manifest-timeline" className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
            Manifest status
          </h2>
          <ManifestTimeline status={manifest.status} events={events} />
          {/* R31: no Mark in transit / Mark received buttons. Finalize stamps the
              delivery received (received_at + the goods receipt) itself. */}
        </div>

        {/* Slice H11a → R31: KB promotion runs automatically at finalize. The
            button exists ONLY in the exception case the checklist flags: the
            delivery is finalized but no kb_writeback is on its timeline. */}
        {kbRetryNeeded && (
          <div id="manifest-kb" className="flex scroll-mt-24 flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <p className="flex-1 text-xs text-[var(--admin-text)]">
              <strong>KB promotion didn&apos;t run.</strong> Finalize normally pushes this delivery&apos;s verified
              facts into KB drafts, but nothing is on the timeline. Gap-fill only; nothing publishes; safe to repeat.
            </p>
            <form action={promoteKbAction}>
              <Button type="submit" variant="neutral" size="sm">
                ⚡ Retry KB promotion
              </Button>
            </form>
          </div>
        )}

        {/* Accept / reject controls */}
        {inProgress ? (
          <div id="manifest-finalize" className="scroll-mt-24 space-y-4">
            <HelpPanel
              id="ccrs-reject-guardrails"
              title="How rejecting product works (and stays compliant)"
              steps={[
                "Walk the lines above. Every line says Will accept — press ✕ Reject only on a line that is wrong. Only accepted lots enter inventory (quarantine → active).",
                "Rejecting is 'refuse at the dock' — the product leaves with the driver and never becomes your reported inventory. Nothing is destroyed.",
                "Decide BEFORE you accept. Refuse questionable product at the dock rather than accepting it and rejecting/returning it later — once a lot is accepted it briefly enters inventory.",
                "Because refused product was never yours, you file NOTHING with CCRS. Ask the vendor to submit a CCRS manifest Update (to fix a quantity) or Delete (to remove a line) so their record matches what physically stayed.",
                "Do NOT create a return manifest for driver-present refusals. Contingency manifests are discontinued (WSLCB, Nov 2025).",
                "Then press the one Finalize button (it names what it will do, e.g. 'Accept All & Finalize'). It marks the delivery received, accepts every line you didn't reject, archives and reads the COAs, records the goods receipt, and promotes facts to KB drafts. A mix of accept + reject marks the manifest 'Partially Accepted' — and a note explaining WHY is required (it lands on the permanent timeline).",
              ]}
            >
              <p className="text-xs text-[var(--admin-text-faint)]">
                Grounded in the WSLCB CCRS Manifest Guide (Feb 2026) — see
                docs/ccrs-rejection-and-returns.md.
              </p>
            </HelpPanel>

            {/* GW-035: pinned finalize — this is the longest page in the
                admin; the deciding action stays reachable while reviewing
                every line. SLICE 101: when any line is refused (a partial
                acceptance), the why-partial note is MANDATORY for the audit
                trail — the field rides in the same form so it submits with
                the finalize; the server validates before touching any lot. */}
            <StickyActionBar
              status={finalizePlan.status}
              statusTone={finalizePlan.tone === "warning" ? "warning" : "neutral"}
              align="between"
            >
              <form
                action={finalizeAction}
                title={CONCIERGE_HINTS.finalize}
                className="flex flex-1 flex-wrap items-center justify-end gap-3"
              >
                <input
                  type="text"
                  name="partial_note"
                  required={hasRefusedLine}
                  placeholder={
                    hasRefusedLine
                      ? "Why is this partial? (required — audit trail)"
                      : "Note (required only if this finalize ends up partial)"
                  }
                  title="Saved to the manifest's permanent timeline. Required whenever some lines are refused or held — the audit trail's why."
                  className="w-full max-w-md rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none"
                />
                <Button type="submit" variant={finalizePlan.reject > 0 && finalizePlan.accept === 0 ? "danger" : "save"} size="sm">
                  ✓ {finalizePlan.label}
                </Button>
              </form>
            </StickyActionBar>

            {/* Whole-manifest reject (reason required) */}
            <details className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/30 bg-[var(--admin-surface)] p-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-danger)]">
                ✕ Reject the entire manifest
              </summary>
              <form action={rejectAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Reason" help="Refused at the dock — nothing is destroyed or reported to CCRS.">
                  <Select name="reason_code" defaultValue="short_shipment">
                    <option value="short_shipment">Short shipment — vendor forgot it</option>
                    <option value="damaged_in_transit">Damaged / broke in transit</option>
                    <option value="wrong_product">Wrong product</option>
                    <option value="failed_coa">Failed COA / quality</option>
                    <option value="expired">Expired / short-dated</option>
                    <option value="overage">Overage — more than ordered</option>
                    <option value="other">Other (explain)</option>
                  </Select>
                </Field>
                <Field label="Details (optional / required for Other)">
                  <Input name="reason_text" placeholder="Explain if 'Other'…" />
                </Field>
                <Button type="submit" variant="neutral" size="sm">
                  ✕ Reject whole manifest
                </Button>
              </form>
            </details>
          </div>
        ) : (
          <p className="text-sm text-[var(--admin-text-faint)]">
            This manifest has been {manifestStatusBadge(manifest.status).label.toLowerCase()}. Lots
            are managed from the inventory list.
          </p>
        )}
          </>
        )}
      </div>
    </div>
  );
}
