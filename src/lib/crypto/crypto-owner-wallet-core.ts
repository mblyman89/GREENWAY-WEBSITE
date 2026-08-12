/**
 * src/lib/crypto/crypto-owner-wallet-core.ts
 *
 * R1-G4 — PURE shape + logic for OWNERSHIP decisions on wallets DISCOVERED by
 * the Origin Trace back-trace. NO I/O, no server-only imports — safe under tsx
 * and vitest. The async Supabase readers/writers live in ./crypto-owner-wallet-
 * store and reuse these mappers + builders.
 *
 * When the trace (R1-G1) hits a receipt from an OUTSIDE address it can't yet
 * trust, it SURFACES that address as a DiscoveredWallet rather than guessing
 * it's Michael's. This core holds:
 *
 *   1. The record + DB-row shapes for crypto_owner_wallet_confirmations
 *      (migration 0165) + a row->record mapper.
 *   2. buildOwnerWalletUpsertRow — validate a confirm/reject decision into the
 *      exact row we upsert (address lower-cased/trimmed, chain required, status
 *      constrained). Refuses to build a nonsense row.
 *   3. partitionDiscoveredWallets — fold the STORED decisions back into a fresh
 *      trace's discovered wallets, producing three buckets:
 *        - confirmedOwnerAddresses: feed as ownerAddresses on the NEXT trace run
 *          (a hop from them is a non-taxable self-transfer),
 *        - pendingReview: still-undecided discovered wallets for the UI queue,
 *        - rejectedAddresses: remembered "not mine" so we don't re-suggest them.
 *
 * The address key everywhere is normalizeAddress() from the trace core, so a
 * decision made on "0xABC" matches a later discovery of "0xabc ".
 */

import { normalizeAddress, type DiscoveredWallet } from "./crypto-origin-trace-core";
import type { Chain } from "./crypto-core";

// ---------------------------------------------------------------------------
// Record + DB-row shapes.
// ---------------------------------------------------------------------------

export type OwnerWalletStatus = "confirmed" | "rejected";

