import "server-only";

/**
 * src/lib/crypto/crypto-reconciliation-server.ts — R1-D reconciliation +
 * review-queue assembler (server-only).
 *
 * Reads the crypto_* history + balances (crypto-store) and runs the PURE
 * reconciliation logic (crypto-reconciliation-core) to produce:
 *   - a balance reconciliation table (displayed vs chain-implied),
 *   - a low-confidence transfer-match queue (cross-wallet OUT/IN pairs).
 *
 * The missing-basis queue is produced per (wallet, asset) by R1-C's ledger; it
 * is assembled where the ledger is computed (R1-F reports) since it needs
 * classified acquisitions/disposals. This module focuses on the two checks that
 * only need raw history + balances, so it stays fast and dependency-light.
 *
 * Graceful: no DB / missing tables => empty results (never throws), mirroring
 * crypto-store.ts. Read-only; nothing is written or merged here — suggestions
 * are surfaced for a human to confirm.
 */
import { listCryptoWallets, listCryptoBalances, listCryptoTransactions } from "./crypto-store";
import { formatHeldAmount } from "./crypto-ui-core";
import {
  reconcileBalances,
  suggestTransferMatches,
  type ReconTx,
  type ReconBalance,
  type TransferCandidateTx,
  type BalanceReconResult,
  type TransferMatchSuggestion,
} from "./crypto-reconciliation-core";

export interface ReconciliationOverview {
  balance: BalanceReconResult;
  transferSuggestions: TransferMatchSuggestion[];
  walletCount: number;
  txCount: number;
}

function toMsOrNull(iso: string | null): number | null {
  if (iso == null || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A normalized, non-negative decimal amount string for reconciliation, or ""
 * when the amount can't be expressed as a clean decimal (so it's treated as a
 * neutral 0 rather than guessed). Uses the verified event decimals when the row
 * only has raw minor units.
 */
function normalizedAmountDecimal(input: {
  amountRaw: string | null;
  amountDecimal: string | null;
  decimalsAtEvent: number | null;
}): string {
  const shown = formatHeldAmount({
    amountRaw: input.amountRaw,
    amountDecimal: input.amountDecimal,
    decimals: input.decimalsAtEvent,
  });
  // formatHeldAmount returns "—" for "nothing", or the raw string if it could
  // not convert (non-integer decimals). Only accept a clean unsigned decimal.
  return /^\d+(\.\d+)?$/.test(shown) ? shown : "";
}

/**
 * Assemble the reconciliation overview across all wallets. Reads every wallet's
 * balances + transactions, then reconciles and suggests transfer matches. All
 * inputs degrade to empty on any read failure, so the page always renders.
 */
export async function buildReconciliationOverview(): Promise<ReconciliationOverview> {
  const wallets = await listCryptoWallets();
  if (wallets.length === 0) {
    return {
      balance: { rows: [], mismatchCount: 0, allReconciled: true },
      transferSuggestions: [],
      walletCount: 0,
      txCount: 0,
    };
  }

  const balances = await listCryptoBalances(); // all wallets
  const reconBalances: ReconBalance[] = balances.map((b) => ({
    walletId: b.walletId,
    assetId: b.assetId,
    amountDecimal: normalizedAmountDecimal({
      amountRaw: b.amountRaw,
      amountDecimal: b.amountDecimal,
      decimalsAtEvent: b.decimalsAtRead,
    }),
  }));

  // Gather transactions across all wallets for history-based checks.
  const reconTxs: ReconTx[] = [];
  const transferCandidates: TransferCandidateTx[] = [];
  let txCount = 0;
  for (const w of wallets) {
    const txs = await listCryptoTransactions(w.id);
    txCount += txs.length;
    for (const t of txs) {
      const amount = normalizedAmountDecimal({
        amountRaw: t.amountRaw,
        amountDecimal: t.amountDecimal,
        decimalsAtEvent: t.decimalsAtEvent,
      });
      reconTxs.push({
        walletId: t.walletId,
        assetId: t.assetId,
        direction: t.direction,
        amountDecimal: amount,
      });
      transferCandidates.push({
        id: t.id,
        walletId: t.walletId,
        assetId: t.assetId,
        direction: t.direction,
        amountDecimal: amount,
        timeMs: toMsOrNull(t.blockTime),
      });
    }
  }

  const balance = reconcileBalances(reconTxs, reconBalances);
  const transferSuggestions = suggestTransferMatches(transferCandidates);

  return {
    balance,
    transferSuggestions,
    walletCount: wallets.length,
    txCount,
  };
}
