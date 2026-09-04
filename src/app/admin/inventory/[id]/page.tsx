import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Select, Button } from "@/components/admin/ui";
import Link from "next/link";
import {
  getLotById,
  listLotAdjustments,
  getManifestById,
} from "@/lib/inventory/store";
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { lotPotencyLabel, lotTypeLabel } from "@/lib/inventory/lot-table-core";
import { STRAIN_TYPE_OPTIONS } from "@/lib/inventory/lot-edit-core";
import { listVendors, listAllBrands } from "@/lib/vendors/store";
import { getEnrichment, mediaUrlsForIds } from "@/lib/enrichment/store";
// PR-D1b: read the durable KB backbone (where vendor-menu saves land) KB-first,
// so a saved photo + description is visible on THIS product's detail page.
import { getKbProductByPosKey } from "@/lib/ai/kb/store";
// Option A: per-product website Type/Category override (migration 0150).
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { getOverrideForKey } from "@/lib/pos/product-classification-overrides";
// T-324: after-tax price correction (current price read + pure formula math).
import { getLotAfterTaxPrice } from "@/lib/inventory/price-write-store";
import {
  priceFormulaLabel,
  afterTaxFloorMinor,
  baseFromAfterTax,
  fmtUsd,
} from "@/lib/inventory/price-correction-core";
import {
  adjustLotAction,
  setLotStatusAction,
  updateLotDetailsAction,
  updateLotWebsiteClassificationAction,
  updateLotAfterTaxPriceAction,
  updateLotReceivedDateAction,
  updateLotComplianceClassificationAction,
} from "../actions";
// SLICE 18A: the compliance-classification panel. Status is derived by the
// pure core from MENU truth (the only surface the register enforces from).
import {
  assessClassificationStatus,
  describeClassificationGap,
  classificationBadgeLabel,
} from "@/lib/inventory/classification-status-core";
import { getMenuClassificationFlags } from "@/lib/inventory/classification-status-store";
// SLICE 2: received-date vocabulary (floor date + provenance labels) comes
// from the pure core so the UI and the validator can never disagree.
import {
  RECEIVED_DATE_FLOOR,
  receivedOnSourceLabel,
} from "@/lib/inventory/received-date-core";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

