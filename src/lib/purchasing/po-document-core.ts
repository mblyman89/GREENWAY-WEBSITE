/**
 * src/lib/purchasing/po-document-core.ts
 *
 * SLICE 81 — PURE logic for the professional Greenway-branded purchase-order
 * document, the send-to-vendor flow, and the procure-to-pay paper trail.
 * No `server-only`, no DB — safe to import from tsx test harnesses.
 *
 *   1. poCodename()            — deterministic, witty-but-vendor-safe codename
 *                                ("Operation Golden Harvest") derived from the
 *                                system-assigned PO number. Same PO number →
 *                                same codename, forever. All words come from
 *                                curated, tasteful lists (nothing crude — this
 *                                appears on documents vendors see).
 *   2. renderPoDocumentHtml()  — the complete, print-ready branded PO document
 *                                as a STANDALONE html file (Greenway dark green
 *                                + gold, letter-size @page rules, compliance
 *                                footer). The on-screen preview and the
 *                                downloaded file are the SAME bytes.
 *   3. renderPoEmailHtml()     — the branded email body for Resend.
 *   4. normalizeRecipientEmail() — validates the "verify & send" recipient.
 *   5. buildPoPaperTrail()     — classifies the PO → manifest → payment →
 *                                paid-stamp chain into plain-English steps
 *                                with HONEST gaps (the owner's "full trace" /
 *                                three-way-match audit trail).
 *
 * Money is CENTS (minor units) end to end via formatMoneyMinor from po-core.
 */

import { formatMoneyMinor } from "@/lib/purchasing/po-core";

// ---------------------------------------------------------------------------
// HTML escaping (document + email bodies embed vendor/product names)
// ---------------------------------------------------------------------------
export function escapePoHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// 1. Codename generator — deterministic from the PO number
// ---------------------------------------------------------------------------
// Curated word lists. TASTEFUL, vendor-safe stoner humor only — these appear
// on the printed document footer and internal pages. Never anything crude.
const CODENAME_ADJECTIVES = [
  "Golden",
  "Emerald",
  "Blazing",
  "Mellow",
  "Cosmic",
  "Frosty",
  "Hazy",
  "Sticky",
  "Dawn",
  "Evergreen",
  "Velvet",
  "Amber",
  "Twilight",
  "Crystal",
  "Rolling",
  "Peaceful",
  "Radiant",
  "Midnight",
  "Sunlit",
  "Verdant",
] as const;

const CODENAME_NOUNS = [
  "Harvest",
  "Restock",
  "Caravan",
  "Voyage",
  "Summit",
  "Bounty",
  "Cargo",
  "Expedition",
  "Garden",
  "Lantern",
  "Meadow",
  "Orchard",
  "Pantry",
  "Pipeline",
  "Reserve",
  "Shipment",
  "Stockpile",
  "Trailblaze",
  "Treasury",
  "Windfall",
] as const;

/**
 * Deterministic codename for a system-assigned PO number ("PO-YYYYMM-0007" →
 * "Operation Amber Caravan"). The SAME po number always yields the SAME
 * codename — it is derived, never stored, so no migration is needed and it
 * can never drift from the document. Returns null for unparseable numbers.
 */
export function poCodename(poNumber: string | null | undefined): string | null {
  if (!poNumber) return null;
  const m = /^PO-(\d{6})-(\d+)$/.exec(poNumber.trim());
  if (!m) return null;
  const yyyymm = Number(m[1]);
  const seq = Number(m[2]);
  if (!Number.isFinite(yyyymm) || !Number.isFinite(seq) || seq <= 0) return null;
  // Mix the month so the same sequence in different months gets a different
  // name, while staying fully deterministic.
  const idx = yyyymm + seq;
  const adjective = CODENAME_ADJECTIVES[idx % CODENAME_ADJECTIVES.length];
  const noun = CODENAME_NOUNS[(Math.floor(idx / CODENAME_ADJECTIVES.length) + seq) % CODENAME_NOUNS.length];
  return `Operation ${adjective} ${noun}`;
}

// ---------------------------------------------------------------------------
// 4. Recipient email validation for the "Verify & send" flow
// ---------------------------------------------------------------------------
/**
 * Trim and validate a send-to email. Returns the cleaned address, or null when
 * empty/invalid — the caller refuses to send and explains in plain English.
 */
