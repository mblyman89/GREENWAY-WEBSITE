/**
 * src/lib/crypto/crypto-core.ts  (C0 — Crypto Portfolio Integration, SLICE ONE)
 *
 * PURE primitives for Greenway's watch-only crypto-portfolio feature. No I/O, no
 * network, no database — just deterministic money/asset math so every later
 * slice (XRPL connector, Subsquid indexer, valuation, cost-basis, tax exports)
 * rests on one audited foundation. Unit-testable with tsx; self-test at bottom.
 *
 * WHY THIS EXISTS (the IRS-bulletproof reason):
 * Crypto tax math is only as trustworthy as the number handling underneath it.
 * JavaScript floating point silently corrupts large token amounts (e.g. 18-dec
 * ETH wei exceeds 2^53), and different chains express "how much" in totally
 * different ways. If we ever let a float touch a balance, every downstream 8949
 * line is suspect. So this module NEVER uses floating point for token amounts.
 *
 * TWO AMOUNT MODELS (verified against first-party sources, 2026-08-10):
 *   1. EVM  ("evm")  — integer minor units + a fixed `decimals` count.
 *                      ETH=18, USDT-on-ETH=6, FLR=18, SGB=18. Amounts arrive as
 *                      base-10 integer strings (wei / smallest unit). We keep
 *                      them as bigint-backed integer strings — exact, no drift.
 *   2. XRPL ("xrpl") — XRP itself is 6-decimal integer "drops" (1 XRP = 1e6
 *                      drops), so it is ALSO an integer-minor-unit model.
 *                      BUT issued tokens (SOLO, USDT-on-XRPL) are NOT fixed-
 *                      decimal integers; the XRPL delivers them as decimal
 *                      strings with up to 15 significant digits (e.g. "153.75").
 *                      We preserve that decimal string verbatim and do exact
 *                      decimal math on it — never as an ERC-20-style integer.
 *
 * Modelling SOLO as "18 decimals" would corrupt tax figures — so we don't.
 *
 * STANDING RULE: money is integer minor units where a minor unit exists; USD is
 * integer cents. No floats for value anywhere in this file.
 */

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/**
 * The chains Greenway holds assets on. Three technology families:
 *   - EVM     : ethereum, flare, songbird (0x… addresses, integer minor units)
 *   - XRPL    : xrpl                       (r… addresses)
 *   - Cosmos  : coreum                     (core1… bech32 addresses; hosts
 *                                           Coreum-native assets AND Pulsara,
 *                                           which is a DeFi ecosystem built ON
 *                                           Coreum — same chain/address)
 */
export type Chain = "ethereum" | "flare" | "songbird" | "xrpl" | "coreum";

export const CHAINS: readonly Chain[] = [
  "ethereum",
  "flare",
  "songbird",
  "xrpl",
  "coreum",
] as const;

/** Human labels for the UI (plain English for Michael). */
export const CHAIN_LABELS: Record<Chain, string> = {
  ethereum: "Ethereum",
  flare: "Flare",
  songbird: "Songbird",
  xrpl: "XRP Ledger",
  coreum: "Coreum",
};

/** EVM chains use 0x… addresses and integer-minor-unit amounts. */
export function isEvmChain(chain: Chain): boolean {
  return chain === "ethereum" || chain === "flare" || chain === "songbird";
}

/** Cosmos SDK chains use bech32 (core1…) addresses and integer minor units. */
export function isCosmosChain(chain: Chain): boolean {
  return chain === "coreum";
}

/** The bech32 human-readable prefix for each Cosmos chain's account addresses. */
export const COSMOS_ADDRESS_PREFIX: Record<"coreum", string> = {
  coreum: "core",
};

/** Cosmos chain-ids (verified via Polkachu, 2026-08-10). */
export const COSMOS_CHAIN_ID: Record<"coreum", string> = {
  coreum: "coreum-mainnet-1",
};

