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
import { isValidAddressForChain, type Chain } from "./crypto-core";
import {
  ASSET_COLS,
  WALLET_COLS,
  BALANCE_COLS,
  TRANSACTION_COLS,
  MIGRATION_COLS,
  SYNC_STATE_COLS,
  SYNC_STATE_BASE_COLS,
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
import type {
  BalanceUpsertRow,
  TransactionUpsertRow,
  SyncStateUpsertRow,
} from "./xrpl/xrpl-sync-core";
import type { DiscoveredAssetUpsertRow } from "./evm/evm-token-discovery-core";

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

/**
 * Exact count of transaction rows captured for one wallet. Used as a progress
 * signal on the Health tab (esp. for opaque-cursor chains where no percent
 * exists). Returns null on any error/unconfigured so the UI degrades to
 * "unknown" rather than a wrong 0.
 */
export async function countCryptoTransactions(walletId: string): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return null;
  const id = cleanId(walletId);
  if (id === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("crypto_transactions")
      .select("id", { count: "exact", head: true })
      .eq("wallet_id", id);
    if (error) return null;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
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
    // Try the full column set (includes the 0161 progress columns). If that
    // migration hasn't run yet, Postgres errors on the unknown columns — we
    // then retry with the base columns so the page keeps working pre-migration.
    const full = await admin
      .from("crypto_sync_state")
      .select(SYNC_STATE_COLS)
      .eq("wallet_id", id)
      .maybeSingle();
    if (!full.error && full.data) {
      return toCryptoSyncStateRecord(full.data as unknown as SyncStateRow);
    }
    if (full.error) {
      const base = await admin
        .from("crypto_sync_state")
        .select(SYNC_STATE_BASE_COLS)
        .eq("wallet_id", id)
        .maybeSingle();
      if (base.error || !base.data) return null;
      return toCryptoSyncStateRecord(base.data as unknown as SyncStateRow);
    }
    return null;
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

// ---------------------------------------------------------------------------
// Writes (C3): connect a watch-only wallet. This is the ONLY write in the
// crypto layer so far — a public address to WATCH. It stores nothing sensitive
// (no keys) and is idempotent on (chain, lower(address)) so re-adding the same
// wallet re-labels it instead of erroring or duplicating. Balances/tx history
// are populated by the connector slices (C4+); this just registers the address.
// ---------------------------------------------------------------------------

export type AddWalletResult =
  | { ok: true; created: boolean; walletId: string }
  | { ok: false; error: string };

/**
 * Insert (or re-label) a watch-only wallet. The caller passes an ALREADY
 * validated + normalized chain/address (via parseAddWallet in crypto-ui-core),
 * but we defensively re-validate the address shape here too — the DB is the last
 * line of defense and must never store a malformed address.
 *
 * Idempotent: the `uq_crypto_wallets_chain_address` unique index means the same
 * wallet upserts to one row. We return `created` so the UI can say "added" vs.
 * "already watching (label updated)".
 */
export async function addWatchOnlyWallet(input: {
  chain: Chain;
  address: string;
  label: string | null;
}): Promise<AddWalletResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };

  const address = (input.address ?? "").trim();
  if (address === "" || !isValidAddressForChain(input.chain, address)) {
    return { ok: false, error: "That address doesn't look valid for this blockchain." };
  }

  try {
    const admin = createSupabaseAdminClient();

    // The unique index is on (chain, lower(address)) — a FUNCTIONAL index, which
    // PostgREST's on_conflict can't target by column list. So we do an explicit
    // find-then-insert-or-update, matching case-insensitively on address the same
    // way the index does. This keeps the operation idempotent without depending
    // on a plain unique constraint.
    const existing = await admin
      .from("crypto_wallets")
      .select("id")
      .eq("chain", input.chain)
      .ilike("address", address)
      .maybeSingle();

    if (!existing.error && existing.data) {
      const id = (existing.data as { id: string }).id;
      const { error: updErr } = await admin
        .from("crypto_wallets")
        .update({ label: input.label, active: true })
        .eq("id", id);
      if (updErr) return { ok: false, error: updErr.message };
      return { ok: true, created: false, walletId: id };
    }

    const { data: insData, error: insErr } = await admin
      .from("crypto_wallets")
      .insert({
        chain: input.chain,
        address,
        label: input.label,
        active: true,
      })
      .select("id")
      .single();
    if (insErr) return { ok: false, error: insErr.message };
    const newId = (insData as { id: string }).id;
    return { ok: true, created: true, walletId: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save the wallet.";
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Writes (C5): connector persistence. These take ALREADY-BUILT snake_case
// upsert rows from xrpl-sync-core (pure, unit-tested) and write them idempotently
// against the UNIQUE indexes proven in migration 0160:
//   crypto_balances       UNIQUE (wallet_id, asset_id)
//   crypto_transactions   UNIQUE (wallet_id, tx_hash, event_index)
//   crypto_sync_state     UNIQUE (wallet_id)
// Because these are plain-column composite unique indexes (not functional), we
// can target them with supabase-js `.upsert(..., { onConflict })`. Every writer
// is graceful: a missing DB (not configured) is a no-op success, and any error
// is returned (never thrown) so a connector run degrades instead of crashing.
// USD/pricing is never written here — that's a later slice; we never guess value.
// ---------------------------------------------------------------------------

export type WriteResult = { ok: true; count: number } | { ok: false; error: string };

/** Max rows per upsert request (keeps payloads and statements comfortably small). */
const CRYPTO_UPSERT_CHUNK = 500;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Upsert current balances for a wallet. Idempotent on (wallet_id, asset_id):
 * re-running replaces the amount/usd/timestamp for each held asset in place.
 * Rows are pre-built + validated by xrpl-sync-core; asset_id is guaranteed set.
 */
export async function upsertCryptoBalances(
  rows: BalanceUpsertRow[],
): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    let written = 0;
    for (const part of chunk(rows, CRYPTO_UPSERT_CHUNK)) {
      const { error } = await admin
        .from("crypto_balances")
        .upsert(part, { onConflict: "wallet_id,asset_id" });
      if (error) return { ok: false, error: error.message };
      written += part.length;
    }
    return { ok: true, count: written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Balance write failed." };
  }
}

/**
 * AREA 3 — register discovered alt-coin assets into crypto_assets so their
 * balances/history can be persisted (balances/transactions FK to this table).
 * Idempotent on `id`: re-running refreshes symbol/name/decimals in place. Every
 * row here is a fungible, decimals-VERIFIED ERC-20 (built by the discovery core
 * from a first-party decimals read) — we never register an unverified token or
 * an NFT, and we never guess decimals. `updated_at` is refreshed on conflict.
 */
export async function ensureCryptoAssets(
  rows: DiscoveredAssetUpsertRow[],
): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    let written = 0;
    for (const part of chunk(rows, CRYPTO_UPSERT_CHUNK)) {
      const { error } = await admin
        .from("crypto_assets")
        .upsert(part, { onConflict: "id" });
      if (error) return { ok: false, error: error.message };
      written += part.length;
    }
    return { ok: true, count: written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Asset registration failed." };
  }
}

/**
 * Upsert transaction events for a wallet. Idempotent on
 * (wallet_id, tx_hash, event_index): the same on-chain event is never
 * double-counted, so a resumed/repeated backfill is always safe.
 */
export async function upsertCryptoTransactions(
  rows: TransactionUpsertRow[],
): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  if (!rows || rows.length === 0) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    let written = 0;
    for (const part of chunk(rows, CRYPTO_UPSERT_CHUNK)) {
      const { error } = await admin
        .from("crypto_transactions")
        .upsert(part, { onConflict: "wallet_id,tx_hash,event_index" });
      if (error) return { ok: false, error: error.message };
      written += part.length;
    }
    return { ok: true, count: written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Transaction write failed." };
  }
}

/** Upsert the resumable sync cursor/status for a wallet (one row per wallet). */
export async function upsertCryptoSyncState(
  row: SyncStateUpsertRow,
): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("crypto_sync_state")
      .upsert(row, { onConflict: "wallet_id" });
    if (!error) return { ok: true, count: 1 };
    // If the progress columns (migration 0161) aren't present yet, retry with
    // just the base fields so a sync still records its cursor pre-migration.
    const {
      backfill_target: _t,
      prev_backfill_cursor: _p,
      transactions_total: _n,
      ...base
    } = row;
    void _t;
    void _p;
    void _n;
    const retry = await admin
      .from("crypto_sync_state")
      .upsert(base, { onConflict: "wallet_id" });
    if (retry.error) return { ok: false, error: retry.error.message };
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync-state write failed." };
  }
}
