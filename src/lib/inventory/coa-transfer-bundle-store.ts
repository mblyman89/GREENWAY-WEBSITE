/**
 * src/lib/inventory/coa-transfer-bundle-store.ts  (D214)
 *
 * SERVER-ONLY. "Attach all COAs from the vendor's transfer" on a delivery page.
 *
 *   1. The delivery's kept WCIA transfer (src/data/wcia-transfers) is parsed by
 *      the one native parser (parseVendorJson).
 *   2. Every lot of the delivery is read in full (paged, honest verdict: a short
 *      read attaches nothing).
 *   3. planTransferCoaAttach: line inventory id === lot code, exactly; lots
 *      with a lab result / destroyed / ambiguous are left alone.
 *   4. Each distinct certificate link is fetched with the guarded fetcher the
 *      lot page uses (fetchManualCoaPdf: every hop a public host, 20 s, 25 MB,
 *      must be a PDF) and read with the same certificate reader. Exactly one
 *      certificate with a lab test id, or nothing is attached from that link.
 *   5. The lab result is reused by its EXACT lab test id or inserted with the
 *      one native row builder; each lot's EMPTY lab_result_id is filled with the
 *      guarded compare-and-set (never replaces one, never a destroyed lot); the
 *      PDF is archived under the lab result when it has no archived copy.
 *
 * Never throws; every failure is reported per lot.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { readCoaBundleFromBase64 } from "@/lib/inventory/pdf-extract";
import { llamaParseRecoverText } from "@/lib/inbound-email/llamaparse-recovery";
import { nativeLabRow, pickExistingLabs } from "@/lib/inventory/cultivera-wcia-core";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import { certificateToLab, type CoaCertificate } from "@/lib/inventory/coa-bundle-core";
import { fetchManualCoaPdf } from "@/lib/inventory/lot-coa-manual-store";
import { keptTransferText } from "@/data/wcia-transfers";
import {
  certificateForLink,
  planTransferCoaAttach,
  type BundleLot,
  type TransferCoaResult,
} from "@/lib/inventory/coa-transfer-bundle-core";

const COA_BUCKET = "coa";
const LINK_CONCURRENCY = 3;
const short = (e: unknown) =>
  (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 160);

/** Is there a kept transfer for this delivery number? (The page shows the button only then.) */
export function hasKeptTransfer(manifestNumber: string | null | undefined): boolean {
  return keptTransferText(manifestNumber) !== null;
}

export type TransferCoaOutcome =
  | { ok: true; result: TransferCoaResult; linkedLotIds: { lotId: string; lotCode: string; labId: string; labtestId: string; reused: boolean }[] }
  | { ok: false; error: string };

type LinkRead = { ok: true; cert: CoaCertificate; labId: string; bytes: Uint8Array } | { ok: false; error: string };

async function readLink(url: string): Promise<LinkRead> {
  const got = await fetchManualCoaPdf(url);
  if (!got.ok) return { ok: false, error: got.error };
  const label = decodeURIComponent(url.split("/").pop() ?? "COA.pdf").slice(0, 120);
  const read = await readCoaBundleFromBase64(Buffer.from(got.bytes).toString("base64"), label, llamaParseRecoverText);
  if (read.certs.length === 0) return { ok: false, error: read.error ?? "no certificate could be read from it" };
  const pick = certificateForLink(read.certs);
  if (!pick.ok) return pick;
  return { ok: true, cert: pick.cert, labId: pick.labId, bytes: got.bytes };
}

