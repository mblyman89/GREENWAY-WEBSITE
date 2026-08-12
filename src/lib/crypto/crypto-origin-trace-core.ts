/**
 * src/lib/crypto/crypto-origin-trace-core.ts
 *
 * R1-G1 — ORIGIN TRACE / COST-BASIS BACK-TRACE — TRACE GRAPH CORE (PURE).
 *
 * Michael never kept crypto receipts. This engine takes an asset he holds and
 * traces it BACKWARDS, hop by hop, wallet to wallet, until the trail reaches
 * the exchange (Coinbase / Bitrue / Binance) — or a wallet he has confirmed is
 * his own — where the coin originally entered his control. That termination
 * point is the acquisition event whose DATE + TIME we can then price at USD
 * fair-market-value (done later in R1-G3). See research bible §12.
 *
 * WHAT THIS FILE DOES (and, just as importantly, what it does NOT do)
 * ---------------------------------------------------------------------------
 * DOES:  Given a wallet's INBOUND transfers for one asset (each carrying the
 *        sending counterparty address, the receive timestamp, the tx hash, and
 *        the amount), plus the sets of (a) addresses Michael has CONFIRMED are
 *        his and (b) addresses known to be EXCHANGE deposit/withdrawal points,
 *        it builds the backwards hop graph and emits, per inbound receipt, an
 *        ordered LINEAGE that terminates at the best available origin, tagging
 *        each terminus with a `basisSource`:
 *            - "exchange_origin"        — received straight from an exchange.
 *            - "owner_provided"         — Michael supplied the real fill price.
 *            - "on_chain_reconstructed" — trail reached an origin we can price
 *                                          at FMV-at-timestamp (reconstruction).
 *            - "unknown"                — dead-ends at an unconfirmed outside
 *                                          wallet; needs ownership confirmation
 *                                          or a manual basis before it can price.
 *        It also surfaces DISCOVERED upstream addresses (candidate old wallets
 *        of Michael's) for the R1-G4 confirm/reject step, and flags exactly
 *        what still needs pricing or ownership confirmation.
 *
 * DOES NOT: assign any dollar amount. On-chain data proves MOVEMENT and TIMING,
 *        never the exchange's internal fill price (bible §12.2). Pricing is a
 *        separate, evidence-backed step (R1-G3). This core is pure structure +
 *        classification. Float-free. No I/O. No server-only imports. Self-tested.
 *
 * NEVER GUESSES: an unconfirmed wallet is SURFACED as a candidate, never
 * silently trusted as Michael's; a dead-end is tagged "unknown", never given a
 * fabricated basis.
 */
import type { Chain } from "./crypto-core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How an acquisition's cost basis is (or will be) established. */
export type BasisSource =
  | "exchange_origin"
  | "owner_provided"
  | "on_chain_reconstructed"
  | "unknown";

/**
 * One INBOUND receipt of an asset into a wallet Michael controls — the starting
 * point of a backwards trace. Addresses are compared case-insensitively after
 * trimming (EVM addresses are hex; we never rely on checksum casing).
 */
export interface InboundReceipt {
  /** Stable id (the source transaction row id). */
  id: string;
  /** Tx hash for the audit trail (evidence). */
  txHash: string;
  chain: Chain;
  /** The wallet (address) that RECEIVED the coin — one Michael controls. */
  toAddress: string;
  /**
   * The counterparty that SENT the coin (the parent hop), or null when the
   * chain/indexer did not record a sender (then the lineage cannot continue).
   */
  fromAddress: string | null;
  /** Receive time as epoch milliseconds (UTC). Null when unknown. */
  receivedAtMs: number | null;
  /** Exact amount as a decimal string (never a float). Passed through only. */
  amountDecimal: string | null;
  /** True when Michael supplied the real exchange fill price for THIS receipt. */
  ownerProvidedBasis?: boolean;
}

/** Everything the trace needs besides the receipts themselves. */
export interface OriginTraceInput {
  /** The inbound receipts to trace (one asset). */
  receipts: readonly InboundReceipt[];
  /** Addresses Michael has CONFIRMED are his own wallets. */
  ownerAddresses: readonly string[];
  /** Addresses known to be EXCHANGE deposit/withdrawal points. */
  exchangeAddresses: readonly string[];
}

