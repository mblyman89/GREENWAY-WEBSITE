/**
 * tests/compliance/pos-register-client-core.test.ts  (POS Slice B5)
 *
 * Pins the register's ON-DEVICE offline queue logic: monotonic sequences,
 * durable-ACK queue clearing (rejected rows are kept + flagged, never silently
 * dropped or blindly re-sent), flush batching in true offline order, and
 * corruption-tolerant (de)serialization so a damaged stored queue can never
 * brick the till.
 */
import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  applyAcks,
  nextFlushBatch,
  serializeQueue,
  parseQueue,
  highestSequence,
  queueDepthWarning,
  storageFailureAlert,
  QUEUE_DEPTH_WARNING_THRESHOLD,
  __runRegisterClientCoreTests,
  type QueuedPosEvent,
} from "@/lib/pos/register-client-core";
import type { PosSyncAck } from "@/lib/pos/sync-core";

const DEV = "11111111-1111-4111-8111-111111111111";
const REG = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";

function uuidFor(n: number): string {
  const d = String(n).padStart(2, "0");
  return `${d.repeat(4)}-${d.repeat(2)}-4${d}0-8${d}0-${d.repeat(6)}`;
}

function mkRow(n: number, overrides: Partial<QueuedPosEvent> = {}): QueuedPosEvent {
  return {
    clientUuid: uuidFor(n),
    deviceId: DEV,
    registerId: REG,
    employeeId: EMP,
    sequence: n,
    occurredAt: `2026-07-13T18:0${n % 10}:00.000Z`,
    eventType: "no_sale",
    payload: { reason: "test" },
    queuedAt: `2026-07-13T18:0${n % 10}:00.000Z`,
    ...overrides,
  };
}

describe("buildEnvelope", () => {
  it("advances the sequence monotonically from lastSequence", () => {
    const first = buildEnvelope({
      clientUuid: uuidFor(1),
      deviceId: DEV,
      registerId: REG,
      employeeId: EMP,
      lastSequence: 0,
      eventType: "punch",
      payload: { intent: "in" },
      nowIso: "2026-07-13T18:00:00.000Z",
    });
    expect(first.envelope.sequence).toBe(1);
    expect(first.nextSequence).toBe(1);
    const second = buildEnvelope({
      clientUuid: uuidFor(2),
      deviceId: DEV,
      registerId: REG,
      employeeId: EMP,
      lastSequence: first.nextSequence,
      eventType: "punch",
      payload: { intent: "out" },
      nowIso: "2026-07-13T18:01:00.000Z",
    });
    expect(second.envelope.sequence).toBe(2);
  });

  it("sanitizes a negative or fractional lastSequence instead of trusting it", () => {
    const out = buildEnvelope({
      clientUuid: uuidFor(3),
      deviceId: DEV,
      registerId: REG,
      employeeId: EMP,
      lastSequence: -5,
      eventType: "no_sale",
      payload: { reason: "x" },
      nowIso: "2026-07-13T18:00:00.000Z",
    });
    expect(out.envelope.sequence).toBe(1);
  });

  it("stamps queuedAt with the same clock as occurredAt", () => {
    const out = buildEnvelope({
      clientUuid: uuidFor(4),
      deviceId: DEV,
      registerId: REG,
      employeeId: EMP,
      lastSequence: 9,
      eventType: "no_sale",
      payload: { reason: "x" },
      nowIso: "2026-07-13T18:05:00.000Z",
    });
    expect(out.envelope.queuedAt).toBe("2026-07-13T18:05:00.000Z");
    expect(out.envelope.occurredAt).toBe("2026-07-13T18:05:00.000Z");
  });
});

describe("applyAcks", () => {
  const queue = [mkRow(1), mkRow(2), mkRow(3)];

  it("removes durably-accepted rows (processed, duplicate, exception)", () => {
    const acks: PosSyncAck[] = [
      { clientUuid: uuidFor(1), status: "processed" },
      { clientUuid: uuidFor(2), status: "duplicate" },
      { clientUuid: uuidFor(3), status: "exception", reason: "held for review" },
    ];
    const out = applyAcks(queue, acks);
    expect(out.remaining).toHaveLength(0);
    expect(out.rejected).toHaveLength(0);
    expect(out.acceptedUuids).toEqual([uuidFor(1), uuidFor(2), uuidFor(3)]);
  });

  it("keeps rejected rows flagged with the server's reason", () => {
    const acks: PosSyncAck[] = [
      { clientUuid: uuidFor(1), status: "processed" },
      { clientUuid: uuidFor(2), status: "rejected", reason: "Malformed payload." },
    ];
    const out = applyAcks(queue, acks);
    expect(out.remaining.map((r) => r.clientUuid)).toEqual([uuidFor(3)]);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]!.clientUuid).toBe(uuidFor(2));
    expect(out.rejected[0]!.rejectedReason).toBe("Malformed payload.");
  });

  it("gives a rejected row a fallback reason when the server sent none", () => {
    const out = applyAcks([mkRow(1)], [{ clientUuid: uuidFor(1), status: "rejected" }]);
    expect(out.rejected[0]!.rejectedReason).toBeTruthy();
  });

  it("leaves un-ACKed rows queued for the next flush", () => {
    const out = applyAcks(queue, [{ clientUuid: uuidFor(2), status: "processed" }]);
    expect(out.remaining.map((r) => r.clientUuid)).toEqual([uuidFor(1), uuidFor(3)]);
  });
});