export async function attachTransferCoasForManifest(manifestId: string, actorId: string | null): Promise<TransferCoaOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data: m, error: mErr } = await admin.from("inbound_manifests").select("id, manifest_number").eq("id", manifestId).maybeSingle();
    if (mErr) return { ok: false, error: `The delivery could not be read: ${mErr.message}` };
    if (!m) return { ok: false, error: "That delivery no longer exists." };
    const number = (m as { manifest_number: string | null }).manifest_number;
    const text = keptTransferText(number);
    if (!text) return { ok: false, error: `No vendor transfer file is kept for ${number ?? "this delivery"}.` };
    const parsed = parseVendorJson(text);
    if (!parsed.ok) return { ok: false, error: `The kept transfer file could not be read: ${parsed.error}` };
    if ((parsed.manifest.manifest_number ?? "").trim() !== (number ?? "").trim())
      return { ok: false, error: `The kept transfer file is for ${parsed.manifest.manifest_number}, not ${number}; nothing was attached.` };

    const lotsRead = await pagedAllChecked<BundleLot>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, lot_code, status, lab_result_id, product_name")
        .eq("manifest_id", manifestId)
        .order("id", { ascending: true })
        .range(from, to);
      return { ok: !error, rows: (data as BundleLot[] | null) ?? [] };
    });
    if (!lotsRead.verdict.complete) return { ok: false, error: `The delivery's lots could not be read in full; nothing was attached (${lotsRead.verdict.message}).` };

    const plan = planTransferCoaAttach(lotsRead.rows, parsed.manifest.lines);
    const result: TransferCoaResult = { attached: 0, created: 0, reused: 0, archived: 0, changedMeanwhile: 0, failedLots: [], skipped: plan.skipped };
    const linked: { lotId: string; lotCode: string; labId: string; labtestId: string; reused: boolean }[] = [];
    if (plan.jobs.length === 0) return { ok: true, result, linkedLotIds: linked };

    // Read every distinct certificate link (a few at a time).
    const reads = new Map<string, LinkRead>();
    for (let i = 0; i < plan.links.length; i += LINK_CONCURRENCY) {
      const batch = plan.links.slice(i, i + LINK_CONCURRENCY);
      const outs = await Promise.all(batch.map((u) => readLink(u).catch((e): LinkRead => ({ ok: false, error: short(e) }))));
      batch.forEach((u, k) => reads.set(u, outs[k]));
    }

    // Exact lab test ids already on file are the same certificate: reuse.
    const ids = [...new Set([...reads.values()].filter((r): r is Extract<LinkRead, { ok: true }> => r.ok).map((r) => r.labId))];
    const existing = new Map<string, string>();
    if (ids.length > 0) {
      const { data, error } = await admin.from("lab_results").select("id, labtest_external_identifier, created_at").in("labtest_external_identifier", ids);
      if (error) return { ok: false, error: `Lab results could not be read; nothing was attached: ${error.message}` };
      for (const [k, v] of pickExistingLabs((data as { id: string; labtest_external_identifier: string | null; created_at: string | null }[] | null) ?? [], ids)) existing.set(k, v);
    }

    const labIdByUrl = new Map<string, { id: string; labtestId: string; reused: boolean } | { error: string }>();
    for (const url of plan.links) {
      const r = reads.get(url);
      if (!r || !r.ok) {
        labIdByUrl.set(url, { error: r ? r.error : "not read" });
        continue;
      }
      const reuse = existing.get(r.labId);
      if (reuse) {
        labIdByUrl.set(url, { id: reuse, labtestId: r.labId, reused: true });
        result.reused += 1;
        continue;
      }
      const lab = certificateToLab(r.cert, "manual", `the vendor's transfer ${number} links this certificate to the line`);
      lab.coa_url = url;
      lab.raw = { ...(lab.raw as Record<string, unknown>), source: "wcia-transfer", coa_link: url, transfer: number };
      const row = nativeLabRow(lab, "wcia", actorId, { withJsonUrl: false });
      let { data, error } = await admin.from("lab_results").insert(row).select("id").single();
      if (error && isMissingColumnError(error) && "wcia_json_url" in row) {
        delete row.wcia_json_url;
        ({ data, error } = await admin.from("lab_results").insert(row).select("id").single());
      }
      const id = (data as { id: string } | null)?.id ?? null;
      if (error || !id) {
        labIdByUrl.set(url, { error: `the lab result could not be saved (${short(error ?? "no id returned")})` });
        continue;
      }
      existing.set(r.labId, id);
      labIdByUrl.set(url, { id, labtestId: r.labId, reused: false });
      result.created += 1;

      // Archive the certificate PDF under its lab result (best-effort).
      try {
        const path = `${id}/${r.labId.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80)}.pdf`;
        const up = await admin.storage.from(COA_BUCKET).upload(path, Buffer.from(r.bytes), { contentType: "application/pdf", upsert: true });
        if (!up.error) {
          const { error: e2 } = await admin
            .from("lab_results")
            .update({ coa_storage_path: path, coa_file_bytes: r.bytes.byteLength, coa_archived_at: new Date().toISOString() })
            .eq("id", id)
            .is("coa_storage_path", null);
          if (!e2) result.archived += 1;
        }
      } catch {
        /* the archive is best-effort; the lab result stands */
      }
    }

    for (const job of plan.jobs) {
      const lab = labIdByUrl.get(job.coaUrl);
      if (!lab || "error" in lab) {
        result.failedLots.push({ lotCode: job.lotCode, why: lab && "error" in lab ? lab.error : "its certificate was not read" });
        continue;
      }
      const { data, error } = await admin
        .from("inventory_lots")
        .update({ lab_result_id: lab.id, updated_by: actorId })
        .eq("id", job.lotId)
        .neq("status", "destroyed")
        .is("lab_result_id", null)
        .select("id");
      if (error) {
        result.failedLots.push({ lotCode: job.lotCode, why: `the lot could not be linked (${short(error)})` });
        continue;
      }
      if (((data as { id: string }[] | null) ?? []).length === 0) {
        result.changedMeanwhile += 1;
        continue;
      }
      result.attached += 1;
      linked.push({ lotId: job.lotId, lotCode: job.lotCode, labId: lab.id, labtestId: lab.labtestId, reused: lab.reused });
    }
    return { ok: true, result, linkedLotIds: linked };
  } catch (e) {
    return { ok: false, error: `The COAs could not be attached (${short(e)}).` };
  }
}
