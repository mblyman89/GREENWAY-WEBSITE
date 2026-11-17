/**
 * src/lib/pos/pdf-gemini-read.ts   (D247 part A)
 *
 * Owner: "yes lets have gemini batch read these pdfs ... run from the back office, and runs on the
 * server ... help with the merge vendor logic".
 *
 * Server half of "Gemini reads the unreadable vendor PDFs in the background". Decisions live in the
 * pure pdf-gemini-read-core.ts. This file:
 *
 *   armPdfReadNow(actorId)      the Start button: queue every unreadable vendor PDF
 *   pausePdfReadNow(actorId)    the Pause button (PDFs in flight are finished and written)
 *   runPdfGeminiRead({budgetMs}) one run: take the lease, read PDFs (four at a time, oldest first)
 *                               until the budget is spent, add the counts, release the lease
 *   loadPdfReadStatus()         the status line on Vendors -> Ledger
 *
 * WHAT IT WRITES. Only cultivera_mail_docs rows that are status 'unreadable', kind 'pdf': it fills
 * vendor_label / vendor_license / barcodes (the columns the table's checks already allow on an
 * unreadable row) and puts "Gemini read <date> (<model>): ..." in front of the old note. The row
 * stays 'unreadable' (it is still not a manifest the menu can import), so nothing downstream that
 * reads 'parsed' rows changes. The vendor ledger reads these rows as extra evidence (D247).
 * Every row is written once: the note prefix is the "already read" mark, so a too-large or broken
 * PDF is marked too and never sent again.
 *
 * WHO RUNS IT. The button press (PDF_READ_PRESS_BUDGET_MS, after the response so the click is
 * instant) and the existing every-minute worker /api/cron/lookup-jobs on a tick with time left
 * (PDF_READ_CRON_BUDGET_MS). No new cron.
 *
 * SAFETY. One site_settings row holds the state; every write is a compare-and-swap on updated_at; a
 * run holds a lease so two runs never read at once; between pages the run re-reads the state and
 * stops when paused or restarted. Each row update is guarded by status='unreadable' and "note not
 * yet Gemini read". The monthly AI budget is checked before every page. A Gemini SERVICE failure
 * (no key, 401/403, 429, 5xx, network) stops the run without marking the PDF, and after
 * PDF_READ_MAX_FAILED_RUNS failed runs in a row the reader pauses itself with the reason shown.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { gemini } from "@/lib/ai/gemini-http";
import { geminiApiKey } from "@/lib/ai/provider";
import { readGenerateContentResponse } from "@/lib/ai/gemini-batch-core";
import { logAiUsage } from "@/lib/ai/usage";
import { getBudgetStatus } from "@/lib/ai/router";
import { HARVEST_BUCKET } from "@/lib/pos/cultivera-mail-harvest-run-core";
import {
  PDF_READ_AUDIT,
  PDF_READ_CONCURRENCY,
  PDF_READ_KEY,
  PDF_READ_LABEL,
  PDF_READ_MAX_BYTES,
  PDF_READ_MODEL_ENV,
  PDF_READ_NOTE_PREFIX,
  PDF_READ_PAGE,
  PDF_READ_PRESS_BUDGET_MS,
  armPdfRead,
  buildPdfReadRequest,
  cleanPdfReadAnswer,
  ownsPdfRead,
  parsePdfRead,
  pausePdfRead,
  pdfReadDecision,
  pdfReadModel,
  pdfReadRowPatch,
  pdfReadRunNote,
  pdfReadStatus,
  recordPdfReadRun,
  releasePdfReadLease,
  takePdfReadLease,
  type PdfReadDecision,
  type PdfReadRun,
  type PdfReadState,
  type PdfReadTone,
} from "@/lib/pos/pdf-gemini-read-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const CAS_TRIES = 4;
/** Rows not yet read: unreadable PDFs with a stored file whose note is not already "Gemini read...". */
const NOT_READ_YET = `note.is.null,note.not.like.${PDF_READ_NOTE_PREFIX}*`;
/** A PDF waiting this long is still finished; the run stops STARTING new ones this long before the budget. */
const START_MARGIN_MS = 130_000;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 200);

