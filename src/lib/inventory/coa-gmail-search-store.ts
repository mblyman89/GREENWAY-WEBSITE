/**
 * src/lib/inventory/coa-gmail-search-store.ts   (D201)
 *
 * The I/O half of the targeted Gmail COA search on Inventory > Fix later:
 *
 *   searchGmailForCoas     "Search Gmail for the missing COAs": for each delivery that still has
 *                          stocked lots with no COA, a few exact Gmail questions (manifest number,
 *                          barcodes, vendor inside the receive-date window). Every matched email
 *                          that is not kept yet goes through the EXISTING harvester
 *                          (harvestOneEmail: same storage, rows, parsers, Transfer-link fetch).
 *                          The matched ids are remembered per delivery (site_settings).
 *   attachCoasFromGmail    "Attach COAs from Gmail" (+ preview): (1) the vendor JSONs on those
 *                          emails -> each line's own lab data and COA url (native path);
 *                          (2) the emailed COA PDFs -> a certificate whose PRINTED id equals the
 *                          lot's barcode. Fill-only, exact lab id reused, PDF filed in `coa`.
 *   searchGmailForOne      a stubborn product (or one delivery): a wider search for just it, then
 *                          the same attach for its delivery, and a plain answer.
 *
 * Gmail is read-only. Writes: pos-raw (harvested files), cultivera_mail_docs (harvest rows, ON
 * CONFLICT DO NOTHING), site_settings (the remembered search), lab_results (insert / file the
 * PDF), inventory_lots.lab_result_id WHERE EMPTY (+ updated_by), coa bucket, audit rows.
 * Never a status, quantity, cost, CCRS field, price or menu card. Never throws to the caller.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import { recordAudit } from "@/lib/auth/audit";
import { parseVendorJson, type ParsedLine } from "@/lib/inventory/intake-parser";
import { applyWciaLinkPlan } from "@/lib/inventory/cultivera-wcia-store";
import { emptyWciaResult, planWciaLabLinks, type LabSourceFormat, type WciaAttachResult, type WciaLinkPlan, type WciaLot } from "@/lib/inventory/cultivera-wcia-core";
import type { CoaCertificate } from "@/lib/inventory/coa-bundle-core";
import type { HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";
import { HARVEST_BUCKET, HARVEST_DOCS_TABLE, transientError } from "@/lib/pos/cultivera-mail-harvest-run-core";
import {
  COA_GMAIL_ATTACH_AUDIT,
  COA_GMAIL_FETCH_AUDIT,
  COA_GMAIL_ONE_AUDIT,
  COA_GMAIL_SETTING_KEY,
  COA_GMAIL_SETTING_LABEL,
  GMAIL_ATTACH_BUDGET_MS,
  GMAIL_ONE_MAX_NEW,
  GMAIL_ONE_SEARCH_BUDGET_MS,
  GMAIL_SEARCH_BUDGET_MS,
  GMAIL_SEARCH_MAX_NEW,
  buildTargetQueries,
  chunkList,
  emptyAttachTotals,
  emptySearchTotals,
  hitIdsFor,
  jsonLinesForBarcodes,
  orderTargets,
  parseGmailSearchState,
  pdfReadPriority,
  planCertLinks,
  pushErr,
  recordSearch,
  type GmailAttachTotals,
  type GmailSearchState,
  type GmailSearchTotals,
  type GmailTarget,
  type ReadCert,
} from "@/lib/inventory/coa-gmail-search-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 160);

/** Only the harvest's own pos-raw keys are ever read. */
const HARVEST_KEY_RE = /^mail-harvest\/[A-Za-z0-9_.@-]+\/[A-Za-z0-9_-]+\/[^/]+$/;
const COA_BUCKET = "coa";
/** Gmail ids taken from one question (a vendor question can match many emails). */
const IDS_PER_QUERY = 60;
const BARCODE_CHUNK = 100;

// --- reads ---------------------------------------------------------------------------

type LotRow = { id: string; manifest_id: string | null; lot_code: string | null; status: string | null; lab_result_id: string | null; product_name: string | null };
type ManifestRow = { id: string; manifest_number: string | null; vendor_label: string | null; transfer_date: string | null; received_at: string | null; created_at: string | null };
export type MissingTarget = GmailTarget & { lotRows: LotRow[] };
type TargetsRead = { ok: true; lots: LotRow[]; targets: MissingTarget[] } | { ok: false; error: string };