export interface CryptoOwnerWalletRecord {
  id: string;
  /** Lower-cased, trimmed discovered address. */
  address: string;
  chain: Chain;
  status: OwnerWalletStatus;
  referenceCount: number;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface OwnerWalletRow {
  id: string;
  address: string;
  chain: string;
  status: string;
  reference_count: number | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

function asStatus(v: string): OwnerWalletStatus {
  return v === "rejected" ? "rejected" : "confirmed";
}

function asChain(v: string): Chain {
  // The DB stores chain as free text; narrow to the known set, defaulting to
  // "ethereum" only as a last resort (never silently corrupts a known chain).
  switch (v) {
    case "flare":
    case "songbird":
    case "xrpl":
    case "coreum":
    case "ethereum":
      return v;
    default:
      return "ethereum";
  }
}

function clampRefCount(v: number | null | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
  return n < 0 ? 0 : n;
}

/** Map a DB row to the app record shape. */
export function toOwnerWalletRecord(row: OwnerWalletRow): CryptoOwnerWalletRecord {
  return {
    id: row.id,
    address: normalizeAddress(row.address),
    chain: asChain(row.chain),
    status: asStatus(row.status),
    referenceCount: clampRefCount(row.reference_count),
    note: row.note != null && row.note !== "" ? row.note : null,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Validated upsert-row builder.
// ---------------------------------------------------------------------------

export interface BuildOwnerWalletInput {
  address: string;
  chain: Chain;
  status?: OwnerWalletStatus;
  referenceCount?: number;
  note?: string | null;
  decidedBy?: string | null;
}

/** The exact row we upsert (snake_case), minus DB-defaulted columns. */
export interface OwnerWalletUpsertRow {
  address: string;
  chain: Chain;
  status: OwnerWalletStatus;
  reference_count: number;
  note: string | null;
  decided_by: string | null;
}

export type BuildOwnerWalletResult =
  | { ok: true; row: OwnerWalletUpsertRow }
  | { ok: false; error: string };

const KNOWN_CHAINS: ReadonlySet<string> = new Set([
  "ethereum",
  "flare",
  "songbird",
  "xrpl",
  "coreum",
]);

function trimOrEmpty(v: string | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Validate + build the exact row to upsert. Refuses when:
 *   - the address is missing/blank (after normalize),
 *   - the chain isn't one of the known chains (never store a bad chain),
 *   - the status isn't confirmed/rejected.
 * The stored address is ALWAYS lower-cased + trimmed so lookups are
 * case-insensitive and match the trace core's discovered addresses.
 */
export function buildOwnerWalletUpsertRow(input: BuildOwnerWalletInput): BuildOwnerWalletResult {
  const address = normalizeAddress(input.address);
  if (address === "") return { ok: false, error: "Missing the wallet address." };

  const chain = trimOrEmpty(input.chain);
  if (!KNOWN_CHAINS.has(chain)) {
    return { ok: false, error: "That isn't a chain we recognize." };
  }

  const status: OwnerWalletStatus = input.status === "rejected" ? "rejected" : "confirmed";
  const note = trimOrEmpty(input.note);
  const decidedBy = trimOrEmpty(input.decidedBy);

  return {
    ok: true,
    row: {
      address,
      chain: chain as Chain,
      status,
      reference_count: clampRefCount(input.referenceCount),
      note: note === "" ? null : note,
      decided_by: decidedBy === "" ? null : decidedBy,
    },
  };
}

// ---------------------------------------------------------------------------
// Fold stored decisions back into a fresh trace's discovered wallets.
// ---------------------------------------------------------------------------

export interface PartitionedDiscovery {
  /**
   * Addresses Michael confirmed are HIS — feed these as ownerAddresses on the
   * NEXT traceOrigins() run so a hop from them becomes a non-taxable transfer.
   */
  confirmedOwnerAddresses: string[];
  /** Discovered wallets with no decision yet — the UI review queue. */
  pendingReview: DiscoveredWallet[];
  /** Addresses Michael said are NOT his — remembered so we don't re-suggest. */
  rejectedAddresses: string[];
}

/**
 * Partition a fresh trace's discovered wallets by the decisions already stored.
 *
 * @param discovered  DiscoveredWallet[] from the latest traceOrigins() run.
 * @param decisions   the stored confirm/reject records.
 *
 * A discovered wallet whose (normalized) address is confirmed goes to
 * confirmedOwnerAddresses; if rejected it's dropped from the review queue (and
 * its address listed in rejectedAddresses); otherwise it stays pendingReview.
 * Decisions with no matching current discovery are still reflected in the
 * confirmed/rejected address lists (so a previously-confirmed wallet keeps
 * feeding the recursion even after it stops appearing as "discovered").
 */
export function partitionDiscoveredWallets(
  discovered: readonly DiscoveredWallet[],
  decisions: readonly CryptoOwnerWalletRecord[],
): PartitionedDiscovery {
  const confirmedSet = new Set<string>();
  const rejectedSet = new Set<string>();
  for (const d of decisions) {
    const addr = normalizeAddress(d.address);
    if (addr === "") continue;
    if (d.status === "confirmed") confirmedSet.add(addr);
    else rejectedSet.add(addr);
  }

  const pendingReview: DiscoveredWallet[] = [];
  for (const w of discovered) {
    const addr = normalizeAddress(w.address);
    if (addr === "") continue;
    if (confirmedSet.has(addr) || rejectedSet.has(addr)) continue;
    pendingReview.push(w);
  }

  // A confirmed address wins over a rejected one if (somehow) both exist.
  const confirmedOwnerAddresses = Array.from(confirmedSet);
  const rejectedAddresses = Array.from(rejectedSet).filter((a) => !confirmedSet.has(a));

  return { confirmedOwnerAddresses, pendingReview, rejectedAddresses };
}

// ---------------------------------------------------------------------------
// Pure self-tests (bare-call; thrown on first failure).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-owner-wallet-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`crypto-owner-wallet-core: ${msg} — expected truthy`);
  }
}

function rec(over: Partial<CryptoOwnerWalletRecord> & { address: string }): CryptoOwnerWalletRecord {
  return {
    id: over.id ?? `id-${over.address}`,
    address: over.address,
    chain: over.chain ?? "flare",
    status: over.status ?? "confirmed",
    referenceCount: over.referenceCount ?? 1,
    note: "note" in over ? (over.note ?? null) : null,
    decidedBy: over.decidedBy ?? null,
    decidedAt: over.decidedAt ?? null,
  };
}

function disc(address: string, refs: number = 1): DiscoveredWallet {
  return { address, chain: "flare", referenceCount: refs };
}

export function __runCryptoOwnerWalletCoreTests(): void {
  // --- row mapper ---
  const record = toOwnerWalletRecord({
    id: "r1",
    address: "  0xABC ",
    chain: "flare",
    status: "confirmed",
    reference_count: 3,
    note: "",
    decided_by: "u1",
    decided_at: "2024-06-15T00:00:00Z",
  });
  eq(record.address, "0xabc", "row mapper lower-cases + trims address");
  eq(record.chain, "flare", "row mapper keeps known chain");
  eq(record.status, "confirmed", "row mapper status");
  eq(record.referenceCount, 3, "row mapper ref count");
  eq(record.note, null, "row mapper blank note -> null");
  // unknown chain falls back to ethereum (never corrupts)
  eq(toOwnerWalletRecord({ id: "r2", address: "0x1", chain: "bogus", status: "rejected", reference_count: null, note: null, decided_by: null, decided_at: null }).chain, "ethereum", "unknown chain -> ethereum");

  // --- builder ---
  const good = buildOwnerWalletUpsertRow({ address: "  0xDeF ", chain: "songbird", status: "confirmed", referenceCount: 2, decidedBy: "u9" });
  truthy(good.ok, "builder accepts a valid decision");
  if (good.ok) {
    eq(good.row.address, "0xdef", "builder lower-cases address");
    eq(good.row.chain, "songbird", "builder keeps chain");
    eq(good.row.status, "confirmed", "builder status");
    eq(good.row.reference_count, 2, "builder ref count");
    eq(good.row.decided_by, "u9", "builder decided_by");
  }
  eq(buildOwnerWalletUpsertRow({ address: "   ", chain: "flare" }).ok, false, "builder rejects blank address");
  eq(buildOwnerWalletUpsertRow({ address: "0x1", chain: "bogus" as Chain }).ok, false, "builder rejects unknown chain");
  // negative ref count clamps to 0
  const clamped = buildOwnerWalletUpsertRow({ address: "0x1", chain: "flare", referenceCount: -5 });
  truthy(clamped.ok, "builder ok with negative ref");
  if (clamped.ok) eq(clamped.row.reference_count, 0, "builder clamps negative ref to 0");

  // --- partition ---
  const discovered = [disc("0xAAA", 2), disc("0xBBB", 1), disc("0xCCC", 3)];
  const decisions = [
    rec({ address: "0xaaa", status: "confirmed" }),
    rec({ address: "0xbbb", status: "rejected" }),
    // a confirmed wallet that no longer shows as discovered still feeds recursion
    rec({ address: "0xddd", status: "confirmed" }),
  ];
  const part = partitionDiscoveredWallets(discovered, decisions);
  truthy(part.confirmedOwnerAddresses.includes("0xaaa"), "confirmed discovered -> owner addresses");
  truthy(part.confirmedOwnerAddresses.includes("0xddd"), "confirmed non-discovered still feeds recursion");
  truthy(part.rejectedAddresses.includes("0xbbb"), "rejected remembered");
  eq(part.pendingReview.length, 1, "only undecided stays pending");
  eq(part.pendingReview[0].address, "0xCCC", "the undecided wallet is pending");

  // confirmed wins over rejected for the same address
  const conflict = partitionDiscoveredWallets(
    [disc("0xEEE")],
    [rec({ address: "0xeee", status: "confirmed" }), rec({ address: "0xeee", status: "rejected" })],
  );
  truthy(conflict.confirmedOwnerAddresses.includes("0xeee"), "confirmed wins for conflicting address");
  eq(conflict.rejectedAddresses.includes("0xeee"), false, "conflicting address not also rejected");
  eq(conflict.pendingReview.length, 0, "decided address not pending");

  console.log("crypto-owner-wallet-core self-tests: all passed");
}
