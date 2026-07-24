/**
 * src/lib/staffing/handbook-ack-core.ts  (SLICE 36)
 *
 * PURE logic for the employee-handbook acknowledgment GATE (owner directive:
 * "new employees have to read it and check a box and validate they read them
 * and will abide … before being given access to the back office and front
 * end POS"). No server-only imports — self-tested via __runHandbookAckTests
 * and wired into the compliance harness.
 *
 * Policy:
 *  1. BACK OFFICE: a staff account must hold an acknowledgment for the
 *     CURRENT handbook version, or the admin shell shows the handbook +
 *     acknowledgment screen instead of the requested page. OWNERS are exempt
 *     — they wrote the policies and can never be locked out of their own
 *     store (same principle as user-guards-core.ts).
 *  2. REGISTER: a PIN unlock is refused until the employee's linked staff
 *     account acknowledged the CURRENT version, OR the paper acknowledgment
 *     is marked SIGNED in their employee file (employee_documents.handbook
 *     = 'signed') — the paper path covers PIN-only employees with no staff
 *     login.
 *  3. VERSIONED: when HANDBOOK_VERSION changes, prior acknowledgments no
 *     longer satisfy the gate — everyone re-reads and re-acknowledges.
 *  4. GRACEFUL PRE-MIGRATION: before migration 0136 exists, the store layer
 *     reports "table missing" and the gate stays OPEN (a missing table must
 *     never lock the whole staff out); the store surfaces a setup notice
 *     instead.
 */

export type HandbookGateResult = { ok: true } | { ok: false; reason: string };

/** True when this acknowledgment list satisfies the given handbook version. */
export function hasAcknowledgedVersion(ackedVersions: readonly string[], currentVersion: string): boolean {
  const want = currentVersion.trim();
  if (!want) return true; // no version configured = nothing to acknowledge
  return ackedVersions.some((v) => v.trim() === want);
}

/**
 * Back-office gate. `role` is the staff_profiles role; owners are exempt.
 * Everyone else needs an acknowledgment for the CURRENT version.
 */
export function backOfficeHandbookGate(input: {
  role: string | null | undefined;
  ackedVersions: readonly string[];
  currentVersion: string;
}): HandbookGateResult {
  if ((input.role ?? "") === "owner") return { ok: true };
  if (hasAcknowledgedVersion(input.ackedVersions, input.currentVersion)) return { ok: true };
  return {
    ok: false,
    reason:
      `Please read the employee handbook (version ${input.currentVersion}) and record your acknowledgment ` +
      "before using the back office.",
  };
}

/**
 * Register gate. Digital acknowledgment (linked staff account) OR the paper
 * acknowledgment marked SIGNED in the employee file satisfies it. A linked
 * OWNER account is exempt like in the back office.
 */
export function registerHandbookGate(input: {
  linkedStaffRole: string | null | undefined;
  ackedVersions: readonly string[];
  currentVersion: string;
  paperHandbookSigned: boolean;
}): HandbookGateResult {
  if ((input.linkedStaffRole ?? "") === "owner") return { ok: true };
  if (input.paperHandbookSigned) return { ok: true };
  if (hasAcknowledgedVersion(input.ackedVersions, input.currentVersion)) return { ok: true };
  return {
    ok: false,
    reason:
      "Handbook acknowledgment required before using the register. Read the employee handbook in the back " +
      "office and check the acknowledgment box (or have a manager mark your signed paper copy in your employee file).",
  };
}

/** Validate the typed confirmation name on the digital acknowledgment form. */
export function normalizeAcknowledgedName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    return { ok: false, reason: "Type your full name to confirm you read the handbook." };
  }
  if (name.length > 120) {
    return { ok: false, reason: "That name is too long — use your legal name as it appears on your badge." };
  }
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runHandbookAckTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // hasAcknowledgedVersion
  ok(hasAcknowledgedVersion(["2.0"], "2.0"), "exact version matches");
  ok(!hasAcknowledgedVersion(["1.0"], "2.0"), "old version does not satisfy a new handbook");
  ok(!hasAcknowledgedVersion([], "2.0"), "no acknowledgments = not acknowledged");
  ok(hasAcknowledgedVersion(["1.0", "2.0"], "2.0"), "any matching version in the list satisfies");
  ok(hasAcknowledgedVersion([" 2.0 "], "2.0"), "whitespace-tolerant version compare");
  ok(hasAcknowledgedVersion([], ""), "blank current version disables the gate");

  // backOfficeHandbookGate
  ok(backOfficeHandbookGate({ role: "owner", ackedVersions: [], currentVersion: "2.0" }).ok, "owner exempt in back office");
  ok(
    backOfficeHandbookGate({ role: "manager", ackedVersions: ["2.0"], currentVersion: "2.0" }).ok,
    "acknowledged manager passes",
  );
  {
    const r = backOfficeHandbookGate({ role: "manager", ackedVersions: ["1.0"], currentVersion: "2.0" });
    ok(!r.ok, "manager with only the OLD version is blocked after a version bump");
    ok(!r.ok && r.reason.includes("2.0"), "block reason names the current version");
  }
  ok(
    !backOfficeHandbookGate({ role: "readonly", ackedVersions: [], currentVersion: "2.0" }).ok,
    "unacknowledged non-owner is blocked",
  );
  ok(
    !backOfficeHandbookGate({ role: null, ackedVersions: [], currentVersion: "2.0" }).ok,
    "null role treated as non-owner (blocked)",
  );

  // registerHandbookGate
  ok(
    registerHandbookGate({ linkedStaffRole: "owner", ackedVersions: [], currentVersion: "2.0", paperHandbookSigned: false }).ok,
    "linked owner exempt at the register",
  );
  ok(
    registerHandbookGate({ linkedStaffRole: null, ackedVersions: [], currentVersion: "2.0", paperHandbookSigned: true }).ok,
    "paper-signed employee passes (PIN-only path)",
  );
  ok(
    registerHandbookGate({ linkedStaffRole: "pos", ackedVersions: ["2.0"], currentVersion: "2.0", paperHandbookSigned: false }).ok,
    "digital acknowledgment passes at the register",
  );
  {
    const r = registerHandbookGate({ linkedStaffRole: "pos", ackedVersions: [], currentVersion: "2.0", paperHandbookSigned: false });
    ok(!r.ok, "no acknowledgment at all blocks the register unlock");
    ok(!r.ok && r.reason.toLowerCase().includes("handbook"), "register block reason mentions the handbook");
  }
  ok(
    !registerHandbookGate({ linkedStaffRole: "pos", ackedVersions: ["1.0"], currentVersion: "2.0", paperHandbookSigned: false }).ok,
    "old digital acknowledgment does not satisfy a new version at the register",
  );

  // normalizeAcknowledgedName
  {
    const r = normalizeAcknowledgedName("  Jane   Q  Budtender  ");
    ok(r.ok && r.name === "Jane Q Budtender", "name normalized (trim + single spaces)");
  }
  ok(!normalizeAcknowledgedName(" ").ok, "blank name refused");
  ok(!normalizeAcknowledgedName("x".repeat(121)).ok, "over-long name refused");
  ok(normalizeAcknowledgedName("Al").ok, "two-character name accepted");

  if (fail > 0) throw new Error(`handbook-ack-core self-tests: ${fail} failure(s)`);
  console.log(`handbook-ack-core: ${pass} passed, ${fail} failed`);
}