/** EVM numeric chain IDs (verified via Subsquid EVM registry, 2026-08-10). */
export const EVM_CHAIN_ID: Record<"ethereum" | "flare" | "songbird", number> = {
  ethereum: 1,
  flare: 14,
  songbird: 19,
};

// ---------------------------------------------------------------------------
// Amount models
// ---------------------------------------------------------------------------

/**
 * How an asset expresses "how much":
 *   - "evm-minor": integer smallest-unit + fixed `decimals` (wei-style). Used by
 *     ETH, all ERC-20s, FLR, SGB, and XRP drops.
 *   - "xrpl-issued": decimal string, up to 15 significant digits, no fixed
 *     decimals. Used by XRPL issued tokens (SOLO, USDT-on-XRPL).
 */
export type AmountModel = "evm-minor" | "xrpl-issued";

/** Max significant digits an XRPL issued-token amount may carry (protocol rule). */
export const XRPL_ISSUED_SIG_DIGITS = 15;

// bigint constants (project targets ES2017, so no `0n`/`10n` literals).
const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_TWO = BigInt(2);
const BI_TEN = BigInt(10);

// ---------------------------------------------------------------------------
// Asset registry (verified decimals / issuers, 2026-08-10 — never guess)
// ---------------------------------------------------------------------------

export interface CryptoAsset {
  /** Stable key we use internally, e.g. "eth", "usdt-eth", "solo". */
  id: string;
  /** Ticker shown in UI. */
  symbol: string;
  /** Full name shown in UI. */
  name: string;
  /** Which chain this asset lives on. */
  chain: Chain;
  /** How amounts are expressed. */
  amountModel: AmountModel;
  /**
   * For "evm-minor" assets: the fixed decimal count (18 for ETH/FLR/SGB, 6 for
   * USDT, 6 for XRP drops, 6 for Cosmos micro-denoms). Undefined for
   * "xrpl-issued" assets. For Cosmos assets this is the KNOWN convention value
   * but the connector slice re-confirms it from live denom-metadata before it is
   * used in tax math (see `decimalsSource`).
   */
  decimals?: number;
  /**
   * Provenance of `decimals` so tax math is auditable and never a silent guess:
   *   - "verified"      : confirmed against a first-party source (Etherscan,
   *                       XRPL protocol, chain registry).
   *   - "denom-convention": Cosmos micro-denom (`u…` = 6) by SDK convention;
   *                       MUST be re-confirmed from live `denoms_metadata` in the
   *                       connector slice before use in valuation/cost-basis.
   *   - "issued-precision": XRPL issued token (no fixed decimals; decimal-string).
   */
  decimalsSource: "verified" | "denom-convention" | "issued-precision";
  /**
   * true for the chain's native gas/stake coin (ETH, FLR, SGB, XRP, and Coreum's
   * native coin); false for tokens.
   */
  native: boolean;
  /** ERC-20 contract address (lower-cased), for EVM tokens only. */
  contract?: string;
  /** XRPL issuer account (r…) and currency code, for XRPL issued tokens only. */
  issuer?: string;
  currencyCode?: string;
  /** Cosmos base denom (e.g. "ucore"), for Cosmos assets only. */
  denom?: string;
  /**
   * If this asset is being migrated/merged into another asset (e.g. CORE→TX,
   * SOLO→TX), the id of the destination asset. We KEEP the original asset and
   * its history and link it forward — cost basis is never erased. The exact
   * conversion ratio is NOT encoded here (verified per-event at migration time).
   */
  migratesToAssetId?: string;
}

