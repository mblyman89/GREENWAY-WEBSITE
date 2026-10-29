/**
 * src/lib/inventory/coa-delivery-store.ts  (Fix Phase 3.1a)
 *
 * SERVER-ONLY. The receiving page's two COA tools for a delivery whose lines
 * have no lab result (owner, 2026: "didn't or couldn't attach the coa lab
 * results to the products in the receiving detail page. So I can't accept it
 * nor move it to onboarding"):
 *
 *   - readDeliveryCoas: read every certificate in the delivery's ARCHIVED lab
 *     documents (manifest_documents role "coa", plus any archived PDF whose
 *     own text reads as a certificate) with the same per-certificate reader
 *     the email intake uses (coa-bundle-core).
 *   - attachCertificateToLot: one certificate -> one lot. Reuses the lab
 *     result that already carries the EXACT lab test id (never a duplicate
 *     row), else inserts it with the one native row builder (source
 *     "emailed-coa-pdf"), then fills the lot's EMPTY lab_result_id with the
 *     guarded compare-and-set (never replaces a lab, never touches a
 *     destroyed lot). The lab PDF itself is filed under the new lab result.
 *
 * Nothing here decides a lot's status, quantity, cost or CCRS fields.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { downloadManifestDocs } from "@/lib/inventory/manifest-docs";
import { readCoaBundleFromBase64, readPdfLayer } from "@/lib/inventory/pdf-extract";
import { llamaParseRecoverText } from "@/lib/inbound-email/llamaparse-recovery";
import { archiveEmailedCoaForManifest } from "@/lib/inventory/coa-archive";
import { nativeLabRow, pickExistingLabs } from "@/lib/inventory/cultivera-wcia-core";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import {
  certificateToLab,
  looksLikeCertificate,
  uniqueDocLabels,
  type CoaCertificate,
  type CoaMatchBy,
} from "@/lib/inventory/coa-bundle-core";

export type DeliveryCoaRead = {
  certs: CoaCertificate[];
  /** label -> the document's base64 (to file the PDF under the lab result). */
  docs: Map<string, string>;
  /** Lab documents that yielded nothing, with the reason. */
  unread: { label: string; error: string | null }[];
};

const isPdf = (d: { contentType: string | null; filename: string }) =>
  (d.contentType ?? "").toLowerCase().includes("pdf") || d.filename.toLowerCase().endsWith(".pdf");

/**
 * Read every certificate in the delivery's archived lab documents. `recover`
 * (LlamaParse) is used only when the text layer leaves a certificate
 * unidentified. Never throws.
 */
export async function readDeliveryCoas(manifestId: string, opts: { recover?: boolean } = {}): Promise<DeliveryCoaRead> {
  const out: DeliveryCoaRead = { certs: [], docs: new Map(), unread: [] };
  let docs: Awaited<ReturnType<typeof downloadManifestDocs>> = [];
  try {
    docs = await downloadManifestDocs(manifestId);
  } catch {
    return out;
  }
  const pdfs = docs.filter(isPdf);
  const lab: typeof pdfs = [];
  for (const d of pdfs) {
    if (d.role === "coa") {
      lab.push(d);
      continue;
    }
    if (d.role !== "other") continue; // a manifest / invoice is never a lab document
    try {
      const layer = await readPdfLayer(d.bytes.slice());
      if (looksLikeCertificate(layer.text ?? "")) lab.push(d);
    } catch {
      /* unreadable: not a lab document we can use */
    }
  }
  const labels = uniqueDocLabels(lab.map((d) => d.filename));
  const reads = await Promise.all(
    lab.map(async (d, i) => {
      const b64 = Buffer.from(d.bytes).toString("base64");
      const read = await readCoaBundleFromBase64(b64, labels[i], opts.recover ? llamaParseRecoverText : undefined);
      return { label: labels[i], b64, read };
    }),
  );
  for (const r of reads) {
    out.docs.set(r.label, r.b64);
    if (r.read.certs.length === 0) out.unread.push({ label: r.label, error: r.read.error });
    out.certs.push(...r.read.certs);
  }
  return out;
}

export type AttachOutcome =
  | { ok: true; linked: boolean; labId: string; reused: boolean }
  | { ok: false; error: string };

