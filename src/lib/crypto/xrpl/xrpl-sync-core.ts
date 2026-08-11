/**
 * src/lib/crypto/xrpl/xrpl-sync-core.ts — PURE XRPL sync brain (Slice C5).
 *
 * No `server-only`, no network, no Supabase, no React. Just the decision logic
 * and the row-builders that turn C4's mapped balances/transactions into the
 * EXACT upsert objects for the crypto_* tables. Keeping this pure lets the
 * self-test battery (which runs under tsx) exercise every rule without a DB.
 *
 * The server layer (xrpl-sync-server.ts) owns the network calls + the writes;
 * it asks this module three things:
 *   1. "Turn these mapped balances into balance-upsert rows."   → buildBalanceUpserts
 *   2. "Turn this mapped tx leg into a transaction-upsert row." → buildTransactionUpsert(s)
 *   3. "Given the last page, what's my next request + am I done?" → the backfill reducer.
 *
 * DESIGN DECISIONS (grounded, never guessed):
 *
 * • SIGNED → UNSIGNED + direction. C4's MappedTransaction carries SIGNED amounts
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
 * • UNTRACKED TOKENS. A trust line / tx leg for a token we don't yet model
 *   (assetId === null) is NOT dropped — we keep the row with a human note of the
 *   decoded currency + issuer in `raw`, so history stays complete and nothing is
 *   silently lost. (Classifying it to a real asset happens in a later slice.)
 *
 * • BACKFILL STATE MACHINE. account_tx is paginated by an opaque `marker`. We
 *   walk oldest→newest (forward=true) applying each page as we go (idempotent, so
 *   safe to resume), persisting the marker as the resumable cursor. Hard page and
 *   empty-page guards stop a misbehaving endpoint from spinning forever.
 */

import type { TxDirection, TxType, Chain } from "../crypto-core";
import { normalizeMinorUnits, normalizeXrplIssuedAmount } from "../crypto-core";
import type { MappedBalance, MappedTransaction } from "./xrpl-map-core";

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

/** Strip the sign from a canonical issued-token decimal string. */
export function unsignDecimal(dec: string | null): string | null {
  if (dec === null) return null;
  const canon = normalizeXrplIssuedAmount(dec); // canonicalises + validates decimal
  return canon.startsWith("-") ? canon.slice(1) : canon;
}

// ---------------------------------------------------------------------------
// A tiny, human-readable "note" object stored in `raw` for balances and for
// untracked-token legs. This is metadata ABOUT the row, never a substitute for
// the real source payload (which we also keep for transactions).
// ---------------------------------------------------------------------------