/**
 * The assets Michael holds, plus their VERIFIED number formats.
 *
 * EVM (Ethereum family):
 *   ETH        native, 18 dec (verified)
 *   USDT-ETH   ERC-20, 6 dec, contract 0xdac1…ec7 (verified on Etherscan)
 *   FLR        native, 18 dec (verified)
 *   SGB        native, 18 dec (verified)
 * XRP Ledger:
 *   XRP        native "drops", 6 dec integer (verified)
 *   SOLO       XRPL issued token, 15-sig-digit decimal string, issuer rsoLo2…
 *              → MIGRATING to TX (Michael must convert; keep-history, links to `tx`)
 * Cosmos (Coreum; Pulsara is a DeFi ecosystem ON Coreum → same chain):
 *   TX         Coreum native coin (formerly CORE — CORE auto-converted to TX in
 *              Michael's wallet). Micro-denom → 6 dec by convention, re-confirmed
 *              from live denom-metadata in the connector slice.
 *   SARA       Pulsara governance token on Coreum (a Coreum-issued token). Decimals
 *              read from live denom-metadata in the connector slice.
 *
 * NOTE: We keep SOLO as its own asset (Michael still holds it pre-conversion) and
 * link it forward to TX via `migratesToAssetId`. We do NOT encode a conversion
 * ratio here — that is verified per-event when the SOLO→TX conversion is recorded.
 */
export const CRYPTO_ASSETS: readonly CryptoAsset[] = [
  {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    chain: "ethereum",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: true,
  },
  {
    id: "usdt-eth",
    symbol: "USDT",
    name: "Tether USD (Ethereum)",
    chain: "ethereum",
    amountModel: "evm-minor",
    decimals: 6,
    decimalsSource: "verified",
    native: false,
    contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  },
  {
    id: "flr",
    symbol: "FLR",
    name: "Flare",
    chain: "flare",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: true,
  },
  {
    id: "sgb",
    symbol: "SGB",
    name: "Songbird",
    chain: "songbird",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: true,
  },
  {
    id: "xrp",
    symbol: "XRP",
    name: "XRP",
    chain: "xrpl",
    amountModel: "evm-minor", // drops: 6-dec integer minor units
    decimals: 6,
    decimalsSource: "verified",
    native: true,
  },
  {
    id: "solo",
    symbol: "SOLO",
    name: "Sologenic",
    chain: "xrpl",
    amountModel: "xrpl-issued",
    decimalsSource: "issued-precision",
    native: false,
    issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
    currencyCode: "SOLO",
    migratesToAssetId: "tx", // SOLO → TX (pending conversion; keep-history)
  },
  {
    id: "tx",
    symbol: "TX",
    name: "TX (Coreum)",
    chain: "coreum",
    amountModel: "evm-minor", // Cosmos integer minor units + decimals
    // VERIFIED (BitGo Coreum docs): base unit `ucoreum`, 1 Coreum = 1,000,000 ucoreum → 6 dec.
    decimals: 6,
    decimalsSource: "verified",
    native: true,
    denom: "ucoreum", // Coreum base denom (microcoreum) — verified via BitGo docs
  },
  {
    id: "sara",
    symbol: "SARA",
    name: "Pulsara",
    chain: "coreum",
    amountModel: "evm-minor",
    decimals: 6, // placeholder by convention; read from live denom-metadata
    decimalsSource: "denom-convention",
    native: false,
    // Coreum-issued token denom is read live in the connector slice (never guessed).
  },
] as const;

const ASSET_BY_ID: Record<string, CryptoAsset> = Object.fromEntries(
  CRYPTO_ASSETS.map((a) => [a.id, a]),
);

/** Look up an asset by id, or undefined. */
export function getAsset(id: string): CryptoAsset | undefined {
  return ASSET_BY_ID[id];
}

// ---------------------------------------------------------------------------
// Transaction taxonomy
// ---------------------------------------------------------------------------

/** Which way value moved relative to the tracked wallet. */
export type TxDirection = "in" | "out" | "self";

/**
 * What kind of on-chain activity a transaction represents. Rich enough to make
 * the ledger IRS-defensible and to handle Michael's DeFi / liquidity-pool history.
 */
