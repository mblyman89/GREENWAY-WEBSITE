/**
 * src/lib/crypto/crypto-tax-center-data.ts — server-side Tax Center assembler.
 *
 * Bridges the DB (wallets, transactions, classifications, assets) to the PURE
 * tax engines and produces (a) the on-screen TaxCenterView and (b) the per-year
 * BinderYear inputs for the printable Audit Binder. All tax math is done by the
 * pure cores; this file is only data-gathering + wiring. Graceful when the DB
 * is not configured (returns empty), like the rest of the crypto surface.
 */
import "server-only";

import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  listCryptoWallets,
  listCryptoTransactions,
  listCryptoAssets,
} from "./crypto-store";
import { listCryptoClassifications } from "./crypto-classification-store";
import { getAsset } from "./crypto-core";
import { getTagDefinition } from "./crypto-classification-core";
import {
  buildTaxLedger,
  type TaxLedgerTxInput,
} from "./crypto-tax-ledger-builder-core";
import {
  computeCostBasisLedger,
  scaledToQuantity,
  type AcquisitionLot,
  type DisposalEvent,
} from "./crypto-cost-basis-core";
import {
  buildForm8949Report,
  type Form8949DisposalInput,
} from "./crypto-form8949-core";
import { buildIncomeReport, incomeYear } from "./crypto-income-report-core";
import { runMethodSandbox } from "./crypto-method-sandbox-core";
import { evaluateFileReadiness } from "./crypto-file-readiness-core";
import {
  buildTaxCenterView,
  formatWholeDollars,
  type TaxCenterView,
  type TaxCenterYearInput,
  type BinderYear,
  type BinderDisposal,
  type BinderIncome,
  type BinderLot,
} from "./crypto-tax-center-core";

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).getUTCFullYear();
}

interface AssembledYear {
  taxYearInput: TaxCenterYearInput;
  binder: BinderYear;
}

