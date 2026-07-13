/**
 * src/lib/pos/register-client-core.ts  (POS Slice B5)
 *
 * PURE helpers for the register's ON-DEVICE offline queue. No DOM, no
 * localStorage, no fetch — the client shell wires those; this module owns the
 * logic so it is unit-testable and cannot drift from the sync contract:
 *
 *   - Envelopes are built with a per-device MONOTONIC sequence.
 *   - The queue is append-only until the server durably ACKs
 *     (processed | duplicate | exception → row leaves the queue;
 *      rejected → row stays, flagged, surfaced to the human).
 *   - Serialization is defensive: a corrupted stored queue never crashes the
 *     register — unparseable rows are dropped with a count so the UI can say
 *     so (losing a malformed row is better than bricking the till, and every
 *     DURABLE fact lives server-side after first successful flush).
 */

import {
  validateEnvelope,
  sortEventsForReplay,
  type PosEventEnvelope,
  type PosEventType,
} from "./sale-event-core";
import { ackMeansDurablyAccepted, type PosSyncAck } from "./sync-core";

// ---------------------------------------------------------------------------
// Queue rows
// ---------------------------------------------------------------------------

export type QueuedPosEvent = PosEventEnvelope & {
  /** Device wall-clock when the row was enqueued (diagnostics only). */
  queuedAt: string;
  /** Set when the server REJECTED the row — kept + surfaced, never re-sent blindly. */
  rejectedReason?: string;
};

/** Build the next envelope for this device, advancing the sequence. */
export function buildEnvelope(opts: {
  clientUuid: string;
  deviceId: string;
  registerId: string;
  employeeId: string;
  lastSequence: number;
  eventType: PosEventType;
  payload: Record<string, unknown>;
  nowIso: string;
}): { envelope: QueuedPosEvent; nextSequence: number } {
  const sequence = Math.max(0, Math.floor(opts.lastSequence)) + 1;
  return {
    envelope: {
      clientUuid: opts.clientUuid,
      deviceId: opts.deviceId,
      registerId: opts.registerId,
      employeeId: opts.employeeId,
      sequence,
      occurredAt: opts.nowIso,
      eventType: opts.eventType,
      payload: opts.payload,
      queuedAt: opts.nowIso,
    },
    nextSequence: sequence,
  };
}

// ---------------------------------------------------------------------------
// ACK application
// ---------------------------------------------------------------------------

export type AckApplication = {
  /** Rows still owed to the server (unsent or retriable). */
  remaining: QueuedPosEvent[];
  /** Rows the server rejected — kept, flagged, surfaced to the human. */
  rejected: QueuedPosEvent[];
  /** clientUuids durably accepted this round (processed/duplicate/exception). */
  acceptedUuids: string[];
};

/**
 * Apply a flush response to the queue. Durable ACKs remove the row; rejected
 * ACKs flag the row and move it to the rejected list; rows with no ACK stay
 * queued for the next flush.
 */
export function applyAcks(queue: QueuedPosEvent[], acks: PosSyncAck[]): AckApplication {
  const byUuid = new Map(acks.map((a) => [a.clientUuid, a]));
  const remaining: QueuedPosEvent[] = [];
  const rejected: QueuedPosEvent[] = [];
  const acceptedUuids: string[] = [];
  for (const row of queue) {
    const ack = byUuid.get(row.clientUuid);
    if (!ack) {
      remaining.push(row);
      continue;
    }
    if (ackMeansDurablyAccepted(ack.status)) {
      acceptedUuids.push(row.clientUuid);
      continue;
    }
    rejected.push({ ...row, rejectedReason: ack.reason ?? "Rejected by the server." });
  }
  return { remaining, rejected, acceptedUuids };
}

/** The rows to send in the next flush: unrejected, in true offline order, capped. */
export function nextFlushBatch(queue: QueuedPosEvent[], maxBatch = 50): QueuedPosEvent[] {
  return sortEventsForReplay(queue.filter((r) => !r.rejectedReason)).slice(0, Math.max(1, maxBatch));
}

// ---------------------------------------------------------------------------
// Defensive (de)serialization for persisted queues
// ---------------------------------------------------------------------------

export function serializeQueue(queue: QueuedPosEvent[]): string {
  return JSON.stringify({ v: 1, queue });
}

export type ParsedQueue = { queue: QueuedPosEvent[]; droppedRows: number };

/**
 * Parse a persisted queue. Malformed rows are dropped (counted) rather than
 * crashing the register; a completely unreadable blob yields an empty queue.
 */
