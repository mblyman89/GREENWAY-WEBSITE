/**
 * src/lib/pos/device-pairing-core.ts  (POS register rotation slice)
 *
 * PURE rules for retiring, re-pairing and renaming register iPads. No React,
 * no DB, no network — the register shell and the back office both call in.
 *
 * Why this exists (verified in the field): the owner revoked the iPad in the
 * back office to test it. The register then had NO way back:
 *   - the 401 from /api/pos/sync only set a dismissible banner, so the iPad
 *     sat on the lock screen holding a dead key forever;
 *   - the pairing lives in the app's data container (and, once the native
 *     keychain backend lands, in the iPad keychain — which iOS keeps even
 *     after the app is deleted), so rebuilding / reinstalling from Xcode
 *     brought the dead key straight back;
 *   - the back office showed revoked rows with no actions at all.
 *
 * The enterprise pattern this follows (Square device codes, Lightspeed
 * register deactivation): the DEVICE IS RETIRED REMOTELY by someone with the
 * back-office permission, the register NOTICES and stops selling, and a
 * manager re-pairs it with a freshly minted credential. Floor staff never
 * get an "unpair" button: the only way to put an iPad back into service is a
 * new key, and only a staffing.manage user can mint one.
 *
 * Safety rules pinned here:
 *   1. ONLY the server's exact 401 auth answers count as "this pairing is
 *      dead". Network errors, 5xx, 429 and anything else are transient.
 *   2. Detecting a dead pairing NEVER erases anything by itself. If the app
 *      is pointed at the wrong server (AB-1), every device looks "unknown";
 *      auto-erasing would wipe a healthy till. A later successful heartbeat
 *      clears the problem on its own.
 *   3. Unsynced sales belong to the device id that rang them (the server's
 *      checkEnvelopeForDevice refuses any other device). So moving this iPad
 *      to a DIFFERENT device id while unsynced rows exist is refused — the
 *      manager reactivates the SAME device row with a new key instead, the
 *      rows sync, and then the iPad can move.
 */

/** Why the server stopped accepting this register's pairing. */
export type PairingProblem = "revoked" | "key_rejected" | "malformed";

/**
 * Exact error strings returned by authenticateDevice (src/lib/pos/sync-store.ts).
 * Kept verbatim: matching anything looser would let an unrelated 401 (a bad
 * employee PIN on /api/pos/unlock returns 401 "No active employee for that
 * PIN.") masquerade as a retired register.
 */
export const DEVICE_AUTH_ERRORS = {
  revoked: "Unknown or revoked device.",
  key_rejected: "Device key rejected.",
  malformed: "Missing or malformed device credentials.",
} as const satisfies Record<PairingProblem, string>;

/**
 * Classify a failed register request. Returns null for anything that is NOT
 * a definitive device-credential refusal (transient — keep going).
 */
export function classifyDeviceAuthFailure(status: number, error: unknown): PairingProblem | null {
  if (status !== 401) return null;
  if (typeof error !== "string") return null;
  const e = error.trim();
  if (e === DEVICE_AUTH_ERRORS.revoked) return "revoked";
  if (e === DEVICE_AUTH_ERRORS.key_rejected) return "key_rejected";
  if (e === DEVICE_AUTH_ERRORS.malformed) return "malformed";
  return null;
}

/** Plain-language headline + reason for the re-pair screen. */
export function pairingProblemMessage(problem: PairingProblem): { title: string; detail: string } {
  switch (problem) {
    case "revoked":
      return {
        title: "This register was retired",
        detail:
          "The back office no longer recognizes this iPad's pairing — it was revoked (or the device row no longer exists). " +
          "It cannot ring sales until a manager pairs it again.",
      };
    case "key_rejected":
      return {
        title: "This register's key was replaced",
        detail:
          "A manager rotated this iPad's device key in the back office, so the key saved here no longer works. " +
          "Enter the NEW key to put the register back in service.",
      };
    case "malformed":
      return {
        title: "This register's pairing is damaged",
        detail:
          "The device id or key saved on this iPad is not in a valid shape. A manager needs to pair it again.",
      };
  }
}

