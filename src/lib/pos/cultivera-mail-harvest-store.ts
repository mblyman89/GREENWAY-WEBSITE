/**
 * src/lib/pos/cultivera-mail-harvest-store.ts — R74 S7. I/O for ONE harvest batch.
 *
 * Owner (R74 round 2): "every Cultivera manifest was sent to stephen@. Please go as far back as you
 * are allowed to go." Every decision is in the PURE cultivera-mail-harvest-run-core (S7) and
 * cultivera-mail-harvest-core (S5). This file only moves bytes:
 *
 *   1. read the saved cursor (site_settings cultivera_mail_harvest_cursor) and resume or start it;
 *   2. list ONE Gmail page at the cursor (gmail.readonly; nothing in Gmail changes);
 *   3. ask cultivera_mail_docs which ids of that page are already kept (the row is the memory);
 *   4. open each new email (up to 47 a batch, inside a 200-second budget), download every vendor
 *      attachment as bytes, fetch each WCIA Transfer Data Link, store each file privately in
 *      pos-raw (mail-harvest/...), parse it with the site's own parsers, and insert its rows;
 *   5. move the cursor to the next page only when every email of this page has rows.
 *
 * THE INSERT IS THE CLAIM (AGENTS rule 12): rows go in with ON CONFLICT DO NOTHING on
 * (mailbox, gmail_id, doc_index). Two people pressing the button store each document once.
 * A Gmail rate limit / server error / timeout STOPS the batch and writes nothing for that email,
 * so it is simply read again next time (never recorded as a permanent failure).
 *
 * The I/O is injected (HarvestIo) so the batch is tested with fakes; the server action passes the
 * real Gmail / fetch / Supabase functions. recordAudit needs request headers: the action audits.
 */
import "server-only";
import crypto from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { walkMessage, type AttachmentRef, type GmailMessage, type MailConfig } from "@/lib/compliance/ccrs-mail-core";
import {
  advanceCursor,
  buildHarvestQuery,
  bytesMatchKind,
  cursorLine,
  resumeOrStart,
  type HarvestCursor,
} from "@/lib/pos/cultivera-mail-harvest-core";
import {
  HARVEST_BUCKET,
  HARVEST_CURSOR_KEY,
  HARVEST_CURSOR_LABEL,
  HARVEST_DOCS_TABLE,
  HARVEST_RUN_MAX_MESSAGES,
  HARVEST_RUN_TIME_BUDGET_MS,
  contentTypeFor,
  failedDocRow,
  harvestDocKey,
  linkFilename,
  messageBodies,
  messageMeta,
  noDocumentsRow,
  pagePlan,
  parseHarvestedDoc,
  planMessageDocs,
  skippedDocRow,
  storedDocRow,
  transientError,
  type DocKind,
  type DocSource,
  type HarvestBatchResult,
  type HarvestDocRow,
} from "@/lib/pos/cultivera-mail-harvest-run-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Configured = Extract<MailConfig, { configured: true }>;

/** Everything the batch touches outside this process. */
export type HarvestIo = {
  token: () => Promise<string>;
  listPage: (token: string, q: string, pageToken: string | null) => Promise<{ ids: string[]; nextPageToken: string | null }>;
  getMessage: (token: string, id: string) => Promise<GmailMessage>;
  getAttachment: (token: string, id: string, ref: AttachmentRef) => Promise<Uint8Array>;
  fetchLink: (url: string) => Promise<{ ok: true; jsonText: string } | { ok: false; error: string }>;
  readCursor: () => Promise<unknown>;
  saveCursor: (c: HarvestCursor) => Promise<void>;
  knownIds: (ids: readonly string[]) => Promise<Set<string>>;
  upload: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  insertRows: (rows: HarvestDocRow[]) => Promise<number>;
  now: () => number;
};

/** The table is missing (0293 not applied yet) — the button says so instead of failing oddly. */
export class HarvestTableMissing extends Error {
  constructor() {
    super("Apply database update 0293 first (docs/MIGRATIONS_TO_RUN.md, R74 — 0293).");
  }
}

