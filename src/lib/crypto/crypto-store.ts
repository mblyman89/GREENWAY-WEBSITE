import "server-only";

/**
 * src/lib/crypto/crypto-store.ts — Crypto portfolio read layer (Slice C2, server-only).
 *
 * READ-ONLY accessors over the crypto_* tables from migration 0160:
 *   crypto_assets / crypto_wallets / crypto_balances / crypto_transactions /
 *   crypto_asset_migrations / crypto_sync_state / crypto_price_snapshots.
 *
 * The PURE shape logic (record types, DB row shapes, column selectors, coercion
 * helpers, row→record mappers, self-test) lives in ./crypto-store-core so the
 * pure self-test battery (which runs under tsx, where `server-only` throws) can
 * exercise the mappers. This module adds only the async Supabase readers and
 * re-exports the public types/limits so callers import from one place.
 *
 * Mirrors the enterprise patterns proven in src/lib/plaid/store.ts:
 *   - `import "server-only"` — never ships to the browser,
 *   - isSupabaseServiceConfigured guard → graceful "not configured" (empty
 *     reads return [] / null) so every page renders BEFORE the DB is wired,
 *   - createSupabaseAdminClient() for service-role reads,
 *   - try/catch around every query returning [] / null on ANY error (a missing
 *     table is treated as "not configured", never a crash).
 *
 * C2 is the read foundation ONLY: NO network calls, NO UI. Writes (wallet
 * connect, balance/tx upserts, sync-state) arrive in later slices (C4–C11).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  ASSET_COLS,
  WALLET_COLS,
  BALANCE_COLS,
  TRANSACTION_COLS,
  MIGRATION_COLS,
  SYNC_STATE_COLS,
  PRICE_SNAPSHOT_COLS,
  CRYPTO_TXN_READ_LIMIT,
  CRYPTO_PRICE_READ_LIMIT,
  clampLimit,
  cleanId,
  toCryptoAssetRecord,
  toCryptoWalletRecord,
  toCryptoBalanceRecord,
  toCryptoTransactionRecord,
  toCryptoAssetMigrationRecord,
  toCryptoSyncStateRecord,
  toCryptoPriceSnapshotRecord,
} from "./crypto-store-core";
import type {
  AssetRow,
  WalletRow,
  BalanceRow,
  TransactionRow,
  MigrationRow,
  SyncStateRow,
  PriceSnapshotRow,
  CryptoAssetRecord,
  CryptoWalletRecord,
  CryptoBalanceRecord,
  CryptoTransactionRecord,
  CryptoAssetMigrationRecord,
  CryptoSyncStateRecord,
  CryptoPriceSnapshotRecord,
} from "./crypto-store-core";

// Re-export the public shape contract so callers import from crypto-store.
export type {
  DecimalsSource,
  CryptoAssetRecord,
  CryptoWalletRecord,
  CryptoBalanceRecord,
  CryptoTransactionRecord,
  CryptoAssetMigrationRecord,
  CryptoSyncStateRecord,
  CryptoPriceSnapshotRecord,
} from "./crypto-store-core";
export { CRYPTO_TXN_READ_LIMIT, CRYPTO_PRICE_READ_LIMIT } from "./crypto-store-core";

// ---------------------------------------------------------------------------
// Read accessors (server-only). Every one is graceful: [] / null when the DB
// isn't configured OR on any error, so pages render an empty state, never crash.
// ---------------------------------------------------------------------------

/** All tracked assets (the seeded catalog + any added later), stable by id. */
export async function listCryptoAssets(): Promise<CryptoAssetRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_assets")
      .select(ASSET_COLS)
      .order("id", { ascending: true });
    if (error || !data) return [];
    return (data as unknown as AssetRow[]).map(toCryptoAssetRecord);
  } catch {
    return [];
  }
}

/** All watch-only wallets, oldest first. */
export async function listCryptoWallets(): Promise<CryptoWalletRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_wallets")
      .select(WALLET_COLS)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as unknown as WalletRow[]).map(toCryptoWalletRecord);
  } catch {
    return [];
  }
}

/** One wallet by id, or null. */
export async function getCryptoWallet(walletId: string): Promise<CryptoWalletRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  const id = cleanId(walletId);
  if (id === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_wallets")
      .select(WALLET_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return toCryptoWalletRecord(data as unknown as WalletRow);
  } catch {
    return null;
  }
}

/** Current balances for one wallet (all assets held), or all wallets if omitted. */
export async function listCryptoBalances(walletId?: string): Promise<CryptoBalanceRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    let query = admin.from("crypto_balances").select(BALANCE_COLS);
    const id = cleanId(walletId);
    if (id !== "") query = query.eq("wallet_id", id);
    const { data, error } = await query.order("asset_id", { ascending: true });
    if (error || !data) return [];
    return (data as unknown as BalanceRow[]).map(toCryptoBalanceRecord);
  } catch {
    return [];
  }
}

/** One wallet's transactions, newest first (block_time desc), capped. */
export async function listCryptoTransactions(
  walletId: string,
  limit: number = CRYPTO_TXN_READ_LIMIT,
): Promise<CryptoTransactionRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  const id = cleanId(walletId);
  if (id === "") return [];
  const cap = clampLimit(limit, CRYPTO_TXN_READ_LIMIT);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_transactions")
      .select(TRANSACTION_COLS)
      .eq("wallet_id", id)
      .order("block_time", { ascending: false, nullsFirst: false })
      .limit(cap);
    if (error || !data) return [];
    return (data as unknown as TransactionRow[]).map(toCryptoTransactionRecord);
  } catch {
    return [];
  }
}

/** All recorded token migrations (CORE→TX automatic, SOLO→TX manual, …). */
export async function listCryptoAssetMigrations(): Promise<CryptoAssetMigrationRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_asset_migrations")
      .select(MIGRATION_COLS)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as unknown as MigrationRow[]).map(toCryptoAssetMigrationRecord);
  } catch {
    return [];
  }
}

/** Backfill/incremental sync state for one wallet, or null. */
export async function getCryptoSyncState(walletId: string): Promise<CryptoSyncStateRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  const id = cleanId(walletId);
  if (id === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_sync_state")
      .select(SYNC_STATE_COLS)
      .eq("wallet_id", id)
      .maybeSingle();
    if (error || !data) return null;
    return toCryptoSyncStateRecord(data as unknown as SyncStateRow);
  } catch {
    return null;
  }
}

/** Cached USD price snapshots for one asset, newest date first, capped. */
export async function listCryptoPriceSnapshots(
  assetId: string,
  limit: number = CRYPTO_PRICE_READ_LIMIT,
): Promise<CryptoPriceSnapshotRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  const id = cleanId(assetId);
  if (id === "") return [];
  const cap = clampLimit(limit, CRYPTO_PRICE_READ_LIMIT);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_price_snapshots")
      .select(PRICE_SNAPSHOT_COLS)
      .eq("asset_id", id)
      .order("price_date", { ascending: false })
      .limit(cap);
    if (error || !data) return [];
    return (data as unknown as PriceSnapshotRow[]).map(toCryptoPriceSnapshotRecord);
  } catch {
    return [];
  }
}