/** Every stocked lot with no COA, grouped by its delivery (the Fix later "No COA" rule). */
export async function readMissingTargets(admin: Admin): Promise<TargetsRead> {
  const lotsRead = await pagedAllChecked<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, manifest_id, lot_code, status, lab_result_id, product_name")
      .gt("on_hand_qty", 0)
      .is("lab_result_id", null)
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) console.error("[coa-gmail] lots read failed:", error.message);
    return { ok: !error, rows: (data as LotRow[] | null) ?? [] };
  });
  if (!lotsRead.verdict.complete) return { ok: false, error: `the lots with no COA could not be read in full (${lotsRead.verdict.message})` };
  const ids = [...new Set(lotsRead.rows.map((l) => l.manifest_id).filter((x): x is string => Boolean(x)))];
  let readError: string | null = null;
  const manifests = await chunkedIn<string, ManifestRow>(ids, async (part, from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, vendor_label, transfer_date, received_at, created_at")
      .in("id", part)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) readError ??= short(error);
    return (data as ManifestRow[] | null) ?? [];
  });
  if (readError) return { ok: false, error: `the deliveries could not be read (${readError})` };
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const groups = new Map<string, MissingTarget>();
  for (const l of lotsRead.rows) {
    const m = l.manifest_id ? byId.get(l.manifest_id) : undefined;
    const key = m ? m.id : `lot:${l.id}`;
    const day = (v: string | null | undefined) => ((v ?? "").match(/^\d{4}-\d{2}-\d{2}/) ?? [null])[0];
    const g =
      groups.get(key) ??
      ({
        manifestId: m ? m.id : l.id,
        manifestNumber: m?.manifest_number ?? null,
        vendorLabel: m?.vendor_label ?? null,
        transferDate: day(m?.transfer_date) ?? day(m?.received_at) ?? day(m?.created_at),
        lots: [],
        lotRows: [],
      } as MissingTarget);
    g.lots.push({ id: l.id, lotCode: l.lot_code });
    g.lotRows.push(l);
    groups.set(key, g);
  }
  return { ok: true, lots: lotsRead.rows, targets: [...groups.values()] };
}

async function readState(admin: Admin): Promise<{ ok: true; state: GmailSearchState } | { ok: false; error: string }> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", COA_GMAIL_SETTING_KEY).maybeSingle();
  if (error) return { ok: false, error: short(error) };
  return { ok: true, state: parseGmailSearchState((data as { value_json?: unknown } | null)?.value_json) };
}

async function writeState(admin: Admin, state: GmailSearchState, actorId: string | null): Promise<string | null> {
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: COA_GMAIL_SETTING_KEY, label: COA_GMAIL_SETTING_LABEL, value_json: state, updated_by: actorId }, { onConflict: "key" });
  return error ? short(error) : null;
}

type DocRow = {
  id: string;
  gmail_id: string;
  doc_index: number;
  email_at: string | null;
  subject: string | null;
  filename: string | null;
  kind: string | null;
  status: string | null;
  source_format: string | null;
  storage_key: string | null;
  manifest_number: string | null;
  barcodes: string[] | null;
};
const DOC_COLS = "id, gmail_id, doc_index, email_at, subject, filename, kind, status, source_format, storage_key, manifest_number, barcodes";

/** Kept documents that carry one of the barcodes (any format). */
async function docsByBarcodes(admin: Admin, barcodes: readonly string[]): Promise<{ rows: DocRow[]; error: string | null }> {
  const rows = new Map<string, DocRow>();
  let err: string | null = null;
  for (const part of chunkList([...barcodes].sort(), BARCODE_CHUNK)) {
    const found = await pagedAllChecked<DocRow>(async (from, to) => {
      const { data, error } = await admin.from(HARVEST_DOCS_TABLE).select(DOC_COLS).overlaps("barcodes", part).order("id", { ascending: true }).range(from, to);
      if (error) err ??= short(error);
      return { ok: !error, rows: (data as DocRow[] | null) ?? [] };
    });
    if (!found.verdict.complete) err ??= found.verdict.message;
    for (const r of found.rows) rows.set(r.id, r);
  }
  return { rows: [...rows.values()], error: err };
}

/** Kept documents with one of these manifest numbers. */
async function docsByManifestNumbers(admin: Admin, numbers: readonly string[]): Promise<{ rows: DocRow[]; error: string | null }> {
  let err: string | null = null;
  const rows = await chunkedIn<string, DocRow>([...new Set(numbers)].filter(Boolean), async (part, from, to) => {
    const { data, error } = await admin.from(HARVEST_DOCS_TABLE).select(DOC_COLS).in("manifest_number", part).order("id", { ascending: true }).range(from, to);
    if (error) err ??= short(error);
    return (data as DocRow[] | null) ?? [];
  });
  return { rows, error: err };
}

