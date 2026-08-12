/**
 * src/lib/crypto/crypto-reconstruction-report-core.ts
 *
 * R1-G5 — Assumptions register + reconstruction report (PURE).
 *
 * The final Origin Trace slice. Everything the back-trace figured out for coins
 * that arrived with NO purchase receipt has to become an AUDIT-DEFENSIBLE paper
 * trail. This core turns the trace's raw output into two plain-English tables an
 * accountant (or the IRS) can read:
 *
 *   1. Reconstruction workpaper — one row per back-traced acquisition: the
 *      asset + quantity, WHERE the trace ended (exchange / your own wallet /
 *      unknown), the on-chain evidence (tx hash + receive date), HOW the cost
 *      basis was established (basisSource), and the PRICE SOURCE used (a
 *      reconstructed FMV-at-date, an owner-provided fill, or "still needed").
 *
 *   2. Assumptions register — every place we made a documented, conservative
 *      CHOICE rather than having a receipt: a reconstructed FMV, an unpriced
 *      coin awaiting Michael's number, or an unconfirmed upstream wallet. This
 *      is the "we never guessed — here's exactly what we assumed and why" list.
 *
 * NO I/O and no server-only import, so it runs under the pure self-test harness.
 * It NEVER prints a dollar figure it didn't receive, and every unpriced /
 * unconfirmed item is FLAGGED, never hidden.
 */

import { esc } from "./crypto-tax-center-core";
import type { BasisSource, ReceiptLineage } from "./crypto-origin-trace-core";
import type {
  ReconstructedBasisRow,
  UnpricedNeed,
} from "./crypto-historical-pricing-core";

// ---------------------------------------------------------------------------
// Plain-English labels for the four basis sources.
// ---------------------------------------------------------------------------

/** How a lot's cost basis was established, in words. */
export function basisSourceLabel(source: BasisSource): string {
  switch (source) {
    case "exchange_origin":
      return "Traced to an exchange — cost set at market value on the receive date";
    case "owner_provided":
      return "Cost you provided (your real exchange fill)";
    case "on_chain_reconstructed":
      return "Moved from another wallet of yours — original cost carried over";
    case "unknown":
    default:
      return "Origin not yet established — needs your input";
  }
}

/** Short tag for the workpaper's "basis" column. */
export function basisSourceTag(source: BasisSource): string {
  switch (source) {
    case "exchange_origin":
      return "Exchange (reconstructed FMV)";
    case "owner_provided":
      return "Owner-provided";
    case "on_chain_reconstructed":
      return "Self-transfer carryover";
    case "unknown":
    default:
      return "Unresolved";
  }
}

// ---------------------------------------------------------------------------
// Row + report shapes.
// ---------------------------------------------------------------------------

/** One line in the reconstruction workpaper. */
export interface ReconstructionRow {
  assetSymbol: string;
  quantityDisplay: string;
  /** Plain-English basis tag. */
  basisTag: string;
  basisSource: BasisSource;
  /** Where the trace terminated (masked origin) or "—". */
  originDisplay: string;
  /** Tx hash evidence. */
  txHash: string;
  /** Receive date (YYYY-MM-DD) or "unknown". */
  receivedDisplay: string;
  /** Price-source provenance string, or a "needs" note. */
  priceSource: string;
  /** True when this lot still can't book a defensible basis. */
  needsAttention: boolean;
  /** One-line plain-English note (never a dollar figure we didn't receive). */
  note: string;
}

/** One line in the assumptions register (a documented, conservative choice). */
export interface AssumptionRow {
  kind: string;
  detail: string;
}

export interface ReconstructionReport {
  rows: ReconstructionRow[];
  assumptions: AssumptionRow[];
  /** Count of lots that reached a defensible origin (not "unknown"). */
  resolvedCount: number;
  /** Count of lots that still need Michael's input. */
  needsAttentionCount: number;
  /** Count of reconstructed FMV prices used. */
  reconstructedPriceCount: number;
  /** Count of receipts still awaiting a price. */
  unpricedCount: number;
  /** Count of upstream wallets still awaiting a yes/no. */
  unconfirmedWalletCount: number;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function maskOrigin(addr: string | null): string {
  const s = (addr ?? "").trim();
  if (s === "") return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(s.length - 4)}`;
}

function isoDate(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "unknown";
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${y}-${pad(m)}-${pad(day)}`;
}

// ---------------------------------------------------------------------------
// Build the report.
// ---------------------------------------------------------------------------

