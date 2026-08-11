/**
 * src/lib/crypto/xrpl/xrpl-map-core.ts — C4
 *
 * PURE mappers that turn raw XRP Ledger (XRPL) payloads into the exact,
 * tax-truthful shapes our store uses. This file imports ONLY from crypto-core
 * (no `server-only`, no network, no DB) so it runs under `tsx`, `vitest`, and
 * the browser alike, and so the pure self-tests can exercise it.
 *
 * WHY THIS FILE IS THE TAX SAFETY CENTERPIECE OF THE XRPL CONNECTOR
 * -----------------------------------------------------------------
 * On the XRP Ledger, the amount written in a transaction's `Amount` field is
 * NOT necessarily what actually moved:
 *   - Partial payments deliver less than `Amount` — the truth is `delivered_amount`.
 *   - A single payment can ripple through several trust lines, touching balances
 *     in ways the top-level fields never show.
 *   - The network `Fee` is always paid by the SENDING account, in XRP drops, and
 *     must be attributed to the right side or cost basis is wrong.
 *
 * The ONLY authoritative, IRS-defensible way to know exactly how much value
 * entered or left the tracked wallet is to read the transaction METADATA —
 * specifically `meta.AffectedNodes` — and compute the net balance change of the
 * tracked account across every ledger entry it touched:
 *   - `AccountRoot` node  → the wallet's XRP balance (drops) before/after.
 *   - `RippleState` node  → a trust-line (issued-token) balance before/after,
 *      read from the tracked account's PERSPECTIVE (low vs. high side sign).
 *
 * We compute those deltas with exact integer / decimal-string math (never
 * floats), mirroring how our EVM/Plaid money is handled. Everything here is
 * verified against first-party XRPL documentation (xrpl.org), 2026-08-10:
 *   - Ripple epoch = Unix epoch + 946684800 seconds (Jan 1 2000 UTC).
 *   - XRP is integer drops, 1 XRP = 1,000,000 drops (6 decimals).
 *   - Issued tokens are decimal strings up to 15 significant digits.
 *   - Currency codes are 3-char standard OR 40-char hex (first byte != 0x00).
 *   - Trust-line balance sign is from the low account's perspective.
 *   - `delivered_amount` is the real delivered value for Payments.
 *   - API v2 wraps the transaction in `tx_json`; API v1 uses `tx`.
 */

import {
  type Chain,
  type TxDirection,
  type TxType,
  CRYPTO_ASSETS,
  normalizeMinorUnits,
  normalizeXrplIssuedAmount,
} from "../crypto-core";

// ---------------------------------------------------------------------------
// Verified constants (never guessed — see file header for sources)
// ---------------------------------------------------------------------------

/** Seconds between the Unix epoch (1970) and the Ripple epoch (2000-01-01 UTC). */
export const RIPPLE_EPOCH_OFFSET_SECONDS = 946684800;

/** XRP has 6 decimal places: 1 XRP = 1,000,000 drops. */
export const XRP_DECIMALS = 6;

/** The chain key these mappers serve. */
export const XRPL_CHAIN: Chain = "xrpl";

/** Internal id of the native XRP asset in CRYPTO_ASSETS. */
export const XRP_ASSET_ID = "xrp";

// ---------------------------------------------------------------------------
// Raw XRPL payload shapes (only the fields we actually read; permissive on rest)
// ---------------------------------------------------------------------------

/** An XRPL "Amount": either a drops string (XRP) or a token object. */
export type XrplAmount =
  | string
  | {
      value: string;
      currency: string;
      issuer: string;
    };

/** result.account_data from `account_info` (only fields we read). */
export type XrplAccountData = {
  Account?: string;
  Balance?: string; // XRP drops
  Sequence?: number;
  OwnerCount?: number;
};

/** One entry of `account_lines` → result.lines[]. */
export type XrplTrustLine = {
  account: string; // the counterparty / issuer
  balance: string; // String Number; may be negative
  currency: string; // 3-char or 40-char hex
  limit?: string;
  limit_peer?: string;
  no_ripple?: boolean;
  freeze?: boolean;
};

/** A ledger-entry node inside meta.AffectedNodes. */
export type XrplAffectedNode = {
  ModifiedNode?: XrplLedgerNode;
  CreatedNode?: XrplLedgerNode;
  DeletedNode?: XrplLedgerNode;
};

export type XrplLedgerNode = {
  LedgerEntryType?: string;
  LedgerIndex?: string;
  FinalFields?: Record<string, unknown>;
  NewFields?: Record<string, unknown>;
  PreviousFields?: Record<string, unknown>;
};