/** Every kept document of these emails. */
async function docsByGmailIds(admin: Admin, mailbox: string | null, gmailIds: readonly string[]): Promise<{ rows: DocRow[]; error: string | null }> {
  let err: string | null = null;
  const rows = await chunkedIn<string, DocRow>([...new Set(gmailIds)], async (part, from, to) => {
    let q = admin.from(HARVEST_DOCS_TABLE).select(DOC_COLS).in("gmail_id", part);
    if (mailbox) q = q.eq("mailbox", mailbox);
    const { data, error } = await q.order("id", { ascending: true }).range(from, to);
    if (error) err ??= short(error);
    return (data as DocRow[] | null) ?? [];
  });
  return { rows, error: err };
}

async function downloadKept(admin: Admin, key: string): Promise<Uint8Array | null> {
  if (!HARVEST_KEY_RE.test(key) || key.includes("..")) return null;
  const { data, error } = await admin.storage.from(HARVEST_BUCKET).download(key);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

// --- the injected outside world (tests pass fakes) ---------------------------------------

export type CoaPdfReading = { certs: CoaCertificate[]; skipped: boolean; error: string | null };
export type ReadCoaPdf = (bytes: Uint8Array, label: string, priority: 0 | 1) => Promise<CoaPdfReading>;

export type GmailSearchDeps = {
  admin?: Admin;
  /** The harvester's Gmail + storage I/O (null = the mailbox is not set up). */
  io?: HarvestIo | null;
  mailbox?: string | null;
  setupError?: string | null;
  readCoaPdf?: ReadCoaPdf;
  now?: () => number;
};

/** The real Gmail (read-only, the harvest's sign-in) and the real Transfer-link fetcher. */
async function realHarvest(admin: Admin): Promise<{ io: HarvestIo | null; mailbox: string; setupError: string | null }> {
  const { harvestMailConfigFromEnv, harvestConfigLine } = await import("@/lib/pos/cultivera-mail-harvest-core");
  const cfg = harvestMailConfigFromEnv(process.env);
  if (!cfg.configured) return { io: null, mailbox: cfg.mailbox, setupError: harvestConfigLine(cfg).text };
  const { getAttachmentBytes, getGmailAccessToken, getMessage, listMessageIdsPage } = await import("@/lib/compliance/ccrs-mail-fetch");
  const { supabaseHarvestIo } = await import("@/lib/pos/cultivera-mail-harvest-store");
  const { fetchTransferJson } = await import("@/lib/inventory/transfer-fetch");
  const io = supabaseHarvestIo(
    admin,
    cfg,
    { getGmailAccessToken, listMessageIdsPage: (t, mb, q, p) => listMessageIdsPage(t, mb, q, p), getMessage, getAttachmentBytes },
    fetchTransferJson,
  );
  return { io, mailbox: cfg.mailbox.toLowerCase(), setupError: null };
}

/**
 * The real PDF reader: the PDF's own text first; a PDF whose text is clearly not a lab
 * certificate is not read further. LlamaParse only for a lab-looking (priority 0) PDF whose
 * text layer cannot identify a certificate (a scanned COA).
 */
const realReadCoaPdf: ReadCoaPdf = async (bytes, label, priority) => {
  const { extractPdfText, readCoaBundleFromBase64 } = await import("@/lib/inventory/pdf-extract");
  const { isCertificateText } = await import("@/lib/inventory/coa-gmail-search-core");
  let layer = "";
  try {
    layer = await extractPdfText(bytes.slice());
  } catch {
    layer = "";
  }
  if (layer.trim() && !isCertificateText(layer)) return { certs: [], skipped: true, error: null };
  if (!layer.trim() && priority !== 0) return { certs: [], skipped: true, error: null };
  const recover = priority === 0 ? (await import("@/lib/inbound-email/llamaparse-recovery")).llamaParseRecoverText : undefined;
  const read = await readCoaBundleFromBase64(Buffer.from(bytes).toString("base64"), label, recover);
  return { certs: read.certs, skipped: false, error: read.error };
};

// --- button 1: the targeted search ----------------------------------------------------------

type SearchRun = { totals: GmailSearchTotals; state: GmailSearchState; matchedByTarget: Map<string, string[]> };

/** Ask Gmail the target's questions, keep the new emails with the harvester. Never throws. */
async function searchTargets(
  admin: Admin,
  io: HarvestIo,
  mailbox: string,
  targets: readonly MissingTarget[],
  mode: "bulk" | "one",
  state: GmailSearchState,
  opts: { maxNew: number; budgetMs: number; now: () => number; onlyLotIds?: ReadonlySet<string> },
): Promise<SearchRun> {
  const totals = emptySearchTotals();
  totals.deliveries = targets.length;
  const matchedByTarget = new Map<string, string[]>();
  const t0 = opts.now();
  let token: string;
  try {
    token = await io.token();
  } catch (e) {
    totals.stoppedBecause = `Gmail sign-in failed (${short(e)})`;
    totals.left = targets.length;
    return { totals, state, matchedByTarget };
  }
  let opened = 0;
  let stop = false;
  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    if (stop || opts.now() - t0 > opts.budgetMs || opened >= opts.maxNew) {
      totals.left = targets.length - ti;
      if (!stop && opts.now() - t0 > opts.budgetMs) totals.stoppedBecause ??= "the time for one click ran out";
      break;
    }
    const matched = new Set<string>();
    for (const q of buildTargetQueries(t, mode, opts.onlyLotIds)) {
      try {
        const page = await io.listPage(token, q.q, null);
        totals.queries += 1;
        for (const id of page.ids.slice(0, IDS_PER_QUERY)) matched.add(id);
      } catch (e) {
        const m = short(e);
        pushErr(totals, `Gmail search: ${m}`);
        if (transientError(m)) {
          totals.stoppedBecause = "Gmail asked us to slow down; click again in a minute";
          stop = true;
          break;
        }
      }
    }
    const ids = [...matched];
    const known = ids.length > 0 ? await io.knownIds(ids) : new Set<string>();
    const fresh = ids.filter((id) => !known.has(id));
    totals.matched += ids.length;
    totals.alreadyKept += ids.length - fresh.length;
    const kept: string[] = ids.filter((id) => known.has(id));
    for (let i = 0; i < fresh.length; i++) {
      if (stop || opened >= opts.maxNew || opts.now() - t0 > opts.budgetMs) {
        totals.deferred += fresh.length - i;
        break;
      }
      try {
        const rows = await import("@/lib/pos/cultivera-mail-harvest-store").then((m) => m.harvestOneEmail(io, token, mailbox, fresh[i]));
        await io.insertRows(rows);
        opened += 1;
        totals.newEmails += 1;
        totals.documents += rows.filter((r) => r.status === "parsed" || r.status === "stored" || r.status === "unreadable").length;
        kept.push(fresh[i]);
      } catch (e) {
        const m = short(e);
        pushErr(totals, `keeping an email: ${m}`);
        if (transientError(m)) totals.stoppedBecause = "Gmail or the vendor site asked us to slow down; click again in a minute";
        else totals.stoppedBecause = m;
        totals.deferred += fresh.length - i;
        stop = true;
        break;
      }
    }
    matchedByTarget.set(t.manifestId, kept);
    state = recordSearch(state, t.manifestId, kept, new Date(opts.now()).toISOString());
    totals.searched += 1;
  }
  return { totals, state, matchedByTarget };
}