describe("nextFlushBatch", () => {
  it("excludes rejected rows and sorts by sequence", () => {
    const queue = [
      mkRow(3),
      mkRow(1),
      mkRow(2, { rejectedReason: "bad" }),
    ];
    const batch = nextFlushBatch(queue);
    expect(batch.map((r) => r.sequence)).toEqual([1, 3]);
  });

  it("caps the batch size", () => {
    const queue = Array.from({ length: 10 }, (_, i) => mkRow(i + 1));
    expect(nextFlushBatch(queue, 4)).toHaveLength(4);
    expect(nextFlushBatch(queue, 4).map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("never returns a zero-size cap (min 1)", () => {
    const queue = [mkRow(1), mkRow(2)];
    expect(nextFlushBatch(queue, 0)).toHaveLength(1);
  });
});

describe("serializeQueue / parseQueue", () => {
  it("round-trips a valid queue losslessly", () => {
    const queue = [mkRow(1), mkRow(2, { rejectedReason: "kept" })];
    const parsed = parseQueue(serializeQueue(queue));
    expect(parsed.droppedRows).toBe(0);
    expect(parsed.queue).toEqual(queue);
  });

  it("returns an empty queue for null/empty/garbage input", () => {
    expect(parseQueue(null)).toEqual({ queue: [], droppedRows: 0 });
    expect(parseQueue("")).toEqual({ queue: [], droppedRows: 0 });
    expect(parseQueue("not json {{{")).toEqual({ queue: [], droppedRows: 1 });
    expect(parseQueue(JSON.stringify({ nope: true }))).toEqual({ queue: [], droppedRows: 1 });
  });

  it("drops malformed rows but keeps valid ones, counting the damage", () => {
    const raw = JSON.stringify({
      v: 1,
      queue: [mkRow(1), { half: "a row" }, null, mkRow(2, { queuedAt: undefined })],
    });
    const parsed = parseQueue(raw);
    expect(parsed.queue.map((r) => r.sequence)).toEqual([1]);
    expect(parsed.droppedRows).toBe(3);
  });
});

describe("highestSequence", () => {
  it("finds the max sequence in the queue", () => {
    expect(highestSequence([mkRow(4), mkRow(9), mkRow(2)])).toBe(9);
  });

  it("uses the fallback when the queue is empty or lower", () => {
    expect(highestSequence([], 12)).toBe(12);
    expect(highestSequence([mkRow(3)], 12)).toBe(12);
    expect(highestSequence([], -4)).toBe(0);
  });
});

// GW-001 — storage-pressure guardrails: the register must WARN before quota
// exhaustion (queue depth watermark) and must tell the human exactly what is
// at risk when a persist write actually fails.
describe("queueDepthWarning (GW-001)", () => {
  it("stays quiet below the watermark", () => {
    expect(queueDepthWarning(0)).toBeNull();
    expect(queueDepthWarning(QUEUE_DEPTH_WARNING_THRESHOLD - 1)).toBeNull();
  });

  it("fires at the watermark and carries the live count", () => {
    const warn = queueDepthWarning(QUEUE_DEPTH_WARNING_THRESHOLD);
    expect(warn).toContain(String(QUEUE_DEPTH_WARNING_THRESHOLD));
    expect(warn).toContain("manager");
    expect(queueDepthWarning(345)).toContain("345");
  });

  it("supports a custom threshold and never crashes on bad input", () => {
    expect(queueDepthWarning(3, 3)).not.toBeNull();
    expect(queueDepthWarning(2, 3)).toBeNull();
    expect(queueDepthWarning(Number.NaN)).toBeNull();
  });
});

describe("storageFailureAlert (GW-001)", () => {
  it("names the risk for a failed queue write (lost offline sales)", () => {
    const msg = storageFailureAlert("queue");
    expect(msg).toContain("full");
    expect(msg).toContain("offline sales");
    expect(msg).toContain("manager");
  });

  it("names the risk for a failed device-pairing write (won't survive restart)", () => {
    const msg = storageFailureAlert("device");
    expect(msg).toContain("pairing");
    expect(msg).toContain("restart");
  });

  it("keeps the two alerts distinct", () => {
    expect(storageFailureAlert("queue")).not.toBe(storageFailureAlert("device"));
  });
});

describe("embedded self-tests", () => {
  it("__runRegisterClientCoreTests passes", () => {
    expect(() => __runRegisterClientCoreTests()).not.toThrow();
  });
});
