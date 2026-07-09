/**
 * src/lib/inventory/coa-archive.ts
 *
 * POS Slice 9 — download each COA PDF and archive it in the private `coa`
 * storage bucket so we keep the certificates on hand as part of our records
 * (LCB enforcement can ask to see them), independent of the vendor's link.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { cleanUrl } from "@/lib/inventory/intake-parser";

const COA_BUCKET = "coa";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024; // COA PDFs are small; 25MB is generous.

/** Mint a short-lived signed URL for an archived COA PDF. */
export async function signedCoaUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(COA_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
}

/**
 * Download a single COA PDF from its URL and upload it to the `coa` bucket.
 * Returns the storage path + size on success. Best-effort: never throws.
 */
async function archiveOneCoa(
  labId: string,
  coaUrl: string,
  externalId: string | null,
): Promise<{ path: string; bytes: number } | null> {
  const cleaned = cleanUrl(coaUrl);
  if (!cleaned) return null;

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/pdf,*/*" },
      cache: "no-store",
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  if (!res.ok) return null;

  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return null;

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }
  const bytes = buf.byteLength;
  if (bytes === 0 || bytes > MAX_BYTES) return null;

  // Path: coa/<labId>/<externalId-or-lab>.pdf — stable + collision-free.
  const base = safeName(externalId ?? labId);
  const path = `${labId}/${base}.pdf`;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage
    .from(COA_BUCKET)
    .upload(path, Buffer.from(buf), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) return null;

  return { path, bytes };
}

/**
 * Archive every COA PDF for the lab results attached to a manifest's lots that
 * has a coa_url but isn't archived yet. Best-effort, idempotent (upsert).
 * Returns how many were archived this pass.
 */
export async function archiveCoasForManifest(manifestId: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();

  // Find the distinct lab_results referenced by this manifest's lots.
  const { data: lotRows } = await admin
    .from("inventory_lots")
    .select("lab_result_id")
    .eq("manifest_id", manifestId)
    .not("lab_result_id", "is", null);
  const labIds = Array.from(
    new Set(
      ((lotRows as { lab_result_id: string | null }[] | null) ?? [])
        .map((r) => r.lab_result_id)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  if (labIds.length === 0) return 0;

  const { data: labs } = await admin
    .from("lab_results")
    .select("id, labtest_external_identifier, coa_url, coa_storage_path")
    .in("id", labIds);
  const rows =
    (labs as
      | {
          id: string;
          labtest_external_identifier: string | null;
          coa_url: string | null;
          coa_storage_path: string | null;
        }[]
      | null) ?? [];

  let archived = 0;
  for (const lab of rows) {
    if (lab.coa_storage_path) continue; // already archived
    if (!lab.coa_url) continue;
    const result = await archiveOneCoa(lab.id, lab.coa_url, lab.labtest_external_identifier);
    if (!result) continue;
    await admin
      .from("lab_results")
      .update({
        coa_storage_path: result.path,
        coa_file_bytes: result.bytes,
        coa_archived_at: new Date().toISOString(),
      })
      .eq("id", lab.id);
    archived += 1;
  }
  return archived;
}

/**
 * H16b-2: archive a COA PDF that arrived as an EMAIL ATTACHMENT (bytes, no
 * external URL). `archiveCoasForManifest` above can only re-download a COA from
 * a `coa_url`; a bundled COA Summary PDF has none (its ParsedLab.coa_url is
 * null), so its potency is merged but the certificate itself would otherwise be
 * discarded. This uploads the raw bytes once to the private `coa` bucket and
 * links it to every lab_result on the manifest that is not yet archived and has
 * no coa_url (the emailed-only case) so LCB enforcement can always see the
 * certificate we relied on.
 *
 * Best-effort + idempotent: a lab row that is already archived is skipped, and
 * re-running upserts the same object. Never throws.
 */
export async function archiveEmailedCoaForManifest(
  manifestId: string,
  base64: string,
): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  if (!base64 || typeof base64 !== "string") return 0;

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return 0;
  }
  const bytes = buf.byteLength;
  if (bytes === 0 || bytes > MAX_BYTES) return 0;

  const admin = createSupabaseAdminClient();

  // The distinct lab_results referenced by this manifest's lots.
  const { data: lotRows } = await admin
    .from("inventory_lots")
    .select("lab_result_id")
    .eq("manifest_id", manifestId)
    .not("lab_result_id", "is", null);
  const labIds = Array.from(
    new Set(
      ((lotRows as { lab_result_id: string | null }[] | null) ?? [])
        .map((r) => r.lab_result_id)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  if (labIds.length === 0) return 0;

  const { data: labs } = await admin
    .from("lab_results")
    .select("id, labtest_external_identifier, coa_url, coa_storage_path")
    .in("id", labIds);
  const rows =
    (labs as
      | {
          id: string;
          labtest_external_identifier: string | null;
          coa_url: string | null;
          coa_storage_path: string | null;
        }[]
      | null) ?? [];

  let archived = 0;
  for (const lab of rows) {
    if (lab.coa_storage_path) continue; // already archived (this pass or a prior)
    // Only own the emailed-only case: a lab row that has a real coa_url is left
    // to archiveCoasForManifest so we keep the vendor's canonical certificate.
    if (lab.coa_url) continue;

    const base = safeName(lab.labtest_external_identifier ?? lab.id);
    const path = `${lab.id}/${base}.pdf`;
    const { error: upErr } = await admin.storage
      .from(COA_BUCKET)
      .upload(path, buf, { contentType: "application/pdf", upsert: true });
    if (upErr) continue;

    await admin
      .from("lab_results")
      .update({
        coa_storage_path: path,
        coa_file_bytes: bytes,
        coa_archived_at: new Date().toISOString(),
      })
      .eq("id", lab.id);
    archived += 1;
  }
  return archived;
}