export interface BuildReconstructionReportInput {
  /** The trace lineages (one per inbound receipt). */
  lineages: readonly ReceiptLineage[];
  /** Symbol per receiptId (from the transaction's asset), for display. */
  symbolByReceiptId: ReadonlyMap<string, string>;
  /** Reconstructed FMV prices booked (R1-G3). */
  priced: readonly ReconstructedBasisRow[];
  /** Receipts still awaiting a price (R1-G3). */
  unpriced: readonly UnpricedNeed[];
  /** Addresses of upstream wallets still awaiting confirmation (R1-G4). */
  unconfirmedWalletAddresses: readonly string[];
}

/**
 * Assemble the reconstruction workpaper + assumptions register from the trace
 * output. Pure + deterministic: rows follow the lineage order; the register is
 * built from the priced/unpriced/unconfirmed inputs.
 */
export function buildReconstructionReport(
  input: BuildReconstructionReportInput,
): ReconstructionReport {
  const pricedByReceipt = new Map<string, ReconstructedBasisRow>();
  for (const p of input.priced) pricedByReceipt.set(p.receiptId, p);
  const unpricedByReceipt = new Map<string, UnpricedNeed>();
  for (const u of input.unpriced) unpricedByReceipt.set(u.receiptId, u);

  const rows: ReconstructionRow[] = [];
  let resolvedCount = 0;
  let needsAttentionCount = 0;

  for (const lin of input.lineages) {
    const symbol = input.symbolByReceiptId.get(lin.receiptId) ?? "";
    const priced = pricedByReceipt.get(lin.receiptId);
    const unpriced = unpricedByReceipt.get(lin.receiptId);

    let priceSource: string;
    if (lin.basisSource === "owner_provided") {
      priceSource = "Owner-provided fill";
    } else if (priced) {
      priceSource = priced.source; // "reconstructed:coingecko:...:history:DD-MM-YYYY"
    } else if (lin.needsPricing && unpriced) {
      priceSource = `Needs a price — ${unpriced.reason}`;
    } else if (lin.basisSource === "on_chain_reconstructed") {
      priceSource = "Not needed — cost carried from your own wallet";
    } else if (lin.needsPricing) {
      priceSource = "Needs a price";
    } else {
      priceSource = "—";
    }

    const needsAttention =
      lin.basisSource === "unknown" ||
      lin.needsOwnershipConfirmation ||
      (lin.needsPricing && !priced);

    if (lin.basisSource !== "unknown") resolvedCount += 1;
    if (needsAttention) needsAttentionCount += 1;

    rows.push({
      assetSymbol: symbol,
      quantityDisplay: lin.amountDecimal ?? "—",
      basisTag: basisSourceTag(lin.basisSource),
      basisSource: lin.basisSource,
      originDisplay: maskOrigin(lin.originAddress),
      txHash: lin.txHash,
      receivedDisplay: isoDate(lin.receivedAtMs),
      priceSource,
      needsAttention,
      note: lin.note,
    });
  }

  // Assumptions register — the documented, conservative choices.
  const assumptions: AssumptionRow[] = [];
  for (const p of input.priced) {
    const sym = input.symbolByReceiptId.get(p.receiptId) ?? "";
    assumptions.push({
      kind: "Reconstructed price",
      detail: `${sym || "Asset"} valued at its market price on ${p.priceDate} (source: ${p.source}).`,
    });
  }
  for (const u of input.unpriced) {
    const sym = input.symbolByReceiptId.get(u.receiptId) ?? "";
    assumptions.push({
      kind: "Price still needed",
      detail: `${sym || "Asset"} — ${u.reason}. No cost assumed; awaiting your figure.`,
    });
  }
  for (const addr of input.unconfirmedWalletAddresses) {
    assumptions.push({
      kind: "Unconfirmed wallet",
      detail: `Upstream wallet ${maskOrigin(addr)} not yet confirmed as yours — its receipts stay flagged, no basis assumed.`,
    });
  }

  return {
    rows,
    assumptions,
    resolvedCount,
    needsAttentionCount,
    reconstructedPriceCount: input.priced.length,
    unpricedCount: input.unpriced.length,
    unconfirmedWalletCount: input.unconfirmedWalletAddresses.length,
  };
}

// ---------------------------------------------------------------------------
// HTML section builders (fold into the Audit Binder).
// ---------------------------------------------------------------------------

function tr(cells: readonly string[]): string {
  return `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
}

function th(headers: readonly string[]): string {
  return `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
}

/**
 * Render the reconstruction workpaper + assumptions register as two binder
 * sections. Returns "" when there's nothing reconstructed (so a clean year adds
 * no empty clutter). Rows needing attention are marked with a visible flag.
 */
