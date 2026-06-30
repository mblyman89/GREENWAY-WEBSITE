/**
 * src/lib/registers/store.ts
 *
 * Server-side cash-drawer lifecycle (Slice 26). Blind counts: the closing
 * employee records a count WITHOUT seeing expected; the manager reveals the
 * variance at reconcile. The manager till adds a next-morning verify step.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { businessDayFor } from "@/lib/staffing/time";
import { type DenomCounts, denomTotalMinor, expectedClose, overShort } from "@/lib/registers/cash";

export type Register = {
  id: string;
  name: string;
  kind: "sales" | "manager_till";
  default_float_minor: number;
  active: boolean;
  sort_order: number;
  notes: string | null;
};

export type DrawerSession = {
  id: string;
  register_id: string;
  opened_by: string | null;
  closed_by: string | null;
  shift_id: string | null;
  business_day: string;
  status: "open" | "closed" | "reconciled" | "verified";
  opening_count_minor: number | null;
  closing_count_minor: number | null;
  expected_close_minor: number | null;
  over_short_minor: number | null;
  opened_at: string | null;
  closed_at: string | null;
  reconciled_at: string | null;
  notes: string | null;
};

export type DrawerDrop = {
  id: string;
  session_id: string;
  amount_minor: number;
  drop_window: "afternoon" | "night" | "other";
  dropped_by: string | null;
  witnessed_by: string | null;
  notes: string | null;
  dropped_at: string;
};

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

export async function listRegisters(opts?: { includeInactive?: boolean }): Promise<Register[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("registers").select("*").order("sort_order", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return (data as Register[] | null) ?? [];
}

export async function getRegister(id: string): Promise<Register | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("registers").select("*").eq("id", id).maybeSingle();
  return (data as Register | null) ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function openSessionForRegister(registerId: string): Promise<DrawerSession | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_sessions")
    .select("*")
    .eq("register_id", registerId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DrawerSession | null) ?? null;
}

export async function getSession(id: string): Promise<DrawerSession | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("drawer_sessions").select("*").eq("id", id).maybeSingle();
  return (data as DrawerSession | null) ?? null;
}

export async function dropsForSession(sessionId: string): Promise<DrawerDrop[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_drops")
    .select("*")
    .eq("session_id", sessionId)
    .order("dropped_at", { ascending: true });
  return (data as DrawerDrop[] | null) ?? [];
}

export async function totalDropsMinor(sessionId: string): Promise<number> {
  const drops = await dropsForSession(sessionId);
  return drops.reduce((sum, d) => sum + d.amount_minor, 0);
}

export type OpenResult = { ok: true; sessionId: string } | { ok: false; error: string };

/**
 * Open (count-in) a register. The opening count IS the starting float counted by
 * the employee. A register may have only one open session at a time.
 */
export async function openDrawer(opts: {
  registerId: string;
  employeeId: string | null;
  shiftId: string | null;
  denoms: DenomCounts;
}): Promise<OpenResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  const existing = await openSessionForRegister(opts.registerId);
  if (existing) return { ok: false, error: "This register already has an open drawer. Close it first." };

  const nowISO = new Date().toISOString();
  const openingMinor = denomTotalMinor(opts.denoms);

  const { data: session, error } = await admin
    .from("drawer_sessions")
    .insert({
      register_id: opts.registerId,
      opened_by: opts.employeeId,
      shift_id: opts.shiftId,
      business_day: businessDayFor(nowISO),
      status: "open",
      opening_count_minor: openingMinor,
      opened_at: nowISO,
    })
    .select("id")
    .single();
  if (error || !session) return { ok: false, error: error?.message ?? "Failed to open drawer." };

  const sessionId = (session as { id: string }).id;
  await admin.from("drawer_counts").insert({
    session_id: sessionId,
    count_type: "open",
    counted_by: opts.employeeId,
    ...opts.denoms,
    total_minor: openingMinor,
  });

  return { ok: true, sessionId };
}

/**
 * Record a mid-shift cash drop to the safe (one of the 4 daily drops).
 */
