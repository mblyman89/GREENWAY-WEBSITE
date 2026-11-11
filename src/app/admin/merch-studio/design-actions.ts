"use server";
/**
 * D232 M-4 (SOP-11 G-79, G-81) - Merch Studio designs on the server and the
 * sample gate. Table public.merch_designs (migration 0360); artwork and the
 * sample photo in the private `merch-files` bucket.
 *
 *   listMerchDesignsAction      every live design (content.edit).
 *   saveMerchDesignAction       insert (baseRev 0) or update only when the row
 *                               is still at baseRev (rev compare-and-set).
 *                               The loser changes nothing and is told
 *                               DESIGN_CONFLICT. A saved print change keeps
 *                               the old approval on the row, but the gate
 *                               compares hashes, so it no longer passes.
 *   archiveMerchDesignAction    archive, never delete (content.edit).
 *   startArtUploadsAction       signed upload tokens for art/<asset id> that
 *                               aren't on the server yet (content.edit).
 *   artDownloadUrlsAction       1-hour signed URLs for art this browser lacks.
 *   startSamplePhotoUploadAction / approveMerchSampleAction
 *                               owner/admin (merch.publish - the same people
 *                               who may put it on sale, owner D232 "Q1:
 *                               owner/admin"): every checklist item + a photo.
 *   overrideMerchSampleAction   OWNER ONLY with a typed reason, audited.
 *                               Owner D232: "Q2: yes, owner only and reason."
 *   clearMerchSampleAction      owner/admin: take an approval back.
 */
import crypto from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readObjectHead } from "@/lib/media/read-object-head";
import { normalizeDesign } from "@/lib/merch-studio/merch-design-core";
import { sampleChecklist } from "@/lib/merch-studio/print-export-core";
import {
  approvalProblem, ART_KEY_RE, DESIGN_CONFLICT, DESIGN_ID_RE, MAX_DESIGN_BYTES, overrideProblem, PHOTO_MIME, printHash, saveDecision, type DesignRow,
} from "@/lib/merch-studio/merch-design-sync-core";
import { DESIGNS_TABLE, designDbError, listDesignRows, readDesignRow } from "@/lib/merch-studio/merch-design-store";

const BUCKET = "merch-files";
const MAX_ART = 40;
const NO_DB = "The database isn't configured on this deployment.";

export type ListDesignsResult = { ok: true; rows: DesignRow[] } | { ok: false; error: string };
export async function listMerchDesignsAction(): Promise<ListDesignsResult> {
  await requirePermission("content.edit");
  const r = await listDesignRows();
  return r.error ? { ok: false, error: r.error } : { ok: true, rows: r.rows };
}

export type SaveDesignResult =
  | { ok: true; rev: number; designHash: string; updatedAt: string }
  | { ok: false; error: string; conflict?: boolean; archived?: boolean };

export async function saveMerchDesignAction(input: { design: unknown; baseRev: number }): Promise<SaveDesignResult> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const d = normalizeDesign(input?.design);
  if (!d || !DESIGN_ID_RE.test(d.id)) return { ok: false, error: "That isn't a valid design." };
  const json = JSON.stringify(d);
  if (json.length > MAX_DESIGN_BYTES) return { ok: false, error: "This design is over 1 MB. Remove some elements." };
  const baseRev = Math.max(0, Math.floor(Number(input?.baseRev) || 0));
  const cur = await readDesignRow(d.id);
  if (cur.error) return { ok: false, error: cur.error };
  if (cur.archived) return { ok: false, archived: true, error: "This design was archived on another computer. Duplicate it to keep working on it." };
  const decision = saveDecision(cur.row, baseRev);
  if (decision === "conflict") return { ok: false, conflict: true, error: DESIGN_CONFLICT };
  const hash = printHash(d);
  const now = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const fields = { name: d.name.trim().slice(0, 80) || "Untitled design", blank_id: d.blankId, design: d, design_hash: hash, updated_by_email: session.email ?? null, updated_at: now };
  if (decision === "insert") {
    const { error } = await admin.from(DESIGNS_TABLE).insert({ id: d.id, ...fields, rev: 1, created_by_email: session.email ?? null });
    if (error) return (error as { code?: string }).code === "23505" ? { ok: false, conflict: true, error: DESIGN_CONFLICT } : { ok: false, error: designDbError(error.message) };
    return { ok: true, rev: 1, designHash: hash, updatedAt: now };
  }
  const { data, error } = await admin.from(DESIGNS_TABLE).update({ ...fields, rev: baseRev + 1 }).eq("id", d.id).eq("rev", baseRev).is("archived_at", null).select("id");
  if (error) return { ok: false, error: designDbError(error.message) };
  if (!Array.isArray(data) || data.length !== 1) return { ok: false, conflict: true, error: DESIGN_CONFLICT };
  return { ok: true, rev: baseRev + 1, designHash: hash, updatedAt: now };
}

