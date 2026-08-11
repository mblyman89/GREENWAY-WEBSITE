/**
 * src/lib/crypto/crypto-store-core.ts — PURE store shape layer (Slice C2).
 *
 * This module holds everything about the crypto_* read layer that is PURE
 * (no `server-only`, no Supabase, no network): the camelCase record types, the
 * snake_case DB row shapes, the column selectors, the coercion helpers, and the
 * row→record mappers. crypto-store.ts (server-only) imports + re-exports from
 * here and adds the async Supabase readers.
 *
 * Why split it out: the pure self-test battery runs under `tsx`, where importing
 * a `server-only` module throws. Keeping the shape logic here lets the self-test
 * exercise the mappers directly — the contract stays honest without pulling in
 * the server client.
 *
 * MONEY / AMOUNT SAFETY (standing rule — never floats for value):
 *   - USD is ALWAYS integer cents → number.
 *   - On-chain amounts (numeric(78,0) amount_raw, text amount_decimal,
 *     numeric ratios, scaled prices) are preserved EXACTLY as decimal STRINGS.
 *     They routinely exceed Number.MAX_SAFE_INTEGER; BigInt math (C13) runs on
 *     the string. We never round-trip a raw token amount through JS number.
 */
import type {
  Chain,
  AmountModel,
  TxDirection,
  TxType,
} from "./crypto-core";

// ---------------------------------------------------------------------------
// Records (camelCase; storage-facing). See migration 0160 for column truth.
// ---------------------------------------------------------------------------

export type DecimalsSource = "verified" | "denom-convention" | "issued-precision";

/** A tradable asset we track. `decimals` is DATA (audited via decimalsSource). */
export type CryptoAssetRecord = {
  id: string;
  symbol: string;
  name: string;
  chain: Chain;
  amountModel: AmountModel;
  /** Fixed decimal count for 'evm-minor'; null for 'xrpl-issued'. */
  decimals: number | null;
  decimalsSource: DecimalsSource;
  native: boolean;
  contract: string | null;
  issuer: string | null;
  currencyCode: string | null;
  denom: string | null;
  /** Destination asset id if this asset merges forward (CORE→TX, SOLO→TX). */
  migratesToAssetId: string | null;
  active: boolean;
  /**
   * Owner has HIDDEN this asset from the portfolio view (scam/airdrop). It stays
   * fully in the database for provability; hidden only removes it from the view.
   * Optional here because the backing column ships in a later migration; until
   * then it reads as undefined (treated as not-hidden). Never deletes anything.
   */
  hidden?: boolean;
};

/** A watch-only wallet. `address` is a PUBLIC on-chain address only. */
export type CryptoWalletRecord = {
  id: string;
  chain: Chain;
  address: string;
  label: string | null;
  active: boolean;
};

/**
 * Current holdings per wallet+asset. Exactly one amount field is populated,
 * matching the asset's amount_model. Both are STRINGS (never floats).
 */
export type CryptoBalanceRecord = {
  id: string;
  walletId: string;
  assetId: string;
  /** Integer minor units as a string (evm-minor), or null. */
  amountRaw: string | null;
  /** Decimal string (xrpl-issued), or null. */
  amountDecimal: string | null;
  decimalsAtRead: number | null;
  /** USD value in integer cents, or null until priced. */
  usdValueCents: number | null;
  balancesUpdatedAt: string | null;
};

/** One on-chain event affecting a tracked wallet. RAW amounts kept as strings. */
export type CryptoTransactionRecord = {
  id: string;
  walletId: string;
  assetId: string | null;
  chain: Chain;
  txHash: string;
  eventIndex: number;
  direction: TxDirection | null;
  txType: TxType;
  amountRaw: string | null;
  amountDecimal: string | null;
  decimalsAtEvent: number | null;
  feeRaw: string | null;
  feeAssetId: string | null;
  usdValueCents: number | null;
  priceAsof: string | null;
  counterparty: string | null;
  blockNumber: number | null;
  blockTime: string | null;
  migrationId: string | null;
};

/** A recorded token merger/conversion (keep-history: source asset retained). */
export type CryptoAssetMigrationRecord = {
  id: string;
  fromAssetId: string;
  toAssetId: string;
  /** Exact fraction (numerator/denominator) — null until officially verified. */
  ratioNumerator: string | null;
  ratioDenominator: string | null;
  conversionKind: "automatic" | "manual" | null;
  effectiveAt: string | null;
  notes: string | null;
};