/** Banner shown on the sale screen when the pairing dies mid-shift. */
export function pairingProblemBanner(problem: PairingProblem): string {
  const { title } = pairingProblemMessage(problem);
  return `${title}. Finish up and lock the register — a manager must re-pair it before the next sale syncs.`;
}

export type RepairDecision =
  | { ok: true; sameDevice: boolean }
  | { ok: false; problem: string };

/**
 * May this iPad switch from its current pairing to `nextDeviceId`?
 *
 *   - same device id (reactivated or rotated row) → always allowed; the queue
 *     keeps syncing under the same id;
 *   - different device id with ZERO unsynced rows → allowed;
 *   - different device id WITH unsynced rows → refused (rule 3 above).
 *
 * `currentDeviceId` null = a first-time setup (nothing to protect).
 */
export function planRepair(args: {
  currentDeviceId: string | null;
  nextDeviceId: string;
  unsyncedCount: number;
}): RepairDecision {
  const current = (args.currentDeviceId ?? "").trim().toLowerCase();
  const next = args.nextDeviceId.trim().toLowerCase();
  if (!current) return { ok: true, sameDevice: false };
  if (current === next) return { ok: true, sameDevice: true };
  const n = Number.isFinite(args.unsyncedCount) ? Math.max(0, Math.floor(args.unsyncedCount)) : 0;
  if (n === 0) return { ok: true, sameDevice: false };
  return {
    ok: false,
    problem:
      `This iPad still holds ${n} unsynced event${n === 1 ? "" : "s"} recorded under its old device id, and the server ` +
      "only accepts them from that same device. In the back office (Register Activity → POS devices) use " +
      "\"Reactivate with new key\" on the OLD device row and enter that id + new key here so they sync. " +
      "Once the queue is empty you can move this iPad to a different device.",
  };
}

/**
 * May the retired pairing be erased from this iPad (handing the iPad on)?
 * Never while unsynced rows exist — the rows would become unsendable.
 */
export function canErasePairing(unsyncedCount: number): { ok: true } | { ok: false; problem: string } {
  const n = Number.isFinite(unsyncedCount) ? Math.max(0, Math.floor(unsyncedCount)) : 0;
  if (n === 0) return { ok: true };
  return {
    ok: false,
    problem: `Not while ${n} unsynced event${n === 1 ? " is" : "s are"} still saved here — reactivate the old device row so they sync first.`,
  };
}

/**
 * Self-heal the stored pairing from the server's device answer (name and
 * register binding are server-owned; a rename or rebind in the back office
 * reaches the iPad on its next heartbeat). Returns the updated pairing, or
 * null when nothing changed.
 */
export function refreshedPairing<
  T extends { name: string; registerId: string | null },
>(current: T, server: { name?: unknown; registerId?: unknown } | null | undefined): T | null {
  if (!server) return null;
  const name = typeof server.name === "string" && server.name.trim() ? server.name.trim() : current.name;
  const registerId =
    typeof server.registerId === "string" ? server.registerId : server.registerId === null ? null : current.registerId;
  if (name === current.name && registerId === current.registerId) return null;
  return { ...current, name, registerId };
}

/** How often a locked/idle register re-checks its pairing (ms). */
export const PAIRING_HEARTBEAT_MS = 60_000;

// ---------------------------------------------------------------------------
// Back office
// ---------------------------------------------------------------------------

export const DEVICE_NAME_MIN = 3;
export const DEVICE_NAME_MAX = 80;