export function buildReconstructionHtml(report: ReconstructionReport): string {
  if (report.rows.length === 0 && report.assumptions.length === 0) return "";

  const workpaperRows = report.rows
    .map((r) =>
      tr([
        `${r.quantityDisplay} ${r.assetSymbol}`.trim(),
        r.basisTag,
        r.originDisplay,
        r.receivedDisplay,
        r.txHash,
        r.priceSource,
        r.needsAttention ? "⚠ NEEDS ATTENTION" : "OK",
      ]),
    )
    .join("");

  const workpaper =
    report.rows.length > 0
      ? `<table><thead>${th([
          "Property",
          "Basis method",
          "Traced origin",
          "Received",
          "Tx hash (evidence)",
          "Price source",
          "Status",
        ])}</thead><tbody>${workpaperRows}</tbody></table>`
      : `<p class="empty">No reconstructed acquisitions this year.</p>`;

  const registryRows = report.assumptions.map((a) => tr([a.kind, a.detail])).join("");
  const registry =
    report.assumptions.length > 0
      ? `<table><thead>${th(["Kind", "What we assumed (and why it's conservative)"])}</thead><tbody>${registryRows}</tbody></table>`
      : `<p class="empty">No assumptions were needed — nothing was reconstructed or guessed.</p>`;

  const summary =
    `<p class="summary">Reconstructed acquisitions: <strong>${esc(String(report.rows.length))}</strong> ` +
    `&nbsp;•&nbsp; resolved to an origin: <strong>${esc(String(report.resolvedCount))}</strong> ` +
    `&nbsp;•&nbsp; still need your input: <strong>${esc(String(report.needsAttentionCount))}</strong></p>`;

  return (
    `<section><h3>Cost-basis reconstruction workpaper</h3>${summary}${workpaper}</section>` +
    `<section><h3>Assumptions register (documented owner choices)</h3>${registry}</section>`
  );
}

// ---------------------------------------------------------------------------
// Pure self-tests (bare-call; thrown on first failure).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-reconstruction-report-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`crypto-reconstruction-report-core: ${msg} — expected truthy`);
  }
}

function lineage(over: Partial<ReceiptLineage> & { receiptId: string }): ReceiptLineage {
  return {
    receiptId: over.receiptId,
    txHash: over.txHash ?? `0xhash-${over.receiptId}`,
    chain: over.chain ?? "flare",
    toAddress: over.toAddress ?? "0xMine",
    fromAddress: "fromAddress" in over ? (over.fromAddress ?? null) : "0xParent",
    receivedAtMs: "receivedAtMs" in over ? (over.receivedAtMs ?? null) : Date.UTC(2024, 5, 15),
    amountDecimal: "amountDecimal" in over ? (over.amountDecimal ?? null) : "10",
    basisSource: over.basisSource ?? "exchange_origin",
    originAddress: "originAddress" in over ? (over.originAddress ?? null) : "0xExchangeHotWalletAddress1234",
    needsPricing: over.needsPricing ?? true,
    needsOwnershipConfirmation: over.needsOwnershipConfirmation ?? false,
    note: over.note ?? "Traced to an exchange.",
  };
}