/**
 * One certificate -> one lot (insert-or-reuse by exact lab test id, then the
 * guarded link). `linked=false` = the lot changed meanwhile (already has a
 * lab result, or destroyed) - nothing was replaced.
 */
export async function attachCertificateToLot(
  manifestId: string,
  lotId: string,
  cert: CoaCertificate,
  by: CoaMatchBy | "manual",
  evidence: string,
  actorId: string | null,
  docBase64: string | null,
): Promise<AttachOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const lab = certificateToLab(cert, by, evidence);
  const ext = lab.labtest_external_identifier;
  if (!ext) return { ok: false, error: "That certificate prints no lab test id; it cannot be attached safely." };
  const admin = createSupabaseAdminClient();

  // The lot must belong to THIS delivery (a stale or forged form never reaches another delivery).
  const { data: lotRow, error: lotErr } = await admin
    .from("inventory_lots")
    .select("id, manifest_id, lab_result_id, status")
    .eq("id", lotId)
    .maybeSingle();
  if (lotErr) return { ok: false, error: `The line could not be read: ${lotErr.message}` };
  const lot = lotRow as { id: string; manifest_id: string | null; lab_result_id: string | null; status: string | null } | null;
  if (!lot || lot.manifest_id !== manifestId) return { ok: false, error: "That line is not on this delivery." };
  if (lot.status === "destroyed") return { ok: false, error: "That line is destroyed; a lab result is never attached to it." };
  if (lot.lab_result_id) return { ok: true, linked: false, labId: lot.lab_result_id, reused: true };

  // Exact lab test id already on file = the same certificate: reuse it.
  const { data: existingRows, error: exErr } = await admin
    .from("lab_results")
    .select("id, labtest_external_identifier, created_at")
    .eq("labtest_external_identifier", ext);
  if (exErr) return { ok: false, error: `Lab results could not be read: ${exErr.message}` };
  const existing = pickExistingLabs(
    (existingRows as { id: string; labtest_external_identifier: string | null; created_at: string | null }[] | null) ?? [],
    [ext],
  );
  let labId = existing.get(ext) ?? null;
  const reused = labId !== null;
  if (!labId) {
    const row = nativeLabRow(lab, "pdf-manifest", actorId, { withJsonUrl: false });
    let { data, error } = await admin.from("lab_results").insert(row).select("id").single();
    if (error && isMissingColumnError(error) && "wcia_json_url" in row) {
      delete row.wcia_json_url;
      ({ data, error } = await admin.from("lab_results").insert(row).select("id").single());
    }
    labId = (data as { id: string } | null)?.id ?? null;
    if (error || !labId) return { ok: false, error: `The lab result could not be saved: ${error?.message ?? "no id returned"}` };
  }

  const { data: upd, error: updErr } = await admin
    .from("inventory_lots")
    .update({ lab_result_id: labId, updated_by: actorId })
    .eq("id", lotId)
    .neq("status", "destroyed")
    .is("lab_result_id", null)
    .select("id");
  if (updErr) return { ok: false, error: `The line could not be linked: ${updErr.message}` };
  const linked = ((upd as { id: string }[] | null) ?? []).length > 0;

  // File the lab PDF under this lab result (best-effort; never fails the attach).
  if (linked && docBase64) {
    try {
      await archiveEmailedCoaForManifest(manifestId, docBase64, [ext]);
    } catch {
      /* archive is best-effort */
    }
  }
  return { ok: true, linked, labId, reused };
}

/** Where each lab result came from (the COA cell's "matched by name - verify"). Never throws. */
export async function listLabProvenanceByIds(
  labIds: readonly string[],
): Promise<Map<string, { source: string | null; raw: unknown }>> {
  const out = new Map<string, { source: string | null; raw: unknown }>();
  if (!isSupabaseServiceConfigured || labIds.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const ids = [...new Set(labIds)];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin
        .from("lab_results")
        .select("id, source, raw_payload")
        .in("id", ids.slice(i, i + 200));
      for (const r of (data as { id: string; source: string | null; raw_payload: unknown }[] | null) ?? []) {
        out.set(r.id, { source: r.source, raw: r.raw_payload });
      }
    }
  } catch {
    /* provenance is a display hint only */
  }
  return out;
}
