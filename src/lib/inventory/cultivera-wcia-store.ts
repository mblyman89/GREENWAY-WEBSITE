/**
 * src/lib/inventory/cultivera-wcia-store.ts   (R50 S3b, bible §1.5c)
 *
 * The vendors' WCIA transfer files from Cultivera, kept and used:
 *
 *   saveWciaFiles        at import time: one private file per transfer,
 *                        `pos-raw/rehome/<import>/wcia/<transferId>.json`
 *                        (next to the plan inputs, so Start works after the
 *                        crawler prunes the run).
 *   attachWciaLabResults the FIRST step of Start on a rebuilt manifest: parse
 *                        the manifest's OWN transfer file with the native
 *                        parser, create lab_results exactly as a delivery
 *                        would (shared builder nativeLabRow; an exact lab test
 *                        id already on file is reused), then fill each lot's
 *                        EMPTY lab_result_id (the guarded compare-and-set of
 *                        linkLotLabResult: never replaces a certificate, never
 *                        a destroyed lot).
 *
 * Sellable stays sellable: the ONLY lot write is that fill-only
 * lab_result_id (+ updated_by). Status, quantity, cost, CCRS fields, prices
 * and live cards are never written. Lab pass/fail is read only by a native
 * delivery's finalize/activation (not by a live lot or the menu) — §1.5c.4.
 * Every failure is reported in the result; nothing here throws to the caller.
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import {
  WCIA_BUCKET,
  emptyWciaResult,
  parseTransferId,
  isWciaDocumentText,
  nativeLabRow,
  pickExistingLabs,
  planWciaLabLinks,
  wciaFilesToSave,
  wciaStorageKey,
  type WciaAttachResult,
  type WciaLot,
  type WciaRunRecord,
} from "@/lib/inventory/cultivera-wcia-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

/** Uploads run a few at a time (619 files ≈ 30 MB on the reference harvest). */
export const WCIA_UPLOAD_CONCURRENCY = 4;
/** Lab test ids per `.in()` read (URL length). */
export const WCIA_LAB_ID_CHUNK = 100;

export type WciaSaveResult = { saved: number; failed: number; rejected: number; duplicates: number; firstError: string | null };

export async function saveWciaFiles(admin: Admin, importId: string, records: readonly WciaRunRecord[]): Promise<WciaSaveResult> {
  const plan = wciaFilesToSave(importId, records);
  let saved = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (let i = 0; i < plan.files.length; i += WCIA_UPLOAD_CONCURRENCY) {
    const batch = plan.files.slice(i, i + WCIA_UPLOAD_CONCURRENCY);
    const outs = await Promise.all(
      batch.map(async (f) => {
        try {
          const { error } = await admin.storage
            .from(WCIA_BUCKET)
            .upload(f.key, Buffer.from(f.text, "utf8"), { contentType: "application/json", upsert: true });
          return error ? short(error) : null;
        } catch (e) {
          return short(e);
        }
      }),
    );
    for (const o of outs) {
      if (o === null) saved += 1;
      else {
        failed += 1;
        firstError ??= o;
      }
    }
  }
  return { saved, failed, rejected: plan.rejected, duplicates: plan.duplicates, firstError };
}

export type LoadOutcome = { kind: "ok"; text: string } | { kind: "missing" } | { kind: "unreadable"; error: string };

/** One kept transfer file (shared with R74 S14 survivorship). */
export async function loadWciaText(admin: Admin, key: string): Promise<LoadOutcome> {
  try {
    const { data, error } = await admin.storage.from(WCIA_BUCKET).download(key);
    if (error || !data) {
      const msg = short(error ?? "missing");
      // Storage answers a missing object with 400/404 "not found"; anything else is a real failure.
      return /not.?found|does not exist|404/i.test(msg) || !error ? { kind: "missing" } : { kind: "unreadable", error: msg };
    }
    const text = Buffer.from(await data.arrayBuffer()).toString("utf8");
    return isWciaDocumentText(text) ? { kind: "ok", text } : { kind: "unreadable", error: "not a WCIA transfer document" };
  } catch (e) {
    return { kind: "unreadable", error: short(e) };
  }
}

/**
 * Attach the vendor's lab results from the manifest's own Cultivera transfer
 * file. `lineage` holds the rebuilt manifest's raw_payload import_id and
 * cultivera_transfer_id (text or number).
 */
