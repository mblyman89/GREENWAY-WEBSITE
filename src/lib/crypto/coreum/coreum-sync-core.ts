/**
 * src/lib/crypto/coreum/coreum-sync-core.ts — PURE Coreum sync brain (Slice C8b).
 *
 * No `server-only`, no network, no Supabase, no React. Just the decision logic
 * and the row-builders that turn the mapped balances/transactions into the
 * EXACT upsert objects for the crypto_* tables. Keeping this pure lets the
 * self-test battery (which runs under tsx) exercise every rule without a DB.
 *
 * The server layer (coreum-sync-server.ts) owns the network calls + the writes;
 * it asks this module three things:
 *   1. "Turn these mapped balances into balance-upsert rows."   → buildBalanceUpserts
 *   2. "Turn this mapped tx leg into a transaction-upsert row." → buildTransactionUpsert(s)
 *   3. "Given the last page, what's my next request + am I done?" → the backfill reducer.
 *
 * DESIGN DECISIONS (grounded, never guessed):
 *
 * • SIGNED → UNSIGNED + direction. The mapper carries SIGNED amounts
 *   (negative = value left the wallet). The DB stores an UNSIGNED magnitude plus
 *   a `direction` ('in'|'out'|'self'), matching migration 0160's check constraint
 *   and every other chain's convention. We split sign here, exactly, via BigInt/
 *   decimal-safe helpers — never a float.
 *
 * • IDEMPOTENCY. Every transaction row carries the natural key
 *   (wallet_id, tx_hash, event_index) that migration 0160 made UNIQUE, so a
 *   re-run upserts in place and never double-counts. Balances are keyed on
 *   (wallet_id, asset_id), also UNIQUE.
 *
 * • AUDIT PAYLOAD. crypto_transactions has a `raw jsonb` column ("full source
 *   payload; never guess; future-proof"). We attach the untouched source
 *   envelope so the ledger truth is preserved verbatim for any future
 *   re-classification or an IRS audit — we never have to re-fetch to prove it.
 *
 * • UNTRACKED TOKENS. A balance / tx leg for a token we don't yet model
 *   (assetId === null) is NOT dropped — we keep the row with a human note of the
 *   decoded denom in `raw`, so history stays complete and nothing is silently
 *   lost. (Classifying it to a real asset happens in a later slice.)
 *
 * • TWO-QUERY BACKFILL STATE MACHINE. Cosmos tx search requires TWO queries
 *   (message.sender='{addr}' for outgoing, transfer.recipient='{addr}' for
 *   incoming) because the LCD does not support OR. We deduplicate by txhash.
 *   The state machine walks BOTH streams to completion, persisting the opaque
 *   pagination next_key as the resumable cursor. Each stream has its own cursor.
 *   Hard page and empty-page guards stop a misbehaving endpoint from spinning
 *   forever.
 */

import type { TxDirection, TxType, Chain } from "../crypto-core";
import { normalizeMinorUnits } from "../crypto-core";
import type { MappedBalance, MappedTransaction } from "./coreum-map-core";

// ---------------------------------------------------------------------------
// Upsert row shapes — snake_case to match the DB columns EXACTLY (migration
// 0160). The server layer hands these straight to supabase upsert(); keeping
// the shape here (pure) means the column contract is unit-tested.
// ---------------------------------------------------------------------------

/** A crypto_balances upsert row. Conflict target: (wallet_id, asset_id). */
export type BalanceUpsertRow = {
  wallet_id: string;
  asset_id: string;
  amount_raw: string | null;
  amount_decimal: string | null;
  decimals_at_read: number | null;
  usd_value_cents: number | null;
  balances_updated_at: string;
};

/** A crypto_transactions upsert row. Conflict target: (wallet_id, tx_hash, event_index). */
export type TransactionUpsertRow = {
  wallet_id: string;
  asset_id: string | null;
  chain: Chain;
  tx_hash: string;
  event_index: number;
  direction: TxDirection;
  tx_type: TxType;
  amount_raw: string | null;
  amount_decimal: string | null;
  decimals_at_event: number | null;
  fee_raw: string | null;
  fee_asset_id: string | null;
  usd_value_cents: number | null;
  price_asof: string | null;
  counterparty: string | null;
  block_number: number | null;
  block_time: string | null;
  migration_id: string | null;
  raw: unknown;
};

