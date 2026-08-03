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
// Option A: per-product website Type/Category override (migration 0150).
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { getOverrideForKey } from "@/lib/pos/product-classification-overrides";
import {
  adjustLotAction,
  setLotStatusAction,
  updateLotDetailsAction,
  updateLotWebsiteClassificationAction,
} from "../actions";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
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
  const [adjustments, manifest, vendors, brands, enrichment, categoryTypes, inventoryTypes, override] =
    await Promise.all([
      listLotAdjustments(id),
      lot.manifest_id ? getManifestById(lot.manifest_id) : Promise.resolve(null),
      listVendors(),
      listAllBrands(),
      lot.pos_product_key ? getEnrichment(lot.pos_product_key) : Promise.resolve(null),
      // Option A: the LIVE registries feed the override pickers, and the current
      // stored override prefills them (so re-opening shows the owner's choice).
      listWebsiteCategoryTypes({ includeInactive: false }),
      listInventoryTypes({ includeInactive: false }),
      lot.pos_product_key ? getOverrideForKey(lot.pos_product_key) : Promise.resolve(null),
    ]);
  const enrichImageId = enrichment?.primary_media_id ?? enrichment?.image_media_ids?.[0] ?? null;
  const enrichImageUrl = enrichImageId
    ? (await mediaUrlsForIds([enrichImageId])).get(enrichImageId) ?? null
    : null;

  // Convert the raw LCB classification to OUR website category for display
  // (Request B). Read-only — the stored LCB category/inventory_type are never
  // changed; they remain the CCRS source of truth.
  const categoryResolution = await resolveWebsiteCategoryForLot({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    category: lot.category,
  });

  const adjustAction = adjustLotAction.bind(null, id);
  const statusAction = setLotStatusAction.bind(null, id);
  const detailsAction = updateLotDetailsAction.bind(null, id);
  const classificationAction = updateLotWebsiteClassificationAction.bind(null, id);

  const today = new Date().toISOString().slice(0, 10);
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
