/**
 * D256 S2 - the Clean-up panel's server side (CCRS hub -> Stale-lot clean-up).
 *
 * The same rules as scripts/compliance/equalize-ccrs-wave.ts (Part 17 §E,
 * ccrs-equalize-core), without a terminal or a database password:
 *   - the copy is the ledger itself (--composite 2026-11-17), Brian's answers
 *     (--brian), Cultivera's final upload 2026-11-01;
 *   - the 10/30 audit list is read from the count workbooks saved on Menu
 *     Imports -> Count (pos-raw count/<import>/uploads/<batch>/), checksummed;
 *   - our lots are read live, so the snapshot day is today (Pacific);
 *   - a wave is stored only when its counts equal the plan the owner read,
 *     through ccrs_emit_files plus the wave label, as the script does.
 * Stored files are uploaded from the hub like every other file.
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseLedgerLine, type LedgerRow } from "./ccrs-reseed-core";
import { buildLedgerView } from "./ccrs-ledger-core";
import { planOutboxFiles } from "./ccrs-outbox-core";
import { verifyCcrsFile } from "./ccrs-batch-core";
import {
  BRIAN_EQUALIZE_POLICY,
  compositeCopy,
  equalizeEmitPayload,
  equalizeSources,
  parseAdjustLine,
  planAdjustPhase,
  planEqualizeWave,
  verifyEqualizeFiles,
  type AdjustLine,
  type EqualizePlan,
  type OurLot,
} from "./ccrs-equalize-core";
import { mergeCountWorkbooks, parseCountWorkbook } from "@/lib/pos/cultivera-count-core";
import { workbookCells } from "@/lib/pos/cultivera-count-workbook";
import { COUNT_BUCKET } from "@/lib/pos/cultivera-count-store";
import { pacificToday } from "@/lib/reports/timezone";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const LICENSE = "413541";
const SUBMITTED_BY = "Greenway Marijuana";
export const CLEANUP_COMPOSITE = "2026-11-17";
export const CLEANUP_FINAL_UPLOAD = "2026-11-01";
/** The 10/30 audit: six counter workbooks uploaded 11/01 (Menu Imports -> Count). */
export const AUDIT_UPLOAD = "count/a474040b-0f1d-476e-b32d-99c5fe4bef50/uploads/bffb2f3e-67ee-47de-8fc1-429614657cbf";

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

