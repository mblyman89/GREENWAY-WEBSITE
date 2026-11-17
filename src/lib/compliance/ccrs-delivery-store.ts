/**
 * src/lib/compliance/ccrs-delivery-store.ts - D250 slice 3.
 *
 * Server side of "Load the examiner's delivery" on the CCRS Records page
 * (migration 0368). The browser uploads the five files straight to the private
 * ccrs-records bucket on signed URLs (no body cap). This store reads them back,
 * plans the merge with the pure core (planDeliveryMerge) against the live ledger,
 * and on the owner's word stages the plan and calls the guarded
 * ccrs_apply_delivery RPC. STALE writes nothing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseLedgerLine, type LedgerRow } from "./ccrs-reseed-core";
import { deliveryExpect, deliveryReport, planDeliveryMerge, type DeliveryPlan } from "./ccrs-delivery-core";
import { buildDeliverySet, deliveryKey, deliveryProvenance, summarizeDelivery, DELIVERY_SLOTS, type DeliveryFileInfo, type DeliveryLoadSummary } from "./ccrs-delivery-files";
import { RECORDS_BUCKET } from "./ccrs-records-compare-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type { DeliveryLoadSummary } from "./ccrs-delivery-files";
export { deliveryKey } from "./ccrs-delivery-files";

export type DeliveryLoadRow = {
  id: string;
  as_of: string;
  status: "uploading" | "ready" | "failed" | "applied" | "discarded";
  files: (DeliveryFileInfo & { storagePath: string })[];
  summary: DeliveryLoadSummary | null;
  error: string | null;
  notes: string | null;
  uploaded_by_email: string | null;
  planned_at: string | null;
  applied_at: string | null;
  applied_by_email: string | null;
  apply_result: { added?: number; updated?: number; provenance?: number; source?: string } | null;
  created_at: string;
};

const COLS = "id, as_of, status, files, summary, error, notes, uploaded_by_email, planned_at, applied_at, applied_by_email, apply_result, created_at";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const missing = (m: string | undefined, code?: string) =>
  code === "42P01" || code === "PGRST202" || code === "PGRST205" || (/ccrs_delivery_|ccrs_apply_delivery/.test(m ?? "") && /does not exist|schema cache|Could not find/.test(m ?? ""));

export async function listDeliveryLoads(): Promise<{ available: boolean; rows: DeliveryLoadRow[]; error: string | null }> {
  const { data, error } = await createSupabaseAdminClient().from("ccrs_delivery_loads").select(COLS).order("created_at", { ascending: false }).limit(20);
  if (error) return { available: false, rows: [], error: missing(error.message, error.code) ? null : error.message };
  return { available: true, rows: (data ?? []) as unknown as DeliveryLoadRow[], error: null };
}

export async function getDeliveryLoad(id: string): Promise<DeliveryLoadRow | null> {
  const { data, error } = await createSupabaseAdminClient().from("ccrs_delivery_loads").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as DeliveryLoadRow) ?? null;
}

/** Step 1: a load row + one signed upload URL per picked file. */
export async function startDeliveryLoad(input: { asOf: string; notes: string | null; fileCount: number; actorId: string; actorEmail: string | null }): Promise<{ id: string; uploads: { key: string; token: string }[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || input.asOf <= "2026-09-18") throw new Error("The delivery date must be after 2026-09-18.");
  if (!Number.isInteger(input.fileCount) || input.fileCount < 1 || input.fileCount > DELIVERY_SLOTS.length) throw new Error(`Pick 1 to ${DELIVERY_SLOTS.length} files.`);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ccrs_delivery_loads")
    .insert({ as_of: input.asOf, notes: input.notes, uploaded_by: input.actorId, uploaded_by_email: input.actorEmail })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't start the load.");
  const id = (data as { id: string }).id;
  const uploads: { key: string; token: string }[] = [];
  for (let n = 0; n < input.fileCount; n += 1) {
    const key = deliveryKey(id, n);
    const signed = await admin.storage.from(RECORDS_BUCKET).createSignedUploadUrl(key, { upsert: true });
    if (signed.error || !signed.data) throw new Error(`Couldn't make an upload link: ${signed.error?.message ?? "unknown"}`);
    uploads.push({ key, token: signed.data.token });
  }
  return { id, uploads };
}

async function readLedger(admin: Admin): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  const PAGE = 10000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin.rpc("ccrs_records_ledger_page", { p_offset: off, p_limit: PAGE });
    if (error) throw new Error(`Couldn't read the ledger: ${error.message}`);
    const page = (data ?? []) as unknown[];
    for (const j of page) out.push(parseLedgerLine(JSON.stringify(j)));
    if (page.length < PAGE) break;
  }
  return out;
}

async function readFiles(admin: Admin, id: string, names: readonly string[]): Promise<{ fileName: string; bytes: Uint8Array; storagePath: string }[]> {
  const out: { fileName: string; bytes: Uint8Array; storagePath: string }[] = [];
  for (let n = 0; n < names.length; n += 1) {
    const key = deliveryKey(id, n);
    const { data, error } = await admin.storage.from(RECORDS_BUCKET).download(key);
    if (error || !data) throw new Error(`${names[n]} is not in storage (${error?.message ?? "missing"}). Upload it again.`);
    out.push({ fileName: names[n], bytes: new Uint8Array(await data.arrayBuffer()), storagePath: `${RECORDS_BUCKET}/${key}` });
  }
  return out;
}