export function parseQueue(raw: string | null | undefined): ParsedQueue {
  if (!raw) return { queue: [], droppedRows: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { queue: [], droppedRows: 1 };
  }
  const rows = (parsed as { queue?: unknown })?.queue;
  if (!Array.isArray(rows)) return { queue: [], droppedRows: 1 };
  const queue: QueuedPosEvent[] = [];
  let droppedRows = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      droppedRows += 1;
      continue;
    }
    const candidate = row as QueuedPosEvent;
    const check = validateEnvelope(candidate);
    if (!check.ok || typeof candidate.queuedAt !== "string") {
      droppedRows += 1;
      continue;
    }
    queue.push(candidate);
  }
  return { queue, droppedRows };
}

/** Highest sequence present in a queue (resume point after a reload). */
export function highestSequence(queue: QueuedPosEvent[], fallback = 0): number {
  return queue.reduce((max, r) => Math.max(max, r.sequence), Math.max(0, Math.floor(fallback)));
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRegisterClientCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else { fail += 1; console.log("FAIL:", msg); }
  };

  const U = (n: string) =>
    `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
  const DEV = U("1");
  const REG = U("2");
  const EMP = U("3");
  const NOW = "2026-07-13T18:00:00.000Z";

  // buildEnvelope: monotonic sequence
  const b1 = buildEnvelope({
    clientUuid: U("4"), deviceId: DEV, registerId: REG, employeeId: EMP,
    lastSequence: 0, eventType: "punch", payload: { intent: "in" }, nowIso: NOW,
  });
  ok(b1.envelope.sequence === 1 && b1.nextSequence === 1, "first sequence is 1");
  const b2 = buildEnvelope({
    clientUuid: U("5"), deviceId: DEV, registerId: REG, employeeId: EMP,
    lastSequence: b1.nextSequence, eventType: "no_sale",
    payload: { reason: "change for a twenty", approvedByEmployeeId: EMP }, nowIso: NOW,
  });
  ok(b2.envelope.sequence === 2, "sequence advances");
  ok(validateEnvelope(b1.envelope).ok, "built envelope is valid");

  // applyAcks
  const queue = [b1.envelope, b2.envelope];
  const res = applyAcks(queue, [
    { clientUuid: b1.envelope.clientUuid, status: "processed" },
    { clientUuid: b2.envelope.clientUuid, status: "rejected", reason: "bad payload" },
  ]);
  ok(res.acceptedUuids.length === 1 && res.acceptedUuids[0] === b1.envelope.clientUuid, "processed row accepted");
  ok(res.rejected.length === 1 && res.rejected[0].rejectedReason === "bad payload", "rejected row kept + flagged");
  ok(res.remaining.length === 0, "nothing left unacked");
  {
    const partial = applyAcks(queue, [{ clientUuid: b1.envelope.clientUuid, status: "exception", reason: "gate" }]);
    ok(partial.acceptedUuids.length === 1, "exception is durable (leaves queue)");
    ok(partial.remaining.length === 1 && partial.remaining[0].clientUuid === b2.envelope.clientUuid, "unacked row stays queued");
  }

  // nextFlushBatch excludes rejected rows and respects order + cap
  {
    const flagged: QueuedPosEvent = { ...b1.envelope, rejectedReason: "kept" };
    const batch = nextFlushBatch([b2.envelope, flagged]);
    ok(batch.length === 1 && batch[0].clientUuid === b2.envelope.clientUuid, "rejected rows never re-sent blindly");
    const capped = nextFlushBatch([b1.envelope, b2.envelope], 1);
    ok(capped.length === 1 && capped[0].sequence === 1, "cap keeps lowest sequence first");
  }

  // serialize/parse round-trip + corruption tolerance
  {
    const round = parseQueue(serializeQueue(queue));
    ok(round.queue.length === 2 && round.droppedRows === 0, "round-trip preserves rows");
    ok(parseQueue("not json").queue.length === 0, "garbage blob → empty queue");
    ok(parseQueue(null).droppedRows === 0, "empty storage → clean start");
    const dirty = JSON.stringify({ v: 1, queue: [queue[0], { junk: true }, 42] });
    const parsed = parseQueue(dirty);
    ok(parsed.queue.length === 1 && parsed.droppedRows === 2, "malformed rows dropped and counted");
  }

  ok(highestSequence(queue) === 2, "highestSequence finds resume point");
  ok(highestSequence([], 5) === 5, "highestSequence honors fallback");

  console.log(`pos/register-client-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/register-client-core tests failed`);
}
