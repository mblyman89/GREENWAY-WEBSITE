"use server";
/**
 * D256 S2 - Stale-lot clean-up actions (owner/admin, settings.manage; audited).
 * Plan is read-only. Store needs the typed wave label AND the plan's counts.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { planCleanupAdjust, planCleanupWave, storeCleanupAdjust, storeCleanupWave } from "@/lib/compliance/ccrs-equalize-store";

const PATH = "/admin/compliance/ccrs/cleanup";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WAVE_RE = /^W[1-9][0-9]?$/;

export type CleanupResult = { ok: true; text: string; countsJson?: string; detail?: string } | { ok: false; error: string };

export async function planWaveAction(wave: string): Promise<CleanupResult> {
  await requirePermission("settings.manage");
  if (!WAVE_RE.test(wave)) return { ok: false, error: "The wave label is W1, W2, …" };
  try {
    const p = await planCleanupWave(wave);
    const c = p.counts;
    const held = Object.entries(c.held).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    const text = `Wave ${wave} (${p.day}): ${c.wave} lots to zero (${c.sumRemoved} units; ${c.nominalCost} at cost 0.01). Next waves: ${c.nextWave}. Ours, never touched: ${c.ours}. Already 0: ${c.alreadyZero}. Held: ${held}.`;
    const detail = ["First lots in the wave:", ...p.sample.map((l) => `  ${l.id}  qty ${l.qty}`), "", "Held lots:", ...p.holds.map((h) => `  ${h.id}  ${h.code}  ${h.detail}`)].join("\n");
    return { ok: true, text, countsJson: p.countsJson, detail };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function storeWaveAction(input: { wave: string; confirm: string; countsJson: string }): Promise<CleanupResult> {
  const session = await requirePermission("settings.manage");
  if (!WAVE_RE.test(input.wave) || (input.confirm ?? "").trim().toUpperCase() !== input.wave) return { ok: false, error: `Type ${input.wave} to confirm.` };
  try {
    const names = await storeCleanupWave(input.wave, input.countsJson);
    await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.cleanup.wave_stored", entityType: "ccrs_files", entityId: input.wave, after: { files: names, counts: JSON.parse(input.countsJson) } });
    revalidatePath(PATH);
    revalidatePath("/admin/compliance/ccrs");
    return { ok: true, text: `Stored ${names.join(", ")}. Upload it from the CCRS hub, then apply its email.` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function planAdjustAction(wave: string): Promise<CleanupResult> {
  await requirePermission("settings.manage");
  if (!WAVE_RE.test(wave)) return { ok: false, error: "The wave label is W1, W2, …" };
  try {
    const p = await planCleanupAdjust(wave);
    const held = Object.entries(p.counts.held).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    return { ok: true, text: `Wave ${wave} Reconciliation: ${p.counts.adjust} of ${p.counts.lines} lots ready (${p.counts.sumAdjusted} units). Not ready: ${held}.`, countsJson: p.countsJson, detail: p.holds.map((h) => `  ${h.id}  ${h.code}  ${h.detail}`).join("\n") };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function storeAdjustAction(input: { wave: string; confirm: string; countsJson: string }): Promise<CleanupResult> {
  const session = await requirePermission("settings.manage");
  if (!WAVE_RE.test(input.wave) || (input.confirm ?? "").trim().toUpperCase() !== input.wave) return { ok: false, error: `Type ${input.wave} to confirm.` };
  try {
    const names = await storeCleanupAdjust(input.wave, input.countsJson);
    await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.cleanup.adjust_stored", entityType: "ccrs_files", entityId: input.wave, after: { files: names, counts: JSON.parse(input.countsJson) } });
    revalidatePath(PATH);
    revalidatePath("/admin/compliance/ccrs");
    return { ok: true, text: `Stored ${names.join(", ")}. Upload it from the CCRS hub, then apply its email.` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
