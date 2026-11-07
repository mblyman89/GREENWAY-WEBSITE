/**
 * src/lib/pos/offline-till-core.ts — D170 O1 (owner 2026-11-04: "finish all
 * remaining offline mode tasks ... I want to make sure we are fully hardened
 * and prepared for any situation").
 *
 * PURE core for the drawer work done while the register has NO server:
 * count-in, safe drop, change swap, blind close and the open-for-count pop.
 *
 * How it works
 *  - The iPad checks every PIN against its offline verifier vault (D161),
 *    never a PIN or hash. The cashier's own PIN; a drop witness (any armed
 *    employee, never the dropper); a swap approver (an armed manager/lead,
 *    never the cashier).
 *  - The action is queued as a signed `till_action` sale event carrying the
 *    exact same fields the online /api/pos/till takes (minus the PINs), and
 *    the SAME validator (till-core#validateTillRequest) checks them on the
 *    iPad and again at sync, so offline can never accept what online refuses.
 *  - An offline count-in mints the drawer session id on the iPad. Sales rung
 *    afterwards reference it; the queue replays in device order, so the
 *    session exists on the server before the first of those sales syncs.
 *  - At sync the server re-judges every PIN against who is active (and a
 *    manager, for a swap) NOW, then writes the drawer rows with the time the
 *    cash actually moved. Anything doubtful becomes a manager exception.
 *  - Blind discipline is unchanged: nothing here ever computes or returns an
 *    expected figure.
 */
import { validateTillRequest, type TillRequest } from "./till-core";
import { OFFLINE_APPROVER_ROLES, type OfflineReason } from "./offline-unlock-core";
import { EMPTY_DENOMS, type DenomCounts } from "@/lib/registers/cash";

export type OfflineTillAction = "open" | "drop" | "swap" | "close" | "pop";

/** Who proved a PIN on the iPad (from the vault record), never the PIN. */
export type OfflineTillPin = { employeeId: string; armedAt: string; keyId: string };

export type PosTillPayload = {
  action: OfflineTillAction;
  /** The drawer session: minted on the iPad for an offline count-in. */
  drawerRef: string;
  /** Why the iPad went offline for this action. */
  reason: OfflineReason;
  actor: OfflineTillPin;
  witness?: OfflineTillPin;
  approver?: OfflineTillPin;
  denoms?: DenomCounts;
  amountMinor?: number;
  window?: "afternoon" | "night" | "other";
  /** D198: drop only. Absent = safe (every build before D198). "atm" carries the $20 count. */
  destination?: "safe" | "atm";
  twentiesCount?: number;
  inDenoms?: DenomCounts;
  outDenoms?: DenomCounts;
  notes?: string;
  tipsMinor?: number;
  tipPool?: { poolMinor: number; people: number };
  confirmEmpty?: true;
  /** D204a: close only, the closer counted again after the look-again prompt. */
  recountConfirmed?: true;
  /** pop only: a repeat open needs a reason (D131). */
  popReason?: string;
  /** pop only: which open this was on this iPad (1 = first). */
  popNumber?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const KEYID_RE = /^e\d{1,9}$/;
const REASONS = new Set(["offline", "timeout", "network", "server_error"]);

function pinOk(p: unknown): p is OfflineTillPin {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.employeeId === "string" && UUID_RE.test(r.employeeId) &&
    typeof r.armedAt === "string" && ISO_RE.test(r.armedAt) &&
    typeof r.keyId === "string" && KEYID_RE.test(r.keyId)
  );
}

/**
 * Validate a queued till action and return the normalized till request the
 * online route would have built (same rules, same tip split). PIN fields are
 * stand-ins: the PINs were checked on the iPad and are re-judged by id.
 */
