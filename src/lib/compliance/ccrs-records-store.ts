/**
 * src/lib/compliance/ccrs-records-store.ts - R74 S40 (owner, Round 20).
 *
 * Server side of the CCRS Records page (migration 0298). A CCRS data copy from
 * the LCB Service Desk is uploaded straight from the browser to the private
 * `ccrs-records` bucket (signed URLs: Vercel's 4.5 MB body cap never applies),
 * then compared here three ways (ccrs-records-compare-core.ts) and, when the
 * owner says so, merged into the ledger by the guarded ccrs_apply_record_copy
 * RPC (the same rules as the S-15 command line; STALE writes nothing).
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { buildLedgerSeed, SEED_HEADERS, type SeedEntity, type SeedSource } from "./ccrs-ledger-seed-core";
import { applyRefusal, parseLedgerLine, planReseed, type LedgerRow, type ReseedPlan } from "./ccrs-reseed-core";
import { parseSentLine, verifyCopy, type SentLine, type VerifyResult } from "./ccrs-copy-verify-core";
import {
  RECORD_SOURCES,
  RECORDS_BUCKET,
  compareLots,
  detectSource,
  storageKey,
  summarize,
  type CompareSummary,
  type LiveLot,
} from "./ccrs-records-compare-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type CopyFile = { source: SeedSource; fileName: string; sha256: string; rows: number; bytes: number; storagePath: string };

export type CopyRow = {
  id: string;
  as_of: string;
  status: "uploading" | "ready" | "failed" | "applied" | "discarded";
  files: CopyFile[];
  summary: CompareSummary | null;
  error: string | null;
  notes: string | null;
  uploaded_by_email: string | null;
  compared_at: string | null;
  applied_at: string | null;
  applied_by_email: string | null;
  apply_result: { added?: number; updated?: number; provenance?: number; source?: string } | null;
  created_at: string;
};

export type CopyListRow = Omit<CopyRow, "summary"> & { score: number | null; problems: number | null };

const missing = (m: string | undefined, code?: string) =>
  code === "42P01" || code === "PGRST202" || code === "PGRST205" || (/ccrs_record_cop|ccrs_records_|ccrs_apply_record_copy/.test(m ?? "") && /does not exist|schema cache|Could not find/.test(m ?? ""));

const LIST_COLS = "id, as_of, status, files, error, notes, uploaded_by_email, compared_at, applied_at, applied_by_email, apply_result, created_at";

export async function listCopies(): Promise<{ available: boolean; rows: CopyListRow[]; error: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ccrs_record_copies")
    .select(`${LIST_COLS}, score:summary->syncScore, problems:summary->problems`)
    .order("created_at", { ascending: false })
    .range(0, 99);
  if (error) return { available: !missing(error.message, error.code), rows: [], error: missing(error.message, error.code) ? null : error.message };
  return { available: true, rows: (data ?? []) as unknown as CopyListRow[], error: null };
}

export async function getCopy(id: string): Promise<CopyRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await createSupabaseAdminClient().from("ccrs_record_copies").select(`${LIST_COLS}, summary`).eq("id", id).maybeSingle();
  if (error) throw new Error(`read copy: ${error.message}`);
  return (data as CopyRow | null) ?? null;
}

/** Step 1: a copy row + one signed upload token per file. */
export async function startCopy(input: { asOf: string; notes: string | null; actorId: string; actorEmail: string | null }): Promise<{ id: string; uploads: { source: SeedSource; key: string; token: string }[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || Number.isNaN(Date.parse(`${input.asOf}T00:00:00Z`))) throw new Error("Pick the date the copy is current through.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ccrs_record_copies")
    .insert({ as_of: input.asOf, notes: input.notes, uploaded_by: input.actorId, uploaded_by_email: input.actorEmail, status: "uploading" })
    .select("id")
    .single();
  if (error || !data) throw new Error(missing(error?.message, error?.code) ? "Migration 0298 is not applied yet." : `Couldn't start the upload: ${error?.message}`);
  const id = (data as { id: string }).id;
  const uploads: { source: SeedSource; key: string; token: string }[] = [];
  for (const source of RECORD_SOURCES) {
    const key = storageKey(id, source);
    const signed = await admin.storage.from(RECORDS_BUCKET).createSignedUploadUrl(key, { upsert: true });
    if (signed.error || !signed.data?.token) throw new Error(`Storage refused the ${source} upload: ${signed.error?.message ?? "no token"}`);
    uploads.push({ source, key, token: signed.data.token });
  }
  return { id, uploads };
}

