"use server";
/**
 * R74 S40 - CCRS Records page actions. Owner/admin only (settings.manage);
 * every step is audited. The heavy lifting lives in ccrs-records-store.ts.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { applyCopy, compareCopy, discardCopy, startCopy } from "@/lib/compliance/ccrs-records-store";
import type { SeedSource } from "@/lib/compliance/ccrs-ledger-seed-core";

const PATH = "/admin/compliance/ccrs/records";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type StartCopyResult = { ok: true; id: string; uploads: { source: SeedSource; key: string; token: string }[] } | { ok: false; error: string };

export async function startCopyUploadAction(input: { asOf: string; notes: string }): Promise<StartCopyResult> {
  const session = await requirePermission("settings.manage");
  if (!isSupabaseServiceConfigured || !supabaseUrl) return { ok: false, error: "Storage isn't configured on this deployment." };
  try {
    const notes = (input.notes ?? "").trim().slice(0, 2000) || null;
    const r = await startCopy({ asOf: input.asOf, notes, actorId: session.profile.id, actorEmail: session.email ?? null });
    await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs_records.upload_started", entityType: "ccrs_record_copy", entityId: r.id, after: { asOf: input.asOf } });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function compareCopyAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");
  const r = await compareCopy(id);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: r.ok ? "ccrs_records.compared" : "ccrs_records.compare_failed", entityType: "ccrs_record_copy", entityId: id, after: r.ok ? {} : { error: r.error } });
  revalidatePath(PATH);
  return r;
}

export async function applyCopyAction(input: { id: string; expectAdd: number; expectUpd: number; acceptSeedMissing: string; confirm: string }): Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");
  if ((input.confirm ?? "").trim().toUpperCase() !== "MERGE") return { ok: false, error: 'Type MERGE to confirm.' };
  const raw = (input.acceptSeedMissing ?? "").trim();
  const accept = raw === "" ? null : Number(raw);
  if (accept !== null && (!Number.isInteger(accept) || accept < 0)) return { ok: false, error: "The accept count must be a whole number." };
  const r = await applyCopy({ id: input.id, expectAdd: input.expectAdd, expectUpd: input.expectUpd, acceptSeedMissing: accept, actorId: session.profile.id, actorEmail: session.email ?? null });
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: r.ok ? "ccrs_records.merged" : "ccrs_records.merge_refused", entityType: "ccrs_record_copy", entityId: input.id, after: r.ok ? { added: r.added, updated: r.updated, acceptSeedMissing: accept } : { error: r.error } });
  revalidatePath(PATH);
  revalidatePath("/admin/compliance/ccrs");
  return r;
}

export async function discardCopyAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");
  const r = await discardCopy(id);
  if (r.ok) await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs_records.discarded", entityType: "ccrs_record_copy", entityId: id, after: {} });
  revalidatePath(PATH);
  return r;
}