export type TxType =
  | "transfer" // plain send/receive
  | "swap" // token A → token B (a taxable disposal)
  | "lp_add" // deposit into a liquidity pool
  | "lp_remove" // withdraw from a liquidity pool
  | "reward" // staking / farming / airdrop received (income)
  | "fee" // gas / network fee paid
  | "other"; // unclassified until C12 refines it

export const TX_TYPES: readonly TxType[] = [
  "transfer",
  "swap",
  "lp_add",
  "lp_remove",
  "reward",
  "fee",
  "other",
] as const;

/** true for the tx types the IRS generally treats as a taxable disposal. */
export function isDisposalType(type: TxType): boolean {
  return type === "swap" || type === "lp_add" || type === "lp_remove";
}

// ---------------------------------------------------------------------------
// String-safe integer-minor-unit math (EVM model)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw integer-minor-unit amount (wei / drops / smallest token unit)
 * to a canonical base-10 integer string. Accepts a bigint, a number that is a
 * safe integer, or a base-10 digit string (optionally signed). Rejects floats,
 * NaN, and non-numeric strings — because a silently-mangled amount is worse than
 * an error.
 */
export function normalizeMinorUnits(raw: bigint | number | string): string {
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new Error(`normalizeMinorUnits: non-integer number ${raw}`);
    }
    if (!Number.isSafeInteger(raw)) {
      throw new Error(
        `normalizeMinorUnits: number ${raw} exceeds safe-integer range; pass a string or bigint`,
      );
    }
    return BigInt(raw).toString();
  }
  const s = raw.trim();
  if (!/^-?\d+$/.test(s)) {
    throw new Error(`normalizeMinorUnits: not an integer string: ${JSON.stringify(raw)}`);
  }
  // BigInt round-trip canonicalises (strips leading zeros, "-0" → "0").
  return BigInt(s).toString();
}

/**
 * Format an integer-minor-unit amount as a human decimal string with the given
 * number of `decimals`. Exact — uses bigint, never Number. E.g.
 * formatTokenAmount("1500000", 6) === "1.5" (USDT). Trailing zeros trimmed.
 */
export function formatTokenAmount(minor: bigint | number | string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`formatTokenAmount: bad decimals ${decimals}`);
  }
  const canon = normalizeMinorUnits(minor);
  const neg = canon.startsWith("-");
  const digits = neg ? canon.slice(1) : canon;
  if (decimals === 0) return (neg ? "-" : "") + digits;

  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  let frac = padded.slice(padded.length - decimals);
  frac = frac.replace(/0+$/, ""); // trim trailing zeros
  const body = frac.length > 0 ? `${whole}.${frac}` : whole;
  return (neg ? "-" : "") + body;
}

// ---------------------------------------------------------------------------
// XRPL issued-token decimal-string handling (xrpl-issued model)
// ---------------------------------------------------------------------------

/**
 * Validate + canonicalise an XRPL issued-token amount (a decimal string with up
 * to 15 significant digits). Preserves the value exactly as a decimal string;
 * does NOT convert to float. Rejects >15 significant digits and non-decimal
 * input. Canonical form trims insignificant leading/trailing zeros but keeps the
 * value identical (e.g. "00153.750" → "153.75", "0.0100" → "0.01").
 */
export function normalizeXrplIssuedAmount(raw: string | number): string {
  const s = typeof raw === "number" ? String(raw) : raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`normalizeXrplIssuedAmount: not a decimal string: ${JSON.stringify(raw)}`);
  }
  const neg = s.startsWith("-");
  const unsigned = neg ? s.slice(1) : s;
  const [intPartRaw, fracPartRaw = ""] = unsigned.split(".");
  // Strip insignificant zeros for the sig-digit count and canonical form.
  const intPart = intPartRaw.replace(/^0+/, "");
  const fracPart = fracPartRaw.replace(/0+$/, "");

  // Count significant digits (leading zeros never significant).
  let sig: string;
  if (intPart.length > 0) {
    sig = intPart + fracPart;
  } else {
    // 0.00x… — leading fractional zeros are not significant.
    sig = fracPart.replace(/^0+/, "");
  }
  if (sig.length > XRPL_ISSUED_SIG_DIGITS) {
    throw new Error(
      `normalizeXrplIssuedAmount: ${sig.length} significant digits exceeds XRPL max ${XRPL_ISSUED_SIG_DIGITS}`,
    );
  }

  const canonInt = intPart.length > 0 ? intPart : "0";
  const canon = fracPart.length > 0 ? `${canonInt}.${fracPart}` : canonInt;
  if (canon === "0") return "0"; // normalise -0 → 0
  return (neg ? "-" : "") + canon;
}

