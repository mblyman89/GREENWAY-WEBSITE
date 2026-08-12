/**
 * src/lib/crypto/stellar/stellar-map-core.ts
 *
 * PURE mappers that turn raw Stellar (Horizon) payloads into the exact,
 * tax-truthful shapes our store uses. This file imports ONLY from crypto-core
 * (no `server-only`, no network, no DB) so it runs under `tsx`, `vitest`, and
 * the browser alike, and so the pure self-tests can exercise it.
 *
 * WHY THIS FILE IS THE TAX SAFETY CENTERPIECE OF THE STELLAR CONNECTOR
 * --------------------------------------------------------------------
 * Stellar amounts are DECIMAL strings ("279.6501307"), but the ledger's real
 * unit is the integer "stroop": 1 XLM = 10,000,000 stroops (7 decimals). To keep
 * money exact we convert every decimal amount to an integer number of stroops
 * with STRING math (BigInt), never a float -- exactly how our EVM/XRP/Plaid money
 * is handled. Then every leg is signed from the TRACKED WALLET's perspective
 * (negative = value left the wallet) so the sync layer can split sign into an
 * unsigned magnitude + direction, matching every other chain.
 *
 * The payments endpoint returns these operation types (verified against
 * developers.stellar.org, 2026-08-12): `create_account`, `payment`,
 * `path_payment_strict_receive`, `path_payment_strict_send`, `account_merge`.
 * We compute the wallet's XLM (or issued-asset) delta for each:
 *   - create_account : if the wallet IS the created account -> +starting_balance
 *                      (funded IN); if the wallet is the funder -> -starting_balance.
 *   - payment / path_payment_* : +amount if `to` == wallet, -amount if `from`.
 *   - account_merge : if wallet is `into` -> the merged XLM lands here (IN);
 *                      if wallet is the merged `account` -> its whole balance
 *                      left (we cannot know the exact amount from this op alone,
 *                      so we record it as a zero-amount "other" leg and keep the
 *                      full source for audit -- never guessing a number).
 *
 * VERIFIED constants:
 *   - XLM has 7 decimals; smallest unit "stroop" = 0.0000001 XLM.
 *   - asset_type is "native" | "credit_alphanum4" | "credit_alphanum12".
 *   - Non-native assets are identified by asset_code + asset_issuer.
 *   - Amounts are decimal strings with up to 7 fractional digits.
 *   - Timestamps are RFC3339 (`created_at`, e.g. "2025-06-21T01:52:05Z").
 */

import {
  type Chain,
  type TxDirection,
  type TxType,
  CRYPTO_ASSETS,
  normalizeMinorUnits,
} from "../crypto-core";

// ---------------------------------------------------------------------------
// Verified constants (never guessed -- see file header for sources)
// ---------------------------------------------------------------------------

/** XLM has 7 decimal places: 1 XLM = 10,000,000 stroops. */
export const XLM_DECIMALS = 7;

/** The chain key these mappers serve. */
export const STELLAR_CHAIN: Chain = "stellar";

/** Internal id of the native XLM asset in CRYPTO_ASSETS. */
export const XLM_ASSET_ID = "xlm";

/**
 * A 1-stroop (0.0000001 XLM) inbound payment is economically zero -- these are
 * spam "dust" airdrops used to advertise scams (Michael's account received ~172
 * of them). We still record every one for a complete, audit-provable history,
 * but the classifier flags them so they never inflate a taxable gain.
 */
export const XLM_DUST_STROOPS = "1";

// ---------------------------------------------------------------------------
// Raw Horizon payload shapes (only the fields we actually read; permissive rest)
// ---------------------------------------------------------------------------

/** One entry of `GET /accounts/{id}` -> balances[]. */
export type HorizonBalance = {
  balance: string; // decimal string
  asset_type: string; // "native" | "credit_alphanum4" | "credit_alphanum12"
  asset_code?: string;
  asset_issuer?: string;
};

/** A payments-endpoint operation record (union across op types we handle). */
export type HorizonPaymentRecord = {
  id?: string;
  paging_token?: string;
  type?: string; // create_account | payment | path_payment_* | account_merge
  transaction_hash?: string;
  transaction_successful?: boolean;
  created_at?: string; // RFC3339
  source_account?: string;

  // payment / path_payment_*
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;

  // create_account
  account?: string; // the account being created OR (for account_merge) the merged account
  funder?: string;
  starting_balance?: string;

  // account_merge
  into?: string;
};