/** "Search Gmail for the missing COAs". */
export async function searchGmailForCoas(actorId: string | null, deps: GmailSearchDeps = {}): Promise<GmailSearchTotals> {
  const totals = emptySearchTotals();
  if (!deps.admin && !isSupabaseServiceConfigured) {
    pushErr(totals, "the database is not configured");
    return totals;
  }
  const admin = deps.admin ?? createSupabaseAdminClient();
  const now = deps.now ?? Date.now;
  try {
    const h = deps.io !== undefined ? { io: deps.io, mailbox: (deps.mailbox ?? "").toLowerCase(), setupError: deps.setupError ?? null } : await realHarvest(admin);
    if (!h.io) {
      pushErr(totals, `Stephen's mailbox is not set up (${h.setupError ?? "no Gmail sign-in"})`);
      return totals;
    }
    const read = await readMissingTargets(admin);
    if (!read.ok) {
      pushErr(totals, read.error);
      return totals;
    }
    const st = await readState(admin);
    if (!st.ok) pushErr(totals, `the last search could not be read (${st.error})`);
    let state = st.ok ? st.state : parseGmailSearchState(null);

    // A delivery whose every missing lot is already in a kept vendor JSON needs no search.
    const barcodes = [...new Set(read.lots.map((l) => (l.lot_code ?? "").trim()).filter(Boolean))];
    const kept = await docsByBarcodes(admin, barcodes);
    if (kept.error) pushErr(totals, `the kept emails could not be read in full (${kept.error})`);
    const inJson = new Set<string>();
    for (const d of kept.rows) if ((d.kind === "json" || d.kind === "link-json") && d.status === "parsed") for (const b of d.barcodes ?? []) inJson.add(b);
    const need = read.targets.filter((t) => !t.lots.every((l) => l.lotCode && inJson.has(l.lotCode.trim())));
    const run = await searchTargets(admin, h.io, h.mailbox, orderTargets(need, state), "bulk", state, {
      maxNew: GMAIL_SEARCH_MAX_NEW,
      budgetMs: GMAIL_SEARCH_BUDGET_MS,
      now,
    });
    state = run.state;
    const werr = await writeState(admin, state, actorId);
    if (werr) pushErr(run.totals, `the search could not be remembered (${werr})`);
    Object.assign(totals, run.totals, { errors: [...totals.errors, ...run.totals.errors].slice(0, 6) });
    totals.deliveries = read.targets.length;
    totals.coveredAlready = read.targets.length - need.length;
  } catch (e) {
    pushErr(totals, short(e));
  }
  await recordAudit({ actorId, action: COA_GMAIL_FETCH_AUDIT, entityType: "inventory_lot", entityId: null, after: { ...totals } }).catch((e: unknown) =>
    console.error("[coa-gmail] audit failed:", e),
  );
  return totals;
}