export function validateTillPayload(
  raw: unknown,
  envelopeEmployeeId?: string,
): { ok: true; payload: PosTillPayload; req: TillRequest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["payload must be an object."] };
  const p = raw as PosTillPayload;
  if (!["open", "drop", "swap", "close", "pop"].includes(p.action)) errors.push("action must be open, drop, swap, close or pop.");
  if (typeof p.drawerRef !== "string" || !UUID_RE.test(p.drawerRef)) errors.push("drawerRef must be a UUID.");
  if (!REASONS.has(p.reason)) errors.push("reason is not recognized.");
  if (!pinOk(p.actor)) errors.push("actor must name the employee whose PIN was checked (id, armedAt, keyId).");
  if (envelopeEmployeeId && pinOk(p.actor) && p.actor.employeeId !== envelopeEmployeeId) {
    errors.push("actor must be the event's employee.");
  }
  if (p.witness !== undefined) {
    if (!pinOk(p.witness)) errors.push("witness is malformed.");
    else if (p.action !== "drop") errors.push("only a drop has a witness.");
    else if (pinOk(p.actor) && p.witness.employeeId === p.actor.employeeId) errors.push("A drop cannot witness itself — a second person must enter their PIN.");
  }
  if (p.action === "swap") {
    if (!pinOk(p.approver)) errors.push("A manager or lead must approve the swap with their PIN.");
    else if (pinOk(p.actor) && p.approver.employeeId === p.actor.employeeId) errors.push("A swap cannot approve itself — a manager or lead must enter their PIN.");
  } else if (p.approver !== undefined) {
    errors.push("only a swap has an approver.");
  }
  if (p.action === "pop" && p.popNumber !== undefined && (!Number.isInteger(p.popNumber) || p.popNumber < 1)) {
    errors.push("popNumber must be a whole number from 1.");
  }
  if (errors.length) return { ok: false, errors };

  const body: Record<string, unknown> = { action: p.action, pin: "offline" };
  if (p.action === "open" || p.action === "close") body.denoms = p.denoms ?? { ...EMPTY_DENOMS };
  if (p.action === "close") {
    if (p.confirmEmpty) body.confirmEmpty = true;
    if (p.recountConfirmed) body.recountConfirmed = true;
    if (p.tipPool) body.tipPool = p.tipPool;
    else if (p.tipsMinor !== undefined) body.tipsMinor = p.tipsMinor;
  }
  if (p.action === "drop") {
    body.amountMinor = p.amountMinor;
    body.window = p.window;
    if (p.witness) body.witnessPin = "offline";
    if (p.notes) body.notes = p.notes;
    if (p.destination !== undefined) body.destination = p.destination;
    if (p.twentiesCount !== undefined) body.twentiesCount = p.twentiesCount;
  }
  if (p.action === "swap") {
    body.amountMinor = p.amountMinor;
    body.approverPin = "offline";
    body.inDenoms = p.inDenoms;
    body.outDenoms = p.outDenoms;
    if (p.notes) body.notes = p.notes;
  }
  if (p.action === "pop" && p.popReason) body.reason = p.popReason;
  const v = validateTillRequest(body);
  if (!v.ok) return { ok: false, errors: [v.error] };
  if (p.action === "pop" && (p.popNumber ?? 1) > 1 && !(p.popReason && p.popReason.trim().length >= 3)) {
    return { ok: false, errors: ["Opening the drawer again needs a short reason (owner rule D131)."] };
  }
  return { ok: true, payload: p, req: v.req };
}

export type TillPinPerson = { active: boolean; jobRole: string } | null;

/**
 * The server's verdict on every PIN behind a synced till action, given who
 * the employees are NOW. A PIN from before the owner's reset (older keyId
 * epoch) is flagged, never hidden.
 */