// ---------------------------------------------------------------------------
// Exact decimal <-> stroop (integer minor unit) conversion. String math only.
// ---------------------------------------------------------------------------

/**
 * Convert a Stellar decimal amount string (e.g. "279.6501307") to an integer
 * number of stroops as a canonical string (e.g. "2796501307"). Exact -- BigInt
 * only, never a float. Accepts an optional leading sign. Rejects anything that
 * isn't a well-formed decimal with <= 7 fractional digits (Stellar can never
 * emit more), so a malformed value fails loudly instead of silently truncating.
 */
export function decimalToStroops(amount: string): string {
  if (typeof amount !== "string") {
    throw new Error(`decimalToStroops: expected string, got ${typeof amount}`);
  }
  const s = amount.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(s);
  if (!m) {
    throw new Error(`decimalToStroops: not a valid Stellar amount: ${JSON.stringify(amount)}`);
  }
  const sign = m[1] === "-" ? "-" : "";
  const whole = m[2];
  const frac = m[3] ?? "";
  // Pad the fractional part out to exactly 7 digits (stroop precision).
  const fracPadded = (frac + "0000000").slice(0, XLM_DECIMALS);
  const combined = whole + fracPadded; // integer digits of the stroop count
  // Canonicalise (strip leading zeros, collapse "-0" -> "0") via crypto-core.
  return normalizeMinorUnits(sign + combined);
}

// ---------------------------------------------------------------------------
// Asset resolution
// ---------------------------------------------------------------------------

/** True for the native XLM asset_type. */
export function isNativeAssetType(assetType: string | undefined): boolean {
  return assetType === "native";
}

/**
 * Resolve the internal asset id for a Horizon asset descriptor. Native -> "xlm".
 * A non-native (issued) asset is matched to a known CRYPTO_ASSETS entry by
 * chain=stellar + a future contract/issuer match; today we model only native
 * XLM, so any issued asset returns null (kept in history, never dropped).
 */
export function resolveStellarAssetId(assetType: string | undefined): string | null {
  if (isNativeAssetType(assetType)) return XLM_ASSET_ID;
  // Issued Stellar assets aren't modeled yet (kept in history as untracked).
  return null;
}

/** The decimals to record for a Horizon asset at read time (native = 7, else null). */
export function decimalsForAssetType(assetType: string | undefined): number | null {
  return isNativeAssetType(assetType) ? XLM_DECIMALS : null;
}

// ---------------------------------------------------------------------------
// Balance mapping
// ---------------------------------------------------------------------------

/** The mapped balance shape shared with the sync builders (mirrors XRPL's). */
export type MappedBalance = {
  assetId: string | null;
  /** Integer minor units (stroops) for XLM; null for issued tokens we don't model. */
  amountRaw: string | null;
  /** Decimal string for unmodeled issued tokens; null for native XLM. */
  amountDecimal: string | null;
  /** Decimals used at read time (7 for XLM; null for issued tokens). */
  decimalsAtRead: number | null;
  /** For untracked issued tokens, the code + issuer for display. */
  currency?: string;
  issuer?: string;
};

/** Map ONE Horizon balance entry to a MappedBalance. */
export function mapStellarBalance(bal: HorizonBalance): MappedBalance {
  if (isNativeAssetType(bal.asset_type)) {
    return {
      assetId: XLM_ASSET_ID,
      amountRaw: decimalToStroops(bal.balance ?? "0"),
      amountDecimal: null,
      decimalsAtRead: XLM_DECIMALS,
    };
  }
  // Issued (non-native) asset we don't model yet -- keep the exact decimal +
  // code/issuer for history; assetId null so the FK-constrained balances table
  // skips it (surfaced as "untracked", never silently lost).
  return {
    assetId: null,
    amountRaw: null,
    amountDecimal: (bal.balance ?? "0").trim(),
    decimalsAtRead: null,
    currency: bal.asset_code,
    issuer: bal.asset_issuer,
  };
}

/**
 * Map a full `balances` array to MappedBalance[], keeping ONLY non-zero holdings
 * (a zero balance is not a holding). Order is preserved.
 */