// ---------------------------------------------------------------------------
// USD valuation → integer cents (deterministic, no float)
// ---------------------------------------------------------------------------

/**
 * Compute the USD value, in integer cents, of a token amount at a given unit
 * price. Deterministic and float-free:
 *   - `amountDecimal` is the human decimal string of the token amount
 *     (e.g. "1.5" ETH) — from formatTokenAmount or normalizeXrplIssuedAmount.
 *   - `priceCentsPerUnit` is the USD price of ONE whole token, in integer cents
 *     scaled by `priceScale` extra decimals for sub-cent precision. With
 *     priceScale = 6, a price of $1,234.567890 is passed as 1234567890.
 * Returns rounded-half-up integer cents. All math via bigint on scaled integers.
 */
export function usdValueCents(
  amountDecimal: string,
  priceScaledCents: bigint | number | string,
  priceScale: number,
): number {
  if (!Number.isInteger(priceScale) || priceScale < 0 || priceScale > 18) {
    throw new Error(`usdValueCents: bad priceScale ${priceScale}`);
  }
  const price = BigInt(normalizeMinorUnits(priceScaledCents)); // cents * 10^priceScale
  if (price < BI_ZERO) throw new Error("usdValueCents: negative price");

  // Split amountDecimal into scaled integer (amount * 10^amtScale).
  const s = amountDecimal.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`usdValueCents: bad amount ${JSON.stringify(amountDecimal)}`);
  }
  const neg = s.startsWith("-");
  const unsigned = neg ? s.slice(1) : s;
  const [ip, fp = ""] = unsigned.split(".");
  const amtScale = fp.length;
  const amountScaled = BigInt((ip || "0") + fp); // amount * 10^amtScale

  // value_cents = amountScaled/10^amtScale * price/10^priceScale
  //            = amountScaled * price / 10^(amtScale + priceScale)
  const numer = amountScaled * price;
  const denom = BI_TEN ** BigInt(amtScale + priceScale);
  // Round half up.
  const twice = numer * BI_TWO;
  const denomTwice = denom * BI_TWO;
  let cents = twice / denomTwice;
  const remainder = twice % denomTwice;
  if (remainder >= denom) cents += BI_ONE;

  const signed = neg ? -cents : cents;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("usdValueCents: result exceeds safe-integer cents range");
  }
  return Number(signed);
}

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

