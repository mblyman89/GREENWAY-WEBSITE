/**
 * src/lib/medical/exempt-sale-record-core.ts  (Slice 103)
 *
 * PURE completeness check for a WAC 314-55-090(2) excise-exempt sale record. A
 * medically-endorsed store that makes an excise-exempt sale to a qualifying
 * patient MUST keep, for FIVE years, a record of each such sale that includes:
 *   - the date of the sale,
 *   - the patient/provider Unique Patient Identifier (UPID),
 *   - the recognition card's effective and expiration dates,
 *   - the product (SKU / description), and
 *   - the sales price.
 *
 * This flags any record that is missing a required field BEFORE it is relied on
 * for an audit export — so an incomplete row can never masquerade as compliant.
 * No I/O; tsx-testable. Grounded in WAC 314-55-090(2) & (6) and
 * docs/medical-doh-requirements.md.
 */

/** The shape stored in medical_exempt_sales (subset needed for the check). */
export type ExemptSaleRecordLike = {
  /** Date of sale (ISO). We accept either an explicit sale date or created_at. */
  saleDate?: string | null;
  uniquePatientIdentifier?: string | null;
  cardEffectiveOn?: string | null;
  cardExpiresOn?: string | null;
  productSku?: string | null;
  productName?: string | null;
  salesPriceMinor?: number | null;
  exciseTaxExempt?: boolean | null;
};

export type ExemptSaleVerification = {
  ok: boolean;
  /** Required fields that are missing/blank. */
  missing: string[];
  /** Non-blocking notes (e.g. inverted card dates). */
  warnings: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function blank(s: string | null | undefined): boolean {
  return s == null || String(s).trim() === "";
}

/**
 * Verify ONE excise-exempt sale record carries every WAC 314-55-090(2) field.
 * Only records that actually claim an excise exemption are held to the excise
 * ledger standard; a record with exciseTaxExempt === false is not an excise-
 * exempt sale and returns ok (nothing to keep under this subsection). PURE.
 */
export function verifyExemptSaleRecord(rec: ExemptSaleRecordLike): ExemptSaleVerification {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Only excise-exempt sales are governed by WAC 314-55-090(2). If the flag is
  // explicitly false, there is no excise-exempt record obligation here.
  if (rec.exciseTaxExempt === false) {
    return { ok: true, missing: [], warnings: [] };
  }

  if (blank(rec.saleDate)) missing.push("sale date");
  else if (!ISO_DATE.test(String(rec.saleDate))) warnings.push("sale date is not a valid date");

  if (blank(rec.uniquePatientIdentifier)) missing.push("unique patient identifier (UPID)");

  if (blank(rec.cardEffectiveOn)) missing.push("card effective date");
  if (blank(rec.cardExpiresOn)) missing.push("card expiration date");

  if (
    !blank(rec.cardEffectiveOn) &&
    !blank(rec.cardExpiresOn) &&
    String(rec.cardEffectiveOn) > String(rec.cardExpiresOn)
  ) {
    warnings.push("card effective date is after its expiration date");
  }

  // Product: SKU is preferred; a name alone is acceptable as the "description".
  if (blank(rec.productSku) && blank(rec.productName)) {
    missing.push("product (SKU or description)");
  }

  if (rec.salesPriceMinor == null || !Number.isFinite(rec.salesPriceMinor)) {
    missing.push("sales price");
  } else if (rec.salesPriceMinor < 0) {
    warnings.push("sales price is negative");
  }

  return { ok: missing.length === 0, missing, warnings };
}

/** Verify a batch; returns the incomplete records for a report. PURE. */
export function verifyExemptSaleRecords<T extends ExemptSaleRecordLike>(
  records: T[],
): { total: number; complete: number; incomplete: Array<{ index: number; record: T; result: ExemptSaleVerification }> } {
  const incomplete: Array<{ index: number; record: T; result: ExemptSaleVerification }> = [];
  let complete = 0;
  records.forEach((record, index) => {
    const result = verifyExemptSaleRecord(record);
    if (result.ok) complete += 1;
    else incomplete.push({ index, record, result });
  });
  return { total: records.length, complete, incomplete };
}

// ── Self-tests (tsx) ────────────────────────────────────────────────────────

export function __runExemptSaleRecordTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  const good: ExemptSaleRecordLike = {
    saleDate: "2026-06-30",
    uniquePatientIdentifier: "UPID-123",
    cardEffectiveOn: "2026-01-01",
    cardExpiresOn: "2027-01-01",
    productSku: "SKU-1",
    productName: "Blue Dream 1g",
    salesPriceMinor: 1200,
    exciseTaxExempt: true,
  };
  ok(verifyExemptSaleRecord(good).ok, "complete record passes");

  const noUpid = verifyExemptSaleRecord({ ...good, uniquePatientIdentifier: "" });
  ok(!noUpid.ok && noUpid.missing.includes("unique patient identifier (UPID)"), "missing UPID flagged");

  const noDates = verifyExemptSaleRecord({ ...good, cardEffectiveOn: null, cardExpiresOn: null });
  ok(!noDates.ok && noDates.missing.length === 2, "missing both card dates flagged");

  const noPrice = verifyExemptSaleRecord({ ...good, salesPriceMinor: null });
  ok(!noPrice.ok && noPrice.missing.includes("sales price"), "missing price flagged");

  const noProduct = verifyExemptSaleRecord({ ...good, productSku: "", productName: null });
  ok(!noProduct.ok && noProduct.missing.includes("product (SKU or description)"), "missing product flagged");

  const skuOnly = verifyExemptSaleRecord({ ...good, productName: null });
  ok(skuOnly.ok, "SKU without name is acceptable");

  const nameOnly = verifyExemptSaleRecord({ ...good, productSku: null });
  ok(nameOnly.ok, "name without SKU is acceptable");

  const notExcise = verifyExemptSaleRecord({ exciseTaxExempt: false });
  ok(notExcise.ok, "non-excise-exempt record has no 090(2) obligation");

  const invertedDates = verifyExemptSaleRecord({ ...good, cardEffectiveOn: "2027-01-01", cardExpiresOn: "2026-01-01" });
  ok(invertedDates.ok && invertedDates.warnings.some((w) => w.includes("after")), "inverted card dates warned (not blocked)");

  const batch = verifyExemptSaleRecords([good, { ...good, uniquePatientIdentifier: "" }]);
  ok(batch.total === 2 && batch.complete === 1 && batch.incomplete.length === 1, "batch counts");
  ok(batch.incomplete[0].index === 1, "batch reports the bad index");

  if (failed === 0) console.log(`exempt-sale-record-core: all ${passed} tests passed`);
  return { passed, failed };
}
