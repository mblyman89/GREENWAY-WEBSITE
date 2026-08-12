/**
 * src/lib/crypto/crypto-exchange-registry-core.ts
 *
 * R1-G2 — EXCHANGE-DEPOSIT-ADDRESS REGISTRY + LABELING (data + pure).
 *
 * The Origin Trace (R1-G1) terminates a coin's backwards trail when it reaches
 * an address known to belong to an exchange. This file is where those known
 * addresses live, plus the pure matcher the trace uses to ask "is this
 * counterparty an exchange origin, and which exchange?".
 *
 * Michael's exchange universe is exactly three: Coinbase, Bitrue, Binance
 * (bible §12). Coinbase is still alive (public API + he can pull CSVs); Bitrue
 * and Binance are gone, so for those the ONLY source of addresses is what
 * Michael himself can supply.
 *
 * NEVER-GUESS POLICY (critical here)
 * ---------------------------------------------------------------------------
 * We do NOT invent addresses. Every SEEDED entry below is a PUBLICLY-LABELED,
 * independently verifiable exchange address (Etherscan public labels). Each
 * carries `source: "verified_known"`. Everything else comes from Michael via
 * `source: "owner_labeled"` — addresses HE knows are an exchange deposit point
 * (e.g. read off a Coinbase withdrawal record) or that HE confirms are his own
 * old wallets. An address we are unsure about is simply NOT in the registry;
 * the trace then treats it as an unknown outside wallet and asks Michael to
 * confirm — it is never silently trusted.
 *
 * Pure: no I/O, no server-only imports, float-free, self-tested. Address
 * matching is case-insensitive (EVM hex is compared lower-cased; we never rely
 * on checksum casing).
 */
import type { Chain } from "./crypto-core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The three exchanges in Michael's universe. */
export type ExchangeLabel = "coinbase" | "bitrue" | "binance";

export const EXCHANGE_LABELS: readonly ExchangeLabel[] = ["coinbase", "bitrue", "binance"];

/** Human-friendly exchange names for the UI. */
export const EXCHANGE_DISPLAY_NAME: Record<ExchangeLabel, string> = {
  coinbase: "Coinbase",
  bitrue: "Bitrue",
  binance: "Binance",
};

/** Where a registry entry came from (evidence provenance). */
export type ExchangeAddressSource = "verified_known" | "owner_labeled";

