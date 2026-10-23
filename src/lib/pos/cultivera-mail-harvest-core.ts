/**
 * src/lib/pos/cultivera-mail-harvest-core.ts — R74 S5 (PURE).
 *
 * Owner (R74 round 2, #2/#5): "Stephen@greenwaymarijuana.com ... every Cultivera manifest was sent
 * to stephen@. Please go as far back as you are allowed to go." and "Whatever Cultivera doesn't
 * find, the email will."
 *
 * The CCRS mail monitor (ccrs-mail-core / ccrs-mail-fetch) already signs in to Google keyless
 * (Vercel OIDC -> STS -> signJwt -> domain-wide delegation, gmail.readonly). This core is the
 * harvest brain that reuses that sign-in for a DIFFERENT mailbox and a whole-history walk:
 *
 *   harvestMailConfigFromEnv   the same four GMAIL_WIF_* variables, mailbox = CULTIVERA_HARVEST_MAILBOX
 *                              (default stephen@greenwaymarijuana.com). One Google approval covers
 *                              every mailbox in the domain, so stephen@ needs no new approval.
 *   buildHarvestQuery          the Gmail search: any vendor document attachment, or a body that
 *                              names a manifest / invoice / COA / transfer data link. No `after:`
 *                              unless asked ("as far back as you are allowed").
 *   cursor                     a resumable walk: Gmail pageToken + counts, saved between ticks, so
 *                              years of mail are read in many short runs (the CCRS monitor stops at
 *                              500 ids with no cursor). A changed mailbox or query restarts it.
 *   harvestAttachmentPlan      which attachments to download as BYTES (json / pdf / csv / xlsx),
 *                              and a named reason for everything skipped (never silent).
 *   decodeAttachmentBytes,     Gmail's base64url `data` to bytes, and a magic-byte check so a PDF is
 *   sniffKind                  really a PDF before LlamaParse sees it (getAttachmentText turned
 *                              binary into text, which corrupts PDFs and spreadsheets).
 *   quota                      Gmail's published per-method units (developers.google.com/workspace/
 *                              gmail/api/reference/quota, read 2026-10-21): messages.list 5,
 *                              messages.get 60 with format=full, messages.attachments.get 20;
 *                              6,000 units per user per minute.
 *
 * Reads nothing, writes nothing. No money.
 */

import { MAX_ATTACHMENT_BYTES, mailConfigFromEnv, type AttachmentRef, type MailConfig } from "@/lib/compliance/ccrs-mail-core";

/* ------------------------------------------------------------------ *
 *  Mailbox config
 * ------------------------------------------------------------------ */

export const HARVEST_MAILBOX_ENV = "CULTIVERA_HARVEST_MAILBOX";
/** Owner R74 round 2 #2: every Cultivera manifest was sent here. */
export const DEFAULT_HARVEST_MAILBOX = "stephen@greenwaymarijuana.com";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * The keyless (or key / OAuth) sign-in of the CCRS monitor, pointed at the harvest mailbox.
 * The GMAIL_* variables are shared on purpose: one service account, one DWD approval.
 */
export function harvestMailConfigFromEnv(env: Readonly<Record<string, string | undefined>>): MailConfig {
  const mailbox = ((env[HARVEST_MAILBOX_ENV] ?? "").trim() || DEFAULT_HARVEST_MAILBOX).toLowerCase();
  if (!EMAIL_RE.test(mailbox)) return { configured: false, mailbox, missing: [], problem: `${HARVEST_MAILBOX_ENV} is not an email address.` };
  // CCRS_MAIL_LOOKBACK_HOURS belongs to the CCRS monitor; the harvest has its own window (none).
  return mailConfigFromEnv({ ...env, CCRS_MAILBOX_ADDRESS: mailbox, CCRS_MAIL_LOOKBACK_HOURS: undefined });
}

/** One plain sentence for the page: configured, or what is missing / wrong. */
export function harvestConfigLine(cfg: MailConfig): { ok: boolean; text: string } {
  if (cfg.configured) return { ok: true, text: `Ready to read ${cfg.mailbox} (sign-in: ${cfg.mode}, read-only).` };
  if (cfg.problem) return { ok: false, text: cfg.problem };
  return { ok: false, text: `Not set up. Missing on Vercel: ${cfg.missing.join(", ")}.` };
}

