/**
 * src/lib/inventory/coa-gmail-deep-store.ts   (D203)
 *
 * "Deep dig" on Inventory > Fix later (the last deliveries whose JSON was never found):
 *
 *   1. for each delivery still missing COAs, the DEEP questions of coa-gmail-deep-core
 *      (manifest forms, the LCB manifest id, every barcode form, the vendor's license,
 *      vendor + brand words, the people who sent this vendor's mail before, any JSON /
 *      zip near the date), Spam and Trash included;
 *   2. every matched email AND every other message of its thread (the JSON is often a
 *      reply): a new one is kept by the existing harvester first; then each is RE-READ IN
 *      FULL: attachments the first harvest did not take (zip -> its files, .txt /
 *      octet-stream judged by their bytes, the 11th+ file), a JSON pasted into the text,
 *      and every public link (fetched as a transfer JSON, or as a PDF);
 *   3. new documents are stored like the harvest's (pos-raw mail-harvest/..., rows at
 *      doc_index 100+, ON CONFLICT DO NOTHING) and the emails are remembered for the
 *      D201 attach of that delivery;
 *   4. the D201 attach runs for those deliveries: the JSON's own lab data, then a COA PDF
 *      whose printed id IS the barcode. Fill-only, exact barcode, never a name.
 *
 * Gmail is read-only. Writes: pos-raw, cultivera_mail_docs (insert only), site_settings
 * (coa_gmail_deep + the D201 search memory), and what the D201 attach writes. Never throws.
 */
import "server-only";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { recordAudit } from "@/lib/auth/audit";
import { walkMessage, type GmailMessage } from "@/lib/compliance/ccrs-mail-core";
import { attachmentKind, bytesMatchKind, sniffKind } from "@/lib/pos/cultivera-mail-harvest-core";
import type { HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";
import {
  HARVEST_DOCS_TABLE,
  contentTypeFor,
  harvestDocKey,
  linkFilename,
  messageBodies,
  messageMeta,
  parseHarvestedDoc,
  storedDocRow,
  transientError,
  type DocKind,
  type DocSource,
  type HarvestDocRow,
} from "@/lib/pos/cultivera-mail-harvest-run-core";
import { parseGmailSearchState, recordSearch, hitIdsFor } from "@/lib/inventory/coa-gmail-search-core";
import {
  attachCoasFromGmail,
  docsByBarcodes,
  docsByGmailIds,
  readMissingTargets,
  readState,
  realHarvest,
  writeState,
  type GmailSearchDeps,
  type MissingTarget,
} from "@/lib/inventory/coa-gmail-search-store";
import {
  COA_GMAIL_DEEP_AUDIT,
  COA_GMAIL_DEEP_KEY,
  COA_GMAIL_DEEP_LABEL,
  DEEP_ATTACH_BUDGET_MS,
  DEEP_IDS_PER_QUERY,
  DEEP_MAX_EMAILS,
  DEEP_SEARCH_BUDGET_MS,
  buildDeepQueries,
  deepIndex,
  emptyDeepDelivery,
  emptyDeepTotals,
  jsonInBody,
  markDug,
  markTarget,
  orderDeepTargets,
  parseDeepState,
  planDeepAttachments,
  planDeepLinks,
  pushDeepErr,
  zipEntriesToKeep,
  type DeepDelivery,
  type DeepState,
  type DeepTarget,
  type DeepTotals,
} from "@/lib/inventory/coa-gmail-deep-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 160);

/** Messages of one thread taken per matched email (a long back-and-forth is rare). */
const THREAD_MATES_MAX = 8;
/** History used to learn who sends this vendor's mail. */
const HISTORY_MANIFESTS = 12;

export type PdfFetch = (url: string) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>;
export type DeepDeps = GmailSearchDeps & {
  threadIds?: (token: string, threadId: string) => Promise<string[]>;
  fetchPdf?: PdfFetch;
};

// --- a small, safe unzip (node:zlib; stored + deflate only) ------------------------------------

/** The files of a zip (at most 20 kept, each at most 25 MB unpacked). Never throws; [] when unreadable. */
export function unzipEntries(buf: Uint8Array): { name: string; bytes: Uint8Array }[] {
  try {
    const b = Buffer.from(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
    if (eocd < 0) return [];
    const count = b.readUInt16LE(eocd + 10);
    let p = b.readUInt32LE(eocd + 16);
    const all: { name: string; method: number; csize: number; usize: number; local: number }[] = [];
    for (let k = 0; k < count && k < 500 && p + 46 <= b.length; k++) {
      if (b.readUInt32LE(p) !== 0x02014b50) break;
      const method = b.readUInt16LE(p + 10);
      const csize = b.readUInt32LE(p + 20);
      const usize = b.readUInt32LE(p + 24);
      const nlen = b.readUInt16LE(p + 28);
      const elen = b.readUInt16LE(p + 30);
      const clen = b.readUInt16LE(p + 32);
      const local = b.readUInt32LE(p + 42);
      all.push({ name: b.subarray(p + 46, p + 46 + nlen).toString("utf8"), method, csize, usize, local });
      p += 46 + nlen + elen + clen;
    }
    const keep = new Set(zipEntriesToKeep(all.map((e) => e.name)));
    const out: { name: string; bytes: Uint8Array }[] = [];
    for (const e of all) {
      if (!keep.has(e.name) || e.usize > 25_000_000 || e.local + 30 > b.length || b.readUInt32LE(e.local) !== 0x04034b50) continue;
      const start = e.local + 30 + b.readUInt16LE(e.local + 26) + b.readUInt16LE(e.local + 28);
      const raw = b.subarray(start, start + e.csize);
      const bytes = e.method === 0 ? raw : e.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 25_000_000 }) : null;
      if (bytes) out.push({ name: e.name.split("/").pop() || e.name, bytes: new Uint8Array(bytes) });
    }
    return out;
  } catch {
    return [];
  }
}

