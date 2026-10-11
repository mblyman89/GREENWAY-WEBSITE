"use server";

// R44 — uploads bigger than Vercel's 4.5 MB Function body limit.
//
// Vercel caps every Function request body at 4.5 MB on ALL plans (Pro
// included), so large files can never pass through a Server Action. Vercel's
// own guidance is to upload straight from the browser to storage. These two
// actions are the only server side of that flow:
//
//   1. startDirectUploadAction  — staff permission + file policy check, then
//      mints a one-time Supabase *signed upload* token (valid 2 h) for a FRESH
//      key (never overwrites — Supabase warns overwritten paths serve stale
//      CDN copies). The file bytes never touch Vercel.
//   2. finishDirectUploadAction — after the browser upload, VERIFIES the object
//      really exists in Storage with the declared size + type (never trusts the
//      browser), then adds the Media Library row + audit entry.
//
// Files ≤ 6 MB go up in one signed PUT; larger files use Supabase's TUS
// resumable protocol in 6 MB chunks (Supabase's documented chunk size).

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";
import { registerUploadedMedia } from "@/lib/media/store";
import { normalizeTags } from "@/lib/media/taxonomy";
import {
  checkUpload,
  buildUploadKey,
  isDirectUploadKey,
  posterKeyFor,
  resumableSignedEndpoint,
  cleanDimension,
  kindOfMime,
  UPLOAD_MAX_BYTES,
  formatBytes,
} from "@/lib/media/upload-policy-core";

const BUCKET = "media";
/** Posters are a single captured JPEG frame; anything bigger is not a poster. */
const POSTER_MAX_BYTES = 5 * 1024 * 1024;

export type StartDirectUploadResult =
  | {
      ok: true;
      key: string;
      token: string;
      resumable: boolean;
      endpoint: string;
      anonKey: string;
      posterKey: string | null;
      posterToken: string | null;
      advisory: string | null;
    }
  | { ok: false; error: string };

export type FinishDirectUploadResult = { ok: true; id: string; url: string } | { ok: false; error: string };

/**
 * Step 1: ask permission to upload ONE file. Returns a signed token for a new,
 * never-reused key (and, for a video, a second token for its poster frame).
 */
export async function startDirectUploadAction(input: {
  filename: string;
  mime: string;
  size: number;
  usageType?: string;
  withPoster?: boolean;
}): Promise<StartDirectUploadResult> {
  await requirePermission("media.manage");
  if (!isSupabaseServiceConfigured || !supabaseUrl) {
    return { ok: false, error: "Storage isn't configured on this deployment." };
  }
  const check = checkUpload({ filename: input?.filename, mime: input?.mime, size: input?.size });
  if (!check.ok) return { ok: false, error: check.error };

  const withPoster = Boolean(input.withPoster) && check.kind === "video";
  const key = buildUploadKey({
    folder: typeof input.usageType === "string" ? input.usageType : "uploads",
    filename: String(input.filename),
    mime: check.mime,
    nonce: crypto.randomBytes(8).toString("hex"),
    withPoster,
  });
  if (!key) return { ok: false, error: "Couldn't build a storage name for that file — rename it and try again." };

  const endpoint = check.resumable ? resumableSignedEndpoint(supabaseUrl) : "";
  if (check.resumable && !endpoint) {
    return { ok: false, error: "The Storage address is invalid, so large uploads can't start. Ask support to check NEXT_PUBLIC_SUPABASE_URL." };
  }

  const admin = createSupabaseAdminClient();
  const bucket = admin.storage.from(BUCKET);
  const signed = await bucket.createSignedUploadUrl(key);
  if (signed.error || !signed.data?.token) {
    return { ok: false, error: `Storage refused to start the upload: ${signed.error?.message ?? "no token"}.` };
  }

  let posterKey: string | null = null;
  let posterToken: string | null = null;
  if (withPoster) {
    posterKey = posterKeyFor(key);
    if (posterKey) {
      const ps = await bucket.createSignedUploadUrl(posterKey);
      posterToken = ps.data?.token ?? null;
      if (!posterToken) posterKey = null; // video still works without a poster
    }
  }

  return {
    ok: true,
    key,
    token: signed.data.token,
    resumable: check.resumable,
    endpoint,
    // The anon key is already public (NEXT_PUBLIC_*); TUS needs it as `apikey`.
    anonKey: supabaseAnonKey,
    posterKey,
    posterToken,
    advisory: check.advisory,
  };
}