export async function recordDrop(opts: {
  sessionId: string;
  amountMinor: number;
  window: "afternoon" | "night" | "other";
  droppedBy: string | null;
  witnessedBy: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (opts.amountMinor <= 0) return { ok: false, error: "Drop amount must be greater than zero." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("drawer_drops").insert({
    session_id: opts.sessionId,
    amount_minor: opts.amountMinor,
    drop_window: opts.window,
    dropped_by: opts.droppedBy,
    witnessed_by: opts.witnessedBy,
    notes: opts.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Close (count-out) a register — BLIND. The employee records their count; we
 * store it but DO NOT reveal expected/variance here. Reconcile does that.
 */
export async function closeDrawerBlind(opts: {
  sessionId: string;
  employeeId: string | null;
  denoms: DenomCounts;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "open") return { ok: false, error: "Drawer is not open." };

  const nowISO = new Date().toISOString();
  const closingMinor = denomTotalMinor(opts.denoms);

  const { error } = await admin
    .from("drawer_sessions")
    .update({
      status: "closed",
      closed_by: opts.employeeId,
      closing_count_minor: closingMinor,
      closed_at: nowISO,
    })
    .eq("id", opts.sessionId);
  if (error) return { ok: false, error: error.message };

  await admin.from("drawer_counts").insert({
    session_id: opts.sessionId,
    count_type: "close",
    counted_by: opts.employeeId,
    ...opts.denoms,
    total_minor: closingMinor,
  });
  return { ok: true };
}

/**
 * Reconcile a closed drawer (manager): enter the cash sales the register took,
 * which (with opening float + drops) yields expected; reveal over/short.
 */
export async function reconcileDrawer(opts: {
  sessionId: string;
  cashSalesMinor: number;
  reconciledBy: string | null;
}): Promise<{ ok: boolean; error?: string; overShortMinor?: number }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "closed") return { ok: false, error: "Drawer must be closed before reconciling." };

  const dropsMinor = await totalDropsMinor(opts.sessionId);
  const expected = expectedClose({
    openingMinor: session.opening_count_minor ?? 0,
    cashSalesMinor: opts.cashSalesMinor,
    dropsMinor,
  });
  const os = overShort(session.closing_count_minor ?? 0, expected);

  const { error } = await admin
    .from("drawer_sessions")
    .update({
      status: "reconciled",
      expected_close_minor: expected,
      over_short_minor: os,
      reconciled_at: new Date().toISOString(),
      reconciled_by: opts.reconciledBy,
    })
    .eq("id", opts.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, overShortMinor: os };
}

/**
 * Manager-till next-morning verify/validate: the morning manager independently
 * recounts and confirms (or flags) the prior night's close.
 */
export async function verifyTill(opts: {
  sessionId: string;
  verifiedBy: string | null;
  denoms: DenomCounts;
  agrees: boolean;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string; varianceMinor?: number }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "closed" && session.status !== "reconciled") {
    return { ok: false, error: "Till must be closed before it can be verified." };
  }

  const verifiedMinor = denomTotalMinor(opts.denoms);
  const variance = verifiedMinor - (session.closing_count_minor ?? 0);

  const { error: vErr } = await admin.from("till_verifications").insert({
    session_id: opts.sessionId,
    verified_by: opts.verifiedBy,
    verified_count_minor: verifiedMinor,
    agrees: opts.agrees,
    variance_minor: variance,
    notes: opts.notes ?? null,
  });
  if (vErr) return { ok: false, error: vErr.message };

  await admin.from("drawer_counts").insert({
    session_id: opts.sessionId,
    count_type: "verify",
    counted_by: opts.verifiedBy,
    ...opts.denoms,
    total_minor: verifiedMinor,
  });

  await admin.from("drawer_sessions").update({ status: "verified" }).eq("id", opts.sessionId);
  return { ok: true, varianceMinor: variance };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type RegisterLive = {
  register: Register;
  openSession: DrawerSession | null;
  dropsMinor: number;
};

/** Live view: every register with its current open session + drops total. */
export async function liveRegisters(): Promise<RegisterLive[]> {
  const registers = await listRegisters();
  const out: RegisterLive[] = [];
  for (const register of registers) {
    const openSession = await openSessionForRegister(register.id);
    const dropsMinor = openSession ? await totalDropsMinor(openSession.id) : 0;
    out.push({ register, openSession, dropsMinor });
  }
  return out;
}

export async function recentSessions(limit = 40): Promise<(DrawerSession & { register_name: string })[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_sessions")
    .select("*")
    .order("business_day", { ascending: false })
    .order("opened_at", { ascending: false })
    .limit(limit);
  const sessions = (data as DrawerSession[] | null) ?? [];
  if (sessions.length === 0) return [];
  const ids = [...new Set(sessions.map((s) => s.register_id))];
  const { data: regs } = await admin.from("registers").select("id, name").in("id", ids);
  const byId = new Map(((regs as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  return sessions.map((s) => ({ ...s, register_name: byId.get(s.register_id) ?? "—" }));
}