async function readTexts(admin: Admin, id: string): Promise<{ texts: Record<SeedSource, string>; files: CopyFile[] }> {
  const texts = {} as Record<SeedSource, string>;
  const files: CopyFile[] = [];
  for (const source of RECORD_SOURCES) {
    const key = storageKey(id, source);
    const { data, error } = await admin.storage.from(RECORDS_BUCKET).download(key);
    if (error || !data) throw new Error(`The ${source} file is not in storage (${error?.message ?? "missing"}). Upload it again.`);
    const buf = Buffer.from(await data.arrayBuffer());
    const text = buf.toString("utf8");
    const first = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : undefined);
    const seen = detectSource(first, SEED_HEADERS);
    if (seen !== source) throw new Error(`The file uploaded as ${source} ${seen ? `is the ${seen} file` : "does not have the CCRS delivery header"}.`);
    texts[source] = text;
    files.push({ source, fileName: `${source}.csv`, sha256: crypto.createHash("sha256").update(buf).digest("hex"), rows: 0, bytes: buf.length, storagePath: `${RECORDS_BUCKET}/${key}` });
  }
  return { texts, files };
}

async function readLedger(admin: Admin): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin.rpc("ccrs_records_ledger_page", { p_offset: off, p_limit: PAGE });
    if (error) throw new Error(`ledger read: ${error.message}`);
    const rows = (data ?? []) as unknown[];
    for (const r of rows) out.push(parseLedgerLine(JSON.stringify(r)));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function readSent(admin: Admin): Promise<SentLine[]> {
  const out: SentLine[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin.rpc("ccrs_records_sent_page", { p_offset: off, p_limit: PAGE });
    if (error) throw new Error(`sent rows read: ${error.message}`);
    const rows = (data ?? []) as unknown[];
    for (const r of rows) out.push(parseSentLine(JSON.stringify(r)));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function readLots(admin: Admin): Promise<LiveLot[]> {
  type Raw = { id: string; ccrs_inventory_external_id: string | null; lot_code: string | null; product_name: string | null; on_hand_qty: number | string; status: string; disposition: string | null };
  const { rows, verdict } = await pagedAllChecked<Raw>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, ccrs_inventory_external_id, lot_code, product_name, on_hand_qty, status, disposition")
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (data ?? []) as Raw[], ok: !error };
  });
  if (!verdict.complete) throw new Error(`the lot read did not complete (${verdict.message}); compare again`);
  // a lot rejected at the dock never entered inventory, so CCRS never held it
  return rows
    .filter((r) => r.disposition !== "rejected_at_dock")
    .map((r) => ({ id: r.id, externalId: r.ccrs_inventory_external_id, lotCode: r.lot_code, productName: r.product_name, onHand: Number(r.on_hand_qty) || 0, status: r.status }));
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Parse + all three comparisons. Each part fails on its own; the rest still shows. */
export async function computeComparison(id: string, asOf: string): Promise<{ summary: CompareSummary; files: CopyFile[]; entities: SeedEntity[]; plan: ReseedPlan | null }> {
  const admin = createSupabaseAdminClient();
  const { texts, files } = await readTexts(admin, id);
  const seed = buildLedgerSeed(texts);
  for (const f of files) f.rows = seed.counts.sourceRows[f.source];

  let plan: ReseedPlan | null = null;
  let planError: string | null = null;
  try { plan = planReseed(seed.entities, await readLedger(admin), asOf); } catch (e) { planError = errText(e); }
  let verify: VerifyResult | null = null;
  let verifyError: string | null = null;
  try { verify = verifyCopy(seed.entities, await readSent(admin), asOf); } catch (e) { verifyError = errText(e); }
  let lotsCmp: ReturnType<typeof compareLots> | null = null;
  let lotsError: string | null = null;
  let liveLots = 0;
  try { const lots = await readLots(admin); liveLots = lots.length; lotsCmp = compareLots(seed.entities, lots); } catch (e) { lotsError = errText(e); }

  const summary = summarize({
    asOf,
    copyCounts: { entities: seed.counts.entities, sourceRows: seed.counts.sourceRows, inventoryOpen: seed.counts.inventoryOpen, inventoryClosed: seed.counts.inventoryClosed },
    plan, planError, verify, verifyError, lots: lotsCmp, lotsError, liveLots,
  });
  return { summary, files, entities: seed.entities, plan };
}

