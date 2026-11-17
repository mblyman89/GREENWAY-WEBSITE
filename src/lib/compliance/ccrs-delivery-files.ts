/**
 * ccrs-delivery-files.ts - D250 slice 3. File bytes -> DeliverySet.
 *
 * Shared by the CCRS Records page (server) and scripts/compliance/load-ccrs-delivery.ts.
 * Not "server-only" so the script can import it. It does no network or database I/O.
 * The xlsx is read with exceljs (already a dependency, used server-side elsewhere);
 * every cell goes through xlsxCellText so it reads exactly as the CSVs write it.
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import {
  DELIVERY_SHEETS,
  DeliveryError,
  deliveryExpect,
  detectDeliveryCsv,
  readDeliveredInventory,
  readDeliveredSales,
  readDeliveredSheet,
  xlsxCellText,
  type DeliveryCsvLayout,
  type DeliveryPlan,
  type DeliveryReviewBucket,
  type DeliverySet,
  type DeliverySheet,
} from "./ccrs-delivery-core";

/** One uploaded file slot: one of the four CSV layouts, or the sheet workbook. */
export type DeliverySlot = DeliveryCsvLayout | "sheets";
export const DELIVERY_SLOTS: readonly DeliverySlot[] = ["inventory-2026-11-17", "sales-2026-11-17", "inventory-2026-11-13", "sales-2026-11-13", "sheets"];

/** The ledger file type each slot is recorded under as a provenance (seed) file. */
export const SLOT_ROLE: Record<DeliverySlot, "Inventory" | "Product"> = {
  "inventory-2026-11-17": "Inventory",
  "sales-2026-11-17": "Inventory",
  "inventory-2026-11-13": "Inventory",
  "sales-2026-11-13": "Inventory",
  sheets: "Product",
};

/**
 * sha256 of the exact files the examiner sent (evidence/2026-11-17-examiner-delivery/README.md).
 * A different file is not refused by the page (a re-export is still checked by header and
 * content); it is shown as "not the file on record" and the script asks for --allow-other-files.
 */
export const KNOWN_DELIVERY_SHA256: Record<DeliverySlot, string> = {
  "inventory-2026-11-17": "7a1aa19f047e71ee9ceb598e46b958f57540f2f188275db4f45c28874aeb1443",
  "sales-2026-11-17": "29eac7369048635420c8be6bd82bb0039236bc7954d60500a2bc2d768a19f68c",
  "inventory-2026-11-13": "0680fddfc15d8c03d01e79312743aa874751f04e9761db2e9d9a18978ee39235",
  "sales-2026-11-13": "a198c1aea92657fe067da78254a90b5cc6fcd002ddcc6cfe23fac79102479ef6",
  sheets: "b6548527f8548cc18c658423919024bb473dd6872655d65a8cc7afe9a3f08001",
};

export type DeliveryFileInfo = { slot: DeliverySlot; fileName: string; sha256: string; bytes: number; rows: number; known: boolean };

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Which slot a file is: a CSV by its exact header, the workbook by its zip signature. */
export function slotOf(bytes: Uint8Array): DeliverySlot | null {
  if (isZip(bytes)) return "sheets";
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
  return detectDeliveryCsv(head.split("\n")[0] ?? "");
}

export async function readDeliveryWorkbook(bytes: Uint8Array): Promise<Record<DeliverySheet, Record<string, string>[]>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch (e) {
    throw new DeliveryError(`the sheet file is not a readable xlsx (${e instanceof Error ? e.message : String(e)})`);
  }
  const out = {} as Record<DeliverySheet, Record<string, string>[]>;
  for (const name of Object.keys(DELIVERY_SHEETS) as DeliverySheet[]) {
    const ws = wb.worksheets.find((w) => w.name === name);
    if (!ws) throw new DeliveryError(`the sheet file has no "${name}" sheet (has: ${wb.worksheets.map((w) => w.name).join(", ")})`);
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const v = Array.isArray(r.values) ? (r.values as unknown[]).slice(1) : [];
      rows.push(Array.from({ length: v.length }, (_, i) => xlsxCellText(v[i])));
    });
    out[name] = readDeliveredSheet(name, rows);
  }
  return out;
}

/** Bytes of each file -> the delivered set + what was read. One file per slot. */
export async function buildDeliverySet(files: readonly { fileName: string; bytes: Uint8Array }[]): Promise<{ set: DeliverySet; info: DeliveryFileInfo[] }> {
  if (files.length === 0) throw new DeliveryError("no delivery files");
  const set: DeliverySet = { lots: [], sales: [], products: [], strains: [], areas: [] };
  const info: DeliveryFileInfo[] = [];
  const seen = new Set<DeliverySlot>();
  for (const f of files) {
    const slot = slotOf(f.bytes);
    if (!slot) throw new DeliveryError(`${f.fileName}: not a file of this delivery (its header row matches no delivered layout)`);
    if (seen.has(slot)) throw new DeliveryError(`${f.fileName}: a second ${slot} file. Upload each file once.`);
    seen.add(slot);
    const sha256 = crypto.createHash("sha256").update(f.bytes).digest("hex");
    let rows: number;
    if (slot === "sheets") {
      const s = await readDeliveryWorkbook(f.bytes);
      set.products = s.Product;
      set.strains = s.strains;
      set.areas = s.areas;
      rows = s.Product.length + s.strains.length + s.areas.length;
    } else {
      const text = new TextDecoder("utf-8").decode(f.bytes);
      if (slot.startsWith("inventory-")) { const l = readDeliveredInventory(text, f.fileName); set.lots.push(...l); rows = l.length; }
      else { const s = readDeliveredSales(text, f.fileName); set.sales.push(...s); rows = s.length; }
    }
    info.push({ slot, fileName: f.fileName, sha256, bytes: f.bytes.length, rows, known: KNOWN_DELIVERY_SHA256[slot] === sha256 });
  }
  info.sort((a, b) => DELIVERY_SLOTS.indexOf(a.slot) - DELIVERY_SLOTS.indexOf(b.slot));
  return { set, info };
}

