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
 * merch.publish (owner & admin; D232, SOP-11 Q-11-1, Michael verbatim "Q1:
 * owner/admin."). Audited.
 */
import crypto from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { readObjectHead } from "@/lib/media/read-object-head";
import { HANDLE_RE, PRINT_KEY_RE, isListingPackage, printKey, stalePrintKeys, upsertItem, type MerchCatalogItem, type MerchItemStatus } from "@/lib/merch/merch-inventory-core";
import { updateMerchCatalog } from "@/lib/merch/merch-inventory-store";
import { PRINTFUL_MAX_SYNC_VARIANTS, type ListingPackage } from "@/lib/merch-studio/listing-package-core";
import { planPrintFiles } from "@/lib/merch-studio/print-export-core";
import { printHash, sampleGate, stableJson } from "@/lib/merch-studio/merch-design-sync-core";
import { readDesignRow } from "@/lib/merch-studio/merch-design-store";

const BUCKET = "media";
const MAX_FILES = 12;
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export type StartMerchPublishResult =
  | { ok: true; bucket: string; uploads: { key: string; token: string; fileKey: string }[] }
  | { ok: false; error: string };

export async function startMerchPublishAction(input: { handle: string; fileKeys: string[] }): Promise<StartMerchPublishResult> {
  await requirePermission("merch.publish");
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

/** D232 M-5: status = what the product is NOW (a Hidden product stays Hidden on re-publish, G-82); cleaned = old print PNGs deleted (G-93). */
export type PublishMerchResult = { ok: true; handle: string; created: boolean; status: MerchItemStatus; stockKept: boolean; cleaned: number } | { ok: false; error: string; sampleGate?: boolean };

/** Same print as the saved design? Compares what each print file IS (not its URL). */
const filesShape = (files: readonly { key: string; method: string; pxW: number; pxH: number; position: unknown }[]) =>
  stableJson([...files].map((f) => ({ key: f.key, method: f.method, pxW: f.pxW, pxH: f.pxH, position: f.position })).sort((a, b) => (a.key < b.key ? -1 : 1)));

async function sampleGateFor(pkg: ListingPackage, screenHash: string): Promise<{ ok: true; how: string; by: string | null; reason: string | null } | { ok: false; reason: string }> {
  const r = await readDesignRow(String(pkg.designId ?? ""));
  if (r.error) return { ok: false, reason: `Couldn't check the sample approval, so nothing was published: ${r.error}` };
  if (!r.row) return sampleGate(null, "");
  if (screenHash !== r.row.designHash || filesShape(planPrintFiles(r.row.design).plans) !== filesShape(pkg.printFiles)) {
    return { ok: false, reason: "The design on this screen is different from the saved one. Wait for \"Saved on the server\" in Design, then reload Publish." };
  }
  const g = sampleGate(r.row, printHash(r.row.design));
  return g.ok ? { ok: true, how: g.how, by: g.by, reason: g.reason } : g;
}

export async function publishMerchListingAction(input: { pkg: unknown; files: { fileKey: string; key: string }[]; images: string[]; designHash?: string }): Promise<PublishMerchResult> {
  const session = await requirePermission("merch.publish");
  if (!isSupabaseServiceConfigured || !supabaseUrl) return { ok: false, error: "Storage isn't configured on this deployment." };
  if (!isListingPackage(input?.pkg)) return { ok: false, error: "That listing isn't complete. Fix the blockers and try again." };
  const src = input.pkg as ListingPackage;
  if (src.variants.length > PRINTFUL_MAX_SYNC_VARIANTS) return { ok: false, error: `Too many colour/size combinations (max ${PRINTFUL_MAX_SYNC_VARIANTS}).` };
  const handle = src.product.handle;
  // D232 M-4 (G-81): the sample gate. The design must be saved on the server,
  // the print files must be the ones THAT saved design makes, and its sample
  // must be approved (or owner-overridden with a reason) for that exact print.
  const gate = await sampleGateFor(src, String(input?.designHash ?? ""));
  if (!gate.ok) return { ok: false, error: gate.reason, sampleGate: true };
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
  let prev: MerchCatalogItem | null = null;
  let item: MerchCatalogItem | null = null;
  const res = await updateMerchCatalog((c) => {
    const r = upsertItem(c, { pkg, images: Array.isArray(input.images) ? input.images.map(String) : [], byEmail: session.email ?? null, nowIso: new Date().toISOString() });
    if (!r.ok) return r.error;
    created = r.created;
    prev = r.prev;
    item = r.item;
    return r.catalog;
  });
  if (!res.ok) return res;
  const saved = item as MerchCatalogItem | null;
  const before = prev as MerchCatalogItem | null;
  // G-93: the new package is saved, so the previous print PNGs (old <nonce>
  // folder, merch-print/<handle>/ only) can go. Best effort; never fails the publish.
  const stale = saved ? stalePrintKeys(before, saved, publicBase) : [];
  let cleaned = 0;
  if (stale.length) {
    const rm = await createSupabaseAdminClient().storage.from(BUCKET).remove(stale).catch(() => null);
    cleaned = rm && !rm.error ? stale.length : 0;
  }
  const status: MerchItemStatus = saved?.status ?? "live";
  const stockKept = !!saved?.stockSyncedAt;
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: created ? "merch.product_published" : "merch.product_republished", entityType: "merch_product", entityId: handle, after: { title: pkg.product.title, variants: pkg.variants.length, designId: pkg.designId, status, stockKept, oldPrintFilesDeleted: cleaned, sample: gate.how, sampleBy: gate.by, sampleOverrideReason: gate.reason } });
  return { ok: true, handle, created, status, stockKept, cleaned };
}