export function normalizeRecipientEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  // Practical shape check (one @, a dot in the domain, no spaces).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

/** Safe download filename for the PO document. */
export function poDocumentFilename(poNumber: string | null | undefined): string {
  const base = (poNumber ?? "purchase-order").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "purchase-order"}-greenway.html`;
}

// ---------------------------------------------------------------------------
// 2. The branded, print-ready PO document (standalone HTML)
// ---------------------------------------------------------------------------
export type PoDocumentLine = {
  productName: string;
  brand: string | null;
  category: string | null;
  orderQty: number;
  unit: string;
  unitCostMinor: number;
};

export type PoDocumentParams = {
  poNumber: string;
  /** Derived via poCodename(); pass null to omit the flourish. */
  codename: string | null;
  status: string;
  createdAt: string | null;
  expectedDate: string | null;
  note: string | null;
  paidAt: string | null;
  vendor: {
    name: string;
    licenseNumber: string | null;
    addressLines: string[];
    email: string | null;
    phone: string | null;
  };
  store: {
    name: string;
    licenseNumber: string;
    addressLines: string[];
    phone: string;
    email: string;
    website: string;
  };
  lines: PoDocumentLine[];
  /** Optional printed name for the "Authorized by" line. */
  authorizedBy?: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Render the complete standalone PO document. Greenway-branded (dark green +
 * gold), letter-size print CSS, sections modeled on a professional PO form:
 * company header, date / PO no. / reference, vendor + ship-to + bill-to,
 * requestor/shipment/terms row, item table, special instructions, totals box,
 * authorized-by line, and an I-502 compliance footer. The tiny Print button is
 * hidden on print/PDF via the no-print class.
 */
export function renderPoDocumentHtml(p: PoDocumentParams): string {
  const subtotal = p.lines.reduce((s, l) => s + Math.round(l.orderQty * l.unitCostMinor), 0);
  const rows = p.lines
    .map((l, i) => {
      const lineTotal = Math.round(l.orderQty * l.unitCostMinor);
      const detail = [l.brand, l.category].filter(Boolean).join(" · ");
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><div class="item">${escapePoHtml(l.productName)}</div>${detail ? `<div class="detail">${escapePoHtml(detail)}</div>` : ""}</td>
        <td class="num">${l.orderQty}</td>
        <td>${escapePoHtml(l.unit)}</td>
        <td class="money">${formatMoneyMinor(l.unitCostMinor)}</td>
        <td class="money">${formatMoneyMinor(lineTotal)}</td>
      </tr>`;
    })
    .join("\n");

  const vendorAddress = p.vendor.addressLines.filter(Boolean).map((l) => escapePoHtml(l)).join("<br/>");
  const storeAddress = p.store.addressLines.filter(Boolean).map((l) => escapePoHtml(l)).join("<br/>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Purchase Order ${escapePoHtml(p.poNumber)} — ${escapePoHtml(p.store.name)}</title>
<style>
  :root { --green: #12351f; --green-soft: #1d4d2e; --gold: #c9a227; --ink: #1c1917; --muted: #57534e; --line: #d6d3d1; --cream: #faf9f6; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0.5in; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink); background: #fff; font-size: 12.5px; line-height: 1.45; }
  .sheet { max-width: 7.5in; margin: 0 auto; padding: 24px 8px; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid var(--green); padding-bottom: 14px; }
  .doc-title { font-size: 30px; letter-spacing: 2px; color: var(--green); font-weight: 700; font-family: "Trebuchet MS", Verdana, sans-serif; }
  .doc-title .accent { color: var(--gold); }
  .codename { margin-top: 4px; font-style: italic; color: var(--muted); font-size: 12px; }
  .paid-stamp { display: inline-block; margin-top: 8px; padding: 3px 12px; border: 2px solid #15803d; color: #15803d; font-family: "Trebuchet MS", Verdana, sans-serif; font-weight: 700; letter-spacing: 3px; transform: rotate(-4deg); }
  .company { text-align: right; }
  .company .name { font-size: 17px; font-weight: 700; color: var(--green); font-family: "Trebuchet MS", Verdana, sans-serif; }
  .company .lic { color: var(--gold); font-weight: 700; font-size: 11.5px; }
  .company div { font-size: 11.5px; color: var(--muted); }
  .meta { display: flex; gap: 10px; margin: 14px 0; }
  .meta .cell { flex: 1; border: 1px solid var(--line); background: var(--cream); padding: 7px 10px; }
  .meta .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-family: "Trebuchet MS", Verdana, sans-serif; }
  .meta .v { font-weight: 700; font-size: 12.5px; }
  .parties { display: flex; gap: 10px; margin-bottom: 14px; }
  .party { flex: 1; border: 1px solid var(--line); }
  .party h3 { background: var(--green); color: #fff; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; padding: 5px 10px; font-family: "Trebuchet MS", Verdana, sans-serif; }
  .party h3 .accent { color: var(--gold); }
  .party .body { padding: 8px 10px; font-size: 11.5px; }
  .party .body .pname { font-weight: 700; font-size: 12.5px; }
  .terms { display: flex; gap: 10px; margin-bottom: 14px; }
  .terms .cell { flex: 1; border: 1px solid var(--line); padding: 7px 10px; }
  .terms .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-family: "Trebuchet MS", Verdana, sans-serif; }
  .terms .v { font-size: 11.5px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.items th { background: var(--green); color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 7px 8px; text-align: left; font-family: "Trebuchet MS", Verdana, sans-serif; }
  table.items th.money, table.items td.money { text-align: right; }
  table.items th.num, table.items td.num { text-align: center; width: 44px; }
  table.items td { border-bottom: 1px solid var(--line); padding: 7px 8px; vertical-align: top; }
  table.items tr:nth-child(even) td { background: var(--cream); }
  .item { font-weight: 700; }
  .detail { font-size: 10.5px; color: var(--muted); }
  .bottom { display: flex; gap: 14px; align-items: flex-start; }
  .instructions { flex: 1.4; border: 1px solid var(--line); }
  .instructions h3 { background: var(--cream); border-bottom: 1px solid var(--line); font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; padding: 5px 10px; color: var(--green); font-family: "Trebuchet MS", Verdana, sans-serif; }
  .instructions .body { padding: 8px 10px; min-height: 56px; font-size: 11.5px; }
  .totals { flex: 1; border: 1px solid var(--line); }
  .totals .row { display: flex; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid var(--line); font-size: 12px; }
  .totals .row:last-child { border-bottom: none; background: var(--green); color: #fff; font-weight: 700; }
  .totals .row:last-child .amt { color: var(--gold); }
  .sign { margin-top: 26px; display: flex; gap: 30px; }
  .sign .slot { flex: 1; }
  .sign .line { border-bottom: 1.5px solid var(--ink); height: 30px; }
  .sign .cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-top: 4px; font-family: "Trebuchet MS", Verdana, sans-serif; }
  .compliance { margin-top: 22px; border-top: 2px solid var(--gold); padding-top: 8px; font-size: 10px; color: var(--muted); }
  .compliance strong { color: var(--green); }
  .flourish { margin-top: 6px; font-style: italic; font-size: 10px; color: var(--gold); }
  .no-print { text-align: right; margin-bottom: 10px; }
  .no-print button { background: var(--green); color: #fff; border: none; padding: 8px 18px; font-size: 13px; cursor: pointer; border-radius: 4px; font-family: "Trebuchet MS", Verdana, sans-serif; }
  @media print { .no-print { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>

  <div class="topbar">
    <div>
      <div class="doc-title">PURCHASE <span class="accent">ORDER</span></div>
      ${p.codename ? `<div class="codename">${escapePoHtml(p.codename)}</div>` : ""}
      ${p.paidAt ? `<div class="paid-stamp">PAID</div>` : ""}
    </div>
    <div class="company">
      <div class="name">${escapePoHtml(p.store.name)}</div>
      <div>${storeAddress}</div>
      <div>${escapePoHtml(p.store.phone)} · ${escapePoHtml(p.store.email)}</div>
      <div>${escapePoHtml(p.store.website)}</div>
      <div class="lic">WSLCB License ${escapePoHtml(p.store.licenseNumber)}</div>
    </div>
  </div>

  <div class="meta">
    <div class="cell"><div class="k">Date</div><div class="v">${escapePoHtml(fmtDate(p.createdAt))}</div></div>
    <div class="cell"><div class="k">PO Number</div><div class="v">${escapePoHtml(p.poNumber)}</div></div>
    <div class="cell"><div class="k">Reference</div><div class="v">${escapePoHtml(p.codename ?? "—")}</div></div>
    <div class="cell"><div class="k">Requested delivery</div><div class="v">${escapePoHtml(p.expectedDate ?? "—")}</div></div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Vendor <span class="accent">·</span> Supplier</h3>
      <div class="body">
        <div class="pname">${escapePoHtml(p.vendor.name)}</div>
        ${p.vendor.licenseNumber ? `<div>WSLCB License ${escapePoHtml(p.vendor.licenseNumber)}</div>` : ""}
        ${vendorAddress ? `<div>${vendorAddress}</div>` : ""}
        ${p.vendor.phone ? `<div>${escapePoHtml(p.vendor.phone)}</div>` : ""}
        ${p.vendor.email ? `<div>${escapePoHtml(p.vendor.email)}</div>` : ""}
      </div>
    </div>
    <div class="party">
      <h3>Ship <span class="accent">·</span> To</h3>
      <div class="body">
        <div class="pname">${escapePoHtml(p.store.name)}</div>
        <div>${storeAddress}</div>
        <div>Licensed premises — deliveries by I-502 licensed transport only.</div>
      </div>
    </div>
    <div class="party">
      <h3>Bill <span class="accent">·</span> To</h3>
      <div class="body">
        <div class="pname">${escapePoHtml(p.store.name)}</div>
        <div>${storeAddress}</div>
        <div>${escapePoHtml(p.store.email)}</div>
      </div>
    </div>
  </div>

  <div class="terms">
    <div class="cell"><div class="k">Requested by</div><div class="v">${escapePoHtml(p.authorizedBy ?? "Purchasing — " + p.store.name)}</div></div>
    <div class="cell"><div class="k">Shipment</div><div class="v">WA I-502 licensed transport with CCRS transport manifest</div></div>
    <div class="cell"><div class="k">Payment terms</div><div class="v">Per invoice after receipt, unless otherwise agreed</div></div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Item</th>
        <th class="num">Qty</th>
        <th>Unit</th>
        <th class="money">Unit cost</th>
        <th class="money">Line total</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="bottom">
    <div class="instructions">
      <h3>Special instructions</h3>
      <div class="body">${p.note ? escapePoHtml(p.note) : "Please reply to confirm availability, pricing, and the delivery date. Include this PO number on the transport manifest and the invoice."}</div>
    </div>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span class="amt">${formatMoneyMinor(subtotal)}</span></div>
      <div class="row"><span>Excise &amp; taxes</span><span class="amt">Per WA law — not included</span></div>
      <div class="row"><span>TOTAL</span><span class="amt">${formatMoneyMinor(subtotal)}</span></div>
    </div>
  </div>

  <div class="sign">
    <div class="slot"><div class="line"></div><div class="cap">Authorized by${p.authorizedBy ? ` — ${escapePoHtml(p.authorizedBy)}` : ""}</div></div>
    <div class="slot"><div class="line"></div><div class="cap">Date</div></div>
  </div>

  <div class="compliance">
    <strong>Compliance:</strong> This purchase order is issued by ${escapePoHtml(p.store.name)}, a Washington State licensed cannabis
    retailer (WSLCB License ${escapePoHtml(p.store.licenseNumber)}). Cannabis products must be transported by an I-502 licensed
    carrier with a WA CCRS transport manifest referencing this PO number, and may only be delivered to the licensed premises
    listed above. Quantities are confirmed against the transport manifest at receiving; payment is issued against the invoice
    after receipt (three-way match: PO ↔ manifest ↔ invoice).
    ${p.codename ? `<div class="flourish">${escapePoHtml(p.codename)} — grown with patience, ordered with purpose.</div>` : ""}
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 3. Branded vendor email body
// ---------------------------------------------------------------------------
export type PoEmailParams = {
  poNumber: string;
  vendorName: string | null;
  expectedDate: string | null;
  note: string | null;
  lines: PoDocumentLine[];
  store: PoDocumentParams["store"];
};

/** Greenway-branded HTML email: header band, line table, compliance footer. */
export function renderPoEmailHtml(p: PoEmailParams): string {
  const subtotal = p.lines.reduce((s, l) => s + Math.round(l.orderQty * l.unitCostMinor), 0);
  const rows = p.lines
    .map((l) => {
      const detail = [l.brand, l.category].filter(Boolean).join(" · ");
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e5e4"><strong>${escapePoHtml(l.productName)}</strong>${detail ? `<br/><span style="color:#78716c;font-size:12px">${escapePoHtml(detail)}</span>` : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right">${l.orderQty} ${escapePoHtml(l.unit)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right">${formatMoneyMinor(l.unitCostMinor)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right">${formatMoneyMinor(Math.round(l.orderQty * l.unitCostMinor))}</td>
      </tr>`;
    })
    .join("\n");

  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#1c1917;max-width:640px;margin:0 auto">
  <div style="background:#12351f;padding:18px 24px;border-bottom:4px solid #c9a227">
    <div style="color:#ffffff;font-size:20px;font-weight:700;font-family:'Trebuchet MS',Verdana,sans-serif">${escapePoHtml(p.store.name)}</div>
    <div style="color:#c9a227;font-size:13px">Purchase Order ${escapePoHtml(p.poNumber)}</div>
  </div>
  <div style="padding:20px 24px;background:#ffffff">
    <p style="margin:0 0 12px">Hello${p.vendorName ? ` ${escapePoHtml(p.vendorName)}` : ""},</p>
    <p style="margin:0 0 16px">Please find our purchase order below. Reply to this email to confirm availability, pricing, and the delivery date${p.expectedDate ? ` (requested: <strong>${escapePoHtml(p.expectedDate)}</strong>)` : ""}. Include <strong>${escapePoHtml(p.poNumber)}</strong> on the transport manifest and the invoice.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#12351f;color:#ffffff;font-family:'Trebuchet MS',Verdana,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:1px">
          <th style="padding:7px 10px;text-align:left">Item</th>
          <th style="padding:7px 10px;text-align:right">Qty</th>
          <th style="padding:7px 10px;text-align:right">Unit cost</th>
          <th style="padding:7px 10px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:8px 10px;text-align:right;font-weight:700">Subtotal</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;color:#12351f">${formatMoneyMinor(subtotal)}</td>
        </tr>
      </tfoot>
    </table>
    ${p.note ? `<p style="margin:16px 0 0;padding:10px 12px;background:#faf9f6;border-left:3px solid #c9a227"><strong>Note:</strong> ${escapePoHtml(p.note)}</p>` : ""}
    <p style="margin:18px 0 0;color:#57534e;font-size:12px">Deliveries are accepted at our licensed premises only (${escapePoHtml(p.store.addressLines.join(", "))}) via I-502 licensed transport with a WA CCRS transport manifest.</p>
  </div>
  <div style="background:#faf9f6;padding:12px 24px;border-top:1px solid #e7e5e4;font-size:12px;color:#57534e">
    ${escapePoHtml(p.store.name)} · WSLCB License ${escapePoHtml(p.store.licenseNumber)} · ${escapePoHtml(p.store.phone)} · ${escapePoHtml(p.store.email)}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// 5. Paper trail — PO → manifest(s) → payment(s) → paid stamp, honest gaps
// ---------------------------------------------------------------------------
export type TrailManifestFact = {
  id: string;
  number: string | null;
  /** inbound_manifests.status: pending | accepted | rejected … */
  status: string;
  /** Cost basis (SUM received_qty × unit_cost over non-rejected lots), cents. */
  owedMinor: number;
  /** SUM of vendor_manifest_payments applied, cents. */
  paidMinor: number;
};

export type PoTrailFacts = {
  poNumber: string | null;
  status: string;
  /** false when migration 0102 (manifest ↔ PO link) is not applied yet. */
  linkAvailable: boolean;
  manifests: TrailManifestFact[];
  paidAt: string | null;
  paymentReference: string | null;
};

export type TrailStepState = "done" | "partial" | "missing" | "unavailable";

export type TrailStep = {
  key: "po" | "manifest" | "payment" | "stamp";
  label: string;
  state: TrailStepState;
  /** Plain-English status line — honest about gaps, never guesses. */
  note: string;
};

/** Manifest statuses that count as "the delivery arrived". */
const RECEIVED_MANIFEST_STATUSES = new Set(["accepted", "partially_accepted"]);

/**
 * Classify the procure-to-pay chain into four plain-English steps. This is the
 * owner's "full trace": the purchase order, the delivery manifest(s) linked to
 * it, the invoice payment(s) recorded against those manifests, and the
 * automatic paid stamp. Gaps are stated honestly with what to do next.
 */
export function buildPoPaperTrail(f: PoTrailFacts): TrailStep[] {
  const steps: TrailStep[] = [];
  const poName = f.poNumber ?? "This purchase order";

  // Step 1 — the PO document itself.
  const poNote =
    f.status === "draft"
      ? `${poName} is a draft — the vendor has not seen it yet.`
      : f.status === "cancelled"
        ? `${poName} was cancelled — the chain ends here.`
        : `${poName} was issued to the vendor (status: ${f.status}).`;
  steps.push({ key: "po", label: "Purchase order", state: "done", note: poNote });

  // Step 2 — the delivery manifest(s).
  if (!f.linkAvailable) {
    steps.push({
      key: "manifest",
      label: "Delivery manifest",
      state: "unavailable",
      note: "Manifest linking needs migration 0102 — until it is applied, this hop cannot be traced.",
    });
  } else if (f.manifests.length === 0) {
    steps.push({
      key: "manifest",
      label: "Delivery manifest",
      state: "missing",
      note: "No delivery manifest is linked yet. When the truck arrives, link the manifest to this PO from the manifest review page.",
    });
  } else {
    const received = f.manifests.filter((m) => RECEIVED_MANIFEST_STATUSES.has(m.status.toLowerCase()));
    const label = f.manifests.length === 1 ? "manifest" : "manifests";
    if (received.length === f.manifests.length) {
      steps.push({
        key: "manifest",
        label: "Delivery manifest",
        state: "done",
        note: `${f.manifests.length} ${label} linked and accepted — the delivery is on the books.`,
      });
    } else {
      steps.push({
        key: "manifest",
        label: "Delivery manifest",
        state: "partial",
        note: `${received.length} of ${f.manifests.length} linked ${label} accepted so far — finish reviewing the rest in Inventory intake.`,
      });
    }
  }

  // Step 3 — invoice payment(s) against the linked manifests.
  if (!f.linkAvailable || f.manifests.length === 0) {
    steps.push({
      key: "payment",
      label: "Invoice payment",
      state: "missing",
      note: "Payments are matched through the delivery manifest — link a manifest first, then pay it from Vendor payments.",
    });
  } else {
    const owed = f.manifests.reduce((s, m) => s + m.owedMinor, 0);
    const paid = f.manifests.reduce((s, m) => s + m.paidMinor, 0);
    if (owed <= 0) {
      steps.push({
        key: "payment",
        label: "Invoice payment",
        state: "missing",
        note: "No cost basis yet — the linked manifest has no received quantities with unit costs, so there is nothing to pay.",
      });
    } else if (paid >= owed) {
      steps.push({
        key: "payment",
        label: "Invoice payment",
        state: "done",
        note: `Paid in full — ${formatMoneyMinor(paid)} recorded against ${formatMoneyMinor(owed)} owed.`,
      });
    } else if (paid > 0) {
      steps.push({
        key: "payment",
        label: "Invoice payment",
        state: "partial",
        note: `Partially paid — ${formatMoneyMinor(paid)} of ${formatMoneyMinor(owed)} owed. Settle the rest from Vendor payments.`,
      });
    } else {
      steps.push({
        key: "payment",
        label: "Invoice payment",
        state: "missing",
        note: `Nothing paid yet — ${formatMoneyMinor(owed)} owed. Pay it from Vendor payments.`,
      });
    }
  }

  // Step 4 — the automatic paid stamp.
  if (f.paidAt) {
    steps.push({
      key: "stamp",
      label: "Paid stamp",
      state: "done",
      note: `Stamped paid${f.paymentReference ? ` (${f.paymentReference})` : ""} — set automatically when Accounts Payable settled every linked invoice.`,
    });
  } else {
    steps.push({
      key: "stamp",
      label: "Paid stamp",
      state: "missing",
      note: "Not stamped yet — this happens automatically the moment a payment settles every manifest linked to this PO.",
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
export function __runPoDocumentCoreTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL: ${name}`);
    }
  }

  const store = {
    name: "Greenway Marijuana",
    licenseNumber: "413541",
    addressLines: ["4851 Geiger Rd SE", "Port Orchard, WA 98367"],
    phone: "(360) 443-6988",
    email: "contact@greenwaymarijuana.com",
    website: "https://www.greenwaymarijuana.com",
  };

  // --- codename ---
  const c1 = poCodename("PO-202403-0007");
  expect("codename deterministic", c1 === poCodename("PO-202403-0007"));
  expect("codename starts with Operation", (c1 ?? "").startsWith("Operation "));
  const parts = (c1 ?? "").split(" ");
  expect("codename has 3 words", parts.length === 3);
  expect(
    "codename words come from the curated lists",
    (CODENAME_ADJECTIVES as readonly string[]).includes(parts[1]) &&
      (CODENAME_NOUNS as readonly string[]).includes(parts[2]),
  );
  expect("codename differs by seq", poCodename("PO-202403-0008") !== c1);
  expect("codename differs by month", poCodename("PO-202404-0007") !== c1);
  expect("codename null for junk", poCodename("nonsense") === null);
  expect("codename null for empty", poCodename("") === null && poCodename(null) === null);
  // Every possible word is vendor-safe: single capitalized dictionary words.
  expect(
    "all codename words look tasteful (capitalized alpha)",
    [...CODENAME_ADJECTIVES, ...CODENAME_NOUNS].every((w) => /^[A-Z][a-z]+$/.test(w)),
  );

  // --- recipient email ---
  expect("email valid", normalizeRecipientEmail(" orders@farm.com ") === "orders@farm.com");
  expect("email invalid no at", normalizeRecipientEmail("ordersfarm.com") === null);
  expect("email invalid no tld", normalizeRecipientEmail("orders@farm") === null);
  expect("email invalid spaces", normalizeRecipientEmail("or ders@farm.com") === null);
  expect("email empty null", normalizeRecipientEmail("") === null && normalizeRecipientEmail(null) === null);

  // --- filename ---
  expect("filename basic", poDocumentFilename("PO-202403-0007") === "PO-202403-0007-greenway.html");
  expect("filename sanitized", poDocumentFilename("PO/..\\evil") === "PO-evil-greenway.html");
  expect("filename fallback", poDocumentFilename(null) === "purchase-order-greenway.html");

  // --- document html ---
  const doc = renderPoDocumentHtml({
    poNumber: "PO-202403-0007",
    codename: poCodename("PO-202403-0007"),
    status: "draft",
    createdAt: "2024-03-15T10:00:00Z",
    expectedDate: "2024-03-20",
    note: "Deliver before noon <please>",
    paidAt: null,
    vendor: {
      name: "Acme Farms <LLC>",
      licenseNumber: "123456",
      addressLines: ["1 Farm Rd", "Yakima, WA 98901"],
      email: "orders@acmefarms.com",
      phone: "(509) 555-0100",
    },
    store,
    lines: [
      { productName: "Blue Dream 3.5g", brand: "Acme", category: "flower", orderQty: 24, unit: "each", unitCostMinor: 900 },
      { productName: "<script>alert(1)</script>", brand: null, category: null, orderQty: 2, unit: "case", unitCostMinor: 12550 },
    ],
  });
  expect("doc has PO number", doc.includes("PO-202403-0007"));
  expect("doc has codename", doc.includes("Operation "));
  expect("doc has our license", doc.includes("WSLCB License 413541"));
  expect("doc has vendor license", doc.includes("WSLCB License 123456"));
  expect("doc escapes vendor name", doc.includes("Acme Farms &lt;LLC&gt;") && !doc.includes("Acme Farms <LLC>"));
  expect("doc escapes script", !doc.includes("<script>alert(1)</script>"));
  expect("doc line total 216", doc.includes("$216.00"));
  expect("doc subtotal 467", doc.includes("$467.00"));
  expect("doc has print css", doc.includes("@page") && doc.includes("no-print"));
  expect("doc has ship-to premises line", doc.includes("Licensed premises"));
  expect("doc has three-way match footer", doc.includes("three-way match"));
  expect("doc no PAID stamp unpaid", !doc.includes(">PAID<"));
  const paidDoc = renderPoDocumentHtml({
    poNumber: "PO-202403-0007",
    codename: null,
    status: "received",
    createdAt: null,
    expectedDate: null,
    note: null,
    paidAt: "2024-04-01T00:00:00Z",
    vendor: { name: "Acme", licenseNumber: null, addressLines: [], email: null, phone: null },
    store,
    lines: [{ productName: "X", brand: null, category: null, orderQty: 1, unit: "each", unitCostMinor: 100 }],
  });
  expect("doc PAID stamp when paid", paidDoc.includes(">PAID<"));

  // --- email html ---
  const email = renderPoEmailHtml({
    poNumber: "PO-202403-0007",
    vendorName: "Acme Farms",
    expectedDate: "2024-03-20",
    note: "Deliver before noon",
    lines: [{ productName: "Blue Dream 3.5g", brand: "Acme", category: "flower", orderQty: 24, unit: "each", unitCostMinor: 900 }],
    store,
  });
  expect("email has PO number", email.includes("PO-202403-0007"));
  expect("email has brand header", email.includes("Greenway Marijuana"));
  expect("email has subtotal", email.includes("$216.00"));
  expect("email has license", email.includes("WSLCB License 413541"));
  expect("email has manifest reminder", email.includes("transport manifest"));

  // --- paper trail ---
  const base: PoTrailFacts = {
    poNumber: "PO-202403-0007",
    status: "sent",
    linkAvailable: true,
    manifests: [],
    paidAt: null,
    paymentReference: null,
  };
  const t1 = buildPoPaperTrail(base);
  expect("trail has 4 steps", t1.length === 4);
  expect("trail po done", t1[0].state === "done" && t1[0].key === "po");
  expect("trail manifest missing", t1[1].state === "missing" && t1[1].note.includes("link the manifest"));
  expect("trail payment blocked on manifest", t1[2].state === "missing" && t1[2].note.includes("link a manifest first"));
  expect("trail stamp missing", t1[3].state === "missing");

  const t2 = buildPoPaperTrail({
    ...base,
    manifests: [{ id: "m1", number: "MAN-1", status: "accepted", owedMinor: 50000, paidMinor: 50000 }],
    paidAt: "2024-04-01T00:00:00Z",
    paymentReference: "ACH-20240401-1030",
  });
  expect("trail manifest done", t2[1].state === "done");
  expect("trail payment done", t2[2].state === "done" && t2[2].note.includes("$500.00"));
  expect("trail stamp done with ref", t2[3].state === "done" && t2[3].note.includes("ACH-20240401-1030"));

  const t3 = buildPoPaperTrail({
    ...base,
    manifests: [
      { id: "m1", number: "MAN-1", status: "accepted", owedMinor: 50000, paidMinor: 20000 },
      { id: "m2", number: "MAN-2", status: "pending", owedMinor: 0, paidMinor: 0 },
    ],
  });
  expect("trail manifest partial", t3[1].state === "partial" && t3[1].note.includes("1 of 2"));
  expect("trail payment partial", t3[2].state === "partial" && t3[2].note.includes("$200.00") && t3[2].note.includes("$500.00"));

  const t4 = buildPoPaperTrail({ ...base, linkAvailable: false });
  expect("trail unavailable pre-0102", t4[1].state === "unavailable" && t4[1].note.includes("0102"));

  const t5 = buildPoPaperTrail({
    ...base,
    manifests: [{ id: "m1", number: null, status: "accepted", owedMinor: 10000, paidMinor: 0 }],
  });
  expect("trail payment nothing paid", t5[2].state === "missing" && t5[2].note.includes("$100.00 owed"));

  const t6 = buildPoPaperTrail({ ...base, status: "draft" });
  expect("trail draft note", t6[0].note.includes("draft"));
  const t7 = buildPoPaperTrail({ ...base, status: "cancelled" });
  expect("trail cancelled note", t7[0].note.includes("cancelled"));

  console.log(`po-document-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`po-document-core tests failed: ${failed}`);
}
