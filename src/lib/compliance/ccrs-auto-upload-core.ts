/**
 * src/lib/compliance/ccrs-auto-upload-core.ts - D253 (pure, self-tested).
 *
 * The assisted CCRS uploader (owner's option A). CCRS has no API for a
 * licensee ("There is no Application Programming Interface (API) for CCRS",
 * LCB FAQ), and the integrator API is only for approved integrators. So the
 * owner logs into CCRS himself, in his own Chrome, and a small Greenway
 * extension uploads the files of a run through the same web form he would
 * use (POST /Home/Upload, fields files + username + __RequestVerificationToken,
 * observed on PREprod 2026-11-18). His password is never seen or stored.
 *
 * Owner (D253, verbatim log): "I will log in, and then you can upload the
 * three batches, waiting for each email response before uploading the next
 * set." This file decides, from facts only, what happens next:
 *
 *   planRun         which files a run uploads (every emitted file of the env,
 *                   Group 1 -> 2 -> 3, oldest stamp first), or why not.
 *   nextStep        one decision per check-in: upload this file, wait (for a
 *                   CCRS email, the gap, the tab, the login), pause, stop,
 *                   or done. Never two files in flight; never a group before
 *                   every file of the earlier groups has its CCRS answer; a
 *                   file CCRS refused rows of pauses the run for the owner.
 *   classifyUpload  what CCRS's answer page said. Only the two texts seen
 *                   on PREprod are trusted ("Upload Confirmation ... received
 *                   at <time> Pacific Time" and "Your Files Could Not Be
 *                   Uploaded"); anything else stops the run (U-87).
 *   uploadOverride  when ccrs_mark_uploaded's one-at-a-time rule may be
 *                   passed: only for files of the SAME group of this run,
 *                   never for a missing reference.
 *
 * Nothing here retries a file. A file handed to the browser and not reported
 * back is "unknown": the run stops and the owner checks CCRS (CCRS refuses
 * the same file name twice [BRIAN A29], so a blind retry is never right).
 */
import { pacificWallTimeToUtcISO } from "../reports/timezone";
import { CCRS_KNOWN_MESSAGES } from "./ccrs-outcome-core";
import type { LedgerEnv } from "./ccrs-ledger-core";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const AUTO_UPLOAD_GROUPS: Readonly<Record<string, 1 | 2 | 3>> = {
  Strain: 1,
  Area: 1,
  Product: 1,
  Inventory: 2,
  InventoryAdjustment: 3,
  InventoryTransfer: 3,
  Sale: 3,
};

/** The two CCRS hosts, exactly (the extension refuses any other page). */
export const CCRS_ORIGINS: Readonly<Record<LedgerEnv, string>> = {
  prod: "https://cannabisreporting.lcb.wa.gov",
  preprod: "https://precannabisreporting.lcb.wa.gov",
};

/** A file handed to the browser and not reported within this is "unknown". */
export const CLAIM_STALE_MS = 10 * 60_000;
/** The browser has not checked in for this long: the owner is told once. */
export const DEVICE_SILENT_MS = 15 * 60_000;
/** Walkthrough floor between groups (D252 gate note; Brian 4a "15 minutes"). */
export const DEFAULT_GAP_MINUTES = 10;
/** Reason given to ccrs_mark_uploaded for a file of the same group (10+ chars). */
export const SAME_GROUP_OVERRIDE =
  "D253 auto-uploader: same upload group as the earlier file(s) of this run, sent together as the walkthrough does";
/** Kill switch: CCRS_AUTO_UPLOAD=off stops every hand-out. */
export function autoUploadEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.CCRS_AUTO_UPLOAD ?? "").trim().toLowerCase() !== "off";
}

/* ------------------------------------------------------------------ *
 * D254: keep the CCRS login alive while a run waits; tell the owner when
 * CCRS logged him out and the next group is ready.
 *
 * Owner (D254, verbatim log): "it takes so long between uploads, that we get
 * auto logged out. Is there a way to add to the upload logic to do something
 * that will keep the site alive while we wait for the emails to arrive" and
 * "yes, please build the keep alive and alert system as a back up plan."
 * ------------------------------------------------------------------ */

/** How often the browser re-reads the CCRS page while a run waits. */
export const KEEPALIVE_EVERY_MS = 10 * 60_000;
/** A login wait this old (same decision since) tells the owner once. */
export const LOGIN_ALERT_AFTER_MS = 2 * 60_000;

/**
 * The keep-alive switch: CCRS_KEEPALIVE=on. OFF unless switched on, until
 * the examiner answers whether a periodic page refresh is acceptable (the
 * owner: "as a back up plan"; Brian email question 4). The log-in alert does
 * not depend on it.
 */
export function keepAliveEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.CCRS_KEEPALIVE ?? "").trim().toLowerCase() === "on";
}

/** Waits during which the CCRS page sits idle for a long time (CCRS email, the gap). */
const IDLE_WAITS: ReadonlySet<string> = new Set(["answer", "gap"]);

/**
 * May the browser re-read the CCRS page now? Only while a running run waits
 * for CCRS's email or the gap between groups, and only when switched on.
 * Never while a file is in the browser, never for a page that is logged out
 * or logged in as another account (a refresh cannot fix those; the owner
 * must log in himself).
 */
export function keepAliveFor(d: Decision, enabled: boolean): boolean {
  return enabled && d.kind === "wait" && IDLE_WAITS.has(d.why);
}

/** The waits in which only the owner can help: log in, the right account, open the page. */
const OWNER_WAITS: ReadonlySet<string> = new Set(["login", "account", "tab"]);

export type LoginAlert = { dedupeKey: string; subject: string; body: string };

/**
 * One alert per run per next file when the next group is ready but CCRS is
 * logged out (or the page is closed, or another account is logged in), and
 * the run has been waiting so for LOGIN_ALERT_AFTER_MS (no alert for the
 * moment between pressing Start and logging in). `waitingSinceMs` is when
 * the run first gave this same decision (null = it is new now).
 */
