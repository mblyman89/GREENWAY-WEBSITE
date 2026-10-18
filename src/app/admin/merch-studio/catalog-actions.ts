"use server";
/**
 * R73 S7 - Merch Studio "Publish to greenwaymerch.com".
 *
 *   startMerchPublishAction   one-time signed upload tokens for the finished
 *                             print PNGs, under merch-print/<handle>/<nonce>/
 *                             in the PUBLIC `media` bucket (migration 0012).
 *                             Printful must fetch them when an order is placed,
 *                             so they need a stable URL (signed URLs expire).
 *   publishMerchListingAction proves each upload is a PNG, writes the public
 *                             URLs into the listing package and saves it to the
 *                             merch catalog (site_settings, no migration). The
 *                             item is now on /admin/inventory/merch and, within
 *                             about a minute, on greenwaymerch.com.
 *
 * Nothing here renders on the cannabis website (owner rule R71). Permission:
 * content.edit (same as the studio). Audited.
 */
import crypto from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { readObjectHead } from "@/lib/media/read-object-head";
import { HANDLE_RE, PRINT_KEY_RE, isListingPackage, printKey, upsertItem } from "@/lib/merch/merch-inventory-core";
import { updateMerchCatalog } from "@/lib/merch/merch-inventory-store";
import { PRINTFUL_MAX_SYNC_VARIANTS, type ListingPackage } from "@/lib/merch-studio/listing-package-core";

const BUCKET = "media";
const MAX_FILES = 12;
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export type StartMerchPublishResult =
  | { ok: true; bucket: string; uploads: { key: string; token: string; fileKey: string }[] }
  | { ok: false; error: string };

export async function startMerchPublishAction(input: { handle: string; fileKeys: string[] }): Promise<StartMerchPublishResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const handle = String(input?.handle ?? "");
  if (!HANDLE_RE.test(handle)) return { ok: false, error: "Give the product a title first (it becomes the web address)." };
  const fileKeys = (Array.isArray(input?.fileKeys) ? input.fileKeys : []).map(String).slice(0, MAX_FILES);
  if (!fileKeys.length) return { ok: false, error: "The design has nothing to print." };
  const nonce = crypto.randomBytes(6).toString("hex");
  const bucket = createSupabaseAdminClient().storage.from(BUCKET);
  const uploads: { key: string; token: string; fileKey: string }[] = [];
  for (const fileKey of fileKeys) {
    const key = printKey(handle, nonce, fileKey);
    if (!key) return { ok: false, error: "Invalid print file name." };
    const signed = await bucket.createSignedUploadUrl(key);
    if (signed.error || !signed.data?.token) return { ok: false, error: `Storage refused the upload: ${signed.error?.message ?? "no token"}.` };
    uploads.push({ key, token: signed.data.token, fileKey });
  }
  return { ok: true, bucket: BUCKET, uploads };
}

export type PublishMerchResult = { ok: true; handle: string; created: boolean } | { ok: false; error: string };

export async function publishMerchListingAction(input: { pkg: unknown; files: { fileKey: string; key: string }[]; images: string[] }): Promise<PublishMerchResult> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured || !supabaseUrl) return { ok: false, error: "Storage isn't configured on this deployment." };
  if (!isListingPackage(input?.pkg)) return { ok: false, error: "That listing isn't complete. Fix the blockers and try again." };
  const src = input.pkg as ListingPackage;
  if (src.variants.length > PRINTFUL_MAX_SYNC_VARIANTS) return { ok: false, error: `Too many colour/size combinations (max ${PRINTFUL_MAX_SYNC_VARIANTS}).` };
  const handle = src.product.handle;
  const publicBase = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}`;

  // Every print file must be one of OUR uploads for THIS product, and really a PNG.
  const urlFor = new Map<string, string>();
  for (const f of (Array.isArray(input.files) ? input.files : []).slice(0, MAX_FILES)) {
    const key = String(f?.key ?? "");
    if (!PRINT_KEY_RE.test(key) || !key.startsWith(`merch-print/${handle}/`)) return { ok: false, error: "Invalid print file reference." };
    const sig = await readObjectHead(BUCKET, key, 8);
    if (!sig || sig.length < 8 || !PNG_SIG.every((v, i) => sig[i] === v)) return { ok: false, error: "A print file didn't arrive in Storage as a PNG. Publish again." };
    urlFor.set(String(f.fileKey), `${publicBase}/${key}`);
  }
  const printFiles = src.printFiles.map((p) => ({ ...p, url: urlFor.get(p.key) ?? "" }));
  if (!printFiles.length || printFiles.some((p) => !p.url)) return { ok: false, error: "Some print files are missing. Publish again." };
  const byType = new Map(printFiles.map((p) => [p.fileType, p.url]));
  const pkg: ListingPackage = {
    ...src,
    printFiles,
    printfulOrderItem: { ...src.printfulOrderItem, files: src.printfulOrderItem.files.map((f) => ({ ...f, url: byType.get(f.type) ?? f.url })) },
    printfulSyncProduct: { ...src.printfulSyncProduct, sync_variants: src.printfulSyncProduct.sync_variants.map((sv) => ({ ...sv, files: sv.files.map((f) => ({ ...f, url: byType.get(f.type) ?? f.url })) })) },
  };
  if (pkg.printfulOrderItem.files.some((f) => !f.url)) return { ok: false, error: "A print placement has no file. Publish again." };

  let created = false;
  const res = await updateMerchCatalog((c) => {
    const r = upsertItem(c, { pkg, images: Array.isArray(input.images) ? input.images.map(String) : [], byEmail: session.email ?? null, nowIso: new Date().toISOString() });
    if (!r.ok) return r.error;
    created = r.created;
    return r.catalog;
  });
  if (!res.ok) return res;
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: created ? "merch.product_published" : "merch.product_republished", entityType: "merch_product", entityId: handle, after: { title: pkg.product.title, variants: pkg.variants.length, designId: pkg.designId } });
  return { ok: true, handle, created };
}