/** Per-wallet backfill/incremental cursor state (resumable sync). */
export type CryptoSyncStateRecord = {
  id: string;
  walletId: string;
  backfillCursor: string | null;
  backfillComplete: boolean;
  lastIncrementalCursor: string | null;
  lastSyncedAt: string | null;
  status: "idle" | "backfilling" | "syncing" | "error";
  errorMessage: string | null;
  /** Backfill TARGET (EVM chain-tip block as text; null for opaque-cursor chains). */
  backfillTarget: string | null;
  /** Resume cursor from the PRIOR run (for stuck-loop detection). */
  prevBackfillCursor: string | null;
  /** Running count of transaction rows captured for this wallet. */
  transactionsTotal: number | null;
};

/**
 * A cached USD price for valuation/cost-basis (C9). Sub-cent precision:
 * price_scaled_cents = USD cents * 10^price_scale. Kept as STRING (numeric(78,0)).
 */
export type CryptoPriceSnapshotRecord = {
  id: string;
  assetId: string;
  priceDate: string;
  priceScaledCents: string;
  priceScale: number;
  source: string;
};

// ---------------------------------------------------------------------------
// DB row shapes (snake_case) + column selectors (explicit; never SELECT *).
// ---------------------------------------------------------------------------

export type AssetRow = {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  amount_model: string;
  decimals: number | string | null;
  decimals_source: string;
  native: boolean;
  contract: string | null;
  issuer: string | null;
  currency_code: string | null;
  denom: string | null;
  migrates_to_asset_id: string | null;
  active: boolean;
  /** Optional: absent when the 0162 column hasn't been migrated yet. */
  hidden?: boolean | null;
};

/** Base columns present since 0160 (no `hidden`; used as a pre-0162 fallback). */
export const ASSET_BASE_COLS =
  "id,symbol,name,chain,amount_model,decimals,decimals_source,native,contract," +
  "issuer,currency_code,denom,migrates_to_asset_id,active";

/** Full columns including the 0162 `hidden` flag. */
export const ASSET_COLS = ASSET_BASE_COLS + ",hidden";

export type WalletRow = {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  active: boolean;
};

export const WALLET_COLS = "id,chain,address,label,active";

export type BalanceRow = {
  id: string;
  wallet_id: string;
  asset_id: string;
  amount_raw: string | number | null;
  amount_decimal: string | null;
  decimals_at_read: number | string | null;
  usd_value_cents: number | string | null;
  balances_updated_at: string | null;
};

export const BALANCE_COLS =
  "id,wallet_id,asset_id,amount_raw,amount_decimal,decimals_at_read," +
  "usd_value_cents,balances_updated_at";

export type TransactionRow = {
  id: string;
  wallet_id: string;
  asset_id: string | null;
  chain: string;
  tx_hash: string;
  event_index: number | string;
  direction: string | null;
  tx_type: string;
  amount_raw: string | number | null;
  amount_decimal: string | null;
  decimals_at_event: number | string | null;
  fee_raw: string | number | null;
  fee_asset_id: string | null;
  usd_value_cents: number | string | null;
  price_asof: string | null;
  counterparty: string | null;
  block_number: number | string | null;
  block_time: string | null;
  migration_id: string | null;
};

export const TRANSACTION_COLS =
  "id,wallet_id,asset_id,chain,tx_hash,event_index,direction,tx_type,amount_raw," +
  "amount_decimal,decimals_at_event,fee_raw,fee_asset_id,usd_value_cents," +
  "price_asof,counterparty,block_number,block_time,migration_id";

export type MigrationRow = {
  id: string;
  from_asset_id: string;
  to_asset_id: string;
  ratio_numerator: string | number | null;
  ratio_denominator: string | number | null;
  conversion_kind: string | null;
  effective_at: string | null;
  notes: string | null;
};

export const MIGRATION_COLS =
  "id,from_asset_id,to_asset_id,ratio_numerator,ratio_denominator," +
  "conversion_kind,effective_at,notes";