export function judgeTillPins(input: {
  payload: PosTillPayload;
  people: Record<string, TillPinPerson>;
  currentKeyId: string;
}): { ok: true } | { ok: false; reason: string } {
  const cur = Number(input.currentKeyId.slice(1));
  const check = (pin: OfflineTillPin | undefined, role: string, needApprover: boolean): string | null => {
    if (!pin) return null;
    const who = input.people[pin.employeeId] ?? null;
    if (!who) return `The ${role} PIN belongs to an employee id the server does not know.`;
    if (!who.active) return `The ${role} is no longer an active employee.`;
    if (needApprover && !OFFLINE_APPROVER_ROLES.includes(who.jobRole)) return `The ${role} is not a manager or lead now.`;
    const used = Number(pin.keyId.slice(1));
    if (Number.isFinite(used) && Number.isFinite(cur) && used < cur) return `The ${role} used an offline PIN from before the owner's reset.`;
    return null;
  };
  const p = input.payload;
  const bad = check(p.actor, "cashier", false) ?? check(p.witness, "drop witness", false) ?? check(p.approver, "swap approver", true);
  return bad ? { ok: false, reason: `Offline drawer ${p.action}: ${bad} Review it.` } : { ok: true };
}

/** A note stamped on drop/swap rows so a re-run never writes them twice. */
export function offlineTillNote(clientUuid: string, notes?: string): string {
  const tag = `[offline ${clientUuid}]`;
  return notes ? `${notes} ${tag}` : tag;
}

