/**
 * src/lib/inventory/lot-coa-manual-store.ts  (D207d)
 *
 * SERVER-ONLY. The lot page's "Attach the COA document" box: a pasted COA link
 * (Google Drive / Dropbox / a lab link) or an uploaded PDF -> the certificate
 * for THIS lot -> a lab result linked with the guarded fill-only write.
 *
 *   - The link is fetched by hand, one redirect hop at a time; every hop must
 *     be a public https/http host whose every DNS answer is a public address
 *     (an SSRF guard: a link can never bounce the server onto 10.x, 169.254.x
 *     or localhost). 20 s, 25 MB, and the bytes must start with %PDF-.
 *   - The certificate is read by the same reader the email intake uses
 *     (readCoaBundleFromBase64, LlamaParse recovery for scanned PDFs).
 *   - Works for a lot with or without a delivery (one-off lots).
 *   - Reuses the lab result that already carries the EXACT lab test id, else
 *     inserts it with the one native row builder; then fills the lot's EMPTY
 *     lab_result_id (never replaces one, never a destroyed lot). The PDF is
 *     archived under the lab result when it has no archived copy yet.
 *
 * Never throws; every failure is a sentence.
 */
import "server-only";
import { lookup } from "node:dns/promises";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readCoaBundleFromBase64 } from "@/lib/inventory/pdf-extract";
import { llamaParseRecoverText } from "@/lib/inbound-email/llamaparse-recovery";
import { nativeLabRow, pickExistingLabs } from "@/lib/inventory/cultivera-wcia-core";
import { dnsAnswerOk, isMissingColumnError, looksLikePdf } from "@/lib/inventory/coa-extract-core";
import { publicUrl } from "@/lib/inventory/coa-gmail-deep-core";
import { certificateToLab, type CoaLotRow } from "@/lib/inventory/coa-bundle-core";
import { MANUAL_COA_MAX_BYTES, manualAttachNote, pickCertificateForLot } from "@/lib/inventory/lot-coa-manual-core";

const COA_BUCKET = "coa";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_HOPS = 6;

export type ManualFetch = (url: string) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>;
export type ManualResolve = (host: string) => Promise<string[]>;

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Fetch a pasted COA link: every hop public, bounded, must be a PDF. */
export async function fetchManualCoaPdf(
  url: string,
  deps: { fetchImpl?: typeof fetch; resolve?: ManualResolve } = {},
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const f = deps.fetchImpl ?? fetch;
  const resolve: ManualResolve = deps.resolve ?? (async (h) => (await lookup(h, { all: true, verbatim: true })).map((a) => a.address));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const u = publicUrl(current);
      if (!u) return { ok: false, error: `The link went to a non-public address (${current.slice(0, 80)}); it was not followed.` };
      let addrs: string[];
      try {
        addrs = await resolve(u.hostname);
      } catch (e) {
        return { ok: false, error: `${u.hostname} could not be found (${short(e)}).` };
      }
      const dns = dnsAnswerOk(u.hostname, addrs);
      if (!dns.ok) return { ok: false, error: dns.reason };
      const res = await f(u.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "application/pdf, application/octet-stream, */*", "User-Agent": "Mozilla/5.0 (GreenwayCOA)" },
        cache: "no-store",
      });
      if (res.status >= 300 && res.status <= 399) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, error: "The link redirected without saying where." };
        if (hop === MAX_HOPS) return { ok: false, error: "The link redirected too many times." };
        current = new URL(loc, u).toString();
        continue;
      }
      if (res.status === 401 || res.status === 403)
        return { ok: false, error: "The link needs a sign-in. In Google Drive set the file to \"Anyone with the link\" (Share -> General access), or download the PDF and upload it here." };
      if (!res.ok) return { ok: false, error: `The link answered HTTP ${res.status}.` };
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > MANUAL_COA_MAX_BYTES) return { ok: false, error: "The file is larger than 25 MB." };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MANUAL_COA_MAX_BYTES) return { ok: false, error: "The file is larger than 25 MB." };
      if (!looksLikePdf(bytes)) {
        const ct = res.headers.get("content-type") ?? "";
        return {
          ok: false,
          error: /html/i.test(ct)
            ? "The link opened a web page, not the PDF. If it is a Google Drive link, set the file to \"Anyone with the link\"; or download the PDF and upload it here."
            : "The link did not return a PDF.",
        };
      }
      return { ok: true, bytes };
    }
    return { ok: false, error: "The link redirected too many times." };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "The link took too long to answer (20 s)." : `The link could not be read (${short(e)}).` };
  } finally {
    clearTimeout(timer);
  }
}

