/**
 * src/lib/inventory/migration-lot-fix-core.ts  (Round 12 — Cultivera fix reachability)
 *
 * Owner, Round 12: "make sure that the products from the Cultivera upload
 * specifically can reach the fix pages … I need these fixes to apply to the
 * Cultivera products."
 *
 * The lot page shows `pos_product_key` and `Expires` read-only and its COA
 * panel says "link or import the lab result" with no control (verified in
 * src/app/admin/inventory/[id]/page.tsx). For a lot from the one-time
 * Cultivera import (createImportLots, import-service.ts) those blanks are the
 * NORMAL state — the importer sets no lab_result_id, expiry is blank in every
 * export, and cost is null when unparseable — and the ONLY control that can
 * fill them is Bulk fill on the Inventory list (bulk-fill-core.ts:
 * eligibility = migration lots only). This module builds the lot page's
 * "From the one-time Cultivera import" callout: one link per blank
 * bulk-fillable field, opening Bulk fill on a list narrowed to THIS lot.
 *
 * Narrowing: the list's `q` matches lot_code / product_name / pos_product_key
 * (store.ts listLotsPaged). An ACTIVE lot also gets its gap knob
 * (lot-gap-core: gap filters imply status=active), so the list contains only
 * lots that really have the blank. A non-active lot gets `q` alone — a gap
 * knob would force status=active and hide it. `q` is a contains-match, so a
 * short code can pull in look-alike lots; the Bulk fill PREVIEW names every
 * lot before anything is written, so nothing is ever filled blind.
 *
 * Pure: no I/O.
 */
import {
  MIGRATION_MARKER,
  BULK_FILLABLE_FIELDS,
  isBlank,
  fieldLabel,
  type BulkFillField,
} from "@/lib/inventory/bulk-fill-core";

export type MigrationLotInput = {
  notes: string | null;
  status: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  expires_on: string | null;
  unit_cost_minor_units: number | null;
  lab_result_id: string | null;
  product_name: string | null;
  id: string;
};

/** Lot-gap knob for each bulk-fillable field (lot-gap-core LOT_GAP_DEFINITIONS params). */
export const FIELD_GAP_PARAM: Readonly<Record<BulkFillField, string>> = {
  expires_on: "missingExpiry",
  unit_cost_minor_units: "unknownCost",
  pos_product_key: "missingProductLink",
};

export type MigrationFixLink = { field: BulkFillField; label: string; href: string };

export type MigrationLotCallout = {
  links: MigrationFixLink[];
  /** True when no lab result is linked (the COA CSV import is a roadmap item). */
  coaMissing: boolean;
  /** Plain-English summary line. */
  summary: string;
};

/**
 * The callout for a lot, or null when the lot is not from the Cultivera
 * import or is destroyed (Bulk fill refuses destroyed lots).
 */
export function migrationLotCallout(lot: MigrationLotInput): MigrationLotCallout | null {
  if (!(lot.notes ?? "").includes(MIGRATION_MARKER)) return null;
  if (lot.status === "destroyed") return null;
  const needle = (lot.lot_code ?? "").trim() || (lot.pos_product_key ?? "").trim();
  const links: MigrationFixLink[] = [];
  for (const field of BULK_FILLABLE_FIELDS) {
    if (!isBlank({ ...lot }, field)) continue;
    const params = new URLSearchParams();
    if (lot.status === "active") {
      params.set("status", "active");
      params.set(FIELD_GAP_PARAM[field], "1");
    }
    if (needle) params.set("q", needle);
    params.set("bulk", "1");
    params.set("bulkField", field);
    links.push({ field, label: `Fill ${fieldLabel(field)} with Bulk fill`, href: `/admin/inventory?${params.toString()}` });
  }
  const coaMissing = !lot.lab_result_id;
  const blanks = links.map((l) => fieldLabel(l.field).toLowerCase());
  if (coaMissing) blanks.push("lab result (COA)");
  const summary =
    blanks.length === 0
      ? "This lot came from the one-time Cultivera import. Its import-blank fields are all filled."
      : `This lot came from the one-time Cultivera import, which did not supply: ${blanks.join(", ")}.`;
  return { links, coaMissing, summary };
}

/** Manifest link for a lot (intake page), or null when the lot has no manifest. */
export function lotManifestHref(manifestId: string | null | undefined): string | null {
  const id = (manifestId ?? "").trim();
  return id ? `/admin/inventory/intake/${encodeURIComponent(id)}` : null;
}