/* ------------------------------------------------------------------ *
 * Shared by the page and the CLI so both paths store and apply the same thing.
 * ------------------------------------------------------------------ */

export type DeliveryLoadSummary = {
  counts: DeliveryPlan["counts"];
  expect: { add: number; upd: number };
  source: string;
  proofSource: string;
  /** up to 50 examples per review bucket (the full list is in the report) */
  examples: Record<DeliveryReviewBucket, { t: string; id: string; why: string }[]>;
};

export function summarizeDelivery(p: DeliveryPlan): DeliveryLoadSummary {
  const examples = Object.fromEntries(Object.entries(p.review).map(([k, v]) => [k, v.slice(0, 50).map((x) => ({ t: x.t, id: x.id, why: x.why }))])) as DeliveryLoadSummary["examples"];
  return { counts: p.counts, expect: deliveryExpect(p), source: p.source, proofSource: p.proofSource, examples };
}

export type DeliveryProvenance = { role: "Inventory" | "Product"; fileName: string; sha256: string; rows: number; storagePath: string | null };

/** The provenance rows ccrs_apply_delivery records as seed/closed ccrs_files. */
export function deliveryProvenance(asOf: string, files: readonly (DeliveryFileInfo & { storagePath?: string | null })[]): DeliveryProvenance[] {
  return files.map((f) => ({ role: SLOT_ROLE[f.slot], fileName: `${asOf}-${f.fileName}`, sha256: f.sha256, rows: f.rows, storagePath: f.storagePath ?? null }));
}

/** Postgres string literal (standard_conforming_strings on: only ' needs doubling). */
export function sqlText(s: string): string {
  if (s.includes("\u0000")) throw new DeliveryError("a value contains a NUL byte");
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * The ONE-transaction script the CLI writes (or pipes to psql): insert the load
 * (status ready, the same summary the page stores), stage every write, then call
 * the same guarded ccrs_apply_delivery the page calls. Any refusal rolls back
 * everything (ON_ERROR_STOP).
 */
export function deliveryApplySql(input: {
  loadId: string; asOf: string; plan: DeliveryPlan; files: readonly DeliveryFileInfo[]; report: string; notes: string | null; actorEmail: string | null;
}): string {
  const { loadId, asOf, plan, files } = input;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loadId)) throw new DeliveryError("bad load id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || plan.asOf !== asOf) throw new DeliveryError("as-of does not match the plan");
  const ex = deliveryExpect(plan);
  const j = (v: unknown) => `${sqlText(JSON.stringify(v))}::jsonb`;
  const out: string[] = [
    "-- D250 S3 examiner delivery load (scripts/compliance/load-ccrs-delivery.ts). One transaction.",
    `-- as of ${asOf}: ${ex.add} new, ${ex.upd} updated. Files: ${files.map((f) => `${f.fileName} sha256 ${f.sha256}`).join("; ")}`,
    "\\set ON_ERROR_STOP on",
    "begin;",
    "insert into public.ccrs_delivery_loads (id, as_of, status, files, summary, report, notes, uploaded_by_email, planned_at)",
    `values (${sqlText(loadId)}, ${sqlText(asOf)}, 'ready', ${j(files.map((f) => ({ ...f, storagePath: null })))}, ${j(summarizeDelivery(plan))}, ${sqlText(input.report)}, ${input.notes === null ? "null" : sqlText(input.notes.slice(0, 2000))}, ${input.actorEmail === null ? "null" : sqlText(input.actorEmail)}, now());`,
  ];
  const CHUNK = 500;
  for (let i = 0; i < plan.writes.length; i += CHUNK) {
    const rows = plan.writes.slice(i, i + CHUNK).map((w) => ({
      op: w.op, file_type: w.t, external_id: w.id, filed_name: w.name, product_external_id: w.prod, state: w.state, source: w.source,
      payload: w.payload, conflicts: w.conflicts, expect_state: w.expectState, expect_us: w.expectUpdatedAt,
    }));
    out.push(
      "insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, filed_name, product_external_id, state, source, payload, conflicts, expect_state, expect_us)",
      `select ${sqlText(loadId)}::uuid, x.op, x.file_type, x.external_id, x.filed_name, x.product_external_id, x.state, x.source, x.payload, x.conflicts, x.expect_state, x.expect_us::bigint`,
      `from jsonb_to_recordset(${j(rows)}) as x(op text, file_type text, external_id text, filed_name text, product_external_id text, state text, source text, payload jsonb, conflicts jsonb, expect_state text, expect_us text);`,
    );
  }
  out.push(
    `select public.ccrs_apply_delivery(${sqlText(loadId)}::uuid, ${ex.add}, ${ex.upd}, ${j(deliveryProvenance(asOf, files))}, null, ${input.actorEmail === null ? "null" : sqlText(input.actorEmail)}) as result;`,
    "commit;",
    "",
  );
  return out.join("\n");
}