// --- button 2: attach -------------------------------------------------------------------------

export type GmailAttachOptions = GmailSearchDeps & { dryRun?: boolean; budgetMs?: number; manifestIds?: readonly string[]; audit?: boolean };

const isJsonDoc = (d: DocRow) => (d.kind === "json" || d.kind === "link-json") && Boolean(d.storage_key);
const isPdfDoc = (d: DocRow) => d.kind === "pdf" && Boolean(d.storage_key);

function addResult(t: GmailAttachTotals, r: WciaAttachResult, from: "json" | "pdf") {
  if (from === "json") t.linkedFromJson += r.linked;
  else t.linkedFromPdf += r.linked;
  t.created += r.created;
  t.reused += r.reused;
  t.skippedChanged += r.skippedChanged;
  for (const e of r.errors) pushErr(t, e);
}

/** File each newly linked emailed PDF under its lab result (private `coa` bucket). Best-effort. */
async function filePdfs(admin: Admin, plan: WciaLinkPlan, docByExt: Map<string, string>, bytesByKey: Map<string, Uint8Array>, t: GmailAttachTotals) {
  const exts = plan.externalIds;
  if (exts.length === 0) return;
  const { data, error } = await admin.from("lab_results").select("id, labtest_external_identifier, coa_url, coa_storage_path").in("labtest_external_identifier", exts);
  if (error) {
    pushErr(t, `the lab results could not be read to file their PDFs (${short(error)})`);
    return;
  }
  for (const lab of (data as { id: string; labtest_external_identifier: string | null; coa_url: string | null; coa_storage_path: string | null }[] | null) ?? []) {
    if (lab.coa_storage_path || !lab.labtest_external_identifier) continue;
    const key = docByExt.get(lab.labtest_external_identifier);
    const bytes = key ? bytesByKey.get(key) : undefined;
    if (!bytes) continue;
    const path = `${lab.id}/${lab.labtest_external_identifier.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "coa"}.pdf`;
    const up = await admin.storage.from(COA_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (up.error) {
      pushErr(t, `a COA PDF could not be filed (${short(up.error)})`);
      continue;
    }
    const { error: uerr } = await admin
      .from("lab_results")
      .update({ coa_storage_path: path, coa_file_bytes: bytes.byteLength, coa_archived_at: new Date().toISOString() })
      .eq("id", lab.id)
      .is("coa_storage_path", null);
    if (uerr) pushErr(t, `a COA PDF could not be recorded (${short(uerr)})`);
    else t.pdfsFiled += 1;
  }
}

/** "Attach COAs from Gmail" (dryRun = the preview). Never throws. */
export async function attachCoasFromGmail(actorId: string | null, opts: GmailAttachOptions = {}): Promise<GmailAttachTotals> {
  const dryRun = opts.dryRun === true;
  const t = emptyAttachTotals(dryRun);
  if (!opts.admin && !isSupabaseServiceConfigured) {
    pushErr(t, "the database is not configured");
    return t;
  }
  const admin = opts.admin ?? createSupabaseAdminClient();
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? GMAIL_ATTACH_BUDGET_MS;
  const readPdf = opts.readCoaPdf ?? realReadCoaPdf;
  const t0 = now();
  try {
    const read = await readMissingTargets(admin);
    if (!read.ok) {
      pushErr(t, read.error);
      return t;
    }
    const only = opts.manifestIds ? new Set(opts.manifestIds.map((x) => x.toLowerCase())) : null;
    const targets = only ? read.targets.filter((x) => only.has(x.manifestId.toLowerCase())) : read.targets;
    const lots: WciaLot[] = targets.flatMap((x) => x.lotRows.map((l) => ({ id: l.id, lot_code: l.lot_code, status: l.status, lab_result_id: l.lab_result_id })));
    t.missingBefore = only ? lots.length : read.lots.length;
    const barcodes = new Set(lots.map((l) => (l.lot_code ?? "").trim()).filter(Boolean));

    // Which emails: those whose documents name a missing barcode or manifest number, and those
    // the targeted search matched for these deliveries.
    const st = await readState(admin);
    if (!st.ok) pushErr(t, `the last search could not be read (${st.error})`);
    const byBc = await docsByBarcodes(admin, [...barcodes]);
    const byMn = await docsByManifestNumbers(admin, targets.map((x) => (x.manifestNumber ?? "").trim()).filter((x) => x.length >= 5));
    for (const e of [byBc.error, byMn.error]) if (e) pushErr(t, `the kept emails could not be read in full (${e})`);
    const gmailIds = new Set<string>([...byBc.rows, ...byMn.rows].map((d) => d.gmail_id));
    if (st.ok) for (const id of hitIdsFor(st.state, targets.map((x) => x.manifestId))) gmailIds.add(id);
    const all = await docsByGmailIds(admin, opts.mailbox ?? null, [...gmailIds]);
    if (all.error) pushErr(t, `the kept emails could not be read in full (${all.error})`);
    const docs = new Map<string, DocRow>();
    for (const d of [...byBc.rows, ...byMn.rows, ...all.rows]) docs.set(d.id, d);

    // (1) The URL inside the JSON: each kept JSON's own lab data for the missing barcodes.
    const linked = new Set<string>();
    const jsonByFormat = new Map<LabSourceFormat, ParsedLine[][]>();
    const jsonDocs = [...docs.values()].filter((d) => isJsonDoc(d) && (d.barcodes ?? []).some((b) => barcodes.has(b)));
    for (const d of jsonDocs.sort((a, b) => (b.email_at ?? "").localeCompare(a.email_at ?? ""))) {
      if (now() - t0 > budget) {
        t.stoppedForTime = true;
        break;
      }
      const bytes = await downloadKept(admin, d.storage_key as string).catch(() => null);
      if (!bytes) continue;
      const parsed = parseVendorJson(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""));
      if (!parsed.ok) continue;
      t.jsonDocsRead += 1;
      const list = jsonByFormat.get(parsed.manifest.source_format) ?? [];
      list.push(parsed.manifest.lines);
      jsonByFormat.set(parsed.manifest.source_format, list);
    }
    // One plan over every JSON (a barcode with two different lab ids anywhere = left alone).
    const allLines = jsonLinesForBarcodes([...jsonByFormat.values()].flat(), barcodes);
    if (allLines.length > 0) {
      const plan = planWciaLabLinks(lots, { lines: allLines });
      t.ambiguous += plan.outcomes.ambiguous;
      const fmt: LabSourceFormat = jsonByFormat.has("wcia") ? "wcia" : ([...jsonByFormat.keys()][0] ?? "wcia");
      const r = await applyWciaLinkPlan(admin, plan, fmt, actorId, emptyWciaResult("attached"), { dryRun }).catch((e: unknown) => emptyWciaResult("error", [short(e)]));
      addResult(t, r, "json");
      for (const id of r.linkedLotIds ?? []) linked.add(id);
    }

    // (2) The emailed COA PDFs: a certificate whose printed id IS the lot's barcode.
    const rest = lots.filter((l) => !linked.has(l.id));
    const restCodes = new Set(rest.map((l) => (l.lot_code ?? "").trim().toUpperCase()).filter(Boolean));
    if (rest.length > 0) {
      const pdfs = [...docs.values()]
        .filter(isPdfDoc)
        .map((d) => ({ d, p: pdfReadPriority(d.filename, d.source_format) }))
        .filter((x) => x.p !== 2)
        .sort((a, b) => a.p - b.p || (b.d.email_at ?? "").localeCompare(a.d.email_at ?? "") || a.d.id.localeCompare(b.d.id));
      const certs: ReadCert[] = [];
      const bytesByKey = new Map<string, Uint8Array>();
      const seenSha = new Set<string>();
      const covered = new Set<string>();
      for (let i = 0; i < pdfs.length; i++) {
        if ([...restCodes].every((c) => covered.has(c))) break; // every missing barcode is on a certificate already
        if (now() - t0 > budget) {
          t.stoppedForTime = true;
          t.pdfsLeft = pdfs.length - i;
          break;
        }
        const { d, p } = pdfs[i];
        const key = d.storage_key as string;
        if (seenSha.has(key)) continue;
        seenSha.add(key);
        const bytes = await downloadKept(admin, key).catch(() => null);
        if (!bytes) continue;
        let reading: CoaPdfReading;
        try {
          reading = await readPdf(bytes, d.filename || key.split("/").pop() || "coa.pdf", p as 0 | 1);
        } catch (e) {
          pushErr(t, `a PDF could not be read (${short(e)})`);
          continue;
        }
        if (reading.skipped) continue;
        t.pdfsRead += 1;
        t.certsRead += reading.certs.length;
        if (reading.certs.some((c) => c.ids.some((id) => restCodes.has(id.toUpperCase())))) bytesByKey.set(key, bytes);
        for (const c of reading.certs) {
          certs.push({ cert: c, doc: key });
          for (const id of c.ids) if (restCodes.has(id.toUpperCase())) covered.add(id.toUpperCase());
        }
      }
      const cp = planCertLinks(rest, certs);
      t.ambiguous += cp.ambiguous;
      if (cp.plan.links.length > 0) {
        const r = await applyWciaLinkPlan(admin, cp.plan, "pdf-manifest", actorId, emptyWciaResult("attached"), { dryRun }).catch((e: unknown) => emptyWciaResult("error", [short(e)]));
        addResult(t, r, "pdf");
        if (!dryRun && r.linked > 0) await filePdfs(admin, cp.plan, cp.docByExternalId, bytesByKey, t);
      }
    }

    // The honest count after the run.
    const linkedNow = t.linkedFromJson + t.linkedFromPdf;
    if (dryRun) t.stillMissing = Math.max(0, t.missingBefore - linkedNow);
    else {
      const after = await readMissingTargets(admin);
      if (after.ok) t.stillMissing = only ? after.targets.filter((x) => only.has(x.manifestId.toLowerCase())).reduce((n, x) => n + x.lots.length, 0) : after.lots.length;
      else t.stillMissing = Math.max(0, t.missingBefore - linkedNow);
    }
  } catch (e) {
    pushErr(t, short(e));
  }
  if (!dryRun && opts.audit !== false) {
    await recordAudit({ actorId, action: COA_GMAIL_ATTACH_AUDIT, entityType: "inventory_lot", entityId: null, after: { ...t, errors: t.errors } }).catch((e: unknown) =>
      console.error("[coa-gmail] audit failed:", e),
    );
  }
  return t;
}