/** The classified origin for a single inbound receipt. */
export interface ReceiptLineage {
  receiptId: string;
  txHash: string;
  chain: Chain;
  toAddress: string;
  fromAddress: string | null;
  receivedAtMs: number | null;
  amountDecimal: string | null;
  /** Where the basis comes from once priced. */
  basisSource: BasisSource;
  /**
   * The address that terminates this receipt's trace (the origin counterparty),
   * or null when there is no recorded sender to continue from.
   */
  originAddress: string | null;
  /** True when this receipt still needs a USD FMV before it can book basis. */
  needsPricing: boolean;
  /**
   * True when the origin is an OUTSIDE wallet we cannot yet trust — Michael must
   * confirm it's his (or provide a manual basis) before this lot is defensible.
   */
  needsOwnershipConfirmation: boolean;
  /**
   * A short, plain-English explanation of the classification (for the UI /
   * assumptions register). Never a dollar figure.
   */
  note: string;
}

/** A candidate upstream wallet discovered during tracing (for R1-G4). */
export interface DiscoveredWallet {
  address: string;
  chain: Chain;
  /** How many traced receipts point back to this address. */
  referenceCount: number;
}

export interface OriginTraceResult {
  lineages: ReceiptLineage[];
  /** Outside addresses that appeared as origins and are not yet confirmed. */
  discoveredWallets: DiscoveredWallet[];
  /** Count of receipts that will need a USD FMV to book basis. */
  needsPricingCount: number;
  /** Count of receipts blocked on an ownership confirmation / manual basis. */
  needsOwnershipCount: number;
  /**
   * Count of receipts that reached a DEFENSIBLE origin (exchange / owner-priced
   * / confirmed self-transfer) — i.e. every receipt whose basisSource is not
   * "unknown". Pricing may still be pending for some of these.
   */
  resolvedCount: number;
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/** Normalize an address for comparison: trim + lowercase (never checksum-cased). */
export function normalizeAddress(addr: string | null | undefined): string {
  return (addr ?? "").trim().toLowerCase();
}

function toSet(addrs: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (const a of addrs) {
    const n = normalizeAddress(a);
    if (n !== "") s.add(n);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Classify each inbound receipt's origin. This is a single backwards hop from
 * the receiving wallet to its immediate sender, classified against the known
 * exchange + owner address sets. (Multi-hop chaining across confirmed wallets
 * happens as R1-G4 confirms wallets and re-runs the trace with a larger owner
 * set — each pass resolves one more layer, so the engine stays simple, pure,
 * and terminating.)
 */
export function traceOrigins(input: OriginTraceInput): OriginTraceResult {
  const exchange = toSet(input.exchangeAddresses);
  const owner = toSet(input.ownerAddresses);

  const lineages: ReceiptLineage[] = [];
  const discovered = new Map<string, DiscoveredWallet>();

  let needsPricingCount = 0;
  let needsOwnershipCount = 0;
  let resolvedCount = 0;

  for (const r of input.receipts) {
    const from = normalizeAddress(r.fromAddress);
    const hasSender = from !== "";

    let basisSource: BasisSource;
    let needsPricing: boolean;
    let needsOwnershipConfirmation: boolean;
    let note: string;

    if (r.ownerProvidedBasis === true) {
      // Michael gave the real fill price — the strongest evidence there is.
      basisSource = "owner_provided";
      needsPricing = false;
      needsOwnershipConfirmation = false;
      note = "Cost basis supplied by owner (real fill price) — strongest evidence.";
    } else if (!hasSender) {
      // No recorded sender: the trail can't continue on-chain.
      basisSource = "unknown";
      needsPricing = false;
      needsOwnershipConfirmation = true;
      note = "No sending address recorded — needs a manual cost basis to be defensible.";
    } else if (exchange.has(from)) {
      // Received straight from an exchange: this is the acquisition point.
      basisSource = "exchange_origin";
      needsPricing = true; // price at FMV @ receive timestamp (R1-G3)
      needsOwnershipConfirmation = false;
      note = "Received directly from an exchange — origin found; price at value on the receive date.";
    } else if (owner.has(from)) {
      // Came from another wallet Michael controls — a self-transfer hop. Basis
      // carries over from that wallet (handled by R1-F1 once its lots resolve).
      // From THIS receipt's view the origin is still upstream, so continue.
      basisSource = "on_chain_reconstructed";
      needsPricing = false;
      needsOwnershipConfirmation = false;
      note = "Came from another of your confirmed wallets — basis carries over (self-transfer).";
    } else {
      // Outside wallet we don't yet trust: a candidate old wallet of Michael's.
      basisSource = "unknown";
      needsPricing = false;
      needsOwnershipConfirmation = true;
      note = "Came from an outside wallet — confirm it's yours to keep tracing, or set a manual basis.";
      const existing = discovered.get(from);
      if (existing) {
        existing.referenceCount += 1;
      } else {
        discovered.set(from, { address: from, chain: r.chain, referenceCount: 1 });
      }
    }

    if (needsPricing) needsPricingCount += 1;
    if (needsOwnershipConfirmation) needsOwnershipCount += 1;
    // "Resolved" = reached a defensible origin (exchange / owner-priced /
    // confirmed self-transfer). Pricing may still be pending, but the ORIGIN is
    // no longer in doubt. "unknown" receipts are the ones still open.
    if (basisSource !== "unknown") resolvedCount += 1;

    lineages.push({
      receiptId: r.id,
      txHash: r.txHash,
      chain: r.chain,
      toAddress: r.toAddress,
      fromAddress: r.fromAddress,
      receivedAtMs: r.receivedAtMs,
      amountDecimal: r.amountDecimal,
      basisSource,
      originAddress: hasSender ? from : null,
      needsPricing,
      needsOwnershipConfirmation,
      note,
    });
  }

  // Discovered wallets in a stable, highest-reference-first order.
  const discoveredWallets = Array.from(discovered.values()).sort(
    (a, b) => b.referenceCount - a.referenceCount || (a.address < b.address ? -1 : 1),
  );

  return {
    lineages,
    discoveredWallets,
    needsPricingCount,
    needsOwnershipCount,
    resolvedCount,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints a pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-origin-trace-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`crypto-origin-trace-core: ${msg}`);
}

function rcpt(over: Partial<InboundReceipt> & { id: string }): InboundReceipt {
  return {
    id: over.id,
    txHash: over.txHash ?? `0xhash-${over.id}`,
    chain: over.chain ?? "flare",
    toAddress: over.toAddress ?? "0xMine",
    fromAddress: "fromAddress" in over ? (over.fromAddress ?? null) : "0xParent",
    receivedAtMs: "receivedAtMs" in over ? (over.receivedAtMs ?? null) : Date.UTC(2022, 0, 15),
    amountDecimal: "amountDecimal" in over ? (over.amountDecimal ?? null) : "10",
    ownerProvidedBasis: over.ownerProvidedBasis,
  };
}

export function __runCryptoOriginTraceCoreTests(): void {
  // normalizeAddress: trims + lowercases; empty/null -> "".
  eq(normalizeAddress("  0xABC "), "0xabc", "normalize trims + lowercases");
  eq(normalizeAddress(null), "", "normalize null -> empty");
  eq(normalizeAddress(undefined), "", "normalize undefined -> empty");

  // Exchange origin: received straight from a known exchange address.
  const exch = traceOrigins({
    receipts: [rcpt({ id: "e1", fromAddress: "0xCoinbaseHot" })],
    ownerAddresses: [],
    exchangeAddresses: ["0xCOINBASEHOT"], // case-insensitive match
  });
  eq(exch.lineages[0].basisSource, "exchange_origin", "exchange origin classified");
  eq(exch.lineages[0].needsPricing, true, "exchange origin needs FMV pricing");
  eq(exch.lineages[0].needsOwnershipConfirmation, false, "exchange origin no ownership needed");
  eq(exch.needsPricingCount, 1, "one receipt needs pricing");
  eq(exch.discoveredWallets.length, 0, "exchange origin discovers no outside wallet");

  // Owner-provided basis always wins, no pricing/ownership needed.
  const owned = traceOrigins({
    receipts: [rcpt({ id: "o1", fromAddress: "0xWhatever", ownerProvidedBasis: true })],
    ownerAddresses: [],
    exchangeAddresses: [],
  });
  eq(owned.lineages[0].basisSource, "owner_provided", "owner-provided basis");
  eq(owned.lineages[0].needsPricing, false, "owner-provided needs no pricing");
  eq(owned.resolvedCount, 1, "owner-provided is resolved");

  // From another confirmed owner wallet -> self-transfer, basis carries over.
  const self = traceOrigins({
    receipts: [rcpt({ id: "s1", fromAddress: "0xMyOldWallet" })],
    ownerAddresses: ["0xmyoldwallet"],
    exchangeAddresses: [],
  });
  eq(self.lineages[0].basisSource, "on_chain_reconstructed", "self-transfer reconstructed");
  eq(self.lineages[0].needsOwnershipConfirmation, false, "confirmed owner needs no confirmation");
  eq(self.discoveredWallets.length, 0, "confirmed owner not re-discovered");

  // Outside wallet -> unknown, surfaced as a candidate discovered wallet.
  const outside = traceOrigins({
    receipts: [
      rcpt({ id: "u1", fromAddress: "0xStranger" }),
      rcpt({ id: "u2", fromAddress: "0xStranger" }),
      rcpt({ id: "u3", fromAddress: "0xOtherStranger" }),
    ],
    ownerAddresses: [],
    exchangeAddresses: [],
  });
  eq(outside.lineages[0].basisSource, "unknown", "outside -> unknown");
  eq(outside.lineages[0].needsOwnershipConfirmation, true, "outside needs ownership confirm");
  eq(outside.needsOwnershipCount, 3, "three receipts need ownership");
  eq(outside.discoveredWallets.length, 2, "two distinct outside wallets discovered");
  eq(outside.discoveredWallets[0].address, "0xstranger", "most-referenced wallet first");
  eq(outside.discoveredWallets[0].referenceCount, 2, "0xstranger referenced twice");

  // No recorded sender -> unknown, needs manual basis, not a discovered wallet.
  const nosender = traceOrigins({
    receipts: [rcpt({ id: "n1", fromAddress: null })],
    ownerAddresses: [],
    exchangeAddresses: [],
  });
  eq(nosender.lineages[0].basisSource, "unknown", "no sender -> unknown");
  eq(nosender.lineages[0].originAddress, null, "no sender -> null origin");
  eq(nosender.lineages[0].needsOwnershipConfirmation, true, "no sender needs manual basis");
  eq(nosender.discoveredWallets.length, 0, "no sender is not a discovered wallet");

  // Amount + timestamp + hash pass through untouched (evidence preserved).
  const passthrough = traceOrigins({
    receipts: [
      rcpt({
        id: "p1",
        fromAddress: "0xCoinbaseHot",
        amountDecimal: "123.456789012345678",
        receivedAtMs: Date.UTC(2021, 5, 1),
        txHash: "0xdeadbeef",
      }),
    ],
    ownerAddresses: [],
    exchangeAddresses: ["0xcoinbasehot"],
  });
  eq(passthrough.lineages[0].amountDecimal, "123.456789012345678", "amount passes through exactly");
  eq(passthrough.lineages[0].receivedAtMs, Date.UTC(2021, 5, 1), "timestamp passes through");
  eq(passthrough.lineages[0].txHash, "0xdeadbeef", "tx hash passes through");
  truthy(passthrough.lineages[0].note.length > 0, "every lineage carries a plain-English note");

  // Empty input is well-formed and trivial.
  const empty = traceOrigins({ receipts: [], ownerAddresses: [], exchangeAddresses: [] });
  eq(empty.lineages.length, 0, "empty receipts -> empty lineages");
  eq(empty.discoveredWallets.length, 0, "empty -> no discovered wallets");
  eq(empty.needsPricingCount, 0, "empty -> zero pricing");

  console.log("crypto-origin-trace-core self-tests: all passed");
}
