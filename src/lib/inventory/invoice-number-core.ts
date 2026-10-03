/**
 * src/lib/inventory/invoice-number-core.ts  (R26, PURE)
 *
 * The owner's top priority, verbatim: "All I really want it to do is find the
 * invoice number or order number. If it doesn't have one of those, it should
 * fall back to using the manifest number."
 *
 * WHAT WAS WRONG (verified in code, not assumed):
 *  1. Only ONE document was ever scanned — the stored raw_payload (the
 *     PRIMARY manifest's text, or the JSON). The vendor's INVOICE PDF riding
 *     the same email (where the invoice/order # actually prints — e.g. the
 *     real QGT invoice "20636Order #:") was read for transport and then thrown
 *     away. A manifest-only document (LCB / GrowFlow / Contingency Manifest)
 *     has no invoice # at all, so the column fell back to the manifest # even
 *     though the invoice was in the same email.
 *  2. "Run AI extract" found the number but only put it in the redirect URL —
 *     it was never saved.
 *  3. LlamaParse markdown hid the label/value adjacency (fixed in
 *     markdown-fields-core, used by extractInvoiceNumberFromText).
 *
 * THIS MODULE picks ONE invoice/order # from ALL of a manifest's documents,
 * with provenance, in a fixed, explainable order:
 *
 *   1. the WCIA transfer JSON's external_id / invoice_number / order_number
 *      (the LOCKED decision "order # or invoice #, whichever is available" is
 *      pinned on external_id — unchanged here; see the owner flag in R26),
 *   2. invoice-role PDFs, then manifest-role PDFs, then other PDFs,
 *   3. the email body (last resort).
 *
 * For each PDF the vision (LlamaParse) text is scanned first and its answer
 * must be GROUNDED in the PDF's own text layer when one exists
 * (extraction-grounding-core) — a vision-only number on a digital PDF that the
 * layer does not contain is rejected, and the layer itself is scanned next.
 * The manifest # is NEVER returned here: it is the display FALLBACK in
 * invoiceNumberForRow, so a stored "detected" value always means a real
 * invoice/order # was printed somewhere.
 *
 * PURE: no I/O. Self-tests: __runInvoiceNumberCoreTests.
 */
import {
  extractInvoiceNumber,
  extractInvoiceNumberFromText,
} from "@/lib/inventory/manifest-table-core";
import { groundValue, hasUsableLayer } from "@/lib/inventory/extraction-grounding-core";

export type InvoiceDocRole = "invoice" | "manifest" | "transfer-json" | "coa" | "other" | "email-body";

export type InvoiceSourceDoc = {
  role: InvoiceDocRole;
  /** Human label for provenance ("QGT_INVOICE.pdf", "email body"). */
  label: string;
  /** Primary text (LlamaParse markdown, or unpdf text when vision didn't run). */
  text?: string | null;
  /** The PDF's own text layer (unpdf) for grounding; null for scans / non-PDFs. */
  layerText?: string | null;
  /** Parsed JSON payload (transfer-json role). */
  payload?: unknown;
};

export type InvoiceNumberPick = {
  value: string;
  /** Short machine-readable provenance, persisted in invoice_number_source. */
  source: string;
  /** How it was verified. */
  groundedBy: "json" | "text-layer" | "vision-only" | "plain-text";
};

const ROLE_RANK: Record<InvoiceDocRole, number> = {
  "transfer-json": 0,
  invoice: 1,
  manifest: 2,
  other: 3,
  "email-body": 4,
  coa: 99, // a lab report's numbers are never the vendor's invoice
};