export async function archiveMerchDesignAction(input: { id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const id = String(input?.id ?? "");
  if (!DESIGN_ID_RE.test(id)) return { ok: false, error: "Invalid design." };
  const { error } = await createSupabaseAdminClient().from(DESIGNS_TABLE).update({ archived_at: new Date().toISOString(), updated_by_email: session.email ?? null }).eq("id", id).is("archived_at", null);
  if (error) return { ok: false, error: designDbError(error.message) };
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "merch.design_archived", entityType: "merch_design", entityId: id });
  return { ok: true };
}

// Artwork -------------------------------------------------------------------------

const artKey = (assetId: string) => `art/${assetId}`;
const cleanIds = (ids: unknown): string[] => [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => DESIGN_ID_RE.test(x)))].slice(0, MAX_ART);

/** Which of these art ids are already in merch-files (exact name match per id, no downloads). */
async function artOnServer(ids: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  const store = createSupabaseAdminClient().storage.from(BUCKET);
  for (const id of ids) {
    const { data } = await store.list("art", { limit: 20, search: id }).catch(() => ({ data: null }));
    if (((data ?? []) as { name: string }[]).some((f) => f.name === id)) have.add(id);
  }
  return have;
}

export type ArtUploadsResult = { ok: true; bucket: string; uploads: { assetId: string; key: string; token: string }[] } | { ok: false; error: string };
export async function startArtUploadsAction(input: { assetIds: string[] }): Promise<ArtUploadsResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const ids = cleanIds(input?.assetIds);
  const have = await artOnServer(ids);
  const admin = createSupabaseAdminClient();
  const uploads: { assetId: string; key: string; token: string }[] = [];
  for (const id of ids.filter((x) => !have.has(x))) {
    const key = artKey(id);
    if (!ART_KEY_RE.test(key)) continue;
    const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(key);
    if (signed.error || !signed.data?.token) {
      const m = signed.error?.message ?? "no token";
      if (/exists|duplicate/i.test(m)) continue;
      return { ok: false, error: /not found|bucket/i.test(m) ? "The private 'merch-files' bucket doesn't exist yet - apply migration 0281 in Supabase." : `Storage refused the upload: ${m}.` };
    }
    uploads.push({ assetId: id, key, token: signed.data.token });
  }
  return { ok: true, bucket: BUCKET, uploads };
}

export type ArtUrlsResult = { ok: true; urls: Record<string, string>; missing: string[] } | { ok: false; error: string };
export async function artDownloadUrlsAction(input: { assetIds: string[] }): Promise<ArtUrlsResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const ids = cleanIds(input?.assetIds);
  const admin = createSupabaseAdminClient();
  const urls: Record<string, string> = {}; const missing: string[] = [];
  for (const id of ids) {
    const s = await admin.storage.from(BUCKET).createSignedUrl(artKey(id), 3600);
    if (s.error || !s.data?.signedUrl) missing.push(id); else urls[id] = s.data.signedUrl;
  }
  return { ok: true, urls, missing };
}

// Sample approval -----------------------------------------------------------------