/** EVM address: 0x + 40 hex chars (case-insensitive; we do not verify checksum). */
export function isEvmAddress(addr: string): boolean {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

/**
 * XRPL classic address: base58 (ripple alphabet), starts with 'r', 25–35 chars.
 * We validate shape only (not the checksum) — enough to reject typos/EVM inputs.
 */
export function isXrplAddress(addr: string): boolean {
  return (
    typeof addr === "string" &&
    /^r[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{24,34}$/.test(addr.trim())
  );
}

/**
 * Cosmos bech32 account address (e.g. Coreum `core1…`). We validate the shape:
 * the human-readable prefix, the required `1` separator, and the bech32 data
 * charset (which excludes `1`, `b`, `i`, `o`). We do not verify the checksum —
 * enough to reject typos, EVM/XRPL addresses, and wrong-chain prefixes.
 */
export function isCosmosAddress(addr: string, prefix: string): boolean {
  if (typeof addr !== "string" || typeof prefix !== "string" || prefix.length === 0) {
    return false;
  }
  const s = addr.trim();
  // prefix + "1" + 6..no bech32 data chars (Cosmos account bodies are 38 chars).
  const re = new RegExp(`^${prefix}1[023456789acdefghjklmnpqrstuvwxyz]{38,58}$`);
  return re.test(s);
}

/** Validate an address for a given chain. */
export function isValidAddressForChain(chain: Chain, addr: string): boolean {
  if (isEvmChain(chain)) return isEvmAddress(addr);
  if (isCosmosChain(chain)) {
    // `chain` is narrowed to a Cosmos chain here.
    return isCosmosAddress(addr, COSMOS_ADDRESS_PREFIX[chain as "coreum"]);
  }
  return isXrplAddress(addr);
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCryptoCoreTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }
  function throws(name: string, fn: () => unknown) {
    try {
      fn();
      failures += 1;
      console.error(`  FAIL - ${name} (expected throw)`);
    } catch {
      console.log(`  ok - ${name}`);
    }
  }

  // Chains
  expect("5 chains", CHAINS.length === 5);
  expect("ethereum is evm", isEvmChain("ethereum"));
  expect("flare is evm", isEvmChain("flare"));
  expect("songbird is evm", isEvmChain("songbird"));
  expect("xrpl is NOT evm", !isEvmChain("xrpl"));
  expect("coreum is NOT evm", !isEvmChain("coreum"));
  expect("coreum is cosmos", isCosmosChain("coreum"));
  expect("ethereum is NOT cosmos", !isCosmosChain("ethereum"));
  expect("xrpl is NOT cosmos", !isCosmosChain("xrpl"));
  expect("eth chainId 1", EVM_CHAIN_ID.ethereum === 1);
  expect("flare chainId 14", EVM_CHAIN_ID.flare === 14);
  expect("coreum chain-id", COSMOS_CHAIN_ID.coreum === "coreum-mainnet-1");
  expect("coreum addr prefix", COSMOS_ADDRESS_PREFIX.coreum === "core");

  // Asset registry — verified decimals/issuers
  expect("8 assets", CRYPTO_ASSETS.length === 8);
  expect("ETH 18 dec", getAsset("eth")?.decimals === 18);
  expect("ETH decimals verified", getAsset("eth")?.decimalsSource === "verified");
  expect("USDT 6 dec", getAsset("usdt-eth")?.decimals === 6);
  expect(
    "USDT contract lowercased",
    getAsset("usdt-eth")?.contract === "0xdac17f958d2ee523a2206206994597c13d831ec7",
  );
  expect("FLR 18 dec", getAsset("flr")?.decimals === 18);
  expect("SGB 18 dec", getAsset("sgb")?.decimals === 18);
  expect("XRP 6 dec drops", getAsset("xrp")?.decimals === 6);
  expect("XRP is evm-minor model", getAsset("xrp")?.amountModel === "evm-minor");
  expect("SOLO is xrpl-issued model", getAsset("solo")?.amountModel === "xrpl-issued");
  expect("SOLO has NO fixed decimals", getAsset("solo")?.decimals === undefined);
  expect("SOLO issuer set", getAsset("solo")?.issuer === "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz");
  expect("SOLO source issued-precision", getAsset("solo")?.decimalsSource === "issued-precision");
  // Coreum / Pulsara (Cosmos) + the TX migration mapping
  expect("TX on coreum", getAsset("tx")?.chain === "coreum");
  expect("TX native", getAsset("tx")?.native === true);
  expect("TX denom ucoreum", getAsset("tx")?.denom === "ucoreum");
  expect("TX 6 dec (verified)", getAsset("tx")?.decimals === 6);
  expect("TX decimals verified", getAsset("tx")?.decimalsSource === "verified");
  expect("SARA on coreum", getAsset("sara")?.chain === "coreum");
  expect("SARA is a token (not native)", getAsset("sara")?.native === false);
  expect("SOLO migrates to TX", getAsset("solo")?.migratesToAssetId === "tx");
  expect("ETH does not migrate", getAsset("eth")?.migratesToAssetId === undefined);
  expect("unknown asset undefined", getAsset("nope") === undefined);

  // Tx taxonomy
  expect("7 tx types", TX_TYPES.length === 7);
  expect("swap is disposal", isDisposalType("swap"));
  expect("lp_add is disposal", isDisposalType("lp_add"));
  expect("lp_remove is disposal", isDisposalType("lp_remove"));
  expect("transfer is NOT disposal", !isDisposalType("transfer"));
  expect("reward is NOT disposal", !isDisposalType("reward"));

  // normalizeMinorUnits
  expect("bigint → string", normalizeMinorUnits(BigInt(1500000)) === "1500000");
  expect("safe int → string", normalizeMinorUnits(1500000) === "1500000");
  expect("string passthrough", normalizeMinorUnits("1500000") === "1500000");
  expect("strip leading zeros", normalizeMinorUnits("000123") === "123");
  expect("negative ok", normalizeMinorUnits("-42") === "-42");
  expect("-0 → 0", normalizeMinorUnits("-0") === "0");
  expect(
    "huge wei string (beyond 2^53) exact",
    normalizeMinorUnits("1234567890123456789012") === "1234567890123456789012",
  );
  throws("reject float number", () => normalizeMinorUnits(1.5));
  throws("reject NaN", () => normalizeMinorUnits(NaN));
  throws("reject unsafe int number", () => normalizeMinorUnits(9007199254740993));
  throws("reject non-numeric string", () => normalizeMinorUnits("12.3"));
  throws("reject garbage string", () => normalizeMinorUnits("0xabc"));

  // formatTokenAmount
  expect("USDT 1500000/6 → 1.5", formatTokenAmount("1500000", 6) === "1.5");
  expect("1 ETH wei → 1", formatTokenAmount("1000000000000000000", 18) === "1");
  expect("1.5 ETH wei → 1.5", formatTokenAmount("1500000000000000000", 18) === "1.5");
  expect("sub-unit 0.000001 USDT", formatTokenAmount("1", 6) === "0.000001");
  expect("0 minor → 0", formatTokenAmount("0", 18) === "0");
  expect("decimals 0 passthrough", formatTokenAmount("42", 0) === "42");
  expect("negative format", formatTokenAmount("-1500000", 6) === "-1.5");
  expect("trim trailing zeros", formatTokenAmount("1230000", 6) === "1.23");
  expect(
    "big XRP drops 12,345,678 → 12.345678",
    formatTokenAmount("12345678", 6) === "12.345678",
  );

  // normalizeXrplIssuedAmount
  expect("plain decimal", normalizeXrplIssuedAmount("153.75") === "153.75");
  expect("strip leading zeros", normalizeXrplIssuedAmount("00153.750") === "153.75");
  expect("trim trailing zeros", normalizeXrplIssuedAmount("0.0100") === "0.01");
  expect("integer form", normalizeXrplIssuedAmount("100") === "100");
  expect("number input", normalizeXrplIssuedAmount(153.75) === "153.75");
  expect("negative", normalizeXrplIssuedAmount("-2.5") === "-2.5");
  expect("zero", normalizeXrplIssuedAmount("0.000") === "0");
  expect(
    "exactly 15 sig digits ok",
    normalizeXrplIssuedAmount("123456789.012345") === "123456789.012345",
  );
  throws("reject 16 sig digits", () => normalizeXrplIssuedAmount("1234567890123456"));
  throws("reject non-decimal", () => normalizeXrplIssuedAmount("1.2.3"));
  throws("reject hex", () => normalizeXrplIssuedAmount("0xff"));

  // usdValueCents — priceScale 6 means price passed as cents*1e6.
  // Prices below are passed as plain strings (cents * 1_000_000):
  //   $2000.00 → 200000 cents → "200000000000"
  //   $1.00    → 100 cents    → "100000000"
  //   $0.42    → 42 cents     → "42000000"
  // 1.5 ETH @ $2,000.00 → $3,000.00 → 300000 cents.
  expect("1.5 ETH @ $2000 = 300000 cents", usdValueCents("1.5", "200000000000", 6) === 300000);
  // 1000 USDT @ $1.00 → 100000 cents.
  expect("1000 USDT @ $1.00 = 100000 cents", usdValueCents("1000", "100000000", 6) === 100000);
  // 153.75 SOLO @ $0.42 → $64.575 → round half up → 6458 cents.
  expect("153.75 SOLO @ $0.42 = 6458 cents", usdValueCents("153.75", "42000000", 6) === 6458);
  // Rounding half-up boundary: value exactly 0.5 cents → rounds up to 1.
  // 1 unit, priceScaled = 0.5 cents * 1e6 = 500000.
  expect("half-up rounds to 1", usdValueCents("1", "500000", 6) === 1);
  // Just under half (0.4999 cents) → rounds down to 0.
  expect("below half rounds to 0", usdValueCents("1", "499900", 6) === 0);
  // Zero amount → 0.
  expect("zero amount → 0 cents", usdValueCents("0", "200000000000", 6) === 0);
  // Negative amount (a disposal debit) → negative cents.
  expect("negative amount", usdValueCents("-1.5", "200000000000", 6) === -300000);
  throws("reject negative price", () => usdValueCents("1", -1, 6));
  throws("reject bad priceScale", () => usdValueCents("1", 1, 99));
  throws("reject bad amount", () => usdValueCents("abc", 1, 6));

  // Address validation
  expect(
    "valid EVM addr",
    isEvmAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  );
  expect("EVM addr too short", !isEvmAddress("0x123"));
  expect("EVM addr no prefix", !isEvmAddress("dac17f958d2ee523a2206206994597c13d831ec7"));
  expect(
    "valid XRPL addr (sologenic issuer)",
    isXrplAddress("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz"),
  );
  expect("XRPL rejects EVM addr", !isXrplAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"));
  expect("EVM rejects XRPL addr", !isEvmAddress("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz"));
  expect(
    "isValidAddressForChain ethereum",
    isValidAddressForChain("ethereum", "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  );
  expect(
    "isValidAddressForChain xrpl",
    isValidAddressForChain("xrpl", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz"),
  );
  expect(
    "isValidAddressForChain rejects mismatch",
    !isValidAddressForChain("ethereum", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz"),
  );

  // Cosmos (Coreum) bech32 addresses. Fixture: BitGo's documented testnet-shaped
  // body applied to the mainnet `core` prefix (38-char bech32 body).
  const coreAddr = "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd";
  expect("valid Coreum addr", isCosmosAddress(coreAddr, "core"));
  expect("Coreum addr wrong prefix rejected", !isCosmosAddress(coreAddr, "cosmos"));
  expect("Cosmos rejects EVM addr", !isCosmosAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7", "core"));
  expect("Cosmos rejects XRPL addr", !isCosmosAddress("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", "core"));
  expect("Cosmos rejects empty prefix", !isCosmosAddress(coreAddr, ""));
  expect("EVM rejects Coreum addr", !isEvmAddress(coreAddr));
  expect("XRPL rejects Coreum addr", !isXrplAddress(coreAddr));
  expect("isValidAddressForChain coreum", isValidAddressForChain("coreum", coreAddr));
  expect(
    "isValidAddressForChain coreum rejects EVM",
    !isValidAddressForChain("coreum", "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  );
  expect(
    "isValidAddressForChain ethereum rejects Coreum",
    !isValidAddressForChain("ethereum", coreAddr),
  );

  if (failures > 0) throw new Error(`crypto-core self-tests: ${failures} failure(s)`);
  console.log("crypto-core self-tests: all passed");
}
