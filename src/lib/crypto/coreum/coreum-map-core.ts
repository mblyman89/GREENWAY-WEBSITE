/**
 * src/lib/crypto/coreum/coreum-map-core.ts (C8b)
 *
 * PURE mappers that turn raw Coreum (Cosmos SDK) payloads into the exact,
 * tax-truthful shapes our store uses. This file imports ONLY from crypto-core
 * and coreum-client-core (no `server-only`, no network, no DB) so it runs
 * under `tsx`, `vitest`, and the browser alike, and so the pure self-tests
 * can exercise it.
 *
 * WHY THIS FILE IS THE TAX SAFETY CENTERPIECE OF THE COREUM CONNECTOR
 * -----------------------------------------------------------------
 * On a Cosmos SDK chain, the truth about how much value moved is in the
 * EVENTS, not in the top-level message fields:
 *   - A `MsgSend` says "send 100ucore to X" but a failed tx (code != 0)
 *     moved NOTHING. We must check `code` before recording any movement.
 *   - A `MsgExecuteContract` (DeFi) may move several assets through a router
 *     contract. The `transfer` events in `tx_responses[].events[]` are the
 *     authoritative record of what actually entered or left the tracked
 *     wallet — each has `{sender, recipient, amount}` where amount is
 *     `"{value}{denom}"` (e.g. "400000000ucore").
 *   - The network fee (always in `ucore`) is paid by the SIGNER and must be
 *     attributed to the right side or cost basis is wrong.
 *
 * DeFi classification comes from `wasm` events: the `action` attribute
 * distinguishes swaps, liquidity provision, and withdrawals (verified live
 * against the Pulsara DAX / Astroport AMM on Coreum). This gives Michael's
 * DeFi history the SAME level of treatment as his EVM (Uniswap) and XRPL
 * (DEX) activity — verified, never guessed.
 *
 * EVERY FACT BELOW WAS VERIFIED BY LIVE curl AGAINST THE REAL COREUM MAINNET
 * (2026-08-11). See /workspace/research/c8b-coreum-explorer-research.md.
 */

import {
  type Chain,
  type TxDirection,
  type TxType,
  CRYPTO_ASSETS,
  normalizeMinorUnits,
} from "../crypto-core";
import {
  type CosmosBalanceEntry,
  type CosmosTxResponse,
  type CosmosTx,
  type CosmosFeeAmount,
  type CosmosMessage,
  parseCosmosCoin,
  findEventsByType,
  findEventAttribute,
} from "./coreum-client-core";

// ---------------------------------------------------------------------------
// Verified constants (never guessed)
// ---------------------------------------------------------------------------

/** The chain key these mappers serve. */
export const COREUM_CHAIN: Chain = "coreum";

/** Internal id of the native TX asset in CRYPTO_ASSETS. */
export const COREUM_NATIVE_ASSET_ID = "tx";

/** Internal id of the SARA (Pulsara) token in CRYPTO_ASSETS. */
export const COREUM_SARA_ASSET_ID = "sara";

/** The native coin's base denom (VERIFIED via live denom-metadata API). */
export const COREUM_NATIVE_DENOM = "ucore";

/** SARA (Pulsara) base denom (VERIFIED via live denom-metadata API). */
export const COREUM_SARA_DENOM =
  "usara-core1r9gc0rnxnzpq33u82f44aufgdwvyxv4wyepyck98m9v2pxua6naqr8h03z";

/** Both TX and SARA have 6 decimals (VERIFIED via denom-metadata). */
export const COREUM_DEFAULT_DECIMALS = 6;

/**
 * The Coreum `fee_collector` module account address (VERIFIED LIVE via
 * /cosmos/auth/v1beta1/module_accounts/fee_collector on 2026-08-11).
 *
 * WHY THIS MATTERS FOR TAX CORRECTNESS: on a Cosmos SDK chain the network fee
 * is deducted from the signer and ALSO surfaces as a `transfer` event from the
 * signer to this module account. We capture the fee ONCE via the dedicated
 * `feeRaw` field (from `auth_info.fee.amount`), so we MUST NOT also record the
 * fee-collector transfer as a separate outgoing leg, or the ucore outflow (and
 * therefore cost basis) would be double-counted. This module account address is
 * deterministically derived from the module name and is stable for the chain.
 */
export const COREUM_FEE_COLLECTOR = "core17xpfvakm2amg962yls6f84z3kell8c5lrhmmvx";

// ---------------------------------------------------------------------------
// Denom → asset resolution
// ---------------------------------------------------------------------------

/**
 * Build a map from Cosmos base denom → asset id, for all Coreum assets in
 * CRYPTO_ASSETS that have a `denom` field. This is the authoritative
 * resolution: we match by the FULL base denom string, never by symbol alone
 * (there are TWO tokens with symbol "SARA" on Coreum; only the full denom
 * is unambiguous).
 */
export function buildDenomToAssetIdMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of CRYPTO_ASSETS) {
    if (asset.chain === "coreum" && typeof asset.denom === "string" && asset.denom.length > 0) {
      map.set(asset.denom, asset.id);
    }
  }
  return map;
}

/**
 * Resolve a Cosmos base denom to our internal asset id. Returns null for
 * untracked denoms (we keep the balance/leg for history, never drop it).
 * Matching is by the FULL base denom string (never symbol alone).
 */
export function resolveCoreumAssetId(denom: string): string | null {
  if (typeof denom !== "string" || denom.length === 0) return null;
  const map = buildDenomToAssetIdMap();
  return map.get(denom) ?? null;
}

/**
 * Get the decimals for a denom. For known assets (tx, sara), returns the
 * verified value (6). For unknown denoms, returns the Coreum convention
 * default (6) — this is marked as "denom-convention" in the caller.
 */
