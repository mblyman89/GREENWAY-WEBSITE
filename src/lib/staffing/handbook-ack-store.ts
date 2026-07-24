/**
 * src/lib/staffing/handbook-ack-store.ts  (SLICE 36)
 *
 * Server store for employee-handbook acknowledgments (migration 0136,
 * `handbook_acknowledgments`). The GATE decisions themselves live in the pure
 * core (handbook-ack-core.ts); this file only fetches/records rows and
 * degrades gracefully:
 *
 *   - Before migration 0136 is applied (42P01), the gate stays OPEN — a
 *     missing table must never lock the whole staff out. `migrationApplied`
 *     tells callers so the UI can show a setup notice instead.
 *   - Recording an acknowledgment re-checks the box idempotently: the table
 *     has `unique (staff_id, version)`, so a duplicate insert (23505) is a
 *     success, not an error.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { HANDBOOK_VERSION } from "@/lib/staffing/handbook-content";
import {
  backOfficeHandbookGate,
  registerHandbookGate,
  type HandbookGateResult,
} from "@/lib/staffing/handbook-ack-core";

// ---------------------------------------------------------------------------
// Graceful degradation before migration 0136 is applied.
// ---------------------------------------------------------------------------

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist|Could not find the table/i.test(error.message ?? "");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type HandbookAckStatus = {
  /** false before migration 0136 — gate stays OPEN, UI shows a setup notice. */
  migrationApplied: boolean;
  /** Every version this staff user has acknowledged. */
  ackedVersions: string[];
  /** Convenience: does the list satisfy the CURRENT handbook version? */
  currentAcknowledged: boolean;
};

/** All handbook versions a staff user has acknowledged (empty pre-migration). */
export async function getHandbookAckStatus(staffId: string): Promise<HandbookAckStatus> {
  if (!isSupabaseServiceConfigured || !staffId) {
    return { migrationApplied: false, ackedVersions: [], currentAcknowledged: false };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("handbook_acknowledgments")
    .select("version")
    .eq("staff_id", staffId);
  if (error) {
    if (isMissingTableError(error)) {
      return { migrationApplied: false, ackedVersions: [], currentAcknowledged: false };
    }
    throw new Error(`handbook acknowledgments lookup failed: ${error.message}`);
  }
  const ackedVersions = (data ?? []).map((row) => String((row as { version: string }).version));
  return {
    migrationApplied: true,
    ackedVersions,
    currentAcknowledged: ackedVersions.some((v) => v.trim() === HANDBOOK_VERSION.trim()),
  };
}

/**
 * Back-office gate for the admin layout. OPEN pre-migration (never lock all
 * staff out over a missing table); owners are always exempt (core rule).
 */
export async function backOfficeGateForStaff(input: {
  staffId: string;
  role: string | null | undefined;
}): Promise<HandbookGateResult & { migrationApplied: boolean }> {
  if ((input.role ?? "") === "owner") return { ok: true, migrationApplied: true };
  const status = await getHandbookAckStatus(input.staffId);
  if (!status.migrationApplied) return { ok: true, migrationApplied: false };
  const gate = backOfficeHandbookGate({
    role: input.role,
    ackedVersions: status.ackedVersions,
    currentVersion: HANDBOOK_VERSION,
  });
  return { ...gate, migrationApplied: true };
}

/**
 * Register gate for /api/pos/unlock. Inputs: the employee's optional linked
 * staff account (employees.staff_id) and whether their PAPER handbook
 * acknowledgment is marked signed in the employee file (employee_documents
 * doc_key='handbook' status='signed') — the paper path covers PIN-only
 * employees with no staff login. OPEN pre-migration.
 */
export async function registerGateForEmployee(input: {
  employeeId: string;
  staffId: string | null;
}): Promise<HandbookGateResult> {
  if (!isSupabaseServiceConfigured) return { ok: true };
  const admin = createSupabaseAdminClient();

  // Paper path: signed handbook row in the employee file (migration 0117).
  let paperHandbookSigned = false;
  {
    const { data, error } = await admin
      .from("employee_documents")
      .select("status")
      .eq("employee_id", input.employeeId)
      .eq("doc_key", "handbook")
      .maybeSingle();
    if (error && !isMissingTableError(error)) {
      throw new Error(`handbook document lookup failed: ${error.message}`);
    }
    paperHandbookSigned = (data as { status?: string } | null)?.status === "signed";
  }

  // Digital path: acknowledgments + role of the linked staff account.
  let ackedVersions: string[] = [];
  let linkedStaffRole: string | null = null;
  if (input.staffId) {
    const status = await getHandbookAckStatus(input.staffId);
    if (!status.migrationApplied) return { ok: true }; // pre-migration = OPEN
    ackedVersions = status.ackedVersions;
    const { data, error } = await admin
      .from("staff_profiles")
      .select("role")
      .eq("id", input.staffId)
      .maybeSingle();
    if (error && !isMissingTableError(error)) {
      throw new Error(`staff profile lookup failed: ${error.message}`);
    }
    linkedStaffRole = (data as { role?: string } | null)?.role ?? null;
  } else {
    // No staff login at all: the paper path is the only route, but the gate
    // must still stay OPEN before migration 0136 exists (consistent behavior).
    const probe = await admin.from("handbook_acknowledgments").select("id").limit(1);
    if (probe.error && isMissingTableError(probe.error)) return { ok: true };
    if (probe.error) throw new Error(`handbook acknowledgments probe failed: ${probe.error.message}`);
  }

  return registerHandbookGate({
    linkedStaffRole,
    ackedVersions,
    currentVersion: HANDBOOK_VERSION,
    paperHandbookSigned,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a staff user's acknowledgment of the CURRENT handbook version.
 * Idempotent: re-checking the box for a version already acknowledged is a
 * success (unique (staff_id, version) → 23505 swallowed).
 */
export async function recordHandbookAcknowledgment(input: {
  staffId: string;
  acknowledgedName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase is not configured on the server." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("handbook_acknowledgments").insert({
    staff_id: input.staffId,
    version: HANDBOOK_VERSION,
    acknowledged_name: input.acknowledgedName,
  });
  if (error) {
    if (error.code === "23505") return { ok: true }; // already acknowledged this version
    if (isMissingTableError(error)) {
      return {
        ok: false,
        error: "The acknowledgment table is missing — apply migration 0136 in the Supabase SQL editor first.",
      };
    }
    return { ok: false, error: `Could not record the acknowledgment: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Roster visibility: which staff users have acknowledged the CURRENT version
 * (staff_id → acknowledged_at). Empty map pre-migration.
 */
export async function currentVersionAckMap(): Promise<{
  migrationApplied: boolean;
  ackedAtByStaffId: Map<string, string>;
}> {
  if (!isSupabaseServiceConfigured) {
    return { migrationApplied: false, ackedAtByStaffId: new Map() };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("handbook_acknowledgments")
    .select("staff_id, acknowledged_at")
    .eq("version", HANDBOOK_VERSION);
  if (error) {
    if (isMissingTableError(error)) return { migrationApplied: false, ackedAtByStaffId: new Map() };
    throw new Error(`handbook acknowledgment roster lookup failed: ${error.message}`);
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const r = row as { staff_id: string; acknowledged_at: string };
    map.set(r.staff_id, r.acknowledged_at);
  }
  return { migrationApplied: true, ackedAtByStaffId: map };
}