// --- one product (or one delivery): the stubborn ones ------------------------------------------

export type OneSearchResult = {
  ok: boolean;
  label: string;
  lotLinked: boolean | null;
  emails: { at: string | null; subject: string }[];
  search: GmailSearchTotals;
  attach: GmailAttachTotals | null;
  error: string | null;
};

export function oneSearchNote(r: OneSearchResult): string {
  if (!r.ok) return `Search for ${r.label}: ${r.error ?? "it could not run"}.`;
  const s = r.search;
  const parts = [`Searched Gmail for ${r.label} (${s.queries} questions): ${s.matched} email${s.matched === 1 ? "" : "s"} matched, ${s.newEmails} newly kept.`];
  if (r.emails.length > 0) parts.push(`Found: ${r.emails.map((e) => `${(e.at ?? "").slice(0, 10)} "${e.subject.slice(0, 70)}"`).join("; ")}.`);
  if (r.attach) {
    const a = r.attach;
    const n = a.linkedFromJson + a.linkedFromPdf;
    parts.push(`Linked ${n} lot${n === 1 ? "" : "s"} on this delivery (${a.linkedFromJson} from vendor JSON, ${a.linkedFromPdf} from COA PDFs; ${a.certsRead} certificates read).`);
    if (a.ambiguous > 0) parts.push(`${a.ambiguous} left alone: two different certificates name the same barcode.`);
  }
  if (r.lotLinked === true) parts.push("This product now has its COA.");
  else if (r.lotLinked === false)
    parts.push(
      s.matched === 0
        ? "No email in Stephen's mailbox names this product, its manifest or its vendor around that date: ask the vendor for the COA."
        : "Its emails were found, but none carries a COA with this exact barcode: ask the vendor for the COA (or check the lab's site).",
    );
  if (s.deferred > 0 || (r.attach && (r.attach.stoppedForTime || r.attach.pdfsLeft > 0))) parts.push("Not finished in one click: click Search again.");
  const errs = [...s.errors, ...(r.attach?.errors ?? [])];
  if (errs.length > 0) parts.push(`Problems: ${errs.slice(0, 4).join("; ")}.`);
  return parts.join(" ");
}

