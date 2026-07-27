/**
 * src/lib/inventory/manifest-docs.ts  (SLICE 69)
 *
 * SERVER-ONLY. Archive EVERY document a vendor intake email carries into the
 * private `intake-docs` bucket, linked to the staged manifest via the
 * manifest_documents table (migration 0142). This is what makes the Incoming
 * (email) table's download buttons work for EVERY manifest, permanently —
 * the vendor's signed links expire within hours; our archived copies never do.
 *
 * Best-effort everywhere: an archive failure never fails staging (the draft
 * still lands for review); it just logs. Idempotent: the (manifest_id,
 * storage_path) unique key means re-sends upsert the same object.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { NormalizedAttachment } from "@/lib/inbound-email/inbound-normalize-core";
import { classifyAttachmentRole } from "@/lib/inbound-email/inbound-normalize-core";
import type { DocRole } from "@/lib/inbound-email/email-harvest-core";

const BUCKET = "intake-docs";

function safeName(s: string): string {
  const cleaned = s.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "document";
}

/** Map an attachment to its archive role (transfer JSON detected by shape). */
export function docRoleForAttachment(a: NormalizedAttachment): DocRole {
  const ct = (a.contentType ?? "").toLowerCase();
  const fn = (a.filename ?? "").toLowerCase();
  if (a.text != null && (ct.includes("json") || fn.endsWith(".json"))) {
    return "transfer-json";
  }
  const role = classifyAttachmentRole(a);
  return role === "unknown" ? "other" : role;
}

/**
 * Archive every attachment on a staged manifest's email. Returns how many
 * documents were stored. Never throws.
 */
export async function archiveManifestDocuments(
  manifestId: string,
  attachments: readonly NormalizedAttachment[],
  source: string,
): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  let stored = 0;
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    try {
      const bytes = a.base64
        ? Buffer.from(a.base64, "base64")
        : a.text != null
          ? Buffer.from(a.text, "utf8")
          : null;
      if (!bytes || bytes.byteLength === 0) continue;
      const role = docRoleForAttachment(a);
      const filename = safeName(a.filename ?? `document-${i + 1}`);
      const path = `${manifestId}/${String(i + 1).padStart(2, "0")}-${filename}`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: a.contentType ?? "application/octet-stream",
        upsert: true,
      });
      if (upErr) {
        console.warn(`[manifest-docs] upload failed for ${path}:`, upErr.message);
        continue;
      }
      const { error: rowErr } = await admin.from("manifest_documents").upsert(
        {
          manifest_id: manifestId,
          role,
          filename: a.filename ?? filename,
          content_type: a.contentType ?? null,
          storage_path: path,
          bytes: bytes.byteLength,
          source,
        },
        { onConflict: "manifest_id,storage_path" },
      );
      if (rowErr) {
        console.warn(`[manifest-docs] row upsert failed for ${path}:`, rowErr.message);
        continue;
      }
      stored += 1;
    } catch (err) {
      console.warn("[manifest-docs] archive skipped for one attachment:", err);
    }
  }
  return stored;
}

/** One archived document with a fresh signed download URL. */
export type ManifestDocLink = {
  role: DocRole;
  filename: string;
  url: string;
};

/**
 * Signed download URLs for every archived document across a set of manifests,
 * grouped by manifest id. One table read + one signing call per document.
 * Never throws; missing/failed rows are simply absent.
 */
export async function listManifestDocLinks(
  manifestIds: readonly string[],
  expiresInSeconds = 3600,
): Promise<Map<string, ManifestDocLink[]>> {
  const out = new Map<string, ManifestDocLink[]>();
  if (!isSupabaseServiceConfigured || manifestIds.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("manifest_documents")
      .select("manifest_id, role, filename, storage_path")
      .in("manifest_id", manifestIds as string[])
      .order("created_at", { ascending: true });
    if (error || !data) return out;
    const rows = data as {
      manifest_id: string;
      role: DocRole;
      filename: string;
      storage_path: string;
    }[];
    if (rows.length === 0) return out;
    // ONE batch signing call for every document (not one call per file).
    const { data: signedList } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        expiresInSeconds,
      );
    const urlByPath = new Map<string, string>();
    for (const s of signedList ?? []) {
      if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl);
    }
    for (const row of rows) {
      const url = urlByPath.get(row.storage_path);
      if (!url) continue;
      const list = out.get(row.manifest_id) ?? [];
      list.push({ role: row.role, filename: row.filename, url });
      out.set(row.manifest_id, list);
    }
  } catch (err) {
    console.error("[manifest-docs] listManifestDocLinks failed:", err);
  }
  return out;
}
