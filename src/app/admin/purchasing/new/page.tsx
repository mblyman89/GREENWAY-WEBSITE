import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Field, Input, Badge } from "@/components/admin/ui";
import { listVendors } from "@/lib/vendors/store";
import {
  buildReorderSuggestions,
  getReorderSettings,
  formatMoneyMinor,
  type PoFilter,
} from "@/lib/purchasing/po-store";
import {
  buildBuilderKpis,
  groupRowsByVendor,
  buildEmptyStateGuidance,
  type BuilderKpis,
  type BuilderGroupRow,
} from "@/lib/purchasing/po-builder-core";
import {
  createPurchaseOrderAction,
  createAndSendPurchaseOrderAction,
  interpretPlanAction,
  saveReorderSettingsAction,
} from "../actions";
import { BuilderTable, type SuggestionRow } from "./builder-table";
import { getSnapshot, getSnapshotItems, getSnapshotItem } from "@/lib/purchasing/cultivera-store";
import { detailFromItemRaw } from "@/lib/purchasing/cultivera-menu-core";
import {
  parseMenuItemIds,
  buildMenuPrefills,
  menuPrefillBanner,
  parseVariantSelections,
  buildVariantPrefills,
  variantPrefillBanner,
} from "@/lib/purchasing/cultivera-po-core";
import {
  getGrowflowSnapshot,
  getGrowflowSnapshotItems,
} from "@/lib/purchasing/growflow-store";
import { growflowMenuPrefillBanner } from "@/lib/purchasing/growflow-media-core";
import { getEmailedMenu, getEmailedMenuItems } from "@/lib/purchasing/emailed-menu-store";
import { emailMenuPrefillBanner } from "@/lib/purchasing/email-menu-core";
import { getLeaflinkSnapshot, getLeaflinkSnapshotItems } from "@/lib/purchasing/leaflink-store";
import { leaflinkMenuPrefillBanner } from "@/lib/purchasing/leaflink-media-core";
import { PoMarketContextCard } from "../PoMarketContextCard";
import type { PoLineLike } from "@/lib/purchasing/po-market-context-core";
import { PoCockpitSection } from "@/app/admin/discovery/PoCockpitSection";
import { isDiscoveryEnabled } from "@/lib/discovery/store";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function csv(sp: SP, key: string): string[] {
  const v = sp[key];
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

/**
 * Cannabis category benchmarks (Northstar Financial) shown as GUIDANCE ONLY —
 * these are industry ranges to sanity-check an order's mix, never this store's
 * actual numbers. Documented in docs/RESEARCH_CANNABIS_PURCHASING.md.
 */
const CATEGORY_GUIDE: { label: string; note: string }[] = [
  { label: "Flower", note: "Fastest turns (12–18/yr) · order often, never stock out" },
  { label: "Pre-rolls", note: "8–14 turns · strong impulse category" },
  { label: "Vape", note: "8–12 turns · high margin (55–65%)" },
  { label: "Concentrates", note: "6–10 turns · watch batch dates" },
  { label: "Edibles", note: "Slower (4–8) · FIFO, expiration matters" },
  { label: "Topicals", note: "Slowest (3–6) · order conservatively" },
];

// ---------------------------------------------------------------------------
// Command strip — a FEW real, actionable numbers (procurement-dashboard
// practice: fewer, smarter metrics; see docs/RESEARCH_CANNABIS_PURCHASING.md).
// Every figure is computed by the PURE po-builder-core module from the actual
// reorder suggestions in view — nothing estimated.
// ---------------------------------------------------------------------------
function CommandStrip({ kpis, leadTimeDays }: { kpis: BuilderKpis; leadTimeDays: number }) {
  const stats: { label: string; value: string; sub: string; tone?: "danger" | "orange" | "gold" }[] = [
    {
      label: "Stockouts",
      value: String(kpis.stockoutCount),
      sub: "selling, zero on hand",
      tone: kpis.stockoutCount > 0 ? "danger" : undefined,
    },
    {
      label: "Order today",
      value: String(kpis.criticalCount),
      sub: `run out within lead time (${leadTimeDays}d)`,
      tone: kpis.criticalCount > 0 ? "orange" : undefined,
    },
    {
      label: "Below reorder",
      value: String(kpis.lowCount),
      sub: "order soon",
      tone: kpis.lowCount > 0 ? "gold" : undefined,
    },
    {
      label: "Suggested buy",
      value: formatMoneyMinor(kpis.suggestedSpendMinor),
      sub: `${kpis.suggestedUnits.toLocaleString("en-US")} units suggested`,
    },
    {
      label: "In view",
      value: String(kpis.totalRows),
      sub: `${kpis.vendorCount} vendor${kpis.vendorCount === 1 ? "" : "s"} · ${kpis.categoryCount} categor${kpis.categoryCount === 1 ? "y" : "ies"}`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`rounded-[var(--admin-radius-lg)] border bg-[var(--admin-surface)] px-4 py-3 ${
            s.tone === "danger"
              ? "border-[var(--admin-danger)]/40"
              : s.tone === "orange"
                ? "border-[var(--admin-orange)]/40"
                : s.tone === "gold"
                  ? "border-[var(--admin-gold)]/40"
                  : "border-[var(--admin-border)]"
          }`}
        >
          <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            {s.label}
          </div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${
              s.tone === "danger"
                ? "text-[var(--admin-danger)]"
                : s.tone === "orange"
                  ? "text-[var(--admin-orange)]"
                  : s.tone === "gold"
                    ? "text-[var(--admin-gold)]"
                    : "text-[var(--admin-text)]"
            }`}
          >
            {s.value}
          </div>
          <div className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Vendor hot list — who needs a call today, computed from the rows in view. */
function VendorHotList({ groups }: { groups: BuilderGroupRow[] }) {
  const hot = groups.filter((g) => g.needsActionCount > 0).slice(0, 6);
  if (hot.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
      <span className="font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        Vendors needing action:
      </span>
      {hot.map((g) => (
        <Badge key={g.label} tone={g.label === "(unknown)" ? "neutral" : "orange"}>
          {g.label}: {g.needsActionCount} item{g.needsActionCount === 1 ? "" : "s"} ·{" "}
          {formatMoneyMinor(g.suggestedSpendMinor)}
        </Badge>
      ))}
    </div>
  );
}

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const [vendors, settings, discoveryEnabled] = await Promise.all([
    listVendors(),
    getReorderSettings(),
    // Best-effort: the cockpit's "Start PO" action requires Discovery to be
    // on, so the section only mounts when the feature flag says so.
    isDiscoveryEnabled().catch(() => false),
  ]);

  // Resolve AI/manual vendor-name filters → vendor ids.
  const nameToId = new Map<string, string>();
  vendors.forEach((v) => {
    if (v.display_name) nameToId.set(v.display_name.toLowerCase(), v.id);
  });
  const resolveVendorNames = (names: string[]) =>
    names.map((n) => nameToId.get(n.toLowerCase())).filter((x): x is string => Boolean(x));

  const filter: PoFilter = {
    includeVendorIds: resolveVendorNames(csv(sp, "incVendor")),
    excludeVendorIds: resolveVendorNames(csv(sp, "excVendor")),
    includeBrands: csv(sp, "incBrand"),
    excludeBrands: csv(sp, "excBrand"),
    includeCategories: csv(sp, "incCat"),
    excludeCategories: csv(sp, "excCat"),
  };

  const suggestions = await buildReorderSuggestions({ filter });
  const rows: SuggestionRow[] = suggestions.map((s) => ({
    posProductKey: s.posProductKey,
    productName: s.productName,
    brand: s.brand,
    category: s.category,
    vendorId: s.vendorId,
    vendorName: s.vendorName,
    onHand: s.onHand,
    unit: s.unit,
    unitCostMinor: s.unitCostMinor,
    avgDaily: s.result.avgDaily,
    reorderPoint: s.result.reorderPoint,
    suggestedQty: s.result.suggestedQty,
    belowReorderPoint: s.result.belowReorderPoint,
    daysOfSupplyLeft: s.result.daysOfSupplyLeft,
  }));

  // Discovery hand-off: when arriving from a promoted product lead, build a
  // prefilled DRAFT line the builder prepends and pre-selects. Nothing is
  // ordered automatically — the manager confirms quantity, cost, and vendor.
  const fromLead = one(sp, "fromLead");
  const leadCostMinorRaw = one(sp, "leadCostMinor");
  const leadCostMinor = leadCostMinorRaw ? Math.max(0, Math.round(Number(leadCostMinorRaw) || 0)) : 0;
  // W11 — the promotion may thread a RECONCILED vendor id (license- or
  // name-matched in Discovery). Only accept it if it's a real vendor we buy
  // from (verified against the vendors list) — never trust a raw URL param.
  const leadVendorIdRaw = one(sp, "leadVendorId");
  const leadVendorId =
    leadVendorIdRaw && vendors.some((v) => v.id === leadVendorIdRaw) ? leadVendorIdRaw : null;
  const prefill: SuggestionRow | undefined = fromLead
    ? {
        posProductKey: null,
        productName: one(sp, "leadName") ?? "New product (from lead)",
        brand: one(sp, "leadBrand") ?? null,
        category: one(sp, "leadCategory") ?? null,
        vendorId: leadVendorId,
        vendorName: one(sp, "leadVendorName") ?? null,
        onHand: 0,
        unit: "each",
        unitCostMinor: leadCostMinor,
        avgDaily: 0,
        reorderPoint: 0,
        suggestedQty: 1,
        belowReorderPoint: true,
        daysOfSupplyLeft: 0,
      }
    : undefined;

  // CV-6 — Cultivera menu hand-off: `fromMenu=<snapshotId>` + ticked
  // `item=<id>` params. The URL only carries IDS; every line is rebuilt from
  // OUR OWN saved snapshot rows, and only ids that exist in that snapshot
  // are honored (W11: never trust a raw URL param). The snapshot's vendor id
  // is threaded only when it matches a real vendor record.
  const fromMenu = one(sp, "fromMenu");
  const menuItemIds = parseMenuItemIds(sp["item"]);
  let menuPrefills: SuggestionRow[] = [];
  let menuVendorLabel: string | null = null;
  if (fromMenu && menuItemIds.length > 0) {
    const menuSnap = await getSnapshot(fromMenu);
    if (menuSnap) {
      const menuItems = await getSnapshotItems(fromMenu);
      const menuVendorId =
        menuSnap.vendor_id && vendors.some((v) => v.id === menuSnap.vendor_id)
          ? menuSnap.vendor_id
          : null;
      menuVendorLabel = menuSnap.seller_name ?? menuSnap.cultivera_market_slug ?? null;
      menuPrefills = buildMenuPrefills(menuItems, menuItemIds, menuVendorId, menuVendorLabel);
    }
  }

  // CH-3 — per-VARIANT hand-off from a menu item's sizes table:
  // `fromMenuDetail=<snapshotId>` + `detailItem=<itemRowId>` + one
  // `vq_<variantId>=<qty>` per chosen size. W11: only OUR row ids plus the
  // quantities ride in the URL; every name, price, and cap is rebuilt from
  // the detail payload stored on OUR item row, and quantities are clamped to
  // the vendor's MaxOrderLimit/availability.
  const fromMenuDetail = one(sp, "fromMenuDetail");
  const detailItemId = one(sp, "detailItem");
  const variantSelections = parseVariantSelections(sp);
  let variantPrefills: SuggestionRow[] = [];
  let variantVendorLabel: string | null = null;
  if (fromMenuDetail && detailItemId && variantSelections.length > 0) {
    const detailSnap = await getSnapshot(fromMenuDetail);
    if (detailSnap) {
      const detailItem = await getSnapshotItem(fromMenuDetail, detailItemId);
      const detail = detailItem ? detailFromItemRaw(detailItem.raw) : null;
      if (detailItem && detail) {
        const detailVendorId =
          detailSnap.vendor_id && vendors.some((v) => v.id === detailSnap.vendor_id)
            ? detailSnap.vendor_id
            : null;
        variantVendorLabel = detailSnap.seller_name ?? detailSnap.cultivera_market_slug ?? null;
        variantPrefills = buildVariantPrefills(
          detail.variants,
          variantSelections,
          detail.name ?? detailItem.name,
          detailVendorId,
          variantVendorLabel,
        );
      }
    }
  }

  // GF-6 — GrowFlow menu hand-off: same W11-safe contract as fromMenu, but
  // the ids resolve against OUR saved growflow_menu_* rows. The saved rows
  // share the MenuPrefillItemLike columns, so buildMenuPrefills is reused.
  const fromGrowflowMenu = one(sp, "fromGrowflowMenu");
  let growflowPrefills: SuggestionRow[] = [];
  let growflowVendorLabel: string | null = null;
  if (fromGrowflowMenu && menuItemIds.length > 0) {
    const gfSnap = await getGrowflowSnapshot(fromGrowflowMenu);
    if (gfSnap) {
      const gfItems = await getGrowflowSnapshotItems(fromGrowflowMenu);
      const gfVendorId =
        gfSnap.vendor_id && vendors.some((v) => v.id === gfSnap.vendor_id)
          ? gfSnap.vendor_id
          : null;
      growflowVendorLabel = gfSnap.store_name ?? gfSnap.license_number ?? null;
      growflowPrefills = buildMenuPrefills(gfItems, menuItemIds, gfVendorId, growflowVendorLabel);
    }
  }

  // SLICE 83 — emailed menu hand-off: same W11-safe contract as fromMenu, but
  // the ids resolve against OUR saved emailed_menu_* rows (vendor guessed by
  // sender address, honored only when it matches a real vendor). The saved
  // rows share the MenuPrefillItemLike columns, so buildMenuPrefills is reused.
  const fromEmailMenu = one(sp, "fromEmailMenu");
  let emailMenuPrefills: SuggestionRow[] = [];
  let emailMenuVendorLabel: string | null = null;
  if (fromEmailMenu && menuItemIds.length > 0) {
    const emSnap = await getEmailedMenu(fromEmailMenu);
    if (emSnap) {
      const emItems = await getEmailedMenuItems(fromEmailMenu);
      const emVendorId =
        emSnap.vendor_id && vendors.some((v) => v.id === emSnap.vendor_id)
          ? emSnap.vendor_id
          : null;
      emailMenuVendorLabel = emSnap.from_name ?? emSnap.from_address ?? null;
      emailMenuPrefills = buildMenuPrefills(emItems, menuItemIds, emVendorId, emailMenuVendorLabel);
    }
  }

  // SLICE 84 — LeafLink menu hand-off: same W11-safe contract as fromMenu, but
  // the ids resolve against OUR saved leaflink_menu_* rows. The saved rows
  // share the MenuPrefillItemLike columns, so buildMenuPrefills is reused.
  const fromLeaflinkMenu = one(sp, "fromLeaflinkMenu");
  let leaflinkPrefills: SuggestionRow[] = [];
  let leaflinkVendorLabel: string | null = null;
  if (fromLeaflinkMenu && menuItemIds.length > 0) {
    const llSnap = await getLeaflinkSnapshot(fromLeaflinkMenu);
    if (llSnap) {
      const llItems = await getLeaflinkSnapshotItems(fromLeaflinkMenu);
      const llVendorId =
        llSnap.vendor_id && vendors.some((v) => v.id === llSnap.vendor_id)
          ? llSnap.vendor_id
          : null;
      leaflinkVendorLabel = llSnap.brand_name ?? llSnap.company_name ?? null;
      leaflinkPrefills = buildMenuPrefills(llItems, menuItemIds, llVendorId, leaflinkVendorLabel);
    }
  }

  // Task I (I6): candidate rows in PoLineLike shape for the market check —
  // suggested qty as the order qty, real unit costs (wholesale, minor units).
  const marketLines: PoLineLike[] = [...(prefill ? [prefill] : []), ...menuPrefills, ...variantPrefills, ...growflowPrefills, ...rows].map((r) => ({
    product_name: r.productName,
    brand: r.brand,
    category: r.category,
    order_qty: r.suggestedQty,
    unit_cost_minor_units: r.unitCostMinor,
  }));

  const planSummary = one(sp, "plan");
  const origin = one(sp, "origin") === "ai_suggested" ? "ai_suggested" : "manual";
  const aiError = one(sp, "aierror");
  const errorMsg = one(sp, "error");
  const settingsSaved = one(sp, "settings") === "1";

  // Full vendor options WITH email so the builder can email the PO directly.
  const vendorOptions = vendors
    .filter((v) => v.display_name)
    .map((v) => ({ id: v.id, name: v.display_name as string, email: v.email ?? null }));

  const hasActiveFilters =
    csv(sp, "incVendor").length +
      csv(sp, "excVendor").length +
      csv(sp, "incCat").length +
      csv(sp, "excCat").length +
      csv(sp, "incBrand").length +
      csv(sp, "excBrand").length >
    0;

  // Task J — command-center rollups, computed by the PURE core from the real
  // suggestion rows and the store's own lead-time setting.
  const leadTimeDays = settings.default_lead_time_days;
  const kpis = buildBuilderKpis(rows, leadTimeDays);
  const vendorGroups = groupRowsByVendor(rows, leadTimeDays);

  return (
    <div>
      <AdminPageHeader
        title="Purchase order command center"
        subtitle="What needs ordering, from whom, at what price — grounded in your on-hand stock, real sales velocity, and the Port Orchard market"
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Purchasing", href: "/admin/purchasing" }, { label: "New" }]}
          />
        }
        action={
          <Link href="/admin/purchasing">
            <Button variant="neutral" size="sm">Cancel</Button>
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Status banners */}
        {settingsSaved ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Reorder settings saved.
          </div>
        ) : null}
        {errorMsg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {errorMsg}
          </div>
        ) : null}
        {aiError ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {aiError}
          </div>
        ) : null}
        {prefill ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Started from a discovery lead:{" "}
            <span className="font-semibold text-[var(--admin-text)]">{prefill.productName}</span>. It&apos;s
            pre-added below as a draft line — confirm the quantity, cost, and vendor, then save.
          </div>
        ) : null}
        {menuPrefills.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {menuPrefillBanner(menuPrefills.length, menuVendorLabel)}
          </div>
        ) : null}
        {variantPrefills.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {variantPrefillBanner(variantPrefills.length, variantVendorLabel)}
          </div>
        ) : null}
        {growflowPrefills.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {growflowMenuPrefillBanner(growflowPrefills.length, growflowVendorLabel)}
          </div>
        ) : null}
        {emailMenuPrefills.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {emailMenuPrefillBanner(emailMenuPrefills.length, emailMenuVendorLabel)}
          </div>
        ) : null}
        {leaflinkPrefills.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {leaflinkMenuPrefillBanner(leaflinkPrefills.length, leaflinkVendorLabel)}
          </div>
        ) : null}

        <HelpPanel
          id="po-new-help"
          title="How this command center works"
          steps={[
            "The strip below triages your inventory: STOCKOUTS are selling with nothing on the shelf, ORDER TODAY runs out before a typical delivery arrives, BELOW REORDER needs ordering soon. All computed from your real on-hand stock and sales velocity.",
            "Step 1 — Narrow the list (optional): use the AI box or manual filters to focus on a vendor, category, or brand.",
            "Step 2 — Review & build: search, sort, and quick-select. Rows below the reorder point are pre-ticked with a suggested quantity — every number is a draft you confirm. Reorder point = avg daily sales × lead time + safety stock.",
            "Step 3 — Send: pick the vendor and either Save as draft or Save & send to email the PO straight from here.",
            "The Port Orchard sections use the latest monthly CCRS drop: the market check prices your candidate lines against observed local retail, and the battle plan shows what competitors sell that you don't — one click starts a prefilled line.",
          ]}
        >
          <p className="text-xs text-[var(--admin-text-muted)]">
            Cannabis guidance (industry benchmarks, not your data): flower turns fastest so order it
            often; edibles and topicals turn slowly, so order conservatively and watch batch dates.
          </p>
        </HelpPanel>

        {/* Command strip — only when there are rows to triage. */}
        {rows.length > 0 ? (
          <div className="space-y-3">
            <CommandStrip kpis={kpis} leadTimeDays={leadTimeDays} />
            <VendorHotList groups={vendorGroups} />
          </div>
        ) : null}

        {/* Step 1 — Narrow the list */}
        <Section
          title="1 · Narrow the list"
          description="Optional. Focus the suggestions before you build — by plain-English request or manual filters."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padding="md">
              <CardHeader title="Describe what to order" subtitle="AI drafts a filter — you confirm every line" />
              <form action={interpretPlanAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  type="text"
                  name="request"
                  placeholder="e.g. Reorder all flower from Acme except pre-rolls, cover 3 weeks"
                  className="flex-1"
                />
                <Button type="submit" variant="neutral" size="sm">Draft with AI</Button>
              </form>
              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                AI maps your words to your real vendors and categories — it never invents products.
              </p>
            </Card>

            <Card padding="md">
              <CardHeader
                title="Manual filters"
                subtitle="Comma-separated · blank = everything"
                action={
                  hasActiveFilters ? (
                    <Link href="/admin/purchasing/new">
                      <Button type="button" variant="neutral" size="sm">Reset</Button>
                    </Link>
                  ) : undefined
                }
              />
              <form method="get" className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Include vendors">
                  <Input name="incVendor" defaultValue={csv(sp, "incVendor").join(", ")} />
                </Field>
                <Field label="Exclude vendors">
                  <Input name="excVendor" defaultValue={csv(sp, "excVendor").join(", ")} />
                </Field>
                <Field label="Include categories" help="flower, edible, vape, preroll, …">
                  <Input name="incCat" defaultValue={csv(sp, "incCat").join(", ")} />
                </Field>
                <Field label="Exclude categories">
                  <Input name="excCat" defaultValue={csv(sp, "excCat").join(", ")} />
                </Field>
                <Field label="Include brands">
                  <Input name="incBrand" defaultValue={csv(sp, "incBrand").join(", ")} />
                </Field>
                <Field label="Exclude brands">
                  <Input name="excBrand" defaultValue={csv(sp, "excBrand").join(", ")} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="neutral" size="sm">Apply filters</Button>
                </div>
              </form>
            </Card>
          </div>
        </Section>

        {/* Task I (I6): Port Orchard market check for the candidate rows in
            view — only rows with REAL market evidence show (best-effort;
            hidden when no CCRS dataset is available). */}
        <PoMarketContextCard lines={marketLines} onlyMatched maxRows={15} />

        {/* Step 2 & 3 — Review, build, send */}
        <Section
          title="2 · Review, build & send"
          description={
            rows.length === 0
              ? "No products to evaluate yet."
              : `${rows.length} product${rows.length === 1 ? "" : "s"} in view · ${kpis.needsActionCount} need${kpis.needsActionCount === 1 ? "s" : ""} action${
                  hasActiveFilters ? " (filtered)" : ""
                }`
          }
        >
          {rows.length === 0 && !prefill ? (
            (() => {
              const guidance = buildEmptyStateGuidance({ hasActiveFilters, hasPrefill: false });
              return (
                <div className="space-y-3">
                  <EmptyState
                    icon="📦"
                    title={guidance.title}
                    description={guidance.description}
                    action={
                      hasActiveFilters ? (
                        <Link href="/admin/purchasing/new">
                          <Button variant="primary" size="sm">Reset filters</Button>
                        </Link>
                      ) : (
                        <Link href="/admin/inventory">
                          <Button variant="primary" size="sm">Go to Inventory</Button>
                        </Link>
                      )
                    }
                    secondary={
                      <Link href="/admin/discovery">
                        <Button variant="neutral" size="sm">Open Discovery leads</Button>
                      </Link>
                    }
                  />
                  <ul className="space-y-1 text-xs text-[var(--admin-text-muted)]">
                    {guidance.hints.map((h) => (
                      <li key={h}>· {h}</li>
                    ))}
                  </ul>
                </div>
              );
            })()
          ) : (
            <Card padding="md">
              {rows.length === 0 && prefill ? (
                <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
                  {buildEmptyStateGuidance({ hasActiveFilters, hasPrefill: true }).description}
                </p>
              ) : null}
              <BuilderTable
                rows={rows}
                vendors={vendorOptions}
                origin={origin}
                planSummary={planSummary}
                prefill={prefill}
                menuPrefills={
                  menuPrefills.length > 0 || variantPrefills.length > 0 || growflowPrefills.length > 0 || emailMenuPrefills.length > 0 || leaflinkPrefills.length > 0
                    ? [...menuPrefills, ...variantPrefills, ...growflowPrefills, ...emailMenuPrefills, ...leaflinkPrefills]
                    : undefined
                }
                fromLeadId={fromLead}
                leadTimeDays={leadTimeDays}
                createAction={createPurchaseOrderAction}
                sendAction={createAndSendPurchaseOrderAction}
              />
            </Card>
          )}
        </Section>

        {/* Task J: the Port Orchard battle plan, ON the builder — the same
            best-effort cockpit as Discovery → Leads (head-to-head board, the
            "they sell it, we don't" buy list with one-click Start PO, and the
            price check). Renders nothing until a monthly CCRS zip has been
            processed, so the page stays clean until the data exists. Gated on
            the Discovery flag because its "Start PO" action requires it. */}
        {discoveryEnabled ? <PoCockpitSection /> : null}

        {/* Reference: category guidance + planning settings (secondary) */}
        <details className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-[var(--admin-text)] marker:content-none">
            <span className="inline-flex items-center gap-2">
              <span className="text-[var(--admin-text-muted)] group-open:rotate-90 transition">▸</span>
              Reference — cannabis category guidance &amp; planning settings
            </span>
          </summary>
          <div className="space-y-5 border-t border-[var(--admin-border)] px-5 py-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Category benchmarks (industry guidance, not your data)
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CATEGORY_GUIDE.map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
                  >
                    <div className="text-sm font-semibold text-[var(--admin-text)]">{c.label}</div>
                    <div className="text-xs text-[var(--admin-text-muted)]">{c.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Reorder planning defaults
              </h3>
              <form action={saveReorderSettingsAction} className="grid gap-3 sm:grid-cols-4">
                <Field label="Velocity window (days)">
                  <Input type="number" name="velocity_window_days" defaultValue={String(settings.velocity_window_days)} />
                </Field>
                <Field label="Lead time (days)">
                  <Input type="number" name="default_lead_time_days" defaultValue={String(settings.default_lead_time_days)} />
                </Field>
                <Field label="Target days of supply">
                  <Input type="number" name="target_days_of_supply" defaultValue={String(settings.target_days_of_supply)} />
                </Field>
                <Field label="Safety stock (days)">
                  <Input type="number" name="default_safety_days" defaultValue={String(settings.default_safety_days)} />
                </Field>
                <div className="sm:col-span-4">
                  <Button type="submit" variant="save" size="sm">Save settings</Button>
                </div>
              </form>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
