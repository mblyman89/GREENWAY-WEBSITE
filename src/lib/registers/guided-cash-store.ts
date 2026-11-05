/**
 * src/lib/registers/guided-cash-store.ts   (D181, round slice S4)
 *
 * SERVER-ONLY. Reads the database and feeds guided-cash-core.ts: which open
 * drawer owes the safe a drop, the morning crew's checklist, the days with no
 * deposit bag, and registers whose float drifted from the owner's rule.
 *
 * Every read returns its error instead of an all-clear (rule 135): a screen
 * that cannot read the drawers says so, it never says "nothing to do".
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { addPacificDays, pacificToday } from "@/lib/reports/timezone";
import { listRegisters, openSessionForRegister, type DrawerSession } from "@/lib/registers/store";
import { loadDrawerFigure } from "@/lib/registers/drawer-figure-store";
import { listBagsInRange } from "@/lib/registers/deposit-bag-store";
import { bagStage } from "@/lib/registers/deposit-bag-flow-core";
import {
  dropStatus,
  missingBagDays,
  morningDuties,
  standardFloatNotice,
  type DropStatus,
  type DutyBagStage,
  type MorningDuties,
} from "@/lib/registers/guided-cash-core";

export type LiveDrop = { registerId: string; registerName: string; sessionId: string; status: DropStatus };

/** The drop status of one open drawer (the figure the reconcile uses). */
export async function dropStatusForSession(session: DrawerSession, registerName: string): Promise<DropStatus> {
  const loaded = await loadDrawerFigure(session.id, session);
  if (!loaded) {
    return dropStatus({ registerName, cashSalesMinor: 0, refundsPaidMinor: 0, dropsMinor: 0, readsComplete: false });
  }
  const f = loaded.figure;
  return dropStatus({
    registerName,
    cashSalesMinor: f.cashSalesMinor,
    refundsPaidMinor: f.refundsPaidMinor,
    dropsMinor: f.dropsMinor,
    // The figure's only partial-read blocker (drawer-figure-core): pending
    // sales and untied refunds do not hide cash already in the drawer.
    readsComplete: !f.blockers.some((b) => b.includes("could not all be read")),
  });
}

/** Every open drawer's drop status, in register order. */
export async function liveDropStatuses(): Promise<{ ok: true; drops: LiveDrop[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const regs = await listRegisters();
    const rows = await Promise.all(
      regs.map(async (r) => {
        const s = await openSessionForRegister(r.id);
        if (!s) return null;
        return { registerId: r.id, registerName: r.name, sessionId: s.id, status: await dropStatusForSession(s, r.name) };
      }),
    );
    return { ok: true, drops: rows.filter((x): x is LiveDrop => x !== null) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The drop status of a register's open drawer (the iPad asks for its own). Null = no open drawer. */
export async function dropStatusForRegister(registerId: string, registerName: string): Promise<DropStatus | null> {
  const s = await openSessionForRegister(registerId);
  if (!s) return null;
  return dropStatusForSession(s, registerName);
}

/** The morning checklist for one business day. */
export async function morningDutiesFor(day: string): Promise<{ ok: true; duties: MorningDuties } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const [regs, sess, bags] = await Promise.all([
    admin.from("registers").select("id, name"),
    admin.from("drawer_sessions").select("*").eq("business_day", day).order("opened_at", { ascending: true }),
    listBagsInRange(day, day),
  ]);
  if (regs.error) return { ok: false, error: `Registers could not be read: ${regs.error.message}` };
  if (sess.error) return { ok: false, error: `Drawers could not be read: ${sess.error.message}` };
  if (!bags.ok) return { ok: false, error: `Deposit bags could not be read: ${bags.error}` };
  const names = new Map(((regs.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  const drawers = ((sess.data as (DrawerSession & { second_count_minor?: number | null })[] | null) ?? []).map((s) => ({
    sessionId: s.id,
    registerName: names.get(s.register_id) ?? "Register",
    status: s.status,
    secondCountMinor: s.second_count_minor ?? null,
  }));
  const stage: DutyBagStage = bags.bags.length === 0 ? "none" : bagStage(bags.bags[0]);
  return { ok: true, duties: morningDuties({ day, drawers, bagStage: stage }) };
}

/** Days in the last `lookbackDays` (before today) that had drawers and no bag. */
export async function missingBagDaysRecent(lookbackDays = 14): Promise<{ ok: true; days: string[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const today = pacificToday();
  const from = addPacificDays(today, -lookbackDays);
  const admin = createSupabaseAdminClient();
  const [sess, bags] = await Promise.all([
    admin.from("drawer_sessions").select("business_day").gte("business_day", from).lt("business_day", today),
    listBagsInRange(from, today),
  ]);
  if (sess.error) return { ok: false, error: `Drawers could not be read: ${sess.error.message}` };
  if (!bags.ok) return { ok: false, error: `Deposit bags could not be read: ${bags.error}` };
  return {
    ok: true,
    days: missingBagDays({
      drawerDays: ((sess.data as { business_day: string }[] | null) ?? []).map((r) => r.business_day),
      bagDays: bags.bags.map((b) => b.businessDay),
      today,
    }),
  };
}

/** Registers whose configured float is not the owner's standard (D181). */
export async function floatNotices(): Promise<string[]> {
  const regs = await listRegisters();
  return regs
    .map((r) => standardFloatNotice(r.name, r.kind, r.default_float_minor))
    .filter((s): s is string => s !== null);
}
