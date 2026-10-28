"use server";
/**
 * Fix Phase 1.7a (G-43 req 7; owner message 4: "please build the photo
 * upload (G-43), as well as a video upload just in case.").
 *
 * Two steps, the Media Library's proven direct-upload pattern
 * (direct-upload-actions.ts) aimed at the PRIVATE destruction-evidence
 * bucket instead of the public media bucket:
 *   1. startEvidenceUploadAction  checks the event and the file, signs ONE
 *      upload to a fresh key under the event (TUS endpoint over 6 MB).
 *   2. finishEvidenceUploadAction reads the stored size and type and the
 *      first bytes back from Storage, removes the file on any mismatch, and
 *      only then writes the append-only destruction_evidence row and the
 *      audit row (destruction.evidence_uploaded).
 * Requires inventory.manage (the same people who complete a destruction).
 */
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { getDestructionEvent } from "@/lib/inventory/disposition";
import { readObjectHead } from "@/lib/media/read-object-head";
import { SIGNATURE_READ_BYTES } from "@/lib/media/file-signature-core";
import { resumableSignedEndpoint } from "@/lib/media/upload-policy-core";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_REFUSED_AUDIT_ACTION,
  EVIDENCE_UPLOAD_AUDIT_ACTION,
  buildEvidenceKey,
  evaluateEvidenceStart,
  evaluateStoredEvidence,
  isEvidenceKeyFor,
  isUuid,
} from "@/lib/inventory/destruction-evidence-core";
import { evidenceSchemaReady, insertEvidence } from "@/lib/inventory/destruction-evidence-store";

const BASE = "/admin/inventory/disposition";

export type StartEvidenceResult =
  | { ok: true; key: string; token: string; mime: string; resumable: boolean; endpoint: string; anonKey: string; bucket: string }
  | { ok: false; error: string };

export async function startEvidenceUploadAction(input: {
  eventId: string;
  filename: string;
  mime: string;
  size: number;
  note?: string;
}): Promise<StartEvidenceResult> {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured || !supabaseUrl) return { ok: false, error: "Storage isn't configured on this deployment." };
  const eventId = String(input?.eventId ?? "");
  if (!isUuid(eventId)) return { ok: false, error: "That destruction event reference is invalid." };
  const ready = await evidenceSchemaReady();
  if (!ready.ok) return { ok: false, error: ready.error };
  const event = await getDestructionEvent(eventId);
  const check = evaluateEvidenceStart({ filename: input.filename, mime: input.mime, size: input.size, note: input.note, eventStatus: event?.status ?? null });
  if (!check.ok) return { ok: false, error: check.error };
  const key = buildEvidenceKey({ eventId, nonce: crypto.randomBytes(8).toString("hex"), filename: check.filename, mime: check.mime });
  if (!key) return { ok: false, error: "Couldn't build a storage name for that file. Rename it and try again." };
  const endpoint = check.resumable ? resumableSignedEndpoint(supabaseUrl) : "";
  if (check.resumable && !endpoint) return { ok: false, error: "The Storage address is invalid, so large uploads can't start. Ask support to check NEXT_PUBLIC_SUPABASE_URL." };
  const signed = await createSupabaseAdminClient().storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(key);
  if (signed.error || !signed.data?.token) {
    return { ok: false, error: `Storage refused to start the upload: ${signed.error?.message ?? "no token"}. If it says the bucket was not found, apply migration 0312.` };
  }
  return { ok: true, key, token: signed.data.token, mime: check.mime, resumable: check.resumable, endpoint, anonKey: supabaseAnonKey, bucket: EVIDENCE_BUCKET };
}

async function removeQuietly(key: string): Promise<void> {
  try {
    await createSupabaseAdminClient().storage.from(EVIDENCE_BUCKET).remove([key]);
  } catch {
    /* best effort */
  }
}

export async function finishEvidenceUploadAction(input: {
  eventId: string;
  key: string;
  filename: string;
  size: number;
  note?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const eventId = String(input?.eventId ?? "");
  const key = String(input?.key ?? "");
  if (!isEvidenceKeyFor(key, eventId)) return { ok: false, error: "That upload reference is invalid." };
  const event = await getDestructionEvent(eventId);
  const filename = String(input.filename ?? "").trim().slice(0, 200) || key.split("/").pop() || "file";
  const startCheck = evaluateEvidenceStart({ filename, mime: "", size: input.size, note: input.note, eventStatus: event?.status ?? null });
  const refuse = async (error: string, code: string) => {
    await removeQuietly(key);
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: EVIDENCE_REFUSED_AUDIT_ACTION,
      entityType: "destruction_events",
      entityId: eventId,
      after: { key, filename, code, error },
    });
    return { ok: false as const, error };
  };
  if (!startCheck.ok && startCheck.code !== "type") return refuse(startCheck.error, startCheck.code);

  const bucket = createSupabaseAdminClient().storage.from(EVIDENCE_BUCKET);
  const info = await bucket.info(key);
  if (info.error || !info.data) return { ok: false, error: "The file didn't arrive in Storage. Please upload it again." };
  const head = await readObjectHead(EVIDENCE_BUCKET, key, SIGNATURE_READ_BYTES);
  const verdict = evaluateStoredEvidence({
    key,
    declaredSize: input.size,
    storedSize: info.data.size,
    storedMime: info.data.contentType,
    head,
    filename,
  });
  if (!verdict.ok) return refuse(verdict.error, verdict.code);

  const note = startCheck.ok ? startCheck.note : null;
  const actorName = session.profile.full_name ?? session.email ?? null;
  const saved = await insertEvidence({
    destruction_event_id: eventId,
    kind: verdict.kind,
    storage_key: key,
    filename,
    mime: verdict.mime,
    size_bytes: verdict.size,
    note,
    uploaded_by: session.profile.id,
    uploaded_by_name: actorName,
  });
  if (!saved.ok) return refuse(saved.error, "insert");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: EVIDENCE_UPLOAD_AUDIT_ACTION,
    entityType: "destruction_events",
    entityId: eventId,
    after: { evidence_id: saved.id, kind: verdict.kind, mime: verdict.mime, size_bytes: verdict.size, filename, note, event_status: event?.status ?? null },
  });
  revalidatePath(BASE);
  revalidatePath(`${BASE}/destruction-record`);
  return { ok: true, id: saved.id };
}
