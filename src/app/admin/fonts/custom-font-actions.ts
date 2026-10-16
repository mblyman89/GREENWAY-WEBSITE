"use server";
/**
 * R56-S2 — the owner's own fonts. Three small actions around the SAME direct
 * browser→Storage upload the Media Library uses (Vercel's 4.5 MB Function body
 * cap never applies):
 *
 *   startFontUploadAction   licence box ticked + a font-looking file → a
 *                           one-time signed upload token for media/fonts/<hex>.<ext>
 *   finishFontUploadAction  reads the stored bytes back, proves it's a font
 *                           (wOF2/wOFF/OTTO/sfnt), then catalogues it in
 *                           media_assets (usage_type "font", licence
 *                           "owner-attested" with WHO + WHEN) and audits it
 *   listCustomFontsAction   the fonts for the pickers
 *
 * No new table: media_assets already has license_status, so the attestation
 * lives with the file and the font shows in Content → Media like any asset.
 */
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { registerUploadedMedia } from "@/lib/media/store";
import { readObjectHead } from "@/lib/media/read-object-head";
import {
  CUSTOM_FONT_USAGE,
  FONT_LICENSE_STATEMENT,
  FONT_LICENSE_STATUS,
  FONT_MAX_BYTES,
  checkFontUpload,
  cleanFontLabel,
  customFontIdFromKey,
  customFontKey,
  fontExtFromName,
  sniffFont,
  sniffMatchesExt,
} from "@/lib/cms/custom-font-core";

const BUCKET = "media";

export type CustomFontRow = { id: string; label: string };
export type StartFontResult = { ok: true; key: string; token: string; mime: string; advisory: string | null } | { ok: false; error: string };
export type FinishFontResult = { ok: true; font: CustomFontRow } | { ok: false; error: string };

export async function startFontUploadAction(input: { filename: string; size: number; licenseConfirmed: boolean }): Promise<StartFontResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured || !supabaseUrl) return { ok: false, error: "Storage isn't configured on this deployment." };
  const check = checkFontUpload({ filename: input?.filename, size: input?.size, licenseConfirmed: input?.licenseConfirmed });
  if (!check.ok) return check;
  const key = customFontKey(crypto.randomBytes(8).toString("hex"), check.ext);
  const signed = await createSupabaseAdminClient().storage.from(BUCKET).createSignedUploadUrl(key);
  if (signed.error || !signed.data?.token) return { ok: false, error: `Storage refused to start the upload: ${signed.error?.message ?? "no token"}.` };
  return { ok: true, key, token: signed.data.token, mime: check.mime, advisory: check.advisory };
}

async function removeQuietly(key: string) {
  try {
    await createSupabaseAdminClient().storage.from(BUCKET).remove([key]);
  } catch {
    /* best effort */
  }
}

export async function finishFontUploadAction(input: { key: string; filename: string; size: number; name: string; licenseConfirmed: boolean }): Promise<FinishFontResult> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  if (input?.licenseConfirmed !== true) return { ok: false, error: "Tick the box to confirm you have the right to use this font." };
  const key = String(input?.key ?? "");
  const id = customFontIdFromKey(key);
  const ext = fontExtFromName(key);
  if (!id || !ext) return { ok: false, error: "That upload reference is invalid." };

  const info = await createSupabaseAdminClient().storage.from(BUCKET).info(key);
  const size = Number(info.data?.size ?? NaN);
  if (info.error || !info.data || !(size > 0)) return { ok: false, error: "The font didn't arrive in Storage. Please upload it again." };
  if (size > FONT_MAX_BYTES || size !== Number(input.size)) {
    await removeQuietly(key);
    return { ok: false, error: "The upload was incomplete. Please upload it again." };
  }
  // Prove it from the BYTES (never the name): only web-loadable font formats pass.
  const head = await readObjectHead(BUCKET, key, 16);
  const sniff = head ? sniffFont(head) : ({ ok: false, error: "The font couldn't be checked (Storage didn't answer). Please try again." } as const);
  if (!sniff.ok || !sniffMatchesExt(sniff.ext, ext)) {
    await removeQuietly(key);
    return { ok: false, error: sniff.ok ? `That file is really a ${sniff.ext.toUpperCase()} font — rename it to .${sniff.ext} and upload again.` : sniff.error };
  }

  const label = cleanFontLabel(input.name, input.filename);
  const at = new Date().toISOString();
  try {
    const asset = await registerUploadedMedia({
      storageKey: key,
      filename: String(input.filename ?? "").trim().slice(0, 200) || key.split("/").pop()!,
      mimeType: String(info.data.contentType ?? "").split(";")[0]!.trim() || `font/${ext}`,
      sizeBytes: size,
      width: null,
      height: null,
      title: label,
      usageType: CUSTOM_FONT_USAGE,
      tags: ["font"],
      uploadedBy: session.userId,
      status: "published",
      description: `Licence confirmed by ${session.email} on ${at}: "${FONT_LICENSE_STATEMENT}"`,
    });
    // registerUploadedMedia writes license_status null; record the attestation.
    await createSupabaseAdminClient().from("media_assets").update({ license_status: FONT_LICENSE_STATUS }).eq("id", asset.id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "font.uploaded",
      entityType: "media_asset",
      entityId: asset.id,
      after: { fontId: id, label, licenseConfirmed: true, licenseConfirmedAt: at, statement: FONT_LICENSE_STATEMENT },
    });
  } catch (e) {
    await removeQuietly(key);
    return { ok: false, error: `Couldn't save the font: ${e instanceof Error ? e.message : "unknown error"}.` };
  }
  revalidatePath("/admin/media");
  return { ok: true, font: { id, label } };
}

export async function listCustomFontsAction(): Promise<CustomFontRow[]> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return [];
  try {
    const { data } = await createSupabaseAdminClient()
      .from("media_assets")
      .select("storage_key, title, filename")
      .eq("usage_type", CUSTOM_FONT_USAGE)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(200);
    const out: CustomFontRow[] = [];
    for (const r of (data as { storage_key: string; title: string | null; filename: string }[] | null) ?? []) {
      const id = customFontIdFromKey(r.storage_key);
      if (id) out.push({ id, label: cleanFontLabel(r.title, r.filename) });
    }
    return out;
  } catch {
    return [];
  }
}