export function __runCryptoReconstructionReportCoreTests(): void {
  // --- labels ---
  truthy(basisSourceLabel("exchange_origin").length > 0, "exchange label non-empty");
  eq(basisSourceTag("owner_provided"), "Owner-provided", "owner tag");
  eq(basisSourceTag("on_chain_reconstructed"), "Self-transfer carryover", "self-transfer tag");
  eq(basisSourceTag("unknown"), "Unresolved", "unknown tag");

  const symbols = new Map<string, string>([
    ["e1", "XRP"],
    ["u1", "FLR"],
    ["s1", "SGB"],
    ["x1", "COREUM"],
  ]);

  // e1: exchange origin, priced (reconstructed FMV) -> resolved, not attention.
  const priced: ReconstructedBasisRow[] = [
    {
      receiptId: "e1",
      assetId: "aXRP",
      coinId: "ripple",
      priceDate: "2024-06-15",
      priceScaledCents: "50000000",
      source: "reconstructed:coingecko:ripple:history:15-06-2024",
      usd: "0.50",
    },
  ];
  // u1: exchange origin, NOT priced -> needs attention.
  const unpriced: UnpricedNeed[] = [
    {
      receiptId: "u1",
      assetId: "aFLR",
      coinId: "flare-networks",
      dateDDMMYYYY: "15-06-2024",
      reason: "no historical price found for this coin on this date",
    },
  ];

  const report = buildReconstructionReport({
    lineages: [
      lineage({ receiptId: "e1", basisSource: "exchange_origin", needsPricing: true }),
      lineage({ receiptId: "u1", basisSource: "exchange_origin", needsPricing: true }),
      // s1: self-transfer carryover -> resolved, no pricing needed.
      lineage({ receiptId: "s1", basisSource: "on_chain_reconstructed", needsPricing: false, originAddress: "0xMyOtherWallet0001" }),
      // x1: unknown origin, needs ownership confirmation -> attention.
      lineage({ receiptId: "x1", basisSource: "unknown", needsPricing: false, needsOwnershipConfirmation: true, originAddress: "0xStrangerWallet9999" }),
    ],
    symbolByReceiptId: symbols,
    priced,
    unpriced,
    unconfirmedWalletAddresses: ["0xStrangerWallet9999"],
  });

  eq(report.rows.length, 4, "four workpaper rows");
  eq(report.resolvedCount, 3, "three resolved to an origin (e1, u1, s1)");
  eq(report.needsAttentionCount, 2, "two need attention (u1 unpriced, x1 unknown)");
  eq(report.reconstructedPriceCount, 1, "one reconstructed price");
  eq(report.unpricedCount, 1, "one unpriced");
  eq(report.unconfirmedWalletCount, 1, "one unconfirmed wallet");

  const e1 = report.rows.find((r) => r.assetSymbol === "XRP");
  truthy(!!e1, "e1 row present");
  eq(e1?.needsAttention, false, "priced exchange lot is OK");
  eq(e1?.priceSource, "reconstructed:coingecko:ripple:history:15-06-2024", "e1 shows reconstructed source");
  eq(e1?.receivedDisplay, "2024-06-15", "e1 received date");
  truthy((e1?.originDisplay ?? "").includes("…"), "e1 origin masked");

  const u1 = report.rows.find((r) => r.assetSymbol === "FLR");
  eq(u1?.needsAttention, true, "unpriced exchange lot needs attention");
  truthy((u1?.priceSource ?? "").startsWith("Needs a price"), "u1 flags needs a price");

  const s1 = report.rows.find((r) => r.assetSymbol === "SGB");
  eq(s1?.needsAttention, false, "self-transfer carryover is OK");
  truthy((s1?.priceSource ?? "").includes("carried"), "s1 explains carryover");

  const x1 = report.rows.find((r) => r.assetSymbol === "COREUM");
  eq(x1?.needsAttention, true, "unknown-origin lot needs attention");

  // Assumptions register: 1 reconstructed + 1 unpriced + 1 unconfirmed = 3.
  eq(report.assumptions.length, 3, "three assumptions logged");
  truthy(report.assumptions.some((a) => a.kind === "Reconstructed price"), "reconstructed price logged");
  truthy(report.assumptions.some((a) => a.kind === "Price still needed"), "unpriced logged");
  truthy(report.assumptions.some((a) => a.kind === "Unconfirmed wallet"), "unconfirmed wallet logged");

  // HTML: contains both sections + the attention flag; escapes safely.
  const html = buildReconstructionHtml(report);
  truthy(html.includes("reconstruction workpaper"), "html has workpaper heading");
  truthy(html.includes("Assumptions register"), "html has register heading");
  truthy(html.includes("NEEDS ATTENTION"), "html flags attention rows");
  // never leaks a raw dollar the report didn't receive; the only $ come from inputs.

  // Empty report -> empty HTML (no clutter on a clean year).
  const emptyReport = buildReconstructionReport({
    lineages: [],
    symbolByReceiptId: new Map<string, string>(),
    priced: [],
    unpriced: [],
    unconfirmedWalletAddresses: [],
  });
  eq(buildReconstructionHtml(emptyReport), "", "empty report renders no HTML");

  // XSS-safety: a hostile symbol/note is escaped in the output.
  const evil = buildReconstructionReport({
    lineages: [lineage({ receiptId: "h1", note: "<script>alert(1)</script>" })],
    symbolByReceiptId: new Map<string, string>([["h1", "<b>X</b>"]]),
    priced: [],
    unpriced: [],
    unconfirmedWalletAddresses: [],
  });
  const evilHtml = buildReconstructionHtml(evil);
  eq(evilHtml.includes("<script>"), false, "script tag escaped in html");
  truthy(evilHtml.includes("&lt;b&gt;X&lt;/b&gt;"), "hostile symbol escaped");

  console.log("crypto-reconstruction-report-core self-tests: all passed");
}
