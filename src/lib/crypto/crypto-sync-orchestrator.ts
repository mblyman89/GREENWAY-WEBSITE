import "server-only";

/**
 * src/lib/crypto/crypto-sync-orchestrator.ts — the SERVER-ONLY top-level crypto
 * sync driver (Slice C6c). It is the bridge between the UI ("Sync now" button /
 * auto-sync-on-connect) and the per-chain sync drivers that already exist:
 *
 *   • XRPL wallets (xrp, sologenic, usdt-on-xrpl) → syncXrplWallet (C5)
 *   • EVM wallets (ethereum, flare, songbird)    → syncEvmWallet (C6b)
 *   • Cosmos wallets (coreum, pulsara)            → syncCoreumWallet (C8b)
 *
 * It mirrors Plaid's `runAllPlaidSync` exactly: list every active wallet,
 * dispatch each to the right driver, aggregate the per-wallet results into a
 * single plain-English summary, and NEVER throw — one bad wallet can't break
 * the page or a scheduled run. Each driver already persists its own resume
 * cursor and error state, so a partial failure still saves whatever synced.
 *
 * SECURITY: watch-only. We use ONLY public wallet addresses. No keys exist in
 * this system. USD value is never written here (priced in a later slice C9).
 */

import { isEvmChain, isCosmosChain, type Chain } from "./crypto-core";
import { listCryptoWallets, type CryptoWalletRecord } from "./crypto-store";
import { syncXrplWallet, type XrplWalletSyncResult } from "./xrpl/xrpl-sync-server";
import { syncEvmWallet, type EvmWalletSyncResult } from "./evm/evm-sync-server";
import { syncCoreumWallet, type CoreumWalletSyncResult } from "./coreum/coreum-sync-server";

/** The result of syncing a single wallet. Chain-agnostic wrapper. */
export type WalletSyncResult = {
  walletId: string;
  chain: Chain;
  address: string;
  label: string | null;
  ok: boolean;
  message: string;
  balancesUpserted: number;
  transactionsUpserted: number;
  error: string | null;
};

/** The aggregate result of syncing all wallets (mirrors Plaid's AllSyncResult). */
export type AllCryptoSyncResult = {
  ok: boolean;
  message: string;
  wallets: WalletSyncResult[];
};

/** Human-readable chain label for the summary message. */
function chainLabel(chain: Chain): string {
  switch (chain) {
    case "ethereum":
      return "Ethereum";
    case "flare":
      return "Flare";
    case "songbird":
      return "Songbird";
    case "xrpl":
      return "XRPL";
    case "coreum":
      return "Coreum";
    default:
      return String(chain);
  }
}

/**
 * Dispatch a single wallet to the right per-chain sync driver. Returns a
 * chain-agnostic WalletSyncResult. Never throws — any exception is caught and
 * turned into a failed result so one wallet can't break the whole run.
 *
 * Coreum (Cosmos) sync is wired via syncCoreumWallet (C8b) — balances +
 * full transaction history (two-query sender + recipient, deduplicated) +
 * DeFi classification (Pulsara DAX swaps / LP activity).
 */
async function syncOneWallet(wallet: CryptoWalletRecord): Promise<WalletSyncResult> {
  const base = {
    walletId: wallet.id,
    chain: wallet.chain,
    address: wallet.address,
    label: wallet.label,
  };

  // ── Cosmos (Coreum / Pulsara) — C8b driver ──────────────────────────────
  if (isCosmosChain(wallet.chain)) {
    try {
      const res: CoreumWalletSyncResult = await syncCoreumWallet(wallet.id);
      return {
        ...base,
        ok: res.ok,
        message: res.message,
        balancesUpserted: res.counts.balancesUpserted,
        transactionsUpserted: res.counts.transactionsUpserted,
        error: res.error ?? null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        message: `Unexpected error syncing ${chainLabel(wallet.chain)} wallet: ${msg}`,
        balancesUpserted: 0,
        transactionsUpserted: 0,
        error: msg,
      };
    }
  }

  // ── EVM chains (Ethereum, Flare, Songbird) — C6b driver ────────────────────
  if (isEvmChain(wallet.chain)) {
    try {
      const res: EvmWalletSyncResult = await syncEvmWallet(wallet.id);
      return {
        ...base,
        ok: res.ok,
        message: res.message,
        balancesUpserted: res.counts.balancesUpserted,
        transactionsUpserted: res.counts.transactionsUpserted,
        error: res.error ?? null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        message: `Unexpected error syncing ${chainLabel(wallet.chain)} wallet: ${msg}`,
        balancesUpserted: 0,
        transactionsUpserted: 0,
        error: msg,
      };
    }
  }

  // ── XRPL (XRP, Sologenic, USDT-on-XRPL) — C5 driver ────────────────────────
  if (wallet.chain === "xrpl") {
    try {
      const res: XrplWalletSyncResult = await syncXrplWallet(wallet.id);
      return {
        ...base,
        ok: res.ok,
        message: res.message,
        balancesUpserted: res.counts.balancesUpserted,
        transactionsUpserted: res.counts.transactionsUpserted,
        error: res.error ?? null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        message: `Unexpected error syncing XRPL wallet: ${msg}`,
        balancesUpserted: 0,
        transactionsUpserted: 0,
        error: msg,
      };
    }
  }

  // ── Unknown chain — defensive, should never happen ─────────────────────────
  return {
    ...base,
    ok: false,
    message: `Unknown chain "${wallet.chain}" — no sync driver available.`,
    balancesUpserted: 0,
    transactionsUpserted: 0,
    error: `unknown chain: ${wallet.chain}`,
  };
}

