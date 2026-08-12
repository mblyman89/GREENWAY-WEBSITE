import { describe, it, expect } from "vitest";
import {
  __runCryptoOwnerWalletCoreTests,
  buildOwnerWalletUpsertRow,
  toOwnerWalletRecord,
  partitionDiscoveredWallets,
  type CryptoOwnerWalletRecord,
} from "../../src/lib/crypto/crypto-owner-wallet-core";
import type { DiscoveredWallet } from "../../src/lib/crypto/crypto-origin-trace-core";

/**
 * R1-G4 — the pure ownership-decision layer for wallets DISCOVERED during the
 * back-trace. It validates confirm/reject decisions into exact upsert rows
 * (address always lower-cased/trimmed, chain constrained) and folds stored
 * decisions back into a fresh trace's discovered wallets so confirmed wallets
 * feed the next hop and rejected ones are remembered.
 */

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

describe("crypto-owner-wallet-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runCryptoOwnerWalletCoreTests()).not.toThrow();
  });

  it("lower-cases and trims the address on the mapped record", () => {
    const r = toOwnerWalletRecord({
      id: "r1",
      address: "  0xABCdef ",
      chain: "songbird",
      status: "confirmed",
      reference_count: 4,
      note: null,
      decided_by: null,
      decided_at: null,
    });
    expect(r.address).toBe("0xabcdef");
    expect(r.chain).toBe("songbird");
    expect(r.referenceCount).toBe(4);
  });

  it("falls back an unknown chain to ethereum without corrupting known ones", () => {
    const bad = toOwnerWalletRecord({
      id: "r",
      address: "0x1",
      chain: "not-a-chain",
      status: "rejected",
      reference_count: null,
      note: null,
      decided_by: null,
      decided_at: null,
    });
    expect(bad.chain).toBe("ethereum");
  });

  it("builds a valid confirm decision and rejects bad input", () => {
    const ok = buildOwnerWalletUpsertRow({ address: "  0xDeF ", chain: "flare", status: "confirmed" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.address).toBe("0xdef");
    expect(buildOwnerWalletUpsertRow({ address: "  ", chain: "flare" }).ok).toBe(false);
    expect(buildOwnerWalletUpsertRow({ address: "0x1", chain: "bogus" as never }).ok).toBe(false);
  });

  it("partitions discovered wallets by stored decisions", () => {
    const discovered = [disc("0xAAA"), disc("0xBBB"), disc("0xCCC")];
    const decisions = [
      rec({ address: "0xaaa", status: "confirmed" }),
      rec({ address: "0xbbb", status: "rejected" }),
    ];
    const part = partitionDiscoveredWallets(discovered, decisions);
    expect(part.confirmedOwnerAddresses).toContain("0xaaa");
    expect(part.rejectedAddresses).toContain("0xbbb");
    expect(part.pendingReview.map((w) => w.address)).toEqual(["0xCCC"]);
  });

  it("keeps a confirmed-but-no-longer-discovered wallet feeding the recursion", () => {
    const part = partitionDiscoveredWallets([], [rec({ address: "0xddd", status: "confirmed" })]);
    expect(part.confirmedOwnerAddresses).toContain("0xddd");
    expect(part.pendingReview.length).toBe(0);
  });
});