/** Step 2 (and "Compare again"): parse, compare, store the summary. */
export async function compareCopy(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const copy = await getCopy(id);
  if (!copy) return { ok: false, error: "No such copy." };
  if (copy.status === "applied" || copy.status === "discarded") return { ok: false, error: `This copy is ${copy.status}; upload a new one to compare again.` };
  try {
    const { summary, files } = await computeComparison(id, copy.as_of);
    const { error } = await admin.from("ccrs_record_copies").update({ status: "ready", summary, files, error: null, compared_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: `Couldn't save the comparison: ${error.message}` };
    return { ok: true };
  } catch (e) {
    await admin.from("ccrs_record_copies").update({ status: "failed", error: errText(e), updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: false, error: errText(e) };
  }
}

/** Step 3: merge into the ledger. Re-plans fresh; refuses if counts moved since the page showed them. */
export async function applyCopy(input: { id: string; expectAdd: number; expectUpd: number; acceptSeedMissing: number | null; actorId: string; actorEmail: string | null }): Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const copy = await getCopy(input.id);
  if (!copy) return { ok: false, error: "No such copy." };
  if (copy.status !== "ready") return { ok: false, error: `This copy is ${copy.status}; only a compared copy can be merged.` };
  let plan: ReseedPlan | null;
  let files: CopyFile[];
  try { ({ plan, files } = await computeComparison(input.id, copy.as_of)); } catch (e) { return { ok: false, error: errText(e) }; }
  if (!plan) return { ok: false, error: "The ledger plan could not be made for this copy (see the Ledger panel)." };
  const c = plan.counts;
  const upd = c.refresh + c.settleLink + c.settleUncertain;
  if (c.add !== input.expectAdd || upd !== input.expectUpd) {
    return { ok: false, error: `The ledger changed since this comparison (now ${c.add} new / ${upd} updated, the page showed ${input.expectAdd} / ${input.expectUpd}). Nothing was written. Click "Compare again".` };
  }
  const refusal = applyRefusal(plan, input.acceptSeedMissing);
  if (refusal) return { ok: false, error: refusal.replace(/--accept-seed-missing (\d+)/g, "the accept box set to $1").replace("re-run with", "merge again with") };

  const del = await admin.from("ccrs_record_copy_stage").delete().eq("copy_id", input.id);
  if (del.error) return { ok: false, error: `Couldn't clear the stage: ${del.error.message}` };
  const CHUNK = 1000;
  for (let i = 0; i < plan.writes.length; i += CHUNK) {
    const rows = plan.writes.slice(i, i + CHUNK).map((w) => ({
      copy_id: input.id, op: w.op, file_type: w.t, external_id: w.id, filed_name: w.name, product_external_id: w.prod, state: w.state,
      payload: w.payload, conflicts: w.conflicts, expect_state: w.expectState, expect_us: w.expectUpdatedAt === null ? null : w.expectUpdatedAt,
    }));
    const { error } = await admin.from("ccrs_record_copy_stage").insert(rows);
    if (error) return { ok: false, error: `Couldn't stage the merge: ${error.message}` };
  }
  const { data, error } = await admin.rpc("ccrs_apply_record_copy", {
    p_copy_id: input.id,
    p_expect_add: c.add,
    p_expect_upd: upd,
    p_provenance: files.map((f) => ({ source: f.source, fileName: `${copy.as_of}-${f.fileName}`, sha256: f.sha256, rows: f.rows, storagePath: f.storagePath })),
    p_actor: input.actorId,
    p_actor_email: input.actorEmail,
  });
  if (error) {
    await admin.from("ccrs_record_copy_stage").delete().eq("copy_id", input.id);
    return { ok: false, error: error.message.includes("CCRS_RESEED_STALE") ? `${error.message}` : `The merge was refused: ${error.message}` };
  }
  const r = (data ?? {}) as { added?: number; updated?: number };
  return { ok: true, added: Number(r.added ?? 0), updated: Number(r.updated ?? 0) };
}

/** Hide a copy and delete its files (the comparison summary row stays as history). */
export async function discardCopy(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const copy = await getCopy(id);
  if (!copy) return { ok: false, error: "No such copy." };
  if (copy.status === "applied") return { ok: false, error: "A merged copy is evidence of what the State held; it is kept." };
  await admin.storage.from(RECORDS_BUCKET).remove(RECORD_SOURCES.map((s) => storageKey(id, s)));
  const { error } = await admin.from("ccrs_record_copies").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