async function plan(admin: Admin, load: { id: string; as_of: string }, names: readonly string[]) {
  const raw = await readFiles(admin, load.id, names);
  const { set, info } = await buildDeliverySet(raw);
  const files = info.map((f) => ({ ...f, storagePath: raw.find((r) => r.fileName === f.fileName)!.storagePath }));
  const p = planDeliveryMerge(set, await readLedger(admin), load.as_of);
  return { plan: p, files };
}

/** Step 2 (and "Check again"): read the files, plan against the live ledger, store the summary + full report. */
export async function checkDeliveryLoad(id: string, fileNames: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const load = await getDeliveryLoad(id);
  if (!load) return { ok: false, error: "No such load." };
  if (load.status === "applied" || load.status === "discarded") return { ok: false, error: `This load is ${load.status}.` };
  const names = fileNames.length ? fileNames : load.files.map((f) => f.fileName);
  try {
    const { plan: p, files } = await plan(admin, load, names);
    const { error } = await admin
      .from("ccrs_delivery_loads")
      .update({ status: "ready", files, summary: summarizeDelivery(p), report: deliveryReport(p, 100000), error: null, planned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: `Couldn't save the check: ${error.message}` };
    return { ok: true };
  } catch (e) {
    await admin.from("ccrs_delivery_loads").update({ status: "failed", files: names.map((fileName) => ({ fileName })), error: errText(e), updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: false, error: errText(e) };
  }
}

export async function deliveryReportText(id: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient().from("ccrs_delivery_loads").select("report").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { report: string | null } | null)?.report ?? null;
}

/** Step 3: re-plan fresh; refuse if the counts moved; stage; apply in one transaction. */
export async function applyDeliveryLoad(input: { id: string; expectAdd: number; expectUpd: number; actorId: string; actorEmail: string | null }): Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const load = await getDeliveryLoad(input.id);
  if (!load) return { ok: false, error: "No such load." };
  if (load.status !== "ready") return { ok: false, error: `This load is ${load.status}; only a checked load can be applied.` };
  let p: DeliveryPlan;
  let files: DeliveryLoadRow["files"];
  try { ({ plan: p, files } = await plan(admin, load, load.files.map((f) => f.fileName))); } catch (e) { return { ok: false, error: errText(e) }; }
  const ex = deliveryExpect(p);
  if (ex.add !== input.expectAdd || ex.upd !== input.expectUpd) {
    return { ok: false, error: `The ledger changed since this check (now ${ex.add} new / ${ex.upd} updated, the page showed ${input.expectAdd} / ${input.expectUpd}). Nothing was written. Click "Check again".` };
  }
  const del = await admin.from("ccrs_delivery_stage").delete().eq("load_id", input.id);
  if (del.error) return { ok: false, error: `Couldn't clear the stage: ${del.error.message}` };
  const CHUNK = 1000;
  for (let i = 0; i < p.writes.length; i += CHUNK) {
    const rows = p.writes.slice(i, i + CHUNK).map((w) => ({
      load_id: input.id, op: w.op, file_type: w.t, external_id: w.id, filed_name: w.name, product_external_id: w.prod, state: w.state, source: w.source,
      payload: w.payload, conflicts: w.conflicts, expect_state: w.expectState, expect_us: w.expectUpdatedAt,
    }));
    const { error } = await admin.from("ccrs_delivery_stage").insert(rows);
    if (error) {
      await admin.from("ccrs_delivery_stage").delete().eq("load_id", input.id);
      return { ok: false, error: `Couldn't stage the load: ${error.message}` };
    }
  }
  const { data, error } = await admin.rpc("ccrs_apply_delivery", {
    p_load_id: input.id,
    p_expect_add: ex.add,
    p_expect_upd: ex.upd,
    p_provenance: deliveryProvenance(load.as_of, files),
    p_actor: input.actorId,
    p_actor_email: input.actorEmail,
  });
  if (error) {
    await admin.from("ccrs_delivery_stage").delete().eq("load_id", input.id);
    return { ok: false, error: error.message.includes("CCRS_RESEED_STALE") ? error.message : `The load was refused: ${error.message}` };
  }
  const r = (data ?? {}) as { added?: number; updated?: number };
  return { ok: true, added: Number(r.added ?? 0), updated: Number(r.updated ?? 0) };
}

export async function discardDeliveryLoad(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const load = await getDeliveryLoad(id);
  if (!load) return { ok: false, error: "No such load." };
  if (load.status === "applied") return { ok: false, error: "An applied delivery is evidence of what the State held; it is kept." };
  await admin.storage.from(RECORDS_BUCKET).remove(DELIVERY_SLOTS.map((_, n) => deliveryKey(id, n)));
  const { error } = await admin.from("ccrs_delivery_loads").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