export function __runMigrationLotFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL migration-lot-fix-core: " + msg);
    }
  };
  const base: MigrationLotInput = {
    id: "lot-1",
    notes: `${MIGRATION_MARKER} Received 2026-09-01.`,
    status: "active",
    lot_code: "WA123",
    pos_product_key: "pos-abc",
    expires_on: null,
    unit_cost_minor_units: null,
    lab_result_id: null,
    product_name: "Blue Dream 1g",
  };

  const c = migrationLotCallout(base)!;
  ok(c !== null, "migration lot gets a callout");
  ok(c.links.length === 2, "expiry + cost blank -> 2 links");
  ok(c.links[0].field === "expires_on" && c.links[1].field === "unit_cost_minor_units", "field order follows BULK_FILLABLE_FIELDS");
  ok(c.links[0].href === "/admin/inventory?status=active&missingExpiry=1&q=WA123&bulk=1&bulkField=expires_on", "active expiry href");
  ok(c.links[1].href === "/admin/inventory?status=active&unknownCost=1&q=WA123&bulk=1&bulkField=unit_cost_minor_units", "active cost href");
  ok(c.links[0].label === "Fill Expiration date with Bulk fill", "label");
  ok(c.coaMissing === true, "coa missing flagged");
  ok(c.summary === "This lot came from the one-time Cultivera import, which did not supply: expiration date, unit cost, lab result (COA).", "summary lists blanks");

  // Not a migration lot -> nothing (intake lots are perfect before allowed in).
  ok(migrationLotCallout({ ...base, notes: "Received via intake" }) === null, "intake lot -> null");
  ok(migrationLotCallout({ ...base, notes: null }) === null, "null notes -> null");
  ok(migrationLotCallout({ ...base, status: "destroyed" }) === null, "destroyed -> null");

  // Unlinked product key -> link field present; needle falls back.
  const u = migrationLotCallout({ ...base, pos_product_key: "", expires_on: "2027-01-01", unit_cost_minor_units: 500 })!;
  ok(u.links.length === 1 && u.links[0].field === "pos_product_key", "only the key link");
  ok(u.links[0].href === "/admin/inventory?status=active&missingProductLink=1&q=WA123&bulk=1&bulkField=pos_product_key", "key href");

  // Non-active lot: q only, no gap knob (a gap knob would force active and hide it).
  const q = migrationLotCallout({ ...base, status: "quarantine" })!;
  ok(q.links[0].href === "/admin/inventory?q=WA123&bulk=1&bulkField=expires_on", "quarantine href uses q only");

  // No lot code -> q falls back to the product key; neither -> no q.
  ok(migrationLotCallout({ ...base, lot_code: null })!.links[0].href.includes("q=pos-abc"), "q falls back to key");
  const none = migrationLotCallout({ ...base, lot_code: " ", pos_product_key: null })!;
  ok(!none.links[0].href.includes("q="), "no needle -> no q");

  // Zero cost is a KNOWN cost (bulk-fill-core isBlank) -> no cost link.
  ok(!migrationLotCallout({ ...base, unit_cost_minor_units: 0 })!.links.some((l) => l.field === "unit_cost_minor_units"), "zero cost not blank");

  // All filled + COA linked.
  const full = migrationLotCallout({ ...base, expires_on: "2027-01-01", unit_cost_minor_units: 1, lab_result_id: "lr-1" })!;
  ok(full.links.length === 0 && full.coaMissing === false, "nothing to fill");
  ok(full.summary === "This lot came from the one-time Cultivera import. Its import-blank fields are all filled.", "all-filled summary");
  // Filled fields but no COA still names the COA.
  ok(migrationLotCallout({ ...base, expires_on: "2027-01-01", unit_cost_minor_units: 1 })!.summary.endsWith("did not supply: lab result (COA)."), "coa-only summary");

  // Special characters in the code are URL-encoded.
  ok(migrationLotCallout({ ...base, lot_code: "A&B 1" })!.links[0].href.includes("q=A%26B+1"), "q encoded");

  // Manifest link.
  ok(lotManifestHref("m-1") === "/admin/inventory/intake/m-1", "manifest href");
  ok(lotManifestHref(null) === null, "no manifest -> null");
  ok(lotManifestHref(" ") === null, "blank manifest -> null");

  // Every field has a gap param.
  ok(BULK_FILLABLE_FIELDS.every((f) => typeof FIELD_GAP_PARAM[f] === "string"), "every field mapped");

  return { passed, failed };
}
