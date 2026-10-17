"use server";
/**
 * R71 S3 - Merch Studio "Proof & Export" server actions.
 *
 *   startPrintFileUploadsAction  one-time signed upload tokens for the private
 *                                `merch-files` bucket (migration 0281). The
 *                                browser PUTs the finished PNGs straight to
 *                                Storage (Vercel's 4.5 MB body cap never applies).
 *   createMockupTaskAction       verifies each upload is a PNG, signs a 1-hour
 *                                download URL per file and asks Printful's
 *                                mockup generator for photo mockups.
 *   getMockupTaskAction          polls the task (Printful: pending|completed|failed).
 *
 * Fail closed: no Supabase service role -> no uploads; no PRINTFUL_API_TOKEN ->
 * a plain-English "not connected" message and nothing is sent.
 * Permission: content.edit (same as the studio page).
 */
import crypto from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readObjectHead } from "@/lib/media/read-object-head";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { getBlank } from "@/lib/merch-studio/garment-catalog-core";
import { PRINTFUL_VARIANTS } from "@/lib/merch-studio/garment-colors-data";

const BUCKET = "merch-files";
const KEY_RE = /^print\/[a-z0-9-]{1,48}\/[a-f0-9]{12}\/[a-z0-9_-]{1,60}\.png$/;
const MAX_FILES = 12;

export type StartUploadsResult =
  | { ok: true; bucket: string; uploads: { key: string; token: string; fileKey: string }[] }
  | { ok: false; error: string };

function slugPart(s: string, max: number): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "design";
}

export async function startPrintFileUploadsAction(input: { designId: string; files: { fileKey: string }[] }): Promise<StartUploadsResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const files = Array.isArray(input?.files) ? input.files.slice(0, MAX_FILES) : [];
  if (!files.length) return { ok: false, error: "Nothing to upload." };
  const batch = crypto.randomBytes(6).toString("hex");
  const design = slugPart(input?.designId, 48);
  const admin = createSupabaseAdminClient();
  const uploads: { key: string; token: string; fileKey: string }[] = [];
  for (const f of files) {
    const fk = slugPart(f?.fileKey ?? "", 60).replace(/-/g, "_");
    const key = `print/${design}/${batch}/${fk}.png`;
    if (!KEY_RE.test(key)) return { ok: false, error: "Invalid file name." };
    const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(key);
    if (signed.error || !signed.data?.token) {
      const m = signed.error?.message ?? "no token";
      return { ok: false, error: /not found|bucket/i.test(m) ? "The private 'merch-files' bucket doesn't exist yet - apply migration 0281_merch_print_files_bucket.sql in Supabase." : `Storage refused the upload: ${m}.` };
    }
    uploads.push({ key, token: signed.data.token, fileKey: String(f.fileKey) });
  }
  return { ok: true, bucket: BUCKET, uploads };
}

export type MockupTaskResult = { ok: true; taskKey: string } | { ok: false; error: string; notConfigured?: boolean };

interface MockupFileIn { placement: string; key: string; position: { area_width: number; area_height: number; width: number; height: number; top: number; left: number } }

export async function createMockupTaskAction(input: { blankId: string; variantIds: number[]; files: MockupFileIn[]; productOptions?: Record<string, unknown> }): Promise<MockupTaskResult> {
  const session = await requirePermission("content.edit");
  if (!printfulConfigured()) return { ok: false, notConfigured: true, error: "Printful isn't connected yet. Add PRINTFUL_API_TOKEN (Greenway Merchandising LLC's Printful account) in Vercel, then try again. Until then use the studio's own previews." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const b = getBlank(String(input?.blankId ?? ""));
  if (!b) return { ok: false, error: "Unknown garment." };
  const known = new Set((PRINTFUL_VARIANTS[b.printfulId] ?? []).map((v) => v[2]));
  const variantIds = (Array.isArray(input?.variantIds) ? input.variantIds : []).map(Number).filter((v) => known.has(v)).slice(0, 6);
  if (!variantIds.length) return { ok: false, error: "No valid colours picked for mockups." };
  const filesIn = (Array.isArray(input?.files) ? input.files : []).slice(0, MAX_FILES);
  if (!filesIn.length) return { ok: false, error: "Export the print files first." };

  const admin = createSupabaseAdminClient();
  const files: { placement: string; image_url: string; position: MockupFileIn["position"] }[] = [];
  for (const f of filesIn) {
    const key = String(f?.key ?? "");
    if (!KEY_RE.test(key)) return { ok: false, error: "Invalid file reference." };
    // Prove it's really a PNG before Printful sees it.
    const sig = await readObjectHead(BUCKET, key, 8);
    if (!sig || sig.length < 8) return { ok: false, error: "A print file didn't arrive in Storage. Export again." };
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => sig[i] === v)) return { ok: false, error: "A stored print file isn't a PNG." };
    const signed = await admin.storage.from(BUCKET).createSignedUrl(key, 3600);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, error: `Couldn't sign a download link: ${signed.error?.message ?? "unknown"}.` };
    const p = f.position;
    const int = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));
    files.push({ placement: String(f.placement).slice(0, 60), image_url: signed.data.signedUrl, position: { area_width: int(p?.area_width), area_height: int(p?.area_height), width: int(p?.width), height: int(p?.height), top: int(p?.top), left: int(p?.left) } });
  }
  const body: Record<string, unknown> = { variant_ids: variantIds, format: "jpg", width: 1000, files };
  if (input?.productOptions && typeof input.productOptions === "object") body.product_options = input.productOptions;
  const r = await printful<{ task_key: string; status: string }>("POST", `/mockup-generator/create-task/${b.printfulId}`, body);
  if (!r.ok) return { ok: false, error: r.status === 429 ? "Printful's mockup limit was hit (2 per minute for new stores, 10 for established). Wait a minute and try again." : r.error };
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "merch.mockup_requested", entityType: "merch_design", entityId: b.id, after: { product: b.printfulId, variantIds, placements: files.map((f) => f.placement) } });
  return { ok: true, taskKey: r.result.task_key };
}

export type MockupPollResult =
  | { ok: true; status: "pending" | "completed" | "failed"; error?: string; mockups: { placement: string; variantIds: number[]; url: string; extra: { title: string; url: string }[] }[] }
  | { ok: false; error: string };

export async function getMockupTaskAction(taskKey: string): Promise<MockupPollResult> {
  await requirePermission("content.edit");
  const key = String(taskKey ?? "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) return { ok: false, error: "Invalid task." };
  const r = await printful<{ status: "pending" | "completed" | "failed"; error?: string; mockups?: { placement: string; variant_ids: number[]; mockup_url: string; extra?: { title?: string; url?: string }[] }[] }>("GET", `/mockup-generator/task?task_key=${encodeURIComponent(key)}`);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true, status: r.result.status, error: r.result.error,
    mockups: (r.result.mockups ?? []).map((m) => ({ placement: m.placement, variantIds: m.variant_ids ?? [], url: m.mockup_url, extra: (m.extra ?? []).filter((x) => x.url).map((x) => ({ title: x.title ?? "", url: x.url! })) })),
  };
}
