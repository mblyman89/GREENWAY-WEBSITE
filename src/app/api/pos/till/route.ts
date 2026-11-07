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
 *           Owner D121 (supersedes D2/D86/D90 at the till): ONE person
 *           closes: bills, tips, their own PIN, done. No second PIN here.
 *           The second count is done in the back office (owner D122).
 *   pop   — owner D130/D131 (2026-11-02): open the drawer for the blind
 *           count. Only the cashier working this drawer (D129, the one
 *           ringing its sales) may, by their own PIN. The audit row
 *           (drawer.popped_for_count) is written BEFORE the iPad kicks the
 *           drawer: the iPad only kicks on this endpoint's ok. The first open per drawer is
 *           free; any further open needs a reason and is an owner warning.
 *           Never returns an expected figure.
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
import { getEmployeeByPin, getEmployee } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { validateTillRequest } from "@/lib/pos/till-core";
import { denomTotalMinor } from "@/lib/registers/cash";
import { openDrawer, recordDrop, closeDrawerBlind, openSessionForRegister, getSession, getRegister } from "@/lib/registers/store";
import { loadDrawerFigure } from "@/lib/registers/drawer-figure-store";
import { closeShortCheck } from "@/lib/registers/close-count-check-core";
import { floatCheck, splitTipPool, tipPoolSentence } from "@/lib/registers/shift-end-core";
import { recordSwap } from "@/lib/registers/safe-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { compactDenoms, denomWords } from "@/lib/registers/little-safe-core";
import { checkPop } from "@/lib/registers/drawer-pop-core";
import { atmDropSuccessMessage, atmWitnessCheck } from "@/lib/registers/atm-drop-core";
import { getAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";
import { drawerCustodian, popsForSession, POP_AUDIT_ACTION } from "@/lib/registers/drawer-pop-store";

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

    // Fix Phase 6 (G-62, owner D85 "Warn please"): a count-in that is not the
    // standard float is saved anyway and flagged in the audit for a manager.
    const reg = await getRegister(registerId);
    const fc = floatCheck(denomTotalMinor(till.denoms), reg?.default_float_minor ?? null);

    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: "drawer.opened",
      entityType: "drawer_session",
      entityId: result.sessionId,
      after: {
        via: "register",
        deviceId: auth.device.id,
        employeeId: employee.id,
        openingMinor: denomTotalMinor(till.denoms),
        standardFloatMinor: reg?.default_float_minor ?? null,
        floatCheck: fc.state,
        floatDiffMinor: fc.diffMinor,
      },
    });
    if (fc.state === "over" || fc.state === "short") {
      await recordAudit({
        actorId: employee.staff_id,
        actorEmail: employee.full_name,
        action: "drawer.float_warning",
        entityType: "drawer_session",
        entityId: result.sessionId,
        after: { via: "register", employeeId: employee.id, standardFloatMinor: reg?.default_float_minor ?? null, diffMinor: fc.diffMinor },
      });
    }

    const session = await getSession(result.sessionId);
    return NextResponse.json({
      ok: true,
      // Fix Phase 6 (G-61): who counted in, so the register keeps the clock-out guard current.
      employeeId: employee.id,
      floatWarning: fc.sentence || null,
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

  // ── pop: open the drawer for the blind count (owner D130/D131) ──
  if (till.action === "pop") {
    const custodianId = await drawerCustodian(session);
    const custodian = custodianId && custodianId !== employee.id ? await getEmployee(custodianId) : null;
    const prior = await popsForSession(session.id);
    if (prior === null) {
      // Never hand out a free open on a failed read.
      return NextResponse.json({ error: "Could not check this drawer's history. Try again in a moment." }, { status: 503 });
    }
    const check = checkPop({
      employeeId: employee.id,
      custodianId,
      custodianName: custodianId === employee.id ? employee.full_name : (custodian?.full_name ?? null),
      priorPops: prior,
      reason: till.reason,
    });
    if (!check.ok) {
      if (check.code === "not_assigned" || check.code === "no_cashier") {
        await recordAudit({
          actorId: employee.staff_id,
          actorEmail: employee.full_name,
          action: "drawer.pop_refused",
          entityType: "drawer_session",
          entityId: session.id,
          after: { via: "register", deviceId: auth.device.id, employeeId: employee.id, custodianId, code: check.code },
        });
      }
      const status = check.code === "not_assigned" || check.code === "no_cashier" ? 403 : 400;
      return NextResponse.json({ error: check.error, code: check.code }, { status });
    }
    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: POP_AUDIT_ACTION,
      entityType: "drawer_session",
      entityId: session.id,
      after: {
        via: "register",
        deviceId: auth.device.id,
        employeeId: employee.id,
        popNumber: check.popNumber,
        repeat: check.repeat,
        ...(check.reason ? { reason: check.reason } : {}),
      },
    });
    if (check.repeat) {
      await recordAudit({
        actorId: employee.staff_id,
        actorEmail: employee.full_name,
        action: "drawer.pop_repeat_warning",
        entityType: "drawer_session",
        entityId: session.id,
        after: { via: "register", deviceId: auth.device.id, employeeId: employee.id, popNumber: check.popNumber, reason: check.reason },
      });
    }
    // BLIND: no expected, no variance. The iPad kicks the drawer on ok.
    return NextResponse.json({ ok: true, popNumber: check.popNumber, repeat: check.repeat, employeeName: employee.full_name });
  }

  // ── drop: mid-shift safe drop, or (D198) an ATM drop counted in $20 bills ──
  if (till.action === "drop") {
    const isAtm = till.destination === "atm";
    const atmSettings = isAtm ? await getAtmDropSettings() : null;
    if (isAtm && atmSettings) {
      if (!atmSettings.enabled) {
        return NextResponse.json({ error: "ATM drops are turned off in the back office (Lyman > ATM drops > Settings)." }, { status: 403 });
      }
      if ((till.twentiesCount ?? 0) > atmSettings.maxTwentiesPerDrop) {
        return NextResponse.json(
          { error: `That is more than ${atmSettings.maxTwentiesPerDrop} x $20 in one ATM drop. Check the count, or ask the owner.` },
          { status: 400 },
        );
      }
      const w = atmWitnessCheck(atmSettings.witness, !!till.witnessPin);
      if (!w.allowed) return NextResponse.json({ error: w.message ?? "A witness PIN is required." }, { status: 400 });
    }
    let witnessedBy: string | null = null;
    let witnessName: string | null = null;
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
      witnessName = witness.full_name;
    }

    const result = await recordDrop({
      sessionId: session.id,
      amountMinor: till.amountMinor,
      window: till.window,
      droppedBy: employee.id,
      witnessedBy,
      notes: till.notes ?? null,
      destination: isAtm ? "atm" : "safe",
      twentiesCount: isAtm ? (till.twentiesCount ?? null) : null,
      atmTerminalId: isAtm ? (atmSettings?.terminalId ?? null) : null,
      deviceId: auth.device.id,
      recordedVia: "register",
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
        destination: isAtm ? "atm" : "safe",
        dropId: result.id ?? null,
      },
    });
    if (isAtm && atmSettings) {
      // D198: a dedicated, detailed custody row for every ATM drop - the owner's ATM match page and
      // any auditor can follow the cash: who, which till, which iPad, how many $20s, which ATM, witness.
      const w = atmWitnessCheck(atmSettings.witness, !!witnessedBy);
      await recordAudit({
        actorId: employee.staff_id,
        actorEmail: employee.full_name,
        action: "drawer.atm_drop",
        entityType: "drawer_drop",
        entityId: result.id ?? session.id,
        after: {
          via: "register",
          sessionId: session.id,
          registerId,
          deviceId: auth.device.id,
          employeeId: employee.id,
          employeeName: employee.full_name,
          twentiesCount: till.twentiesCount ?? null,
          amountMinor: till.amountMinor,
          atmTerminalId: atmSettings.terminalId,
          window: till.window,
          witnessedBy,
          witnessName,
          witnessPolicy: atmSettings.witness,
          flaggedNoWitness: w.flag,
          storedAs: result.storedAs ?? null,
        },
      });
    }
    return NextResponse.json({
      ok: true,
      destination: isAtm ? "atm" : "safe",
      ...(isAtm
        ? {
            twentiesCount: till.twentiesCount ?? null,
            atmTerminalId: atmSettings?.terminalId ?? null,
            message: atmDropSuccessMessage(till.twentiesCount ?? 0, atmSettings?.terminalId ?? null),
            ...(atmSettings && atmWitnessCheck(atmSettings.witness, !!witnessedBy).flag
              ? { warning: "No witness: this ATM drop is flagged for the owner." }
              : {}),
          }
        : {}),
    });
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
      // Fix Phase 2.7b (F-01-8): the bills both ways, checked equal to the
      // amount by validateTillRequest (little-safe-core#checkSwapDenoms).
      inDenoms: till.inDenoms ? compactDenoms(till.inDenoms) : null,
      outDenoms: till.outDenoms ? compactDenoms(till.outDenoms) : null,
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
        // Fix Phase 2.7b (F-01-8): kept here too, so the bills survive even
        // before migration 0317 adds the columns (billsSaved false).
        bills_in: till.inDenoms ? denomWords(till.inDenoms) : null,
        bills_out: till.outDenoms ? denomWords(till.outDenoms) : null,
        bills_saved: result.billsSaved ?? false,
      },
    });
    return NextResponse.json({ ok: true, billsSaved: result.billsSaved ?? false });
  }

  // ── close: BLIND count-out, ONE person (owner D121) ──
  // The cashier counts the bills, enters tips, and their own PIN; that is
  // the whole close. The register is free for the next cashier at once. The
  // second count happens later in the back office on the office computer
  // (owner D122, admin/registers secondCountAction). An old register build
  // that still sends a second PIN and second counts is accepted; the extra fields
  // are ignored (validateTillRequest drops them).
  // D204a: a count far BELOW what the register expects asks the closer to
  // count again before it is saved. BLIND: the reply never carries the
  // expected figure or the gap. A failed figure read never blocks a close.
  let recheckFlagged = false;
  {
    let expectedMinor: number | null = null;
    try {
      const loaded = await loadDrawerFigure(session.id, session);
      expectedMinor = loaded?.figure.expectedMinor ?? null;
    } catch (e) {
      console.error("[pos/till] expected figure read failed; close not checked", e);
      expectedMinor = null;
    }
    const check = closeShortCheck({
      countedMinor: denomTotalMinor(till.denoms),
      expectedMinor,
      recountConfirmed: till.recountConfirmed === true,
    });
    if (!check.ok) {
      await recordAudit({
        actorId: employee.staff_id,
        actorEmail: employee.full_name,
        action: "drawer.close_recheck_asked",
        entityType: "drawer_session",
        entityId: session.id,
        after: { via: "register", deviceId: auth.device.id, employeeId: employee.id },
      });
      return NextResponse.json({ error: check.error, code: check.code }, { status: 409 });
    }
    recheckFlagged = check.flagged;
  }

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
      // Fix Phase 6 (G-64, owner D89): the crew pool this share came from.
      ...(till.tipPool ? { tipPool: till.tipPool } : {}),
      // Owner D122: the second count is done in the back office.
      secondCount: "back_office",
      // Owner D125: a $0.00 close the closer confirmed as really empty.
      ...(till.confirmedEmpty ? { confirmedEmpty: true } : {}),
      // D204a: saved after the closer was asked to count again.
      ...(recheckFlagged ? { recountAfterLowCount: true } : {}),
      ...(till.recountConfirmed ? { recountConfirmed: true } : {}),
      ...(result.countRowWarnings ? { countRowWarnings: result.countRowWarnings } : {}),
    },
  });

  // BLIND: no expected, no variance.
  // Fix Phase 6 (G-61, owner D84): closing does NOT clock anyone out.
  const pooled = till.tipPool ? splitTipPool(till.tipPool.poolMinor, till.tipPool.people) : null;

  // Owner D151–D153 (2026-11-03): the details for the DRAWER CLOSED slip the
  // iPad prints to leave with the till. WHO, WHICH register, WHEN, and a short
  // drawer ref. Deliberately NO money: no counted total, no expected, no tips,
  // so the slip cannot break the blind second count. Best-effort: a failed
  // lookup never fails a close that already saved (the iPad falls back to
  // what it knows).
  let closeSlip: Record<string, string | null> | null = null;
  try {
    const [reg, opener] = await Promise.all([
      getRegister(registerId),
      session.opened_by && session.opened_by !== employee.id ? getEmployee(session.opened_by) : Promise.resolve(null),
    ]);
    closeSlip = {
      sessionId: session.id,
      registerName: reg?.name ?? auth.device.name ?? "Register",
      closedByName: employee.full_name,
      openedByName: session.opened_by === employee.id ? employee.full_name : (opener?.full_name ?? null),
      businessDay: session.business_day ?? null,
      openedAt: session.opened_at ?? null,
      closedAt: new Date().toISOString(),
      deviceName: auth.device.name ?? null,
    };
  } catch {
    closeSlip = null;
  }

  return NextResponse.json({
    ok: true,
    ...(pooled && pooled.ok ? { tipPool: { ...till.tipPool, sentence: tipPoolSentence(pooled) } } : {}),
    ...(closeSlip ? { closeSlip } : {}),
  });
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
