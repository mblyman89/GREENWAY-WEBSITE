import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, StickyActionBar } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Field, Input, Textarea, Select } from "@/components/admin/ui";
import { getManifestById } from "@/lib/inventory/store";
import { getParseStatusForManifestNumber } from "@/lib/inbound-email/llamaparse-status-server";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import { matchIntakeLinesToKb } from "@/lib/ai/kb/intake-strain-match-server";
import { getVendorById } from "@/lib/vendors/store";
import { listManifestLots, listManifestEvents, listLabFactsByIds } from "@/lib/inventory/intake-store";
import { summarizeStagedIntake } from "@/lib/inventory/intake-review-adapter";
import { IntakeReviewFlagsPanel } from "@/components/admin/inventory/IntakeReviewFlagsPanel";
import { ManifestTimeline } from "@/components/admin/inventory/ManifestTimeline";
import { ManifestLotDisposition } from "@/components/admin/inventory/ManifestLotDisposition";
import { manifestStatusBadge } from "@/lib/inventory/intake-disposition-core";
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
  archiveCoasAction,
  setManifestLifecycleAction,
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
  }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const {
    staged,
    accepted,
    drafts,
    rejected,
    archived,
    transport,
    error,
    capmsg,
    notified,
    finalized,
    lot,
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
  const menuStepView = menuStep(manifest.status, menuSnapshot);

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

  // Intelligent KB match suggestion per line (exact + near-exact). Drafts-only:
  // this only suggests which known strain a product likely is; it never writes.
  const kbMatches = await matchIntakeLinesToKb(
    lots.map((l) => ({ strainName: l.strain_name, productName: l.product_name })),
  );
  const kbMatchByLotId = new Map(
    lots.map((l, i) => [l.id, kbMatches[i]] as const),
  );
  const isPending = manifest.status === "pending";
  const inProgress = manifest.status === "pending" || manifest.status === "in_transit" || manifest.status === "received";

  const withCoa = lots.filter((l) => l.lab_result_id).length;
  const missingCoa = lots.length - withCoa;
  const sampleCount = lots.filter((l) => l.is_sample).length;
  // SLICE 101 — any line already marked refused makes this a PARTIAL finalize,
  // so the why-partial note field becomes required up front (the server also
  // validates, catching partials caused by dirty lots being held).
  const hasRefusedLine = lots.some((l) => l.disposition === "rejected_at_dock");
  const coaLinks = Array.isArray(manifest.coa_links) ? manifest.coa_links : [];

  const rejectAction = rejectManifestAction.bind(null, id);
  const poLinkAction = linkManifestPoAction.bind(null, id);
  const finalizeAction = finalizeManifestAction.bind(null, id);
  const notifyVendorAction = notifyVendorSampleCapAction.bind(null, id);
  const archiveAction = archiveCoasAction.bind(null, id);
  const promoteKbAction = promoteManifestToKbAction.bind(null, id);
  const markInTransitAction = setManifestLifecycleAction.bind(null, id, "in_transit");
  const markReceivedAction = setManifestLifecycleAction.bind(null, id, "received");
  const transportAction = updateManifestTransportAction.bind(null, id);
  const reExtractAiAction = reExtractManifestAiAction.bind(null, id);
  // PR-A: document-AI parse status for the plain-English statement in the
  // transport section (what LlamaParse read, or the honest reason it didn't).
  const parseStatus = await getParseStatusForManifestNumber(manifest.manifest_number);
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

        {staged && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Manifest staged as a draft. Review the lines below, then accept to activate the lots.
          </div>
        )}
        {accepted && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Accepted — {accepted} lot{accepted === "1" ? "" : "s"} activated and on hand.
            {drafts && drafts !== "0" && (
              <>
                {" "}
                {drafts} product{drafts === "1" ? "" : "s"} weren&apos;t on the live menu —{" "}
                <Link href="/admin/inventory/drafts" className="font-semibold underline">
                  review {drafts === "1" ? "it" : "them"} as draft{drafts === "1" ? "" : "s"}
                </Link>
                .
              </>
            )}
          </div>
        )}
        {rejected && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Whole manifest rejected at the dock — refused product never entered inventory (nothing
            destroyed). No CCRS filing on our end; ask the vendor to Update/Delete their manifest.
          </div>
        )}
        {finalized && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Finalized as <strong>{manifestStatusBadge(finalized).label}</strong> — {accepted ?? 0}{" "}
            activated, {rejected ?? 0} refused at dock.
            {drafts && drafts !== "0" && (
              <>
                {" "}
                {drafts} new product{drafts === "1" ? "" : "s"} →{" "}
                <Link href="/admin/inventory/drafts" className="font-semibold underline">
                  review draft{drafts === "1" ? "" : "s"}
                </Link>
                .
              </>
            )}
          </div>
        )}
        {/*
          books-83. The receiving wire (books-81) and the vendor-bill wire both
          push their result onto this URL. Until now nothing READ it, so a
          refusal by the books was computed carefully and then shown to nobody
          — a wire that looks connected and reports nothing. These two banners
          are the other half of "never swallow a refusal".
        */}
        {booksError && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            <strong>The delivery stands, but the books were not updated.</strong>{" "}
            {booksError} Nothing was posted, so no number is wrong — this is a
            to-do, not a loss. Fix the reason above and finalize again; the entry
            is keyed to this manifest, so re-running it cannot post twice.
          </div>
        )}
        {books && !booksError && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Recorded in the books — the vendor payable for this delivery is on
            the ledger, and the product was capitalised exactly once.
          </div>
        )}
        {held && held !== "0" && (
          <div className="rounded-[var(--admin-radius)] border border-red-500/45 bg-red-500/[0.08] px-4 py-2 text-sm text-red-200">
            ⛔ <strong>{held}</strong> accepted lot{held === "1" ? " was" : "s were"} <strong>held in
            quarantine</strong> and could NOT go live — each is missing a CCRS identifier, missing a COA/lab
            result, or has a FAILED lab result. Fix the flagged lots (add the identifier / attach the passing
            COA) and finalize again. Nothing dirty was placed on the sales floor.
          </div>
        )}
        {lot && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            Line marked <strong>{lot === "accepted" ? "accepted" : "rejected at dock"}</strong>. When
            you&apos;ve decided every line, click <em>Finalize intake</em> below.
          </div>
        )}
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
            See the AI status line in the transport section below for the engine and any honest reason.
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

        <div className="grid gap-4 sm:grid-cols-5">
          <StatCard label="Lines" value={lots.length} accent="muted" />
          <StatCard label="With COA" value={`${withCoa}/${lots.length}`} accent={missingCoa > 0 ? "orange" : "green"} />
          <StatCard
            label="COAs captured"
            value={coaLinks.length}
            accent={coaLinks.length > 0 ? "green" : "muted"}
            hint="saved to KB"
          />
          <StatCard
            label="Samples ($0)"
            value={sampleCount}
            accent={sampleCount > 0 ? "gold" : "muted"}
            hint="not for resale"
          />
          <StatCard
            label="Status"
            value={manifestStatusBadge(manifest.status).label}
            accent={
              manifest.status === "accepted"
                ? "green"
                : manifest.status === "partially_accepted"
                  ? "gold"
                  : manifest.status === "rejected"
                    ? "orange"
                    : manifest.status === "pending"
                      ? "gold"
                      : "muted"
            }
            hint={
              manifest.status === "partially_accepted"
                ? `${manifest.accepted_lot_count ?? 0} in · ${manifest.rejected_lot_count ?? 0} refused`
                : undefined
            }
          />
        </div>

        {missingCoa > 0 && isPending && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]">
            ⚠️ {missingCoa} line{missingCoa === 1 ? "" : "s"} have no COA / lab result. WA CCRS manifest
            reporting needs the COA&apos;s LabtestexternalIdentifier — add it on the lot before selling.
          </div>
        )}

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
                      const m = kbMatchByLotId.get(l.id);
                      if (!m) return null;
                      // Confident auto-match → green "KB: <name>".
                      if (m.best) {
                        return (
                          <div className="mt-1 text-[10px]">
                            <span
                              className="rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 font-semibold text-[var(--admin-accent)]"
                              title={`${m.best.reason} (${Math.round(m.best.score * 100)}%)`}
                            >
                              KB match: {m.best.strain.name}
                            </span>
                          </div>
                        );
                      }
                      // Near-exact but ambiguous → amber "confirm?" with the top pick.
                      const top = m.candidates[0];
                      if (top) {
                        return (
                          <div className="mt-1 text-[10px]">
                            <span
                              className="rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 font-semibold text-[var(--admin-gold)]"
                              title={`${top.reason} (${Math.round(top.score * 100)}%). Confirm before relying on it.`}
                            >
                              KB: {top.strain.name}? · confirm
                            </span>
                          </div>
                        );
                      }
                      // No plausible match → gray hint (KB can grow from here).
                      return (
                        <div className="mt-1 text-[10px]">
                          <span className="rounded bg-[var(--admin-surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--admin-text-faint)]">
                            No KB match
                          </span>
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
              <form action={archiveAction}>
                <Button type="submit" variant="neutral" size="sm">
                  📄 Archive COAs to records
                </Button>
              </form>
            </div>
            <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
              Pulled from the single transfer file — no need to open each product&apos;s COA link in the
              email. We download and keep a copy on file so you can print them for LCB enforcement.
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
          {/* PR-A: honest document-AI status — what the parser read or why it didn't. */}
          <div
            className={
              "mb-4 rounded-[var(--admin-radius)] border px-4 py-2 text-xs " +
              (parseStatus.badge === "llama"
                ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
                : "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]")
            }
          >
            {parseStatus.badge === "llama" ? "🦙 " : "⚠️ "}
            <span className="font-semibold">
              Document AI: {parseStatus.badge === "llama" ? "LlamaParse vision" : `fallback — ${parseStatus.shortReason}`}
            </span>{" "}
            <span className="opacity-90">{parseStatus.statement}</span>
          </div>
          {/* Hybrid on-demand: re-read THIS manifest's archived PDFs with the document AI.
              Scoped to a single manifestId — it never touches other rows in the table.
              Fills only empty transport fields and re-scans the invoice/order number. */}
          <form action={reExtractAiAction} className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="special" size="sm">
              🤖 Run AI extract
            </Button>
            <span className="text-xs text-[var(--admin-text-muted)]">
              Re-reads the PDFs archived for <span className="font-semibold">this</span> manifest
              (manifest &amp; invoice) with LlamaParse, then fills only the empty transport fields
              and re-checks the invoice/order #. Safe to run after the docs finish attaching — it
              only touches this delivery, never the other orders in the table.
            </span>
          </form>
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
          {inProgress ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-4">
              <span className="text-xs text-[var(--admin-text-faint)]">Update arrival progress:</span>
              <form action={markInTransitAction}>
                <Button type="submit" variant="neutral" size="sm">
                  🚚 Mark in transit
                </Button>
              </form>
              <form action={markReceivedAction}>
                <Button type="submit" variant="neutral" size="sm">
                  📦 Mark received
                </Button>
              </form>
            </div>
          ) : null}
        </div>

        {/* Slice H11a — Manifest → KB bridge (drafts-only, idempotent) */}
        <div id="manifest-kb" className="flex scroll-mt-24 flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="flex-1">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">
              Promote to Knowledge Base{" "}
              <span className="text-[var(--admin-text-faint)]">(drafts-only)</span>
            </h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Push this transfer&apos;s verified product facts — name, strain, category, vendor,
              COA-backed potency — into KB product drafts for the crawler and AI to enrich. Runs
              automatically when you finalize an accepted intake; use this for older manifests or to
              re-run after fixing a vendor/brand link. Gap-fill only; nothing is published.
            </p>
          </div>
          <form action={promoteKbAction}>
            <Button type="submit" variant="neutral" size="sm">
              ⚡ Promote to KB drafts
            </Button>
          </form>
        </div>

        {/* Accept / reject controls */}
        {inProgress ? (
          <div id="manifest-finalize" className="scroll-mt-24 space-y-4">
            <HelpPanel
              id="ccrs-reject-guardrails"
              title="How rejecting product works (and stays compliant)"
              steps={[
                "Mark each line Accept or Reject above. Only accepted lots enter inventory (quarantine → active).",
                "Rejecting is 'refuse at the dock' — the product leaves with the driver and never becomes your reported inventory. Nothing is destroyed.",
                "Decide BEFORE you accept. Refuse questionable product at the dock rather than accepting it and rejecting/returning it later — once a lot is accepted it briefly enters inventory.",
                "Because refused product was never yours, you file NOTHING with CCRS. Ask the vendor to submit a CCRS manifest Update (to fix a quantity) or Delete (to remove a line) so their record matches what physically stayed.",
                "Do NOT create a return manifest for driver-present refusals. Contingency manifests are discontinued (WSLCB, Nov 2025).",
                "When every line is decided, click Finalize intake. A mix of accept + reject marks the manifest 'Partially Accepted' — and a note explaining WHY it's partial is required (it lands on the permanent timeline for the audit trail).",
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
              status={
                hasRefusedLine
                  ? "Partial acceptance — the note explaining why is required"
                  : "Decide each line above, then finalize — undecided lines are accepted"
              }
              statusTone="warning"
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
                <Button type="submit" variant="save" size="sm">
                  ✓ Finalize intake
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
      </div>
    </div>
  );
}