/** Truncate a label for a compact provenance string. */
function shortLabel(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

/** Scan ONE document. Null when it prints no invoice/order #. */
export function invoiceNumberFromDoc(doc: InvoiceSourceDoc): InvoiceNumberPick | null {
  if (doc.role === "coa") return null;
  const src = (how: string) => `${doc.role}:${how}:${shortLabel(doc.label)}`;

  if (doc.role === "transfer-json") {
    const v = extractInvoiceNumber(doc.payload ?? doc.text ?? null);
    return v ? { value: v, source: src("json"), groundedBy: "json" } : null;
  }

  const text = doc.text ?? "";
  const layer = doc.layerText ?? null;
  const usable = hasUsableLayer(layer);

  // 1) The primary (vision) text, grounded in the layer when one exists.
  const fromText = text ? extractInvoiceNumberFromText(text) : null;
  if (fromText) {
    if (doc.role === "email-body") {
      return { value: fromText, source: src("text"), groundedBy: "plain-text" };
    }
    const g = groundValue(fromText, layer);
    if (g.value) {
      return {
        value: g.value,
        source: src(g.groundedBy === "text-layer" ? "vision+layer" : "vision"),
        groundedBy: g.groundedBy === "text-layer" ? "text-layer" : "vision-only",
      };
    }
  }
  // 2) The layer itself (digital PDF): its own scan is document text by
  //    definition. Also recovers the case where vision text was blank.
  if (usable && layer !== text) {
    const fromLayer = extractInvoiceNumberFromText(layer as string);
    if (fromLayer) return { value: fromLayer, source: src("layer"), groundedBy: "text-layer" };
  }
  return null;
}

/**
 * Pick the invoice/order # across ALL of a manifest's documents (fixed role
 * order, stable within a role). Null when none prints one — the caller then
 * falls back to the manifest number for display.
 */
export function selectInvoiceNumber(docs: readonly InvoiceSourceDoc[]): InvoiceNumberPick | null {
  // A COA is never a source: invoiceNumberFromDoc returns null for it (and
  // ROLE_RANK sorts it last), so no separate filter is needed.
  const ordered = docs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => ROLE_RANK[a.d.role] - ROLE_RANK[b.d.role] || a.i - b.i);
  for (const { d } of ordered) {
    const pick = invoiceNumberFromDoc(d);
    if (pick) return pick;
  }
  return null;
}