/**
 * Sync ALL active crypto wallets. Mirrors Plaid's `runAllPlaidSync`:
 *   1. List every active wallet from the store.
 *   2. Dispatch each to its per-chain driver (XRPL / EVM / Cosmos).
 *   3. Aggregate into a single plain-English summary.
 *   4. Never throw — returns a friendly result even if the DB isn't configured.
 *
 * This is what the "Sync now" button and the auto-sync-on-connect both call.
 */
export async function runAllCryptoSync(): Promise<AllCryptoSyncResult> {
  let wallets: CryptoWalletRecord[];
  try {
    wallets = await listCryptoWallets();
  } catch {
    // DB not configured or table missing — graceful, mirrors Plaid posture.
    return {
      ok: false,
      message: "Crypto database isn't configured yet.",
      wallets: [],
    };
  }

  if (wallets.length === 0) {
    return {
      ok: true,
      message: "No crypto wallets to sync yet.",
      wallets: [],
    };
  }

  // Only sync ACTIVE wallets (inactive = paused by the owner).
  const active = wallets.filter((w) => w.active);
  if (active.length === 0) {
    return {
      ok: true,
      message: "All wallets are paused.",
      wallets: [],
    };
  }

  const results: WalletSyncResult[] = [];
  for (const wallet of active) {
    results.push(await syncOneWallet(wallet));
  }

  // R3 \u2014 once all wallets are synced (so balances exist), price them in USD.
  // Graceful: a pricing failure NEVER fails the sync; the portfolio simply
  // shows unpriced holdings. Imported lazily to keep the pricing surface out of
  // callers that only sync. USD value is written here (and only here) via the
  // float-free BigInt scaled-cents path.
  let pricingMessage = "";
  try {
    const { runCryptoPricing } = await import("./crypto-pricing-server");
    const pricing = await runCryptoPricing();
    if (pricing.pricedAssets > 0) {
      pricingMessage = ` Priced ${pricing.pricedAssets} holding${pricing.pricedAssets === 1 ? "" : "s"} in USD.`;
    }
  } catch {
    // Never let pricing break a sync.
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  // Build a human-friendly summary that tells Michael exactly what happened.
  const totalBal = results.reduce((sum, r) => sum + r.balancesUpserted, 0);
  const totalTxn = results.reduce((sum, r) => sum + r.transactionsUpserted, 0);

  let message: string;
  if (failCount === 0) {
    const parts: string[] = [`Synced ${okCount} wallet${okCount === 1 ? "" : "s"}`];
    if (totalBal > 0 || totalTxn > 0) {
      parts.push(`${totalBal} balance${totalBal === 1 ? "" : "s"}`, `${totalTxn} transaction${totalTxn === 1 ? "" : "s"}`);
    }
    message = parts.join(", ") + "." + pricingMessage;
  } else {
    message = `Synced ${okCount} of ${results.length} wallets; ${failCount} need attention (see Health).` + pricingMessage;
  }

  return {
    ok: failCount === 0,
    message,
    wallets: results,
  };
}

/**
 * Sync a SINGLE wallet by its ID. Used by the auto-sync-on-connect flow: when
 * Michael adds a wallet we immediately kick off its first backfill so he sees
 * data sooner rather than waiting for the next manual "Sync now".
 *
 * Returns the same chain-agnostic WalletSyncResult. Never throws.
 */
export async function syncOneCryptoWallet(walletId: string): Promise<WalletSyncResult | null> {
  let wallet: CryptoWalletRecord | null;
  try {
    // We need the wallet record to know its chain. Import lazily to avoid
    // pulling the full store surface into every caller's tree.
    const { getCryptoWallet } = await import("./crypto-store");
    wallet = await getCryptoWallet(walletId);
  } catch {
    return null;
  }
  if (!wallet) return null;
  if (!wallet.active) {
    return {
      walletId: wallet.id,
      chain: wallet.chain,
      address: wallet.address,
      label: wallet.label,
      ok: true,
      message: "Wallet is paused.",
      balancesUpserted: 0,
      transactionsUpserted: 0,
      error: null,
    };
  }
  return syncOneWallet(wallet);
}