export type SyncStateRow = {
  id: string;
  wallet_id: string;
  backfill_cursor: string | null;
  backfill_complete: boolean;
  last_incremental_cursor: string | null;
  last_synced_at: string | null;
  status: string;
  error_message: string | null;
  // Progress-visibility columns (migration 0161; all nullable, may be absent
  // pre-migration — the mapper reads them defensively).
  backfill_target?: string | null;
  prev_backfill_cursor?: string | null;
  transactions_total?: number | string | null;
};

/**
 * Full column set INCLUDING the progress-visibility columns (migration 0161).
 * `getCryptoSyncState` selects these first and falls back to the base set if the
 * migration hasn't run yet, so the page keeps working PRE-migration.
 */
export const SYNC_STATE_COLS =
  "id,wallet_id,backfill_cursor,backfill_complete,last_incremental_cursor," +
  "last_synced_at,status,error_message,backfill_target,prev_backfill_cursor," +
  "transactions_total";

/** Pre-0161 column set (fallback when the progress columns don't exist yet). */
export const SYNC_STATE_BASE_COLS =
  "id,wallet_id,backfill_cursor,backfill_complete,last_incremental_cursor," +
  "last_synced_at,status,error_message";

export type PriceSnapshotRow = {
  id: string;
  asset_id: string;
  price_date: string;
  price_scaled_cents: string | number;
  price_scale: number | string;
  source: string;
};

export const PRICE_SNAPSHOT_COLS =
  "id,asset_id,price_date,price_scaled_cents,price_scale,source";

// ---------------------------------------------------------------------------
// Pure coercion helpers.
//   - numeric(78,0)/text amount columns arrive from supabase-js as STRING or
//     number; we keep them as an integer-decimal STRING (never a lossy number).
//   - small integer columns (cents, decimals, block) that fit safely become
//     number | null.
// ---------------------------------------------------------------------------

/** Coerce a numeric(78,0)/text amount to a trimmed decimal STRING, or null. */
export function toAmountString(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Coerce a small integer column (cents, decimals, block) to number | null. */
export function toIntOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Read limits + guards (caps enforced, never trusted from the caller).
// ---------------------------------------------------------------------------

/** Max transactions a single wallet-detail view pulls at once. */
export const CRYPTO_TXN_READ_LIMIT = 1000;

/** Max price snapshots returned for one asset history read. */
export const CRYPTO_PRICE_READ_LIMIT = 1000;

export function clampLimit(limit: number, cap: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), cap) : cap;
}

export function cleanId(id: string | null | undefined): string {
  return (id ?? "").trim();
}

// ---------------------------------------------------------------------------
// Pure row → record mappers.
// ---------------------------------------------------------------------------

export function toCryptoAssetRecord(row: AssetRow): CryptoAssetRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    chain: row.chain as Chain,
    amountModel: row.amount_model as AmountModel,
    decimals: toIntOrNull(row.decimals),
    decimalsSource: row.decimals_source as DecimalsSource,
    native: !!row.native,
    contract: row.contract,
    issuer: row.issuer,
    currencyCode: row.currency_code,
    denom: row.denom,
    migratesToAssetId: row.migrates_to_asset_id,
    active: !!row.active,
    hidden: row.hidden === true,
  };
}

export function toCryptoWalletRecord(row: WalletRow): CryptoWalletRecord {
  return {
    id: row.id,
    chain: row.chain as Chain,
    address: row.address,
    label: row.label,
    active: !!row.active,
  };
}

export function toCryptoBalanceRecord(row: BalanceRow): CryptoBalanceRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    assetId: row.asset_id,
    amountRaw: toAmountString(row.amount_raw),
    amountDecimal: toAmountString(row.amount_decimal),
    decimalsAtRead: toIntOrNull(row.decimals_at_read),
    usdValueCents: toIntOrNull(row.usd_value_cents),
    balancesUpdatedAt: row.balances_updated_at,
  };
}

export function toCryptoTransactionRecord(row: TransactionRow): CryptoTransactionRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    assetId: row.asset_id,
    chain: row.chain as Chain,
    txHash: row.tx_hash,
    eventIndex: toIntOrNull(row.event_index) ?? 0,
    direction: (row.direction as TxDirection | null) ?? null,
    txType: (row.tx_type as TxType) ?? "other",
    amountRaw: toAmountString(row.amount_raw),
    amountDecimal: toAmountString(row.amount_decimal),
    decimalsAtEvent: toIntOrNull(row.decimals_at_event),
    feeRaw: toAmountString(row.fee_raw),
    feeAssetId: row.fee_asset_id,
    usdValueCents: toIntOrNull(row.usd_value_cents),
    priceAsof: row.price_asof,
    counterparty: row.counterparty,
    blockNumber: toIntOrNull(row.block_number),
    blockTime: row.block_time,
    migrationId: row.migration_id,
  };
}

