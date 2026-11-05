/**
 * src/lib/registers/role-checklist-store.ts   (D185, round slice S8)
 *
 * SERVER-ONLY. Reads the facts for "My Day" and hands them to the pure
 * role-checklist-core. READ-ONLY: no insert, update, upsert or delete. Every
 * read failure travels as an error (rule 135), never as "done".
 */
import "server-only";

import { addPacificDays, pacificToday, storeHour } from "@/lib/reports/timezone";
import { liveDropStatuses, missingBagDaysRecent, morningDutiesFor } from "@/lib/registers/guided-cash-store";
import { checklistPeriodKey } from "@/lib/inventory/daily-checklist-core";
import { getChecklistRun, listChecklistTasks, listChecklistTicks } from "@/lib/inventory/daily-checklist-store";
import { buildMyDay, type MyDay, type MyDayFacts, type SheetFact } from "@/lib/registers/role-checklist-core";

async function sheetFact(kind: "opening" | "during" | "closing", day: string): Promise<SheetFact> {
  try {
    const [tasks, run] = await Promise.all([listChecklistTasks(kind), getChecklistRun(kind, checklistPeriodKey(kind, day))]);
    if (!tasks.ok) return { ok: false, error: tasks.error };
    if (!run.ok) return { ok: false, error: run.error };
    const active = tasks.data.filter((t) => t.active);
    if (!run.data) return { ok: true, total: active.length, ticked: 0, signedOff: false };
    const ticks = await listChecklistTicks(run.data.id);
    if (!ticks.ok) return { ok: false, error: ticks.error };
    const activeIds = new Set(active.map((t) => t.id));
    const ticked = new Set(ticks.data.map((t) => t.taskId).filter((id) => activeIds.has(id))).size;
    return { ok: true, total: active.length, ticked, signedOff: !!run.data.signedOffAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const safe = async <T>(p: Promise<T>, fallback: (msg: string) => T): Promise<T> => {
  try {
    return await p;
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
};

/** Read everything and build today's list. `hour` overrides the clock (tests / ?shift=). */
export async function myDayNow(hourOverride?: number): Promise<{ day: MyDay; facts: MyDayFacts }> {
  const today = pacificToday();
  const yesterday = addPacificDays(today, -1);
  const err = (error: string) => ({ ok: false as const, error });
  const [yDuties, tDuties, drops, missing, opening, during, closing] = await Promise.all([
    safe(morningDutiesFor(yesterday), err),
    safe(morningDutiesFor(today), err),
    safe(liveDropStatuses(), err),
    safe(missingBagDaysRecent(14), err),
    sheetFact("opening", today),
    sheetFact("during", today),
    sheetFact("closing", today),
  ]);
  const facts: MyDayFacts = {
    today,
    yesterday,
    hour: hourOverride ?? storeHour(),
    yesterdayDuties: yDuties,
    todayDuties: tDuties,
    drops: drops.ok
      ? { ok: true, drops: drops.drops.map((d) => ({ registerName: d.registerName, state: d.status.state, sentence: d.status.sentence })) }
      : drops,
    missingBagDays: missing,
    sheets: { opening, during, closing },
  };
  return { day: buildMyDay(facts), facts };
}