// --- the extra facts the deep questions need ----------------------------------------------------

type FromRow = { gmail_id: string; from_header: string | null; filename: string | null; subject: string | null; email_at: string | null };

async function fromRows(admin: Admin, ids: readonly string[]): Promise<{ rows: FromRow[]; error: string | null }> {
  let err: string | null = null;
  const rows = await chunkedIn<string, FromRow & { id: string }>([...new Set(ids)], async (part, from, to) => {
    const { data, error } = await admin.from(HARVEST_DOCS_TABLE).select("id, gmail_id, from_header, filename, subject, email_at").in("gmail_id", part).order("id", { ascending: true }).range(from, to);
    if (error) err ??= short(error);
    return (data as (FromRow & { id: string })[] | null) ?? [];
  });
  return { rows, error: err };
}

/**
 * For each delivery: its vendor's license and email, the people who sent this vendor's
 * mail (earlier deliveries' kept documents) and the kept LCB manifest PDFs.
 */
async function deepTargets(admin: Admin, targets: readonly MissingTarget[], hits: (mid: string) => string[], errors: { errors: string[] }): Promise<DeepTarget[]> {
  const ids = targets.map((t) => t.manifestId);
  const { data: mrows, error: merr } = await admin.from("inbound_manifests").select("id, vendor_id").in("id", ids);
  if (merr) pushDeepErr(errors, `the deliveries' vendors could not be read (${short(merr)})`);
  const vendorOf = new Map(((mrows as { id: string; vendor_id: string | null }[] | null) ?? []).map((r) => [r.id, r.vendor_id]));
  const vendorIds = [...new Set([...vendorOf.values()].filter((x): x is string => Boolean(x)))];
  const vendors = new Map<string, { license_number: string | null; email: string | null }>();
  const history = new Map<string, string[]>(); // vendor id -> earlier manifest ids
  if (vendorIds.length > 0) {
    const { data: vrows, error: verr } = await admin.from("vendors").select("id, license_number, email").in("id", vendorIds);
    if (verr) pushDeepErr(errors, `the vendors could not be read (${short(verr)})`);
    for (const v of (vrows as { id: string; license_number: string | null; email: string | null }[] | null) ?? []) vendors.set(v.id, v);
    for (const vid of vendorIds) {
      const { data: hrows, error: herr } = await admin
        .from("inbound_manifests")
        .select("id, transfer_date")
        .eq("vendor_id", vid)
        .order("transfer_date", { ascending: false })
        .range(0, HISTORY_MANIFESTS);
      if (herr) pushDeepErr(errors, `the vendor's earlier deliveries could not be read (${short(herr)})`);
      history.set(vid, ((hrows as { id: string }[] | null) ?? []).map((r) => r.id).filter((x) => !ids.includes(x)));
    }
  }
  // Earlier deliveries' barcodes -> the emails that carried them -> who sent them.
  const earlierIds = [...new Set([...history.values()].flat())];
  const earlierLots = await chunkedIn<string, { id: string; manifest_id: string; lot_code: string | null }>(earlierIds, async (part, from, to) => {
    const { data, error } = await admin.from("inventory_lots").select("id, manifest_id, lot_code").in("manifest_id", part).order("id", { ascending: true }).range(from, to);
    if (error) pushDeepErr(errors, `earlier lots could not be read (${short(error)})`);
    return (data as { id: string; manifest_id: string; lot_code: string | null }[] | null) ?? [];
  });
  const codesByVendor = new Map<string, string[]>();
  for (const [vid, mids] of history) {
    const set = new Set(mids);
    codesByVendor.set(vid, earlierLots.filter((l) => set.has(l.manifest_id) && l.lot_code).map((l) => (l.lot_code as string).trim()));
  }
  const allCodes = [...new Set([...codesByVendor.values()].flat())];
  const docs = allCodes.length > 0 ? await docsByBarcodes(admin, allCodes) : { rows: [], error: null };
  if (docs.error) pushDeepErr(errors, `earlier emails could not be read (${docs.error})`);
  const hitIds = [...new Set(ids.flatMap((m) => hits(m)))];
  const fr = await fromRows(admin, [...new Set([...docs.rows.map((d) => d.gmail_id), ...hitIds])]);
  if (fr.error) pushDeepErr(errors, `earlier senders could not be read (${fr.error})`);
  const fromById = new Map<string, FromRow[]>();
  for (const r of fr.rows) fromById.set(r.gmail_id, [...(fromById.get(r.gmail_id) ?? []), r]);

  return targets.map((t) => {
    const vid = vendorOf.get(t.manifestId) ?? null;
    const v = vid ? vendors.get(vid) : undefined;
    const codes = new Set(vid ? (codesByVendor.get(vid) ?? []) : []);
    const vendorEmails = docs.rows.filter((d) => (d.barcodes ?? []).some((b) => codes.has(b))).map((d) => d.gmail_id);
    const mine = hits(t.manifestId);
    const froms = [...vendorEmails, ...mine].flatMap((id) => (fromById.get(id) ?? []).map((r) => r.from_header ?? "")).filter(Boolean);
    const lcb = mine.flatMap((id) => (fromById.get(id) ?? []).map((r) => r.filename ?? "")).filter((n) => /^Manifest_/i.test(n));
    return {
      ...t,
      vendorLicense: v?.license_number ?? null,
      vendorEmail: v?.email ?? null,
      productNames: t.lotRows.map((l) => l.product_name ?? "").filter(Boolean),
      knownFroms: [...new Set(froms)],
      lcbFilenames: [...new Set(lcb)],
    };
  });
}

