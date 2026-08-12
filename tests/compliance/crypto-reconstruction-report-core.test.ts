import { describe, it, expect } from "vitest";
import {
  __runCryptoReconstructionReportCoreTests,
  buildReconstructionReport,
  buildReconstructionHtml,
  basisSourceTag,
} from "../../src/lib/crypto/crypto-reconstruction-report-core";
import type { ReceiptLineage } from "../../src/lib/crypto/crypto-origin-trace-core";
import type {
  ReconstructedBasisRow,
  UnpricedNeed,
} from "../../src/lib/crypto/crypto-historical-pricing-core";

/**
 * R1-G5 — the pure reconstruction workpaper + assumptions register. Turns the
 * back-trace output into an audit-defensible paper trail: per-lot evidence (tx
 * hash, receive date, traced origin, basis method, price source) plus a list of
 * every documented, conservative assumption. Unpriced / unconfirmed items are
 * FLAGGED, never hidden, and it never prints a dollar it didn't receive.
 */

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

describe("crypto-reconstruction-report-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runCryptoReconstructionReportCoreTests()).not.toThrow();
  });

  it("labels the four basis sources", () => {
    expect(basisSourceTag("exchange_origin")).toContain("Exchange");
    expect(basisSourceTag("owner_provided")).toBe("Owner-provided");
    expect(basisSourceTag("on_chain_reconstructed")).toBe("Self-transfer carryover");
    expect(basisSourceTag("unknown")).toBe("Unresolved");
  });

  it("marks a priced exchange lot OK and an unpriced one as needs-attention", () => {
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
    const unpriced: UnpricedNeed[] = [
      {
        receiptId: "u1",
        assetId: "aFLR",
        coinId: "flare-networks",
        dateDDMMYYYY: "15-06-2024",
        reason: "no historical price found",
      },
    ];
    const report = buildReconstructionReport({
      lineages: [
        lineage({ receiptId: "e1" }),
        lineage({ receiptId: "u1" }),
      ],
      symbolByReceiptId: new Map([
        ["e1", "XRP"],
        ["u1", "FLR"],
      ]),
      priced,
      unpriced,
      unconfirmedWalletAddresses: [],
    });
    const e1 = report.rows.find((r) => r.assetSymbol === "XRP");
    const u1 = report.rows.find((r) => r.assetSymbol === "FLR");
    expect(e1?.needsAttention).toBe(false);
    expect(u1?.needsAttention).toBe(true);
    expect(report.reconstructedPriceCount).toBe(1);
    expect(report.unpricedCount).toBe(1);
  });

  it("logs assumptions and flags them in the HTML", () => {
    const report = buildReconstructionReport({
      lineages: [lineage({ receiptId: "u1", needsPricing: true })],
      symbolByReceiptId: new Map([["u1", "FLR"]]),
      priced: [],
      unpriced: [
        { receiptId: "u1", assetId: "aFLR", coinId: "flare-networks", dateDDMMYYYY: "", reason: "no price" },
      ],
      unconfirmedWalletAddresses: ["0xStrangerWalletLongEnough9999"],
    });
    expect(report.assumptions.some((a) => a.kind === "Price still needed")).toBe(true);
    expect(report.assumptions.some((a) => a.kind === "Unconfirmed wallet")).toBe(true);
    const html = buildReconstructionHtml(report);
    expect(html).toContain("NEEDS ATTENTION");
    expect(html).toContain("Assumptions register");
  });

  it("renders nothing for an empty report", () => {
    const empty = buildReconstructionReport({
      lineages: [],
      symbolByReceiptId: new Map(),
      priced: [],
      unpriced: [],
      unconfirmedWalletAddresses: [],
    });
    expect(buildReconstructionHtml(empty)).toBe("");
  });

  it("escapes hostile input in the HTML", () => {
    const report = buildReconstructionReport({
      lineages: [lineage({ receiptId: "h1", note: "<script>x</script>" })],
      symbolByReceiptId: new Map([["h1", "<b>X</b>"]]),
      priced: [],
      unpriced: [],
      unconfirmedWalletAddresses: [],
    });
    const html = buildReconstructionHtml(report);
    expect(html.includes("<script>")).toBe(false);
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