/** A wider search for one lot (its barcode, manifest, vendor ±30 days), then attach its delivery. */
export async function searchGmailForOne(actorId: string | null, which: { lotId?: string | null; manifestId?: string | null }, deps: GmailSearchDeps = {}): Promise<OneSearchResult> {
  const out: OneSearchResult = { ok: false, label: "this product", lotLinked: null, emails: [], search: emptySearchTotals(), attach: null, error: null };
  if (!deps.admin && !isSupabaseServiceConfigured) return { ...out, error: "the database is not configured" };
  const admin = deps.admin ?? createSupabaseAdminClient();
  const now = deps.now ?? Date.now;
  try {
    const read = await readMissingTargets(admin);
    if (!read.ok) return { ...out, error: read.error };
    const lotId = (which.lotId ?? "").toLowerCase();
    const mid = (which.manifestId ?? "").toLowerCase();
    const target = read.targets.find((x) => (lotId ? x.lots.some((l) => l.id.toLowerCase() === lotId) : x.manifestId.toLowerCase() === mid));
    if (!target) return { ...out, ok: true, lotLinked: lotId ? true : null, error: null, label: lotId ? "this product" : "this delivery" };
    const lot = lotId ? target.lotRows.find((l) => l.id.toLowerCase() === lotId) : undefined;
    out.label = lot ? `${(lot.product_name ?? "this product").slice(0, 60)} (${lot.lot_code ?? "no barcode"})` : `${target.vendorLabel ?? "this delivery"} ${target.manifestNumber ?? ""}`.trim();
    const h = deps.io !== undefined ? { io: deps.io, mailbox: (deps.mailbox ?? "").toLowerCase(), setupError: deps.setupError ?? null } : await realHarvest(admin);
    if (!h.io) return { ...out, error: `Stephen's mailbox is not set up (${h.setupError ?? "no Gmail sign-in"})` };
    const st = await readState(admin);
    const run = await searchTargets(admin, h.io, h.mailbox, [target], "one", st.ok ? st.state : parseGmailSearchState(null), {
      maxNew: GMAIL_ONE_MAX_NEW,
      budgetMs: GMAIL_ONE_SEARCH_BUDGET_MS,
      now,
      onlyLotIds: lot ? new Set([lot.id]) : undefined,
    });
    out.search = run.totals;
    if (!st.ok) pushErr(out.search, `the last search could not be read (${st.error})`);
    const werr = await writeState(admin, run.state, actorId);
    if (werr) pushErr(out.search, `the search could not be remembered (${werr})`);
    const ids = run.matchedByTarget.get(target.manifestId) ?? [];
    if (ids.length > 0) {
      const docs = await docsByGmailIds(admin, h.mailbox || null, ids);
      const firstByEmail = new Map<string, { at: string | null; subject: string }>();
      for (const d of docs.rows.sort((a, b) => (b.email_at ?? "").localeCompare(a.email_at ?? "")))
        if (!firstByEmail.has(d.gmail_id)) firstByEmail.set(d.gmail_id, { at: d.email_at, subject: d.subject ?? "" });
      out.emails = [...firstByEmail.values()].slice(0, 6);
    }
    out.attach = await attachCoasFromGmail(actorId, { ...deps, admin, manifestIds: [target.manifestId], audit: false, budgetMs: 150_000 });
    if (lot) {
      const { data, error } = await admin.from("inventory_lots").select("id, lab_result_id").eq("id", lot.id).maybeSingle();
      if (error) pushErr(out.search, `the product could not be re-read (${short(error)})`);
      else out.lotLinked = Boolean((data as { lab_result_id: string | null } | null)?.lab_result_id);
    }
    out.ok = true;
  } catch (e) {
    out.error = short(e);
  }
  await recordAudit({
    actorId,
    action: COA_GMAIL_ONE_AUDIT,
    entityType: which.lotId ? "inventory_lot" : "inbound_manifest",
    entityId: which.lotId ?? which.manifestId ?? null,
    after: { ok: out.ok, lotLinked: out.lotLinked, search: out.search, attach: out.attach, error: out.error },
  }).catch((e: unknown) => console.error("[coa-gmail] audit failed:", e));
  return out;
}

