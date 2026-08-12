/**
 * src/lib/crypto/crypto-trace-view-core.ts
 *
 * R1-G4 — PURE view-model for the Origin Trace tab's "discovered wallets" review
 * queue. NO I/O, no server-only imports. Turns a fresh trace's discovered
 * wallets + the stored ownership decisions into display rows the UI renders,
 * plus a small summary the tab badge uses.
 *
 * A discovered wallet is an OUTSIDE address a coin's back-trace pointed at that
 * we haven't decided on. The queue asks Michael one plain-English question per
 * address: "Is this wallet yours?" His answer (confirmed / rejected) is stored
 * and folded back in on the next trace (see partitionDiscoveredWallets).
 */

import {
  partitionDiscoveredWallets,
  type CryptoOwnerWalletRecord,
} from "./crypto-owner-wallet-core";
import { maskAddress, chainLabel } from "./crypto-ui-core";
import type { DiscoveredWallet } from "./crypto-origin-trace-core";
import type { Chain } from "./crypto-core";

/** One row in the discovered-wallet review queue. */
export interface TraceDiscoveryRow {
  /** Full lower-cased address (submitted with the confirm/reject form). */
  address: string;
  /** Shortened "0x1234…abcd" for display. */
  addressShort: string;
  chain: Chain;
  chainLabel: string;
  /** How many traced receipts point back to this address. */
  referenceCount: number;
  /** Plain-English count, e.g. "1 receipt" / "3 receipts". */
  referenceText: string;
}

export interface TraceView {
  /** Undecided discovered wallets awaiting Michael's yes/no. */
  pending: TraceDiscoveryRow[];
  /** Count of wallets Michael already confirmed are his. */
  confirmedCount: number;
  /** Count he rejected. */
  rejectedCount: number;
  /** Count still pending (== pending.length). */
  pendingCount: number;
  /** Short status line for the tab, e.g. "2 wallets to review". */
  summaryText: string;
}

function pluralReceipts(n: number): string {
  return `${n} receipt${n === 1 ? "" : "s"}`;
}

function toRow(w: DiscoveredWallet): TraceDiscoveryRow {
  const refs = Number.isFinite(w.referenceCount) && w.referenceCount > 0 ? Math.trunc(w.referenceCount) : 0;
  return {
    address: (w.address || "").trim().toLowerCase(),
    addressShort: maskAddress(w.address),
    chain: w.chain,
    chainLabel: chainLabel(w.chain),
    referenceCount: refs,
    referenceText: pluralReceipts(refs),
  };
}

/**
 * Build the Origin Trace review view. Sorts pending rows by reference count
 * descending (the most-referenced upstream wallet is the highest-leverage
 * decision) then by address for a stable order.
 */
export function buildTraceView(
  discovered: readonly DiscoveredWallet[],
  decisions: readonly CryptoOwnerWalletRecord[],
): TraceView {
  const part = partitionDiscoveredWallets(discovered, decisions);

  const pending = part.pendingReview
    .map(toRow)
    .sort((a, b) => {
      if (b.referenceCount !== a.referenceCount) return b.referenceCount - a.referenceCount;
      return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
    });

  const confirmedCount = part.confirmedOwnerAddresses.length;
  const rejectedCount = part.rejectedAddresses.length;
  const pendingCount = pending.length;

  const summaryText =
    pendingCount === 0
      ? "No wallets to review"
      : `${pendingCount} wallet${pendingCount === 1 ? "" : "s"} to review`;

  return { pending, confirmedCount, rejectedCount, pendingCount, summaryText };
}

// ---------------------------------------------------------------------------
// Pure self-tests (bare-call; thrown on first failure).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-trace-view-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`crypto-trace-view-core: ${msg} — expected truthy`);
  }
}

function disc(address: string, refs: number, chain: Chain = "flare"): DiscoveredWallet {
  return { address, chain, referenceCount: refs };
}

function decision(
  address: string,
  status: "confirmed" | "rejected",
): CryptoOwnerWalletRecord {
  return {
    id: `id-${address}`,
    address,
    chain: "flare",
    status,
    referenceCount: 1,
    note: null,
    decidedBy: null,
    decidedAt: null,
  };
}

export function __runCryptoTraceViewCoreTests(): void {
  // Empty in, empty out.
  const empty = buildTraceView([], []);
  eq(empty.pendingCount, 0, "empty -> 0 pending");
  eq(empty.summaryText, "No wallets to review", "empty summary");

  // Realistic-length addresses so masking engages.
  const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const C = "0xcccccccccccccccccccccccccccccccccccccccc";

  // Three discovered; one confirmed, one rejected, one pending.
  const view = buildTraceView(
    [disc(A, 2), disc(B, 5), disc(C, 1)],
    [decision(A, "confirmed"), decision(B, "rejected")],
  );
  eq(view.pendingCount, 1, "one pending remains");
  eq(view.pending[0].address, C, "pending address lower-cased");
  eq(view.pending[0].referenceText, "1 receipt", "singular receipt text");
  eq(view.confirmedCount, 1, "one confirmed");
  eq(view.rejectedCount, 1, "one rejected");
  eq(view.summaryText, "1 wallet to review", "singular summary");
  truthy(view.pending[0].addressShort.includes("…"), "address is masked for display");

  // Sort: highest reference count first.
  const LOW = "0x1111111111111111111111111111111111111111";
  const HIGH = "0x9999999999999999999999999999999999999999";
  const MID = "0x5555555555555555555555555555555555555555";
  const sorted = buildTraceView([disc(LOW, 1), disc(HIGH, 9), disc(MID, 4)], []);
  eq(sorted.pending[0].address, HIGH, "highest refs first");
  eq(sorted.pending[1].address, MID, "mid refs second");
  eq(sorted.pending[2].address, LOW, "low refs last");
  eq(sorted.pending[0].referenceText, "9 receipts", "plural receipts text");
  eq(sorted.summaryText, "3 wallets to review", "plural summary");

  console.log("crypto-trace-view-core self-tests: all passed");
}