/** The "Test the vendor mailbox" answer: Gmail let us in, and whether the search finds anything. */
export function probeResultLine(mailbox: string, page: { ids: readonly string[]; resultSizeEstimate: number | null }): string {
  if (page.ids.length === 0) return `Signed in to ${mailbox} (read-only). The vendor-document search found no emails: check that this is the mailbox the manifests were sent to.`;
  const est = page.resultSizeEstimate !== null && page.resultSizeEstimate > 0 ? ` Gmail estimates about ${page.resultSizeEstimate} matching emails (its estimate is rough).` : "";
  return `Signed in to ${mailbox} (read-only). The vendor-document search finds emails.${est} Nothing was opened or stored.`;
}

/* ------------------------------------------------------------------ *
 *  The Gmail search
 * ------------------------------------------------------------------ */

/** Attachment types a vendor document comes in. */
export const HARVEST_FILE_TYPES = ["json", "pdf", "csv", "xlsx", "xls"] as const;
/** Body words that mean "this email carries or links a vendor document" (WCIA emails link the JSON). */
export const HARVEST_BODY_TERMS = ["manifest", "invoice", "COA", "\"certificate of analysis\"", "\"transfer data\"", "wcia"] as const;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar-checked YYYY-MM-DD -> Gmail's YYYY/MM/DD, else null. */
export function gmailDate(ymd: string | null | undefined): string | null {
  const m = YMD_RE.exec((ymd ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * The harvest search. Gmail operators (support.google.com/mail/answer/7190): `{a b}` = a OR b,
 * `filename:pdf`, `after:YYYY/MM/DD`, `before:YYYY/MM/DD`, `-in:chats`.
 * No dates by default: the walk goes back as far as the mailbox goes.
 */
export function buildHarvestQuery(opts: { after?: string | null; before?: string | null } = {}): string {
  const files = HARVEST_FILE_TYPES.map((t) => `filename:${t}`).join(" ");
  const terms = HARVEST_BODY_TERMS.join(" ");
  const parts = [`{${files} ${terms}}`, "-in:chats"];
  const after = gmailDate(opts.after);
  const before = gmailDate(opts.before);
  if (after) parts.push(`after:${after}`);
  if (before) parts.push(`before:${before}`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 *  Resumable cursor
 * ------------------------------------------------------------------ */

export const HARVEST_CURSOR_VERSION = 1;
/** messages.list maxResults ceiling is 500; 100 keeps one tick's work small. */
export const HARVEST_LIST_PAGE = 100;

export type HarvestCursor = {
  version: typeof HARVEST_CURSOR_VERSION;
  mailbox: string;
  query: string;
  /** Gmail nextPageToken for the NEXT page; null = start (pagesDone 0) or finished (done). */
  pageToken: string | null;
  pagesDone: number;
  listed: number;
  done: boolean;
  startedAt: string;
  updatedAt: string;
  /**
   * R74 S18: a "new mail" pass after the walk finished. Gmail lists NEWEST first, so emails that
   * arrived after Finished sit on the first pages. The pass walks from the top, opens only ids not
   * yet kept, and ends at the first page on which every id was ALREADY kept (or the last page).
   * Absent / null = no pass running. Optional so a cursor saved before S18 still reads (no restart).
   */
  topUp?: TopUp | null;
};

export type TopUp = {
  /** Gmail nextPageToken for the NEXT page of this pass; null = its first page. */
  pageToken: string | null;
  pagesDone: number;
  startedAt: string;
};

export function startCursor(mailbox: string, query: string, nowIso: string): HarvestCursor {
  return { version: HARVEST_CURSOR_VERSION, mailbox: mailbox.toLowerCase(), query, pageToken: null, pagesDone: 0, listed: 0, done: false, startedAt: nowIso, updatedAt: nowIso };
}

/** Strict read of a stored cursor; anything malformed -> null (start over, never guess a page). */
export function parseCursor(v: unknown): HarvestCursor | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const nonNegInt = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;
  if (o.version !== HARVEST_CURSOR_VERSION) return null;
  if (typeof o.mailbox !== "string" || !EMAIL_RE.test(o.mailbox)) return null;
  if (typeof o.query !== "string" || !o.query) return null;
  if (!(o.pageToken === null || (typeof o.pageToken === "string" && o.pageToken !== ""))) return null;
  if (!nonNegInt(o.pagesDone) || !nonNegInt(o.listed) || typeof o.done !== "boolean") return null;
  if (typeof o.startedAt !== "string" || typeof o.updatedAt !== "string") return null;
  // A walk in progress past page 0 must carry the token for the next page.
  if (!o.done && (o.pagesDone as number) > 0 && o.pageToken === null) return null;
  // R74 S18: a new-mail pass only exists on a finished walk, and must be well formed.
  if (o.topUp !== undefined && o.topUp !== null) {
    if (!o.done) return null;
    const t = o.topUp as Record<string, unknown>;
    if (typeof t !== "object" || Array.isArray(t)) return null;
    if (!(t.pageToken === null || (typeof t.pageToken === "string" && t.pageToken !== ""))) return null;
    if (!nonNegInt(t.pagesDone) || typeof t.startedAt !== "string") return null;
    if ((t.pagesDone as number) > 0 && t.pageToken === null) return null;
  }
  return o as unknown as HarvestCursor;
}

/** Resume the stored cursor when it is for this mailbox + query; otherwise start a new walk. */
export function resumeOrStart(stored: unknown, mailbox: string, query: string, nowIso: string): { cursor: HarvestCursor; restarted: boolean; why: string | null } {
  const c = parseCursor(stored);
  if (!c) return { cursor: startCursor(mailbox, query, nowIso), restarted: stored != null, why: stored != null ? "the saved position was unreadable" : null };
  if (c.mailbox !== mailbox.toLowerCase()) return { cursor: startCursor(mailbox, query, nowIso), restarted: true, why: `the mailbox changed (${c.mailbox} -> ${mailbox.toLowerCase()})` };
  if (c.query !== query) return { cursor: startCursor(mailbox, query, nowIso), restarted: true, why: "the search changed" };
  return { cursor: c, restarted: false, why: null };
}

/** Fold one listed page into the cursor. A page with no nextPageToken finishes the walk. */
export function advanceCursor(c: HarvestCursor, page: { ids: readonly string[]; nextPageToken: string | null }, nowIso: string): HarvestCursor {
  if (c.done) return c;
  const next = page.nextPageToken && page.nextPageToken.trim() ? page.nextPageToken : null;
  return { ...c, pageToken: next, pagesDone: c.pagesDone + 1, listed: c.listed + page.ids.length, done: next === null, updatedAt: nowIso };
}

/** R74 S18: the page a new-mail pass lists next (its first page when none is running). */
export function topUpPageToken(c: HarvestCursor): string | null {
  return c.topUp ? c.topUp.pageToken : null;
}

/**
 * R74 S18: fold one page of a new-mail pass into a FINISHED cursor. `allKnown` = every id on the
 * page was already kept before this press opened anything. The pass ends there (everything older
 * was read by the walk), or on the last page. Otherwise it moves to the next page. Never touches
 * the walk's own totals; only updatedAt (so "Last batch ran" stays true).
 */
export function advanceTopUp(c: HarvestCursor, page: { ids: readonly string[]; nextPageToken: string | null }, allKnown: boolean, nowIso: string): HarvestCursor {
  if (!c.done) return c;
  const next = page.nextPageToken && page.nextPageToken.trim() ? page.nextPageToken : null;
  if (allKnown || next === null) return { ...c, topUp: null, updatedAt: nowIso };
  const t = c.topUp ?? { pageToken: null, pagesDone: 0, startedAt: nowIso };
  return { ...c, topUp: { ...t, pageToken: next, pagesDone: t.pagesDone + 1 }, updatedAt: nowIso };
}

export function cursorLine(c: HarvestCursor): string {
  if (c.done && c.topUp) return `Finished: ${c.listed} matching emails listed in ${c.pagesDone} pages. Checking for new emails: ${c.topUp.pagesDone} page${c.topUp.pagesDone === 1 ? "" : "s"} checked so far - press again to continue.`;
  return c.done
    ? `Finished: ${c.listed} matching emails listed in ${c.pagesDone} pages.`
    : c.pagesDone === 0
      ? "Not started."
      : `In progress: ${c.listed} emails listed so far (${c.pagesDone} pages). The next run continues where this stopped.`;
}

/* ------------------------------------------------------------------ *
 *  Attachments as bytes
 * ------------------------------------------------------------------ */

export type HarvestKind = "json" | "pdf" | "csv" | "xlsx";
/** Gmail accepts attachments up to 25 MB; a vendor PDF can be larger than the CCRS monitor's 8 MB cap. */
export const HARVEST_MAX_ATTACHMENT_BYTES = 25_000_000;
/** Attachments downloaded per email; any more are named as skipped for a human. */
export const HARVEST_MAX_PER_MESSAGE = 10;

const KIND_BY_EXT: Record<string, HarvestKind> = { json: "json", pdf: "pdf", csv: "csv", xlsx: "xlsx", xls: "xlsx" };
const KIND_BY_MIME: Record<string, HarvestKind> = {
  "application/json": "json",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
};

/** The document kind of an attachment from its name, then its MIME type; null = not a vendor document. */
export function attachmentKind(a: Pick<AttachmentRef, "filename" | "mimeType">): HarvestKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(a.filename.trim())?.[1]?.toLowerCase() ?? "";
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  return KIND_BY_MIME[(a.mimeType ?? "").toLowerCase().split(";")[0].trim()] ?? null;
}

export type HarvestDownload = { ref: AttachmentRef; kind: HarvestKind };
export type HarvestSkip = { filename: string; reason: "not_a_document" | "too_large" | "no_data" | "duplicate" | "over_per_message_cap" };

export const SKIP_REASON_TEXT: Record<HarvestSkip["reason"], string> = {
  not_a_document: "not a JSON, PDF, CSV or spreadsheet",
  too_large: "larger than 25 MB",
  no_data: "Gmail gave no attachment id or data",
  duplicate: "same name and size as another attachment on this email",
  over_per_message_cap: `more than ${HARVEST_MAX_PER_MESSAGE} documents on one email`,
};

/** Which attachments to download (as bytes), and why each other one is skipped. */
export function harvestAttachmentPlan(attachments: readonly AttachmentRef[]): { download: HarvestDownload[]; skipped: HarvestSkip[] } {
  const download: HarvestDownload[] = [];
  const skipped: HarvestSkip[] = [];
  const seen = new Set<string>();
  for (const a of attachments) {
    const kind = attachmentKind(a);
    if (!kind) {
      skipped.push({ filename: a.filename, reason: "not_a_document" });
      continue;
    }
    if (a.size > HARVEST_MAX_ATTACHMENT_BYTES) {
      skipped.push({ filename: a.filename, reason: "too_large" });
      continue;
    }
    if (!a.attachmentId && !a.inlineData) {
      skipped.push({ filename: a.filename, reason: "no_data" });
      continue;
    }
    const key = `${a.filename.toLowerCase()}|${a.size}`;
    if (seen.has(key)) {
      skipped.push({ filename: a.filename, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    if (download.length >= HARVEST_MAX_PER_MESSAGE) {
      skipped.push({ filename: a.filename, reason: "over_per_message_cap" });
      continue;
    }
    download.push({ ref: a, kind });
  }
  return { download, skipped };
}

/** Gmail's MessagePartBody.data (base64url, padding optional) -> bytes. Never via a UTF-8 string. */
export function decodeAttachmentBytes(data: string | null | undefined): Uint8Array {
  if (!data) return new Uint8Array(0);
  return new Uint8Array(Buffer.from(data, "base64url"));
}

/** What the bytes really are (magic bytes); "text" for anything else readable. */
export function sniffKind(bytes: Uint8Array): "pdf" | "zip" | "json" | "text" | "empty" {
  if (bytes.length === 0) return "empty";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip"; // PK.. (xlsx)
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
  if (bytes[i] === 0x7b || bytes[i] === 0x5b) return "json"; // { or [
  return "text";
}

/** Do the bytes match the kind the name promised? A mismatch is reported, never parsed as the wrong thing. */
export function bytesMatchKind(kind: HarvestKind, bytes: Uint8Array): { ok: true } | { ok: false; why: string } {
  const s = sniffKind(bytes);
  if (s === "empty") return { ok: false, why: "the attachment is empty" };
  if (kind === "pdf") return s === "pdf" ? { ok: true } : { ok: false, why: "named .pdf but is not a PDF" };
  if (kind === "json") return s === "json" ? { ok: true } : { ok: false, why: "named .json but does not start with { or [" };
  // Old .xls is not a zip (OLE2); only .xlsx is checked by magic bytes.
  if (kind === "xlsx") return s === "zip" || bytes[0] === 0xd0 ? { ok: true } : { ok: false, why: "named as a spreadsheet but is not one" };
  return s === "pdf" || s === "zip" ? { ok: false, why: "named .csv but is binary" } : { ok: true };
}

/* ------------------------------------------------------------------ *
 *  Quota
 * ------------------------------------------------------------------ */

export const GMAIL_QUOTA = { list: 5, getFull: 60, attachment: 20, perUserPerMinute: 6000 } as const;

export function quotaUnits(c: { lists: number; gets: number; attachments: number }): number {
  return c.lists * GMAIL_QUOTA.list + c.gets * GMAIL_QUOTA.getFull + c.attachments * GMAIL_QUOTA.attachment;
}

/**
 * How many emails one run may open and stay under the per-user minute limit (with a 20 % margin),
 * assuming `attachmentsEach` downloads per email and one list call. Never below 1.
 */
export function messagesPerRun(attachmentsEach: number, budget = Math.floor(GMAIL_QUOTA.perUserPerMinute * 0.8)): number {
  const each = GMAIL_QUOTA.getFull + Math.max(0, attachmentsEach) * GMAIL_QUOTA.attachment;
  return Math.max(1, Math.floor((budget - GMAIL_QUOTA.list) / each));
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 *  R74 S12: "how far back has it read?" (owner: "maybe there is a way to
 *  add a date of the last email read? so i dont repeatedly push the
 *  button for no reason")
 * ------------------------------------------------------------------ */

export type HarvestDates = {
  /** Oldest / newest email date among the kept rows (cultivera_mail_docs.email_at); null = none or unreadable. */
  oldestEmailAt: string | null;
  newestEmailAt: string | null;
  /** When the last batch ran (the cursor's updatedAt), null = never. */
  lastRunAt: string | null;
  /** The walk reached the end of the mailbox search. */
  done: boolean;
  /** The walk has started (at least one page listed). */
  started: boolean;
};

/** "Jul 3, 2024" (UTC calendar day of an ISO time); null for anything unparseable. */
export function harvestDay(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Jul 3, 2024 14:05 UTC"; null for anything unparseable. */
export function harvestStamp(iso: string | null | undefined): string | null {
  const day = harvestDay(iso);
  if (!day) return null;
  const d = new Date(Date.parse(iso as string));
  return `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/**
 * One line under the harvest button. Gmail lists NEWEST first, so each press
 * reaches further back in time: the oldest email kept so far is how far the
 * harvest has read. When the walk is finished it says so plainly; a press after
 * that only checks for new emails (R74 S18: it really does - see advanceTopUp).
 */
export function harvestDatesLine(d: HarvestDates): string {
  const oldest = harvestDay(d.oldestEmailAt);
  const newest = harvestDay(d.newestEmailAt);
  const last = harvestStamp(d.lastRunAt);
  const range = oldest && newest ? (oldest === newest ? `Emails kept are from ${oldest}.` : `Emails kept run from ${oldest} (oldest) to ${newest} (newest).`) : "No email with a date has been kept yet.";
  const ran = d.started && last ? ` Last batch ran ${last}.` : d.started ? "" : " No batch has run yet.";
  if (d.done) return `${range}${ran} The whole mailbox has been read. Press Harvest any time to pick up emails that arrived since: it opens only new emails and stops at the first page it has already kept.`;
  if (!d.started) return `${range}${ran}`;
  return `${range}${ran} Gmail lists the newest emails first, so each press reaches further back${oldest ? ` (next: emails older than ${oldest})` : ""}. Keep pressing until it says Finished.`;
}

export function __runCultiveraMailHarvestCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-mail-harvest-core: " + msg);
    passed += 1;
  };
  const WI = {
    GMAIL_WIF_SERVICE_ACCOUNT_EMAIL: "ccrs-mail@greenway-123.iam.gserviceaccount.com",
    GMAIL_WIF_PROJECT_NUMBER: "123456789012",
    GMAIL_WIF_POOL_ID: "vercel",
    GMAIL_WIF_PROVIDER_ID: "vercel",
  };

  // config
  const c1 = harvestMailConfigFromEnv(WI);
  ok(c1.configured && c1.mailbox === DEFAULT_HARVEST_MAILBOX && c1.mode === "workload-identity", "default mailbox is stephen@, keyless");
  const c2 = harvestMailConfigFromEnv({ ...WI, [HARVEST_MAILBOX_ENV]: " Vendor_Intake@GreenwayMarijuana.com ", CCRS_MAILBOX_ADDRESS: "michael@greenwaymarijuana.com" });
  ok(c2.configured && c2.mailbox === "vendor_intake@greenwaymarijuana.com", "override mailbox, lower-cased; CCRS mailbox ignored");
  const c3 = harvestMailConfigFromEnv({ ...WI, [HARVEST_MAILBOX_ENV]: "stephen" });
  ok(!c3.configured && c3.problem === `${HARVEST_MAILBOX_ENV} is not an email address.`, "bad mailbox named by its own variable");
  const c4 = harvestMailConfigFromEnv({ ...WI, CCRS_MAIL_LOOKBACK_HOURS: "99999" });
  ok(c4.configured, "the CCRS lookback setting cannot break the harvest");
  const c5 = harvestMailConfigFromEnv({});
  ok(!c5.configured && c5.missing.length === 4 && c5.mailbox === DEFAULT_HARVEST_MAILBOX, "nothing set -> the four keyless variables are named");
  ok(harvestConfigLine(c5).text === "Not set up. Missing on Vercel: GMAIL_WIF_SERVICE_ACCOUNT_EMAIL, GMAIL_WIF_PROJECT_NUMBER, GMAIL_WIF_POOL_ID, GMAIL_WIF_PROVIDER_ID.", "missing line");
  ok(harvestConfigLine(c1).ok && harvestConfigLine(c1).text === "Ready to read stephen@greenwaymarijuana.com (sign-in: workload-identity, read-only).", "ready line");
  ok(!harvestConfigLine(c3).ok && harvestConfigLine(c3).text.includes("not an email"), "problem line");

  ok(probeResultLine("s@x.com", { ids: [], resultSizeEstimate: 0 }).includes("found no emails"), "probe: empty search is said");
  ok(probeResultLine("s@x.com", { ids: ["1"], resultSizeEstimate: 201 }) === "Signed in to s@x.com (read-only). The vendor-document search finds emails. Gmail estimates about 201 matching emails (its estimate is rough). Nothing was opened or stored.", "probe: hit with estimate");
  ok(!probeResultLine("s@x.com", { ids: ["1"], resultSizeEstimate: null }).includes("estimates"), "probe: no estimate, no number");

  // query
  const q = buildHarvestQuery();
  ok(q === '{filename:json filename:pdf filename:csv filename:xlsx filename:xls manifest invoice COA "certificate of analysis" "transfer data" wcia} -in:chats', "default query: no date limit");
  ok(buildHarvestQuery({ after: "2024-01-01" }).endsWith(" after:2024/01/01"), "after date in Gmail form");
  ok(buildHarvestQuery({ after: "2024-02-30", before: "nope" }) === q, "bad dates are dropped, never guessed");
  ok(buildHarvestQuery({ before: "2026-11-01" }).endsWith("before:2026/11/01"), "before date");
  ok(gmailDate("2024-02-29") === "2024/02/29" && gmailDate("2023-02-29") === null && gmailDate(null) === null, "calendar-checked dates");

  // cursor
  const t0 = "2026-10-21T10:00:00.000Z";
  const s = startCursor("Stephen@greenwaymarijuana.com", q, t0);
  ok(s.mailbox === "stephen@greenwaymarijuana.com" && s.pagesDone === 0 && !s.done && s.pageToken === null, "start cursor");
  ok(cursorLine(s) === "Not started.", "start line");
  const a1 = advanceCursor(s, { ids: ["a", "b"], nextPageToken: "P2" }, "t1");
  ok(a1.pageToken === "P2" && a1.pagesDone === 1 && a1.listed === 2 && !a1.done && a1.updatedAt === "t1", "first page advances");
  ok(cursorLine(a1).startsWith("In progress: 2 emails"), "progress line");
  const a2 = advanceCursor(a1, { ids: ["c"], nextPageToken: null }, "t2");
  ok(a2.done && a2.pageToken === null && a2.listed === 3 && a2.pagesDone === 2, "no next token finishes");
  ok(advanceCursor(a2, { ids: ["z"], nextPageToken: "P9" }, "t3") === a2, "a finished cursor never moves");
  ok(advanceCursor(s, { ids: [], nextPageToken: "  " }, "t").done, "blank token = finished");
  ok(cursorLine(a2) === "Finished: 3 matching emails listed in 2 pages.", "done line");
  ok(parseCursor(JSON.parse(JSON.stringify(a1)))?.pageToken === "P2", "a stored cursor round-trips");
  ok(parseCursor({ ...a1, pageToken: null }) === null, "mid-walk with no token is unreadable");
  ok(parseCursor({ ...a1, version: 2 }) === null && parseCursor({ ...a1, listed: -1 }) === null && parseCursor([a1]) === null && parseCursor(null) === null, "junk is unreadable");
  const r1 = resumeOrStart(a1, "stephen@greenwaymarijuana.com", q, t0);
  ok(!r1.restarted && r1.cursor.pageToken === "P2", "same mailbox + query resumes");
  const r2 = resumeOrStart(a1, "vendor_intake@greenwaymarijuana.com", q, t0);
  ok(r2.restarted && r2.cursor.pagesDone === 0 && r2.why!.includes("mailbox changed"), "mailbox change restarts");
  const r3 = resumeOrStart(a1, "stephen@greenwaymarijuana.com", q + " after:2024/01/01", t0);
  ok(r3.restarted && r3.why === "the search changed", "query change restarts");
  const r4 = resumeOrStart({ junk: 1 }, "stephen@greenwaymarijuana.com", q, t0);
  ok(r4.restarted && r4.why === "the saved position was unreadable", "unreadable restarts, said");
  const r5 = resumeOrStart(null, "stephen@greenwaymarijuana.com", q, t0);
  ok(!r5.restarted && r5.why === null, "first ever run is not a restart");

  // attachment plan
  const att = (filename: string, size = 1000, mimeType = "application/octet-stream", attachmentId: string | null = "A"): AttachmentRef => ({ filename, mimeType, size, attachmentId, inlineData: null });
  ok(attachmentKind(att("Manifest 123.PDF")) === "pdf" && attachmentKind(att("x.json")) === "json" && attachmentKind(att("inv.XLS")) === "xlsx", "kind by extension");
  ok(attachmentKind(att("noext", 1, "application/pdf; name=x")) === "pdf" && attachmentKind(att("logo.png", 1, "image/png")) === null, "kind by MIME, images are not documents");
  const plan = harvestAttachmentPlan([
    att("transfer.json"),
    att("manifest.pdf", 2000),
    att("manifest.pdf", 2000),
    att("logo.png", 10, "image/png"),
    att("huge.pdf", HARVEST_MAX_ATTACHMENT_BYTES + 1),
    att("ghost.csv", 10, "text/csv", null),
    { filename: "inline.csv", mimeType: "text/csv", size: 5, attachmentId: null, inlineData: "YSxi" },
  ]);
  ok(plan.download.map((d) => `${d.ref.filename}:${d.kind}`).join() === "transfer.json:json,manifest.pdf:pdf,inline.csv:csv", "downloads json, pdf, inline csv once");
  ok(plan.skipped.map((s2) => `${s2.filename}:${s2.reason}`).join() === "manifest.pdf:duplicate,logo.png:not_a_document,huge.pdf:too_large,ghost.csv:no_data", "every skip is named");
  ok(HARVEST_MAX_ATTACHMENT_BYTES > MAX_ATTACHMENT_BYTES, "harvest cap is above the CCRS cap");
  const many = harvestAttachmentPlan(Array.from({ length: 12 }, (_, k) => att(`m${k}.pdf`)));
  ok(many.download.length === HARVEST_MAX_PER_MESSAGE && many.skipped.length === 2 && many.skipped[0].reason === "over_per_message_cap", "per-email cap, the rest named");
  ok(Object.keys(SKIP_REASON_TEXT).length === 5, "every skip reason has text");

  // bytes
  const pdf = decodeAttachmentBytes(Buffer.from("%PDF-1.7\n\xff\xfe binary", "latin1").toString("base64url"));
  ok(pdf[0] === 0x25 && pdf[10] === 0xfe && sniffKind(pdf) === "pdf", "binary survives the decode (no UTF-8 mangling)");
  ok(decodeAttachmentBytes(null).length === 0 && sniffKind(new Uint8Array(0)) === "empty", "no data -> empty");
  ok(sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])) === "zip", "xlsx is a zip");
  ok(sniffKind(new Uint8Array(Buffer.from("\ufeff \n {\"a\":1}"))) === "json", "BOM + whitespace + { is json");
  ok(sniffKind(new Uint8Array(Buffer.from("a,b\n1,2"))) === "text", "csv is text");
  ok(bytesMatchKind("pdf", pdf).ok && !bytesMatchKind("pdf", new Uint8Array(Buffer.from("<html>"))).ok, "a fake PDF is caught");
  ok(bytesMatchKind("json", new Uint8Array(Buffer.from("[1]"))).ok && !bytesMatchKind("json", pdf).ok, "json check");
  ok(bytesMatchKind("xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])).ok && bytesMatchKind("xlsx", new Uint8Array([0xd0, 0xcf])).ok && !bytesMatchKind("xlsx", pdf).ok, "spreadsheet check (xlsx zip, old xls OLE2)");
  ok(bytesMatchKind("csv", new Uint8Array(Buffer.from("a,b"))).ok && !bytesMatchKind("csv", pdf).ok, "csv must not be binary");
  ok(!bytesMatchKind("json", new Uint8Array(0)).ok, "empty never matches");

  // quota
  ok(quotaUnits({ lists: 1, gets: 10, attachments: 20 }) === 5 + 600 + 400, "units per Google's table");
  ok(messagesPerRun(2) === Math.floor((4800 - 5) / 100) && messagesPerRun(0) === Math.floor(4795 / 60), "per-run email budget under 80% of the minute limit");
  ok(messagesPerRun(1000) === 1, "never below one email");

  // R74 S12: dates line
  ok(harvestDay("2024-07-03T23:30:00Z") === "Jul 3, 2024" && harvestDay("nope") === null && harvestDay(null) === null, "harvest day (UTC), bad = null");
  ok(harvestStamp("2024-07-03T04:05:00Z") === "Jul 3, 2024 04:05 UTC" && harvestStamp("") === null, "harvest stamp");
  const base: HarvestDates = { oldestEmailAt: "2023-01-05T10:00:00Z", newestEmailAt: "2024-07-03T10:00:00Z", lastRunAt: "2024-07-04T15:00:00Z", done: false, started: true };
  const l1 = harvestDatesLine(base);
  ok(l1.startsWith("Emails kept run from Jan 5, 2023 (oldest) to Jul 3, 2024 (newest). Last batch ran Jul 4, 2024 15:00 UTC."), "in-progress range + last run");
  ok(l1.includes("newest emails first") && l1.includes("older than Jan 5, 2023") && l1.includes("until it says Finished"), "in-progress says where the next press goes");
  const l2 = harvestDatesLine({ ...base, done: true });
  ok(l2.includes("whole mailbox has been read") && l2.includes("pick up emails that arrived since") && l2.includes("opens only new emails"), "done says a press picks up new mail (S18)");
  ok(!l2.includes("no need to press"), "done no longer says pressing is pointless (S18)");

  // R74 S18: the new-mail pass on a finished cursor
  {
    const fin = advanceCursor(advanceCursor(startCursor("s@x.com", q, "t0"), { ids: ["a"], nextPageToken: "P2" }, "t1"), { ids: ["b"], nextPageToken: null }, "t2");
    ok(fin.done && !fin.topUp && topUpPageToken(fin) === null, "a finished cursor's pass starts at the first page");
    const t1 = advanceTopUp(fin, { ids: ["n1", "a"], nextPageToken: "Q2" }, false, "t3");
    ok(t1.topUp?.pageToken === "Q2" && t1.topUp.pagesDone === 1 && t1.topUp.startedAt === "t3" && topUpPageToken(t1) === "Q2", "a page with new mail moves the pass on");
    ok(t1.done && t1.listed === fin.listed && t1.pagesDone === fin.pagesDone && t1.pageToken === null, "the walk's own totals never change");
    ok(t1.updatedAt === "t3", "the pass stamps the last run");
    const t2 = advanceTopUp(t1, { ids: ["a", "b"], nextPageToken: "Q3" }, true, "t4");
    ok(t2.topUp === null && t2.done && t2.updatedAt === "t4", "the first all-kept page ends the pass");
    const t3 = advanceTopUp(t1, { ids: ["n9"], nextPageToken: null }, false, "t5");
    ok(t3.topUp === null, "the last page ends the pass");
    const t4 = advanceTopUp(fin, { ids: ["n1"], nextPageToken: "  " }, false, "t6");
    ok(t4.topUp === null, "a blank token is the last page");
    const t5 = advanceTopUp(t1, { ids: ["n2"], nextPageToken: "Q3" }, false, "t7");
    ok(t5.topUp?.pagesDone === 2 && t5.topUp.startedAt === "t3", "a running pass keeps its start");
    const walking = advanceCursor(startCursor("s@x.com", q, "t0"), { ids: ["a"], nextPageToken: "P2" }, "t1");
    ok(advanceTopUp(walking, { ids: ["z"], nextPageToken: "Q" }, false, "t9") === walking, "a pass never runs on a walk still in progress");
    ok(parseCursor(JSON.parse(JSON.stringify(t1)))?.topUp?.pageToken === "Q2", "a running pass round-trips");
    ok(parseCursor(JSON.parse(JSON.stringify(fin)))?.done === true, "a cursor saved before S18 (no topUp) still reads");
    ok(parseCursor({ ...walking, topUp: { pageToken: null, pagesDone: 0, startedAt: "x" } }) === null, "a pass on an unfinished walk is unreadable");
    ok(parseCursor({ ...t1, topUp: { pageToken: null, pagesDone: 2, startedAt: "x" } }) === null, "a pass past page 0 with no token is unreadable");
    ok(parseCursor({ ...t1, topUp: { pageToken: "Q", pagesDone: -1, startedAt: "x" } }) === null && parseCursor({ ...t1, topUp: [1] }) === null && parseCursor({ ...t1, topUp: { pageToken: "", pagesDone: 0, startedAt: "x" } }) === null, "a junk pass is unreadable");
    ok(cursorLine(t1).includes("Checking for new emails: 1 page checked so far") && cursorLine(t2) === cursorLine(fin), "pass line, then back to Finished");
  }
  ok(harvestDatesLine({ oldestEmailAt: null, newestEmailAt: null, lastRunAt: null, done: false, started: false }) === "No email with a date has been kept yet. No batch has run yet.", "never run");
  ok(harvestDatesLine({ ...base, newestEmailAt: base.oldestEmailAt }).startsWith("Emails kept are from Jan 5, 2023."), "single day");

  return { passed, failed: 0 };
}