/** Assemble everything the Tax Center + Audit Binder need. */
async function assembleYears(): Promise<AssembledYear[]> {
  if (!isSupabaseServiceConfigured) return [];

  const [wallets, assets] = await Promise.all([listCryptoWallets(), listCryptoAssets()]);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const [txLists, classifications] = await Promise.all([
    Promise.all(wallets.map((w) => listCryptoTransactions(w.id))),
    listCryptoClassifications(),
  ]);
  const tagByTx = new Map<string, string>();
  for (const c of classifications) tagByTx.set(c.transactionId, c.tagKey);

  // Group transactions into engine inputs per (wallet, asset), tracking the
  // acquisition/disposal/income split and the readiness feed counts by YEAR.
  const acqByWalletAsset = new Map<string, AcquisitionLot[]>();
  const dispByWalletAsset = new Map<string, DisposalEvent[]>();
  const symbolByKey = new Map<string, string>();
  const acquisitionSource = new Map<string, string>();

  const incomeInputs: Array<{
    id: string;
    tag: string;
    assetSymbol: string;
    fmvCents: number;
    receivedAtMs: number;
    isBusiness?: boolean;
  }> = [];

  // Per-year readiness counters.
  const unpricedDisposalByYear = new Map<number, number>();
  const missingBasisByYear = new Map<number, number>();
  const unclassifiedByYear = new Map<number, number>();

  for (let wi = 0; wi < wallets.length; wi += 1) {
    const wallet = wallets[wi];
    const list = txLists[wi];

    // Bucket this wallet's transactions by asset for the builder.
    const byAsset = new Map<string, TaxLedgerTxInput[]>();
    for (const t of list) {
      const asset = t.assetId ? assetById.get(t.assetId) ?? getAsset(t.assetId) : null;
      const symbol = asset?.symbol ?? "?";
      const key = `${wallet.id}::${t.assetId ?? "unknown"}`;
      symbolByKey.set(key, symbol);
      const arr = byAsset.get(key) ?? [];
      arr.push({
        id: t.id,
        tagKey: tagByTx.get(t.id) ?? null,
        direction: (t.direction ?? null) as TaxLedgerTxInput["direction"],
        isSwap: t.txType === "swap",
        amountDecimal: t.amountDecimal,
        usdValueCents: t.usdValueCents,
        blockTimeIso: t.blockTime,
        assetSymbol: symbol,
      });
      byAsset.set(key, arr);
    }

    for (const [key, txs] of byAsset) {
      const built = buildTaxLedger({ transactions: txs });
      acqByWalletAsset.set(key, built.acquisitions);
      dispByWalletAsset.set(key, built.disposals);
      for (const a of built.acquisitions) acquisitionSource.set(a.id, key);
      for (const ev of built.incomeEvents) {
        incomeInputs.push(ev);
        const yr = new Date(ev.receivedAtMs).getUTCFullYear();
        // (income has FMV by construction; nothing to add to readiness here)
        void yr;
      }
      // Attribute readiness counts to the year of each offending tx.
      for (const t of txs) {
        const yr = yearOf(t.blockTimeIso);
        if (yr === null) continue;
        const tag = t.tagKey && getTagDefinition(t.tagKey) ? t.tagKey : null;
        const def = tag ? getTagDefinition(tag) : null;
        if (!def) {
          // unclassified taxable-looking = out/withdrawal or swap with quantity
          if (t.usdValueCents !== null || t.direction === "out") {
            unclassifiedByYear.set(yr, (unclassifiedByYear.get(yr) ?? 0) + 1);
          }
          continue;
        }
        if (def.isDisposal && t.usdValueCents === null) {
          unpricedDisposalByYear.set(yr, (unpricedDisposalByYear.get(yr) ?? 0) + 1);
        }
        if ((def.isAcquisition || def.createsIncome) && t.usdValueCents === null) {
          missingBasisByYear.set(yr, (missingBasisByYear.get(yr) ?? 0) + 1);
        }
      }
    }
  }

  // Run the cost-basis ledger per (wallet, asset), then tag each disposal with
  // its tax year (by disposedAt) and stash the priced 8949 disposal inputs.
  const disposalInputsByYear = new Map<number, Form8949DisposalInput[]>();
  const binderDisposalsByYear = new Map<number, BinderDisposal[]>();
  const binderLotsByYear = new Map<number, BinderLot[]>();
  const missingBasisLedgerByYear = new Map<number, number>();

  for (const [key, acquisitions] of acqByWalletAsset) {
    const disposals = dispByWalletAsset.get(key) ?? [];
    const symbol = symbolByKey.get(key) ?? "?";
    if (disposals.length === 0 && acquisitions.length === 0) continue;

    const ledger = computeCostBasisLedger({ method: "fifo", acquisitions, disposals });

    // Binder: remaining + consumed lots (as acquisition lots) for the year they
    // were acquired.
    for (const a of acquisitions) {
      const yr = new Date(a.acquiredAtMs).getUTCFullYear();
      const arr = binderLotsByYear.get(yr) ?? [];
      arr.push({
        assetSymbol: symbol,
        quantityDisplay: scaledToQuantity(a.quantityScaled),
        acquiredDate: new Date(a.acquiredAtMs).toISOString().slice(0, 10),
        basisDisplay: formatWholeDollars(a.basisCents),
        source: acquisitionSource.get(a.id) === key ? "on-chain (classified)" : "on-chain",
      });
      binderLotsByYear.set(yr, arr);
    }

    for (const dr of ledger.disposals) {
      const disp = disposals.find((d) => d.id === dr.disposalId);
      const yr = disp ? new Date(disp.disposedAtMs).getUTCFullYear() : null;
      if (yr === null) continue;
      const qtyDisplay = scaledToQuantity(dr.matchedQuantityScaled + dr.missingBasisQuantityScaled);

      const arr = disposalInputsByYear.get(yr) ?? [];
      arr.push({ assetSymbol: symbol, quantityDisplay: qtyDisplay, disposal: dr });
      disposalInputsByYear.set(yr, arr);

      if (dr.hasMissingBasis) {
        missingBasisLedgerByYear.set(yr, (missingBasisLedgerByYear.get(yr) ?? 0) + 1);
      }

      // Binder disposal rows (one per holding period is built by the 8949
      // engine; for the binder we show the disposal-level summary).
      const shortC = dr.consumptions.filter((c) => c.holdingPeriod === "short");
      const longC = dr.consumptions.filter((c) => c.holdingPeriod === "long");
      const bArr = binderDisposalsByYear.get(yr) ?? [];
      const push = (box: string, cons: typeof dr.consumptions) => {
        if (cons.length === 0 && !dr.hasMissingBasis) return;
        const proceeds = cons.reduce((s, c) => s + c.proceedsCents, 0);
        const basis = cons.reduce((s, c) => s + c.basisCents, 0);
        const gain = cons.reduce((s, c) => s + c.gainCents, 0);
        const dates = Array.from(new Set(cons.map((c) => new Date(c.acquiredAtMs).toISOString().slice(0, 10))));
        bArr.push({
          assetSymbol: symbol,
          quantityDisplay: qtyDisplay,
          box,
          dateAcquired: dates.length > 1 ? "VARIOUS" : (dates[0] ?? ""),
          dateSold: disp ? new Date(disp.disposedAtMs).toISOString().slice(0, 10) : "",
          proceedsDisplay: formatWholeDollars(proceeds),
          basisDisplay: formatWholeDollars(basis),
          gainLossDisplay: formatWholeDollars(gain),
          consumedLots: cons.map((c) => c.lotId).join(", "),
          hasMissingBasis: dr.hasMissingBasis && cons.length === 0,
        });
      };
      if (shortC.length > 0) push("I", shortC);
      if (longC.length > 0) push("L", longC);
      if (shortC.length === 0 && longC.length === 0 && dr.hasMissingBasis) push("I", []);
      binderDisposalsByYear.set(yr, bArr);
    }
  }

  // Income report across all years.
  const incomeReport = buildIncomeReport({ events: incomeInputs });

  // Union of every year that appears anywhere.
  const allYears = new Set<number>();
  for (const y of disposalInputsByYear.keys()) allYears.add(y);
  for (const y of incomeReport.years.map((r) => r.taxYear)) allYears.add(y);
  for (const y of unpricedDisposalByYear.keys()) allYears.add(y);
  for (const y of missingBasisByYear.keys()) allYears.add(y);
  for (const y of unclassifiedByYear.keys()) allYears.add(y);
  for (const y of binderLotsByYear.keys()) allYears.add(y);

  const assembled: AssembledYear[] = [];
  for (const yr of Array.from(allYears).sort((a, b) => a - b)) {
    const disposalInputs = disposalInputsByYear.get(yr) ?? [];
    const form8949 = buildForm8949Report({ disposals: disposalInputs, filingStatus: "single" });
    const income = incomeYear(incomeReport, yr);

    // Method sandbox: run over this year's disposals against ALL acquisitions
    // available (a planning preview). We reuse the flattened lots/disposals.
    const yearAcqs: AcquisitionLot[] = [];
    const yearDisps: DisposalEvent[] = [];
    for (const [key, acquisitions] of acqByWalletAsset) {
      for (const a of acquisitions) yearAcqs.push(a);
      const ds = dispByWalletAsset.get(key) ?? [];
      for (const d of ds) {
        if (new Date(d.disposedAtMs).getUTCFullYear() === yr) yearDisps.push(d);
      }
    }
    const sandbox = runMethodSandbox({ acquisitions: yearAcqs, disposals: yearDisps });

    const missingBasisCount =
      (missingBasisByYear.get(yr) ?? 0) + (missingBasisLedgerByYear.get(yr) ?? 0);

    const readiness = evaluateFileReadiness({
      taxYear: yr,
      missingBasisCount,
      unclassifiedCount: unclassifiedByYear.get(yr) ?? 0,
      unmatchedTransferCount: 0,
      negativeBalanceCount: 0,
      unpricedDisposalCount: unpricedDisposalByYear.get(yr) ?? 0,
      method: "fifo",
    });

    const binderIncome: BinderIncome[] = income
      ? [
          ...income.schedule1.byTag.map((t) => ({
            assetSymbol: "",
            tagLabel: getTagDefinition(t.tag)?.label ?? t.tag,
            fmvDisplay: formatWholeDollars(t.amountCents),
            receivedDate: String(yr),
            schedule: "Schedule 1",
          })),
          ...income.scheduleC.byTag.map((t) => ({
            assetSymbol: "",
            tagLabel: getTagDefinition(t.tag)?.label ?? t.tag,
            fmvDisplay: formatWholeDollars(t.amountCents),
            receivedDate: String(yr),
            schedule: "Schedule C",
          })),
        ]
      : [];

    const taxYearInput: TaxCenterYearInput = { taxYear: yr, form8949, income, readiness, sandbox };

    const binder: BinderYear = {
      taxYear: yr,
      method: "fifo",
      fileReady: readiness.fileReady,
      netCapitalGainDisplay: formatWholeDollars(form8949.scheduleD.netCapitalGainCents),
      totalIncomeDisplay: formatWholeDollars(income ? income.totalIncomeCents : 0),
      lots: binderLotsByYear.get(yr) ?? [],
      disposals: binderDisposalsByYear.get(yr) ?? [],
      income: binderIncome,
      transfers: [],
      priceSources: [],
      acknowledgments: [],
      issues: readiness.issues,
    };

    assembled.push({ taxYearInput, binder });
  }

  return assembled;
}

/** The on-screen Tax Center view-model. */
export async function getTaxCenterView(): Promise<TaxCenterView> {
  const years = await assembleYears();
  return buildTaxCenterView({ years: years.map((a) => a.taxYearInput) });
}

/** The per-year binder inputs (optionally filtered to one year). */
export async function getAuditBinderYears(onlyYear?: number): Promise<BinderYear[]> {
  const years = await assembleYears();
  const binders = years.map((a) => a.binder);
  if (onlyYear === undefined) return binders;
  return binders.filter((b) => b.taxYear === onlyYear);
}