type Snapshot = { state: PdfReadState; updatedAt: string | null };

export async function readPdfRead(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", PDF_READ_KEY).maybeSingle();
  if (error) throw new Error(`The PDF reader state could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parsePdfRead(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

async function casWrite(admin: Admin, snap: Snapshot, next: PdfReadState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: PDF_READ_KEY, label: PDF_READ_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The PDF reader state could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin.from("site_settings").update({ value_json: next, updated_by: actorId }).eq("key", PDF_READ_KEY).eq("updated_at", snap.updatedAt).select("key");
  if (error) throw new Error(`The PDF reader state could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

async function mutate(admin: Admin, actorId: string | null, change: (s: PdfReadState) => PdfReadState | null): Promise<PdfReadState | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readPdfRead(admin);
    const next = change(snap.state);
    if (!next) return null;
    if (await casWrite(admin, snap, next, actorId)) return next;
  }
  throw new Error("The PDF reader state kept changing while it was being saved. Try again.");
}

export async function armPdfReadNow(actorId: string | null, deps: { admin?: Admin; nowIso?: string } = {}): Promise<PdfReadState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const s = await mutate(admin, actorId, (cur) => armPdfRead(cur, actorId, deps.nowIso ?? new Date().toISOString()));
  await recordAudit({ actorId, action: PDF_READ_AUDIT.armed, entityType: "site_setting", entityId: null, after: { generation: s?.generation ?? null } }).catch(() => {});
  return s as PdfReadState;
}

export async function pausePdfReadNow(actorId: string | null, deps: { admin?: Admin } = {}): Promise<PdfReadState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const s = await mutate(admin, actorId, (cur) => pausePdfRead(cur));
  await recordAudit({ actorId, action: PDF_READ_AUDIT.paused, entityType: "site_setting", entityId: null, after: { generation: s?.generation ?? null, read: s?.read ?? 0 } }).catch(() => {});
  return s as PdfReadState;
}

/** How many unreadable vendor PDFs are still waiting to be read (head count). Throws on failure. */
export async function countPdfsWaiting(admin: Admin): Promise<number> {
  const { count, error } = await admin
    .from("cultivera_mail_docs")
    .select("id", { count: "exact", head: true })
    .eq("status", "unreadable")
    .eq("kind", "pdf")
    .not("storage_key", "is", null)
    .or(NOT_READ_YET);
  if (error) throw new Error(`The waiting PDFs could not be counted: ${short(error)}`);
  return count ?? 0;
}

type DocRow = { id: string; storage_key: string; bytes: number | null; note: string | null };

/** The Gemini call, injectable for tests. Same shape as gemini() (never throws). */
export type PdfReadCall = (model: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: unknown; text: string }>;
/** The storage download, injectable for tests. null = the file is gone. */
export type PdfReadDownload = (key: string) => Promise<Uint8Array | null>;

const realCall: PdfReadCall = (model, body) => gemini(`v1beta/models/${model}:generateContent`, { method: "POST", body: JSON.stringify(body) });