/** The banner the cashier sees after an offline drawer action. */
export function offlineTillMessage(action: OfflineTillAction, amountWords: string, destination: "safe" | "atm" = "safe"): string {
  const tail = " Saved on this iPad (offline); it goes to the back office as soon as the internet is back.";
  switch (action) {
    case "open":
      return `Drawer counted in at ${amountWords} — ready to ring sales.${tail}`;
    case "drop":
      return destination === "atm"
        ? `${amountWords} recorded for the ATM. Load the bills into the ATM now.${tail}`
        : `${amountWords} dropped to the safe.${tail}`;
    case "swap":
      return `${amountWords} change swap with the safe recorded.${tail}`;
    case "close":
      return `Drawer closed.${tail} Leave the printed drawer close slip with the till. The second count is done in the office.`;
    case "pop":
      return `Drawer open. Count the bills, then finish below.${tail}`;
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOfflineTillCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`offline-till-core FAIL: ${label}`);
    }
  };
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const D = "33333333-3333-4333-8333-333333333333";
  const pin = (id: string, keyId = "e1"): OfflineTillPin => ({ employeeId: id, armedAt: "2026-11-04T10:00:00.000Z", keyId });
  const base = { drawerRef: D, reason: "offline" as const, actor: pin(A) };
  const float = { ...EMPTY_DENOMS, twenties: 10 };

  ok(validateTillPayload({ ...base, action: "open", denoms: float }, A).ok, "open with a float passes");
  ok(!validateTillPayload({ ...base, action: "open", denoms: EMPTY_DENOMS }).ok, "empty float refused (same as online)");
  ok(!validateTillPayload({ ...base, action: "open", denoms: float }, B).ok, "actor must be the envelope employee");
  ok(!validateTillPayload({ ...base, action: "open", drawerRef: "x", denoms: float }).ok, "drawerRef must be a uuid");
  ok(validateTillPayload({ ...base, action: "drop", amountMinor: 50000, window: "night" }).ok, "drop passes");
  ok(!validateTillPayload({ ...base, action: "drop", amountMinor: 0, window: "night" }).ok, "zero drop refused");
  ok(!validateTillPayload({ ...base, action: "drop", amountMinor: 500, window: "night", witness: pin(A) }).ok, "self-witness refused");
  ok(validateTillPayload({ ...base, action: "drop", amountMinor: 500, window: "night", witness: pin(B) }).ok, "second-person witness passes");
  const bills = { ...EMPTY_DENOMS, hundreds: 1 };
  const change = { ...EMPTY_DENOMS, twenties: 5 };
  ok(validateTillPayload({ ...base, action: "swap", amountMinor: 10000, inDenoms: bills, outDenoms: change, approver: pin(B) }).ok, "swap with approver passes");
  ok(!validateTillPayload({ ...base, action: "swap", amountMinor: 10000, inDenoms: bills, outDenoms: change }).ok, "swap without approver refused");
  ok(!validateTillPayload({ ...base, action: "swap", amountMinor: 10000, inDenoms: bills, outDenoms: change, approver: pin(A) }).ok, "self-approved swap refused");
  ok(!validateTillPayload({ ...base, action: "swap", amountMinor: 10000, inDenoms: bills, outDenoms: { ...EMPTY_DENOMS, twenties: 4 }, approver: pin(B) }).ok, "unequal swap bills refused");
  ok(!validateTillPayload({ ...base, action: "close", denoms: EMPTY_DENOMS, tipsMinor: 0 }).ok, "$0 close without confirm refused (D125)");
  ok(validateTillPayload({ ...base, action: "close", denoms: EMPTY_DENOMS, confirmEmpty: true, tipsMinor: 0 }).ok, "$0 close with confirm passes");
  const pooled = validateTillPayload({ ...base, action: "close", denoms: float, tipPool: { poolMinor: 1001, people: 2 } });
  ok(pooled.ok && pooled.req.action === "close" && pooled.req.tipsMinor === 500, "tip pool split matches the online rule");
  ok(validateTillPayload({ ...base, action: "pop", popNumber: 1 }).ok, "first pop free");
  ok(!validateTillPayload({ ...base, action: "pop", popNumber: 2 }).ok, "repeat pop needs a reason");
  ok(validateTillPayload({ ...base, action: "pop", popNumber: 2, popReason: "miscounted" }).ok, "repeat pop with reason passes");

  const people = { [A]: { active: true, jobRole: "sales" }, [B]: { active: true, jobRole: "manager" } };
  const swapP = { ...base, action: "swap" as const, approver: pin(B) };
  ok(judgeTillPins({ payload: swapP, people, currentKeyId: "e1" }).ok, "active cashier + manager approver ok");
  ok(!judgeTillPins({ payload: swapP, people: { ...people, [B]: { active: true, jobRole: "sales" } }, currentKeyId: "e1" }).ok, "approver no longer a manager flagged");
  ok(!judgeTillPins({ payload: swapP, people: { ...people, [A]: { active: false, jobRole: "sales" } }, currentKeyId: "e1" }).ok, "inactive cashier flagged");
  ok(!judgeTillPins({ payload: swapP, people, currentKeyId: "e2" }).ok, "pre-reset PIN flagged");
  ok(!judgeTillPins({ payload: { ...base, action: "drop" as const, witness: pin(D) }, people, currentKeyId: "e1" }).ok, "unknown witness flagged");
  ok(offlineTillNote("c1", "bag 4") === "bag 4 [offline c1]" && offlineTillNote("c1") === "[offline c1]", "idempotency note");
  ok(/Saved on this iPad/.test(offlineTillMessage("drop", "$500.00")), "message says it is saved offline");
  // D198: ATM drops offline: same $20 rule as online, re-checked at sync.
  const atmQ = validateTillPayload({ ...base, action: "drop", destination: "atm", twentiesCount: 50, window: "night" });
  ok(atmQ.ok && atmQ.req.action === "drop" && atmQ.req.destination === "atm" && atmQ.req.amountMinor === 100000, "offline ATM drop: 50 x $20 = $1,000 derived");
  ok(!validateTillPayload({ ...base, action: "drop", destination: "atm", twentiesCount: 50, amountMinor: 99900, window: "night" }).ok, "offline ATM drop: amount not count x $20 refused");
  ok(!validateTillPayload({ ...base, action: "drop", destination: "atm", window: "night" }).ok, "offline ATM drop: missing $20 count refused");
  ok(/ATM/.test(offlineTillMessage("drop", "$1,000.00", "atm")) && !/safe/.test(offlineTillMessage("drop", "$1,000.00", "atm")), "offline ATM message names the ATM, not the safe");
  return { passed, failed };
}
