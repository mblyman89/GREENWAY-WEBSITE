import { describe, it, expect } from "vitest";
import type { AcquisitionLot, DisposalEvent } from "../../src/lib/crypto/crypto-cost-basis-core";
import {
  __runCryptoMethodSandboxCoreTests,
  runMethodSandbox,
  methodRequiresSpecId,
  SANDBOX_METHODS,
} from "../../src/lib/crypto/crypto-method-sandbox-core";

const TEN = BigInt(10);
function qtyOne(): bigint {
  let r = BigInt(1);
  for (let i = 0; i < 18; i += 1) r = r * TEN;
  return r;
}
const DAY = 86400000;

describe("crypto-method-sandbox-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoMethodSandboxCoreTests()).not.toThrow();
  });
});

describe("Spec-ID guard rail", () => {
  it("flags LIFO and HIFO as requiring recorded Spec-ID, FIFO not", () => {
    expect(methodRequiresSpecId("fifo")).toBe(false);
    expect(methodRequiresSpecId("lifo")).toBe(true);
    expect(methodRequiresSpecId("hifo")).toBe(true);
  });
});

describe("method preview", () => {
  const acquisitions: AcquisitionLot[] = [
    { id: "A", quantityScaled: qtyOne(), basisCents: 10000, acquiredAtMs: 0 },
    { id: "B", quantityScaled: qtyOne(), basisCents: 30000, acquiredAtMs: 10 * DAY },
  ];
  const disposals: DisposalEvent[] = [
    { id: "d", quantityScaled: qtyOne(), proceedsCents: 40000, disposedAtMs: 20 * DAY },
  ];

  it("previews all three methods with distinct gains", () => {
    const sb = runMethodSandbox({ acquisitions, disposals });
    expect(sb.outcomes.map((o) => o.method)).toEqual([...SANDBOX_METHODS]);
    const fifo = sb.outcomes.find((o) => o.method === "fifo")!;
    const lifo = sb.outcomes.find((o) => o.method === "lifo")!;
    expect(fifo.totalRealizedGainCents).toBe(30000);
    expect(lifo.totalRealizedGainCents).toBe(10000);
  });

  it("reports a planning-only reduction vs FIFO and never picks aggressive silently", () => {
    const sb = runMethodSandbox({ acquisitions, disposals });
    expect(sb.defaultMethod).toBe("fifo");
    expect(sb.potentialGainReductionVsFifoCents).toBe(20000);
    const lifo = sb.outcomes.find((o) => o.method === "lifo")!;
    expect(lifo.requiresSpecId).toBe(true);
    expect(lifo.guardRailNote.length).toBeGreaterThan(0);
  });

  it("surfaces missing basis through the flag", () => {
    const sb = runMethodSandbox({ acquisitions: [], disposals });
    expect(sb.hasAnyMissingBasis).toBe(true);
  });
});