/** Remove a half-registered object so a refused upload leaves no orphan. */
async function removeQuietly(keys: string[]): Promise<void> {
  try {
    await createSupabaseAdminClient().storage.from(BUCKET).remove(keys);
  } catch {
    /* best effort */
  }
}

/**
 * Step 2: the browser says "done". Verify the object in Storage, then catalogue
 * it. Size and type come from STORAGE, not from the browser.
 */
export async function finishDirectUploadAction(input: {
  key: string;
  filename: string;
  size: number;
  width?: number | null;
  height?: number | null;
  posterKey?: string | null;
  title?: string;
  usageType?: string;
  tags?: string;
  altText?: string;
  status?: string;
}): Promise<FinishDirectUploadResult> {
  const session = await requirePermission("media.manage");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const key = String(input?.key ?? "");
  if (!isDirectUploadKey(key)) return { ok: false, error: "That upload reference is invalid." };

  const admin = createSupabaseAdminClient();
  const bucket = admin.storage.from(BUCKET);
  const info = await bucket.info(key);
  if (info.error || !info.data) {
    return { ok: false, error: "The file didn't arrive in Storage. Please upload it again." };
  }
  const storedSize = Number(info.data.size ?? NaN);
  const storedMime = String(info.data.contentType ?? "").toLowerCase().split(";")[0]!.trim();
  const kind = kindOfMime(storedMime);
  if (!kind) {
    await removeQuietly([key]);
    return { ok: false, error: `Storage recorded an unsupported type (${storedMime || "unknown"}). The file was removed.` };
  }
  if (!Number.isFinite(storedSize) || storedSize <= 0 || storedSize > UPLOAD_MAX_BYTES[kind]) {
    await removeQuietly([key]);
    return { ok: false, error: `The stored file is ${formatBytes(storedSize)}, over the ${kind} limit. It was removed.` };
  }
  if (Number(input.size) !== storedSize) {
    await removeQuietly([key]);
    return { ok: false, error: "The upload was incomplete (size mismatch). Please upload it again." };
  }
  // The extension in our key was chosen from the declared type — they must agree.
  const keyCheck = checkUpload({ filename: key, mime: storedMime, size: storedSize });
  if (!keyCheck.ok) {
    await removeQuietly([key]);
    return { ok: false, error: "The stored file type didn't match its name. It was removed — please upload again." };
  }

  // Poster (optional): only accept the sibling key we would have signed.
  const expectedPoster = posterKeyFor(key);
  if (input.posterKey && expectedPoster && input.posterKey === expectedPoster) {
    const p = await bucket.info(expectedPoster);
    const pSize = Number(p.data?.size ?? NaN);
    const pMime = String(p.data?.contentType ?? "").toLowerCase();
    if (p.error || !pMime.startsWith("image/jpeg") || !(pSize > 0 && pSize <= POSTER_MAX_BYTES)) {
      await removeQuietly([expectedPoster]); // the video renders without it
    }
  }

  const status = input.status === "published" ? "published" : "draft";
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 200) : undefined;
  const altText = typeof input.altText === "string" && input.altText.trim() ? input.altText.trim().slice(0, 500) : undefined;
  const usageType = typeof input.usageType === "string" && input.usageType.trim() ? input.usageType.trim() : undefined;
  const filename = String(input.filename ?? "").trim().slice(0, 200) || key.split("/").pop()!;

  try {
    const asset = await registerUploadedMedia({
      storageKey: key,
      filename,
      mimeType: storedMime,
      sizeBytes: storedSize,
      width: cleanDimension(input.width),
      height: cleanDimension(input.height),
      title,
      altText,
      usageType,
      tags: normalizeTags(String(input.tags ?? "")),
      uploadedBy: session.userId,
      status,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.uploaded",
      entityType: "media_asset",
      entityId: asset.id,
    });
    revalidatePath("/admin/media");
    return { ok: true, id: asset.id, url: asset.public_url ?? "" };
  } catch (e) {
    return { ok: false, error: `Saved to Storage but the library entry failed: ${(e as Error).message}` };
  }
}
