/**
 * POST /api/pos/till  (POS Slice B21)
 *
 * Register-side till lifecycle — the cashier's hands-on drawer work, done AT
 * the register on the iPad (owner's direction, recorded in
 * src/lib/registers/oversight.ts; the back office keeps manager oversight,
 * reconcile, and verify).
 *
 * Three actions, all PIN-attributed to a human and device-authenticated
 * (same two-factor discipline as /api/pos/unlock — a stolen PIN is useless
 * without a provisioned device, and vice versa):
 *
 *   open  — count-in with a full denomination breakdown; the counted total
 *           IS the opening float. One open session per register (enforced by
 *           openDrawer). Stamps drawer_sessions.device_id (migration 0120)
 *           best-effort so oversight can see which iPad served the session.
 *   drop  — mid-shift safe drop (amount in MINOR units + window), optionally
 *           witnessed by a SECOND person's PIN verified right here — a name
 *           typed into a box proves nothing; a PIN proves presence.
 *   close — count-out, recorded BLIND. This endpoint NEVER returns expected
 *           cash or variance — the manager reveals over/short at reconcile
 *           in the back office. That is the whole point of a blind count.
 *   swap  — value-neutral change trade with the safe (big bills in, equal
 *           change out; zero net movement on both sides). Requires a
 *           manager/lead approval PIN verified here (same role gate as
 *           /api/pos/approve) and refuses to be best-effort — an untracked
 *           trip into the safe is what this record exists to prevent.
 *
 * ONLINE-ONLY by nature: PINs cannot be verified offline, and cash custody
 * events must land server-side the moment the cash moves.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { validateTillRequest } from "@/lib/pos/till-core";
import { openDrawer, recordDrop, closeDrawerBlind, openSessionForRegister, getSession } from "@/lib/registers/store";
import { recordSwap } from "@/lib/registers/safe-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roles allowed to approve a safe swap (mirrors /api/pos/approve). */
const SWAP_APPROVER_ROLES = new Set(["manager", "lead"]);

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const registerId = auth.device.register_id;
  if (!registerId) {
    return NextResponse.json(
      { error: "This device is not bound to a register — a manager must assign one in the back office." },
      { status: 409 },
    );
  }

  const throttleScope = deviceThrottleScope(auth.device.id);
  const locked = await pinPadBlocked(throttleScope);
  if (locked) return NextResponse.json({ error: locked }, { status: 429 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const validated = validateTillRequest(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const till = validated.req;

  if (!isValidPin(till.pin)) {
    return NextResponse.json({ error: "Enter a valid 4–6 digit PIN." }, { status: 400 });
  }
  const employee = await getEmployeeByPin(till.pin);
  if (!employee) {
    await notePinFailure(throttleScope);
    return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
  }
  await notePinSuccess(throttleScope);

  // ── open: count-in ──
  if (till.action === "open") {
    const result = await openDrawer({
      registerId,
      employeeId: employee.id,
      shiftId: null,
      denoms: till.denoms,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

    // Best-effort device stamp (drawer_sessions.device_id, migration 0120).
    // Never blocks the open — the count itself is already durable.
    try {
      const admin = createSupabaseAdminClient();
      await admin.from("drawer_sessions").update({ device_id: auth.device.id }).eq("id", result.sessionId);
    } catch {
      // Column may not exist yet if 0120 is unapplied — oversight loses the
      // device link, nothing else.
    }

    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: "drawer.opened",
      entityType: "drawer_session",
      entityId: result.sessionId,
      after: { via: "register", deviceId: auth.device.id, employeeId: employee.id },
    });

    const session = await getSession(result.sessionId);
    return NextResponse.json({
      ok: true,
      drawer: {
        sessionId: result.sessionId,
        openedAt: session?.opened_at ?? new Date().toISOString(),
        businessDay: session?.business_day ?? "",
      },
    });
  }

  // drop and close both require this register's open session.
  const session = await openSessionForRegister(registerId);
  if (!session) {
    return NextResponse.json({ error: "No open drawer on this register." }, { status: 409 });
  }

  // ── drop: mid-shift safe drop ──
  if (till.action === "drop") {
    let witnessedBy: string | null = null;
    if (till.witnessPin) {
      if (!isValidPin(till.witnessPin)) {
        return NextResponse.json({ error: "Witness PIN must be 4–6 digits." }, { status: 400 });
      }
      const witness = await getEmployeeByPin(till.witnessPin);
      if (!witness) {
        await notePinFailure(throttleScope);
        return NextResponse.json({ error: "No active employee for the witness PIN." }, { status: 401 });
      }
      await notePinSuccess(throttleScope);
      if (witness.id === employee.id) {
        return NextResponse.json({ error: "A drop cannot witness itself — a second person must enter their PIN." }, { status: 400 });
      }
      witnessedBy = witness.id;
    }

    const result = await recordDrop({
      sessionId: session.id,
      amountMinor: till.amountMinor,
      window: till.window,
      droppedBy: employee.id,
      witnessedBy,
      notes: till.notes ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Drop failed." }, { status: 409 });

    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: "drawer.drop",
      entityType: "drawer_session",
      entityId: session.id,
      after: {
        via: "register",
        deviceId: auth.device.id,
        amountMinor: till.amountMinor,
        window: till.window,
        witnessed: !!witnessedBy,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── swap: value-neutral change trade with the safe ──
  if (till.action === "swap") {
    // A swap moves ZERO net cash (big bills in, equal change out) but every
    // trip into the safe needs a manager/lead approval PIN — same role gate
    // as /api/pos/approve, verified right here.
    if (!isValidPin(till.approverPin)) {
      return NextResponse.json({ error: "Approver PIN must be 4–6 digits." }, { status: 400 });
    }
    const approver = await getEmployeeByPin(till.approverPin);
    if (!approver) {
      await notePinFailure(throttleScope);
      return NextResponse.json({ error: "No active employee for the approver PIN." }, { status: 401 });
    }
    await notePinSuccess(throttleScope);
    if (!SWAP_APPROVER_ROLES.has(approver.job_role)) {
      return NextResponse.json(
        { error: `${approver.full_name} is not a manager or lead — safe swaps need a manager PIN.` },
        { status: 403 },
      );
    }
    if (approver.id === employee.id) {
      return NextResponse.json(
        { error: "A swap cannot approve itself — a manager or lead must enter their PIN." },
        { status: 400 },
      );
    }

    const result = await recordSwap({
      sessionId: session.id,
      deviceId: auth.device.id,
      amountMinor: till.amountMinor,
      performedBy: employee.id,
      approvedBy: approver.id,
      notes: till.notes ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Swap failed." }, { status: 409 });

    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: "safe.swap",
      entityType: "drawer_session",
      entityId: session.id,
      after: {
        via: "register",
        deviceId: auth.device.id,
        amountMinor: till.amountMinor,
        approvedBy: approver.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── close: BLIND count-out ──
  const result = await closeDrawerBlind({
    sessionId: session.id,
    employeeId: employee.id,
    denoms: till.denoms,
    // Tips are the employee's money — recorded alongside the close but kept
    // OUT of the drawer math (migration 0134; best-effort if unapplied).
    ...(till.tipsMinor !== undefined ? { tipsMinor: till.tipsMinor } : {}),
  });
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Close failed." }, { status: 409 });

  await recordAudit({
    actorId: employee.staff_id,
    actorEmail: employee.full_name,
    action: "drawer.closed_blind",
    entityType: "drawer_session",
    entityId: session.id,
    after: {
      via: "register",
      deviceId: auth.device.id,
      employeeId: employee.id,
      // Tips are NOT blind (they're the cashier's own money) — auditable here.
      ...(till.tipsMinor !== undefined ? { tipsMinor: till.tipsMinor } : {}),
    },
  });

  // BLIND: no expected, no variance, no counted total echoed back beyond ok.
  return NextResponse.json({ ok: true });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