export type SamplePhotoUploadResult = { ok: true; bucket: string; key: string; token: string } | { ok: false; error: string };
export async function startSamplePhotoUploadAction(input: { designId: string; mime: string }): Promise<SamplePhotoUploadResult> {
  await requirePermission("merch.publish");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const id = String(input?.designId ?? "");
  const ext = PHOTO_MIME[String(input?.mime ?? "")];
  if (!DESIGN_ID_RE.test(id)) return { ok: false, error: "Invalid design." };
  if (!ext) return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  const key = `sample/${id}/${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const signed = await createSupabaseAdminClient().storage.from(BUCKET).createSignedUploadUrl(key);
  if (signed.error || !signed.data?.token) return { ok: false, error: `Storage refused the photo: ${signed.error?.message ?? "no token"}. Apply migration 0360 (it lets merch-files take photos).` };
  return { ok: true, bucket: BUCKET, key, token: signed.data.token };
}

const looksLikePhoto = (b: Uint8Array | null, ext: string): boolean => {
  if (!b || b.length < 12) return false;
  if (ext === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === "jpg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
};

export type SampleResult = { ok: true; row: DesignRow } | { ok: false; error: string };

/** Load the saved row and require it to be the print the person is looking at. */
async function savedRowFor(designId: string, hash: string): Promise<{ row: DesignRow } | { error: string }> {
  if (!DESIGN_ID_RE.test(designId)) return { error: "Invalid design." };
  const r = await readDesignRow(designId);
  if (r.error) return { error: r.error };
  if (!r.row) return { error: "This design isn't saved on the server yet. Open it in Design and wait for \"Saved on the server\"." };
  if (r.row.designHash !== hash) return { error: "The saved design is different from the one on this screen. Wait for \"Saved on the server\" in Design, then reload." };
  return { row: r.row };
}

export async function approveMerchSampleAction(input: { designId: string; designHash: string; ticked: string[]; photoKey: string }): Promise<SampleResult> {
  const session = await requirePermission("merch.publish");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const got = await savedRowFor(String(input?.designId ?? ""), String(input?.designHash ?? ""));
  if ("error" in got) return { ok: false, error: got.error };
  const required = sampleChecklist(got.row.design).map((c) => c.id);
  const ticked = (Array.isArray(input?.ticked) ? input.ticked : []).map(String).filter((x) => required.includes(x));
  const photoKey = String(input?.photoKey ?? "");
  const problem = approvalProblem(required, ticked, photoKey || null);
  if (problem) return { ok: false, error: problem };
  if (!photoKey.startsWith(`sample/${got.row.id}/`)) return { ok: false, error: "That photo belongs to a different design. Upload it again." };
  const head = await readObjectHead(BUCKET, photoKey, 16);
  if (!looksLikePhoto(head, photoKey.split(".").pop() ?? "")) return { ok: false, error: "The photo didn't arrive in Storage. Upload it again." };
  return writeSample(session, got.row, { sample_status: "approved", sample_design_hash: got.row.designHash, sample_checklist: ticked, sample_photo_key: photoKey, sample_reason: null }, "merch.sample_approved");
}

export async function overrideMerchSampleAction(input: { designId: string; designHash: string; reason: string }): Promise<SampleResult> {
  const session = await requirePermission("merch.publish");
  // Owner D232: "Q2: yes, owner only and reason." No owner-only permission exists for merch, so the role is checked here.
  if (session.profile.role !== "owner") return { ok: false, error: "Only the owner can publish without an approved sample." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const reason = String(input?.reason ?? "").trim().slice(0, 500);
  const problem = overrideProblem(reason);
  if (problem) return { ok: false, error: problem };
  const got = await savedRowFor(String(input?.designId ?? ""), String(input?.designHash ?? ""));
  if ("error" in got) return { ok: false, error: got.error };
  return writeSample(session, got.row, { sample_status: "overridden", sample_design_hash: got.row.designHash, sample_checklist: [], sample_photo_key: null, sample_reason: reason }, "merch.sample_overridden");
}

export async function clearMerchSampleAction(input: { designId: string }): Promise<SampleResult> {
  const session = await requirePermission("merch.publish");
  if (!isSupabaseServiceConfigured) return { ok: false, error: NO_DB };
  const id = String(input?.designId ?? "");
  const r = DESIGN_ID_RE.test(id) ? await readDesignRow(id) : { row: null, error: "Invalid design.", archived: false };
  if (r.error || !r.row) return { ok: false, error: r.error ?? "This design isn't saved on the server." };
  return writeSample(session, r.row, { sample_status: "none", sample_design_hash: null, sample_checklist: [], sample_photo_key: null, sample_reason: null }, "merch.sample_cleared");
}

type Session = Awaited<ReturnType<typeof requirePermission>>;
type SampleFields = { sample_status: "none" | "approved" | "overridden"; sample_design_hash: string | null; sample_checklist: string[]; sample_photo_key: string | null; sample_reason: string | null };

/** Writes only when the row is still at the rev we checked (a save in between = reload). */
async function writeSample(session: Session, row: DesignRow, f: SampleFields, action: string): Promise<SampleResult> {
  const now = new Date().toISOString();
  const by = f.sample_status === "none" ? null : session.email ?? null;
  const { data, error } = await createSupabaseAdminClient().from(DESIGNS_TABLE)
    .update({ ...f, sample_by_email: by, sample_at: f.sample_status === "none" ? null : now })
    .eq("id", row.id).eq("rev", row.rev).is("archived_at", null).select("*");
  if (error) return { ok: false, error: designDbError(error.message) };
  if (!Array.isArray(data) || data.length !== 1) return { ok: false, error: DESIGN_CONFLICT };
  await recordAudit({
    actorId: session.userId, actorEmail: session.email, action, entityType: "merch_design", entityId: row.id,
    before: { sampleStatus: row.sampleStatus, sampleDesignHash: row.sampleDesignHash, sampleBy: row.sampleByEmail },
    after: { sampleStatus: f.sample_status, designHash: row.designHash, rev: row.rev, checklist: f.sample_checklist, photoKey: f.sample_photo_key, reason: f.sample_reason },
  });
  const next: DesignRow = { ...row, sampleStatus: f.sample_status, sampleDesignHash: f.sample_design_hash, sampleChecklist: f.sample_checklist, samplePhotoKey: f.sample_photo_key, sampleReason: f.sample_reason, sampleByEmail: by, sampleAt: f.sample_status === "none" ? null : now };
  return { ok: true, row: next };
}

/** Signed URL for the sample photo (to show it on Proof & Export). */
export async function samplePhotoUrlAction(input: { key: string }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requirePermission("content.edit");
  const key = String(input?.key ?? "");
  if (!/^sample\/[A-Za-z0-9_-]{1,60}\/[a-f0-9]{12}\.(png|jpg|webp)$/.test(key)) return { ok: false, error: "Invalid photo." };
  const s = await createSupabaseAdminClient().storage.from(BUCKET).createSignedUrl(key, 3600);
  return s.error || !s.data?.signedUrl ? { ok: false, error: "Couldn't load the photo." } : { ok: true, url: s.data.signedUrl };
}

