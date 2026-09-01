import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button } from "@/components/admin/ui";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { listLotsPaged, computeInventoryStats, EXPIRING_SOON_DAYS } from "@/lib/inventory/store";
import { lotReceivedDate, lotTypeLabel, lotSizeLabel, lotSoldQty, lotStrainLabel, lotStrainTypeLabel, lotPotencyLabel } from "@/lib/inventory/lot-table-core";
import { listWindow, parsePageParam, DEFAULT_PAGE_SIZE } from "@/lib/admin/list-window-core";
import { LOT_SORTS, parseYesNo, resolveSort } from "@/lib/admin/list-filter-core";
import { ListPager } from "@/components/admin/ux/ListPager";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import { getInventoryCommandCenter } from "@/lib/inventory/inventory-intel";
import { receivedDateFlagMessage } from "@/lib/inventory/received-date-core";
import { InventoryIntelPanel } from "@/components/admin/inventory/InventoryIntelPanel";

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
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const { q, status, back, page } = sp;
  const activeStatus = status ?? "all";
  const rawPage = parsePageParam(page);
  // SLICE 26: every filter knob validated by the pure grammar — garbage
  // params silently mean "filter off", never an exception.
  const sort = resolveSort(sp.sort, LOT_SORTS);
  const hasCoa = parseYesNo(sp.coa);
  const isSample = parseYesNo(sp.sample);
  const isMedical = parseYesNo(sp.medical);
  const expiringWithinDays =
    sp.expiring && /^\d{1,3}$/.test(sp.expiring) ? Number(sp.expiring) : undefined;
  // SLICE 77: the vendors ⇄ inventory cross-link. Only a UUID shape is
  // accepted — junk params silently mean "filter off", like every other knob.
  const vendorId =
    sp.vendor && /^[0-9a-f-]{36}$/i.test(sp.vendor) ? sp.vendor : undefined;
  // SLICE 2: the received-date worklist filter. Only the literal "1" turns it
  // on; anything else silently means "filter off", matching every other knob
  // on this page. `undefined` (not `false`) so the store never emits a
  // pointless `received_on is not null` predicate when the flag is absent.
  const needsReceivedDate = sp.needsReceivedDate === "1" ? true : undefined;

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

  // GW-033: fetch the requested page window plus the exact total. If the
  // requested page is past the end (stale link), clamp and refetch the real
  // last page so the screen is never empty while rows exist.
  const queryFilter = {
    q,
    status: activeStatus,
    sort: sort.columns,
    hasCoa,
    isSample,
    isMedical,
    expiringWithinDays,
    vendorId,
    needsReceivedDate,
  };
  const firstWin = listWindow(Number.MAX_SAFE_INTEGER, rawPage, DEFAULT_PAGE_SIZE);
  const [firstPage, stats, intel] = await Promise.all([
    listLotsPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    computeInventoryStats(),
    getInventoryCommandCenter(),
  ]);
  let { rows: lots, total } = firstPage;
  const win = listWindow(total, rawPage, DEFAULT_PAGE_SIZE);
  if (win.page !== rawPage && total > 0) {
    ({ rows: lots, total } = await listLotsPaged({
      ...queryFilter,
      from: win.from,
      to: win.to,
    }));
  }
  // SLICE 2 — banner text for lots with no evidenced received date. Returns
  // null when there is nothing to flag, so a clean store shows no badge at all
  // rather than a green "0 problems" row that trains the eye to skip it.
  const receivedDateFlag = receivedDateFlagMessage({
    missingTotal: stats.missingReceivedDate,
    missingWithStock: stats.missingReceivedDateWithStock,
  });

  /** Current filter state as URL params (page excluded — added per link). */
  const filterParams = () => {
    const params = new URLSearchParams();
    if (activeStatus !== "all") params.set("status", activeStatus);
    if (q) params.set("q", q);
    if (sort.key !== LOT_SORTS[0].key) params.set("sort", sort.key);
    if (sp.coa === "yes" || sp.coa === "no") params.set("coa", sp.coa);
    if (sp.sample === "yes" || sp.sample === "no") params.set("sample", sp.sample);
    if (sp.medical === "yes" || sp.medical === "no") params.set("medical", sp.medical);
    if (expiringWithinDays != null) params.set("expiring", String(expiringWithinDays));
    if (vendorId) params.set("vendor", vendorId);
    if (needsReceivedDate) params.set("needsReceivedDate", "1");
    return params;
  };
  const pageHref = (p: number) => {
    const params = filterParams();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/inventory${qs ? `?${qs}` : ""}`;
  };
  /** Status-tab links carry every OTHER filter and reset to page 1. */
  const statusHref = (key: string) => {
    const params = filterParams();
    params.delete("status");
    if (key !== "all") params.set("status", key);
    const qs = params.toString();
    return `/admin/inventory${qs ? `?${qs}` : ""}`;
  };
  const hasExtraFilters = Boolean(
    hasCoa !== undefined ||
      isSample !== undefined ||
      isMedical !== undefined ||
      expiringWithinDays != null ||
      vendorId !== undefined ||
      sort.key !== LOT_SORTS[0].key,
  );
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
          <StatCard
            label="On-hand cost"
            value={fmtMoney(stats.onHandCostMinor)}
            hint="On-hand qty × unit cost"
            accent="gold"
          />
          <StatCard
            label="Needs attention"
            value={
              stats.recalled +
              stats.quarantine +
              stats.expired +
              stats.expiringSoon +
              stats.missingCoa
            }
            hint="Recalls, expiry, quarantine, missing COA"
            accent={
              stats.recalled + stats.quarantine + stats.expired + stats.missingCoa > 0
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

        <form className="flex flex-wrap items-end gap-3" method="get">
          {activeStatus !== "all" && <input type="hidden" name="status" value={activeStatus} />}
          {/* SLICE 77: keep the vendor cross-link filter when other knobs change. */}
          {vendorId && <input type="hidden" name="vendor" value={vendorId} />}
          {/* SLICE 2: keep the received-date worklist filter when other knobs
              change. Without this hidden field, searching inside the worklist
              would silently drop it and the owner would think the compliance
              queue had emptied itself. */}
          {needsReceivedDate && <input type="hidden" name="needsReceivedDate" value="1" />}
          <div className="min-w-52 flex-1">
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Search
            </label>
            <Input name="q" defaultValue={q ?? ""} placeholder="Product, lot code, or POS key…" />
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              COA
            </label>
            <Select name="coa" defaultValue={sp.coa === "yes" || sp.coa === "no" ? sp.coa : ""} aria-label="COA filter">
              <option value="">Any</option>
              <option value="yes">Has COA</option>
              <option value="no">Missing COA</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Sample
            </label>
            <Select name="sample" defaultValue={sp.sample === "yes" || sp.sample === "no" ? sp.sample : ""} aria-label="Sample filter">
              <option value="">Any</option>
              <option value="yes">Samples only</option>
              <option value="no">Exclude samples</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Medical
            </label>
            <Select name="medical" defaultValue={sp.medical === "yes" || sp.medical === "no" ? sp.medical : ""} aria-label="Medical filter">
              <option value="">Any</option>
              <option value="yes">Medical only</option>
              <option value="no">Non-medical</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Expiring
            </label>
            <Select name="expiring" defaultValue={expiringWithinDays != null ? String(expiringWithinDays) : ""} aria-label="Expiry window">
              <option value="">Any date</option>
              <option value="7">Within 7 days</option>
              <option value="14">Within 14 days</option>
              <option value="30">Within 30 days</option>
              <option value="60">Within 60 days</option>
              <option value="90">Within 90 days</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Sort by
            </label>
            <Select name="sort" defaultValue={sort.key} aria-label="Sort lots">
              {LOT_SORTS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="neutral">
            Apply
          </Button>
          {(q || hasExtraFilters) && (
            <Link
              href={activeStatus !== "all" ? `/admin/inventory?status=${activeStatus}` : "/admin/inventory"}
              className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
            >
              Clear
            </Link>
          )}
        </form>

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
                <tr>
                  <th className="px-4 py-3">Product / lot</th>
                  <th className="px-4 py-3">Vendor · brand</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Strain</th>
                  {/* SLICE 54: strain TYPE from its own column (migration 0138, Rule 1.4). */}
                  <th className="px-4 py-3">Strain Type</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3 text-center">COA</th>
                  <th className="px-4 py-3 text-right">THC</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3 text-right">On hand</th>
                  <th className="px-4 py-3 text-right">Sold</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-center">Status</th>
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
          <p className="text-sm text-white/50">No lots match your filter.</p>
        )}
      </div>
    </div>
  );
}
