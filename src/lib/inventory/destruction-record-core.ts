/**
 * src/lib/inventory/destruction-record-core.ts  (Fix Phase 1.6a · G-43)
 *
 * PURE rules for a hardened destruction record. No I/O, so the page, the
 * server actions, the printable log and the tests share one source.
 *
 * Owner basis (verbatim, D64): "anyone may witness the destruction. It has to
 * be done on camera as well." WAC 314-55-097 (records of destruction kept
 * five years), WAC 314-55-083(3)(a) (camera coverage).
 *
 * What it decides
 *   1. Witness (G-43 req 1 as amended by D64): a second named person from the
 *      staff roster, never the person completing (F-15-4).
 *   2. Camera reference (G-43 req 8, F-15-21): camera name and the start and
 *      end time, Pacific, end after start, not in the future.
 *   3. Other method (G-43 req 3): an LCB approval reference and date.
 *   4. Scheduling (G-43 req 4, F-15-12): the quantity may not exceed on hand
 *      less held units less what open destructions already claim.
 *   5. Pacific times (G-43 req 5, F-15-5): every time shown or messaged.
 */

import { pacificParts } from "@/lib/reports/timezone";

export type Refusal = { code: string; message: string };

const trimmed = (v: string | null | undefined): string => (v ?? "").trim();

