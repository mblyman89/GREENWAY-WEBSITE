import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { listAllLotsForFiltering, computeInventoryStats, EXPIRING_SOON_DAYS } from "@/lib/inventory/store";
// SLICE 13 — enterprise filtering, sorting and smart search. All pure cores.
import { buildInventoryPage, type PageLot } from "@/lib/inventory/inventory-page-core";
import { InventoryFilterPanel } from "@/components/admin/inventory/InventoryFilterPanel";
import { SortableHeader } from "@/components/admin/inventory/SortableHeader";
import { paramsFrom, clearAllFiltersHref, type RawParams } from "@/lib/inventory/inventory-url-core";
import { lotReceivedDate, lotTypeLabel, lotSizeLabel, lotSoldQty, lotStrainLabel, lotStrainTypeLabel, lotPotencyLabel } from "@/lib/inventory/lot-table-core";
import { listWindow, parsePageParam, DEFAULT_PAGE_SIZE } from "@/lib/admin/list-window-core";
import { ListPager } from "@/components/admin/ux/ListPager";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import { describeCostIncompleteness } from "@/lib/inventory/lot-gap-core";
import { getInventoryCommandCenter } from "@/lib/inventory/inventory-intel";
import { receivedDateFlagMessage } from "@/lib/inventory/received-date-core";
import { InventoryIntelPanel } from "@/components/admin/inventory/InventoryIntelPanel";
// SLICE 16 — the owner found the register/back-office divergence by scanning
// packages at the counter. This surfaces the same answer here, before a shift.
import { RegisterSellabilityBanner, RestoreToSalePanel } from "@/components/admin/inventory/RegisterSellabilityBanner";
import { getRegisterSellabilityReport } from "@/lib/inventory/register-sellability-store";
// SLICE 8 — bulk fill of the fields the one-time Cultivera import never carried.
import BulkFillPanel from "@/components/admin/inventory/BulkFillPanel";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "quarantine", label: "Quarantine" },
  { key: "recalled", label: "Recalled" },
  { key: "sold_out", label: "Sold out" },
  { key: "destroyed", label: "Destroyed" },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
    quarantine: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
    recalled: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]",
    sold_out: "bg-white/10 text-[var(--admin-text-muted)]",
    destroyed: "bg-white/10 text-[var(--admin-text-faint)]",
  };
  const cls = map[status] ?? "bg-white/10 text-[var(--admin-text-muted)]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    back?: string;
    page?: string;
    sort?: string;
    coa?: string;
    sample?: string;
    medical?: string;
    expiring?: string;
    /** SLICE 77: only lots from this vendor (vendors ⇄ inventory cross-link). */
    vendor?: string;
    /**
     * SLICE 2: only lots with no evidenced received date (`received_on is
     * null`), excluding destroyed lots. This is the compliance worklist the
     * orange banner links to — the owner's queue for adding real dates.
     */
    needsReceivedDate?: string;
    /**
     * SLICE 7: the enrichment-gap worklist knobs reached from "What's missing".
     * Each isolates exactly the lots its badge counts.
     */
    missingProductLink?: string;
    emptyActive?: string;
    missingExpiry?: string;
    unknownCost?: string;
    /**
     * SLICE 8: bulk fill. `bulk=1` enters bulk-fill MODE (an explicit mode, per
     * the Basis Design System pattern, so the normal browsing view stays
     * uncluttered). The remaining knobs are the preview/result state the server
     * action round-trips through the URL — no client state, so the panel can
     * never disagree with the server's decision.
     */
    bulk?: string;
    bulkField?: string;
    bulkValue?: string;
    bulkPreview?: string;
    bulkSkipped?: string;
    bulkIds?: string;
    bulkDone?: string;
    bulkFailed?: string;
    bulkError?: string;
    // SLICE 18 - restore-to-sale result messages from the server action.
    restored?: string;
    restoreError?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const { status, back, page } = sp;
  const activeStatus = status ?? "all";
  const rawPage = parsePageParam(page);
  /**
   * SLICE 13 — the knob parsing that used to live here (COA, sample, medical,
   * expiring, vendor uuid, the received-date worklist and the four gap flags)
   * now lives in `parseLegacyFilters`, with the SAME rules and the same
   * "garbage silently means filter off" doctrine, but under test. Two copies
   * of a filter definition is how a list and the badge that links to it start
   * disagreeing, so there is now exactly one.
   */
  const vendorId =
    sp.vendor && /^[0-9a-f-]{36}$/i.test(sp.vendor) ? sp.vendor : undefined;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Inventory" subtitle="Lots, COAs & traceability." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator applies migration 0023,
            inventory lots will appear here.
          </div>
        </div>
      </div>
    );
  }

  /**
   * SLICE 13 — load the whole (hydrated) lot set and do the work in pure code.
   *
   * WHY THE WHOLE SET. `listLotsPaged` resolved vendor name, brand name and
   * the COA only for the 100 rows it had already chosen, which made the
   * owner's request impossible to satisfy: a query cannot filter or sort by a
   * value it has never seen. Those three fields live in other tables and the
   * "Type" column is a derived label, not a column at all.
   *
   * The extra read is real but modest in context: `computeInventoryStats()`
   * and `getInventoryCommandCenter()` below ALREADY walk every lot row on
   * every load of this page. This is a third walk of the same table, in
   * parallel with them, and in exchange every field becomes filterable and
   * sortable. See docs/slice-13-inventory-filtering-recon.md.
   */
  /**
   * SLICE 16 — `getRegisterSellabilityReport()` joins the same lot set to the
   * PUBLISHED menu snapshot and reports the lots that hold real stock but that
   * the register still cannot sell. It runs in parallel with the three reads
   * above and returns an empty report (summary `null`) on any failure, so a
   * degraded read can never invent a verdict. See
   * docs/slice-16-register-inventory-parity.md.
   */
  const [allLots, stats, intel, sellability] = await Promise.all([
    listAllLotsForFiltering(),
    computeInventoryStats(),
    getInventoryCommandCenter(),
    getRegisterSellabilityReport(),
  ]);

  // Every knob — legacy and new — is parsed and applied by pure, tested code.
  const view = buildInventoryPage({
    lots: allLots as PageLot[],
    params: sp as RawParams,
    page: rawPage,
    pageSize: DEFAULT_PAGE_SIZE,
    now: new Date(),
  });
  const lots = view.rows;
  const total = view.total;
  const win = listWindow(total, view.page, DEFAULT_PAGE_SIZE);
  // SLICE 2 — banner text for lots with no evidenced received date. Returns
  // null when there is nothing to flag, so a clean store shows no badge at all
  // rather than a green "0 problems" row that trains the eye to skip it.
  const receivedDateFlag = receivedDateFlagMessage({
    missingTotal: stats.missingReceivedDate,
    missingWithStock: stats.missingReceivedDateWithStock,
  });

  /**
   * Current view state as URL params (page excluded — added per link).
   *
   * SLICE 13: this used to rebuild the query string from a hand-written
   * whitelist of the five filters that existed at the time. With twelve
   * facets, ten flags and seven ranges added, a whitelist is a liability: any
   * knob someone forgets to list is silently dropped the moment the owner
   * pages forward or switches a status tab, and the list changes underneath
   * them for no visible reason.
   *
   * So it now carries EVERY incoming param through verbatim (repeated keys
   * included, so a comma-bearing vendor name survives), and only `page` is
   * managed per-link. Adding a filter can no longer break pagination.
   */
  const filterParams = () => {
    const params = paramsFrom(sp as RawParams);
    params.delete("page");
    return params;
  };
  const pageHref = (p: number) => {
    const params = filterParams();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/inventory${qs ? `?${qs}` : ""}`;
  };
  /**
   * SLICE 8 — bulk-fill mode. Only the literal "1" enters it, matching the
   * `parseGapFlag` discipline (junk params silently mean "off").
   */
  const bulkMode = sp.bulk === "1";
  /** Entering bulk mode PRESERVES the current filters — that is the whole point:
   *  filter to the gap you want, then fill exactly those lots. */
  const bulkEnterHref = (() => {
    const params = filterParams();
    params.set("bulk", "1");
    return `/admin/inventory?${params.toString()}`;
  })();
  /** Status-tab links carry every OTHER filter and reset to page 1. */
  const statusHref = (key: string) => {
    const params = filterParams();
    params.delete("status");
    if (key !== "all") params.set("status", key);
    const qs = params.toString();
    return `/admin/inventory${qs ? `?${qs}` : ""}`;
  };
  // SLICE 77: name the vendor being filtered so the banner reads plainly.
  const vendorFilterName = vendorId
    ? lots.find((l) => l.vendor_id === vendorId)?.vendor_name ?? "this vendor"
    : null;
  const gaps = inventoryGapInsights(stats);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <AdminPageHeader
        title="Inventory"
        subtitle="Every lot tied to its vendor, brand, COA, and manifest — the traceability backbone most WA retailers don't have. Compliance reports are built on top of this real data, never re-entered."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory" }]} />}
        action={
          <Button href="/admin/inventory/intake" variant="save" size="sm">
            + Import vendor JSON
          </Button>
        }
        help={
          <HelpPanel
            id="inventory"
            title="How inventory lots work"
            steps={[
              "Each received batch becomes a lot, linked to its vendor, brand, and COA (lab result).",
              "Lots carry an expiry date and a lifecycle status (active, quarantine, recalled, etc.).",
              "Use adjustments to record shrink, damage, samples, destructions, and cycle-counts.",
              "Vendor JSON intake (next slice) drafts lots + COAs for you to review and accept.",
            ]}
          >
            <p>
              The &quot;Needs attention&quot; panel surfaces recalls, expiring product, and lots missing a
              COA — the compliance + safety risks that matter most.
            </p>
            <SopSheetLink slug="publish" />
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
        {/* SLICE 76: Inventory is its own journey stage now (between Master and Pay). */}
        <CatalogStageStrip current="inventory" />

        {/* Top KPI band */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total lots" value={stats.total} accent="muted" />
          <StatCard label="Active lots" value={stats.active} accent="green" />
          {/*
            SLICE 7 — an honest on-hand total. Lots with no unit cost on file
            contribute 0 to this figure (store.ts skips them), so the number was
            understated by an unknown amount with nothing on screen to say so.
            That is the remaining half of the owner's original "wrong on-hand
            cost" report; the other half was the 1,000-row truncation.
          */}
          <StatCard
            label="On-hand cost"
            value={fmtMoney(stats.onHandCostMinor)}
            hint={
              describeCostIncompleteness(stats.costSkippedUnknown) ?? "On-hand qty × unit cost"
            }
            accent={stats.costSkippedUnknown > 0 ? "orange" : "gold"}
          />
          {/*
            SLICE 7 — `missingExpiry` joins this tile. Before this slice a lot
            with NO expiry date was counted by nothing: the stats loop read
            `if (r.expires_on)`, so an unknown expiry fell through both the
            expired and expiring-soon branches and never reached this number.
            Unknown is raised, never treated as fine (the SLICE 2 doctrine).
          */}
          <StatCard
            label="Needs attention"
            value={
              stats.recalled +
              stats.quarantine +
              stats.expired +
              stats.expiringSoon +
              stats.missingCoa +
              stats.missingExpiry
            }
            hint="Recalls, expiry, quarantine, missing COA"
            accent={
              stats.recalled +
                stats.quarantine +
                stats.expired +
                stats.missingCoa +
                stats.missingExpiry >
              0
                ? "orange"
                : "muted"
            }
          />
        </div>

        {/*
          SLICE 2 — THE RECEIVED-DATE FLAG (owner-mandated).

          Lots whose POS export had a blank Received date have NO evidenced
          receipt day. While that is unknown, CCRS Inventory.CreatedDate falls
          back to the import instant, so the LCB would be told the lot was
          created on migration day. NULL is never quietly filled in; it is
          raised here for the owner to resolve (standing rule 3).
        */}
        {receivedDateFlag && (
          <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-orange-200">Received dates missing</div>
                <p className="mt-1 text-neutral-300">{receivedDateFlag}</p>
              </div>
              <Link
                href="/admin/inventory?needsReceivedDate=1"
                className="shrink-0 rounded-md border border-orange-400/50 px-3 py-1.5 font-medium text-orange-100 hover:bg-orange-500/20"
              >
                Show these lots
              </Link>
            </div>
          </div>
        )}

        {/* Needs-attention insight */}
        <MissingInsight
          title="Needs attention"
          subtitle={`Expiry window: ${EXPIRING_SOON_DAYS} days`}
          noun="lot"
          gaps={gaps}
        />

        {/* Task L — professional inventory intelligence (ABC, FEFO, aging,
            months-of-supply vs the WAC 4-month ceiling, shrink telemetry). */}
        <InventoryIntelPanel center={intel.center} sellFirst={intel.sellFirst} />

        {/* SLICE 16 — lots with real stock that the register still cannot
            sell, each with the one action that fixes it. Silent when clean. */}
        <RegisterSellabilityBanner
          summary={sellability.summary}
          blocked={sellability.blocked}
        />

        {/* SLICE 18 — the result of a restore, said plainly. `restored` is a
            success, `restoreError` is the honest refusal (no stock, recall
            hold, hidden card). Both come straight from the server action. */}
        {typeof sp.restored === "string" && sp.restored && (
          <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            {sp.restored}
          </p>
        )}
        {typeof sp.restoreError === "string" && sp.restoreError && (
          <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            {sp.restoreError}
          </p>
        )}

        {/* SLICE 18 — the undo the register's "86" button never had. Silent
            unless something is flagged unavailable while stock sits behind it. */}
        <RestoreToSalePanel restorable={sellability.restorable} />

        {/* SLICE 77: vendors ⇄ inventory cross-link banner. When the list is
            filtered to one vendor's lots, say so in plain English and offer a
            one-click way back to everything (or over to the vendor's page). */}
        {vendorId && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm">
            <span className="text-[var(--admin-text)]">
              Showing only lots from <strong>{vendorFilterName}</strong>.
            </span>
            <Link
              href={`/admin/vendors/${vendorId}`}
              className="font-semibold text-[var(--admin-accent)] hover:underline"
            >
              Open vendor page →
            </Link>
            <Link
              href="/admin/inventory"
              className="font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            >
              ✕ Clear filter (show all lots)
            </Link>
          </div>
        )}

        {/* Filters (SLICE 26: full control — status tabs, search, COA /
            sample / medical tri-states, expiry window, and sort, all
            URL-driven and combinable). */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((t) => {
            const isActive = activeStatus === t.key;
            return (
              <Link
                key={t.key}
                href={statusHref(t.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[var(--admin-accent)] text-black"
                    : "bg-white/5 text-[var(--admin-text-muted)] hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/*
          SLICE 13 — the filter panel replaces the old five-control strip.

          The owner asked to "refine my inventory list in every way
          imaginable": twelve multi-select facets built from the real data with
          live counts, ten tri-state flag filters, five numeric ranges, two
          date ranges, and removable chips for whatever is engaged. Every
          control is a link or a GET field, so the URL stays the single source
          of truth and a filtered view can still be bookmarked or shared.
        */}
        <InventoryFilterPanel
          raw={sp as RawParams}
          state={view.filters}
          allLots={view.facetSource}
          activeCount={view.activeFilterCount}
          open={view.activeFilterCount > 0}
        />

        {/*
          SLICE 8 — BULK FILL MODE.

          Entered explicitly from the button below (Basis Design System: a bulk
          edit "mode" triggered from a button above the table), so the normal
          browsing view stays uncluttered. Pairs with the SLICE 7 gap worklists:
          filter to "Missing expiry", enter bulk fill, and complete them all in
          one reviewed pass.
        */}
        {bulkMode ? (
          <BulkFillPanel
            visibleLotIds={lots.map((l) => l.id)}
            field={sp.bulkField}
            value={sp.bulkValue}
            previewCount={sp.bulkPreview}
            skippedCount={sp.bulkSkipped}
            previewIds={sp.bulkIds}
            doneCount={sp.bulkDone}
            failedCount={sp.bulkFailed}
            error={sp.bulkError}
          />
        ) : (
          lots.length > 0 && (
            <div className="mb-4 flex justify-end">
              <Link
                href={bulkEnterHref}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              >
                Bulk fill missing fields…
              </Link>
            </div>
          )
        )}

        {/*
          SLICE 13 — the "did you mean" disclosure.

          The owner asked for a search that shows its "best guess rather than
          showing me nothing". It does — but a guess must SAY it is a guess.
          This banner appears only when the exact-match pass found nothing and
          the typo-tolerant pass had to rescue the search, so the owner always
          knows whether they are looking at what they asked for or at what the
          system thinks they meant.
        */}
        {view.didYouMean && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-2.5 text-xs text-[var(--admin-gold)]">
            No exact match for <span className="font-semibold">{sp.q}</span>. Showing the closest
            matches instead.
          </div>
        )}

        {/* GW-033: exact result count + pager (server-side pagination). */}
        <ListPager window={win} total={total} noun="lot" makeHref={pageHref} />

        {stats.total === 0 && (
          <EmptyState
            icon="📦"
            title="No inventory lots yet"
            description="Lots will appear here once you import a vendor JSON manifest (next slice) or add one manually."
          />
        )}

        {lots.length > 0 && (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                {/* SLICE 50 (owner request): Received / Type / Size / Sold / Strain columns
                    added beside the existing ones. Received = the lot's true arrival date
                    (import backdates created_at to the POS Received date); Sold = received
                    minus on hand, never negative. All values come straight from the lot row
                    via the pure lot-table-core helpers — nothing invented. */}
                {/* SLICE 13: every header is now a link that sorts the list.
                    Click once for the sensible direction (names A→Z, dates
                    newest-first, numbers highest-first), again to reverse,
                    again to turn the sort off. */}
                <tr>
                  <SortableHeader columnKey="product" label="Product / lot" raw={sp as RawParams} />
                  <SortableHeader columnKey="vendor" label="Vendor · brand" raw={sp as RawParams} />
                  <SortableHeader columnKey="type" label="Type" raw={sp as RawParams} />
                  <SortableHeader columnKey="strain" label="Strain" raw={sp as RawParams} />
                  {/* SLICE 54: strain TYPE from its own column (migration 0138, Rule 1.4). */}
                  <SortableHeader columnKey="strainType" label="Strain Type" raw={sp as RawParams} />
                  <SortableHeader columnKey="size" label="Size" raw={sp as RawParams} />
                  <SortableHeader columnKey="coa" label="COA" raw={sp as RawParams} align="center" />
                  <SortableHeader columnKey="thc" label="THC" raw={sp as RawParams} align="right" />
                  <SortableHeader columnKey="received" label="Received" raw={sp as RawParams} />
                  <SortableHeader columnKey="onhand" label="On hand" raw={sp as RawParams} align="right" />
                  <SortableHeader columnKey="sold" label="Sold" raw={sp as RawParams} align="right" />
                  <SortableHeader columnKey="expires" label="Expires" raw={sp as RawParams} />
                  <SortableHeader columnKey="status" label="Status" raw={sp as RawParams} align="center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {lots.map((l) => {
                  const expired = l.expires_on != null && l.expires_on < today;
                  return (
                    <tr
                      key={l.id}
                      className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/inventory/${l.id}`}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {l.product_name ?? "(unnamed lot)"}
                        </Link>
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          {l.lot_code ?? "no lot code"}
                          {!l.pos_product_key && (
                            <span className="ml-2 text-[var(--admin-orange)]">· unlinked</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {l.vendor_name ?? l.vendor_id ?? "—"}
                        {l.brand_name && (
                          <span className="text-[var(--admin-text-faint)]"> · {l.brand_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{lotTypeLabel(l)}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{lotStrainLabel(l)}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{lotStrainTypeLabel(l)}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{lotSizeLabel(l)}</td>
                      <td className="px-4 py-3 text-center">
                        {l.lab ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {/* SLICE 61: mg-dosed types (edibles/drinks/topicals/tinctures) show mg, not "%". */}
                        {lotPotencyLabel(l.lab?.total_thc_pct, l)}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{lotReceivedDate(l)}</td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--admin-text)]">
                        {fmtQty(l.on_hand_qty, l.unit)}
                        {l.is_sample && (
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                            sample
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {fmtQty(lotSoldQty(l), l.unit)}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {l.expires_on ? (
                          <span className={expired ? "font-semibold text-[var(--admin-danger)]" : ""}>
                            {l.expires_on}
                            {expired && " (expired)"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={l.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {win.totalPages > 1 && (
          <ListPager window={win} total={total} noun="lot" makeHref={pageHref} />
        )}
        {lots.length === 0 && stats.total > 0 && (
          /*
            SLICE 13 — a dead end must offer a way out. The old message said
            only "No lots match your filter", which leaves the owner to work
            out which of twenty-odd knobs is responsible. Now it says how many
            are engaged and gives one click to clear them.
          */
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-5 text-center">
            <p className="text-sm text-[var(--admin-text-muted)]">
              No lots match {view.activeFilterCount > 0 || sp.q ? "these filters" : "your filter"}.
            </p>
            {(view.activeFilterCount > 0 || sp.q) && (
              <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
                {view.activeFilterCount > 0 && (
                  <>
                    {view.activeFilterCount} filter
                    {view.activeFilterCount === 1 ? " is" : "s are"} active.{" "}
                  </>
                )}
                <Link
                  href={clearAllFiltersHref(sp as RawParams)}
                  className="text-[var(--admin-accent)] underline-offset-2 hover:underline"
                >
                  Clear everything
                </Link>{" "}
                to see the full list.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