async function readDeep(admin: Admin): Promise<{ state: DeepState; error: string | null }> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", COA_GMAIL_DEEP_KEY).maybeSingle();
  return { state: parseDeepState((data as { value_json?: unknown } | null)?.value_json), error: error ? short(error) : null };
}

async function writeDeep(admin: Admin, s: DeepState, actorId: string | null): Promise<string | null> {
  const { error } = await admin.from("site_settings").upsert({ key: COA_GMAIL_DEEP_KEY, label: COA_GMAIL_DEEP_LABEL, value_json: s, updated_by: actorId }, { onConflict: "key" });
  return error ? short(error) : null;
}

// --- one email, re-read in full ------------------------------------------------------------------

type DigOut = { rows: HarvestDocRow[]; json: number; pdf: number; threadId: string | null };

/**
 * Everything one email may hold that the first harvest did not take. Throws only for a
 * transient Gmail / site error (the caller stops; nothing of this email is written).
 */
export async function digOneEmail(io: HarvestIo, fetchPdf: PdfFetch, token: string, mailbox: string, gmailId: string, keptNames: ReadonlySet<string>): Promise<DigOut> {
  const msg: GmailMessage = await io.getMessage(token, gmailId);
  const meta = messageMeta(msg);
  const base = { mailbox, gmailId, meta };
  const walked = walkMessage(msg.payload);
  const bodies = messageBodies(msg.payload);
  const out: DigOut = { rows: [], json: 0, pdf: 0, threadId: msg.threadId ?? null };
  let n = 0;
  const pending: { name: string; kind: Exclude<DocKind, "none">; source: DocSource; bytes: Uint8Array }[] = [];

  /** Decide what some bytes are; keep a parsed vendor JSON / CSV, any PDF or spreadsheet. */
  const consider = (name: string, bytes: Uint8Array, source: DocSource, hint: Exclude<DocKind, "none"> | null) => {
    const sniff = sniffKind(bytes);
    if (sniff === "empty") return;
    if (sniff === "pdf") return void pending.push({ name: /\.pdf$/i.test(name) ? name : `${name}.pdf`, kind: "pdf", source, bytes });
    if (sniff === "json") {
      const kind = source === "link" ? "link-json" : "json";
      if (parseHarvestedDoc(kind, bytes).status === "parsed") pending.push({ name: /\.json$/i.test(name) ? name : `${name}.json`, kind, source, bytes });
      return;
    }
    if (sniff === "zip" && hint === "xlsx") return void pending.push({ name, kind: "xlsx", source, bytes });
    if (sniff === "text" && (hint === "csv" || /\.(txt|csv)$/i.test(name)) && parseHarvestedDoc("csv", bytes).status === "parsed")
      pending.push({ name: /\.csv$/i.test(name) ? name : `${name}.csv`, kind: "csv", source, bytes });
  };

  // (a) attachments the first harvest did not keep.
  for (const a of planDeepAttachments(walked.attachments, keptNames).take) {
    let bytes: Uint8Array;
    try {
      bytes = await io.getAttachment(token, gmailId, a.ref);
    } catch (e) {
      if (transientError(short(e))) throw e;
      continue;
    }
    if (a.take === "zip") {
      for (const f of unzipEntries(bytes)) consider(`${a.ref.filename.replace(/\.zip$/i, "")}-${f.name}`, f.bytes, "attachment", attachmentKind({ filename: f.name, mimeType: "" }));
    } else if (a.take === "doc") {
      const kind = attachmentKind(a.ref);
      if (kind && bytesMatchKind(kind, bytes).ok) consider(a.ref.filename, bytes, "attachment", kind);
      else consider(a.ref.filename, bytes, "attachment", null);
    } else consider(a.ref.filename, bytes, "attachment", null);
  }
  // (b) a JSON pasted into the text.
  const pasted = jsonInBody(bodies.text || walked.text);
  if (pasted) consider("email-body.json", new TextEncoder().encode(pasted), "email", null);
  // (c) every public link: a transfer JSON, else a PDF.
  for (const l of planDeepLinks(bodies.html, bodies.text)) {
    if (l.as === "json") {
      const got = await io.fetchLink(l.url);
      if (got.ok) {
        consider(linkFilename(l.url), new TextEncoder().encode(got.jsonText), "link", null);
        continue;
      }
      if (transientError(got.error)) throw new Error(`a link in the email: ${got.error}`);
      if (!/download|export=download|dl=1|\/coa|\/file|\/attachments?\//i.test(l.url)) continue;
    }
    const pdf = await fetchPdf(l.url);
    if (pdf.ok) consider(linkFilename(l.url).replace(/\.json$/i, ".pdf"), pdf.bytes, "attachment", "pdf");
    else if (transientError(pdf.error)) throw new Error(`a link in the email: ${pdf.error}`);
  }
  // Store and describe each new document (doc_index 100+).
  const seen = new Set<string>();
  for (const d of pending) {
    const sha256 = crypto.createHash("sha256").update(d.bytes).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    const index = deepIndex(n++);
    const key = index === null ? null : harvestDocKey(mailbox, gmailId, index, d.name);
    if (index === null || !key) continue;
    await io.upload(key, d.bytes, contentTypeFor(d.kind));
    out.rows.push(storedDocRow(base, index, d.name, d.kind, d.source, { key, bytes: d.bytes.byteLength, sha256 }, parseHarvestedDoc(d.kind, d.bytes)));
    if (d.kind === "pdf") out.pdf += 1;
    else out.json += 1;
  }
  return out;
}

// --- the button ------------------------------------------------------------------------------------

export type DeepDigOptions = DeepDeps & { manifestIds?: readonly string[]; searchBudgetMs?: number; attachBudgetMs?: number; maxEmails?: number };

/** "Deep dig" (all deliveries still missing COAs, or the ones named). Never throws. */
export async function deepDigGmail(actorId: string | null, opts: DeepDigOptions = {}): Promise<DeepTotals> {
  const t = emptyDeepTotals();
  if (!opts.admin && !isSupabaseServiceConfigured) {
    pushDeepErr(t, "the database is not configured");
    return t;
  }
  const admin = opts.admin ?? createSupabaseAdminClient();
  const now = opts.now ?? Date.now;
  const budget = opts.searchBudgetMs ?? DEEP_SEARCH_BUDGET_MS;
  const maxEmails = opts.maxEmails ?? DEEP_MAX_EMAILS;
  const t0 = now();
  try {
    const h = opts.io !== undefined ? { io: opts.io, mailbox: (opts.mailbox ?? "").toLowerCase(), setupError: opts.setupError ?? null } : await realHarvest(admin);
    if (!h.io) {
      pushDeepErr(t, `Stephen's mailbox is not set up (${h.setupError ?? "no Gmail sign-in"})`);
      return t;
    }
    const io = h.io;
    const read = await readMissingTargets(admin);
    if (!read.ok) {
      pushDeepErr(t, read.error);
      return t;
    }
    const only = opts.manifestIds ? new Set(opts.manifestIds.map((x) => x.toLowerCase())) : null;
    const missing = read.targets.filter((x) => !x.manifestId.startsWith("lot:") && (!only || only.has(x.manifestId.toLowerCase())));
    if (missing.length === 0) return t;

    const st = await readState(admin);
    if (!st.ok) pushDeepErr(t, `the last search could not be read (${st.error})`);
    let gstate = st.ok ? st.state : parseGmailSearchState(null);
    const deep = await readDeep(admin);
    if (deep.error) pushDeepErr(t, `the deep-dig memory could not be read (${deep.error})`);
    let dstate = deep.state;

    const targets = orderDeepTargets(await deepTargets(admin, missing, (m) => hitIdsFor(gstate, [m]), t), dstate);
    const threadIds: (tok: string, thread: string) => Promise<string[]> =
      opts.threadIds ??
      (opts.io !== undefined
        ? async () => [] as string[]
        : async (tok: string, thread: string) => (await import("@/lib/compliance/ccrs-mail-fetch")).getThreadMessageIds(tok, h.mailbox, thread));
    const fetchPdf: PdfFetch =
      opts.fetchPdf ??
      (async (url) => {
        const r = await (await import("@/lib/inventory/transfer-fetch")).fetchPdfBytes(url);
        return r.ok ? { ok: true, bytes: new Uint8Array(Buffer.from(r.base64, "base64")) } : { ok: false, error: r.error };
      });
    const { harvestOneEmail } = await import("@/lib/pos/cultivera-mail-harvest-store");

    let token: string;
    try {
      token = await io.token();
    } catch (e) {
      pushDeepErr(t, `Gmail sign-in failed (${short(e)})`);
      return t;
    }
    let opened = 0;
    let stop: string | null = null;
    const touched: string[] = [];
    const byId = new Map<string, DeepDelivery>();
    for (const target of targets) {
      const d = emptyDeepDelivery(target);
      byId.set(target.manifestId, d);
      t.deliveries.push(d);
    }
    for (const target of targets) {
      const d = byId.get(target.manifestId) as DeepDelivery;
      if (stop) break;
      if (now() - t0 > budget || opened >= maxEmails) {
        stop = now() - t0 > budget ? "the time for one click ran out" : `${maxEmails} emails were re-read`;
        break;
      }
      touched.push(target.manifestId);
      // (1) the deep questions.
      const matched = new Set<string>(hitIdsFor(gstate, [target.manifestId]));
      const nearOnly = new Set<string>();
      for (const q of buildDeepQueries(target)) {
        try {
          const page = await io.listPage(token, q.q, null);
          d.queries += 1;
          for (const id of page.ids.slice(0, DEEP_IDS_PER_QUERY)) {
            if (q.why === "json-near-date" && !matched.has(id)) nearOnly.add(id);
            else matched.add(id);
          }
        } catch (e) {
          const m = short(e);
          pushDeepErr(t, `Gmail search: ${m}`);
          if (transientError(m)) {
            stop = "Gmail asked us to slow down; click again in a minute";
            break;
          }
        }
      }
      // "Any JSON near the date" matches every vendor: only emails never kept are opened.
      const knownNear = nearOnly.size > 0 ? await io.knownIds([...nearOnly]) : new Set<string>();
      for (const id of nearOnly) if (!knownNear.has(id)) matched.add(id);
      d.matched = matched.size;

      // (2) keep the new ones, then re-read every one (and its thread) in full.
      const queue = [...matched];
      const inQueue = new Set(queue);
      const dugNow: string[] = [];
      for (let i = 0; i < queue.length && !stop; i++) {
        const id = queue[i];
        if (dstate.dug[id]) continue;
        if (opened >= maxEmails || now() - t0 > budget) {
          stop = now() - t0 > budget ? "the time for one click ran out" : `${maxEmails} emails were re-read`;
          break;
        }
        try {
          const known = await io.knownIds([id]);
          if (!known.has(id)) {
            await io.insertRows(await harvestOneEmail(io, token, h.mailbox, id));
            d.newEmails += 1;
          } else d.reread += 1;
          const kept = await docsByGmailIds(admin, h.mailbox || null, [id]);
          const keptNames = new Set(kept.rows.filter((r) => r.status === "parsed" || r.status === "stored" || r.status === "unreadable").map((r) => (r.filename ?? "").toLowerCase()));
          const dug = await digOneEmail(io, fetchPdf, token, h.mailbox, id, keptNames);
          if (dug.rows.length > 0) await io.insertRows(dug.rows);
          d.newJson += dug.json;
          d.newPdf += dug.pdf;
          opened += 1;
          dugNow.push(id);
          if (dug.threadId) {
            const mates = await threadIds(token, dug.threadId).catch((e: unknown) => {
              if (transientError(short(e))) throw e;
              return [] as string[];
            });
            for (const m of mates.slice(0, THREAD_MATES_MAX)) if (!inQueue.has(m)) {
              inQueue.add(m);
              queue.push(m);
              d.threadMates += 1;
            }
          }
        } catch (e) {
          const m = short(e);
          pushDeepErr(t, `reading an email: ${m}`);
          stop = transientError(m) ? "Gmail or a vendor site asked us to slow down; click again in a minute" : m;
        }
      }
      d.matched = inQueue.size;
      dstate = markDug(dstate, dugNow, new Date(now()).toISOString());
      gstate = recordSearch(gstate, target.manifestId, queue.filter((id) => dstate.dug[id]), new Date(now()).toISOString());
      if (!stop) dstate = markTarget(dstate, target.manifestId, new Date(now()).toISOString());
    }
    t.unfinished = stop !== null;
    t.stoppedBecause = stop;
    const e1 = await writeDeep(admin, dstate, actorId);
    if (e1) pushDeepErr(t, `the deep dig could not be remembered (${e1})`);
    const e2 = await writeState(admin, gstate, actorId);
    if (e2) pushDeepErr(t, `the search could not be remembered (${e2})`);

    // (3) attach for the deliveries dug this click.
    if (touched.length > 0) {
      const a = await attachCoasFromGmail(actorId, { ...opts, admin, manifestIds: touched, audit: false, budgetMs: opts.attachBudgetMs ?? DEEP_ATTACH_BUDGET_MS });
      t.linkedFromJson = a.linkedFromJson;
      t.linkedFromPdf = a.linkedFromPdf;
      for (const e of a.errors) pushDeepErr(t, e);
      if (a.stoppedForTime || a.pdfsLeft > 0) {
        t.unfinished = true;
        t.stoppedBecause ??= "the COA PDFs were not all read";
      }
    }

    // (4) the honest picture per delivery.
    const after = await readMissingTargets(admin);
    const left = new Map(after.ok ? after.targets.map((x) => [x.manifestId, x.lots.length]) : []);
    t.stillMissing = after.ok ? targets.reduce((s, x) => s + (left.get(x.manifestId) ?? 0), 0) : 0;
    const ids = targets.flatMap((x) => hitIdsFor(gstate, [x.manifestId]));
    const fr = await fromRows(admin, ids);
    for (const target of targets) {
      const d = byId.get(target.manifestId) as DeepDelivery;
      if (after.ok) d.lotsAfter = left.get(target.manifestId) ?? 0;
      const codes = target.lots.map((l) => (l.lotCode ?? "").trim()).filter(Boolean);
      const j = codes.length > 0 ? await docsByBarcodes(admin, codes) : { rows: [], error: null };
      d.jsonNamingLots = j.rows.filter((r) => (r.kind === "json" || r.kind === "link-json") && r.status === "parsed").length;
      const mine = new Set(hitIdsFor(gstate, [target.manifestId]));
      const first = new Map<string, { at: string | null; from: string | null; subject: string }>();
      for (const r of fr.rows.filter((x) => mine.has(x.gmail_id)).sort((a, b) => (b.email_at ?? "").localeCompare(a.email_at ?? "")))
        if (!first.has(r.gmail_id) && !/lcb\.wa\.gov/i.test(r.from_header ?? "")) first.set(r.gmail_id, { at: r.email_at, from: r.from_header, subject: r.subject ?? "" });
      d.emails = [...first.values()].slice(0, 4);
    }
  } catch (e) {
    pushDeepErr(t, short(e));
  }
  await recordAudit({ actorId, action: COA_GMAIL_DEEP_AUDIT, entityType: "inventory_lot", entityId: null, after: { ...t } }).catch((e: unknown) =>
    console.error("[coa-gmail-deep] audit failed:", e),
  );
  return t;
}