export async function attachWciaLabResults(
  admin: Admin,
  manifestId: string,
  lineage: { import_id?: unknown; cultivera_transfer_id?: unknown } | null,
  actorId: string | null,
  opts: { dryRun?: boolean } = {},
): Promise<WciaAttachResult> {
  const transferId = parseTransferId(lineage?.cultivera_transfer_id);
  // A manifest grouped by receive time (S1 fallback) has no transfer: nothing to attach.
  if (transferId === null) return emptyWciaResult("no-transfer");
  const key = wciaStorageKey(lineage?.import_id, transferId);
  if (!key) return emptyWciaResult("no-transfer");

  const loaded = await loadWciaText(admin, key);
  if (loaded.kind === "missing") return emptyWciaResult("no-document");
  if (loaded.kind === "unreadable") return emptyWciaResult("unreadable", [`vendor transfer file: ${loaded.error}`]);
  const parsed = parseVendorJson(loaded.text);
  if (!parsed.ok) return emptyWciaResult("unreadable", [`vendor transfer file: ${parsed.error}`]);

  // The manifest's lots (paged with an honest verdict: a short read attaches nothing).
  const lotsRead = await pagedAllChecked<WciaLot>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, status, lab_result_id")
      .eq("manifest_id", manifestId)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as WciaLot[] | null) ?? [] };
  });
  if (!lotsRead.verdict.complete) {
    return emptyWciaResult("error", [`the manifest's lots could not be read in full; nothing was attached (${lotsRead.verdict.message})`]);
  }

  const plan = planWciaLabLinks(lotsRead.rows, parsed.manifest);
  const result = emptyWciaResult("attached");
  result.outcomes = plan.outcomes;
  if (plan.links.length === 0) return result;

  // Exact lab test ids already on file are the same certificate: reuse, never duplicate.
  const existing = new Map<string, string>();
  for (let i = 0; i < plan.externalIds.length; i += WCIA_LAB_ID_CHUNK) {
    const ids = plan.externalIds.slice(i, i + WCIA_LAB_ID_CHUNK);
    const { data, error } = await admin
      .from("lab_results")
      .select("id, labtest_external_identifier, created_at")
      .in("labtest_external_identifier", ids);
    if (error) return { ...result, status: "error", errors: [`lab results could not be read: ${short(error)}`] };
    for (const [k, v] of pickExistingLabs((data as { id: string; labtest_external_identifier: string | null; created_at: string | null }[] | null) ?? [], ids)) {
      existing.set(k, v);
    }
  }

  // R50 A3 dry run: the SAME plan and the same exact-id reuse lookup (reads only), then stop before
  // any write. `created` / `linked` are what a real run would do if nothing changes meanwhile.
  if (opts.dryRun) {
    for (const need of plan.needs) {
      if (need.externalId && existing.has(need.externalId)) result.reused += 1;
      else result.created += 1;
    }
    result.linked = plan.links.length;
    return result;
  }

  const labIdByKey = new Map<string, string>();
  let jsonUrlColumnMissing = false;
  for (const need of plan.needs) {
    const reuse = need.externalId ? existing.get(need.externalId) : undefined;
    if (reuse) {
      labIdByKey.set(need.key, reuse);
      result.reused += 1;
      continue;
    }
    const row = nativeLabRow(need.lab, parsed.manifest.source_format, actorId, { withJsonUrl: !jsonUrlColumnMissing });
    let { data, error } = await admin.from("lab_results").insert(row).select("id").single();
    if (error && "wcia_json_url" in row && isMissingColumnError(error)) {
      jsonUrlColumnMissing = true;
      delete row.wcia_json_url;
      ({ data, error } = await admin.from("lab_results").insert(row).select("id").single());
    }
    const id = (data as { id: string } | null)?.id ?? null;
    if (error || !id) {
      if (result.errors.length < 5) result.errors.push(`a lab result could not be saved: ${short(error ?? "no id returned")}`);
      continue;
    }
    labIdByKey.set(need.key, id);
    result.created += 1;
  }

  for (const link of plan.links) {
    const labId = labIdByKey.get(link.labKey);
    if (!labId) continue; // its lab result could not be saved (reported above)
    const { data, error } = await admin
      .from("inventory_lots")
      .update({ lab_result_id: labId, updated_by: actorId })
      .eq("id", link.lotId)
      .neq("status", "destroyed")
      .is("lab_result_id", null)
      .select("id");
    if (error) {
      if (result.errors.length < 5) result.errors.push(`a lot could not be linked: ${short(error)}`);
      continue;
    }
    if (((data as { id: string }[] | null) ?? []).length > 0) result.linked += 1;
    else result.skippedChanged += 1;
  }
  return result;
}