export function denomDecimals(denom: string): number {
  const assetId = resolveCoreumAssetId(denom);
  if (assetId !== null) {
    for (const asset of CRYPTO_ASSETS) {
      if (asset.id === assetId && typeof asset.decimals === "number") {
        return asset.decimals;
      }
    }
  }
  return COREUM_DEFAULT_DECIMALS;
}

// ---------------------------------------------------------------------------
// Mapped types (same shape as XRPL/EVM mappers for consistency)
// ---------------------------------------------------------------------------

/** A mapped balance from the LCD balances endpoint. */
export type MappedBalance = {
  assetId: string | null;
  /** Integer minor units (Cosmos amounts are always integer strings). */
  amountRaw: string;
  /** Always null for Cosmos (integer model, no decimal strings). */
  amountDecimal: null;
  decimalsAtRead: number;
  /** The raw denom for display / untracked tokens. */
  denom: string;
};

/** A mapped transaction leg from the LCD tx query. */
export type MappedTransaction = {
  txHash: string;
  eventIndex: number;
  assetId: string | null;
  chain: Chain;
  direction: TxDirection;
  txType: TxType;
  /** SIGNED integer minor units — negative = value left the wallet. */
  amountRaw: string;
  /** Always null for Cosmos (integer model). */
  amountDecimal: null;
  decimalsAtEvent: number;
  /** Network fee in ucore minor units (only when the wallet is the signer). */
  feeRaw: string | null;
  feeAssetId: string | null;
  counterparty: string | null;
  blockNumber: number | null;
  blockTime: string | null;
  /** The raw denom for display / untracked tokens. */
  denom: string;
  /** Whether the transaction succeeded on-ledger (code === 0). */
  success: boolean;
};

// ---------------------------------------------------------------------------
// Balance mapping
// ---------------------------------------------------------------------------

/**
 * Map ONE LCD balance entry to a MappedBalance. The denom is resolved to an
 * asset id (or null for untracked tokens, which are kept for completeness).
 */
export function mapBalanceEntry(entry: CosmosBalanceEntry): MappedBalance {
  const denom = entry.denom;
  const assetId = resolveCoreumAssetId(denom);
  const decimals = denomDecimals(denom);
  return {
    assetId,
    amountRaw: normalizeMinorUnits(entry.amount),
    amountDecimal: null,
    decimalsAtRead: decimals,
    denom,
  };
}

/**
 * Map an array of LCD balance entries to MappedBalance[]. Each entry is
 * mapped independently. Zero-amount balances are kept (the wallet held the
 * token at some point; the balance may become nonzero later).
 */
export function mapBalances(entries: CosmosBalanceEntry[]): MappedBalance[] {
  return entries.map(mapBalanceEntry);
}

/**
 * Filter out balances with zero amount (optional; the caller decides whether
 * to persist zero balances). Returns a new array.
 */
export function filterNonZeroBalances(balances: MappedBalance[]): MappedBalance[] {
  return balances.filter((b) => b.amountRaw !== "0");
}

// ---------------------------------------------------------------------------
// Transaction classification
// ---------------------------------------------------------------------------

/** Known wasm action values from Pulsara DAX (VERIFIED live). */
export const WASM_ACTION_SWAP = "swap";
export const WASM_ACTION_PROVIDE_LIQUIDITY = "provide_liquidity";
export const WASM_ACTION_WITHDRAW_LIQUIDITY = "withdraw_liquidity";

/** Known Cosmos message type URLs (the @type field in decoded messages). */
export const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
export const MSG_EXECUTE_CONTRACT = "/cosmwasm.wasm.v1.MsgExecuteContract";
export const MSG_WITHDRAW_REWARD = "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward";
export const MSG_DELEGATE = "/cosmos.staking.v1beta1.MsgDelegate";
export const MSG_UNDELEGATE = "/cosmos.staking.v1beta1.MsgUndelegate";
export const MSG_REDELEGATE = "/cosmos.staking.v1beta1.MsgBeginRedelegate";

/**
 * Collect every `action` attribute value across ALL `wasm` events in a tx.
 * A DeFi tx can emit several wasm events (router + pair + token contracts);
 * scanning all of them lets us find the real DeFi action even when a wrapper
 * contract's action is emitted first. Returns [] when there are no wasm events.
 */
export function collectWasmActions(txResponse: CosmosTxResponse): string[] {
  const wasmEvents = findEventsByType(txResponse, "wasm");
  const actions: string[] = [];
  for (const ev of wasmEvents) {
    const action = findEventAttribute(ev, "action");
    if (typeof action === "string" && action.length > 0) actions.push(action);
  }
  return actions;
}

/**
 * Classify a Coreum transaction into our tax taxonomy. This inspects the
 * `wasm` events for DeFi action attributes and the decoded message types.
 *
 * Classification priority (verified against live Pulsara DAX activity):
 *   1. wasm.action = "provide_liquidity" → lp_add
 *   2. wasm.action = "withdraw_liquidity" → lp_remove
 *   3. wasm.action = "swap" → swap
 *   4. MsgWithdrawDelegatorReward → reward
 *   5. MsgDelegate / MsgUndelegate / MsgBeginRedelegate → other (staking, not
 *      a disposal; the value doesn't leave the wallet, it's delegated)
 *   6. Default → transfer (safe default; never guesses a richer type)
 *
 * @param txResponse The tx_response (contains events).
 * @param messages The decoded messages from txs[].body.messages[].
 * @returns A TxType, never undefined.
 */