/** Validate a device name (provision + rename share this). */
export function validateDeviceName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name.length < DEVICE_NAME_MIN) {
    return { ok: false, error: `Give the device a name (at least ${DEVICE_NAME_MIN} characters).` };
  }
  if (name.length > DEVICE_NAME_MAX) {
    return { ok: false, error: `Keep the device name to ${DEVICE_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, name };
}

export type DeviceAction = "bind" | "rotate" | "revoke" | "rename" | "reactivate";

/** Which back-office controls a device row offers, by status. */
export function deviceActionsFor(status: string): readonly DeviceAction[] {
  if (status === "active") return ["rename", "bind", "rotate", "revoke"];
  if (status === "revoked") return ["rename", "reactivate"];
  return [];
}

/** The literal a manager types to confirm a revoke (no accidental clicks). */
export const REVOKE_CONFIRM_WORD = "REVOKE";

/** Server-side check of the two-step revoke confirmation. */
export function isRevokeConfirmed(typed: unknown): boolean {
  return typeof typed === "string" && typed.trim().toUpperCase() === REVOKE_CONFIRM_WORD;
}

// ---------------------------------------------------------------------------
// Self-tests (rule: every *-core ships __run…Tests)
// ---------------------------------------------------------------------------

export function __runDevicePairingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log("FAIL:", label);
    }
  };
  const A = "59768c42-aa8c-4dab-8e6e-a2e766fe16b0";
  const B = "0d3c1b7e-1111-4a2b-9c3d-222233334444";

  ok(classifyDeviceAuthFailure(401, "Unknown or revoked device.") === "revoked", "revoked classified");
  ok(classifyDeviceAuthFailure(401, "Device key rejected.") === "key_rejected", "rotated key classified");
  ok(classifyDeviceAuthFailure(401, "Missing or malformed device credentials.") === "malformed", "malformed classified");
  ok(classifyDeviceAuthFailure(503, "Unknown or revoked device.") === null, "non-401 is transient");
  ok(classifyDeviceAuthFailure(401, "No active employee for that PIN.") === null, "bad PIN is not a dead pairing");
  ok(classifyDeviceAuthFailure(401, undefined) === null, "missing body is transient");
  ok(classifyDeviceAuthFailure(429, "Device key rejected.") === null, "throttle is transient");

  ok(planRepair({ currentDeviceId: null, nextDeviceId: A, unsyncedCount: 9 }).ok, "first setup always allowed");
  const same = planRepair({ currentDeviceId: A, nextDeviceId: A.toUpperCase(), unsyncedCount: 5 });
  ok(same.ok && same.sameDevice, "same device (any case) allowed with queue");
  ok(planRepair({ currentDeviceId: A, nextDeviceId: B, unsyncedCount: 0 }).ok, "new device allowed with empty queue");
  ok(!planRepair({ currentDeviceId: A, nextDeviceId: B, unsyncedCount: 2 }).ok, "new device refused with queue");

  ok(canErasePairing(0).ok, "erase allowed when empty");
  ok(!canErasePairing(1).ok, "erase refused with queue");

  const cur = { name: "Register 1 iPad", registerId: "r1", deviceKey: "k" };
  ok(refreshedPairing(cur, { name: "Register 1 iPad", registerId: "r1" }) === null, "no change → null");
  ok(refreshedPairing(cur, { name: "Front iPad", registerId: "r1" })?.name === "Front iPad", "rename heals");
  ok(refreshedPairing(cur, { name: "Register 1 iPad", registerId: null })?.registerId === null, "unbind heals");
  ok(refreshedPairing(cur, { name: "", registerId: "r1" }) === null, "blank server name ignored");
  ok(refreshedPairing(cur, { name: "X1Y", registerId: "r2" })?.deviceKey === "k", "key preserved");

  ok(validateDeviceName("  Front   iPad ").ok, "name normalized");
  ok(!validateDeviceName("ab").ok, "short name refused");
  ok(!validateDeviceName("x".repeat(81)).ok, "long name refused");

  ok(deviceActionsFor("revoked").includes("reactivate"), "revoked can reactivate");
  ok(!deviceActionsFor("revoked").includes("rotate"), "revoked cannot rotate");
  ok(!deviceActionsFor("active").includes("reactivate"), "active cannot reactivate");

  ok(isRevokeConfirmed(" revoke "), "confirm word case-insensitive");
  ok(!isRevokeConfirmed("yes"), "wrong word refused");
  ok(!isRevokeConfirmed(null), "missing refused");

  return { passed, failed };
}
