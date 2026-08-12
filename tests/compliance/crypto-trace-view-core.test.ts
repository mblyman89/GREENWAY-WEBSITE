import { describe, it, expect } from "vitest";
import {
  __runCryptoTraceViewCoreTests,
  buildTraceView,
} from "../../src/lib/crypto/crypto-trace-view-core";
import type { CryptoOwnerWalletRecord } from "../../src/lib/crypto/crypto-owner-wallet-core";
import type { DiscoveredWallet } from "../../src/lib/crypto/crypto-origin-trace-core";

/**
 * R1-G4 — the pure view-model for the Origin Trace tab's discovered-wallet
 * review queue. Builds masked, sorted display rows from a fresh trace's
 * discovered wallets minus the decisions Michael already made.
 */

function disc(address: string, refs: number): DiscoveredWallet {
  return { address, chain: "flare", referenceCount: refs };
}

function decision(address: string, status: "confirmed" | "rejected"): CryptoOwnerWalletRecord {
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

describe("crypto-trace-view-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runCryptoTraceViewCoreTests()).not.toThrow();
  });

  it("renders an empty queue cleanly", () => {
    const v = buildTraceView([], []);
    expect(v.pendingCount).toBe(0);
    expect(v.summaryText).toBe("No wallets to review");
  });

  it("shows only undecided wallets, masked and counted", () => {
    const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const v = buildTraceView(
      [disc(A, 2), disc(B, 1)],
      [decision(A, "confirmed")],
    );
    expect(v.pendingCount).toBe(1);
    expect(v.pending[0].address).toBe(B);
    expect(v.pending[0].addressShort).toContain("…");
    expect(v.confirmedCount).toBe(1);
    expect(v.summaryText).toBe("1 wallet to review");
  });

  it("sorts pending by reference count descending", () => {
    const LOW = "0x1111111111111111111111111111111111111111";
    const HIGH = "0x9999999999999999999999999999999999999999";
    const v = buildTraceView([disc(LOW, 1), disc(HIGH, 9)], []);
    expect(v.pending[0].address).toBe(HIGH);
    expect(v.pending[0].referenceText).toBe("9 receipts");
    expect(v.summaryText).toBe("2 wallets to review");
  });
});