function realDownload(admin: Admin): PdfReadDownload {
  return async (key) => {
    const { data, error } = await admin.storage.from(HARVEST_BUCKET).download(key);
    if (error || !data) {
      const m = error?.message ?? "no data";
      const status = (error as { statusCode?: string | number; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
      if (String(status) === "404" || /not found|does not exist/i.test(m)) return null;
      throw new Error(`storage: ${m}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  };
}

/** A Gemini status that means "the service is not answering us" (stop the run, never mark the PDF). */
export function isServiceDown(status: number): boolean {
  return status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
}

class ServiceDown extends Error {}

export type PdfReadRunResult =
  | { ok: true; skipped: PdfReadDecision | "not_configured"; note: string; run?: undefined }
  | { ok: true; skipped?: undefined; run: PdfReadRun; note: string }
  | { ok: false; error: string };

/** One run. Never throws. */
export async function runPdfGeminiRead(
  opts: {
    budgetMs?: number;
    actorId?: string | null;
    trigger?: "press" | "worker";
    admin?: Admin;
    now?: () => number;
    token?: string;
    call?: PdfReadCall;
    download?: PdfReadDownload;
    apiKey?: string;
    budgetCheck?: () => Promise<{ blocked: boolean; reason: string | null }>;
    usage?: typeof logAiUsage;
    concurrency?: number;
    model?: string;
  } = {},
): Promise<PdfReadRunResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? PDF_READ_PRESS_BUDGET_MS;
  const actorId = opts.actorId ?? null;
  const token = opts.token ?? crypto.randomUUID();
  const model = opts.model ?? pdfReadModel(process.env[PDF_READ_MODEL_ENV]);
  const usage = opts.usage ?? logAiUsage;
  const budgetCheck = opts.budgetCheck ?? getBudgetStatus;
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 1. Decide, then take the lease.
  let generation = 0;
  try {
    const snap = await readPdfRead(admin);
    const d = pdfReadDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "leased" ? "Another run is reading right now." : "The PDF reader is not queued." };
    const leased = takePdfReadLease(snap.state, token, t0, budget);
    if (!(await casWrite(admin, snap, leased, actorId))) return { ok: true, skipped: "leased", note: "Another run is reading right now." };
    generation = leased.generation;
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  const run: PdfReadRun = { read: 0, found: 0, nothing: 0, tooBig: 0, failed: 0, left: 0, stoppedBecause: null, serviceDown: false };
  const today = new Date(now()).toISOString().slice(0, 10);
  const call = opts.call ?? realCall;
  const download = opts.download ?? realDownload(admin);
  const width = Math.max(1, Math.min(8, opts.concurrency ?? PDF_READ_CONCURRENCY));

  /** Write the "Gemini read" patch; guarded so a row is written once and only while unreadable. */
  const writeRow = async (doc: DocRow, patch: Record<string, unknown>) => {
    const { error } = await admin.from("cultivera_mail_docs").update(patch).eq("id", doc.id).eq("status", "unreadable").or(NOT_READ_YET);
    if (error) throw new Error(`a row could not be saved: ${short(error)}`);
  };
  const markOnly = (doc: DocRow, why: string) => writeRow(doc, { note: `${PDF_READ_NOTE_PREFIX} ${today} (${model}): ${why}.${doc.note ? ` | ${doc.note.slice(0, 400)}` : ""}` });

  const readOne = async (doc: DocRow): Promise<void> => {
    if (doc.bytes !== null && doc.bytes > PDF_READ_MAX_BYTES) {
      await markOnly(doc, "too large to send");
      run.tooBig += 1;
      return;
    }
    const bytes = await download(doc.storage_key);
    if (!bytes) {
      await markOnly(doc, "file missing from storage");
      run.failed += 1;
      return;
    }
    if (bytes.byteLength > PDF_READ_MAX_BYTES) {
      await markOnly(doc, "too large to send");
      run.tooBig += 1;
      return;
    }
    const res = await call(model, buildPdfReadRequest(Buffer.from(bytes).toString("base64")));
    if (isServiceDown(res.status)) throw new ServiceDown(`Gemini ${res.status || "network"}: ${res.text.replace(/\s+/g, " ").slice(0, 140)}`);
    if (!res.ok) {
      // 400-class answer about THIS file (unreadable / encrypted / not a PDF): marked, never resent.
      await markOnly(doc, `Gemini could not read the file (${res.status})`);
      run.failed += 1;
      return;
    }
    const answer = readGenerateContentResponse(res.json);
    await usage({ feature: "vendor.pdf_read", entityType: "cultivera_mail_doc", entityId: doc.id, model, promptTokens: answer.usage.promptTokens, completionTokens: answer.usage.outputTokens, estimated: false, ok: true }).catch(() => {});
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(answer.text);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      await markOnly(doc, answer.truncated ? "answer cut off" : "no usable answer");
      run.failed += 1;
      return;
    }
    const facts = cleanPdfReadAnswer(parsed);
    await writeRow(doc, pdfReadRowPatch(facts, doc.note, model, today));
    run.read += 1;
    if (facts.license) run.found += 1;
    else run.nothing += 1;
  };

  // 2. Read page by page (oldest id first, cursor so a row that failed to save is not re-fetched).
  let cursor: string | null = null;
  try {
    const key = opts.apiKey ?? (opts.call ? "injected" : geminiApiKey());
    if (!key) throw new ServiceDown("no Gemini API key is set (AI_GEMINI_API_KEY / AI_API_KEY)");
    for (;;) {
      if (now() - t0 > budget - START_MARGIN_MS) break;
      if (!ownsPdfRead((await readPdfRead(admin)).state, token, generation)) {
        run.stoppedBecause = "paused or restarted";
        break;
      }
      const b = await budgetCheck();
      if (b.blocked) throw new ServiceDown(`the monthly AI budget is reached${b.reason ? ` (${b.reason})` : ""}`);
      let q = admin
        .from("cultivera_mail_docs")
        .select("id, storage_key, bytes, note")
        .eq("status", "unreadable")
        .eq("kind", "pdf")
        .not("storage_key", "is", null)
        .or(NOT_READ_YET)
        .order("id", { ascending: true })
        .limit(PDF_READ_PAGE);
      if (cursor) q = q.gt("id", cursor);
      const { data, error } = await q;
      if (error) throw new Error(`the PDF list could not be read: ${short(error)}`);
      const rows = (data ?? []) as DocRow[];
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      // Four at a time within the page.
      let next = 0;
      const page: { down: ServiceDown | null; rowError: string | null } = { down: null, rowError: null };
      const worker = async () => {
        while (next < rows.length && !page.down) {
          if (now() - t0 > budget - START_MARGIN_MS) return;
          const doc = rows[next++];
          try {
            await readOne(doc);
          } catch (err) {
            if (err instanceof ServiceDown) page.down = err;
            else {
              run.failed += 1;
              page.rowError = short(err);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(width, rows.length) }, worker));
      if (page.down) throw page.down;
      if (page.rowError) run.stoppedBecause = page.rowError; // named on the page; the row is tried again next run
    }
  } catch (err) {
    run.stoppedBecause = short(err);
    // A Gemini outage, the budget, or a database failure: "could not read", counted toward the self-pause.
    run.serviceDown = true;
  }

  try {
    run.left = await countPdfsWaiting(admin);
  } catch (err) {
    run.left = Math.max(1, run.left);
    run.stoppedBecause = run.stoppedBecause ?? short(err);
  }

  // 3. Save the run (only the pass this run owns), release the lease, audit.
  const note = pdfReadRunNote(run);
  try {
    await mutate(admin, actorId, (s) => {
      if (s.leaseToken !== token) return null;
      const base = s.generation === generation && !s.paused ? recordPdfReadRun(s, run, new Date(now()).toISOString(), note) : { ...s, lastNote: note };
      return releasePdfReadLease(base, token);
    });
  } catch (err) {
    return { ok: false, error: `${note} But the result could not be saved: ${short(err)}` };
  }
  await recordAudit({ actorId, action: PDF_READ_AUDIT.ran, entityType: "site_setting", entityId: null, after: { trigger: opts.trigger ?? "press", generation, model, ...run } }).catch(() => {});
  return { ok: true, run, note };
}

export type PdfReadStatusView =
  | { ok: true; tone: PdfReadTone; text: string; running: boolean; canPause: boolean; canStart: boolean; lastNote: string | null; lastRunAt: string | null; waiting: number | null }
  | { ok: false; error: string };

/** The status line on the vendor ledger (read-only). */
export async function loadPdfReadStatus(deps: { admin?: Admin; nowMs?: number } = {}): Promise<PdfReadStatusView> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const snap = await readPdfRead(admin);
    let waiting: number | null = null;
    try {
      waiting = await countPdfsWaiting(admin);
    } catch {
      waiting = null;
    }
    const v = pdfReadStatus(snap.state, waiting, deps.nowMs ?? Date.now());
    return { ok: true, ...v, waiting, lastNote: snap.state.armed ? snap.state.lastNote : null, lastRunAt: snap.state.armed ? snap.state.lastRunAt : null };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}