// PR-D1b — compact "last saved" label for the KB backbone panel; blank when
// the timestamp is missing or unparseable.
function formatKbSaved(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const REASONS = [
  { value: "receive", label: "Receive (add)" },
  { value: "shrink", label: "Shrink" },
  { value: "damage", label: "Damage" },
  { value: "sample", label: "Sample (lab/QA)" },
  { value: "employee_sample", label: "Employee sample (WAC 314-55-096)" },
  { value: "destruction", label: "Destruction" },
  { value: "count", label: "Cycle-count correction" },
  { value: "recall", label: "Recall removal" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "quarantine", label: "Quarantine" },
  { value: "recalled", label: "Recalled" },
  { value: "sold_out", label: "Sold out" },
  { value: "destroyed", label: "Destroyed" },
];

export default async function LotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { saved, error } = await searchParams;

  const lot = await getLotById(id);
  if (!lot) notFound();

  // SLICE 77: vendors + brands feed the correction form's pickers; the
  // enrichment record (keyed by the lot's POS product key) surfaces the
  // customer-facing photo/description right here.
  const [adjustments, manifest, vendors, brands, enrichment, kbProduct, categoryTypes, inventoryTypes, override, currentAfterTaxMinor] =
    await Promise.all([
      listLotAdjustments(id),
      lot.manifest_id ? getManifestById(lot.manifest_id) : Promise.resolve(null),
      listVendors(),
      listAllBrands(),
      lot.pos_product_key ? getEnrichment(lot.pos_product_key) : Promise.resolve(null),
      // PR-D1b: the durable KB record for THIS product (vendor-menu saves land
      // here). Read KB-first, mirroring the customer menu's read path.
      lot.pos_product_key ? getKbProductByPosKey(lot.pos_product_key) : Promise.resolve(null),
      // Option A: the LIVE registries feed the override pickers, and the current
      // stored override prefills them (so re-opening shows the owner's choice).
      listWebsiteCategoryTypes({ includeInactive: false }),
      listInventoryTypes({ includeInactive: false }),
      lot.pos_product_key ? getOverrideForKey(lot.pos_product_key) : Promise.resolve(null),
      // T-324: the CURRENT after-tax (out-the-door) price of THIS lot's variant
      // on the published menu — null until the product has been published.
      getLotAfterTaxPrice(lot.pos_product_key),
    ]);
  const enrichImageId = enrichment?.primary_media_id ?? enrichment?.image_media_ids?.[0] ?? null;
  // PR-D1b: the KB record's saved image (primary, else first in its gallery).
  const kbImageId = kbProduct?.primary_media_id ?? kbProduct?.image_media_ids?.[0] ?? null;
  // Resolve both media ids in ONE query, then pick each url back out.
  const mediaUrlMap = await mediaUrlsForIds(
    [enrichImageId, kbImageId].filter((x): x is string => Boolean(x)),
  );
  const enrichImageUrl = enrichImageId ? mediaUrlMap.get(enrichImageId) ?? null : null;
  const kbImageUrl = kbImageId ? mediaUrlMap.get(kbImageId) ?? null : null;

  // Convert the raw LCB classification to OUR website category for display
  // (Request B). Read-only — the stored LCB category/inventory_type are never
  // changed; they remain the CCRS source of truth.
  const categoryResolution = await resolveWebsiteCategoryForLot({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    category: lot.category,
  });

  // ── SLICE 18A: the compliance classification, read from the surface that
  // actually enforces it.
  //
  // We deliberately do NOT show lot.otherwise_taken here. The register reads
  // the limit flags off the MENU row (live-menu.ts:94-100), and every lot from
  // the one-time Cultivera import carries NULL lot-flags whether or not a
  // human already classified it in fact review (import-service.ts:588-616
  // writes none of them). Showing the lot column would tell the owner a
  // product is unclassified when the register is already enforcing an answer —
  // and would send him to re-do settled work.
  const menuFlags = lot.pos_product_key
    ? (await getMenuClassificationFlags([lot.pos_product_key])).get(lot.pos_product_key) ?? null
    : null;
  const effectiveWebsiteCategory =
    override?.website_category ?? categoryResolution.websiteCategory;
  const complianceStatus = assessClassificationStatus({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    resolvedWebsiteCategory: effectiveWebsiteCategory,
    otherwiseTaken: menuFlags?.otherwiseTaken ?? null,
    unitsPerPackage: menuFlags?.unitsPerPackage ?? null,
    lowThcLiquid: menuFlags?.lowThcLiquid ?? null,
    unitThcMg: menuFlags?.unitThcMg ?? null,
  });

  const adjustAction = adjustLotAction.bind(null, id);
  const statusAction = setLotStatusAction.bind(null, id);
  const detailsAction = updateLotDetailsAction.bind(null, id);
  const classificationAction = updateLotWebsiteClassificationAction.bind(null, id);
  const complianceAction = updateLotComplianceClassificationAction.bind(null, id);
  const priceAction = updateLotAfterTaxPriceAction.bind(null, id);
  // SLICE 2: the owner's received-date entry form.
  const receivedDateAction = updateLotReceivedDateAction.bind(null, id);

  // T-324: everything the price row + edit field need. The category that drives
  // the tax divisor/floor is the SAME website category the menu/cart use.
  const priceCategory = categoryResolution.websiteCategory;
  const priceFormula = priceFormulaLabel(currentAfterTaxMinor, priceCategory);
  const priceFloorMinor = afterTaxFloorMinor(lot.unit_cost_minor_units, priceCategory);
  const currentBaseMinor =
    currentAfterTaxMinor != null ? baseFromAfterTax(currentAfterTaxMinor, priceCategory) : null;

  // Standing rule 8: the business clock is America/Los_Angeles. Using the UTC
  // date here made "today" roll over at 4pm/5pm Pacific, which could mark a
  // lot expired a day early and cap the received-date picker a day short.
  const today = pacificToday();
  const expired = lot.expires_on != null && lot.expires_on < today;

  return (
    <div>
      <AdminPageHeader
        title={lot.product_name ?? "Inventory lot"}
        subtitle={`Lot ${lot.lot_code ?? "(no code)"} · ${lot.vendor_name ?? "unknown vendor"}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: lot.lot_code ?? lot.product_name ?? "Lot" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {error === "qty"
              ? "Enter a non-zero quantity."
              : error === "reason"
                ? "Choose a valid reason."
                : error === "status"
                  ? "Choose a valid status."
                  : error === "save"
                    ? "Something went wrong saving that."
                    : /* SLICE 77: the details-correction action sends real plain-English messages. */
                      decodeURIComponent(error)}
          </div>
        )}

        {/* KPI band */}
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="On hand" value={fmtQty(lot.on_hand_qty, lot.unit)} accent="green" />
          <StatCard label="Received" value={fmtQty(lot.received_qty, lot.unit)} accent="muted" />
          <StatCard label="Unit cost" value={fmtMoney(lot.unit_cost_minor_units)} accent="gold" />
          <StatCard
            label="Status"
            value={lot.status.replace("_", " ")}
            accent={
              lot.status === "recalled"
                ? "orange"
                : lot.status === "active"
                  ? "green"
                  : "muted"
            }
          />
        </div>

        {/*
          SLICE 2 — RECEIVED DATE (owner-mandated compliance capability).

          `received_on` is the day the lot was ACTUALLY received. It is stored
          separately from `created_at` (the immutable FIFO/import key) and is
          what CCRS Inventory.CreatedDate reports. When it is null we say so
          loudly and ask the owner to supply it — we never guess a date, and
          we never silently fall back to the import day (standing rule 3).
        */}
        <div
          className={`rounded-[var(--admin-radius-lg)] border p-5 ${
            lot.received_on
              ? "border-[var(--admin-border)] bg-[var(--admin-surface)]"
              : "border-orange-500/40 bg-orange-500/10"
          }`}
        >
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Received date</h2>
          {lot.received_on ? (
            <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
              This lot is on file as received on <strong>{lot.received_on}</strong> (source:{" "}
              {receivedOnSourceLabel(lot.received_on_source)}). This is the date reported to
              the LCB as the CCRS inventory date. Correcting
              it is recorded in the audit trail.
            </p>
          ) : (
            <p className="mb-4 text-xs text-orange-200">
              <strong>No received date on file.</strong> The POS export for this lot had a
              blank received date, so we did not invent one. Until you enter the real date,
              CCRS reporting falls back to the day this lot was imported, which is not when
              you actually received it. Please enter the date from the vendor manifest or
              invoice.
            </p>
          )}
          <form action={receivedDateAction} className="space-y-4">
            <Field
              label="Date received"
              help={`Use the date on the vendor manifest or invoice. Must be on or after ${RECEIVED_DATE_FLOOR} (WA retail sales began) and cannot be in the future. Leave blank to clear it back to unknown.`}
              htmlFor="received_on"
            >
              <Input
                id="received_on"
                name="received_on"
                type="date"
                defaultValue={lot.received_on ?? ""}
                min={RECEIVED_DATE_FLOOR}
                max={today}
              />
            </Field>
            <Button type="submit">
              {lot.received_on ? "Update received date" : "Save received date"}
            </Button>
          </form>
        </div>

        {/* T-324 — SELL PRICE (product-details section). The big number is the
            after-tax / out-the-door price the customer pays; the formula below
            it shows the full math (Base × tax = out-the-door) so it's crystal
            clear how the price is built. Editing lives in the corrections
            section below. */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Sell price (after tax, out-the-door)
              </p>
              <p className="mt-1 text-3xl font-bold text-[var(--admin-accent)]">
                {currentAfterTaxMinor != null ? fmtUsd(currentAfterTaxMinor) : "—"}
              </p>
              {/* The full formula, right below the after-tax value. */}
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{priceFormula}</p>
            </div>
            <div className="text-right text-xs text-[var(--admin-text-faint)]">
              {currentAfterTaxMinor != null ? (
                <>
                  <p>Legal floor: {priceFloorMinor != null ? fmtUsd(priceFloorMinor) : "— (cost unknown)"}</p>
                  <p className="mt-0.5">Edit it in “Correct the sell price” below ↓</p>
                </>
              ) : (
                <p className="max-w-[16rem]">
                  No published price yet. A price appears once this product is
                  onboarded and published to the menu.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Lot facts */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Lot details</h2>
            <dl className="space-y-2 text-sm">
              {/* SLICE 77: the vendor is a REAL link into the vendors database
                  (not free text) whenever the lot carries a vendor_id. */}
              {lot.vendor_id ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--admin-text-faint)]">Vendor</dt>
                  <dd className="text-right">
                    <Link
                      href={`/admin/vendors/${lot.vendor_id}`}
                      className="font-medium text-[var(--admin-accent)] hover:underline"
                    >
                      {lot.vendor_name ?? "View vendor"} →
                    </Link>
                  </dd>
                </div>
              ) : (
                <Row label="Vendor" value={lot.vendor_name ?? "—"} />
              )}
              <Row label="Brand" value={lot.brand_name ?? "—"} />
              <Row label="Strain" value={lot.strain_name ?? "—"} />
              {/* SLICE 63 (E1): OUR product type on screen — house labeler
                  reads the LCB type + name; raw CCRS values stay on the
                  "LCB classification" row below, untouched. */}
              <Row label="Type" value={lotTypeLabel(lot)} />
              <Row
                label="Category"
                value={
                  categoryResolution.unmapped
                    ? "— (unmapped)"
                    : categoryResolution.label || "—"
                }
              />
              <Row
                label="LCB classification"
                value={[lot.category, lot.inventory_type].filter(Boolean).join(" · ") || "—"}
              />
              {categoryResolution.unmapped && (lot.category || lot.inventory_type) ? (
                <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)] bg-[var(--admin-gold-soft)] px-3 py-2 text-[11px] text-[var(--admin-gold)]">
                  This LCB type isn&apos;t mapped to a website category yet, so the
                  menu and back office can&apos;t convert it.{" "}
                  <Link href="/admin/settings/types" className="underline">
                    Add a mapping in Settings → Types →
                  </Link>
                </div>
              ) : null}
              <Row
                label="Unit weight"
                value={lot.unit_weight != null ? `${lot.unit_weight} ${lot.unit_weight_uom ?? ""}`.trim() : "—"}
              />
              <Row label="Sample" value={lot.is_sample ? "Yes (vendor sample)" : "No"} />
              <Row label="Medical" value={lot.is_medical ? "Yes (DOH compliant)" : "No"} />
              <Row label="POS product key" value={lot.pos_product_key ?? "— (not linked)"} />
              <Row
                label="Expires"
                value={
                  lot.expires_on
                    ? expired
                      ? `${lot.expires_on} (EXPIRED)`
                      : lot.expires_on
                    : "—"
                }
                danger={expired}
              />
              <Row label="Manifest" value={manifest?.manifest_number ?? lot.manifest_id ?? "—"} />
              {lot.notes && <Row label="Notes" value={lot.notes} />}
            </dl>
          </div>

          {/* COA panel */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">
              COA / lab result
            </h2>
            {lot.lab ? (
              <dl className="space-y-2 text-sm">
                <Row
                  label="Lab test ID"
                  value={lot.lab.labtest_external_identifier ?? "—"}
                />
                <Row label="Lab" value={lot.lab.lab_name ?? "—"} />
                {/* SLICE 61: mg-dosed types (edibles/drinks/topicals/tinctures) show mg, not "%". */}
                <Row
                  label="Total THC"
                  value={lotPotencyLabel(lot.lab.total_thc_pct, lot)}
                />
                <Row
                  label="THCA"
                  value={lotPotencyLabel(lot.lab.thca_pct, lot)}
                />
                <Row
                  label="Total cannabinoids"
                  value={lotPotencyLabel(lot.lab.total_cannabinoids_pct, lot)}
                />
                <Row
                  label="CBD"
                  value={lotPotencyLabel(lot.lab.total_cbd_pct ?? lot.lab.cbd_pct, lot)}
                />
                <Row
                  label="Result"
                  value={lot.lab.passed == null ? "—" : lot.lab.passed ? "PASS" : "FAIL"}
                  danger={lot.lab.passed === false}
                />
                <Row label="COA released" value={lot.lab.coa_release_date ?? "—"} />
                <Row label="COA expires" value={lot.lab.coa_expire_date ?? "—"} />
                {(lot.lab.coa_url || lot.lab.coa_storage_path) && (
                  <div className="flex items-baseline justify-between gap-3 pt-1">
                    <dt className="text-[var(--admin-text-faint)]">COA PDF</dt>
                    <dd className="space-x-3 text-right">
                      {lot.lab.coa_storage_path ? (
                        <a
                          href={`/admin/inventory/coa/${lot.lab.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-[var(--admin-accent)] hover:underline"
                          title="Archived copy in our records"
                        >
                          📄 Download (archived)
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--admin-orange)]">not archived yet</span>
                      )}
                      {lot.lab.coa_url && (
                        <a
                          href={lot.lab.coa_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--admin-text-muted)] hover:underline"
                        >
                          vendor link ↗
                        </a>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-3 py-3 text-sm text-[var(--admin-orange)]">
                No COA linked to this lot. WA CCRS manifest reporting requires the COA&apos;s
                LabtestexternalIdentifier — link or import the lab result before selling.
              </div>
            )}
          </div>
        </div>

        {/* SLICE 77 — correct the descriptive linkage (the ONLY legally
            hand-editable lot fields). Quantities, lot codes, costs, LCB
            classification, dates and COA links stay locked to manifests and
            audited adjustments — WA traceability numbers are never hand-edited. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Correct lot details</h2>
            <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
              Fix who supplied it and what it is: vendor, brand, strain, and strain type.
              Everything else on this lot (quantities, lot code, cost, LCB classification,
              dates, COA) is compliance data and can only change through receiving or an
              audited adjustment. Every correction here is recorded in the audit trail.
            </p>
            <form action={detailsAction} className="space-y-4">
              <Field label="Vendor" help="Pick from your vendors database — this links the lot to the vendor's page." htmlFor="vendor_id">
                <Select id="vendor_id" name="vendor_id" defaultValue={lot.vendor_id ?? ""}>
                  <option value="">— No vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.display_name}
                      {v.license_number ? ` (${v.license_number})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Brand" help="A brand tied to a vendor can only be paired with that vendor." htmlFor="brand_id">
                <Select id="brand_id" name="brand_id" defaultValue={lot.brand_id ?? ""}>
                  <option value="">— No brand —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.display_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Strain name" htmlFor="strain_name">
                <Input id="strain_name" name="strain_name" defaultValue={lot.strain_name ?? ""} placeholder="e.g. Blue Dream" maxLength={120} />
              </Field>
              <Field label="Strain type" htmlFor="strain_type">
                <Select id="strain_type" name="strain_type" defaultValue={lot.strain_type ?? ""}>
                  <option value="">— Unknown —</option>
                  {STRAIN_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t === "cbd" ? "CBD" : t.charAt(0).toUpperCase() + t.slice(1).replace("-", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="save" size="sm">
                Save corrections
              </Button>
            </form>
          </div>

          {/* PR-D1b — the durable KB backbone record for THIS product. Vendor-menu
              saves (Cultivera / LeafLink / GrowFlow) land in kb_products, and the
              customer menu reads it KB-first — but this page used to show ONLY the
              enrichment layer, so a KB-only save was invisible here. Now you can
              confirm the exact saved photo + description attached to this product. */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">Saved to Knowledge Base</h2>
              {kbProduct && (
                <span
                  className={
                    kbProduct.status === "published"
                      ? "rounded-full bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-accent)]"
                      : "rounded-full bg-[var(--admin-surface-2)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-text-muted)]"
                  }
                >
                  {kbProduct.status}
                </span>
              )}
            </div>
            <p className="mb-3 text-[11px] text-[var(--admin-text-faint)]">
              The durable per-product record — the backbone the customer menu and
              the AI read first. This is where a saved vendor-menu photo &amp;
              description live.
            </p>
            {lot.pos_product_key ? (
              kbProduct ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--admin-border)] bg-black">
                      {kbImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={kbImageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--admin-text-faint)]">no photo saved</div>
                      )}
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-[var(--admin-text)]">
                        {kbProduct.display_name || lot.product_name || "(unnamed)"}
                      </p>
                      {(kbProduct.description || kbProduct.short_description) ? (
                        <p className="mt-1 line-clamp-4 text-xs text-[var(--admin-text-muted)]">
                          {kbProduct.description || kbProduct.short_description}
                        </p>
                      ) : (
                        <span className="mt-1 inline-block rounded bg-[var(--admin-gold-soft)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--admin-gold)]">
                          no description saved
                        </span>
                      )}
                      <p className="mt-1 truncate text-[11px] text-[var(--admin-text-faint)]">
                        {kbProduct.source ? `Source: ${kbProduct.source}` : "Source: —"}
                        {` · Saved ${formatKbSaved(kbProduct.updated_at)}`}
                      </p>
                    </div>
                  </div>
                  <Button href={`/admin/knowledge-base/products`} variant="neutral" size="sm">
                    View in KB Product records →
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
                  <p>
                    Nothing saved to the Knowledge Base for this product yet — save a
                    photo &amp; description from a vendor menu and it will appear here.
                  </p>
                  <Button href={`/admin/knowledge-base/products`} variant="neutral" size="sm">
                    Open KB Product records →
                  </Button>
                </div>
              )
            ) : (
              <p className="text-sm text-[var(--admin-text-faint)]">
                This lot isn&apos;t linked to a POS product key yet, so there&apos;s no
                Knowledge Base record to show.
              </p>
            )}
          </div>

          {/* SLICE 77 — what shoppers see: the enrichment record for this
              product (photo, description, tags), pulled in by POS product key,
              with a jump straight into the enrichment editor. */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">On the menu (enrichment)</h2>
            {lot.pos_product_key ? (
              enrichment ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--admin-border)] bg-black">
                      {enrichImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={enrichImageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--admin-text-faint)]">no photo</div>
                      )}
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-[var(--admin-text)]">
                        {enrichment.display_name || lot.product_name || "(unnamed)"}
                      </p>
                      <p className="mt-1 line-clamp-3 text-xs text-[var(--admin-text-muted)]">
                        {enrichment.short_description || enrichment.description || "No description written yet."}
                      </p>
                      {enrichment.tags.length > 0 && (
                        <p className="mt-1 truncate text-[11px] text-[var(--admin-text-faint)]">
                          {enrichment.tags.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button href={`/admin/products/${encodeURIComponent(lot.pos_product_key)}?back=/admin/inventory/${lot.id}`} variant="neutral" size="sm">
                    Open in Product Enrichment →
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
                  <p>
                    This product hasn&apos;t been enriched yet — no photo or description
                    for the customer menu.
                  </p>
                  <Button href={`/admin/products/${encodeURIComponent(lot.pos_product_key)}?back=/admin/inventory/${lot.id}`} variant="neutral" size="sm">
                    Start enriching →
                  </Button>
                </div>
              )
            ) : (
              <p className="text-sm text-[var(--admin-text-faint)]">
                This lot isn&apos;t linked to a POS product key yet, so there&apos;s no
                enrichment record to show. The link is made automatically when the
                product goes onto the menu.
              </p>
            )}
          </div>
        </div>

        {/* T-324 — correct the SELL price. You type the AFTER-TAX (out-the-door)
            price the customer pays; we back out the pre-tax base and enforce the
            legal cost+tax floor. Saving updates ONLY this product on the live
            menu + POS (and any staged menu) — mastered-together siblings are
            untouched. */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Correct the sell price</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
            Enter the <strong>after-tax, out-the-door</strong> price the customer
            pays at the register. We fold in{" "}
            {priceCategory && ["merch", "accessories", "accessory", "paraphernalia"].includes(priceCategory)
              ? "9.3% sales tax"
              : "37% excise + 9.3% sales tax"}{" "}
            and show the pre-tax base, so the math is always clear. Saving updates{" "}
            <strong>this product only</strong> — everywhere it appears (the live
            menu and the register) — and never changes any other product it may
            be grouped with. It can never go below the legal cost+tax floor
            {priceFloorMinor != null ? <> (<strong>{fmtUsd(priceFloorMinor)}</strong> for this lot)</> : null}.
          </p>
          {lot.pos_product_key ? (
            currentAfterTaxMinor != null ? (
              <form action={priceAction} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-xs">
                    <span className="text-[var(--admin-text-faint)]">Current out-the-door: </span>
                    <span className="font-semibold text-[var(--admin-text)]">{fmtUsd(currentAfterTaxMinor)}</span>
                  </div>
                  <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-xs">
                    <span className="text-[var(--admin-text-faint)]">Current pre-tax base: </span>
                    <span className="font-semibold text-[var(--admin-text)]">
                      {currentBaseMinor != null ? fmtUsd(currentBaseMinor) : "—"}
                    </span>
                  </div>
                </div>
                <Field
                  label="New after-tax price ($)"
                  help={
                    priceFloorMinor != null
                      ? `The out-the-door price the customer pays. Minimum allowed for this lot is ${fmtUsd(priceFloorMinor)} (cost + tax).`
                      : "The out-the-door price the customer pays. Cost is unknown for this lot, so no floor can be enforced."
                  }
                  htmlFor="after_tax_price"
                  required
                >
                  <Input
                    id="after_tax_price"
                    name="after_tax_price"
                    type="text"
                    inputMode="decimal"
                    placeholder={fmtUsd(currentAfterTaxMinor).replace("$", "")}
                    defaultValue={(currentAfterTaxMinor / 100).toFixed(2)}
                  />
                </Field>
                <p className="text-[11px] text-[var(--admin-text-faint)]">
                  Reverse math: the price you type is divided by{" "}
                  {priceCategory && ["merch", "accessories", "accessory", "paraphernalia"].includes(priceCategory)
                    ? "1.093"
                    : "1.463"}{" "}
                  to get the pre-tax base. Example — {priceFormula}. The new base
                  updates automatically from whatever you enter.
                </p>
                <Button type="submit" variant="save" size="sm">
                  Save sell price
                </Button>
              </form>
            ) : (
              <p className="text-sm text-[var(--admin-text-faint)]">
                This product doesn&apos;t have a published menu price yet, so
                there&apos;s nothing to correct. It gets a price when it&apos;s
                onboarded and published to the menu; come back here after that to
                adjust it.
              </p>
            )
          ) : (
            <p className="text-sm text-[var(--admin-text-faint)]">
              This lot isn&apos;t linked to a POS product key yet, so it has no
              menu price to edit. The link is made automatically when the product
              goes onto the menu.
            </p>
          )}
        </div>

        {/* Option A — correct THIS product's WEBSITE Type & Category (what the
            menu filters by). Behaves like the onboarding approval card: pick an
            existing value, or create a new one on the fly (saved into the same
            Types & Categories registries). NEVER touches the LCB classification
            (that stays locked as the WA traceability source of truth). */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Website type &amp; category (menu)</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
            These are the Type and Category <strong>our website</strong> uses to
            file this product on the menu — the system fills them in
            automatically, but if it got one wrong you can re-file just this
            product here. You can also add a brand-new category or type on the
            fly; it saves to your{" "}
            <Link href="/admin/settings/types" className="underline">
              Types &amp; Categories
            </Link>{" "}
            list so it&apos;s reusable everywhere. This does <strong>not</strong>{" "}
            change the LCB classification (that stays locked for WA state
            reporting).
          </p>
          {lot.pos_product_key ? (
            <>
              <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2">
                  <span className="text-[var(--admin-text-faint)]">Category now: </span>
                  <span className="font-medium text-[var(--admin-text)]">
                    {override?.website_category
                      ? `${categoryResolution.label || override.website_category} (your override)`
                      : categoryResolution.unmapped
                        ? "— (unmapped, auto)"
                        : `${categoryResolution.label || "—"} (auto)`}
                  </span>
                </div>
                <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2">
                  <span className="text-[var(--admin-text-faint)]">Type now: </span>
                  <span className="font-medium text-[var(--admin-text)]">
                    {override?.house_type
                      ? `${override.house_type} (your override)`
                      : `${lotTypeLabel(lot)} (auto)`}
                  </span>
                </div>
              </div>
              <form action={classificationAction} className="space-y-4">
                <Field
                  label="Website category"
                  help="Leave on “Keep current” to change nothing. Pick “Auto” to remove your override and let the system decide."
                  htmlFor="website_category"
                >
                  <Select id="website_category" name="website_category" defaultValue="__keep__">
                    <option value="__keep__">Keep current</option>
                    <option value="__clear__">Auto (remove my override)</option>
                    {categoryTypes.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                    <option value="__new__">➕ Create a new category…</option>
                  </Select>
                </Field>
                <Field
                  label="New category name"
                  help="Only used when you picked “Create a new category…” above."
                  htmlFor="new_category_label"
                >
                  <Input
                    id="new_category_label"
                    name="new_category_label"
                    placeholder="e.g. Live Rosin"
                    maxLength={60}
                  />
                </Field>
                <Field
                  label="Website type"
                  help="Leave on “Keep current” to change nothing. Pick “Auto” to remove your override."
                  htmlFor="house_type"
                >
                  <Select id="house_type" name="house_type" defaultValue="__keep__">
                    <option value="__keep__">Keep current</option>
                    <option value="__clear__">Auto (remove my override)</option>
                    {inventoryTypes.map((t) => (
                      <option key={t.key} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                    <option value="__new_type__">➕ Create a new type…</option>
                  </Select>
                </Field>
                <Field
                  label="New type name"
                  help="Only used when you picked “Create a new type…” above."
                  htmlFor="new_type_label"
                >
                  <Input
                    id="new_type_label"
                    name="new_type_label"
                    placeholder="e.g. Diamonds"
                    maxLength={60}
                  />
                </Field>
                <Button type="submit" variant="save" size="sm">
                  Save website type &amp; category
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-[var(--admin-text-faint)]">
              This lot isn&apos;t linked to a POS product key yet, so there&apos;s no
              menu listing to re-file. The link is made automatically when the
              product goes onto the menu.
            </p>
          )}
        </div>

        {/* ── SLICE 18A: compliance classification ──────────────────────────
            Only rendered when the answer could change a legal outcome (the
            liquid-edible shelf, or a suspected suppository). Showing it on
            every flower SKU would train the reader to scroll past the one
            place in the back office that carries a statutory consequence. */}
        {complianceStatus.inScope && lot.pos_product_key ? (
          // id="classification" is the landing target for the worklist's
          // "Classify →" link. Without it the link drops the reader at the top
          // of a 900-line page and they have to hunt for the panel they were
          // sent to fill in — which is how a worklist stops getting used.
          <div
            id="classification"
            className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">
                Sales-limit classification
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  complianceStatus.settled
                    ? "bg-emerald-500/15 text-emerald-300"
                    : complianceStatus.urgent
                      ? "bg-red-500/15 text-red-300"
                      : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {classificationBadgeLabel(complianceStatus)}
              </span>
            </div>
            <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
              Washington gives two kinds of product their own transaction limit:
              low-THC beverages (WAC 314-55-095(1)(d)(i)(E)/(F)) and products
              taken otherwise into the body, such as suppositories
              (WAC 314-55-095(1)(d)(i)(D)). This product is on a shelf where one
              of those could apply. Saving here updates the live menu, which is
              what the register enforces from.
            </p>

            {complianceStatus.reasons.length > 0 ? (
              <ul className="mb-4 space-y-2">
                {complianceStatus.reasons.map((r) => (
                  <li
                    key={r}
                    className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-xs text-[var(--admin-text)]"
                  >
                    {describeClassificationGap(r)}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2">
                <span className="text-[var(--admin-text-faint)]">
                  Taken otherwise into the body:{" "}
                </span>
                <span className="font-medium text-[var(--admin-text)]">
                  {menuFlags?.otherwiseTaken == null
                    ? "— not answered"
                    : menuFlags.otherwiseTaken
                      ? `Yes${
                          menuFlags.unitsPerPackage != null
                            ? ` · ${menuFlags.unitsPerPackage} units per package`
                            : ""
                        }`
                      : "No"}
                </span>
              </div>
              <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2">
                <span className="text-[var(--admin-text-faint)]">Low-THC beverage: </span>
                <span className="font-medium text-[var(--admin-text)]">
                  {menuFlags?.lowThcLiquid == null
                    ? "— not answered"
                    : menuFlags.lowThcLiquid
                      ? `Yes${
                          menuFlags.unitThcMg != null ? ` · ${menuFlags.unitThcMg} mg per unit` : ""
                        }`
                      : "No"}
                </span>
              </div>
            </div>

            <form action={complianceAction} className="space-y-4">
              <Field
                label="Is this taken otherwise into the body?"
                help="Suppositories and similar products. Answer honestly: leaving it unanswered makes the register sell it under the 100-unit limit instead of the 10-unit one."
                htmlFor="otherwise_taken"
                required
              >
                <Select
                  id="otherwise_taken"
                  name="otherwise_taken"
                  defaultValue={
                    menuFlags?.otherwiseTaken == null
                      ? ""
                      : menuFlags.otherwiseTaken
                        ? "yes"
                        : "no"
                  }
                >
                  <option value="">Pick yes or no…</option>
                  <option value="no">No — ordinary product</option>
                  <option value="yes">Yes — taken otherwise into the body</option>
                </Select>
              </Field>
              <Field
                label="Units per package"
                help="Required when you answer yes. One suppository is one unit; a 6-pack is 6 units."
                htmlFor="units_per_package"
              >
                <Input
                  id="units_per_package"
                  name="units_per_package"
                  inputMode="numeric"
                  placeholder="e.g. 6"
                  defaultValue={menuFlags?.unitsPerPackage ?? ""}
                />
              </Field>
              {complianceStatus.isLiquidShelf ? (
                <>
                  <Field
                    label="Is this a low-THC beverage?"
                    help="Only when each sealed container holds 4 mg or less of active delta-9 THC. Leaving it blank is safe — the product simply stays in the stricter 72 oz bucket."
                    htmlFor="low_thc_liquid"
                  >
                    <Select
                      id="low_thc_liquid"
                      name="low_thc_liquid"
                      defaultValue={
                        menuFlags?.lowThcLiquid == null ? "" : menuFlags.lowThcLiquid ? "yes" : "no"
                      }
                    >
                      <option value="">Not answered</option>
                      <option value="no">No — ordinary liquid</option>
                      <option value="yes">Yes — low-THC beverage</option>
                    </Select>
                  </Field>
                  <Field
                    label="Active delta-9 THC per unit (mg)"
                    help="The mg in ONE sealed container, from the label. One can is one unit; a 4-pack is 4 units."
                    htmlFor="unit_thc_mg"
                  >
                    <Input
                      id="unit_thc_mg"
                      name="unit_thc_mg"
                      inputMode="decimal"
                      placeholder="e.g. 2"
                      defaultValue={menuFlags?.unitThcMg ?? ""}
                    />
                  </Field>
                </>
              ) : null}
              <Button type="submit" variant="save" size="sm">
                Save sales-limit classification
              </Button>
            </form>
          </div>
        ) : null}

        {/* Adjustment + status controls */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Adjust quantity</h2>
            <form action={adjustAction} className="space-y-4">
              <Field label="Quantity change" help="Use a negative number to remove stock." htmlFor="qty_delta" required>
                <Input id="qty_delta" name="qty_delta" type="number" step="any" placeholder="-1" />
              </Field>
              <Field label="Reason" htmlFor="reason" required>
                <Select id="reason" name="reason" defaultValue="shrink">
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" htmlFor="note">
                <Textarea id="note" name="note" rows={2} placeholder="Optional detail for the audit trail…" />
              </Field>
              <Button type="submit" variant="save" size="sm">
                Record adjustment
              </Button>
            </form>
          </div>

          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Lifecycle status</h2>
            <form action={statusAction} className="space-y-4">
              <Field label="Set status" help="Recalled / destroyed lots are excluded from sale." htmlFor="status">
                <Select id="status" name="status" defaultValue={lot.status}>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="neutral" size="sm">
                Update status
              </Button>
            </form>
          </div>
        </div>

        {/* Adjustment history */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Adjustment history</h2>
          {adjustments.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">No adjustments recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {adjustments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2"
                >
                  <span className="text-[var(--admin-text-muted)]">
                    <span
                      className={`font-semibold ${a.qty_delta >= 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}
                    >
                      {a.qty_delta >= 0 ? "+" : ""}
                      {a.qty_delta}
                    </span>{" "}
                    · {a.reason}
                    {a.note && <span className="text-[var(--admin-text-faint)]"> — {a.note}</span>}
                  </span>
                  <span className="text-xs text-[var(--admin-text-faint)]">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--admin-text-faint)]">{label}</dt>
      <dd className={`text-right ${danger ? "font-semibold text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}>
        {value}
      </dd>
    </div>
  );
}