// --- the card -------------------------------------------------------------------------------------

export type GmailPanelRow = { manifestId: string; manifestNumber: string | null; vendorLabel: string | null; transferDate: string | null; lots: number; searchedAt: string | null; emails: number };
export type GmailPanel = { ok: boolean; error: string | null; missingLots: number; rows: GmailPanelRow[]; updatedAt: string | null };

/** The deliveries still missing COAs, with when each was last searched (never throws). */
export async function readGmailPanel(): Promise<GmailPanel> {
  const empty: GmailPanel = { ok: false, error: null, missingLots: 0, rows: [], updatedAt: null };
  if (!isSupabaseServiceConfigured) return { ...empty, error: "the database is not configured" };
  try {
    const admin = createSupabaseAdminClient();
    const [read, st] = await Promise.all([readMissingTargets(admin), readState(admin)]);
    if (!read.ok) return { ...empty, error: read.error };
    const state = st.ok ? st.state : parseGmailSearchState(null);
    const rows = read.targets
      .map((x) => {
        const h = state.hits[x.manifestId.toLowerCase()];
        return { manifestId: x.manifestId, manifestNumber: x.manifestNumber, vendorLabel: x.vendorLabel, transferDate: x.transferDate, lots: x.lots.length, searchedAt: h?.at ?? null, emails: h?.ids.length ?? 0 };
      })
      .sort((a, b) => b.lots - a.lots || (a.vendorLabel ?? "").localeCompare(b.vendorLabel ?? ""));
    return { ok: true, error: st.ok ? null : `the last search could not be read (${st.error})`, missingLots: read.lots.length, rows, updatedAt: state.updatedAt };
  } catch (e) {
    return { ...empty, error: short(e) };
  }
}