export function classifyCoreumTx(
  txResponse: CosmosTxResponse,
  messages: CosmosMessage[],
): TxType {
  // Check wasm events for DeFi actions (highest priority). A single DeFi tx can
  // emit MULTIPLE wasm events (e.g. a router wrapping a pair contract), so we
  // scan ALL of them and match against the known actions rather than only the
  // first event — otherwise a router-level action on wasm event #0 could mask
  // the real swap/lp action on a later event. LP provision/withdrawal takes
  // priority over swap when both appear (a zap can emit both).
  const wasmActions = collectWasmActions(txResponse);
  if (wasmActions.includes(WASM_ACTION_PROVIDE_LIQUIDITY)) return "lp_add";
  if (wasmActions.includes(WASM_ACTION_WITHDRAW_LIQUIDITY)) return "lp_remove";
  if (wasmActions.includes(WASM_ACTION_SWAP)) return "swap";

  // Check decoded message types for staking/rewards.
  const msgTypes = messages.map((m) => m["@type"]).filter((t): t is string => typeof t === "string");
  if (msgTypes.includes(MSG_WITHDRAW_REWARD)) return "reward";
  // Staking operations are not disposals; classify as "other" (the delegation
  // amount is tracked as a transfer leg if it moved, but the tx type is "other"
  // since it's not a taxable event per se).
  if (
    msgTypes.includes(MSG_DELEGATE) ||
    msgTypes.includes(MSG_UNDELEGATE) ||
    msgTypes.includes(MSG_REDELEGATE)
  ) {
    // If there are also transfer events (reward withdrawal often accompanies
    // undelegation), the legs will still be recorded. The tx type "other" is
    // the safe classification for staking operations.
    return "other";
  }

  // Default: transfer. This covers MsgSend and any other value-movement tx
  // that we can't specifically identify as DeFi or staking.
  return "transfer";
}

// ---------------------------------------------------------------------------
// Fee extraction
// ---------------------------------------------------------------------------

/**
 * Extract the network fee from a decoded tx's auth_info.fee.amount[].
 * The fee is always in ucore (the native gas token). Returns null if no fee
 * or the shape is unexpected.
 */
export function extractFee(tx: CosmosTx): CosmosFeeAmount | null {
  const feeAmounts = tx.auth_info?.fee?.amount;
  if (!Array.isArray(feeAmounts) || feeAmounts.length === 0) return null;
  // The fee is typically a single entry in ucore. If there are multiple,
  // prefer the ucore entry (the gas token). Otherwise take the first.
  const ucoreEntry = feeAmounts.find((a) => a.denom === COREUM_NATIVE_DENOM);
  if (ucoreEntry) return ucoreEntry;
  return feeAmounts[0] ?? null;
}

/**
 * The fee amount as a canonical integer minor-units string, or null.
 */