export function mapStellarBalances(balances: HorizonBalance[]): MappedBalance[] {
  const out: MappedBalance[] = [];
  for (const b of balances ?? []) {
    const mapped = mapStellarBalance(b);
    const isZero =
      mapped.amountRaw !== null
        ? normalizeMinorUnits(mapped.amountRaw) === "0"
        : mapped.amountDecimal !== null
          ? decimalToStroops(mapped.amountDecimal) === "0"
          : true;
    if (!isZero) out.push(mapped);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transaction (payment operation) mapping
// ---------------------------------------------------------------------------

/** The mapped transaction shape shared with the sync builders (mirrors XRPL's). */
export type MappedTransaction = {
  txHash: string;
  eventIndex: number;
  assetId: string | null;
  chain: Chain;
  direction: TxDirection;
  txType: TxType;
  /** Signed integer minor units (stroops) -- set for XLM legs. */
  amountRaw: string | null;
  /** Signed decimal string -- set for unmodeled issued-token legs. */
  amountDecimal: string | null;
  decimalsAtEvent: number | null;
  /** Network fee -- Horizon's payments endpoint doesn't carry the tx fee, so null here. */
  feeRaw: string | null;
  feeAssetId: string | null;
  counterparty: string | null;
  blockNumber: number | null;
  blockTime: string | null;
  currency?: string;
  issuer?: string;
  success: boolean;
  /** True when this leg is a 1-stroop dust/spam payment (economically zero). */
  dust?: boolean;
};

/** Parse a Horizon RFC3339 `created_at` to a normalized ISO string (or null). */
export function parseCreatedAt(createdAt: string | undefined): string | null {
  if (typeof createdAt !== "string" || createdAt.trim() === "") return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * Compute the wallet's SIGNED stroop delta + counterparty for a single payment
 * record, from the tracked wallet's perspective. Returns null when the record
 * doesn't move value for this wallet (so the caller can skip it).
 */
export function computeStellarLeg(
  wallet: string,
  rec: HorizonPaymentRecord,
): {
  signedStroops: string | null;
  signedDecimal: string | null;
  assetId: string | null;
  direction: TxDirection;
  counterparty: string | null;
  currency?: string;
  issuer?: string;
  decimalsAtEvent: number | null;
} | null {
  const type = rec.type ?? "";

  // create_account: native XLM only, amount = starting_balance.
  if (type === "create_account") {
    const amount = rec.starting_balance ?? "0";
    if (rec.account === wallet) {
      // The wallet was CREATED and funded IN.
      return {
        signedStroops: decimalToStroops(amount),
        signedDecimal: null,
        assetId: XLM_ASSET_ID,
        direction: "in",
        counterparty: rec.funder ?? rec.source_account ?? null,
        decimalsAtEvent: XLM_DECIMALS,
      };
    }
    if (rec.funder === wallet || rec.source_account === wallet) {
      // The wallet FUNDED a new account -> value left.
      return {
        signedStroops: decimalToStroops("-" + amount),
        signedDecimal: null,
        assetId: XLM_ASSET_ID,
        direction: "out",
        counterparty: rec.account ?? null,
        decimalsAtEvent: XLM_DECIMALS,
      };
    }
    return null;
  }

  // payment / path_payment_strict_send / path_payment_strict_receive.
  if (type === "payment" || type === "path_payment_strict_send" || type === "path_payment_strict_receive") {
    const amount = rec.amount ?? "0";
    const native = isNativeAssetType(rec.asset_type);
    const assetId = resolveStellarAssetId(rec.asset_type);
    const decimals = decimalsForAssetType(rec.asset_type);

    if (rec.to === wallet && rec.from === wallet) {
      // Self-payment (rare) -- record as self, magnitude the amount.
      return {
        signedStroops: native ? decimalToStroops(amount) : null,
        signedDecimal: native ? null : amount.trim(),
        assetId,
        direction: "self",
        counterparty: wallet,
        currency: native ? undefined : rec.asset_code,
        issuer: native ? undefined : rec.asset_issuer,
        decimalsAtEvent: decimals,
      };
    }
    if (rec.to === wallet) {
      return {
        signedStroops: native ? decimalToStroops(amount) : null,
        signedDecimal: native ? null : amount.trim(),
        assetId,
        direction: "in",
        counterparty: rec.from ?? rec.source_account ?? null,
        currency: native ? undefined : rec.asset_code,
        issuer: native ? undefined : rec.asset_issuer,
        decimalsAtEvent: decimals,
      };
    }
    if (rec.from === wallet) {
      return {
        signedStroops: native ? decimalToStroops("-" + amount) : null,
        signedDecimal: native ? null : "-" + amount.trim(),
        assetId,
        direction: "out",
        counterparty: rec.to ?? null,
        currency: native ? undefined : rec.asset_code,
        issuer: native ? undefined : rec.asset_issuer,
        decimalsAtEvent: decimals,
      };
    }
    return null;
  }

  // account_merge: the exact XLM amount isn't in this op record. Record a
  // zero-amount "other" leg so the event is preserved (never guess a number).
  if (type === "account_merge") {
    if (rec.into === wallet) {
      return {
        signedStroops: "0",
        signedDecimal: null,
        assetId: XLM_ASSET_ID,
        direction: "in",
        counterparty: rec.account ?? rec.source_account ?? null,
        decimalsAtEvent: XLM_DECIMALS,
      };
    }
    if (rec.account === wallet || rec.source_account === wallet) {
      return {
        signedStroops: "0",
        signedDecimal: null,
        assetId: XLM_ASSET_ID,
        direction: "out",
        counterparty: rec.into ?? null,
        decimalsAtEvent: XLM_DECIMALS,
      };
    }
    return null;
  }

  return null;
}

/**
 * Classify a Stellar payment leg into our tax taxonomy. Conservative first pass:
 *   - create_account / payment / path_payment -> "transfer"
 *   - account_merge                            -> "other"
 * A 1-stroop inbound native payment is flagged as dust by the caller; the type
 * stays "transfer" but the `dust` flag lets valuation ignore it.
 */
export function classifyStellarLeg(recType: string | undefined): TxType {
  switch (recType) {
    case "create_account":
    case "payment":
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      return "transfer";
    case "account_merge":
      return "other";
    default:
      return "other";
  }
}

/** Is this a 1-stroop (dust/spam) native inbound leg? Economically zero. */
export function isDustLeg(assetId: string | null, signedStroops: string | null, direction: TxDirection): boolean {
  if (assetId !== XLM_ASSET_ID || signedStroops === null) return false;
  if (direction !== "in") return false;
  const canon = normalizeMinorUnits(signedStroops);
  return canon === XLM_DUST_STROOPS;
}

/**
 * Map ONE Horizon payment record, from the tracked wallet's perspective, into
 * zero or one MappedTransaction leg. Returns [] for a record that doesn't move
 * the wallet's value. The eventIndex is 0 (Horizon gives one operation per
 * record; the natural key is tx_hash + operation id, and we use the op id as
 * the hash suffix to keep the (wallet, tx_hash, event_index) key unique even
 * when a single transaction contains multiple payment operations).
 */
export function mapStellarPayment(wallet: string, rec: HorizonPaymentRecord): MappedTransaction[] {
  const leg = computeStellarLeg(wallet, rec);
  if (leg === null) return [];

  const txHash = rec.transaction_hash ?? "";
  // A Stellar transaction can bundle several payment ops. Use the operation id
  // as the event_index dimension so each op is a distinct, idempotent row.
  const eventIndex = operationEventIndex(rec.id);

  const dust = isDustLeg(leg.assetId, leg.signedStroops, leg.direction);

  return [
    {
      txHash,
      eventIndex,
      assetId: leg.assetId,
      chain: STELLAR_CHAIN,
      direction: leg.direction,
      txType: classifyStellarLeg(rec.type),
      amountRaw: leg.signedStroops,
      amountDecimal: leg.signedDecimal,
      decimalsAtEvent: leg.decimalsAtEvent,
      feeRaw: null,
      feeAssetId: null,
      counterparty: leg.counterparty,
      blockNumber: null,
      blockTime: parseCreatedAt(rec.created_at),
      currency: leg.currency,
      issuer: leg.issuer,
      success: rec.transaction_successful !== false,
      dust,
    },
  ];
}

/**
 * Derive a stable, small integer event index from a Horizon operation id. The
 * op id is a huge int64-in-a-string; we fold it into a non-negative 31-bit int
 * deterministically so distinct ops within one tx get distinct indexes while
 * staying inside a Postgres integer column. Collisions across DIFFERENT txs are
 * harmless because the natural key also includes tx_hash.
 */
export function operationEventIndex(opId: string | undefined): number {
  if (typeof opId !== "string" || opId.length === 0) return 0;
  // Use the last 9 digits (fits in 2^31) if purely numeric; else hash the string.
  if (/^\d+$/.test(opId)) {
    const tail = opId.slice(-9);
    const n = Number(tail);
    return Number.isFinite(n) ? n % 2147483647 : 0;
  }
  let h = 0;
  for (let i = 0; i < opId.length; i++) {
    h = (h * 31 + opId.charCodeAt(i)) % 2147483647;
  }
  return h < 0 ? h + 2147483647 : h;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`stellar-map-core self-test FAILED: ${name}`);
}

function throws(name: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`stellar-map-core self-test FAILED (expected throw): ${name}`);
}

export function __runStellarMapCoreTests(): void {
  const WALLET = "GA5G6NOV57S267XTVZFZYAED2JKPYEBL7X73XZ62B2KIMU237NBGHPMT";
  const OTHER = "GDDESEZ2IJUUVGWTCEXJ6QKP6FCO6VMGDD6LMDPIGOSNLAM6XZEZMPRR";

  // Sanity: the XLM asset is modeled with 7 verified decimals.
  const xlm = CRYPTO_ASSETS.find((a) => a.id === XLM_ASSET_ID);
  check("XLM asset present", !!xlm && xlm.chain === "stellar" && xlm.decimals === 7);

  // decimalToStroops -- exact, string math
  check("whole", decimalToStroops("1") === "10000000");
  check("live balance 279.6501307", decimalToStroops("279.6501307") === "2796501307");
  check("dust 0.0000001", decimalToStroops("0.0000001") === "1");
  check("zero", decimalToStroops("0") === "0");
  check("zero decimal", decimalToStroops("0.0000000") === "0");
  check("trailing zeros trimmed to stroop", decimalToStroops("1.5000000") === "15000000");
  check("negative", decimalToStroops("-2.5") === "-25000000");
  check("no-frac big", decimalToStroops("100000000") === "1000000000000000");
  throws("reject float garbage", () => decimalToStroops("abc"));
  throws("reject too many decimals", () => decimalToStroops("1.12345678"));
  throws("reject scientific", () => decimalToStroops("1e7"));

  // asset resolution
  check("native -> xlm", resolveStellarAssetId("native") === XLM_ASSET_ID);
  check("credit -> null", resolveStellarAssetId("credit_alphanum4") === null);
  check("native decimals 7", decimalsForAssetType("native") === 7);
  check("issued decimals null", decimalsForAssetType("credit_alphanum12") === null);

  // balance mapping
  const nativeBal = mapStellarBalance({ balance: "279.6501307", asset_type: "native" });
  check("native bal asset", nativeBal.assetId === XLM_ASSET_ID);
  check("native bal stroops", nativeBal.amountRaw === "2796501307");
  check("native bal decimals", nativeBal.decimalsAtRead === 7);
  const issuedBal = mapStellarBalance({ balance: "10.0", asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: OTHER });
  check("issued bal untracked", issuedBal.assetId === null && issuedBal.amountDecimal === "10.0" && issuedBal.currency === "USDC");

  const balances = mapStellarBalances([
    { balance: "279.6501307", asset_type: "native" },
    { balance: "0.0000000", asset_type: "native" }, // zero -> dropped
  ]);
  check("balances drop zero", balances.length === 1 && balances[0].amountRaw === "2796501307");

  // payment leg: inbound dust (the exact spam Michael receives)
  const dustRec: HorizonPaymentRecord = {
    id: "247572957302546493",
    paging_token: "247572957302546493",
    type: "payment",
    transaction_hash: "36c79aebc14c15f7e0cb7a41fcd22f86db390f348c1393ac77e320998880e84d",
    transaction_successful: true,
    created_at: "2025-06-21T01:52:05Z",
    source_account: OTHER,
    from: OTHER,
    to: WALLET,
    asset_type: "native",
    amount: "0.0000001",
  };
  const dustLegs = mapStellarPayment(WALLET, dustRec);
  check("dust one leg", dustLegs.length === 1);
  check("dust direction in", dustLegs[0].direction === "in");
  check("dust amount 1 stroop", dustLegs[0].amountRaw === "1");
  check("dust flagged", dustLegs[0].dust === true);
  check("dust type transfer", dustLegs[0].txType === "transfer");
  check("dust blockTime iso", dustLegs[0].blockTime === "2025-06-21T01:52:05.000Z");
  check("dust hash preserved", dustLegs[0].txHash === "36c79aebc14c15f7e0cb7a41fcd22f86db390f348c1393ac77e320998880e84d");

  // payment leg: outbound real amount
  const outRec: HorizonPaymentRecord = {
    id: "900000000000000001",
    type: "payment",
    transaction_hash: "hashOUT",
    transaction_successful: true,
    created_at: "2018-04-01T00:00:00Z",
    from: WALLET,
    to: OTHER,
    asset_type: "native",
    amount: "100.0",
  };
  const outLegs = mapStellarPayment(WALLET, outRec);
  check("out direction", outLegs[0].direction === "out");
  check("out signed negative", outLegs[0].amountRaw === "-1000000000");
  check("out not dust", outLegs[0].dust !== true);

  // create_account: wallet is created (funded IN)
  const createRec: HorizonPaymentRecord = {
    id: "123456789012345678",
    type: "create_account",
    transaction_hash: "hashCREATE",
    transaction_successful: true,
    created_at: "2018-03-17T00:00:00Z",
    funder: OTHER,
    account: WALLET,
    starting_balance: "1000.0000000",
  };
  const createLegs = mapStellarPayment(WALLET, createRec);
  check("create in", createLegs[0].direction === "in");
  check("create amount", createLegs[0].amountRaw === "10000000000");
  check("create counterparty funder", createLegs[0].counterparty === OTHER);

  // create_account: wallet is the funder (value OUT)
  const fundRec: HorizonPaymentRecord = {
    id: "123456789012345679",
    type: "create_account",
    transaction_hash: "hashFUND",
    from: WALLET,
    funder: WALLET,
    account: OTHER,
    starting_balance: "5.0",
  };
  const fundLegs = mapStellarPayment(WALLET, fundRec);
  check("fund out", fundLegs[0].direction === "out" && fundLegs[0].amountRaw === "-50000000");

  // issued-token payment stays untracked (assetId null, decimal kept)
  const issuedRec: HorizonPaymentRecord = {
    id: "555",
    type: "payment",
    transaction_hash: "hashUSDC",
    from: OTHER,
    to: WALLET,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: OTHER,
    amount: "12.5",
  };
  const issuedLegs = mapStellarPayment(WALLET, issuedRec);
  check("issued untracked", issuedLegs[0].assetId === null && issuedLegs[0].amountDecimal === "12.5" && issuedLegs[0].currency === "USDC");

  // account_merge into wallet -> in, zero amount (never guessed)
  const mergeRec: HorizonPaymentRecord = {
    id: "777",
    type: "account_merge",
    transaction_hash: "hashMERGE",
    account: OTHER,
    into: WALLET,
  };
  const mergeLegs = mapStellarPayment(WALLET, mergeRec);
  check("merge in", mergeLegs[0].direction === "in" && mergeLegs[0].amountRaw === "0" && mergeLegs[0].txType === "other");

  // a record that doesn't involve the wallet -> no leg
  const noneRec: HorizonPaymentRecord = { id: "1", type: "payment", from: OTHER, to: OTHER, asset_type: "native", amount: "1.0" };
  check("unrelated -> no leg", mapStellarPayment(WALLET, noneRec).length === 0);

  // operationEventIndex determinism + range
  check("opId numeric tail", operationEventIndex("247572957302546493") === (302546493 % 2147483647));
  check("opId empty -> 0", operationEventIndex(undefined) === 0);
  check("opId stable", operationEventIndex("abc") === operationEventIndex("abc"));
  check("opId non-negative", operationEventIndex("zzzzzzzzz") >= 0);

  // classify
  check("classify payment transfer", classifyStellarLeg("payment") === "transfer");
  check("classify create transfer", classifyStellarLeg("create_account") === "transfer");
  check("classify merge other", classifyStellarLeg("account_merge") === "other");
  check("classify unknown other", classifyStellarLeg("bump_sequence") === "other");

  // parseCreatedAt
  check("createdAt parses", parseCreatedAt("2025-06-21T01:52:05Z") === "2025-06-21T01:52:05.000Z");
  check("createdAt blank null", parseCreatedAt("") === null);
  check("createdAt garbage null", parseCreatedAt("not-a-date") === null);

  console.log("stellar-map-core self-tests: all passed");
}