async function readOurs(admin: Admin): Promise<OurLot[]> {
  const out: OurLot[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin.from("inventory_lots").select("id,ccrs_inventory_external_id,lot_code,pos_product_key,status").order("id").range(off, off + PAGE - 1);
    if (error) throw new Error(`Couldn't read our lots: ${error.message}`);
    const rows = (data ?? []) as { ccrs_inventory_external_id: string | null; lot_code: string | null; pos_product_key: string | null; status: string | null }[];
    for (const r of rows) {
      const id = (r.ccrs_inventory_external_id ?? "").trim();
      out.push({ externalId: id === "" ? null : id, lotCode: r.lot_code, posProductKey: r.pos_product_key, destroyed: r.status === "destroyed" });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function readAuditBarcodes(admin: Admin): Promise<string[]> {
  const get = async (key: string) => {
    const { data, error } = await admin.storage.from(COUNT_BUCKET).download(key);
    if (error || !data) throw new Error(`The 10/30 count file ${key} is missing from storage.`);
    return Buffer.from(await data.arrayBuffer());
  };
  const index = JSON.parse((await get(`${AUDIT_UPLOAD}/index.json`)).toString("utf8")) as { files: { name: string; sha256: string; key: string }[] };
  const books = [];
  for (const f of index.files) {
    const b = await get(f.key);
    const sha = crypto.createHash("sha256").update(b).digest("hex");
    if (sha !== f.sha256) throw new Error(`${f.name} no longer matches its checksum; the clean-up will not guess.`);
    books.push(parseCountWorkbook({ fileName: f.name, sha256: sha, cells: await workbookCells(b) }));
  }
  const merged = mergeCountWorkbooks(books);
  const blocking = merged.problems.filter((p) => p.severity === "blocking");
  if (blocking.length) throw new Error(`The 10/30 count workbooks are refused: ${blocking.map((p) => p.message).join("; ")}`);
  const codes = [...merged.counted.values()].map((v) => v.code);
  if (codes.length === 0) throw new Error("The 10/30 count has no barcodes; the clean-up will not run without it.");
  return codes;
}

export type CleanupPlanView = {
  wave: string;
  day: string;
  counts: EqualizePlan["counts"];
  countsJson: string;
  sample: { id: string; qty: string }[];
  holds: { id: string; code: string; detail: string }[];
};

async function planInventory(admin: Admin, wave: string) {
  const day = pacificToday();
  const [ledger, ours, counted] = await Promise.all([readLedger(admin), readOurs(admin), readAuditBarcodes(admin)]);
  const plan = planEqualizeWave({
    copy: compositeCopy(ledger, CLEANUP_COMPOSITE), ledger, ours, copyAsOf: CLEANUP_COMPOSITE, snapshotDate: day, waveDate: day,
    finalUploadDate: CLEANUP_FINAL_UPLOAD, countedBarcodes: counted, wave, licenseNumber: LICENSE, submittedBy: SUBMITTED_BY, policy: { ...BRIAN_EQUALIZE_POLICY },
  });
  return { plan, ledger };
}

/** Plan only: nothing is written. */
export async function planCleanupWave(wave: string): Promise<CleanupPlanView> {
  const { plan } = await planInventory(createSupabaseAdminClient(), wave);
  return { wave, day: plan.waveDate, counts: plan.counts, countsJson: JSON.stringify(plan.counts), sample: plan.lots.slice(0, 25), holds: plan.holds.slice(0, 300) };
}

async function storeFiles(admin: Admin, wave: string, sources: ReturnType<typeof equalizeSources>, ledger: LedgerRow[], waveLots: Set<string>): Promise<string[]> {
  const { data: prior, error: pe } = await admin.from("ccrs_files").select("stamp_at").eq("env", "prod").not("stamp_at", "is", null).order("stamp_at", { ascending: false }).limit(1);
  if (pe) throw new Error(pe.message);
  const last = (prior ?? [])[0] as { stamp_at: string | null } | undefined;
  const files = planOutboxFiles(sources, { licenseNumber: LICENSE, now: new Date(), lastStamp: last?.stamp_at ? new Date(last.stamp_at) : null });
  const bad: string[] = [];
  for (const f of files) for (const x of verifyCcrsFile(f.type, f.csv)) if (x.severity === "error") bad.push(`${f.fileName}: ${x.message}`);
  const { view } = buildLedgerView("prod", ledger.map((r) => ({ fileType: r.t, externalId: r.id, filedName: r.name, state: r.state, productExternalId: r.prod })));
  for (const x of verifyEqualizeFiles(view, files, waveLots)) bad.push(`${x.fileName} row ${x.row}: ${x.message}`);
  if (bad.length) throw new Error(`The files fail their own checks; nothing was stored. ${bad.slice(0, 5).join(" | ")}`);
  const types = [...new Set(files.map((f) => f.type))];
  const { count, error: ce } = await admin.from("ccrs_files").select("id", { count: "exact", head: true }).eq("env", "prod").eq("wave", wave).in("file_type", types);
  if (ce) throw new Error(ce.message);
  if ((count ?? 0) > 0) throw new Error(`Wave ${wave} already has files of this kind. Use the next wave label.`);
  const { data, error } = await admin.rpc("ccrs_emit_files", { p_env: "prod", p_files: equalizeEmitPayload(files) });
  if (error) throw new Error(`Couldn't store the files: ${error.message}`);
  const out = (data as { files?: { id: string; file_name: string; status: string }[] } | null)?.files ?? [];
  if (out.length === 0 || out.some((f) => f.status !== "emitted")) throw new Error("A file of this wave was already stored; nothing new was written.");
  const { error: we } = await admin.from("ccrs_files").update({ wave }).in("id", out.map((f) => f.id));
  if (we) throw new Error(`Stored, but the wave label failed: ${we.message}. Tell the developer before uploading.`);
  return out.map((f) => f.file_name);
}

/** Store the wave's Inventory file, only if the counts equal the plan the owner read. */
export async function storeCleanupWave(wave: string, expectJson: string): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const { plan, ledger } = await planInventory(admin, wave);
  if (JSON.stringify(plan.counts) !== expectJson) throw new Error("The numbers changed since you planned (a sale, a receive or an email came in). Plan again and read the new numbers.");
  if (plan.lots.length === 0) throw new Error("No lot is in this wave.");
  return storeFiles(admin, wave, equalizeSources(plan, "inventory"), ledger, new Set(plan.lots.map((l) => l.id)));
}

type Ent = { external_id: string; state: string; last_operation: string | null; last_file_id: string | null; seed_payload: Record<string, string> | null };

/** The ADJUST_PHASE_SQL shape, read through the API. */
async function adjustLines(admin: Admin, wave: string): Promise<AdjustLine[]> {
  const { data: files, error } = await admin.from("ccrs_files").select("id,file_name,state").eq("env", "prod").eq("wave", wave).eq("purpose", "cleanup:stale").eq("file_type", "Inventory");
  if (error) throw new Error(error.message);
  const lines: AdjustLine[] = [];
  for (const f of (files ?? []) as { id: string; file_name: string; state: string }[]) {
    for (let off = 0; ; off += 1000) {
      const { data: rows, error: re } = await admin.from("ccrs_file_rows").select("external_id,state").eq("file_id", f.id).order("row_no").range(off, off + 999);
      if (re) throw new Error(re.message);
      const rs = (rows ?? []) as { external_id: string; state: string }[];
      const ents = new Map<string, Ent>();
      const ids = rs.map((r) => r.external_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: es, error: ee } = await admin.from("ccrs_filed_entities").select("external_id,state,last_operation,last_file_id,seed_payload").eq("env", "prod").eq("file_type", "Inventory").in("external_id", ids.slice(i, i + 200));
        if (ee) throw new Error(ee.message);
        for (const e of (es ?? []) as Ent[]) ents.set(e.external_id, e);
      }
      for (const r of rs) {
        const e = ents.get(r.external_id);
        lines.push(parseAdjustLine(JSON.stringify({
          id: r.external_id, file: f.file_name, fileState: f.state, rowState: r.state, entityState: e?.state ?? null, lastOp: e?.last_operation ?? null,
          lastFileName: !e?.last_file_id ? null : e.last_file_id === f.id ? f.file_name : "another file", qoh: e?.seed_payload?.["Quantity on Hand"] ?? null,
        })));
      }
      if (rs.length < 1000) break;
    }
  }
  return lines;
}

async function waveDayOf(admin: Admin, wave: string): Promise<string> {
  const { data, error } = await admin.from("ccrs_files").select("stamp_at").eq("env", "prod").eq("wave", wave).eq("file_type", "Inventory").order("stamp_at").limit(1);
  if (error) throw new Error(error.message);
  const s = ((data ?? [])[0] as { stamp_at: string | null } | undefined)?.stamp_at;
  if (!s) throw new Error(`Wave ${wave} has no stored Inventory file.`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(s));
}

export async function planCleanupAdjust(wave: string) {
  const admin = createSupabaseAdminClient();
  const ap = planAdjustPhase({ wave, waveDate: await waveDayOf(admin, wave), adjustDate: pacificToday(), licenseNumber: LICENSE, submittedBy: SUBMITTED_BY, lines: await adjustLines(admin, wave) });
  return { counts: ap.counts, countsJson: JSON.stringify(ap.counts), holds: ap.holds.slice(0, 300), ap };
}

export async function storeCleanupAdjust(wave: string, expectJson: string): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const { ap, countsJson } = await planCleanupAdjust(wave);
  if (countsJson !== expectJson) throw new Error("The numbers changed since you planned. Plan again.");
  if (ap.rows.length === 0) throw new Error("No lot is ready for its Reconciliation yet (apply the wave's email first).");
  return storeFiles(admin, wave, equalizeSources(ap, "adjustments"), await readLedger(admin), new Set(ap.lotIds));
}

/** Clean-up files stored so far, newest first. */
export async function listCleanupFiles(): Promise<{ wave: string | null; file_type: string; file_name: string; state: string }[]> {
  const { data } = await createSupabaseAdminClient().from("ccrs_files").select("wave,file_type,file_name,state").eq("env", "prod").eq("purpose", "cleanup:stale").order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as { wave: string | null; file_type: string; file_name: string; state: string }[];
}