/** Shown on the page, the log and in messages: always Pacific (F-15-5). */
export function formatDestructionPacific(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = pacificParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${pad(p.month)}/${pad(p.day)}/${p.year} ${h12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"} Pacific`;
}

/** The hold refusal, in Pacific (replaces the server-locale text, F-15-5). */
export function holdNotElapsedMessage(earliestDestroyAtIso: string): string {
  return `Hold policy not elapsed \u2014 earliest destroy at ${formatDestructionPacific(earliestDestroyAtIso)}.`;
}

// ---------------------------------------------------------------------------
// 4. Scheduling quantity (F-15-12)
// ---------------------------------------------------------------------------

export type OpenEventClaim = { quantity: unknown; held_qty_reserved?: unknown };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Units free to schedule = on hand − held − open destructions not already
 * backed by held units. Held units belong to customer-return Destroy events
 * (G-44) and vendor returns (G-42); an open event that reserved held units is
 * already inside "held", so it is not counted twice.
 */
export function schedulableQty(input: { onHand: unknown; held: unknown; openEvents: readonly OpenEventClaim[] }): number {
  const onHand = num(input.onHand);
  const held = num(input.held);
  const claimed = input.openEvents.reduce((sum, e) => (num(e.held_qty_reserved) > 0 ? sum : sum + num(e.quantity)), 0);
  return Math.max(0, onHand - held - claimed);
}

export function evaluateScheduleQuantity(input: {
  quantity: number;
  onHand: unknown;
  held: unknown;
  openEvents: readonly OpenEventClaim[];
}): { ok: true } | { ok: false; message: string } {
  const free = schedulableQty(input);
  if (!(input.quantity > 0)) return { ok: false, message: "Quantity must be greater than zero." };
  if (input.quantity > free) {
    const held = num(input.held);
    const claimed = num(input.onHand) - held - free;
    return {
      ok: false,
      message:
        `Quantity (${input.quantity}) is more than the lot has free to schedule (${free}): on hand ${num(input.onHand)}` +
        (held > 0 ? `, held ${held}` : "") +
        (claimed > 0 ? `, already scheduled ${claimed}` : "") +
        ". Count the units again; nothing was scheduled.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 1–3. Completion record (witness, camera, Other method approval)
// ---------------------------------------------------------------------------

export type RosterPerson = { id: string; full_name: string; staff_id: string | null; active: boolean };

export type DestructionRecordInput = {
  /** Employee id chosen in "Witness (from the roster)". */
  witnessEmployeeId: string | null;
  roster: readonly RosterPerson[];
  /** The signed-in person completing. */
  actorUserId: string | null;
  actorName: string | null;
  cameraName: string | null;
  /** ISO instants (from pacificInputToIso). */
  cameraStartIso: string | null;
  cameraEndIso: string | null;
  renderingMethod: string;
  otherApprovalRef: string | null;
  otherApprovalDate: string | null;
  nowMs: number;
};

export const CAMERA_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function evaluateDestructionRecord(
  i: DestructionRecordInput,
): { ok: true; witness: RosterPerson } | { ok: false; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const witness = i.roster.find((p) => p.id === trimmed(i.witnessEmployeeId)) ?? null;
  if (!trimmed(i.witnessEmployeeId)) {
    refusals.push({ code: "witness_missing", message: "Choose the witness from the staff roster (anyone on staff, not you; D64)." });
  } else if (!witness || !witness.active) {
    refusals.push({ code: "witness_unknown", message: "The witness must be an active person on the staff roster." });
  } else {
    const sameLogin = !!i.actorUserId && witness.staff_id === i.actorUserId;
    const sameName = !!trimmed(i.actorName) && trimmed(witness.full_name).toLowerCase() === trimmed(i.actorName).toLowerCase();
    if (sameLogin || sameName) {
      refusals.push({ code: "witness_is_actor", message: "The witness must be a second person, not the one completing the destruction (D64)." });
    }
  }

  if (!trimmed(i.cameraName)) {
    refusals.push({ code: "camera_missing", message: "Record the camera that covered the destruction (D64; WAC 314-55-083(3)(a))." });
  }
  const start = i.cameraStartIso ? Date.parse(i.cameraStartIso) : NaN;
  const end = i.cameraEndIso ? Date.parse(i.cameraEndIso) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    refusals.push({ code: "camera_times", message: "Record the camera start and end time (Pacific) so the footage can be found." });
  } else if (end <= start) {
    refusals.push({ code: "camera_order", message: "The camera end time must be after the start time." });
  } else if (end > i.nowMs + CAMERA_FUTURE_TOLERANCE_MS) {
    refusals.push({ code: "camera_future", message: "The camera end time is in the future. Complete the record after the destruction is done." });
  }

  if (i.renderingMethod === "lcb_approved_other") {
    if (!trimmed(i.otherApprovalRef) || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed(i.otherApprovalDate))) {
      refusals.push({
        code: "other_approval",
        message: "Other method needs the LCB's prior written approval: enter its reference and date (WAC 314-55-097).",
      });
    }
  }

  return refusals.length === 0 && witness ? { ok: true, witness } : { ok: false, refusals };
}

/** The text kept in witnessed_by (and the record before migration 0310). */
export function witnessLine(i: { witnessName: string; actorName: string | null; cameraName: string; cameraStartIso: string; cameraEndIso: string }): string {
  const did = trimmed(i.actorName);
  return (
    `${did ? `${did} (did) / ` : ""}${trimmed(i.witnessName)} (witness)` +
    ` \u00b7 camera ${trimmed(i.cameraName)} ${formatDestructionPacific(i.cameraStartIso)} \u2013 ${formatDestructionPacific(i.cameraEndIso)}`
  );
}

export const DESTRUCTION_COMPLETE_AUDIT_ACTION = "destruction.complete";

// ---------------------------------------------------------------------------
// 6. Printable destruction log (form 8.3 in the app)
// ---------------------------------------------------------------------------

export type DestructionLogRow = {
  completed_at: string | null;
  product_name: string | null;
  lot_code: string | null;
  quantity: number;
  unit: string | null;
  reason: string;
  rendering_method: string | null;
  mix_material: string | null;
  final_destination: string | null;
  disposal_facility: string | null;
  witnessed_by: string | null;
  camera_name?: string | null;
  camera_start_at?: string | null;
  camera_end_at?: string | null;
  other_method_approval_ref?: string | null;
  completed_by_name: string | null;
};

/** "YYYY-MM" for a Pacific month; refuses anything else. */
export function parseLogMonth(v: string | null | undefined): string | null {
  const m = trimmed(v);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
  return m;
}

/** The camera cell of the log: from the columns, else "see witness line". */
export function cameraCell(
  r: Pick<DestructionLogRow, "camera_name" | "camera_start_at" | "camera_end_at"> & { witnessed_by?: string | null },
): string {
  if (trimmed(r.camera_name)) {
    return `${trimmed(r.camera_name)} ${formatDestructionPacific(r.camera_start_at)} \u2013 ${formatDestructionPacific(r.camera_end_at)}`;
  }
  return trimmed(r.witnessed_by).includes("camera") ? "in the witness line" : "not recorded (before Phase 1.6)";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runDestructionRecordCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`destruction-record-core FAIL: ${msg}`);
    }
  };
  // Pacific formatting (PDT, July; PST, January).
  ok(formatDestructionPacific("2026-07-04T21:05:00Z") === "07/04/2026 2:05 PM Pacific", "PDT format");
  ok(formatDestructionPacific("2026-01-10T08:00:00Z") === "01/10/2026 12:00 AM Pacific", "PST midnight");
  ok(formatDestructionPacific(null) === "" && formatDestructionPacific("nope") === "", "blank and invalid");
  ok(holdNotElapsedMessage("2026-07-04T21:05:00Z").endsWith("07/04/2026 2:05 PM Pacific."), "hold message Pacific");

  // Scheduling quantity.
  ok(schedulableQty({ onHand: 10, held: 0, openEvents: [] }) === 10, "free = on hand");
  ok(schedulableQty({ onHand: 10, held: 2, openEvents: [{ quantity: 2, held_qty_reserved: 2 }] }) === 8, "held event not double counted");
  ok(schedulableQty({ onHand: 10, held: 0, openEvents: [{ quantity: 4 }, { quantity: 3, held_qty_reserved: 0 }] }) === 3, "open events claimed");
  ok(schedulableQty({ onHand: 2, held: 1, openEvents: [{ quantity: 5 }] }) === 0, "never negative");
  ok(evaluateScheduleQuantity({ quantity: 3, onHand: 10, held: 0, openEvents: [{ quantity: 4 }] }).ok, "within free");
  const over = evaluateScheduleQuantity({ quantity: 7, onHand: 10, held: 1, openEvents: [{ quantity: 4 }] });
  ok(!over.ok && over.message.includes("free to schedule (5)") && over.message.includes("held 1") && over.message.includes("already scheduled 4"), "over refused with figures");
  ok(!evaluateScheduleQuantity({ quantity: 0, onHand: 10, held: 0, openEvents: [] }).ok, "zero refused");

  // Completion record.
  const roster: RosterPerson[] = [
    { id: "e1", full_name: "Alex Lee", staff_id: "u1", active: true },
    { id: "e2", full_name: "Jo Smith", staff_id: null, active: true },
    { id: "e3", full_name: "Old Hand", staff_id: null, active: false },
  ];
  const now = Date.parse("2026-07-04T22:00:00Z");
  const base: DestructionRecordInput = {
    witnessEmployeeId: "e2",
    roster,
    actorUserId: "u1",
    actorName: "Alex Lee",
    cameraName: "Cam 4 vault",
    cameraStartIso: "2026-07-04T21:05:00Z",
    cameraEndIso: "2026-07-04T21:20:00Z",
    renderingMethod: "grind_mix_compostable",
    otherApprovalRef: null,
    otherApprovalDate: null,
    nowMs: now,
  };
  const codes = (r: ReturnType<typeof evaluateDestructionRecord>) => (r.ok ? [] : r.refusals.map((x) => x.code));
  ok(evaluateDestructionRecord(base).ok, "valid record");
  ok(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: null })).includes("witness_missing"), "witness required");
  ok(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "zz" })).includes("witness_unknown"), "unknown witness");
  ok(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "e3" })).includes("witness_unknown"), "inactive witness");
  ok(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "e1" })).includes("witness_is_actor"), "self by login");
  ok(
    codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "e2", actorUserId: "u9", actorName: "jo smith" })).includes("witness_is_actor"),
    "self by name",
  );
  ok(codes(evaluateDestructionRecord({ ...base, cameraName: " " })).includes("camera_missing"), "camera name required");
  ok(codes(evaluateDestructionRecord({ ...base, cameraStartIso: null })).includes("camera_times"), "camera times required");
  ok(codes(evaluateDestructionRecord({ ...base, cameraEndIso: "2026-07-04T21:00:00Z" })).includes("camera_order"), "end after start");
  ok(codes(evaluateDestructionRecord({ ...base, cameraEndIso: "2026-07-04T23:00:00Z" })).includes("camera_future"), "not in the future");
  ok(codes(evaluateDestructionRecord({ ...base, renderingMethod: "lcb_approved_other" })).includes("other_approval"), "other needs approval");
  ok(
    evaluateDestructionRecord({ ...base, renderingMethod: "lcb_approved_other", otherApprovalRef: "LCB-123", otherApprovalDate: "2026-06-01" }).ok,
    "other with approval",
  );
  const all = codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: null, cameraName: null, cameraStartIso: null }));
  ok(all.length === 3, "every refusal at once");

  // Witness line and log helpers.
  const line = witnessLine({ witnessName: "Jo Smith", actorName: "Alex Lee", cameraName: "Cam 4", cameraStartIso: base.cameraStartIso!, cameraEndIso: base.cameraEndIso! });
  ok(line.startsWith("Alex Lee (did) / Jo Smith (witness) \u00b7 camera Cam 4 07/04/2026 2:05 PM Pacific"), "witness line");
  ok(parseLogMonth("2026-07") === "2026-07" && parseLogMonth("2026-13") === null && parseLogMonth("x") === null, "month parse");
  const row: DestructionLogRow = {
    completed_at: null, product_name: null, lot_code: null, quantity: 1, unit: null, reason: "expired",
    rendering_method: null, mix_material: null, final_destination: null, disposal_facility: null,
    witnessed_by: null, completed_by_name: null,
  };
  ok(cameraCell(row) === "not recorded (before Phase 1.6)", "legacy camera cell");
  ok(cameraCell({ ...row, camera_name: "Cam 4", camera_start_at: base.cameraStartIso, camera_end_at: base.cameraEndIso }).startsWith("Cam 4 07/04/2026"), "camera cell");
  return { passed, failed };
}
