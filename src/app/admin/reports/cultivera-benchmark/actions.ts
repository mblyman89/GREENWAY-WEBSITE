"use server";

/**
 * CVB-6 - Reports -> Cultivera Benchmark: the owner's two payback actions. Owner only ("cultivera.benchmark").
 *
 *   recordSavingAction    -> a saving the owner states (for example a Cultivera invoice that no longer
 *                            arrives). The amount is the owner's, never inferred. Pressing twice stores one row
 *                            (the key is the date, the cents and the note).
 *   creditOutperformAction -> for a CLOSED, COMPLETE period, credit what our gross profit beat Cultivera's same
 *                            calendar days one year earlier by. Recomputed here on the server from the database
 *                            (nothing from the form is trusted but the two dates). Credited once per period
 *                            (key outperform:<metric>:<from>:<to>), and never over a day already credited.
 *
 * Owner request 2026-11-01: "Total build was 40k ... We just now today from switching saved 5500 ... every time we
 * outperform Cultivera it should go down." The ledger is insert-only (0337); a mistake is fixed by an adjustment.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isDay, outperformCredit, savingFromInput } from "@/lib/reports/cultivera-benchmark-core";
import { PAYBACK_METRIC, creditOverlap, savingKey } from "@/lib/reports/cultivera-benchmark-report-core";
import { insertPaybackEntry, paybackEntries } from "@/lib/reports/cultivera-benchmark-store";
import { buildBenchmark } from "@/lib/reports/cultivera-benchmark-report-store";

const PAGE = "/admin/reports/cultivera-benchmark";
const back = (from: string, to: string, q: string) => `${PAGE}?from=${from}&to=${to}${q}`;
const err = (m: string) => "&error=" + encodeURIComponent(m);
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function period(formData: FormData): { from: string; to: string } {
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  return isDay(from) && isDay(to) && from <= to ? { from, to } : { from: "", to: "" };
}

export async function recordSavingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const { from, to } = period(formData);
  const parsed = savingFromInput({
    dollars: String(formData.get("dollars") ?? ""),
    date: String(formData.get("date") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (typeof parsed === "string") redirect(back(from, to, err(parsed)));
  const entry = parsed as Exclude<typeof parsed, string>;
  const entryKey = savingKey(entry);
  let q = "";
  try {
    const out = await insertPaybackEntry({ ...entry, entryKey, basis: { source: "owner", enteredBy: session.email } }, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out === "inserted" ? "cultivera_benchmark.saving_recorded" : "cultivera_benchmark.saving_already_recorded",
      entityType: "cultivera_payback_entry",
      entityId: entryKey,
      after: { entryDate: entry.entryDate, amountMinor: entry.amountMinor, note: entry.note },
    });
    q = out === "inserted" ? "&saved=1" : "&already=1";
  } catch (e) {
    redirect(back(from, to, err(msg(e, "Could not record the saving."))));
  }
  revalidatePath(PAGE);
  redirect(back(from, to, q));
}

export async function creditOutperformAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const { from, to } = period(formData);
  if (!from) redirect(`${PAGE}?error=${encodeURIComponent("Pick a period first.")}`);
  let q = "";
  try {
    const b = await buildBenchmark(from, to);
    if (!b.cmp) throw new Error("There is no Cultivera period to compare with.");
    const credit = outperformCredit(b.cmp, PAYBACK_METRIC, b.today);
    if (typeof credit === "string") throw new Error(`No credit: ${credit}.`);
    const clash = creditOverlap(await paybackEntries(), credit.basis.from, credit.basis.to);
    if (clash) throw new Error(`No credit: ${clash}.`);
    const out = await insertPaybackEntry(credit, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out === "inserted" ? "cultivera_benchmark.outperform_credited" : "cultivera_benchmark.outperform_already_credited",
      entityType: "cultivera_payback_entry",
      entityId: credit.entryKey,
      after: { amountMinor: credit.amountMinor, basis: credit.basis },
    });
    q = out === "inserted" ? `&credited=${credit.amountMinor}` : "&already=1";
  } catch (e) {
    redirect(back(from, to, err(msg(e, "Could not credit the period."))));
  }
  revalidatePath(PAGE);
  redirect(back(from, to, q));
}