export function toCryptoAssetMigrationRecord(row: MigrationRow): CryptoAssetMigrationRecord {
  return {
    id: row.id,
    fromAssetId: row.from_asset_id,
    toAssetId: row.to_asset_id,
    ratioNumerator: toAmountString(row.ratio_numerator),
    ratioDenominator: toAmountString(row.ratio_denominator),
    conversionKind: (row.conversion_kind as "automatic" | "manual" | null) ?? null,
    effectiveAt: row.effective_at,
    notes: row.notes,
  };
}

export function toCryptoSyncStateRecord(row: SyncStateRow): CryptoSyncStateRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    backfillCursor: row.backfill_cursor,
    backfillComplete: !!row.backfill_complete,
    lastIncrementalCursor: row.last_incremental_cursor,
    lastSyncedAt: row.last_synced_at,
    status: (row.status as CryptoSyncStateRecord["status"]) ?? "idle",
    errorMessage: row.error_message,
    backfillTarget: row.backfill_target ?? null,
    prevBackfillCursor: row.prev_backfill_cursor ?? null,
    transactionsTotal: parseNullableCount(row.transactions_total),
  };
}

/** Coerce a bigint-as-string / number / null count into number | null (no NaN). */
function parseNullableCount(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function toCryptoPriceSnapshotRecord(row: PriceSnapshotRow): CryptoPriceSnapshotRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    priceDate: row.price_date,
    priceScaledCents: toAmountString(row.price_scaled_cents) ?? "0",
    priceScale: toIntOrNull(row.price_scale) ?? 6,
    source: row.source,
  };
}

// ---------------------------------------------------------------------------
// Pure self-test — exercises the coercion helpers + row mappers with NO DB.
// Wired into scripts/compliance/run-pure-selftests.ts and mirrored in vitest.
// Counts failures and throws on any, so a shape regression fails CI loudly.
// ---------------------------------------------------------------------------