export function feeAmountRaw(tx: CosmosTx): string | null {
  const fee = extractFee(tx);
  if (!fee || typeof fee.amount !== "string") return null;
  try {
    return normalizeMinorUnits(fee.amount);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transfer event → leg extraction
// ---------------------------------------------------------------------------

/**
 * A single transfer leg extracted from a `transfer` event, from the
 * perspective of the tracked wallet. `isOutgoing` is true when the wallet
 * is the sender; `isIncoming` is true when the wallet is the recipient.
 * Both can be true (self-transfer).
 */
export type TransferLeg = {
  denom: string;
  amount: string; // unsigned integer minor units
  isOutgoing: boolean;
  isIncoming: boolean;
  counterparty: string | null;
};

/**
 * Extract transfer legs from a tx_response's events, from the perspective of
 * the tracked wallet address. Each `transfer` event has {sender, recipient,
 * amount}. We create a leg for each event where the wallet is either the
 * sender or the recipient (or both). The amount may be a comma-separated list
 * of coins (e.g. "400000000ucore,233602426umart-..."); each coin becomes a
 * separate leg.
 *
 * Returns an empty array if the wallet is neither sender nor recipient of
 * any transfer event.
 */
export function extractTransferLegs(
  txResponse: CosmosTxResponse,
  walletAddress: string,
): TransferLeg[] {
  const wallet = (walletAddress ?? "").trim();
  if (wallet.length === 0) return [];

  const transferEvents = findEventsByType(txResponse, "transfer");
  const legs: TransferLeg[] = [];

  for (const ev of transferEvents) {
    const sender = findEventAttribute(ev, "sender");
    const recipient = findEventAttribute(ev, "recipient");
    const amountStr = findEventAttribute(ev, "amount");

    if (!sender || !recipient || !amountStr) continue;

    const isOutgoing = sender === wallet;
    const isIncoming = recipient === wallet;
    if (!isOutgoing && !isIncoming) continue;

    // Skip the fee-payment transfer: on Cosmos the network fee is deducted from
    // the signer AND emitted as a `transfer` event from the wallet to the
    // fee_collector module account. We already capture that fee exactly once via
    // the dedicated `feeRaw` field (from auth_info.fee.amount), so recording this
    // transfer as a separate outgoing leg would double-count the ucore outflow
    // and corrupt cost basis. Only skip when the WALLET is the sender (paying its
    // own fee); an unrelated inbound transfer from the collector is not skipped.
    if (isOutgoing && recipient === COREUM_FEE_COLLECTOR) continue;

    // The counterparty is the other party (or null for self-transfers).
    let counterparty: string | null = null;
    if (isOutgoing && !isIncoming) counterparty = recipient;
    else if (isIncoming && !isOutgoing) counterparty = sender;
    // If both (self-transfer), counterparty stays null.

    // The amount may be a comma-separated list of coins.
    const coinParts = amountStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const coinStr of coinParts) {
      const coin = parseCosmosCoin(coinStr);
      if (!coin) continue;
      try {
        const canon = normalizeMinorUnits(coin.amount);
        legs.push({
          denom: coin.denom,
          amount: canon,
          isOutgoing,
          isIncoming,
          counterparty,
        });
      } catch {
        // Skip malformed amounts (never guesses).
      }
    }
  }

  return legs;
}

// ---------------------------------------------------------------------------
// Transaction mapping (tx_response + decoded tx → MappedTransaction legs)
// ---------------------------------------------------------------------------

/**
 * Map a single Cosmos tx (tx_response + decoded tx) into zero or more
 * MappedTransaction legs, from the tracked wallet's perspective.
 *
 * ONE leg per (denom, direction) pair that moved via `transfer` events.
 * The network fee is attributed once (to the first ucore leg when the wallet
 * is the signer). If nothing moved but a fee was paid, a fee-only leg is
 * created so the outflow is never lost.
 *
 * Returns [] for a tx that did not involve the tracked wallet at all.
 */
export function mapCosmosTx(
  walletAddress: string,
  txResponse: CosmosTxResponse,
  tx: CosmosTx,
): MappedTransaction[] {
  const wallet = (walletAddress ?? "").trim();
  const txHash = txResponse.txhash ?? "";
  const height = txResponse.height ?? null;
  const timestamp = txResponse.timestamp ?? null;
  const code = txResponse.code ?? 0;
  const success = code === 0;

  const blockNumber = height !== null ? safeParseInt(height) : null;
  const blockTime = timestamp;

  // Determine if the wallet is the signer (sender of the first message).
  const messages = tx.body?.messages ?? [];
  const signerAddress = extractSigner(messages);
  const isSigner = signerAddress !== null && signerAddress === wallet;

  // Fee (only attributed when the wallet is the signer).
  const feeRaw = isSigner ? feeAmountRaw(tx) : null;
  const feeAssetId = feeRaw !== null && feeRaw !== "0" ? COREUM_NATIVE_ASSET_ID : null;

  // Classify the tx type.
  const txType = classifyCoreumTx(txResponse, messages);

  // Extract transfer legs (only from successful txs; failed txs moved nothing).
  const transferLegs = success ? extractTransferLegs(txResponse, wallet) : [];

  const legs: MappedTransaction[] = [];
  let eventIndex = 0;
  let feeAttached = false;

  for (const leg of transferLegs) {
    // Determine direction and signed amount.
    let direction: TxDirection;
    let signedAmount: string;
    if (leg.isOutgoing && leg.isIncoming) {
      direction = "self";
      signedAmount = leg.amount; // self-transfer: record as positive (it stayed)
    } else if (leg.isOutgoing) {
      direction = "out";
      signedAmount = "-" + leg.amount;
    } else {
      direction = "in";
      signedAmount = leg.amount;
    }

    const assetId = resolveCoreumAssetId(leg.denom);
    const decimals = denomDecimals(leg.denom);

    // Attach the fee to the first ucore outgoing leg (or any first leg if no
    // ucore leg exists). Only once per tx.
    const attachFee = !feeAttached && feeRaw !== null && feeRaw !== "0";
    if (attachFee) {
      // Prefer attaching to a ucore leg; otherwise the first leg.
      if (leg.denom === COREUM_NATIVE_DENOM || legs.length === 0) {
        feeAttached = true;
      }
    }
    const legFeeRaw = attachFee && feeAttached ? feeRaw : null;
    const legFeeAssetId = legFeeRaw !== null ? feeAssetId : null;

    legs.push({
      txHash,
      eventIndex: eventIndex++,
      assetId,
      chain: COREUM_CHAIN,
      direction,
      txType,
      amountRaw: signedAmount,
      amountDecimal: null,
      decimalsAtEvent: decimals,
      feeRaw: legFeeRaw,
      feeAssetId: legFeeAssetId,
      counterparty: leg.counterparty,
      blockNumber,
      blockTime,
      denom: leg.denom,
      success,
    });
  }

  // If nothing moved but the wallet paid a fee (e.g. a failed tx, a staking
  // operation, or a contract call that only burned gas), record a fee-only leg
  // so the ucore outflow is never lost.
  if (legs.length === 0 && isSigner && feeRaw !== null && feeRaw !== "0") {
    legs.push({
      txHash,
      eventIndex: 0,
      assetId: COREUM_NATIVE_ASSET_ID,
      chain: COREUM_CHAIN,
      direction: "out",
      txType: success ? txType : "fee",
      amountRaw: "-" + feeRaw,
      amountDecimal: null,
      decimalsAtEvent: COREUM_DEFAULT_DECIMALS,
      feeRaw,
      feeAssetId: COREUM_NATIVE_ASSET_ID,
      counterparty: null,
      blockNumber,
      blockTime,
      denom: COREUM_NATIVE_DENOM,
      success,
    });
  }

  return legs;
}

/**
 * Extract the signer address from the first decoded message. The signer is
 * typically `sender`, `from_address`, or `delegator_address` depending on the
 * message type. Returns null if not found.
 */
export function extractSigner(messages: CosmosMessage[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const msg = messages[0];
  if (!msg || typeof msg !== "object") return null;
  // Common signer field names across Cosmos message types.
  const senderFields = ["sender", "from_address", "delegator_address", "signer"];
  for (const field of senderFields) {
    const val = (msg as Record<string, unknown>)[field];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deduplication + sorting
// ---------------------------------------------------------------------------

/**
 * Deduplicate tx_responses by txhash. When running both the sender and
 * recipient queries, the same tx may appear in both (e.g. a self-transfer
 * or a tx where the wallet both sends and receives). We keep the first
 * occurrence (they're identical). Returns a new array.
 */
export function dedupTxResponses(responses: CosmosTxResponse[]): CosmosTxResponse[] {
  const seen = new Set<string>();
  const result: CosmosTxResponse[] = [];
  for (const r of responses) {
    const hash = r.txhash ?? "";
    if (hash.length === 0) {
      result.push(r); // keep txs without a hash (shouldn't happen)
      continue;
    }
    if (seen.has(hash)) continue;
    seen.add(hash);
    result.push(r);
  }
  return result;
}

/**
 * Sort tx_responses ascending by block height (oldest first). This is the
 * natural backfill order. Heights are strings; we parse them as BigInt for
 * correct numeric ordering. Returns a new array (does not mutate input).
 */
export function sortTxResponsesByHeight(responses: CosmosTxResponse[]): CosmosTxResponse[] {
  return [...responses].sort((a, b) => {
    const ha = a.height ?? "0";
    const hb = b.height ?? "0";
    try {
      return BigInt(ha) < BigInt(hb) ? -1 : BigInt(ha) > BigInt(hb) ? 1 : 0;
    } catch {
      // Fallback to string comparison if parse fails.
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a string to an integer. Returns null on failure. */
function safeParseInt(s: string): number | null {
  try {
    const n = Number(BigInt(s));
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

/** Direction from a signed amount string: negative=out, positive=in, 0=self. */
export function directionOf(signed: string): TxDirection {
  const s = signed.trim();
  if (s.startsWith("-")) return "out";
  if (s === "0") return "self";
  return "in";
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`coreum-map-core self-test FAILED: ${name}`);
}

export function __runCoreumMapCoreTests(): void {
  // --- denom → asset resolution ---
  check("resolve ucore → tx", resolveCoreumAssetId("ucore") === "tx");
  check("resolve sara denom → sara", resolveCoreumAssetId(COREUM_SARA_DENOM) === "sara");
  check("resolve unknown → null", resolveCoreumAssetId("ibc/ABC123") === null);
  check("resolve empty → null", resolveCoreumAssetId("") === null);
  check("resolve wrong sara → null", resolveCoreumAssetId("usara-core10fqusDIFFERENT") === null);

  // --- decimals ---
  check("ucore decimals 6", denomDecimals("ucore") === 6);
  check("sara decimals 6", denomDecimals(COREUM_SARA_DENOM) === 6);
  check("unknown default 6", denomDecimals("ibc/ABC") === 6);

  // --- balance mapping ---
  const balEntry: CosmosBalanceEntry = { denom: "ucore", amount: "1160717368" };
  const mapped = mapBalanceEntry(balEntry);
  check("balance assetId", mapped.assetId === "tx");
  check("balance amountRaw", mapped.amountRaw === "1160717368");
  check("balance amountDecimal null", mapped.amountDecimal === null);
  check("balance decimals 6", mapped.decimalsAtRead === 6);
  check("balance denom", mapped.denom === "ucore");

  const saraEntry: CosmosBalanceEntry = { denom: COREUM_SARA_DENOM, amount: "100000000" };
  const saraMapped = mapBalanceEntry(saraEntry);
  check("sara balance assetId", saraMapped.assetId === "sara");
  check("sara balance amountRaw", saraMapped.amountRaw === "100000000");

  const unknownEntry: CosmosBalanceEntry = { denom: "ibc/ABC123", amount: "500" };
  const unknownMapped = mapBalanceEntry(unknownEntry);
  check("unknown balance assetId null", unknownMapped.assetId === null);
  check("unknown balance denom kept", unknownMapped.denom === "ibc/ABC123");

  // mapBalances array
  const allBalances = mapBalances([balEntry, saraEntry, unknownEntry]);
  check("mapBalances count", allBalances.length === 3);

  // filterNonZeroBalances
  const withZero: CosmosBalanceEntry[] = [
    { denom: "ucore", amount: "100" },
    { denom: "ibc/ABC", amount: "0" },
    { denom: COREUM_SARA_DENOM, amount: "200" },
  ];
  const mappedWithZero = mapBalances(withZero);
  const nonZero = filterNonZeroBalances(mappedWithZero);
  check("filter non-zero count", nonZero.length === 2);
  check("filter non-zero keeps ucore", nonZero[0].denom === "ucore");
  check("filter non-zero keeps sara", nonZero[1].denom === COREUM_SARA_DENOM);

  // --- classification ---
  const swapTxResp: CosmosTxResponse = {
    events: [
      { type: "wasm", attributes: [{ key: "action", value: "swap" }] },
    ],
  };
  check("classify swap", classifyCoreumTx(swapTxResp, []) === "swap");

  const lpAddTxResp: CosmosTxResponse = {
    events: [
      { type: "wasm", attributes: [{ key: "action", value: "provide_liquidity" }] },
    ],
  };
  check("classify lp_add", classifyCoreumTx(lpAddTxResp, []) === "lp_add");

  const lpRemoveTxResp: CosmosTxResponse = {
    events: [
      { type: "wasm", attributes: [{ key: "action", value: "withdraw_liquidity" }] },
    ],
  };
  check("classify lp_remove", classifyCoreumTx(lpRemoveTxResp, []) === "lp_remove");

  const rewardTxResp: CosmosTxResponse = { events: [] };
  const rewardMsgs: CosmosMessage[] = [{ "@type": MSG_WITHDRAW_REWARD }];
  check("classify reward", classifyCoreumTx(rewardTxResp, rewardMsgs) === "reward");

  const delegateMsgs: CosmosMessage[] = [{ "@type": MSG_DELEGATE }];
  check("classify delegate → other", classifyCoreumTx({ events: [] }, delegateMsgs) === "other");

  const sendMsgs: CosmosMessage[] = [{ "@type": MSG_SEND }];
  check("classify send → transfer", classifyCoreumTx({ events: [] }, sendMsgs) === "transfer");

  // No messages, no events → transfer (safe default)
  check("classify empty → transfer", classifyCoreumTx({ events: [] }, []) === "transfer");

  // Wasm action takes priority over message type
  const swapWithSendMsg: CosmosTxResponse = {
    events: [{ type: "wasm", attributes: [{ key: "action", value: "swap" }] }],
  };
  check("classify wasm priority over msg", classifyCoreumTx(swapWithSendMsg, sendMsgs) === "swap");

  // Multi-wasm-event: a router action on event #0 must NOT mask the real swap
  // action on a later wasm event (verified pattern for multi-hop DeFi routers).
  const multiWasmSwap: CosmosTxResponse = {
    events: [
      { type: "wasm", attributes: [{ key: "action", value: "execute_swap_operations" }] },
      { type: "wasm", attributes: [{ key: "action", value: "swap" }] },
    ],
  };
  check("classify multi-wasm swap found", classifyCoreumTx(multiWasmSwap, []) === "swap");
  // LP provision takes priority over swap when a zap emits both.
  const zapWasm: CosmosTxResponse = {
    events: [
      { type: "wasm", attributes: [{ key: "action", value: "swap" }] },
      { type: "wasm", attributes: [{ key: "action", value: "provide_liquidity" }] },
    ],
  };
  check("classify zap lp priority", classifyCoreumTx(zapWasm, []) === "lp_add");
  // collectWasmActions helper directly.
  check("collectWasmActions count", collectWasmActions(multiWasmSwap).length === 2);
  check("collectWasmActions empty", collectWasmActions({ events: [] }).length === 0);

  // --- fee extraction ---
  const txWithFee: CosmosTx = {
    auth_info: {
      fee: {
        amount: [{ denom: "ucore", amount: "32256" }],
        gas_limit: "271600",
      },
    },
  };
  check("extract fee amount", extractFee(txWithFee)?.amount === "32256");
  check("extract fee denom", extractFee(txWithFee)?.denom === "ucore");
  check("fee amount raw", feeAmountRaw(txWithFee) === "32256");

  const txNoFee: CosmosTx = { auth_info: { fee: { amount: [] } } };
  check("extract no fee", extractFee(txNoFee) === null);
  check("fee amount raw null", feeAmountRaw(txNoFee) === null);

  const txNoAuthInfo: CosmosTx = {};
  check("extract fee no auth_info", extractFee(txNoAuthInfo) === null);

  // --- transfer leg extraction ---
  const walletAddr = "core1f8u46xpl2nl6f68syqd7swj57c6l8m3s344w2t";
  const outgoingTxResp: CosmosTxResponse = {
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1recipientaddr000000000000000000000000000" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "32256ucore" },
        ],
      },
    ],
  };
  const outgoingLegs = extractTransferLegs(outgoingTxResp, walletAddr);
  check("outgoing legs count", outgoingLegs.length === 1);
  check("outgoing leg isOutgoing", outgoingLegs[0].isOutgoing === true);
  check("outgoing leg isIncoming false", outgoingLegs[0].isIncoming === false);
  check("outgoing leg denom", outgoingLegs[0].denom === "ucore");
  check("outgoing leg amount", outgoingLegs[0].amount === "32256");
  check("outgoing leg counterparty", outgoingLegs[0].counterparty === "core1recipientaddr000000000000000000000000000");

  // incoming transfer
  const incomingTxResp: CosmosTxResponse = {
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: walletAddr },
          { key: "sender", value: "core1other" },
          { key: "amount", value: "5000000" + COREUM_SARA_DENOM },
        ],
      },
    ],
  };
  const incomingLegs = extractTransferLegs(incomingTxResp, walletAddr);
  check("incoming legs count", incomingLegs.length === 1);
  check("incoming leg isOutgoing false", incomingLegs[0].isOutgoing === false);
  check("incoming leg isIncoming", incomingLegs[0].isIncoming === true);
  check("incoming leg counterparty", incomingLegs[0].counterparty === "core1other");

  // self-transfer (wallet is both sender and recipient)
  const selfTxResp: CosmosTxResponse = {
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: walletAddr },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "100ucore" },
        ],
      },
    ],
  };
  const selfLegs = extractTransferLegs(selfTxResp, walletAddr);
  check("self-transfer legs count", selfLegs.length === 1);
  check("self-transfer isOutgoing", selfLegs[0].isOutgoing === true);
  check("self-transfer isIncoming", selfLegs[0].isIncoming === true);
  check("self-transfer counterparty null", selfLegs[0].counterparty === null);

  // multi-coin transfer (comma-separated amount)
  const multiCoinTxResp: CosmosTxResponse = {
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1other" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "400000000ucore,233602426umart-core1abc" },
        ],
      },
    ],
  };
  const multiLegs = extractTransferLegs(multiCoinTxResp, walletAddr);
  check("multi-coin legs count", multiLegs.length === 2);
  check("multi-coin first denom", multiLegs[0].denom === "ucore");
  check("multi-coin first amount", multiLegs[0].amount === "400000000");
  check("multi-coin second denom", multiLegs[1].denom === "umart-core1abc");

  // wallet not involved
  const unrelatedTxResp: CosmosTxResponse = {
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1someone" },
          { key: "sender", value: "core1else" },
          { key: "amount", value: "100ucore" },
        ],
      },
    ],
  };
  check("unrelated legs empty", extractTransferLegs(unrelatedTxResp, walletAddr).length === 0);

  // --- full tx mapping ---
  const fullTxResp: CosmosTxResponse = {
    txhash: "ABCDEF123456",
    height: "82238241",
    timestamp: "2026-08-07T12:01:04Z",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1recipient" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "5000000ucore" },
        ],
      },
      {
        type: "message",
        attributes: [
          { key: "action", value: "/cosmos.bank.v1beta1.MsgSend" },
          { key: "sender", value: walletAddr },
        ],
      },
    ],
  };
  const fullTx: CosmosTx = {
    body: {
      messages: [
        {
          "@type": MSG_SEND,
          from_address: walletAddr,
          to_address: "core1recipient",
          amount: [{ denom: "ucore", amount: "5000000" }],
        },
      ],
    },
    auth_info: {
      fee: {
        amount: [{ denom: "ucore", amount: "16975" }],
        gas_limit: "271600",
      },
    },
  };
  const mappedLegs = mapCosmosTx(walletAddr, fullTxResp, fullTx);
  check("full tx legs count", mappedLegs.length === 1);
  check("full tx hash", mappedLegs[0].txHash === "ABCDEF123456");
  check("full tx direction out", mappedLegs[0].direction === "out");
  check("full tx amountRaw negative", mappedLegs[0].amountRaw === "-5000000");
  check("full tx assetId tx", mappedLegs[0].assetId === "tx");
  check("full tx chain coreum", mappedLegs[0].chain === "coreum");
  check("full tx txType transfer", mappedLegs[0].txType === "transfer");
  check("full tx blockNumber", mappedLegs[0].blockNumber === 82238241);
  check("full tx blockTime", mappedLegs[0].blockTime === "2026-08-07T12:01:04Z");
  check("full tx success", mappedLegs[0].success === true);
  check("full tx fee attached", mappedLegs[0].feeRaw === "16975");
  check("full tx fee assetId", mappedLegs[0].feeAssetId === "tx");
  check("full tx counterparty", mappedLegs[0].counterparty === "core1recipient");

  // --- failed tx (code != 0) produces no transfer legs, only fee ---
  const failedTxResp: CosmosTxResponse = {
    txhash: "FAILED123",
    height: "82238242",
    timestamp: "2026-08-07T12:02:04Z",
    code: 5,
    events: [],
  };
  const failedLegs = mapCosmosTx(walletAddr, failedTxResp, fullTx);
  check("failed tx no transfer legs", failedLegs.length === 1);
  check("failed tx is fee-only", failedLegs[0].txType === "fee");
  check("failed tx direction out", failedLegs[0].direction === "out");
  check("failed tx amountRaw is fee", failedLegs[0].amountRaw === "-16975");
  check("failed tx not success", failedLegs[0].success === false);

  // --- DeFi swap tx mapping ---
  const swapTxRespFull: CosmosTxResponse = {
    txhash: "SWAP123",
    height: "82238243",
    timestamp: "2026-08-07T12:03:04Z",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1pool" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "1000000" + COREUM_SARA_DENOM },
        ],
      },
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: walletAddr },
          { key: "sender", value: "core1pool" },
          { key: "amount", value: "80740867ucore" },
        ],
      },
      {
        type: "wasm",
        attributes: [
          { key: "action", value: "swap" },
          { key: "offer_asset", value: COREUM_SARA_DENOM },
          { key: "ask_asset", value: "ucore" },
        ],
      },
    ],
  };
  const swapTx: CosmosTx = {
    body: {
      messages: [
        {
          "@type": MSG_EXECUTE_CONTRACT,
          sender: walletAddr,
          contract: "core1router",
          msg: { execute_swap_operations: { offer_amount: "1000000" } },
          funds: [{ denom: COREUM_SARA_DENOM, amount: "1000000" }],
        },
      ],
    },
    auth_info: {
      fee: { amount: [{ denom: "ucore", amount: "5000" }] },
    },
  };
  const swapLegs = mapCosmosTx(walletAddr, swapTxRespFull, swapTx);
  check("swap tx legs count", swapLegs.length === 2);
  check("swap tx type swap", swapLegs[0].txType === "swap");
  check("swap tx type swap leg2", swapLegs[1].txType === "swap");
  // First leg: outgoing SARA
  check("swap leg1 direction out", swapLegs[0].direction === "out");
  check("swap leg1 amountRaw negative", swapLegs[0].amountRaw === "-1000000");
  check("swap leg1 assetId sara", swapLegs[0].assetId === "sara");
  // Second leg: incoming ucore
  check("swap leg2 direction in", swapLegs[1].direction === "in");
  check("swap leg2 amountRaw positive", swapLegs[1].amountRaw === "80740867");
  check("swap leg2 assetId tx", swapLegs[1].assetId === "tx");
  // Fee attached to first leg
  check("swap leg1 has fee", swapLegs[0].feeRaw === "5000");
  check("swap leg2 no fee", swapLegs[1].feeRaw === null);

  // --- REGRESSION: fee_collector transfer must NOT double-count the fee ---
  // On a real Cosmos SDK chain the network fee is deducted from the signer AND
  // emitted as a `transfer` event from the wallet to the fee_collector module
  // account. This fixture mirrors the REAL live swap
  // 8C9F4B1B...511FD (verified 2026-08-11): a fee of 43090ucore appears both in
  // auth_info.fee.amount AND as a transfer wallet->fee_collector. The fee must
  // be recorded EXACTLY ONCE (via feeRaw), never as a separate outgoing leg.
  const feeCollectorTxResp: CosmosTxResponse = {
    txhash: "FEECOLLECTOR1",
    height: "82238244",
    timestamp: "2026-08-07T12:04:04Z",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: COREUM_FEE_COLLECTOR },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "43090ucore" },
        ],
      },
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1pool" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "10000" + COREUM_SARA_DENOM },
        ],
      },
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: walletAddr },
          { key: "sender", value: "core1pool" },
          { key: "amount", value: "5137467ucore" },
        ],
      },
      { type: "wasm", attributes: [{ key: "action", value: "swap" }] },
    ],
  };
  const feeCollectorTx: CosmosTx = {
    body: {
      messages: [{ "@type": MSG_EXECUTE_CONTRACT, sender: walletAddr }],
    },
    auth_info: { fee: { amount: [{ denom: "ucore", amount: "43090" }] } },
  };
  const fcLegs = mapCosmosTx(walletAddr, feeCollectorTxResp, feeCollectorTx);
  // Only the SARA-out leg and the ucore-in leg survive; the fee-collector
  // transfer is dropped (its value is the fee, captured via feeRaw).
  check("fee-collector legs count", fcLegs.length === 2);
  check("fee-collector no leg to collector", fcLegs.every((l) => l.counterparty !== COREUM_FEE_COLLECTOR));
  // The SARA outflow leg (10000 sara) is preserved.
  const saraOut = fcLegs.find((l) => l.assetId === "sara");
  check("fee-collector sara leg present", saraOut !== undefined && saraOut.amountRaw === "-10000");
  // The ucore inflow (5137467) is preserved and is NOT reduced by the fee.
  const ucoreIn = fcLegs.find((l) => l.assetId === "tx" && l.direction === "in");
  check("fee-collector ucore-in preserved", ucoreIn !== undefined && ucoreIn.amountRaw === "5137467");
  // The fee is recorded EXACTLY ONCE via feeRaw across all legs.
  const totalFeeEntries = fcLegs.filter((l) => l.feeRaw !== null && l.feeRaw !== "0");
  check("fee-collector fee counted once", totalFeeEntries.length === 1 && totalFeeEntries[0].feeRaw === "43090");
  // Critically: there is NO outgoing ucore LEG of -43090 (that would be the
  // double-count we are guarding against).
  const bogusFeeLeg = fcLegs.find((l) => l.assetId === "tx" && l.amountRaw === "-43090");
  check("fee-collector no double-count leg", bogusFeeLeg === undefined);

  // A genuine inbound transfer FROM the fee_collector (not a fee payment) is
  // NOT skipped (guards the skip is scoped to wallet-as-sender only).
  const inboundFromCollectorResp: CosmosTxResponse = {
    txhash: "INFROMCOLLECTOR1",
    height: "82238245",
    timestamp: "2026-08-07T12:05:04Z",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: walletAddr },
          { key: "sender", value: COREUM_FEE_COLLECTOR },
          { key: "amount", value: "12345ucore" },
        ],
      },
    ],
  };
  const inboundFromCollectorLegs = extractTransferLegs(inboundFromCollectorResp, walletAddr);
  check("inbound from collector not skipped", inboundFromCollectorLegs.length === 1);
  check("inbound from collector amount", inboundFromCollectorLegs[0].amount === "12345");

  // --- lp_add tx mapping ---
  const lpAddTxRespFull: CosmosTxResponse = {
    txhash: "LPADD123",
    height: "82238244",
    timestamp: "2026-08-07T12:04:04Z",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: "core1pair" },
          { key: "sender", value: walletAddr },
          { key: "amount", value: "400000000ucore,233602426umart-core1abc" },
        ],
      },
      {
        type: "wasm",
        attributes: [
          { key: "action", value: "provide_liquidity" },
          { key: "share", value: "289670042" },
        ],
      },
    ],
  };
  const lpAddLegs = mapCosmosTx(walletAddr, lpAddTxRespFull, {
    body: { messages: [{ "@type": MSG_EXECUTE_CONTRACT, sender: walletAddr }] },
    auth_info: { fee: { amount: [{ denom: "ucore", amount: "10000" }] } },
  });
  check("lp_add legs count", lpAddLegs.length === 2);
  check("lp_add tx type", lpAddLegs[0].txType === "lp_add");
  check("lp_add leg1 direction out", lpAddLegs[0].direction === "out");
  check("lp_add leg1 assetId tx", lpAddLegs[0].assetId === "tx");
  check("lp_add leg2 denom umart", lpAddLegs[1].denom === "umart-core1abc");
  check("lp_add leg2 assetId null", lpAddLegs[1].assetId === null);

  // --- wallet not involved at all ---
  const unrelatedResp: CosmosTxResponse = {
    txhash: "UNRELATED",
    height: "100",
    code: 0,
    events: [
      {
        type: "transfer",
        attributes: [
          { key: "sender", value: "core1someone" },
          { key: "recipient", value: "core1else" },
          { key: "amount", value: "100ucore" },
        ],
      },
    ],
  };
  const unrelatedLegs = mapCosmosTx(walletAddr, unrelatedResp, {
    body: { messages: [{ "@type": MSG_SEND, from_address: "core1someone" }] },
    auth_info: { fee: { amount: [{ denom: "ucore", amount: "500" }] } },
  });
  check("unrelated tx no legs", unrelatedLegs.length === 0);

  // --- signer extraction ---
  check("extract signer from send", extractSigner([{ "@type": MSG_SEND, from_address: "core1abc" }]) === "core1abc");
  check("extract signer from execute", extractSigner([{ "@type": MSG_EXECUTE_CONTRACT, sender: "core1def" }]) === "core1def");
  check("extract signer empty", extractSigner([]) === null);
  check("extract signer no fields", extractSigner([{ "@type": "unknown" }]) === null);

  // --- deduplication ---
  const dupResponses: CosmosTxResponse[] = [
    { txhash: "AAA", height: "100" },
    { txhash: "BBB", height: "200" },
    { txhash: "AAA", height: "100" }, // duplicate
    { txhash: "CCC", height: "300" },
  ];
  const deduped = dedupTxResponses(dupResponses);
  check("dedup count", deduped.length === 3);
  check("dedup hashes", deduped[0].txhash === "AAA" && deduped[1].txhash === "BBB" && deduped[2].txhash === "CCC");

  // --- sorting by height ---
  const unsorted: CosmosTxResponse[] = [
    { txhash: "C", height: "82238243" },
    { txhash: "A", height: "82238241" },
    { txhash: "B", height: "82238242" },
  ];
  const sorted = sortTxResponsesByHeight(unsorted);
  check("sort first is A", sorted[0].txhash === "A");
  check("sort second is B", sorted[1].txhash === "B");
  check("sort third is C", sorted[2].txhash === "C");
  // original array unchanged
  check("sort does not mutate", unsorted[0].txhash === "C");

  // --- direction helper ---
  check("direction negative is out", directionOf("-100") === "out");
  check("direction positive is in", directionOf("100") === "in");
  check("direction zero is self", directionOf("0") === "self");

  console.log("coreum-map-core self-tests: all passed");
}