/** meta object of a transaction. */
export type XrplTxMeta = {
  AffectedNodes?: XrplAffectedNode[];
  TransactionResult?: string;
  TransactionIndex?: number;
  delivered_amount?: XrplAmount | "unavailable";
  DeliveredAmount?: XrplAmount;
};

/** The inner transaction object (tx_json in v2, tx in v1). */
export type XrplTxJson = {
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  Amount?: XrplAmount;
  Fee?: string; // XRP drops
  Sequence?: number;
  hash?: string;
  ledger_index?: number;
  date?: number; // Ripple epoch seconds
};

/** One element of `account_tx` → result.transactions[]. */
export type XrplTxEnvelope = {
  meta?: XrplTxMeta;
  tx_json?: XrplTxJson;
  tx?: XrplTxJson; // API v1
  hash?: string; // top-level in v2
  ledger_index?: number;
  close_time_iso?: string;
  validated?: boolean;
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Convert a Ripple-epoch timestamp (seconds) to a Unix ISO-8601 UTC string. */
export function rippleTimeToIso(rippleSeconds: number): string {
  if (!Number.isFinite(rippleSeconds) || !Number.isInteger(rippleSeconds)) {
    throw new Error(`rippleTimeToIso: bad ripple time ${rippleSeconds}`);
  }
  const unixMs = (rippleSeconds + RIPPLE_EPOCH_OFFSET_SECONDS) * 1000;
  return new Date(unixMs).toISOString();
}

// ---------------------------------------------------------------------------
// Currency-code decoding (3-char standard vs 40-char hex)
// ---------------------------------------------------------------------------

/**
 * Decode an XRPL currency code to a human symbol.
 *   - A 3-character standard code is returned as-is (e.g. "USD").
 *   - A 40-character hex code (160-bit) is decoded: if the leading byte is not
 *     0x00 AND the bytes are printable ASCII, we return the trimmed ASCII text
 *     (e.g. "534F4C4F00000000000000000000000000000000" → "SOLO"). Otherwise the
 *     uppercased hex string is returned unchanged so nothing is ever guessed.
 * Never throws; returns the safest faithful representation.
 */
export function decodeCurrencyCode(code: string): string {
  if (typeof code !== "string") return "";
  const raw = code.trim();
  if (raw.length === 0) return "";
  // Standard 3-char code (or anything that isn't a 40-hex blob) → as-is.
  if (!/^[0-9a-fA-F]{40}$/.test(raw)) return raw;

  const hex = raw.toUpperCase();
  // Standard-form hex codes begin with 00; the remaining bytes hold ASCII.
  // Non-standard codes must NOT begin with 00 (per XRPL rules) and are custom.
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  // Strip trailing NUL padding.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  const meaningful = bytes.slice(0, end);
  // If every meaningful byte is printable ASCII, decode to text.
  const allPrintable =
    meaningful.length > 0 && meaningful.every((b) => b >= 0x20 && b <= 0x7e);
  if (allPrintable) {
    // Drop any leading NUL bytes that standard-form codes use as a marker.
    const text = meaningful
      .filter((b) => b !== 0)
      .map((b) => String.fromCharCode(b))
      .join("");
    if (text.length > 0) return text;
  }
  // Fall back to the canonical uppercased hex — faithful, never guessed.
  return hex;
}

// ---------------------------------------------------------------------------
// Asset resolution (map an XRPL currency+issuer to a known internal asset)
// ---------------------------------------------------------------------------

const XRPL_ASSETS = CRYPTO_ASSETS.filter((a) => a.chain === "xrpl");

/**
 * Resolve an XRPL issued token (currency code + issuer) to a KNOWN internal
 * asset id (e.g. "solo"), or null if we don't track it. Matching is done on the
 * decoded currency symbol (case-insensitive) AND the issuer address (exact).
 * We never guess an asset from the code alone — the issuer must match too.
 */
export function resolveXrplIssuedAssetId(currency: string, issuer: string): string | null {
  const symbol = decodeCurrencyCode(currency).toUpperCase();
  const iss = (issuer ?? "").trim();
  for (const a of XRPL_ASSETS) {
    if (a.native) continue;
    if (!a.issuer || !a.currencyCode) continue;
    if (a.issuer === iss && a.currencyCode.toUpperCase() === symbol) return a.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/** A normalized, tax-safe representation of any XRPL amount. */
export type ParsedXrplAmount =
  | {
      kind: "xrp";
      /** Signed integer drops as a canonical string. */
      drops: string;
    }
  | {
      kind: "token";
      /** Signed decimal string, XRPL issued-token precision. */
      value: string;
      /** Decoded currency symbol. */
      currency: string;
      issuer: string;
      /** Known internal asset id, or null if untracked. */
      assetId: string | null;
    };

/**
 * Parse a raw XRPL `Amount` (drops string OR token object) into a normalized,
 * float-free form. Throws on malformed input rather than silently mangling a
 * tax figure.
 */
export function parseXrplAmount(amount: XrplAmount): ParsedXrplAmount {
  if (typeof amount === "string") {
    return { kind: "xrp", drops: normalizeMinorUnits(amount) };
  }
  if (amount && typeof amount === "object" && typeof amount.value === "string") {
    const currency = decodeCurrencyCode(amount.currency);
    return {
      kind: "token",
      value: normalizeXrplIssuedAmount(amount.value),
      currency,
      issuer: (amount.issuer ?? "").trim(),
      assetId: resolveXrplIssuedAssetId(amount.currency, amount.issuer ?? ""),
    };
  }
  throw new Error(`parseXrplAmount: unrecognized amount ${JSON.stringify(amount)}`);
}

// ---------------------------------------------------------------------------
// Balance mappers (account_info + account_lines)
// ---------------------------------------------------------------------------

/** A tracked-wallet balance ready to persist (C5 writes it). */
export type MappedBalance = {
  assetId: string | null;
  /** Integer minor units (drops) for XRP; null for issued tokens. */
  amountRaw: string | null;
  /** Decimal string for issued tokens; null for XRP. */
  amountDecimal: string | null;
  /** Decimals used at read time (6 for XRP; null for issued tokens). */
  decimalsAtRead: number | null;
  /** For untracked issued tokens, the decoded symbol + issuer for display. */
  currency?: string;
  issuer?: string;
};

/** Map `account_info.account_data` to the wallet's native XRP balance. */
export function mapAccountInfoBalance(data: XrplAccountData): MappedBalance {
  const drops = data.Balance ?? "0";
  return {
    assetId: XRP_ASSET_ID,
    amountRaw: normalizeMinorUnits(drops),
    amountDecimal: null,
    decimalsAtRead: XRP_DECIMALS,
  };
}

/**
 * Map ONE `account_lines` trust-line entry to a balance. Positive `balance`
 * means the tracked wallet holds that token; negative means it owes. We keep
 * the exact decimal string. `assetId` is set only when the issuer + currency
 * match a known asset (e.g. SOLO); otherwise it's null (kept for completeness
 * and future classification, never dropped).
 */
export function mapTrustLineBalance(line: XrplTrustLine): MappedBalance {
  const currency = decodeCurrencyCode(line.currency);
  const assetId = resolveXrplIssuedAssetId(line.currency, line.account);
  return {
    assetId,
    amountRaw: null,
    amountDecimal: normalizeXrplIssuedAmount(line.balance),
    decimalsAtRead: null,
    currency,
    issuer: line.account,
  };
}

/**
 * Map a full `account_lines` result to balances, keeping ONLY non-zero lines
 * (a zero trust line is not a holding). Order is preserved.
 */
export function mapTrustLineBalances(lines: XrplTrustLine[]): MappedBalance[] {
  const out: MappedBalance[] = [];
  for (const line of lines ?? []) {
    const mapped = mapTrustLineBalance(line);
    if (mapped.amountDecimal !== null && normalizeXrplIssuedAmount(mapped.amountDecimal) !== "0") {
      out.push(mapped);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transaction mapping — the tax-truth engine
// ---------------------------------------------------------------------------

/** Exact decimal subtraction a - b for XRPL issued-token decimal strings. */
export function subtractDecimalStrings(a: string, b: string): string {
  // Scale both to a common integer, subtract with BigInt, re-insert the point.
  const pa = splitDecimal(a);
  const pb = splitDecimal(b);
  const scale = Math.max(pa.frac.length, pb.frac.length);
  const ai = BigInt(pa.sign + pa.int + pa.frac.padEnd(scale, "0"));
  const bi = BigInt(pb.sign + pb.int + pb.frac.padEnd(scale, "0"));
  const diff = ai - bi;
  const neg = diff < BigInt(0);
  const mag = (neg ? -diff : diff).toString().padStart(scale + 1, "0");
  const whole = mag.slice(0, mag.length - scale) || "0";
  let frac = scale > 0 ? mag.slice(mag.length - scale) : "";
  frac = frac.replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole}.${frac}` : whole;
  if (body === "0") return "0";
  return (neg ? "-" : "") + body;
}

function splitDecimal(s: string): { sign: string; int: string; frac: string } {
  const t = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) {
    throw new Error(`splitDecimal: bad decimal ${JSON.stringify(s)}`);
  }
  const sign = t.startsWith("-") ? "-" : "";
  const unsigned = sign ? t.slice(1) : t;
  const [int, frac = ""] = unsigned.split(".");
  return { sign, int: int || "0", frac };
}

/** Read the drops Balance value out of an AccountRoot fields object. */
function accountRootBalance(fields: Record<string, unknown> | undefined): string | null {
  if (!fields) return null;
  const bal = fields.Balance;
  return typeof bal === "string" ? bal : null;
}

/** Read a RippleState Balance {currency,issuer,value} out of a fields object. */
function rippleStateBalance(
  fields: Record<string, unknown> | undefined,
): { currency: string; issuer: string; value: string } | null {
  if (!fields) return null;
  const bal = fields.Balance as { currency?: string; issuer?: string; value?: string } | undefined;
  if (!bal || typeof bal.value !== "string") return null;
  return { currency: bal.currency ?? "", issuer: bal.issuer ?? "", value: bal.value };
}

/** Read the {currency, issuer} pair of a RippleState's low/high limit. */
function limitIssuer(fields: Record<string, unknown> | undefined, key: "LowLimit" | "HighLimit"): string {
  if (!fields) return "";
  const lim = fields[key] as { issuer?: string } | undefined;
  return lim?.issuer ?? "";
}

/** The net movement of a single asset for the tracked account in one tx. */
export type XrplAssetDelta = {
  /** Known internal asset id, or null if untracked. */
  assetId: string | null;
  /** "xrp" (integer drops) or "token" (issued decimal string). */
  kind: "xrp" | "token";
  /** Signed drops string (XRP) — set when kind==="xrp". */
  drops?: string;
  /** Signed decimal string (token) — set when kind==="token". */
  value?: string;
  currency?: string;
  issuer?: string;
};

/**
 * Compute EVERY asset delta the tracked account experienced in one transaction,
 * by reading the metadata's AffectedNodes. This is the authoritative,
 * partial-payment-proof, ripple-proof source of what actually moved.
 *
 * XRP: sum the change of the tracked account's own AccountRoot
 *      (FinalFields.Balance − PreviousFields.Balance). This delta ALREADY nets
 *      out the network fee when the account is the sender.
 * Tokens: for each RippleState node that involves the tracked account, compute
 *      the change from the ACCOUNT'S perspective. The stored `Balance.value` is
 *      from the LOW account's perspective, so if the tracked account is the
 *      HIGH party we negate the delta.
 */
export function computeAccountDeltas(account: string, meta: XrplTxMeta): XrplAssetDelta[] {
  const acct = (account ?? "").trim();
  const nodes = meta?.AffectedNodes ?? [];
  const deltas: XrplAssetDelta[] = [];

  for (const wrapper of nodes) {
    const node = wrapper.ModifiedNode ?? wrapper.CreatedNode ?? wrapper.DeletedNode;
    if (!node) continue;
    const type = node.LedgerEntryType;
    const finalF = node.FinalFields ?? node.NewFields;
    const prevF = node.PreviousFields;

    if (type === "AccountRoot") {
      const owner = (finalF?.Account ?? prevF?.Account) as string | undefined;
      if (owner !== acct) continue;
      const finalBal = accountRootBalance(finalF);
      const prevBal = accountRootBalance(prevF);
      // Created account: previous is 0. Deleted: final may be absent.
      const before = prevBal ?? (wrapper.CreatedNode ? "0" : finalBal);
      const after = finalBal ?? (wrapper.DeletedNode ? "0" : prevBal);
      if (before === null || after === null) continue;
      const delta = (BigInt(normalizeMinorUnits(after)) - BigInt(normalizeMinorUnits(before))).toString();
      if (delta !== "0") {
        deltas.push({ assetId: XRP_ASSET_ID, kind: "xrp", drops: delta });
      }
    } else if (type === "RippleState") {
      const finalBal = rippleStateBalance(finalF);
      if (!finalBal) continue;
      const lowIssuer = limitIssuer(finalF, "LowLimit");
      const highIssuer = limitIssuer(finalF, "HighLimit");
      const isLow = lowIssuer === acct;
      const isHigh = highIssuer === acct;
      if (!isLow && !isHigh) continue; // trust line not ours

      const prevBal = rippleStateBalance(prevF);
      const beforeVal = prevBal ? prevBal.value : wrapper.CreatedNode ? "0" : finalBal.value;
      const afterVal = finalBal.value;
      // Raw delta is from the LOW account's perspective.
      let delta = subtractDecimalStrings(afterVal, beforeVal);
      if (isHigh) delta = negateDecimal(delta);
      if (delta === "0") continue;

      // The issuer for OUR side is the OTHER party of the trust line.
      const counterIssuer = isLow ? highIssuer : lowIssuer;
      deltas.push({
        assetId: resolveXrplIssuedAssetId(finalBal.currency, counterIssuer),
        kind: "token",
        value: delta,
        currency: decodeCurrencyCode(finalBal.currency),
        issuer: counterIssuer,
      });
    }
  }
  return deltas;
}

function negateDecimal(s: string): string {
  if (s === "0") return "0";
  return s.startsWith("-") ? s.slice(1) : "-" + s;
}

// ---------------------------------------------------------------------------
// Transaction envelope → mapped transaction record(s)
// ---------------------------------------------------------------------------

/** A tracked-wallet transaction ready to persist (C5 writes it). */
export type MappedTransaction = {
  txHash: string;
  eventIndex: number;
  assetId: string | null;
  chain: Chain;
  direction: TxDirection;
  txType: TxType;
  /** Signed integer minor units (drops) — set for XRP legs. */
  amountRaw: string | null;
  /** Signed decimal string — set for issued-token legs. */
  amountDecimal: string | null;
  decimalsAtEvent: number | null;
  /** Network fee in drops (only attributed when the wallet is the sender). */
  feeRaw: string | null;
  feeAssetId: string | null;
  counterparty: string | null;
  blockNumber: number | null;
  blockTime: string | null;
  /** For display / untracked tokens. */
  currency?: string;
  issuer?: string;
  /** Whether the transaction succeeded on-ledger (tesSUCCESS). */
  success: boolean;
};

/** Pull the inner tx object regardless of API version (v2 tx_json, v1 tx). */
export function extractTxJson(env: XrplTxEnvelope): XrplTxJson {
  return env.tx_json ?? env.tx ?? {};
}

/** Pull the tx hash from wherever the API version placed it. */
export function extractTxHash(env: XrplTxEnvelope): string {
  const inner = extractTxJson(env);
  return env.hash ?? inner.hash ?? "";
}

/**
 * Baseline classification of an XRPL transaction into our tax taxonomy. This is
 * a CONSERVATIVE first pass; the deep DeFi/LP classification happens later (C12).
 *   - Payment with a single delivered asset      → "transfer"
 *   - Payment/OfferCreate that changed >1 asset   → "swap" (a disposal)
 *   - A tx that only cost the fee (no asset move) → "fee"
 *   - Anything else we can't safely name          → "other"
 */
export function classifyXrplTx(
  txType: string | undefined,
  deltas: XrplAssetDelta[],
  isSender: boolean,
  feeDrops: string | null = null,
): TxType {
  const moved = deltas.filter((d) => (d.kind === "xrp" ? d.drops !== "0" : d.value !== "0"));
  // Count DISTINCT assets that moved (by asset key).
  const keys = new Set(
    moved.map((d) => (d.kind === "xrp" ? "xrp" : `${d.currency}:${d.issuer}`)),
  );

  // A sender whose ONLY movement is an XRP decrease exactly equal to the network
  // fee didn't really transfer value — that event is purely the fee (e.g. a
  // TrustSet, a no-op OfferCancel, or an AccountSet). Recognise it as "fee".
  if (isSender && feeDrops !== null && moved.length === 1 && keys.has("xrp")) {
    const xrpMove = moved.find((d) => d.kind === "xrp");
    if (xrpMove && xrpMove.drops === "-" + feeDrops) return "fee";
  }

  if (txType === "OfferCreate" || txType === "OfferCancel") {
    return keys.size >= 1 ? "swap" : "other";
  }
  if (txType === "Payment") {
    if (keys.size >= 2) return "swap"; // cross-currency / rippling payment
    if (keys.size === 1) return "transfer";
    return isSender ? "fee" : "other";
  }
  if (txType === "TrustSet" || txType === "AccountSet") {
    // These usually only cost the fee; if a balance moved, keep it visible.
    return moved.length === 0 ? "fee" : "other";
  }
  if (moved.length === 0 && isSender) return "fee";
  return "other";
}

/**
 * Map one `account_tx` envelope, from the tracked account's perspective, into
 * zero or more MappedTransaction legs — ONE per asset that actually moved, so
 * a cross-currency swap yields two exact, correctly-signed legs. The network
 * fee is attributed once (to the primary leg) only when the wallet is the
 * sender. Uses metadata deltas as the source of truth; falls back to
 * `delivered_amount` only for display when metadata is unavailable.
 *
 * Returns [] for a transaction that did not move any tracked-wallet value
 * (other than a fee we still record) — callers decide whether to persist.
 */
export function mapAccountTx(account: string, env: XrplTxEnvelope): MappedTransaction[] {
  const acct = (account ?? "").trim();
  const inner = extractTxJson(env);
  const meta = env.meta ?? {};
  const txHash = extractTxHash(env);
  const success = (meta.TransactionResult ?? "tesSUCCESS") === "tesSUCCESS";
  const isSender = inner.Account === acct;

  const blockNumber = env.ledger_index ?? inner.ledger_index ?? null;
  const blockTime =
    typeof env.close_time_iso === "string"
      ? env.close_time_iso
      : typeof inner.date === "number"
        ? rippleTimeToIso(inner.date)
        : null;
  const feeDrops = typeof inner.Fee === "string" ? normalizeMinorUnits(inner.Fee) : null;

  const deltas = success ? computeAccountDeltas(acct, meta) : [];
  const txType = classifyXrplTx(inner.TransactionType, deltas, isSender, feeDrops);

  const counterparty =
    isSender ? (inner.Destination ?? null) : (inner.Account ?? null);

  const legs: MappedTransaction[] = [];
  let eventIndex = 0;
  let feeAttached = false;

  for (const d of deltas) {
    const isXrp = d.kind === "xrp";
    const signedRaw = isXrp ? d.drops ?? "0" : null;
    const signedDec = isXrp ? null : d.value ?? "0";
    const direction: TxDirection = directionOf(isXrp ? signedRaw! : signedDec!);

    // Attribute the fee once, to the wallet's own XRP leg, when it's the sender.
    const attachFee = !feeAttached && isSender && isXrp && feeDrops !== null;
    if (attachFee) feeAttached = true;

    legs.push({
      txHash,
      eventIndex: eventIndex++,
      assetId: d.assetId,
      chain: XRPL_CHAIN,
      direction,
      txType,
      amountRaw: signedRaw,
      amountDecimal: signedDec,
      decimalsAtEvent: isXrp ? XRP_DECIMALS : null,
      feeRaw: attachFee ? feeDrops : null,
      feeAssetId: attachFee ? XRP_ASSET_ID : null,
      counterparty,
      blockNumber,
      blockTime,
      currency: d.currency,
      issuer: d.issuer,
      success,
    });
  }

  // If nothing moved but the wallet still paid a fee (e.g. a failed tx or a
  // TrustSet), record a single fee leg so the XRP outflow is never lost.
  if (legs.length === 0 && isSender && feeDrops !== null && feeDrops !== "0") {
    legs.push({
      txHash,
      eventIndex: 0,
      assetId: XRP_ASSET_ID,
      chain: XRPL_CHAIN,
      direction: "out",
      txType: success ? txType : "fee",
      amountRaw: "-" + feeDrops,
      amountDecimal: null,
      decimalsAtEvent: XRP_DECIMALS,
      feeRaw: feeDrops,
      feeAssetId: XRP_ASSET_ID,
      counterparty,
      blockNumber,
      blockTime,
      success,
    });
  }

  return legs;
}

/** Direction from a signed amount string: negative=out, positive=in, 0=self. */
export function directionOf(signed: string): TxDirection {
  const s = signed.trim();
  if (s.startsWith("-")) return "out";
  if (s === "0") return "self";
  return "in";
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run under tsx via run-pure-selftests + vitest mirror)
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`xrpl-map-core self-test FAILED: ${name}`);
}

export function __runXrplMapCoreTests(): void {
  // --- time ---
  // Ripple time 0 == 2000-01-01T00:00:00Z.
  check("ripple epoch 0", rippleTimeToIso(0) === "2000-01-01T00:00:00.000Z");
  // 811446652 (from the verified account_tx fixture) == 2025-09-17T17:50:52Z.
  check("ripple date fixture", rippleTimeToIso(811446652) === "2025-09-17T17:50:52.000Z");

  // --- currency codes ---
  check("std currency", decodeCurrencyCode("USD") === "USD");
  check(
    "hex SOLO decodes",
    decodeCurrencyCode("534F4C4F00000000000000000000000000000000") === "SOLO",
  );
  check("empty currency", decodeCurrencyCode("") === "");
  // A non-ASCII 40-hex blob falls back to uppercased hex, never guessed.
  check(
    "hex nonascii passthrough",
    decodeCurrencyCode("0158415500000000C1F76FF6ECB0BAC600000000") ===
      "0158415500000000C1F76FF6ECB0BAC600000000",
  );

  // --- asset resolution (SOLO issuer must match) ---
  check(
    "resolve SOLO",
    resolveXrplIssuedAssetId("SOLO", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz") === "solo",
  );
  check(
    "resolve SOLO by hex",
    resolveXrplIssuedAssetId(
      "534F4C4F00000000000000000000000000000000",
      "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
    ) === "solo",
  );
  check(
    "SOLO wrong issuer unresolved",
    resolveXrplIssuedAssetId("SOLO", "rWrongIssuerAddressXXXXXXXXXXXXXXX") === null,
  );
  check("USD untracked", resolveXrplIssuedAssetId("USD", "rSomeIssuer") === null);

  // --- amount parsing ---
  const axrp = parseXrplAmount("13100000");
  check("parse drops", axrp.kind === "xrp" && axrp.drops === "13100000");
  const atok = parseXrplAmount({
    value: "153.750",
    currency: "SOLO",
    issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
  });
  check(
    "parse token",
    atok.kind === "token" && atok.value === "153.75" && atok.assetId === "solo",
  );

  // --- exact decimal subtraction ---
  check("dec sub simple", subtractDecimalStrings("10.5", "0.25") === "10.25");
  check("dec sub negative", subtractDecimalStrings("1", "3") === "-2");
  check("dec sub tiny", subtractDecimalStrings("0.0000001", "0") === "0.0000001");
  check("dec sub to zero", subtractDecimalStrings("5", "5") === "0");

  // --- account_info balance ---
  const bx = mapAccountInfoBalance({ Account: "rMe", Balance: "24799991" });
  check(
    "account_info balance",
    bx.assetId === "xrp" && bx.amountRaw === "24799991" && bx.decimalsAtRead === 6,
  );

  // --- trust-line balances (non-zero kept, zero dropped) ---
  const lines: XrplTrustLine[] = [
    { account: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", balance: "42.5", currency: "SOLO" },
    { account: "rIssuerZeroXXXXXXXXXXXXXXXXXXXXXX", balance: "0", currency: "USD" },
    { account: "rOtherIssuer", balance: "-1.25", currency: "EUR" },
  ];
  const bals = mapTrustLineBalances(lines);
  check("trustlines kept nonzero", bals.length === 2);
  check("trustline SOLO resolved", bals[0].assetId === "solo" && bals[0].amountDecimal === "42.5");
  check("trustline EUR unresolved kept", bals[1].assetId === null && bals[1].amountDecimal === "-1.25");

  // --- direction ---
  check("dir out", directionOf("-5") === "out");
  check("dir in", directionOf("7") === "in");
  check("dir self", directionOf("0") === "self");

  // --- account delta: a simple XRP send (fee + amount leave the sender) ---
  // Sender rMe balance 24800001 → 24799991 = -10 drops net (a 0-value TrustSet
  // that only cost the 10-drop fee). Verified-shape fixture from xrpl.org.
  const trustSetEnv: XrplTxEnvelope = {
    meta: {
      TransactionResult: "tesSUCCESS",
      TransactionIndex: 20,
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rMe", Balance: "24799991" },
            PreviousFields: { Balance: "24800001" },
          },
        },
        {
          CreatedNode: {
            LedgerEntryType: "RippleState",
            NewFields: {
              Balance: { currency: "USD", issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: "0" },
              HighLimit: { currency: "USD", issuer: "rCounterparty", value: "10000" },
              LowLimit: { currency: "USD", issuer: "rMe", value: "0" },
            },
          },
        },
      ],
    },
    tx_json: {
      TransactionType: "TrustSet",
      Account: "rMe",
      Fee: "10",
      ledger_index: 98918099,
      date: 811446610,
    },
    hash: "AAA111",
    ledger_index: 98918099,
    close_time_iso: "2025-09-17T17:50:10Z",
  };
  const dts = computeAccountDeltas("rMe", trustSetEnv.meta!);
  check("trustset delta xrp only", dts.length === 1 && dts[0].kind === "xrp" && dts[0].drops === "-10");
  const trustSetLegs = mapAccountTx("rMe", trustSetEnv);
  check("trustset one leg", trustSetLegs.length === 1);
  check(
    "trustset leg is fee out with fee attached",
    trustSetLegs[0].txType === "fee" &&
      trustSetLegs[0].direction === "out" &&
      trustSetLegs[0].amountRaw === "-10" &&
      trustSetLegs[0].feeRaw === "10" &&
      trustSetLegs[0].feeAssetId === "xrp" &&
      trustSetLegs[0].txHash === "AAA111" &&
      trustSetLegs[0].blockTime === "2025-09-17T17:50:10Z",
  );

  // --- account delta: receiving XRP (in) ---
  const recvEnv: XrplTxEnvelope = {
    meta: {
      TransactionResult: "tesSUCCESS",
      delivered_amount: "5000000",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rMe", Balance: "10000000" },
            PreviousFields: { Balance: "5000000" },
          },
        },
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rSender", Balance: "1" },
            PreviousFields: { Balance: "5000011" },
          },
        },
      ],
    },
    tx_json: {
      TransactionType: "Payment",
      Account: "rSender",
      Destination: "rMe",
      Amount: "5000000",
      Fee: "10",
      date: 811446652,
    },
    hash: "BBB222",
    ledger_index: 100,
  };
  const recvLegs = mapAccountTx("rMe", recvEnv);
  check("recv one leg", recvLegs.length === 1);
  check(
    "recv is transfer in +5000000 no fee (not sender)",
    recvLegs[0].txType === "transfer" &&
      recvLegs[0].direction === "in" &&
      recvLegs[0].amountRaw === "5000000" &&
      recvLegs[0].feeRaw === null &&
      recvLegs[0].counterparty === "rSender",
  );

  // --- token trust-line delta from the HIGH side (sign flip) ---
  // Tracked account is the HighLimit issuer; low-perspective balance went from
  // -3.0120000001701 to -0.0000000001701 (increase of +3.012 for low). For the
  // HIGH side that is a DECREASE of 3.012 (tokens left our side).
  const swapEnv: XrplTxEnvelope = {
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rMe", Balance: "27724423128" },
            PreviousFields: { Balance: "27719423228" },
          },
        },
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: "USD", issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: "-0.0000000001701" },
              HighLimit: { currency: "USD", issuer: "rMe", value: "0" },
              LowLimit: { currency: "USD", issuer: "rIssuer", value: "0" },
            },
            PreviousFields: {
              Balance: { currency: "USD", issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: "-3.0120000001701" },
            },
          },
        },
      ],
    },
    tx_json: {
      TransactionType: "OfferCreate",
      Account: "rMe",
      Fee: "12",
      date: 700000000,
    },
    hash: "CCC333",
    ledger_index: 200,
  };
  const swapDeltas = computeAccountDeltas("rMe", swapEnv.meta!);
  // XRP went UP by +4999900 (received XRP), USD went DOWN by -3.012 (paid USD).
  const xrpD = swapDeltas.find((d) => d.kind === "xrp");
  const usdD = swapDeltas.find((d) => d.kind === "token");
  check("swap xrp delta", !!xrpD && xrpD!.drops === "4999900");
  check("swap usd delta high-side flip", !!usdD && usdD!.value === "-3.012" && usdD!.currency === "USD");
  const swapLegs = mapAccountTx("rMe", swapEnv);
  check("swap two legs", swapLegs.length === 2);
  check("swap classified as swap", swapLegs.every((l) => l.txType === "swap"));
  // Fee attaches exactly once, to the XRP leg (sender).
  const feeLegs = swapLegs.filter((l) => l.feeRaw !== null);
  check("swap fee once on xrp leg", feeLegs.length === 1 && feeLegs[0].amountRaw === "4999900");

  // --- failed transaction: no asset deltas, but sender still paid the fee ---
  const failEnv: XrplTxEnvelope = {
    meta: {
      TransactionResult: "tecUNFUNDED_PAYMENT",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rMe", Balance: "999990" },
            PreviousFields: { Balance: "1000000" },
          },
        },
      ],
    },
    tx_json: {
      TransactionType: "Payment",
      Account: "rMe",
      Destination: "rDest",
      Amount: "50000000",
      Fee: "10",
      date: 700000000,
    },
    hash: "DDD444",
    ledger_index: 300,
  };
  const failLegs = mapAccountTx("rMe", failEnv);
  check("failed one fee leg", failLegs.length === 1);
  check(
    "failed leg fee only, success=false",
    failLegs[0].txType === "fee" &&
      failLegs[0].amountRaw === "-10" &&
      failLegs[0].success === false &&
      failLegs[0].feeRaw === "10",
  );

  // --- api v1 shape (tx instead of tx_json, hash inside) ---
  const v1Env: XrplTxEnvelope = {
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rMe", Balance: "2000000" },
            PreviousFields: { Balance: "1000000" },
          },
        },
      ],
    },
    tx: {
      TransactionType: "Payment",
      Account: "rSender",
      Destination: "rMe",
      Amount: "1000000",
      Fee: "10",
      hash: "EEE555",
      date: 700000000,
    },
    ledger_index: 400,
  };
  check("v1 hash extraction", extractTxHash(v1Env) === "EEE555");
  const v1Legs = mapAccountTx("rMe", v1Env);
  check(
    "v1 transfer in",
    v1Legs.length === 1 &&
      v1Legs[0].txHash === "EEE555" &&
      v1Legs[0].direction === "in" &&
      v1Legs[0].amountRaw === "1000000",
  );

  console.log("xrpl-map-core self-tests: all passed");
}