/** One address known to belong to an exchange, on a specific chain. */
export interface ExchangeAddressEntry {
  /** The address (stored/compared lower-cased). */
  address: string;
  chain: Chain;
  exchange: ExchangeLabel;
  source: ExchangeAddressSource;
  /** Optional short provenance note (e.g. the public label it came from). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Seed registry — PUBLICLY-LABELED, verifiable addresses only.
// ---------------------------------------------------------------------------

/**
 * Coinbase Ethereum-mainnet addresses that are PUBLICLY LABELED on Etherscan
 * (label attribution: Etherscan public account labels). These are widely
 * published and cross-verifiable — safe to seed as "verified_known".
 *
 * Bitrue and Binance are intentionally absent: Michael's accounts there are
 * gone and we will not fabricate deposit addresses. Those come only from
 * owner-labeled entries (addresses Michael supplies from his own records).
 */
export const SEED_EXCHANGE_ADDRESSES: readonly ExchangeAddressEntry[] = [
  {
    address: "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase 1",
  },
  {
    address: "0x503828976d22510aad0201ac7ec88293211d23da",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase 2",
  },
  {
    address: "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase 3",
  },
  {
    address: "0x3cd751e6b0078be393132286c442345e5dc49699",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase 4",
  },
  {
    address: "0x7830c87c02e56aff27fa8ab1241711331fa86f43",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase: Deposit",
  },
  {
    address: "0xcd531ae9efcce479654c4926dec5f6209531ca7b",
    chain: "ethereum",
    exchange: "coinbase",
    source: "verified_known",
    note: "Etherscan public label: Coinbase Prime 1",
  },
];

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/** Normalize an address for comparison: trim + lowercase. */
export function normalizeAddress(addr: string | null | undefined): string {
  return (addr ?? "").trim().toLowerCase();
}

/**
 * Normalize a single entry (lower-case its address). Returns null when the
 * address is blank — we never store an empty entry.
 */
export function normalizeEntry(entry: ExchangeAddressEntry): ExchangeAddressEntry | null {
  const address = normalizeAddress(entry.address);
  if (address === "") return null;
  return { ...entry, address };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * A built registry: the seed entries plus any owner-labeled entries, indexed
 * for O(1) case-insensitive lookup. Owner-labeled entries WIN on conflict (if
 * Michael labels an address, his intent is authoritative).
 */
export interface ExchangeRegistry {
  byAddress: Map<string, ExchangeAddressEntry>;
  entries: ExchangeAddressEntry[];
}

/**
 * Build the registry from the seed set + Michael's owner-labeled additions.
 * Blank addresses are dropped; later entries override earlier ones on the same
 * (lower-cased) address, and owner-labeled additions are applied last so they
 * take precedence over a seeded label.
 */
export function buildExchangeRegistry(
  ownerLabeled: readonly ExchangeAddressEntry[] = [],
): ExchangeRegistry {
  const byAddress = new Map<string, ExchangeAddressEntry>();

  const add = (raw: ExchangeAddressEntry): void => {
    const e = normalizeEntry(raw);
    if (e) byAddress.set(e.address, e);
  };

  for (const e of SEED_EXCHANGE_ADDRESSES) add(e);
  for (const e of ownerLabeled) add(e);

  return { byAddress, entries: Array.from(byAddress.values()) };
}

/** The exchange entry for an address, or null if it isn't a known exchange. */
export function lookupExchange(
  registry: ExchangeRegistry,
  address: string | null | undefined,
): ExchangeAddressEntry | null {
  const a = normalizeAddress(address);
  if (a === "") return null;
  return registry.byAddress.get(a) ?? null;
}

/** True when the address is a known exchange deposit/withdrawal point. */
export function isExchangeOrigin(
  registry: ExchangeRegistry,
  address: string | null | undefined,
): boolean {
  return lookupExchange(registry, address) !== null;
}

/**
 * The flat list of known exchange addresses (lower-cased) for feeding straight
 * into the R1-G1 trace (`OriginTraceInput.exchangeAddresses`).
 */
export function exchangeAddressList(registry: ExchangeRegistry): string[] {
  return registry.entries.map((e) => e.address);
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints a pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-exchange-registry-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`crypto-exchange-registry-core: ${msg}`);
}

export function __runCryptoExchangeRegistryCoreTests(): void {
  // normalizeAddress.
  eq(normalizeAddress("  0xABCdef "), "0xabcdef", "normalize trims + lowercases");
  eq(normalizeAddress(null), "", "normalize null -> empty");

  // The seed set is all verified_known and non-empty (Coinbase only).
  truthy(SEED_EXCHANGE_ADDRESSES.length > 0, "seed set is non-empty");
  for (const e of SEED_EXCHANGE_ADDRESSES) {
    eq(e.source, "verified_known", `seed ${e.address} is verified_known`);
    eq(e.exchange, "coinbase", `seed ${e.address} is coinbase (only verifiable exchange)`);
    eq(e.address, e.address.toLowerCase(), `seed ${e.address} is stored lower-cased`);
  }

  // Build with no owner additions: seeds are matchable case-insensitively.
  const reg = buildExchangeRegistry();
  truthy(
    isExchangeOrigin(reg, "0x71660C4005BA85C37CCEC55D0C4493E66FE775D3"),
    "seeded Coinbase 1 matches (case-insensitive)",
  );
  const hit = lookupExchange(reg, "0x71660c4005ba85c37ccec55d0c4493e66fe775d3");
  truthy(hit !== null && hit.exchange === "coinbase", "lookup returns coinbase entry");
  eq(isExchangeOrigin(reg, "0xdeadbeef"), false, "unknown address is not an exchange");
  eq(isExchangeOrigin(reg, null), false, "null is not an exchange");
  eq(isExchangeOrigin(reg, ""), false, "blank is not an exchange");

  // Owner-labeled additions: a Binance address Michael supplies is honored.
  const reg2 = buildExchangeRegistry([
    { address: "0xMyBinanceDeposit", chain: "ethereum", exchange: "binance", source: "owner_labeled" },
    { address: "  ", chain: "ethereum", exchange: "bitrue", source: "owner_labeled" }, // dropped
  ]);
  const b = lookupExchange(reg2, "0xmybinancedeposit");
  truthy(b !== null && b.exchange === "binance" && b.source === "owner_labeled", "owner Binance labeled");
  eq(reg2.entries.length, reg.entries.length + 1, "blank owner entry dropped, one added");

  // Owner-labeled WINS on conflict with a seeded address.
  const seeded = SEED_EXCHANGE_ADDRESSES[0].address;
  const reg3 = buildExchangeRegistry([
    { address: seeded.toUpperCase(), chain: "ethereum", exchange: "binance", source: "owner_labeled" },
  ]);
  const c = lookupExchange(reg3, seeded);
  truthy(c !== null && c.source === "owner_labeled" && c.exchange === "binance", "owner override wins");
  eq(reg3.entries.length, reg.entries.length, "override does not add a duplicate row");

  // exchangeAddressList feeds the trace: all lower-cased, includes seeds.
  const list = exchangeAddressList(reg);
  truthy(list.includes(seeded), "address list includes a seeded address");
  for (const a of list) eq(a, a.toLowerCase(), `list address ${a} lower-cased`);

  // Display names + labels are complete.
  eq(EXCHANGE_LABELS.length, 3, "three exchange labels");
  eq(EXCHANGE_DISPLAY_NAME.coinbase, "Coinbase", "coinbase display name");
  eq(EXCHANGE_DISPLAY_NAME.binance, "Binance", "binance display name");
  eq(EXCHANGE_DISPLAY_NAME.bitrue, "Bitrue", "bitrue display name");

  console.log("crypto-exchange-registry-core self-tests: all passed");
}