/** Build the untracked-token note (kept in `raw` so nothing is ever lost). */
export function untrackedTokenNote(
  currency: string | undefined,
  issuer: string | undefined,
): { untrackedToken: { currency: string | null; issuer: string | null } } {
  return {
    untrackedToken: {
      currency: currency ?? null,
      issuer: issuer ?? null,
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
 * existence is not lost: the trust line still shows up in history/among the
 * mapped set, and the untracked currency/issuer is surfaced by the caller. This
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
    amount_decimal: bal.amountDecimal,
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
 *   • fee is only present on the sender's XRP leg (C4 attributes it once).
 *   • `raw` keeps the untouched source envelope — plus, for an untracked token,
 *     a note of its currency/issuer merged in — so the ledger truth is provable
 *     without a re-fetch.
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
    : { ...rawBase, ...untrackedTokenNote(tx.currency, tx.issuer) };

  return {
    wallet_id: walletId,
    asset_id: tx.assetId,
    chain: tx.chain,
    tx_hash: tx.txHash,
    event_index: tx.eventIndex,
    direction: tx.direction,
    tx_type: tx.txType,
    amount_raw: unsignMinor(tx.amountRaw),
    amount_decimal: unsignDecimal(tx.amountDecimal),
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
// Backfill state machine — walks account_tx pages by opaque `marker`.
// ---------------------------------------------------------------------------

/** Hard ceiling so a misbehaving endpoint can't page forever. */
export const MAX_XRPL_BACKFILL_PAGES = 5000;

/** State of an in-progress (or finished) XRPL transaction backfill. */
export type XrplBackfillState = {
  /** Marker to send on the NEXT account_tx request (undefined = first page / done). */
  marker: unknown;
  /** Pages successfully applied so far. */
  pages: number;
  /** True once a page returned no marker — the walk is complete. */
  done: boolean;
};

/**
 * Begin a backfill. A saved marker (resumable cursor) continues where we left
 * off; null/empty starts from the widest ledger range (full history).
 */
export function initXrplBackfill(savedMarker: unknown): XrplBackfillState {
  const marker =
    savedMarker === undefined || savedMarker === null || savedMarker === ""
      ? undefined
      : savedMarker;
  return { marker, pages: 0, done: false };
}

/**
 * Apply the result of ONE account_tx page. `nextMarker` is the page's returned
 * marker (undefined/null when there are no more pages). Increments the page
 * count and flips `done` when the walk is complete or the page guard trips.
 */
export function reduceXrplBackfill(
  state: XrplBackfillState,
  nextMarker: unknown,
): XrplBackfillState {
  const pages = state.pages + 1;
  const noMore = nextMarker === undefined || nextMarker === null;
  const hitGuard = pages >= MAX_XRPL_BACKFILL_PAGES;
  return {
    marker: noMore ? undefined : nextMarker,
    pages,
    done: noMore || hitGuard,
  };
}

/** Should the orchestrator request another page? */
export function shouldContinueBackfill(state: XrplBackfillState): boolean {
  return !state.done;
}

// ---------------------------------------------------------------------------
// Counts + summary — for the sync report + diagnostics.
// ---------------------------------------------------------------------------

export type XrplSyncCounts = {
  pages: number;
  balancesUpserted: number;
  transactionsUpserted: number;
  untrackedBalances: number;
  untrackedTransactions: number;
};

export function emptyXrplSyncCounts(): XrplSyncCounts {
  return {
    pages: 0,
    balancesUpserted: 0,
    transactionsUpserted: 0,
    untrackedBalances: 0,
    untrackedTransactions: 0,
  };
}

/** Fold one page's contributions into the running totals (pure). */
export function addXrplPageCounts(
  base: XrplSyncCounts,
  delta: Partial<XrplSyncCounts>,
): XrplSyncCounts {
  return {
    pages: base.pages + (delta.pages ?? 0),
    balancesUpserted: base.balancesUpserted + (delta.balancesUpserted ?? 0),
    transactionsUpserted: base.transactionsUpserted + (delta.transactionsUpserted ?? 0),
    untrackedBalances: base.untrackedBalances + (delta.untrackedBalances ?? 0),
    untrackedTransactions: base.untrackedTransactions + (delta.untrackedTransactions ?? 0),
  };
}

/** Plain-English one-liner for the sync report. */
export function summarizeXrplSync(counts: XrplSyncCounts): string {
  const txn = counts.transactionsUpserted;
  const bal = counts.balancesUpserted;
  const parts = [
    `${bal} balance${bal === 1 ? "" : "s"}`,
    `${txn} transaction${txn === 1 ? "" : "s"}`,
    `${counts.pages} page${counts.pages === 1 ? "" : "s"}`,
  ];
  let s = `Synced ${parts.join(", ")}.`;
  if (counts.untrackedBalances > 0 || counts.untrackedTransactions > 0) {
    s += ` (${counts.untrackedBalances} untracked-token balance${counts.untrackedBalances === 1 ? "" : "s"}, ${counts.untrackedTransactions} untracked-token transaction${counts.untrackedTransactions === 1 ? "" : "s"} kept for history.)`;
  }
  return s;
}

/**
 * Build the sync-state upsert row for a completed (or errored) run. Backfill is
 * marked complete once the walk finished; the LAST marker we persisted (or null
 * when we walked to the end) is the resumable cursor.
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

/** Serialise an opaque marker for text storage in backfill_cursor. */
export function serializeMarker(marker: unknown): string | null {
  if (marker === undefined || marker === null) return null;
  if (typeof marker === "string") return marker;
  try {
    return JSON.stringify(marker);
  } catch {
    return null;
  }
}

/** Parse a stored marker string back to the value account_tx expects. */
export function deserializeMarker(cursor: string | null): unknown {
  if (cursor === null || cursor.trim() === "") return undefined;
  const s = cursor.trim();
  // Markers are objects ({ledger, seq}) or strings; try JSON, fall back to text.
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run under tsx via run-pure-selftests + vitest mirror).
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`xrpl-sync-core self-test FAILED: ${name}`);
}

export function __runXrplSyncCoreTests(): void {
  // --- unsign helpers: split sign, keep magnitude EXACTLY (big values too).
  check("unsignMinor negative", unsignMinor("-1000000") === "1000000");
  check("unsignMinor positive passthrough", unsignMinor("1000000") === "1000000");
  check("unsignMinor zero", unsignMinor("0") === "0");
  check("unsignMinor null", unsignMinor(null) === null);
  check(
    "unsignMinor huge exact",
    unsignMinor("-123456789012345678901234567890") === "123456789012345678901234567890",
  );
  check("unsignDecimal negative", unsignDecimal("-1234.5") === "1234.5");
  check("unsignDecimal positive", unsignDecimal("1234.5") === "1234.5");
  check("unsignDecimal zero", unsignDecimal("0") === "0");
  check("unsignDecimal null", unsignDecimal(null) === null);

  // --- balance upsert: tracked XRP native balance → row with amount_raw only.
  const xrpBal: MappedBalance = {
    assetId: "xrp",
    amountRaw: "25500000",
    amountDecimal: null,
    decimalsAtRead: 6,
  };
  const xrpRow = buildBalanceUpsert("w-1", xrpBal, "2026-08-11T00:00:00Z");
  check("balance row not null", xrpRow !== null);
  check("balance wallet", xrpRow!.wallet_id === "w-1");
  check("balance asset", xrpRow!.asset_id === "xrp");
  check("balance amount_raw", xrpRow!.amount_raw === "25500000");
  check("balance amount_decimal null", xrpRow!.amount_decimal === null);
  check("balance decimals", xrpRow!.decimals_at_read === 6);
  check("balance usd null (never guessed)", xrpRow!.usd_value_cents === null);
  check("balance updatedAt", xrpRow!.balances_updated_at === "2026-08-11T00:00:00Z");

  // --- balance upsert: tracked SOLO issued balance → amount_decimal only.
  const soloBal: MappedBalance = {
    assetId: "solo",
    amountRaw: null,
    amountDecimal: "1234.567890123456",
    decimalsAtRead: null,
    currency: "SOLO",
    issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
  };
  const soloRow = buildBalanceUpsert("w-1", soloBal, "2026-08-11T00:00:00Z");
  check("solo balance decimal", soloRow!.amount_decimal === "1234.567890123456");
  check("solo balance raw null", soloRow!.amount_raw === null);

  // --- balance upsert: untracked token → SKIPPED for balances (FK-safe), but
  //     surfaced by untrackedBalances so it's never silently lost.
  const unknownBal: MappedBalance = {
    assetId: null,
    amountRaw: null,
    amountDecimal: "42",
    decimalsAtRead: null,
    currency: "FOO",
    issuer: "rFooIssuerXXXXXXXXXXXXXXXXXXXXXXXXX",
  };
  check("untracked balance skipped", buildBalanceUpsert("w-1", unknownBal, "t") === null);
  const set = [xrpBal, soloBal, unknownBal];
  check("buildBalanceUpserts keeps only tracked", buildBalanceUpserts("w-1", set, "t").length === 2);
  check("untrackedBalances surfaces the one", untrackedBalances(set).length === 1);
  check("untrackedBalances currency", untrackedBalances(set)[0].currency === "FOO");

  // --- transaction upsert: SIGNED negative XRP send → UNSIGNED + direction out,
  //     fee attached, raw payload preserved verbatim.
  const sendLeg: MappedTransaction = {
    txHash: "ABC123",
    eventIndex: 0,
    assetId: "xrp",
    chain: "xrpl",
    direction: "out",
    txType: "transfer",
    amountRaw: "-5000000",
    amountDecimal: null,
    decimalsAtEvent: 6,
    feeRaw: "12",
    feeAssetId: "xrp",
    counterparty: "rDestination",
    blockNumber: 80000000,
    blockTime: "2026-08-01T12:00:00Z",
    success: true,
  };
  const envelope = { hash: "ABC123", meta: { TransactionResult: "tesSUCCESS" }, tx_json: { TransactionType: "Payment" } };
  const sendRow = buildTransactionUpsert("w-1", sendLeg, envelope);
  check("tx wallet", sendRow.wallet_id === "w-1");
  check("tx hash", sendRow.tx_hash === "ABC123");
  check("tx event_index", sendRow.event_index === 0);
  check("tx UNSIGNED amount", sendRow.amount_raw === "5000000");
  check("tx direction preserved out", sendRow.direction === "out");
  check("tx type", sendRow.tx_type === "transfer");
  check("tx fee unsigned", sendRow.fee_raw === "12");
  check("tx fee asset", sendRow.fee_asset_id === "xrp");
  check("tx usd null (never guessed)", sendRow.usd_value_cents === null);
  check("tx counterparty", sendRow.counterparty === "rDestination");
  check("tx block time", sendRow.block_time === "2026-08-01T12:00:00Z");
  check("tx migration null", sendRow.migration_id === null);
  check(
    "tx RAW preserved verbatim",
    JSON.stringify(sendRow.raw) === JSON.stringify(envelope),
  );

  // --- transaction upsert: incoming issued token → UNSIGNED decimal + direction in.
  const recvLeg: MappedTransaction = {
    txHash: "DEF456",
    eventIndex: 1,
    assetId: "solo",
    chain: "xrpl",
    direction: "in",
    txType: "transfer",
    amountRaw: null,
    amountDecimal: "100.25",
    decimalsAtEvent: null,
    feeRaw: null,
    feeAssetId: null,
    counterparty: "rSender",
    blockNumber: 80000001,
    blockTime: "2026-08-01T12:05:00Z",
    success: true,
  };
  const recvRow = buildTransactionUpsert("w-1", recvLeg, { hash: "DEF456" });
  check("tx issued unsigned decimal", recvRow.amount_decimal === "100.25");
  check("tx issued no fee", recvRow.fee_raw === null);
  check("tx issued direction in", recvRow.direction === "in");

  // --- transaction upsert: UNTRACKED token leg keeps the note in `raw`.
  const unknownLeg: MappedTransaction = {
    txHash: "GHI789",
    eventIndex: 0,
    assetId: null,
    chain: "xrpl",
    direction: "in",
    txType: "transfer",
    amountRaw: null,
    amountDecimal: "7",
    decimalsAtEvent: null,
    feeRaw: null,
    feeAssetId: null,
    counterparty: "rWho",
    blockNumber: 80000002,
    blockTime: "2026-08-01T12:10:00Z",
    currency: "FOO",
    issuer: "rFooIssuer",
    success: true,
  };
  const unkRow = buildTransactionUpsert("w-1", unknownLeg, { hash: "GHI789" });
  const unkRaw = unkRow.raw as { untrackedToken?: { currency: string | null; issuer: string | null } };
  check("untracked tx kept (not dropped)", unkRow.asset_id === null);
  check("untracked tx note currency", unkRaw.untrackedToken?.currency === "FOO");
  check("untracked tx note issuer", unkRaw.untrackedToken?.issuer === "rFooIssuer");

  // --- buildTransactionUpserts maps every leg.
  const legs = buildTransactionUpserts("w-1", [sendLeg, recvLeg], envelope);
  check("buildTransactionUpserts count", legs.length === 2);
  check("buildTransactionUpserts second leg", legs[1].tx_hash === "DEF456");

  // --- backfill state machine: start fresh, page, then finish (no marker).
  const s0 = initXrplBackfill(null);
  check("backfill fresh marker undefined", s0.marker === undefined);
  check("backfill fresh not done", s0.done === false);
  const s1 = reduceXrplBackfill(s0, { ledger: 100, seq: 5 });
  check("backfill page1 pages", s1.pages === 1);
  check("backfill page1 keeps marker", JSON.stringify(s1.marker) === JSON.stringify({ ledger: 100, seq: 5 }));
  check("backfill page1 continue", shouldContinueBackfill(s1) === true);
  const s2 = reduceXrplBackfill(s1, null);
  check("backfill page2 done", s2.done === true);
  check("backfill page2 marker cleared", s2.marker === undefined);
  check("backfill page2 stop", shouldContinueBackfill(s2) === false);

  // --- backfill resume: a saved marker continues where we left off.
  const resumed = initXrplBackfill({ ledger: 200, seq: 9 });
  check("backfill resume marker", JSON.stringify(resumed.marker) === JSON.stringify({ ledger: 200, seq: 9 }));

  // --- page guard trips even if the endpoint keeps handing markers.
  let guard = initXrplBackfill(null);
  for (let i = 0; i < MAX_XRPL_BACKFILL_PAGES; i += 1) {
    guard = reduceXrplBackfill(guard, { ledger: i, seq: i });
  }
  check("backfill page guard done", guard.done === true);
  check("backfill page guard count", guard.pages === MAX_XRPL_BACKFILL_PAGES);

  // --- marker (de)serialisation round-trips object + string, handles empty.
  check("serializeMarker null", serializeMarker(null) === null);
  check("serializeMarker string", serializeMarker("abc") === "abc");
  check("serializeMarker object", serializeMarker({ ledger: 1, seq: 2 }) === '{"ledger":1,"seq":2}');
  check("deserializeMarker empty → undefined", deserializeMarker("") === undefined);
  check("deserializeMarker null → undefined", deserializeMarker(null) === undefined);
  check("deserializeMarker string", deserializeMarker("abc") === "abc");
  check(
    "deserializeMarker object round-trip",
    JSON.stringify(deserializeMarker('{"ledger":1,"seq":2}')) === JSON.stringify({ ledger: 1, seq: 2 }),
  );

  // --- counts + summary.
  let counts = emptyXrplSyncCounts();
  counts = addXrplPageCounts(counts, { pages: 1, balancesUpserted: 3, transactionsUpserted: 10 });
  counts = addXrplPageCounts(counts, { pages: 1, transactionsUpserted: 5, untrackedTransactions: 2 });
  check("counts pages", counts.pages === 2);
  check("counts balances", counts.balancesUpserted === 3);
  check("counts transactions", counts.transactionsUpserted === 15);
  check("counts untracked tx", counts.untrackedTransactions === 2);
  check("summary mentions counts", summarizeXrplSync(counts).includes("3 balances"));
  check("summary mentions transactions", summarizeXrplSync(counts).includes("15 transactions"));
  check("summary mentions untracked", summarizeXrplSync(counts).includes("untracked-token"));
  check(
    "summary singular grammar",
    summarizeXrplSync({ pages: 1, balancesUpserted: 1, transactionsUpserted: 1, untrackedBalances: 0, untrackedTransactions: 0 }) ===
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
    cursor: '{"ledger":123,"seq":4}',
    backfillComplete: false,
    syncedAt: "2026-08-11T00:00:00Z",
    status: "error",
    errorMessage: "rate limited",
  });
  check("sync-state error status", ssErr.status === "error");
  check("sync-state error keeps cursor", ssErr.backfill_cursor === '{"ledger":123,"seq":4}');
  check("sync-state error message", ssErr.error_message === "rate limited");

  console.log("xrpl-sync-core self-tests: all passed");
}