/** Map an archived/attachment role string onto our roles. */
export function invoiceDocRole(role: string | null | undefined): InvoiceDocRole {
  switch ((role ?? "").toLowerCase()) {
    case "invoice":
      return "invoice";
    case "manifest":
      return "manifest";
    case "transfer-json":
      return "transfer-json";
    case "coa":
      return "coa";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Self-tests — real texts (QGT invoice/manifest unpdf layers, verbatim
// prefixes) and LABELLED SYNTHETIC LlamaParse markdown.
// ---------------------------------------------------------------------------
export function __runInvoiceNumberCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: invoice-number-core", msg);
    }
  };

  // REAL: QGT invoice unpdf layer (prefix, verbatim).
  const invoiceLayer =
    "INVOICE Created By: March 11, 2025 20636Order #: Order Date: Cultivera Support QUALITY GREEN TREES " +
    "26268 12 TREES LN NW STE 140 STE 140 POULSBO, WA 983706402 Phone: (360)930-8790 License: 413632 " +
    "Portal Ref # 29386-216849 Manifest DetailsShip To Manifest #: 15410217973875889GREENWAY MARIJUANA";
  // REAL: QGT Contingency Manifest layer (values only, no invoice #).
  const manifestLayer =
    "3/12/25 (360)930-8790 03/13/2025 07:00 am 03/13/2025 04:00 pm Chris Gibilterra Standard Delivery " +
    "QUALITY GREEN TREES 413632 W1Y40BHY9LT036548 WhiteA3169588 1Manifest ID: 15410217973875889";
  // SYNTHETIC (labelled): how LlamaParse markdown could render the invoice header.
  const invoiceMd =
    "# INVOICE\n\n| Order #: | 20636 | Order Date: | March 11, 2025 |\n|---|---|---|---|\n" +
    "| Created By: | Cultivera Support | | |\n\n**Manifest #:** 15410217973875889";

  // The owner's case: a manifest-role PDF with no invoice # + the invoice PDF.
  const pick = selectInvoiceNumber([
    { role: "manifest", label: "QGT_MANIFEST.pdf", text: manifestLayer, layerText: manifestLayer },
    { role: "invoice", label: "QGT_INVOICE.pdf", text: invoiceMd, layerText: invoiceLayer },
  ]);
  ok(pick?.value === "20636", `order # from the sibling invoice (got ${pick?.value})`);
  ok(pick?.groundedBy === "text-layer", "vision value grounded in the layer");
  ok((pick?.source ?? "").startsWith("invoice:vision+layer:"), `provenance (got ${pick?.source})`);

  // Markdown table that the OLD scanner could not read (proves the fix path).
  ok(extractInvoiceNumberFromText("| Invoice # | INV-15121 |") === "INV-15121", "pipe row invoice #");
  ok(extractInvoiceNumberFromText("**Invoice \\#:** INV-15121") === "INV-15121", "bold + escaped #");
  ok(
    extractInvoiceNumberFromText("| Invoice # | Order Date |\n|---|---|\n| 4587 | 3/11/25 |") === "4587",
    "header + value row by column",
  );

  // A vision hallucination is rejected when the layer disagrees; the layer wins.
  const hall = invoiceNumberFromDoc({
    role: "invoice",
    label: "x.pdf",
    text: "**Order #:** 20638",
    layerText: invoiceLayer,
  });
  ok(hall?.value === "20636", `hallucinated 20638 rejected, layer's 20636 used (got ${hall?.value})`);
  ok((hall?.source ?? "").startsWith("invoice:layer:"), "provenance says layer");

  // Scanned (no layer): vision-only accepted, flagged.
  const scan = invoiceNumberFromDoc({ role: "invoice", label: "scan.pdf", text: invoiceMd, layerText: "" });
  ok(scan?.value === "20636" && scan.groundedBy === "vision-only", "scan -> vision-only");

  // Vision blank, layer present -> layer scanned.
  const blank = invoiceNumberFromDoc({ role: "invoice", label: "i.pdf", text: "", layerText: invoiceLayer });
  ok(blank?.value === "20636", "blank vision text -> layer");

  // JSON first (locked decision unchanged), COA never.
  const withJson = selectInvoiceNumber([
    { role: "invoice", label: "inv.pdf", text: invoiceLayer, layerText: invoiceLayer },
    { role: "transfer-json", label: "transfer.json", payload: { external_id: "0000020830" } },
  ]);
  ok(withJson?.value === "0000020830" && withJson.groundedBy === "json", "JSON external_id keeps precedence");
  ok(
    selectInvoiceNumber([{ role: "coa", label: "coa.pdf", text: "Invoice #: 999111", layerText: null }]) === null,
    "COA never a source",
  );

  // Manifest-only email: no invoice # anywhere -> null (display falls back).
  ok(
    selectInvoiceNumber([{ role: "manifest", label: "m.pdf", text: manifestLayer, layerText: manifestLayer }]) === null,
    "manifest-only -> null (manifest # is the display fallback, never stored as detected)",
  );
  // Email body last.
  const body = selectInvoiceNumber([
    { role: "manifest", label: "m.pdf", text: manifestLayer, layerText: manifestLayer },
    { role: "email-body", label: "email body", text: "Hi! Attached is PO # 5521 for this week." },
  ]);
  ok(body?.value === "5521" && body.groundedBy === "plain-text", "email body fallback");
  // Invoice outranks the email body even if the body comes first.
  const order = selectInvoiceNumber([
    { role: "email-body", label: "email body", text: "PO # 5521" },
    { role: "invoice", label: "inv.pdf", text: invoiceLayer, layerText: invoiceLayer },
  ]);
  ok(order?.value === "20636", "role order beats array order");
  ok(selectInvoiceNumber([]) === null, "no docs -> null");
  ok(invoiceDocRole("INVOICE") === "invoice" && invoiceDocRole("weird") === "other", "role mapping");
  ok(invoiceDocRole(null) === "other" && invoiceDocRole("coa") === "coa", "role mapping null/coa");

  console.log(`invoice-number-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