export function loginAlertFor(runId: string, envName: LedgerEnv, d: Decision, waitingSinceMs: number | null, nowMs: number): LoginAlert | null {
  if (d.kind !== "wait" || !OWNER_WAITS.has(d.why) || !d.next) return null;
  if (waitingSinceMs === null || !Number.isFinite(waitingSinceMs) || nowMs - waitingSinceMs < LOGIN_ALERT_AFTER_MS) return null;
  const site = envName === "prod" ? "production" : "PREprod";
  const what =
    d.why === "login"
      ? `CCRS ${site} is logged out in Chrome.`
      : d.why === "account"
        ? `CCRS ${site} is logged in with another account.`
        : `No CCRS ${site} page is open in the Chrome with the Greenway uploader.`;
  return {
    dedupeKey: `ccrs_auto_upload:${runId}:login:${d.next.runFileId}`,
    subject: `CCRS upload waiting: please log in to CCRS ${site}`,
    body: `${what} Group ${d.next.group} is ready (next file ${d.next.fileName}). Nothing is sent until you log in; then the run goes on by itself. ${d.text}`,
  };
}

const WAITING = new Set(["emitted", "uploaded"]);
const ANSWERED = new Set(["succeeded", "errored", "reconciling", "closed"]);

/* ------------------------------------------------------------------ *
 * Hosts
 * ------------------------------------------------------------------ */

/** The env of a CCRS page origin, or null for anything else (exact match). */
export function envOfCcrsOrigin(origin: string): LedgerEnv | null {
  const o = origin.trim().replace(/\/+$/, "").toLowerCase();
  if (o === CCRS_ORIGINS.prod) return "prod";
  if (o === CCRS_ORIGINS.preprod) return "preprod";
  return null;
}

/* ------------------------------------------------------------------ *
 * The run's files
 * ------------------------------------------------------------------ */

export type PlanInputFile = {
  id: string;
  fileName: string;
  fileType: string;
  state: string;
  stampAt: string | null;
  purpose?: string | null;
};

export type PlannedFile = { fileId: string; fileName: string; fileType: string; group: 1 | 2 | 3; seq: number };

export type RunPlan =
  | { ok: true; files: PlannedFile[] }
  | { ok: false; error: string };

/**
 * Every emitted file of the env goes, in upload order. A file of the env
 * that was uploaded and still waits for its CCRS email blocks the start
 * (ccrs_mark_uploaded would refuse every later file until it is answered).
 */
export function planRun(files: readonly PlanInputFile[]): RunPlan {
  const live = files.filter((f) => f.purpose !== "seed");
  const waiting = live.filter((f) => f.state === "uploaded").map((f) => f.fileName).sort();
  if (waiting.length > 0) {
    return { ok: false, error: `CCRS has not answered ${waiting.join(", ")} yet. Apply its email (or record it) before a run starts.` };
  }
  const emitted = live.filter((f) => f.state === "emitted");
  if (emitted.length === 0) return { ok: false, error: "No file is waiting to be uploaded. Build and download the week first." };
  const unknown = emitted.filter((f) => !AUTO_UPLOAD_GROUPS[f.fileType]).map((f) => f.fileName);
  if (unknown.length > 0) return { ok: false, error: `Not a CCRS file type: ${unknown.join(", ")}` };
  const noStamp = emitted.filter((f) => !f.stampAt).map((f) => f.fileName);
  if (noStamp.length > 0) return { ok: false, error: `No stamp time on ${noStamp.join(", ")}` };
  const sorted = [...emitted].sort((a, b) => {
    const g = AUTO_UPLOAD_GROUPS[a.fileType] - AUTO_UPLOAD_GROUPS[b.fileType];
    if (g !== 0) return g;
    const t = Date.parse(a.stampAt!) - Date.parse(b.stampAt!);
    return t !== 0 ? t : a.fileName.localeCompare(b.fileName);
  });
  // The ledger's one-at-a-time rule is by stamp: a later group's file stamped
  // BEFORE an earlier group's file would be refused (or need an override that
  // also hides a missing reference). Such a set is not run automatically.
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (AUTO_UPLOAD_GROUPS[b.fileType] > AUTO_UPLOAD_GROUPS[a.fileType] && Date.parse(b.stampAt!) < Date.parse(a.stampAt!)) {
        return { ok: false, error: `${b.fileName} is stamped before ${a.fileName} but must go after it. Upload these by hand.` };
      }
    }
  }
  return { ok: true, files: sorted.map((f, i) => ({ fileId: f.id, fileName: f.fileName, fileType: f.fileType, group: AUTO_UPLOAD_GROUPS[f.fileType], seq: i + 1 })) };
}

/* ------------------------------------------------------------------ *
 * Refused rows: does an answered file let the next group go?
 * ------------------------------------------------------------------ */

const BENIGN = new Set(CCRS_KNOWN_MESSAGES.filter((m) => m.cls === "benign").map((m) => m.text.toLowerCase()));