export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache|could not find the table/i.test(err.message ?? "");
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The real I/O: Gmail (ccrs-mail-fetch), the Transfer-link fetcher and Supabase (service role). */
export function supabaseHarvestIo(
  admin: Admin,
  cfg: Configured,
  gmail: {
    getGmailAccessToken: (c: Configured) => Promise<string>;
    listMessageIdsPage: (t: string, mb: string, q: string, p: string | null) => Promise<{ ids: string[]; nextPageToken: string | null }>;
    getMessage: (t: string, mb: string, id: string) => Promise<GmailMessage>;
    getAttachmentBytes: (t: string, mb: string, id: string, a: AttachmentRef) => Promise<Uint8Array>;
  },
  fetchTransferJson: (url: string) => Promise<{ ok: true; jsonText: string } | { ok: false; error: string }>,
): HarvestIo {
  const mailbox = cfg.mailbox.toLowerCase();
  return {
    token: () => gmail.getGmailAccessToken(cfg),
    listPage: (t, q, p) => gmail.listMessageIdsPage(t, mailbox, q, p),
    getMessage: (t, id) => gmail.getMessage(t, mailbox, id),
    getAttachment: (t, id, ref) => gmail.getAttachmentBytes(t, mailbox, id, ref),
    fetchLink: fetchTransferJson,
    readCursor: async () => {
      const { data, error } = await admin.from("site_settings").select("value_json").eq("key", HARVEST_CURSOR_KEY).maybeSingle();
      if (error) throw new Error(`reading the harvest position: ${error.message}`);
      return (data as { value_json?: unknown } | null)?.value_json ?? null;
    },
    saveCursor: async (c) => {
      const { error } = await admin
        .from("site_settings")
        .upsert({ key: HARVEST_CURSOR_KEY, label: HARVEST_CURSOR_LABEL, value_json: c, updated_by: null }, { onConflict: "key" });
      if (error) throw new Error(`saving the harvest position: ${error.message}`);
    },
    knownIds: async (ids) => {
      if (ids.length === 0) return new Set();
      const { data, error } = await admin.from(HARVEST_DOCS_TABLE).select("gmail_id").eq("mailbox", mailbox).in("gmail_id", [...ids]);
      if (error) {
        if (isMissingTable(error)) throw new HarvestTableMissing();
        throw new Error(`reading kept emails: ${error.message}`);
      }
      return new Set(((data ?? []) as { gmail_id: string }[]).map((r) => r.gmail_id));
    },
    upload: async (key, bytes, contentType) => {
      const { error } = await admin.storage.from(HARVEST_BUCKET).upload(key, Buffer.from(bytes), { contentType, upsert: true });
      if (error) throw new Error(`storing ${key}: ${error.message}`);
    },
    insertRows: async (rows) => {
      if (rows.length === 0) return 0;
      const { data, error } = await admin
        .from(HARVEST_DOCS_TABLE)
        .upsert(rows, { onConflict: "mailbox,gmail_id,doc_index", ignoreDuplicates: true })
        .select("id");
      if (error) {
        if (isMissingTable(error)) throw new HarvestTableMissing();
        throw new Error(`saving harvested documents: ${error.message}`);
      }
      return (data ?? []).length;
    },
    now: () => Date.now(),
  };
}

/** One email -> its rows. Throws only for a transient error (the caller stops the batch). */
async function harvestOneEmail(io: HarvestIo, token: string, mailbox: string, gmailId: string): Promise<HarvestDocRow[]> {
  const msg = await io.getMessage(token, gmailId);
  const meta = messageMeta(msg);
  const base = { mailbox, gmailId, meta };
  const walked = walkMessage(msg.payload);
  const plan = planMessageDocs(walked.attachments, messageBodies(msg.payload));
  if (plan.nothing) {
    const ignored = walked.attachments.length;
    return [noDocumentsRow(base, ignored)];
  }
  const rows: HarvestDocRow[] = [];

  const keep = async (index: number, filename: string, kind: Exclude<DocKind, "none">, source: DocSource, bytes: Uint8Array) => {
    const key = harvestDocKey(mailbox, gmailId, index, filename);
    if (!key) {
      rows.push(failedDocRow(base, index, filename, kind, source, "no safe storage name for this document"));
      return;
    }
    await io.upload(key, bytes, contentTypeFor(kind));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    rows.push(storedDocRow(base, index, filename, kind, source, { key, bytes: bytes.byteLength, sha256 }, parseHarvestedDoc(kind, bytes)));
  };

  for (const d of plan.downloads) {
    let bytes: Uint8Array;
    try {
      bytes = await io.getAttachment(token, gmailId, d.ref);
    } catch (e) {
      if (transientError(msgOf(e))) throw e;
      rows.push(failedDocRow(base, d.index, d.ref.filename, d.kind, "attachment", msgOf(e)));
      continue;
    }
    const check = bytesMatchKind(d.kind, bytes);
    if (!check.ok) {
      rows.push(failedDocRow(base, d.index, d.ref.filename, d.kind, "attachment", check.why));
      continue;
    }
    await keep(d.index, d.ref.filename, d.kind, "attachment", bytes);
  }
  for (const l of plan.links) {
    const name = linkFilename(l.url);
    const got = await io.fetchLink(l.url);
    if (!got.ok) {
      if (transientError(got.error)) throw new Error(`transfer link: ${got.error}`);
      rows.push(failedDocRow(base, l.index, name, "link-json", "link", `transfer link: ${got.error}`));
      continue;
    }
    await keep(l.index, name, "link-json", "link", new TextEncoder().encode(got.jsonText));
  }
  for (const s of plan.skips) rows.push(skippedDocRow(base, s));
  return rows;
}

/**
 * ONE batch. Never throws for Gmail trouble: the result says what happened. Throws
 * HarvestTableMissing when 0293 is not applied (the action shows the fix).
 */