export function __runCryptoStoreCoreTests(): void {
  let failures = 0;
  const check = (label: string, cond: boolean): void => {
    if (!cond) {
      failures += 1;
      console.error(`[crypto-store self-test] FAIL: ${label}`);
    }
  };

  // --- toAmountString: preserves big integers as exact strings, never floats.
  check("amountString keeps huge integer exactly", toAmountString("123456789012345678901234567890") === "123456789012345678901234567890");
  check("amountString from number", toAmountString(1000000) === "1000000");
  check("amountString null → null", toAmountString(null) === null);
  check("amountString undefined → null", toAmountString(undefined) === null);
  check("amountString empty → null", toAmountString("   ") === null);
  check("amountString trims", toAmountString("  42  ") === "42");

  // --- toIntOrNull: small integers become numbers; junk/empty → null.
  check("int from number", toIntOrNull(18) === 18);
  check("int from string", toIntOrNull("6") === 6);
  check("int null → null", toIntOrNull(null) === null);
  check("int empty → null", toIntOrNull("") === null);
  check("int NaN → null", toIntOrNull("abc") === null);

  // --- asset mapper (evm token: USDT-ERC20, 6 decimals verified).
  const asset = toCryptoAssetRecord({
    id: "usdt-eth",
    symbol: "USDT",
    name: "Tether (Ethereum)",
    chain: "ethereum",
    amount_model: "evm-minor",
    decimals: 6,
    decimals_source: "verified",
    native: false,
    contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    issuer: null,
    currency_code: null,
    denom: null,
    migrates_to_asset_id: null,
    active: true,
  });
  check("asset id", asset.id === "usdt-eth");
  check("asset chain typed", asset.chain === "ethereum");
  check("asset amountModel", asset.amountModel === "evm-minor");
  check("asset decimals number", asset.decimals === 6);
  check("asset decimalsSource", asset.decimalsSource === "verified");
  check("asset contract passthrough", asset.contract === "0xdac17f958d2ee523a2206206994597c13d831ec7");
  check("asset native false", asset.native === false);
  check("asset migratesToAssetId null", asset.migratesToAssetId === null);
  // 0162 `hidden`: absent in the row (pre-migration) maps to false, never crashes.
  check("asset hidden absent -> false", asset.hidden === false);

  // --- asset mapper: an explicitly hidden asset maps hidden=true.
  const hiddenAsset = toCryptoAssetRecord({
    id: "flare:scam",
    symbol: "SCAM",
    name: "Scam Coin",
    chain: "flare",
    amount_model: "evm-minor",
    decimals: 18,
    decimals_source: "verified",
    native: false,
    contract: "0x0000000000000000000000000000000000000abc",
    issuer: null,
    currency_code: null,
    denom: null,
    migrates_to_asset_id: null,
    active: true,
    hidden: true,
  });
  check("asset hidden true maps true", hiddenAsset.hidden === true);
  // ASSET_COLS extends the base set with exactly the hidden column.
  check("ASSET_COLS adds hidden", ASSET_COLS === ASSET_BASE_COLS + ",hidden");
  check("ASSET_BASE_COLS has no hidden", !ASSET_BASE_COLS.split(",").includes("hidden"));

  // --- asset mapper (xrpl-issued SOLO → migrates to tx; decimals null).
  const solo = toCryptoAssetRecord({
    id: "solo",
    symbol: "SOLO",
    name: "Sologenic",
    chain: "xrpl",
    amount_model: "xrpl-issued",
    decimals: null,
    decimals_source: "issued-precision",
    native: false,
    contract: null,
    issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
    currency_code: "534F4C4F00000000000000000000000000000000",
    denom: null,
    migrates_to_asset_id: "tx",
    active: true,
  });
  check("solo xrpl-issued", solo.amountModel === "xrpl-issued");
  check("solo decimals null", solo.decimals === null);
  check("solo migrates to tx", solo.migratesToAssetId === "tx");
  check("solo issuer", solo.issuer === "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz");

  // --- wallet mapper.
  const wallet = toCryptoWalletRecord({
    id: "w-1",
    chain: "coreum",
    address: "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd",
    label: "Coreum/Pulsara",
    active: true,
  });
  check("wallet chain", wallet.chain === "coreum");
  check("wallet address preserved", wallet.address === "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd");
  check("wallet label", wallet.label === "Coreum/Pulsara");

  // --- balance mapper (evm-minor: amountRaw string, amountDecimal null).
  const bal = toCryptoBalanceRecord({
    id: "b-1",
    wallet_id: "w-1",
    asset_id: "eth",
    amount_raw: "1500000000000000000",
    amount_decimal: null,
    decimals_at_read: 18,
    usd_value_cents: 250000,
    balances_updated_at: "2026-03-01T00:00:00Z",
  });
  check("balance amountRaw string exact", bal.amountRaw === "1500000000000000000");
  check("balance amountDecimal null", bal.amountDecimal === null);
  check("balance decimalsAtRead", bal.decimalsAtRead === 18);
  check("balance usdValueCents number", bal.usdValueCents === 250000);

  // --- balance mapper (xrpl-issued: amountDecimal string, amountRaw null).
  const balXrpl = toCryptoBalanceRecord({
    id: "b-2",
    wallet_id: "w-2",
    asset_id: "solo",
    amount_raw: null,
    amount_decimal: "1234.567890123456",
    decimals_at_read: null,
    usd_value_cents: null,
    balances_updated_at: null,
  });
  check("balance xrpl amountDecimal", balXrpl.amountDecimal === "1234.567890123456");
  check("balance xrpl amountRaw null", balXrpl.amountRaw === null);
  check("balance xrpl usd null", balXrpl.usdValueCents === null);

  // --- transaction mapper (LP add on Flare — the tax-critical DeFi case).
  const tx = toCryptoTransactionRecord({
    id: "t-1",
    wallet_id: "w-1",
    asset_id: "flr",
    chain: "flare",
    tx_hash: "0xabc",
    event_index: 2,
    direction: "out",
    tx_type: "lp_add",
    amount_raw: "500000000000000000000",
    amount_decimal: null,
    decimals_at_event: 18,
    fee_raw: "21000000000000000",
    fee_asset_id: "flr",
    usd_value_cents: 100000,
    price_asof: "2026-02-01T12:00:00Z",
    counterparty: "0xpool",
    block_number: 12345678,
    block_time: "2026-02-01T12:00:00Z",
    migration_id: null,
  });
  check("tx chain flare", tx.chain === "flare");
  check("tx type lp_add", tx.txType === "lp_add");
  check("tx direction out", tx.direction === "out");
  check("tx amountRaw exact", tx.amountRaw === "500000000000000000000");
  check("tx eventIndex", tx.eventIndex === 2);
  check("tx feeRaw", tx.feeRaw === "21000000000000000");
  check("tx blockNumber", tx.blockNumber === 12345678);

  // --- transaction defaults (null tx_type coerced to 'other', event index 0).
  const txDefault = toCryptoTransactionRecord({
    id: "t-2",
    wallet_id: "w-1",
    asset_id: null,
    chain: "ethereum",
    tx_hash: "0xdef",
    event_index: 0,
    direction: null,
    tx_type: "other",
    amount_raw: null,
    amount_decimal: null,
    decimals_at_event: null,
    fee_raw: null,
    fee_asset_id: null,
    usd_value_cents: null,
    price_asof: null,
    counterparty: null,
    block_number: null,
    block_time: null,
    migration_id: null,
  });
  check("tx default type other", txDefault.txType === "other");
  check("tx null direction", txDefault.direction === null);
  check("tx null amounts", txDefault.amountRaw === null && txDefault.amountDecimal === null);

  // --- migration mapper (SOLO→TX manual, ratio null until verified).
  const mig = toCryptoAssetMigrationRecord({
    id: "m-1",
    from_asset_id: "solo",
    to_asset_id: "tx",
    ratio_numerator: null,
    ratio_denominator: null,
    conversion_kind: "manual",
    effective_at: null,
    notes: "SOLO→TX owner-initiated; ratio pending official verification.",
  });
  check("migration from", mig.fromAssetId === "solo");
  check("migration to", mig.toAssetId === "tx");
  check("migration kind manual", mig.conversionKind === "manual");
  check("migration ratio null until verified", mig.ratioNumerator === null && mig.ratioDenominator === null);

  // --- sync-state mapper.
  const sync = toCryptoSyncStateRecord({
    id: "s-1",
    wallet_id: "w-1",
    backfill_cursor: "12000000",
    backfill_complete: false,
    last_incremental_cursor: null,
    last_synced_at: null,
    status: "backfilling",
    error_message: null,
  });
  check("sync backfillCursor", sync.backfillCursor === "12000000");
  check("sync backfillComplete false", sync.backfillComplete === false);
  check("sync status", sync.status === "backfilling");

  // --- price snapshot mapper (scaled cents kept as string; scale default).
  const price = toCryptoPriceSnapshotRecord({
    id: "p-1",
    asset_id: "eth",
    price_date: "2026-03-01",
    price_scaled_cents: "250000000000",
    price_scale: 6,
    source: "coingecko",
  });
  check("price scaled cents string exact", price.priceScaledCents === "250000000000");
  check("price scale", price.priceScale === 6);
  check("price source", price.source === "coingecko");

  // --- clampLimit / cleanId behavior (read-guard correctness).
  check("clampLimit caps over max", clampLimit(999999, CRYPTO_TXN_READ_LIMIT) === CRYPTO_TXN_READ_LIMIT);
  check("clampLimit rejects zero", clampLimit(0, CRYPTO_TXN_READ_LIMIT) === CRYPTO_TXN_READ_LIMIT);
  check("clampLimit rejects negative", clampLimit(-5, CRYPTO_TXN_READ_LIMIT) === CRYPTO_TXN_READ_LIMIT);
  check("clampLimit keeps valid", clampLimit(50, CRYPTO_TXN_READ_LIMIT) === 50);
  check("clampLimit floors fractional", clampLimit(50.9, CRYPTO_TXN_READ_LIMIT) === 50);
  check("cleanId trims", cleanId("  abc  ") === "abc");
  check("cleanId null → empty", cleanId(null) === "");

  if (failures > 0) {
    throw new Error(`crypto-store self-test failed: ${failures} check(s) failed`);
  }
}