/** An answered file CCRS refused rows of (any message that is not benign). */
export function hasRefusals(f: { state: string; errorMessages: readonly string[] | null }): boolean {
  if (!ANSWERED.has(f.state)) return false;
  if (f.state === "reconciling") return true;
  const msgs = (f.errorMessages ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  return msgs.some((m) => !BENIGN.has(m));
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

export type StepState = "pending" | "claimed" | "posted" | "refused" | "unknown" | "skipped";

export type RunFileFact = {
  runFileId: string;
  fileId: string;
  fileName: string;
  fileType: string;
  group: 1 | 2 | 3;
  seq: number;
  step: StepState;
  ledgerState: string;
  errorMessages: readonly string[] | null;
  claimedAt: string | null;
  postedAt: string | null;
};

export type TabFact = { env: LedgerEnv; loggedIn: boolean; username: string | null };

export type StepInput = {
  run: {
    state: "running" | "paused" | "stopped" | "done" | "failed";
    env: LedgerEnv;
    ccrsUsername: string;
    gapMinutes: number;
    /** files whose refused rows the owner accepted ("Continue anyway") */
    acceptedFileIds: readonly string[];
  };
  files: readonly RunFileFact[];
  /** files of this env waiting for an answer that are NOT in the run */
  others: readonly { fileName: string; state: string }[];
  /** what the browser said about its CCRS tabs at this check-in (null = not asked) */
  tabs: readonly TabFact[] | null;
  enabled: boolean;
  nowMs: number;
};

/** The file a browser wait holds back (D254: named in the log-in alert). */
export type NextFile = { runFileId: string; fileName: string; group: 1 | 2 | 3 };

export type Decision =
  | { kind: "idle"; text: string }
  | { kind: "done"; text: string }
  | { kind: "stop"; text: string; runFileId?: string }
  | { kind: "pause"; text: string; fileIds: string[] }
  | { kind: "skip"; runFileId: string; text: string }
  | { kind: "wait"; why: "claim" | "answer" | "gap" | "tab" | "login" | "account"; text: string; untilMs?: number; next?: NextFile }
  | { kind: "upload"; runFileId: string; fileName: string; text: string };

const refusedRows = (f: RunFileFact) => hasRefusals({ state: f.ledgerState, errorMessages: f.errorMessages });

const names = (xs: readonly { fileName: string }[], max = 4) =>
  xs.slice(0, max).map((x) => x.fileName).join(", ") + (xs.length > max ? ` and ${xs.length - max} more` : "");

export function nextStep(i: StepInput): Decision {
  const { run } = i;
  if (!i.enabled) return { kind: "idle", text: "Automatic upload is switched off (CCRS_AUTO_UPLOAD=off)." };
  if (run.state !== "running") return { kind: "idle", text: `The run is ${run.state}.` };
  const files = [...i.files].sort((a, b) => a.seq - b.seq);
  if (files.length === 0) return { kind: "stop", text: "The run has no files." };

  // 1. Anything not known for certain stops the run for the owner.
  const unsure = files.find((f) => f.step === "unknown" || f.step === "refused");
  if (unsure) {
    return {
      kind: "stop",
      runFileId: unsure.runFileId,
      text:
        unsure.step === "refused"
          ? `CCRS did not take ${unsure.fileName} (its page said the files could not be uploaded). Nothing more is sent.`
          : `It is not known whether CCRS received ${unsure.fileName}. Nothing more is sent; check the CCRS email for it.`,
    };
  }
  const claimed = files.find((f) => f.step === "claimed");
  if (claimed) {
    const at = claimed.claimedAt ? Date.parse(claimed.claimedAt) : NaN;
    if (!Number.isFinite(at) || i.nowMs - at > CLAIM_STALE_MS) {
      return { kind: "stop", runFileId: claimed.runFileId, text: `${claimed.fileName} was handed to the browser and never reported back. Nothing more is sent; check the CCRS email for it.` };
    }
    return { kind: "wait", why: "claim", text: `Uploading ${claimed.fileName} now.` };
  }
  // A pending file must still be "emitted"; anything else was done by hand.
  const gone = files.find((f) => f.step === "pending" && f.ledgerState !== "emitted");
  if (gone) {
    if (gone.ledgerState === "abandoned") return { kind: "stop", runFileId: gone.runFileId, text: `${gone.fileName} was abandoned in the hub. The run stops.` };
    // Recorded uploaded (or answered) by hand: this run does not send it again.
    return { kind: "skip", runFileId: gone.runFileId, text: `${gone.fileName} is already ${gone.ledgerState} in the hub; it is not sent again.` };
  }

  // 2. Done when every file was sent and CCRS answered all of them.
  const pending = files.filter((f) => f.step === "pending");
  if (pending.length === 0) {
    const open = files.filter((f) => WAITING.has(f.ledgerState));
    if (open.length === 0) {
      const refused = files.filter((f) => refusedRows(f) && !run.acceptedFileIds.includes(f.fileId));
      return { kind: "done", text: refused.length ? `Every file was uploaded and answered. CCRS refused rows in ${names(refused)}; see CCRS email.` : "Every file was uploaded and CCRS answered each one." };
    }
    return { kind: "wait", why: "answer", text: `Waiting for CCRS's email on ${names(open)}. Production can take hours.` };
  }

  // 3. The next file is the first pending one; its group may go only when
  //    every file of the earlier groups was answered.
  const next = pending[0];
  const earlier = files.filter((f) => f.group < next.group);
  const unanswered = earlier.filter((f) => WAITING.has(f.ledgerState));
  if (unanswered.length > 0) {
    return { kind: "wait", why: "answer", text: `Waiting for CCRS's email on ${names(unanswered)} before Group ${next.group}. Production can take hours.` };
  }
  const refused = earlier.filter((f) => refusedRows(f) && !run.acceptedFileIds.includes(f.fileId));
  if (refused.length > 0) {
    return {
      kind: "pause",
      fileIds: refused.map((f) => f.fileId),
      text: `CCRS refused rows in ${names(refused)}. Group ${next.group} depends on them, so the run is paused. Fix and re-send them, or press Continue anyway.`,
    };
  }
  // Only files CCRS holds and has not answered (a file built later, still
  // "emitted", is simply not part of this run).
  const outside = i.others.filter((o) => o.state === "uploaded");
  if (outside.length > 0) {
    return { kind: "wait", why: "answer", text: `Waiting for CCRS's email on ${names(outside)} (not part of this run) first.` };
  }
  if (earlier.length > 0) {
    const lastPost = Math.max(...earlier.map((f) => (f.postedAt ? Date.parse(f.postedAt) : 0)).filter(Number.isFinite));
    const until = lastPost + run.gapMinutes * 60_000;
    if (lastPost > 0 && i.nowMs < until) {
      return { kind: "wait", why: "gap", untilMs: until, text: `Group ${next.group} goes after the ${run.gapMinutes}-minute gap.` };
    }
  }

  // 4. Only now look at the browser.
  if (i.tabs === null) return { kind: "wait", why: "tab", text: "Waiting for the browser to check in." };
  const held: NextFile = { runFileId: next.runFileId, fileName: next.fileName, group: next.group };
  // D254: several tabs of the site may be open (one logged out, one logged
  // in again): the logged-in one with the run's account counts first.
  const mine = (t: TabFact) => (t.username ?? "").trim().toLowerCase() === run.ccrsUsername.trim().toLowerCase();
  const siteTabs = i.tabs.filter((t) => t.env === run.env);
  const tab = siteTabs.find((t) => t.loggedIn && mine(t)) ?? siteTabs.find((t) => t.loggedIn) ?? siteTabs[0];
  if (!tab) return { kind: "wait", why: "tab", next: held, text: `Open ${CCRS_ORIGINS[run.env]} in Chrome (the browser with the Greenway uploader).` };
  if (!tab.loggedIn) return { kind: "wait", why: "login", next: held, text: `Log in to CCRS ${run.env === "prod" ? "production" : "PREprod"} in Chrome. Nothing is sent until you do.` };
  const who = (tab.username ?? "").trim().toLowerCase();
  if (who !== run.ccrsUsername.trim().toLowerCase()) {
    return { kind: "wait", why: "account", next: held, text: `CCRS is logged in as ${tab.username ?? "(unknown)"}, but its emails must go to ${run.ccrsUsername}. Log in with that account.` };
  }
  return { kind: "upload", runFileId: next.runFileId, fileName: next.fileName, text: `Uploading ${next.fileName} (Group ${next.group}).` };
}

/* ------------------------------------------------------------------ *
 * CCRS's answer page
 * ------------------------------------------------------------------ */

export type UploadReport = {
  /** HTTP status of the POST (0 for a redirect the browser did not follow) */
  status: number;
  /** "basic" | "opaqueredirect" | "error" ... (Fetch Response.type) */
  responseType: string;
  /** the visible text of the answer page (tags removed) */
  text: string;
  /** set when the browser could not even send it */
  networkError?: string | null;
  /**
   * The browser stopped BEFORE the POST to CCRS (tab closed, page logged
   * out, file not fetched, name mismatch). Only trusted with status -1 and a
   * reason; the file simply waits for its turn again.
   */
  notSent?: boolean;
};

export type UploadVerdict =
  | { kind: "not-sent"; why: string }
  | { kind: "received"; receivedAtISO: string | null; receipt: string }
  | { kind: "refused"; reason: string }
  | { kind: "unknown"; why: string };

const RECEIVED_RE = /Your submission was received at\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s+Pacific Time/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** "11/18/2026 12:47:06 PM" (Pacific) -> ISO, or null. */
export function parseCcrsReceivedAt(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i.exec(s.trim());
  if (!m) return null;
  const [mo, d, y, h12, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h12 < 1 || h12 > 12 || mi > 59 || se > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  const pm = m[7].toUpperCase() === "PM";
  const h = (h12 % 12) + (pm ? 12 : 0);
  const z = (n: number) => String(n).padStart(2, "0");
  return pacificWallTimeToUtcISO(`${y}-${z(mo)}-${z(d)}`, { h, m: mi, s: se, ms: 0 });
}

/**
 * What the answer page means. Only the two PREprod texts are trusted; a
 * redirect, an error status or any other page is "unknown" (the run stops).
 */
export function classifyUpload(r: UploadReport): UploadVerdict {
  if (r.notSent === true && r.status === -1 && r.networkError) return { kind: "not-sent", why: squash(r.networkError).slice(0, 160) };
  if (r.networkError) return { kind: "unknown", why: `the browser could not finish the upload (${squash(r.networkError).slice(0, 160)})` };
  if (r.responseType === "opaqueredirect" || r.status === 0) return { kind: "unknown", why: "CCRS answered with a redirect instead of its upload page" };
  const text = squash(r.text ?? "");
  if (r.status === 200 && /Upload Confirmation/i.test(text)) {
    const m = RECEIVED_RE.exec(text);
    if (m) {
      const at = parseCcrsReceivedAt(m[1]);
      const i = text.search(/Upload Confirmation/i);
      return { kind: "received", receivedAtISO: at, receipt: text.slice(i, i + 400) };
    }
  }
  if (r.status === 200 && /Your Files Could Not Be Uploaded/i.test(text)) {
    const i = text.search(/Your Files Could Not Be Uploaded/i);
    return { kind: "refused", reason: text.slice(i, i + 400) };
  }
  return { kind: "unknown", why: `CCRS answered HTTP ${r.status} with a page this system has not seen${text ? `: "${text.slice(0, 160)}"` : ""}` };
}

/** The upload time to record: CCRS's own time when it is plausible, else the report time. */
export function uploadTimeISO(receivedAtISO: string | null, claimedAtISO: string, reportedAtMs: number): string {
  const rec = receivedAtISO ? Date.parse(receivedAtISO) : NaN;
  const claimed = Date.parse(claimedAtISO);
  if (Number.isFinite(rec) && Number.isFinite(claimed) && rec >= claimed - 5 * 60_000 && rec <= reportedAtMs + 2 * 60_000) {
    return new Date(Math.min(rec, reportedAtMs)).toISOString();
  }
  return new Date(reportedAtMs).toISOString();
}

/* ------------------------------------------------------------------ *
 * ccrs_mark_uploaded's one-at-a-time rule
 * ------------------------------------------------------------------ */

/**
 * ccrs_mark_uploaded refused with CCRS_UPLOAD_NOT_READY. May it be passed with
 * SAME_GROUP_OVERRIDE? Only when every file it waits on is a file of the
 * same group of this run, and nothing is missing from CCRS.
 */
export function uploadOverride(errorText: string, sameGroupNames: readonly string[]): boolean {
  const m = /CCRS_UPLOAD_NOT_READY: settle these first \(or give a reason of 10\+ characters\): ([\s\S]*)$/.exec(errorText);
  if (!m) return false;
  if (/CCRS does not hold/i.test(m[1])) return false;
  const parts = m[1].split(/;\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    const n = /^(\S+\.csv) \((emitted|uploaded)\)$/.exec(p);
    return !!n && sameGroupNames.includes(n[1]);
  });
}

/* ------------------------------------------------------------------ *
 * CCRS email around a run
 * ------------------------------------------------------------------ */

export type MailFact = { id: string; env: LedgerEnv | null; kind: string; subject: string; receivedAt: string | null };

/**
 * A run may not start while CCRS email waits to be applied for its env (or
 * for no known env). Such an email may answer one of the very files the run
 * would send: the 11/17 week was uploaded by hand and its 7 production
 * emails sat unapplied, so its files still read "emitted". Sending them again
 * would be a second upload of the same week.
 */
export function mailBlocksStart(mails: readonly MailFact[], env: LedgerEnv): string | null {
  const open = mails.filter((m) => m.env === env || m.env === null);
  if (open.length === 0) return null;
  const list = open.slice(0, 3).map((m) => m.subject || m.id).join("; ");
  return `${open.length} CCRS email(s) wait to be applied${open.length > 3 ? ` (first: ${list})` : ` (${list})`}. Apply or set them aside in "CCRS email" first: one may answer a file this run would send again.`;
}

/**
 * The emails a running run applies by itself (owner, D253: "waiting for each
 * email response before uploading the next set"): only its own env (by the
 * verified subject), only those that arrived after the run started. Anything
 * else stays for the owner's own Apply.
 */
export function mailToAutoApply(mails: readonly MailFact[], env: LedgerEnv, startedAtISO: string): MailFact[] {
  const from = Date.parse(startedAtISO) - 5 * 60_000;
  return mails.filter((m) => m.env === env && m.receivedAt !== null && Date.parse(m.receivedAt) >= from);
}

/**
 * A file an earlier run handed to the browser without a sure answer ("unknown",
 * or "claimed" in a run that ended) may already be at CCRS. A new run would
 * send it again, so it blocks the start until the owner either records the
 * upload (the CCRS email arrives) or marks it "not received" in the hub.
 */
export function unsureBlocksStart(unsure: readonly { fileName: string; step: string }[]): string | null {
  const xs = unsure.filter((u) => u.step === "unknown" || u.step === "claimed");
  if (xs.length === 0) return null;
  return `It is not known whether CCRS received ${names(xs)}. Wait for its CCRS email, or mark it "not received" in the run log, before a new run.`;
}

/** How often a check-in may run the email Apply (the cron also runs it). */
export const AUTO_APPLY_EVERY_MS = 2 * 60_000;

/* ------------------------------------------------------------------ *
 * Pairing
 * ------------------------------------------------------------------ */

/** A pairing key hash as the pair page receives it (sha256 hex). */
export function isTokenHash(h: string): boolean {
  return /^[0-9a-f]{64}$/.test(h);
}

/** A bearer key as the extension sends it (43-char base64url of 32 random bytes, or longer). */
export function isBearerKey(k: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(k);
}

/**
 * The pairing code the hub shows once: "GWCCRS1.<back-office origin>.<key>".
 * The extension reads the origin from it (only https, no path) and keeps the
 * key; the back office keeps only sha256(key).
 */
export const PAIRING_PREFIX = "GWCCRS1";
export function pairingCode(origin: string, key: string): string {
  return `${PAIRING_PREFIX}.${origin.replace(/\/+$/, "")}.${key}`;
}
export function parsePairingCode(code: string): { origin: string; key: string } | null {
  const c = code.trim();
  if (!c.startsWith(`${PAIRING_PREFIX}.`)) return null;
  const rest = c.slice(PAIRING_PREFIX.length + 1);
  const cut = rest.lastIndexOf(".");
  if (cut < 0) return null;
  const origin = rest.slice(0, cut);
  const key = rest.slice(cut + 1);
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) || !isBearerKey(key)) return null;
  return { origin: origin.toLowerCase(), key };
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCcrsAutoUploadCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[ccrs-auto-upload-core] FAIL: ${m}`);
    }
  };

  // hosts
  ok(envOfCcrsOrigin("https://cannabisreporting.lcb.wa.gov") === "prod", "prod origin");
  ok(envOfCcrsOrigin("https://precannabisreporting.lcb.wa.gov/") === "preprod", "preprod origin");
  ok(envOfCcrsOrigin("https://evil.cannabisreporting.lcb.wa.gov") === null && envOfCcrsOrigin("http://cannabisreporting.lcb.wa.gov") === null, "only the exact https hosts");

  // plan (the 11/17 week: 7 files stamped 513..519)
  const wk = ["Strain", "Area", "Product", "Inventory", "InventoryAdjustment", "InventoryTransfer", "Sale"].map((t, k) => ({
    id: `f${k}`, fileName: `${t}_413541_202611172205${13 + k}.csv`, fileType: t, state: "emitted", stampAt: `2026-11-18T06:05:${13 + k}Z`,
  }));
  const p = planRun(wk);
  ok(p.ok && p.files.map((f) => f.group).join("") === "1112333", "groups in order");
  ok(p.ok && p.files[0].fileType === "Strain" && p.files[6].fileType === "Sale" && p.files[6].seq === 7, "stamp order inside a group");
  ok(!planRun([...wk, { id: "x", fileName: "Product_1_1.csv", fileType: "Product", state: "uploaded", stampAt: "2026-11-10T00:00:00Z" }]).ok, "an unanswered upload blocks the start");
  ok(!planRun([]).ok, "nothing to upload");
  const bad = planRun([{ ...wk[0], stampAt: "2026-11-18T07:00:00Z" }, wk[3]]);
  ok(!bad.ok && bad.error.includes("stamped before"), "a later group stamped earlier is refused");
  ok(planRun([{ ...wk[0], purpose: "seed" }]).ok === false, "seed markers never go");

  // decisions
  const rf = (k: number, o: Partial<RunFileFact> = {}): RunFileFact => ({
    runFileId: `r${k}`, fileId: `f${k}`, fileName: wk[k].fileName, fileType: wk[k].fileType, group: AUTO_UPLOAD_GROUPS[wk[k].fileType], seq: k + 1,
    step: "pending", ledgerState: "emitted", errorMessages: null, claimedAt: null, postedAt: null, ...o,
  });
  const now = Date.parse("2026-11-19T18:00:00Z");
  const tabs: TabFact[] = [{ env: "prod", loggedIn: true, username: "Michael@greenwaymarijuana.com" }];
  const base = (files: RunFileFact[], o: Partial<StepInput> = {}): StepInput => ({
    run: { state: "running", env: "prod", ccrsUsername: "michael@greenwaymarijuana.com", gapMinutes: 10, acceptedFileIds: [] },
    files, others: [], tabs, enabled: true, nowMs: now, ...o,
  });
  const all = [0, 1, 2, 3, 4, 5, 6].map((k) => rf(k));
  let d = nextStep(base(all));
  ok(d.kind === "upload" && d.runFileId === "r0", "first: Strain");
  d = nextStep(base([rf(0, { step: "posted", ledgerState: "uploaded", postedAt: "2026-11-19T17:59:00Z" }), ...all.slice(1)]));
  ok(d.kind === "upload" && d.runFileId === "r1", "same group goes right away");
  const g1up = [0, 1, 2].map((k) => rf(k, { step: "posted", ledgerState: "uploaded", postedAt: "2026-11-19T17:00:00Z" }));
  d = nextStep(base([...g1up, ...all.slice(3)]));
  ok(d.kind === "wait" && d.why === "answer" && d.text.includes("Group 2"), "Inventory waits for Group 1's emails");
  const g1ok = [0, 1, 2].map((k) => rf(k, { step: "posted", ledgerState: k === 0 ? "errored" : "closed", errorMessages: k === 0 ? ["Duplicate Strain. The Strain must be unique for the LicenseNumber"] : null, postedAt: "2026-11-19T17:00:00Z" }));
  d = nextStep(base([...g1ok, ...all.slice(3)]));
  ok(d.kind === "upload" && d.runFileId === "r3", "answered Group 1 (Duplicate Strain is harmless) lets Inventory go");
  d = nextStep(base([...g1ok.map((f) => ({ ...f, postedAt: "2026-11-19T17:55:00Z" })), ...all.slice(3)]));
  ok(d.kind === "wait" && d.why === "gap" && d.untilMs === Date.parse("2026-11-19T18:05:00Z"), "10-minute floor between groups");
  const g1bad = g1ok.map((f, k) => (k === 2 ? { ...f, ledgerState: "errored", errorMessages: ["Invalid Product"] } : f));
  d = nextStep(base([...g1bad, ...all.slice(3)]));
  ok(d.kind === "pause" && d.fileIds.join() === "f2", "refused rows pause the run");
  d = nextStep(base([...g1bad, ...all.slice(3)], { run: { ...base([]).run, acceptedFileIds: ["f2"] } }));
  ok(d.kind === "upload" && d.runFileId === "r3", "Continue anyway accepts them");
  ok(nextStep(base([...g1ok.slice(0, 2), { ...g1ok[2], ledgerState: "reconciling" }, ...all.slice(3)])).kind === "pause", "reconciling counts as refused");
  d = nextStep(base([...g1ok, rf(3, { step: "claimed", claimedAt: "2026-11-19T17:58:00Z" }), ...all.slice(4)]));
  ok(d.kind === "wait" && d.why === "claim", "one file in flight at a time");
  d = nextStep(base([...g1ok, rf(3, { step: "claimed", claimedAt: "2026-11-19T17:40:00Z" }), ...all.slice(4)]));
  ok(d.kind === "stop" && d.runFileId === "r3", "a claim never reported stops the run");
  ok(nextStep(base([...g1ok, rf(3, { step: "unknown" }), ...all.slice(4)])).kind === "stop", "unknown stops");
  ok(nextStep(base([...g1ok, rf(3, { step: "refused" }), ...all.slice(4)])).kind === "stop", "refused stops");
  d = nextStep(base([...g1ok, rf(3, { ledgerState: "uploaded" }), ...all.slice(4)]));
  ok(d.kind === "skip" && d.runFileId === "r3", "a file uploaded by hand is not sent again");
  ok(nextStep(base([...g1ok, rf(3, { ledgerState: "abandoned" }), ...all.slice(4)])).kind === "stop", "an abandoned file stops the run");
  ok(nextStep(base([...g1ok, ...all.slice(3)], { others: [{ fileName: "Sale_old.csv", state: "uploaded" }] })).kind === "wait", "a waiting file outside the run holds it");
  // the browser
  ok(nextStep(base(all, { tabs: null })).kind === "wait", "no check-in, no upload");
  ok((nextStep(base(all, { tabs: [] })) as { why?: string }).why === "tab", "no CCRS tab");
  ok((nextStep(base(all, { tabs: [{ env: "preprod", loggedIn: true, username: "michael@greenwaymarijuana.com" }] })) as { why?: string }).why === "tab", "a PREprod tab never uploads a production run");
  ok((nextStep(base(all, { tabs: [{ env: "prod", loggedIn: false, username: null }] })) as { why?: string }).why === "login", "logged out");
  ok((nextStep(base(all, { tabs: [{ env: "prod", loggedIn: true, username: "someone@else.com" }] })) as { why?: string }).why === "account", "another account's emails would never arrive");
  ok(nextStep(base(all, { enabled: false })).kind === "idle", "kill switch");
  ok(nextStep(base(all, { run: { ...base([]).run, state: "paused" } })).kind === "idle", "paused run hands out nothing");
  // the end
  const sent = [0, 1, 2, 3, 4, 5, 6].map((k) => rf(k, { step: "posted", ledgerState: "uploaded", postedAt: "2026-11-19T17:00:00Z" }));
  ok(nextStep(base(sent)).kind === "wait", "all sent, waiting for the last emails");
  const fin = sent.map((f) => ({ ...f, ledgerState: "closed" }));
  ok(nextStep(base(fin)).kind === "done", "done");
  ok(nextStep(base(fin.map((f, k) => (k === 6 ? { ...f, ledgerState: "errored", errorMessages: ["Invalid InventoryExternalIdentifier"] } : f)))).text.includes("refused rows"), "done says what CCRS refused");

  // the answer page (texts observed on PREprod 2026-11-18)
  const conf = "WSLCB Cannabis Reporting Upload Upload Confirmation Your submission was received at 11/18/2026 12:47:06 PM Pacific Time When your files are processed you will receive a success notification and/or an error notification for each file.";
  let v = classifyUpload({ status: 200, responseType: "basic", text: conf });
  ok(v.kind === "received" && v.receivedAtISO === "2026-11-18T20:47:06.000Z", "confirmation + Pacific time (PST = UTC-8)");
  ok(v.kind === "received" && v.receipt.startsWith("Upload Confirmation"), "receipt kept");
  v = classifyUpload({ status: 200, responseType: "basic", text: "Your Files Could Not Be Uploaded You have not uploaded any files. Please click 'Browse' to select files for processing." });
  ok(v.kind === "refused" && v.reason.includes("not uploaded any files"), "could not be uploaded");
  ok(classifyUpload({ status: 0, responseType: "opaqueredirect", text: "" }).kind === "unknown", "a redirect is unknown");
  ok(classifyUpload({ status: 500, responseType: "basic", text: conf }).kind === "unknown", "an error status is unknown even with the words");
  ok(classifyUpload({ status: 200, responseType: "basic", text: "Something else" }).kind === "unknown", "an unseen page is unknown");
  ok(classifyUpload({ status: 200, responseType: "basic", text: "", networkError: "Failed to fetch" }).kind === "unknown", "network error is unknown");
  ok(classifyUpload({ status: 200, responseType: "basic", text: "Upload Confirmation but no time" }).kind === "unknown", "confirmation without the received line is unknown");
  ok(parseCcrsReceivedAt("7/4/2026 1:05:09 AM") === "2026-07-04T08:05:09.000Z", "PDT = UTC-7");
  ok(parseCcrsReceivedAt("13/01/2026 1:00:00 PM") === null && parseCcrsReceivedAt("2/30/2026 1:00:00 PM") === null && parseCcrsReceivedAt("1/1/2026 13:00:00 PM") === null, "bad dates are null");
  ok(parseCcrsReceivedAt("1/1/2026 12:00:00 AM") === "2026-01-01T08:00:00.000Z", "12 AM is midnight");
  const claimedAt = "2026-11-18T20:46:50.000Z";
  ok(uploadTimeISO("2026-11-18T20:47:06.000Z", claimedAt, Date.parse("2026-11-18T20:47:08Z")) === "2026-11-18T20:47:06.000Z", "CCRS time used");
  ok(uploadTimeISO("2026-11-18T10:00:00.000Z", claimedAt, Date.parse("2026-11-18T20:47:08Z")) === "2026-11-18T20:47:08.000Z", "an implausible CCRS time is not used");
  ok(uploadTimeISO(null, claimedAt, Date.parse("2026-11-18T20:47:08Z")) === "2026-11-18T20:47:08.000Z", "no CCRS time: report time");

  // override
  const e = "ccrs_mark_uploaded: CCRS_UPLOAD_NOT_READY: settle these first (or give a reason of 10+ characters): Strain_1_20261117220513.csv (uploaded)";
  ok(uploadOverride(e, ["Strain_1_20261117220513.csv", "Area_1_20261117220514.csv"]), "same group passes");
  ok(!uploadOverride(e, ["Area_1_20261117220514.csv"]), "a file outside the group never passes");
  ok(!uploadOverride(`${e}; CCRS does not hold 1 thing(s) this file names: Product "X"`, ["Strain_1_20261117220513.csv"]), "a missing reference never passes");
  ok(!uploadOverride("CCRS_UPLOAD_TIME: bad", ["x"]), "other errors never pass");
  ok(SAME_GROUP_OVERRIDE.length >= 10, "override reason long enough for 0249");

  // pairing + switch
  ok(isTokenHash("a".repeat(64)) && !isTokenHash("A".repeat(64)) && !isTokenHash("a".repeat(63)), "hash shape");
  ok(isBearerKey("A".repeat(43)) && !isBearerKey("short") && !isBearerKey("a b".repeat(20)), "key shape");
  ok(autoUploadEnabled({}) && !autoUploadEnabled({ CCRS_AUTO_UPLOAD: " OFF " }), "kill switch env");
  ok(hasRefusals({ state: "closed", errorMessages: ["File has not been processed (CCRS sent no error file)"] }) && !hasRefusals({ state: "uploaded", errorMessages: ["x"] }), "refusal reading");
  // CCRS email around a run
  const ml = (id: string, env: LedgerEnv | null, at: string | null): MailFact => ({ id, env, kind: "success", subject: `s-${id}`, receivedAt: at });
  ok(mailBlocksStart([], "prod") === null, "no open mail, may start");
  ok(mailBlocksStart([ml("a", "preprod", null)], "prod") === null, "a PREprod email does not block production");
  ok((mailBlocksStart([ml("a", "prod", null)], "prod") ?? "").includes("send again"), "an open production email blocks a production run");
  ok(mailBlocksStart([ml("a", null, null)], "preprod") !== null, "an email of unknown env blocks both");
  const started = "2026-11-19T17:00:00.000Z";
  const am = mailToAutoApply([ml("old", "prod", "2026-11-18T10:00:00Z"), ml("new", "prod", "2026-11-19T17:30:00Z"), ml("pre", "preprod", "2026-11-19T17:30:00Z"), ml("nul", null, "2026-11-19T17:30:00Z"), ml("nt", "prod", null)], "prod", started);
  ok(am.map((m) => m.id).join() === "new", "only this env's emails since the run started are applied by the run");
  // pairing code
  const key = "A".repeat(43);
  const pc = pairingCode("https://www.greenwaymarijuana.com/", key);
  ok(pc === `GWCCRS1.https://www.greenwaymarijuana.com.${key}`, "pairing code shape");
  const pp = parsePairingCode(` ${pc} `);
  ok(pp !== null && pp.origin === "https://www.greenwaymarijuana.com" && pp.key === key, "pairing code round trip");
  ok(parsePairingCode(`GWCCRS1.http://www.greenwaymarijuana.com.${key}`) === null, "http origin refused");
  ok(parsePairingCode(`GWCCRS1.https://x.com/path.${key}`) === null && parsePairingCode(`GWCCRS1.https://x.com.short`) === null && parsePairingCode(`nope.${key}`) === null, "bad codes refused");
  ok(unsureBlocksStart([]) === null && unsureBlocksStart([{ fileName: "a.csv", step: "skipped" }]) === null, "settled steps do not block");
  ok((unsureBlocksStart([{ fileName: "a.csv", step: "unknown" }]) ?? "").includes("a.csv") && unsureBlocksStart([{ fileName: "b.csv", step: "claimed" }]) !== null, "an unsure hand-out blocks a new run");
  ok(nextStep(base(all, { others: [{ fileName: "Sale_9.csv", state: "emitted" }] })).kind === "upload", "a file built after the start does not block");
  d = nextStep(base([...g1ok, ...all.slice(3)], { others: [{ fileName: "Sale_9.csv", state: "uploaded" }] }));
  ok(d.kind === "wait" && d.text.includes("Sale_9.csv"), "an outside upload waiting for CCRS blocks the next group");
  ok(classifyUpload({ status: -1, responseType: "error", text: "", networkError: "tab closed", notSent: true }).kind === "not-sent", "nothing sent is not-sent");
  ok(classifyUpload({ status: 200, responseType: "basic", text: "Upload Confirmation Your submission was received at 11/18/2026 12:47:06 PM Pacific Time", notSent: true }).kind === "received", "a real answer page beats a not-sent flag");
  ok(classifyUpload({ status: -1, responseType: "error", text: "", networkError: "x", notSent: false }).kind === "unknown", "a failure during the POST is unknown");

  // D254: keep-alive switch and when it may run
  ok(!keepAliveEnabled({}) && !keepAliveEnabled({ CCRS_KEEPALIVE: "yes" }) && keepAliveEnabled({ CCRS_KEEPALIVE: " ON " }), "keep-alive is off unless CCRS_KEEPALIVE=on");
  const wAnswer = nextStep(base([...g1up, ...all.slice(3)]));
  ok(keepAliveFor(wAnswer, true) && !keepAliveFor(wAnswer, false), "waiting for CCRS email keeps the page alive only when switched on");
  const wGap = nextStep(base([...g1ok.map((f) => ({ ...f, postedAt: "2026-11-19T17:55:00Z" })), ...all.slice(3)]));
  ok(keepAliveFor(wGap, true), "the gap between groups keeps the page alive");
  const wLogin = nextStep(base(all, { tabs: [{ env: "prod", loggedIn: false, username: null }] }));
  ok(!keepAliveFor(wLogin, true), "a logged-out page is never refreshed (the owner logs in)");
  ok(!keepAliveFor(nextStep(base([...g1ok, rf(3, { step: "claimed", claimedAt: "2026-11-19T17:58:00Z" }), ...all.slice(4)])), true), "never while a file is in the browser");
  ok(!keepAliveFor({ kind: "idle", text: "x" }, true) && !keepAliveFor(nextStep(base(all)), true), "never when idle or uploading");
  ok(!keepAliveFor(nextStep(base(all, { tabs: [{ env: "prod", loggedIn: true, username: "someone@else.com" }] })), true), "never for another account");
  // D254: the log-in alert
  ok(wLogin.kind === "wait" && wLogin.next?.runFileId === "r0" && wLogin.next.group === 1, "a login wait names the file it holds back");
  ok(loginAlertFor("run1", "prod", wLogin, null, now) === null, "a new login wait does not alert yet");
  ok(loginAlertFor("run1", "prod", wLogin, now - LOGIN_ALERT_AFTER_MS + 1, now) === null, "not before the grace time");
  const la = loginAlertFor("run1", "prod", wLogin, now - LOGIN_ALERT_AFTER_MS, now);
  ok(la !== null && la.dedupeKey === "ccrs_auto_upload:run1:login:r0", "one alert per run per held file");
  ok(la !== null && la.subject.includes("log in to CCRS production") && la.body.includes("Group 1") && la.body.includes(wk[0].fileName), "the alert says which site, group and file");
  const g3 = nextStep(base([...g1ok, rf(3, { step: "posted", ledgerState: "closed", postedAt: "2026-11-19T17:00:00Z" }), ...all.slice(4)], { tabs: [{ env: "prod", loggedIn: false, username: null }] }));
  ok(loginAlertFor("run1", "prod", g3, 0, now)?.dedupeKey === "ccrs_auto_upload:run1:login:r4", "the next group's logout alerts again");
  ok(loginAlertFor("run1", "preprod", nextStep(base(all, { tabs: [] })), 0, now)?.subject.includes("PREprod") === true, "a closed page alerts too");
  ok(loginAlertFor("run1", "prod", nextStep(base(all, { tabs: [{ env: "prod", loggedIn: true, username: "x@y.z" }] })), 0, now) !== null, "another account alerts too");
  ok(nextStep(base(all, { tabs: [{ env: "prod", loggedIn: false, username: null }, { env: "prod", loggedIn: true, username: "michael@greenwaymarijuana.com" }] })).kind === "upload", "a logged-in tab beats an old logged-out tab of the same site");
  ok((nextStep(base(all, { tabs: [{ env: "prod", loggedIn: true, username: "x@y.z" }, { env: "prod", loggedIn: true, username: "michael@greenwaymarijuana.com" }] })) as { kind: string }).kind === "upload", "the run's account beats another account");
  ok(loginAlertFor("run1", "prod", wAnswer, 0, now) === null && loginAlertFor("run1", "prod", nextStep(base(all, { tabs: null })), 0, now) === null, "waiting for CCRS email or a first check-in never alerts");
  return { passed, failed };
}