export async function runHarvestBatch(io: HarvestIo, cfg: Configured): Promise<HarvestBatchResult> {
  const mailbox = cfg.mailbox.toLowerCase();
  const started = io.now();
  const iso = () => new Date(io.now()).toISOString();
  const res: HarvestBatchResult = {
    ok: false,
    mailbox,
    opened: 0,
    stored: 0,
    documents: 0,
    parsed: 0,
    failedEmails: 0,
    deferred: 0,
    pageComplete: false,
    cursorLine: "",
    stoppedBecause: null,
    errors: [],
  };

  const query = buildHarvestQuery();
  const { cursor: start, why } = resumeOrStart(await io.readCursor(), mailbox, query, iso());
  let cursor = start;
  const restartNote = why ? ` (Started over from the oldest page: ${why}.)` : "";
  if (cursor.done) {
    res.ok = true;
    res.pageComplete = true;
    res.cursorLine = cursorLine(cursor) + restartNote;
    return res;
  }

  let token: string;
  let page: { ids: string[]; nextPageToken: string | null };
  try {
    token = await io.token();
    page = await io.listPage(token, query, cursor.pageToken);
  } catch (e) {
    res.stoppedBecause = msgOf(e);
    res.cursorLine = cursorLine(cursor) + restartNote;
    return res;
  }

  const plan = pagePlan(page.ids, await io.knownIds(page.ids), HARVEST_RUN_MAX_MESSAGES);
  let unfinished = plan.deferred;

  for (let i = 0; i < plan.fetch.length; i += 1) {
    const id = plan.fetch[i];
    if (io.now() - started > HARVEST_RUN_TIME_BUDGET_MS) {
      unfinished += plan.fetch.length - i;
      res.stoppedBecause = "the time for one batch ran out";
      break;
    }
    let rows: HarvestDocRow[];
    try {
      rows = await harvestOneEmail(io, token, mailbox, id);
    } catch (e) {
      const m = msgOf(e);
      if (e instanceof HarvestTableMissing) throw e;
      unfinished += plan.fetch.length - i;
      res.failedEmails += 1;
      res.errors.push(m);
      if (transientError(m)) {
        res.stoppedBecause = `Gmail or the vendor site asked us to slow down (${m.slice(0, 120)})`;
        break;
      }
      // A non-transient error opening one email (e.g. storage refused): stop too — never skip silently.
      res.stoppedBecause = m.slice(0, 160);
      break;
    }
    res.opened += 1;
    res.stored += await io.insertRows(rows);
    for (const r of rows) {
      if (r.status === "parsed" || r.status === "stored" || r.status === "unreadable") res.documents += 1;
      if (r.status === "parsed") res.parsed += 1;
    }
  }

  res.deferred = unfinished;
  res.pageComplete = unfinished === 0;
  if (res.pageComplete) {
    cursor = advanceCursor(cursor, page, iso());
    await io.saveCursor(cursor);
  } else if (why) {
    // A restarted cursor is saved at once so the next press resumes on the same terms.
    await io.saveCursor(cursor);
  }
  res.cursorLine = cursorLine(cursor) + restartNote;
  res.ok = res.failedEmails === 0;
  return res;
}

/* ------------------------------------------------------------------ *
 *  The status line on Menu imports
 * ------------------------------------------------------------------ */

export type HarvestStatus =
  | { ready: false; why: string }
  | { ready: true; cursorLine: string; total: number; parsed: number; stored: number; unreadable: number; failed: number; emails: number };

async function countWhere(admin: Admin, mailbox: string, status: string | null): Promise<number> {
  let q = admin.from(HARVEST_DOCS_TABLE).select("id", { count: "exact", head: true }).eq("mailbox", mailbox);
  if (status) q = q.eq("status", status);
  const { count, error } = await q;
  if (error) {
    if (isMissingTable(error)) throw new HarvestTableMissing();
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function readHarvestStatus(admin: Admin, mailbox: string): Promise<HarvestStatus> {
  const mb = mailbox.toLowerCase();
  try {
    const [total, parsed, stored, unreadable, failed, emails] = await Promise.all([
      countWhere(admin, mb, null),
      countWhere(admin, mb, "parsed"),
      countWhere(admin, mb, "stored"),
      countWhere(admin, mb, "unreadable"),
      countWhere(admin, mb, "failed"),
      admin
        .from(HARVEST_DOCS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("mailbox", mb)
        .eq("doc_index", 0)
        .then(({ count, error }) => {
          if (error) throw new Error(error.message);
          return count ?? 0;
        }),
    ]);
    const { data } = await admin.from("site_settings").select("value_json").eq("key", HARVEST_CURSOR_KEY).maybeSingle();
    const { cursor } = resumeOrStart((data as { value_json?: unknown } | null)?.value_json ?? null, mb, buildHarvestQuery(), new Date().toISOString());
    return { ready: true, cursorLine: cursorLine(cursor), total, parsed, stored, unreadable, failed, emails };
  } catch (e) {
    if (e instanceof HarvestTableMissing) return { ready: false, why: e.message };
    return { ready: false, why: `Could not read the harvest status: ${msgOf(e)}` };
  }
}