/** A crypto_sync_state upsert row. Conflict target: (wallet_id). */
export type SyncStateUpsertRow = {
  wallet_id: string;
  backfill_cursor: string | null;
  backfill_complete: boolean;
  last_incremental_cursor: string | null;
  last_synced_at: string | null;
  status: "idle" | "backfilling" | "syncing" | "error";
  error_message: string | null;
};

// ---------------------------------------------------------------------------
// Amount sign helpers — exact, BigInt/decimal-safe. Split a SIGNED mapped
// amount into an UNSIGNED magnitude, letting `direction` carry the sign.
// ---------------------------------------------------------------------------

/** Strip the sign from a canonical integer-minor string. "-5" → "5", "0" → "0". */
export function unsignMinor(raw: string | null): string | null {
  if (raw === null) return null;
  const canon = normalizeMinorUnits(raw); // canonicalises + validates integer
  return canon.startsWith("-") ? canon.slice(1) : canon;
}

// ---------------------------------------------------------------------------
// A tiny, human-readable "note" object stored in `raw` for untracked-token
// balances and transaction legs. This is metadata ABOUT the row, never a
// substitute for the real source payload (which we also keep for transactions).
// ---------------------------------------------------------------------------

/** Build the untracked-token note (kept in `raw` so nothing is ever lost). */
export function untrackedTokenNote(
  denom: string | undefined,
): { untrackedToken: { denom: string | null } } {
  return {
    untrackedToken: {
      denom: denom ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Balance row builders.
// ---------------------------------------------------------------------------

/**
 * Turn ONE mapped balance into a crypto_balances upsert row. `updatedAt` is the
 * read timestamp (ISO) the server captured for this snapshot. USD is left null
 * here — pricing/valuation is a later slice (C9); we never guess a dollar value.
 *
 * A balance whose asset we don't yet model (assetId === null) is SKIPPED for the
 * balances table (that table's asset_id is NOT NULL and FK-constrained). Its
 * existence is not lost: the untracked denom is surfaced by the caller. This
 * keeps the write safe against the FK while staying honest.
 */
export function buildBalanceUpsert(
  walletId: string,
  bal: MappedBalance,
  updatedAt: string,
): BalanceUpsertRow | null {
  if (!bal.assetId) return null;
  return {
    wallet_id: walletId,
    asset_id: bal.assetId,
    amount_raw: bal.amountRaw,
    amount_decimal: bal.amountDecimal, // always null for Cosmos
    decimals_at_read: bal.decimalsAtRead,
    usd_value_cents: null,
    balances_updated_at: updatedAt,
  };
}

/** Build every persistable balance-upsert row from a mapped-balance set. */
export function buildBalanceUpserts(
  walletId: string,
  balances: MappedBalance[],
  updatedAt: string,
): BalanceUpsertRow[] {
  const out: BalanceUpsertRow[] = [];
  for (const b of balances ?? []) {
    const row = buildBalanceUpsert(walletId, b, updatedAt);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Untracked balances the caller may want to surface (a held token we don't yet
 * model). Returned separately so the server can log/alert without ever dropping
 * the fact that the wallet holds something.
 */
export function untrackedBalances(balances: MappedBalance[]): MappedBalance[] {
  return (balances ?? []).filter((b) => !b.assetId);
}

// ---------------------------------------------------------------------------
// Transaction row builder — the heart of the tax-truth persistence.
// ---------------------------------------------------------------------------

/**
 * Turn ONE mapped transaction leg into a crypto_transactions upsert row.
 *   • amount is UNSIGNED (magnitude); `direction` carries the sign.
 *   • fee is only present on the signer's first ucore leg (the mapper
 *     attributes it once).
 *   • `raw` keeps the untouched source envelope — plus, for an untracked token,
 *     a note of its denom merged in — so the ledger truth is provable without a
 *     re-fetch.
 *   • USD/price is left null (priced later, never guessed).
 */
export function buildTransactionUpsert(
  walletId: string,
  tx: MappedTransaction,
  sourceEnvelope: unknown,
): TransactionUpsertRow {
  const rawBase =
    sourceEnvelope === undefined || sourceEnvelope === null
      ? {}
      : (sourceEnvelope as Record<string, unknown>);
  const raw: unknown = tx.assetId
    ? rawBase
    : { ...rawBase, ...untrackedTokenNote(tx.denom) };

  return {
    wallet_id: walletId,
    asset_id: tx.assetId,
    chain: tx.chain,
    tx_hash: tx.txHash,
    event_index: tx.eventIndex,
    direction: tx.direction,
    tx_type: tx.txType,
    amount_raw: unsignMinor(tx.amountRaw),
    amount_decimal: tx.amountDecimal, // always null for Cosmos
    decimals_at_event: tx.decimalsAtEvent,
    fee_raw: unsignMinor(tx.feeRaw),
    fee_asset_id: tx.feeAssetId,
    usd_value_cents: null,
    price_asof: null,
    counterparty: tx.counterparty,
    block_number: tx.blockNumber,
    block_time: tx.blockTime,
    migration_id: null,
    raw,
  };
}

/** Build every transaction-upsert row for one source envelope's mapped legs. */
export function buildTransactionUpserts(
  walletId: string,
  legs: MappedTransaction[],
  sourceEnvelope: unknown,
): TransactionUpsertRow[] {
  return (legs ?? []).map((leg) => buildTransactionUpsert(walletId, leg, sourceEnvelope));
}

// ---------------------------------------------------------------------------
// Two-query backfill state machine — walks BOTH Cosmos tx-search streams
// (sender + recipient) by opaque pagination next_key, deduplicating by txhash.
// ---------------------------------------------------------------------------

/** Hard ceiling so a misbehaving endpoint can't page forever (per stream). */
export const MAX_COREUM_BACKFILL_PAGES = 5000;

/**
 * Which of the two tx-search streams we are currently walking. The sender query
 * finds outgoing txs (message.sender='{addr}'); the recipient query finds
 * incoming txs (transfer.recipient='{addr}'). Dedup by txhash handles overlap.
 */
export type CoreumStreamId = "sender" | "recipient";

/** Cursor for a single stream (sender or recipient). */
export type CoreumStreamCursor = {
  /** next_key to send on the NEXT request (null = start or done). */
  nextKey: string | null;
  /** True once this stream returned no next_key — it is exhausted. */
  done: boolean;
  /** Pages applied for this stream. */
  pages: number;
};

/** State of an in-progress (or finished) Coreum transaction backfill. */
export type CoreumBackfillState = {
  sender: CoreumStreamCursor;
  recipient: CoreumStreamCursor;
  /** txhashes seen so far (for cross-stream dedup). */
  seenHashes: Set<string>;
  /** True once BOTH streams are done. */
  done: boolean;
};

/**
 * Build the initial stream cursor from a saved next_key (resumable cursor).
 *   • A non-empty key → resume from that page (done=false).
 *   • A null key with streamAlreadyDone=true → the stream was exhausted in a
 *     prior run; mark it done so we skip it.
 *   • A null key with streamAlreadyDone=false → fresh start, fetch page 1.
 */
function initStreamCursor(
  savedKey: string | null,
  streamAlreadyDone: boolean,
): CoreumStreamCursor {
  const nextKey =
    savedKey === undefined || savedKey === null || savedKey === ""
      ? null
      : savedKey;
  return { nextKey, done: streamAlreadyDone, pages: 0 };
}

/**
 * Begin a backfill. `savedSenderKey` and `savedRecipientKey` are the resumable
 * next_keys from a prior run (null = start from the first page OR the stream
 * was already exhausted). `senderDone` / `recipientDone` tell us which streams
 * were already completed in a prior run (so we skip them on resume). When
 * starting a FRESH backfill (no prior cursor), pass all nulls/false — both
 * streams will start from page 1.
 */
export function initCoreumBackfill(
  savedSenderKey: string | null,
  savedRecipientKey: string | null,
  senderDone: boolean,
  recipientDone: boolean,
): CoreumBackfillState {
  return {
    sender: initStreamCursor(savedSenderKey, senderDone),
    recipient: initStreamCursor(savedRecipientKey, recipientDone),
    seenHashes: new Set<string>(),
    done: false,
  };
}

/**
 * Apply the result of ONE page from a single stream. `nextKey` is the page's
 * returned pagination next_key (null/undefined when there are no more pages).
 * `txHashes` are the txhashes from this page (added to the dedup set).
 * Increments the page count and flips `done` when the stream is exhausted or
 * the page guard trips.
 */
export function reduceCoreumStream(
  state: CoreumBackfillState,
  stream: CoreumStreamId,
  nextKey: string | null,
  txHashes: string[],
): CoreumBackfillState {
  const cursor = state[stream];
  const pages = cursor.pages + 1;
  const noMore = nextKey === undefined || nextKey === null || nextKey === "";
  const hitGuard = pages >= MAX_COREUM_BACKFILL_PAGES;
  const newCursor: CoreumStreamCursor = {
    nextKey: noMore ? null : nextKey,
    pages,
    done: noMore || hitGuard,
  };

  const seenHashes = new Set(state.seenHashes);
  for (const h of txHashes) {
    seenHashes.add(h);
  }

  const sender = stream === "sender" ? newCursor : state.sender;
  const recipient = stream === "recipient" ? newCursor : state.recipient;
  const done = sender.done && recipient.done;

  return { sender, recipient, seenHashes, done };
}

/**
 * Which stream should the server fetch next? Returns the stream id, or null if
 * both are done. The sender stream is walked first (to completion), then the
 * recipient stream. This keeps the dedup set growing monotonically and ensures
 * a clean, resumable cursor (one stream's cursor is stable while we walk the
 * other).
 */
export function nextStream(state: CoreumBackfillState): CoreumStreamId | null {
  if (!state.sender.done) return "sender";
  if (!state.recipient.done) return "recipient";
  return null;
}

/** Should the orchestrator request another page? */
export function shouldContinueBackfill(state: CoreumBackfillState): boolean {
  return !state.done;
}

/**
 * Has a txhash already been seen (from the other stream)? Used by the server to
 * skip a tx that both queries returned — we map it once, not twice.
 */
export function isDuplicateHash(state: CoreumBackfillState, txHash: string): boolean {
  return state.seenHashes.has(txHash);
}

// ---------------------------------------------------------------------------
// Cursor (de)serialisation — the two-stream cursor is stored as a JSON object
// in backfill_cursor. Each stream's next_key is a base64 string or null.
// ---------------------------------------------------------------------------

/** The persisted cursor shape (JSON-serialised into backfill_cursor). */
export type CoreumCursorPayload = {
  senderKey: string | null;
  recipientKey: string | null;
};

/** Serialise the two-stream cursor to a JSON string for backfill_cursor storage. */
export function serializeCursor(state: CoreumBackfillState): string | null {
  const payload: CoreumCursorPayload = {
    senderKey: state.sender.done ? null : state.sender.nextKey,
    recipientKey: state.recipient.done ? null : state.recipient.nextKey,
  };
  // If both are done, the cursor is null (walk completed).
  if (payload.senderKey === null && payload.recipientKey === null) return null;
  return JSON.stringify(payload);
}

/** Parse a stored cursor string back into the two stream keys. */
export function deserializeCursor(cursor: string | null): {
  senderKey: string | null;
  recipientKey: string | null;
} {
  if (cursor === null || cursor.trim() === "") {
    return { senderKey: null, recipientKey: null };
  }
  const s = cursor.trim();
  try {
    const parsed = JSON.parse(s) as Partial<CoreumCursorPayload>;
    return {
      senderKey: parsed.senderKey ?? null,
      recipientKey: parsed.recipientKey ?? null,
    };
  } catch {
    // Malformed cursor — start fresh.
    return { senderKey: null, recipientKey: null };
  }
}

// ---------------------------------------------------------------------------
// Counts + summary — for the sync report + diagnostics.
// ---------------------------------------------------------------------------

export type CoreumSyncCounts = {
  pages: number;
  balancesUpserted: number;
  transactionsUpserted: number;
  untrackedBalances: number;
  untrackedTransactions: number;
  duplicatesSkipped: number;
};

export function emptyCoreumSyncCounts(): CoreumSyncCounts {
  return {
    pages: 0,
    balancesUpserted: 0,
    transactionsUpserted: 0,
    untrackedBalances: 0,
    untrackedTransactions: 0,
    duplicatesSkipped: 0,
  };
}

/** Fold one page's contributions into the running totals (pure). */
export function addCoreumPageCounts(
  base: CoreumSyncCounts,
  delta: Partial<CoreumSyncCounts>,
): CoreumSyncCounts {
  return {
    pages: base.pages + (delta.pages ?? 0),
    balancesUpserted: base.balancesUpserted + (delta.balancesUpserted ?? 0),
    transactionsUpserted: base.transactionsUpserted + (delta.transactionsUpserted ?? 0),
    untrackedBalances: base.untrackedBalances + (delta.untrackedBalances ?? 0),
    untrackedTransactions: base.untrackedTransactions + (delta.untrackedTransactions ?? 0),
    duplicatesSkipped: base.duplicatesSkipped + (delta.duplicatesSkipped ?? 0),
  };
}

/** Plain-English one-liner for the sync report. */
export function summarizeCoreumSync(counts: CoreumSyncCounts): string {
  const txn = counts.transactionsUpserted;
  const bal = counts.balancesUpserted;
  const parts = [
    `${bal} balance${bal === 1 ? "" : "s"}`,
    `${txn} transaction${txn === 1 ? "" : "s"}`,
    `${counts.pages} page${counts.pages === 1 ? "" : "s"}`,
  ];
  let s = `Synced ${parts.join(", ")}.`;
  if (counts.duplicatesSkipped > 0) {
    s += ` (${counts.duplicatesSkipped} duplicate skipped across sender/recipient queries.)`;
  }
  if (counts.untrackedBalances > 0 || counts.untrackedTransactions > 0) {
    s += ` (${counts.untrackedBalances} untracked-token balance${counts.untrackedBalances === 1 ? "" : "s"}, ${counts.untrackedTransactions} untracked-token transaction${counts.untrackedTransactions === 1 ? "" : "s"} kept for history.)`;
  }
  return s;
}

/**
 * Build the sync-state upsert row for a completed (or errored) run. Backfill is
 * marked complete once BOTH streams finished; the cursor is null when we walked
 * to the end, or the two-stream JSON cursor when mid-backfill.
 */
export function buildSyncStateUpsert(input: {
  walletId: string;
  cursor: string | null;
  backfillComplete: boolean;
  syncedAt: string;
  status: SyncStateUpsertRow["status"];
  errorMessage: string | null;
}): SyncStateUpsertRow {
  return {
    wallet_id: input.walletId,
    backfill_cursor: input.cursor,
    backfill_complete: input.backfillComplete,
    last_incremental_cursor: input.cursor,
    last_synced_at: input.syncedAt,
    status: input.status,
    error_message: input.errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run under tsx via run-pure-selftests + vitest mirror).
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`coreum-sync-core self-test FAILED: ${name}`);
}

export function __runCoreumSyncCoreTests(): void {
  // --- unsign helper: split sign, keep magnitude EXACTLY (big values too).
  check("unsignMinor negative", unsignMinor("-1000000") === "1000000");
  check("unsignMinor positive passthrough", unsignMinor("1000000") === "1000000");
  check("unsignMinor zero", unsignMinor("0") === "0");
  check("unsignMinor null", unsignMinor(null) === null);
  check(
    "unsignMinor huge exact",
    unsignMinor("-123456789012345678901234567890") === "123456789012345678901234567890",
  );

  // --- balance upsert: tracked TX native balance → row with amount_raw only.
  const txBal: MappedBalance = {
    assetId: "tx",
    amountRaw: "400000000",
    amountDecimal: null,
    decimalsAtRead: 6,
    denom: "ucore",
  };
  const txRow = buildBalanceUpsert("w-1", txBal, "2026-08-11T00:00:00Z");
  check("balance row not null", txRow !== null);
  check("balance wallet", txRow!.wallet_id === "w-1");
  check("balance asset", txRow!.asset_id === "tx");
  check("balance amount_raw", txRow!.amount_raw === "400000000");
  check("balance amount_decimal null", txRow!.amount_decimal === null);
  check("balance decimals", txRow!.decimals_at_read === 6);
  check("balance usd null (never guessed)", txRow!.usd_value_cents === null);
  check("balance updatedAt", txRow!.balances_updated_at === "2026-08-11T00:00:00Z");

  // --- balance upsert: tracked SARA token balance.
  const saraBal: MappedBalance = {
    assetId: "sara",
    amountRaw: "50000000",
    amountDecimal: null,
    decimalsAtRead: 6,
    denom: "usara-core1r9gc0rnxnzpq33u82f44aufgdwvyxv4wyepyck98m9v2pxua6naqr8h03z",
  };
  const saraRow = buildBalanceUpsert("w-1", saraBal, "2026-08-11T00:00:00Z");
  check("sara balance not null", saraRow !== null);
  check("sara balance asset", saraRow!.asset_id === "sara");
  check("sara balance amount_raw", saraRow!.amount_raw === "50000000");

  // --- balance upsert: untracked token → SKIPPED for balances (FK-safe), but
  //     surfaced by untrackedBalances so it's never silently lost.
  const unknownBal: MappedBalance = {
    assetId: null,
    amountRaw: "42",
    amountDecimal: null,
    decimalsAtRead: 6,
    denom: "ibc/ABCDEF123456",
  };
  check("untracked balance skipped", buildBalanceUpsert("w-1", unknownBal, "t") === null);
  const balSet = [txBal, saraBal, unknownBal];
  check("buildBalanceUpserts keeps only tracked", buildBalanceUpserts("w-1", balSet, "t").length === 2);
  check("untrackedBalances surfaces the one", untrackedBalances(balSet).length === 1);
  check("untrackedBalances denom", untrackedBalances(balSet)[0].denom === "ibc/ABCDEF123456");

  // --- transaction upsert: SIGNED negative TX send → UNSIGNED + direction out,
  //     fee attached, raw payload preserved verbatim.
  const sendLeg: MappedTransaction = {
    txHash: "ABC123",
    eventIndex: 0,
    assetId: "tx",
    chain: "coreum",
    direction: "out",
    txType: "transfer",
    amountRaw: "-5000000",
    amountDecimal: null,
    decimalsAtEvent: 6,
    feeRaw: "5000",
    feeAssetId: "tx",
    counterparty: "core1destination",
    blockNumber: 82238243,
    blockTime: "2026-08-01T12:00:00Z",
    denom: "ucore",
    success: true,
  };
  const envelope = {
    txhash: "ABC123",
    height: "82238243",
    code: 0,
    tx: { body: { messages: [] } },
  };
  const sendRow = buildTransactionUpsert("w-1", sendLeg, envelope);
  check("tx wallet", sendRow.wallet_id === "w-1");
  check("tx hash", sendRow.tx_hash === "ABC123");
  check("tx event_index", sendRow.event_index === 0);
  check("tx UNSIGNED amount", sendRow.amount_raw === "5000000");
  check("tx direction preserved out", sendRow.direction === "out");
  check("tx type", sendRow.tx_type === "transfer");
  check("tx fee unsigned", sendRow.fee_raw === "5000");
  check("tx fee asset", sendRow.fee_asset_id === "tx");
  check("tx usd null (never guessed)", sendRow.usd_value_cents === null);
  check("tx counterparty", sendRow.counterparty === "core1destination");
  check("tx block number", sendRow.block_number === 82238243);
  check("tx block time", sendRow.block_time === "2026-08-01T12:00:00Z");
  check("tx migration null", sendRow.migration_id === null);
  check(
    "tx RAW preserved verbatim",
    JSON.stringify(sendRow.raw) === JSON.stringify(envelope),
  );

  // --- transaction upsert: incoming SARA token → UNSIGNED + direction in, no fee.
  const recvLeg: MappedTransaction = {
    txHash: "DEF456",
    eventIndex: 0,
    assetId: "sara",
    chain: "coreum",
    direction: "in",
    txType: "transfer",
    amountRaw: "1000000",
    amountDecimal: null,
    decimalsAtEvent: 6,
    feeRaw: null,
    feeAssetId: null,
    counterparty: "core1sender",
    blockNumber: 82238244,
    blockTime: "2026-08-01T12:05:00Z",
    denom: "usara-core1r9gc0rnxnzpq33u82f44aufgdwvyxv4wyepyck98m9v2pxua6naqr8h03z",
    success: true,
  };
  const recvRow = buildTransactionUpsert("w-1", recvLeg, { txhash: "DEF456" });
  check("tx sara unsigned amount", recvRow.amount_raw === "1000000");
  check("tx sara no fee", recvRow.fee_raw === null);
  check("tx sara direction in", recvRow.direction === "in");

  // --- transaction upsert: UNTRACKED token leg keeps the note in `raw`.
  const unknownLeg: MappedTransaction = {
    txHash: "GHI789",
    eventIndex: 0,
    assetId: null,
    chain: "coreum",
    direction: "in",
    txType: "transfer",
    amountRaw: "7",
    amountDecimal: null,
    decimalsAtEvent: 6,
    feeRaw: null,
    feeAssetId: null,
    counterparty: "core1who",
    blockNumber: 82238245,
    blockTime: "2026-08-01T12:10:00Z",
    denom: "ibc/SOMETHING",
    success: true,
  };
  const unkRow = buildTransactionUpsert("w-1", unknownLeg, { txhash: "GHI789" });
  const unkRaw = unkRow.raw as { untrackedToken?: { denom: string | null } };
  check("untracked tx kept (not dropped)", unkRow.asset_id === null);
  check("untracked tx note denom", unkRaw.untrackedToken?.denom === "ibc/SOMETHING");

  // --- buildTransactionUpserts maps every leg.
  const legs = buildTransactionUpserts("w-1", [sendLeg, recvLeg], envelope);
  check("buildTransactionUpserts count", legs.length === 2);
  check("buildTransactionUpserts second leg", legs[1].tx_hash === "DEF456");

  // --- backfill state machine: start fresh, walk sender stream, then recipient.
  const s0 = initCoreumBackfill(null, null, false, false);
  check("backfill fresh sender not done", s0.sender.done === false);
  check("backfill fresh recipient not done", s0.recipient.done === false);
  check("backfill fresh not done", s0.done === false);
  check("backfill fresh nextStream sender", nextStream(s0) === "sender");
  check("backfill fresh shouldContinue", shouldContinueBackfill(s0) === true);

  // Walk sender page 1 (has more).
  const s1 = reduceCoreumStream(s0, "sender", "key-sender-2", ["TX001", "TX002"]);
  check("backfill sender page1 pages", s1.sender.pages === 1);
  check("backfill sender page1 keeps key", s1.sender.nextKey === "key-sender-2");
  check("backfill sender page1 not done", s1.sender.done === false);
  check("backfill sender page1 nextStream still sender", nextStream(s1) === "sender");
  check("backfill sender page1 seenHashes has TX001", s1.seenHashes.has("TX001") === true);
  check("backfill sender page1 seenHashes has TX002", s1.seenHashes.has("TX002") === true);

  // Walk sender page 2 (exhausted — no next_key).
  const s2 = reduceCoreumStream(s1, "sender", null, ["TX003"]);
  check("backfill sender page2 done", s2.sender.done === true);
  check("backfill sender page2 key null", s2.sender.nextKey === null);
  check("backfill sender page2 nextStream recipient", nextStream(s2) === "recipient");
  check("backfill sender page2 not fully done", s2.done === false);
  check("backfill sender page2 seenHashes has TX003", s2.seenHashes.has("TX003") === true);

  // Walk recipient page 1 (has more). Before reducing, check duplicates:
  // TX002 was seen from sender, so it's a duplicate. TX004 is new.
  check("backfill dup check TX002 before reduce", isDuplicateHash(s2, "TX002") === true);
  check("backfill dup check TX004 not dup before reduce", isDuplicateHash(s2, "TX004") === false);
  const s3 = reduceCoreumStream(s2, "recipient", "key-recv-2", ["TX002", "TX004"]);
  check("backfill recipient page1 pages", s3.recipient.pages === 1);
  check("backfill recipient page1 keeps key", s3.recipient.nextKey === "key-recv-2");
  check("backfill recipient page1 not done", s3.recipient.done === false);
  check("backfill recipient page1 nextStream recipient", nextStream(s3) === "recipient");
  // After reduce, both TX002 and TX004 are in seenHashes.
  check("backfill recipient page1 seenHashes has TX004", s3.seenHashes.has("TX004") === true);

  // Walk recipient page 2 (exhausted).
  const s4 = reduceCoreumStream(s3, "recipient", null, ["TX005"]);
  check("backfill recipient page2 done", s4.recipient.done === true);
  check("backfill recipient page2 fully done", s4.done === true);
  check("backfill recipient page2 nextStream null", nextStream(s4) === null);
  check("backfill recipient page2 shouldContinue false", shouldContinueBackfill(s4) === false);
  check("backfill seenHashes size 5", s4.seenHashes.size === 5);

  // --- backfill resume: saved cursors continue where we left off.
  const resumed = initCoreumBackfill("key-sender-3", null, false, true);
  check("backfill resume sender key", resumed.sender.nextKey === "key-sender-3");
  check("backfill resume recipient done (null key)", resumed.recipient.done === true);
  check("backfill resume nextStream sender", nextStream(resumed) === "sender");

  // --- page guard trips even if the endpoint keeps handing keys.
  let guard = initCoreumBackfill(null, null, false, false);
  for (let i = 0; i < MAX_COREUM_BACKFILL_PAGES; i += 1) {
    guard = reduceCoreumStream(guard, "sender", "key-" + i, ["TX" + i]);
  }
  check("backfill page guard sender done", guard.sender.done === true);
  check("backfill page guard sender count", guard.sender.pages === MAX_COREUM_BACKFILL_PAGES);
  check("backfill page guard not fully done (recipient still)", guard.done === false);
  // Recipient is still pending, so shouldContinue is true.
  check("backfill page guard shouldContinue true", shouldContinueBackfill(guard) === true);

  // --- cursor (de)serialisation round-trips the two-stream payload.
  check("serializeCursor both done → null", serializeCursor(s4) === null);
  // s3: sender done, recipient mid-stream.
  check("serializeCursor mid-recipient", serializeCursor(s3) === '{"senderKey":null,"recipientKey":"key-recv-2"}');
  // s1: sender mid-stream, recipient not started.
  check("serializeCursor mid-sender", serializeCursor(s1) === '{"senderKey":"key-sender-2","recipientKey":null}');

  const deserialized = deserializeCursor('{"senderKey":"key-s","recipientKey":"key-r"}');
  check("deserializeCursor sender key", deserialized.senderKey === "key-s");
  check("deserializeCursor recipient key", deserialized.recipientKey === "key-r");

  check("deserializeCursor null → both null", deserializeCursor(null).senderKey === null);
  check("deserializeCursor null → both null recipient", deserializeCursor(null).recipientKey === null);
  check("deserializeCursor empty → both null", deserializeCursor("").senderKey === null);
  check("deserializeCursor malformed → both null", deserializeCursor("not-json").senderKey === null);

  // Round-trip: serialize then deserialize.
  const cursorStr = serializeCursor(s1);
  const rt = deserializeCursor(cursorStr);
  check("cursor round-trip sender key", rt.senderKey === "key-sender-2");
  check("cursor round-trip recipient null", rt.recipientKey === null);

  // --- counts + summary.
  let counts = emptyCoreumSyncCounts();
  counts = addCoreumPageCounts(counts, { pages: 1, balancesUpserted: 3, transactionsUpserted: 10 });
  counts = addCoreumPageCounts(counts, { pages: 1, transactionsUpserted: 5, untrackedTransactions: 2, duplicatesSkipped: 3 });
  check("counts pages", counts.pages === 2);
  check("counts balances", counts.balancesUpserted === 3);
  check("counts transactions", counts.transactionsUpserted === 15);
  check("counts untracked tx", counts.untrackedTransactions === 2);
  check("counts duplicates", counts.duplicatesSkipped === 3);
  check("summary mentions counts", summarizeCoreumSync(counts).includes("3 balances"));
  check("summary mentions transactions", summarizeCoreumSync(counts).includes("15 transactions"));
  check("summary mentions duplicates", summarizeCoreumSync(counts).includes("duplicate skipped"));
  check("summary mentions untracked", summarizeCoreumSync(counts).includes("untracked-token"));
  check(
    "summary singular grammar",
    summarizeCoreumSync({ pages: 1, balancesUpserted: 1, transactionsUpserted: 1, untrackedBalances: 0, untrackedTransactions: 0, duplicatesSkipped: 0 }) ===
      "Synced 1 balance, 1 transaction, 1 page.",
  );

  // --- sync-state upsert row (completed backfill).
  const ss = buildSyncStateUpsert({
    walletId: "w-1",
    cursor: null,
    backfillComplete: true,
    syncedAt: "2026-08-11T00:00:00Z",
    status: "idle",
    errorMessage: null,
  });
  check("sync-state wallet", ss.wallet_id === "w-1");
  check("sync-state complete", ss.backfill_complete === true);
  check("sync-state cursor null when walked to end", ss.backfill_cursor === null);
  check("sync-state status idle", ss.status === "idle");
  check("sync-state error null", ss.error_message === null);

  // --- sync-state upsert row (errored mid-backfill keeps the resume cursor).
  const ssErr = buildSyncStateUpsert({
    walletId: "w-1",
    cursor: '{"senderKey":"key-x","recipientKey":null}',
    backfillComplete: false,
    syncedAt: "2026-08-11T00:00:00Z",
    status: "error",
    errorMessage: "rate limited",
  });
  check("sync-state error status", ssErr.status === "error");
  check("sync-state error keeps cursor", ssErr.backfill_cursor === '{"senderKey":"key-x","recipientKey":null}');
  check("sync-state error message", ssErr.error_message === "rate limited");

  console.log("coreum-sync-core self-tests: all passed");
}