export type ManualAttachResult =
  | { ok: true; labId: string; labtestId: string; reused: boolean; archived: boolean; by: string; note: string }
  | { ok: false; error: string };

export type ManualAttachDeps = {
  admin?: ReturnType<typeof createSupabaseAdminClient>;
  /** Tests inject the reader (the real one parses the PDF). */
  readPdf?: typeof readCoaBundleFromBase64;
};

/** Read the PDF, pick this lot's certificate, attach (fill only), archive. Never throws. */
export async function attachCoaDocumentToLot(
  lotId: string,
  bytes: Uint8Array,
  docLabel: string,
  actorId: string | null,
  deps: ManualAttachDeps = {},
): Promise<ManualAttachResult> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const { data: lotRow, error: lotErr } = await admin
      .from("inventory_lots")
      .select("id, product_name, lot_code, pos_product_key, strain_name, lab_result_id, status")
      .eq("id", lotId)
      .maybeSingle();
    if (lotErr) return { ok: false, error: `The lot could not be read: ${lotErr.message}` };
    if (!lotRow) return { ok: false, error: "That lot no longer exists." };
    const lot = lotRow as CoaLotRow;

    const b64 = Buffer.from(bytes).toString("base64");
    const read = await (deps.readPdf ?? readCoaBundleFromBase64)(b64, docLabel, llamaParseRecoverText);
    if (read.certs.length === 0) return { ok: false, error: read.error ?? "No lab certificate could be read from that PDF." };
    const pick = pickCertificateForLot(read.certs, lot);
    if (!pick.ok) return pick;

    const lab = certificateToLab(pick.cert, pick.by, pick.evidence);
    const ext = lab.labtest_external_identifier;
    if (!ext) return { ok: false, error: "That certificate prints no lab test id; it cannot be attached safely." };

    const { data: existingRows, error: exErr } = await admin.from("lab_results").select("id, labtest_external_identifier, created_at").eq("labtest_external_identifier", ext);
    if (exErr) return { ok: false, error: `Lab results could not be read: ${exErr.message}` };
    let labId = pickExistingLabs((existingRows as { id: string; labtest_external_identifier: string | null; created_at: string | null }[] | null) ?? [], [ext]).get(ext) ?? null;
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
    if (updErr) return { ok: false, error: `The lot could not be linked: ${updErr.message}` };
    if (((upd as { id: string }[] | null) ?? []).length === 0) return { ok: false, error: "The lot changed while this ran (it now has a lab result or was destroyed); nothing was replaced." };

    // Archive the PDF under the lab result when it has no archived copy (best-effort).
    let archived = false;
    try {
      const { data: labRow } = await admin.from("lab_results").select("id, coa_storage_path").eq("id", labId).maybeSingle();
      if (labRow && !(labRow as { coa_storage_path: string | null }).coa_storage_path) {
        const path = `${labId}/${ext.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80)}.pdf`;
        const up = await admin.storage.from(COA_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
        if (!up.error) {
          const { error: e2 } = await admin
            .from("lab_results")
            .update({ coa_storage_path: path, coa_file_bytes: bytes.byteLength, coa_archived_at: new Date().toISOString() })
            .eq("id", labId)
            .is("coa_storage_path", null);
          archived = !e2;
        }
      }
    } catch {
      /* the archive is best-effort; the link already stands */
    }
    return { ok: true, labId, labtestId: ext, reused, archived, by: pick.by, note: manualAttachNote(pick.cert, pick.by, reused) };
  } catch (e) {
    return { ok: false, error: `The COA could not be attached (${short(e)}).` };
  }
}
