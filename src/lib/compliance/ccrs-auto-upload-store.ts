/**
 * src/lib/compliance/ccrs-auto-upload-store.ts - D253 server glue.
 *
 * The assisted CCRS uploader (owner's option A): the owner logs into CCRS in
 * his own Chrome; the Greenway extension in that Chrome checks in here every
 * ~30 seconds and is told, one file at a time, what to upload through the
 * CCRS web form. Every decision is the PURE ccrs-auto-upload-core (nextStep,
 * classifyUpload, uploadOverride, mailBlocksStart, ...). This file only reads
 * facts, writes the answer and tells the owner.
 *
 * Safety (each is also enforced by 0369 where a database can):
 *   - the extension holds a random key; only sha256(key) is stored; a revoked
 *     device gets nothing (no file bytes, no decisions);
 *   - one run at a time (ccrs_upload_runs_one_active), one file in flight at
 *     a time (ccrs_upload_run_files_one_claimed), a file waits in one run
 *     only (ccrs_upload_run_files_one_waiting);
 *   - a file is handed out by a conditional update (step pending -> claimed),
 *     so two check-ins can never both get it;
 *   - nothing is ever retried: an unknown answer stops the run and the owner
 *     looks at CCRS's email; a new run is refused while such a file exists;
 *   - the email Apply the run uses is the hub's own Apply (ccrs-mail-apply),
 *     acting as the owner who started the run, re-checked as active with
 *     settings.manage every time.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { can } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { listCcrsFilesLite, markUploaded, readStoredFile } from "./ccrs-ledger-store";
import type { LedgerEnv } from "./ccrs-ledger-core";
import { listOpenCcrsMail, type StoredCcrsMail } from "./ccrs-mail-store";
import { mailConfigFromEnv } from "./ccrs-mail-core";
import { applyOneStoredMail } from "./ccrs-mail-apply";
import { MAIL_CLAIM_PENDING } from "./ccrs-mail-notify";
import {
  AUTO_APPLY_EVERY_MS,
  AUTO_UPLOAD_GROUPS,
  CCRS_ORIGINS,
  DEFAULT_GAP_MINUTES,
  DEVICE_SILENT_MS,
  SAME_GROUP_OVERRIDE,
  autoUploadEnabled,
  classifyUpload,
  envOfCcrsOrigin,
  hasRefusals,
  isBearerKey,
  keepAliveEnabled,
  keepAliveFor,
  KEEPALIVE_EVERY_MS,
  loginAlertFor,
  mailBlocksStart,
  mailToAutoApply,
  nextStep,
  pairingCode,
  planRun,
  unsureBlocksStart,
  uploadOverride,
  uploadTimeISO,
  type Decision,
  type MailFact,
  type RunFileFact,
  type StepState,
  type TabFact,
  type UploadReport,
} from "./ccrs-auto-upload-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const AUTO_UPLOAD_ALERT_STAGE = "ccrs_auto_upload";
const ALL_TYPES = Object.keys(AUTO_UPLOAD_GROUPS);
const RUN_COLS =
  "id, env, state, ccrs_username, gap_minutes, accepted_file_ids, started_by, started_by_email, started_at, ended_at, ended_reason, last_decision, last_decision_at, last_mail_check_at";
const RF_COLS = "id, run_id, file_id, seq, grp, file_name, file_type, step, claimed_at, claimed_by_device, posted_at, ccrs_received_at, receipt, note";
const DEV_COLS = "id, label, created_by_email, created_at, last_seen_at, last_tabs, last_version, revoked_at, silent_alerted_at";

export type UploaderDevice = {
  id: string;
  label: string;
  created_by_email: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_tabs: { origin: string; loggedIn: boolean; username: string | null }[] | null;
  last_version: string | null;
  revoked_at: string | null;
  silent_alerted_at: string | null;
};

export type UploadRun = {
  id: string;
  env: LedgerEnv;
  state: "running" | "paused" | "stopped" | "done" | "failed";
  ccrs_username: string;
  gap_minutes: number;
  accepted_file_ids: string[];
  started_by: string;
  started_by_email: string | null;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  last_decision: string | null;
  last_decision_at: string | null;
  last_mail_check_at: string | null;
};

export type UploadRunFile = {
  id: string;
  run_id: string;
  file_id: string;
  seq: number;
  grp: 1 | 2 | 3;
  file_name: string;
  file_type: string;
  step: StepState;
  claimed_at: string | null;
  claimed_by_device: string | null;
  posted_at: string | null;
  ccrs_received_at: string | null;
  receipt: string | null;
  note: string | null;
};

export type Actor = { id: string; email: string | null };

const clip = (s: string, n = 2000) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const hashKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

/* ------------------------------------------------------------------ *
 * Devices (pairing)
 * ------------------------------------------------------------------ */

/** Make a key for a new browser. The code is shown ONCE; only sha256(key) is kept. */
export async function pairDevice(admin: Admin, label: string, actor: Actor): Promise<{ id: string; code: string }> {
  const name = label.trim().slice(0, 80) || "Owner's Chrome";
  const key = randomBytes(32).toString("base64url");
  const { data, error } = await admin
    .from("ccrs_uploader_devices")
    .insert({ label: name, token_hash: hashKey(key), created_by: actor.id, created_by_email: actor.email })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ccrs_uploader_devices: ${error?.message ?? "no row"}`);
  return { id: (data as { id: string }).id, code: pairingCode(publicSiteOrigin(process.env), key) };
}

export async function revokeDevice(admin: Admin, id: string, actor: Actor): Promise<void> {
  const { error } = await admin.from("ccrs_uploader_devices").update({ revoked_at: new Date().toISOString(), revoked_by: actor.id }).eq("id", id).is("revoked_at", null);
  if (error) throw new Error(`ccrs_uploader_devices: ${error.message}`);
}

export async function listDevices(admin: Admin): Promise<UploaderDevice[]> {
  const { data, error } = await admin.from("ccrs_uploader_devices").select(DEV_COLS).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(`ccrs_uploader_devices: ${error.message}`);
  return (data as UploaderDevice[] | null) ?? [];
}

/** The device behind an Authorization header, or null (bad shape, unknown, revoked). */
export async function authenticateDevice(admin: Admin, authorization: string | null): Promise<UploaderDevice | null> {
  const m = /^Bearer\s+(\S+)$/.exec((authorization ?? "").trim());
  if (!m || !isBearerKey(m[1])) return null;
  const { data, error } = await admin.from("ccrs_uploader_devices").select(DEV_COLS).eq("token_hash", hashKey(m[1])).maybeSingle();
  if (error || !data) return null;
  const d = data as UploaderDevice;
  return d.revoked_at ? null : d;
}

/** The tabs the extension reports, cleaned: only the two CCRS hosts count. */
export function tabsFromBody(raw: unknown): { facts: TabFact[]; stored: UploaderDevice["last_tabs"] } {
  const facts: TabFact[] = [];
  const stored: NonNullable<UploaderDevice["last_tabs"]> = [];
  if (!Array.isArray(raw)) return { facts, stored };
  for (const t of raw.slice(0, 10)) {
    if (!t || typeof t !== "object") continue;
    const o = t as { origin?: unknown; loggedIn?: unknown; username?: unknown };
    const origin = typeof o.origin === "string" ? o.origin.slice(0, 200) : "";
    const env = envOfCcrsOrigin(origin);
    if (!env) continue;
    const username = typeof o.username === "string" && o.username.trim() ? o.username.trim().slice(0, 200) : null;
    const loggedIn = o.loggedIn === true;
    facts.push({ env, loggedIn, username });
    stored.push({ origin: CCRS_ORIGINS[env], loggedIn, username });
  }
  return { facts, stored };
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export async function getActiveRun(admin: Admin): Promise<UploadRun | null> {
  const { data, error } = await admin.from("ccrs_upload_runs").select(RUN_COLS).in("state", ["running", "paused"]).maybeSingle();
  if (error) throw new Error(`ccrs_upload_runs: ${error.message}`);
  return (data as UploadRun | null) ?? null;
}

export async function runFiles(admin: Admin, runId: string): Promise<UploadRunFile[]> {
  const { data, error } = await admin.from("ccrs_upload_run_files").select(RF_COLS).eq("run_id", runId).order("seq", { ascending: true });
  if (error) throw new Error(`ccrs_upload_run_files: ${error.message}`);
  return (data as UploadRunFile[] | null) ?? [];
}

/**
 * Hand-outs with no sure answer whose ledger file still reads "emitted": a
 * file the browser held (claimed / unknown) or that CCRS confirmed but the hub
 * could not record (posted). A new run would send such a file again, so it
 * blocks the start. Once the CCRS email (or the owner) settles the ledger
 * file, it no longer blocks.
 */
export async function unsureHandOuts(admin: Admin, exceptRunId: string | null = null): Promise<UploadRunFile[]> {
  const { data, error } = await admin.from("ccrs_upload_run_files").select(RF_COLS).in("step", ["unknown", "claimed", "posted"]).order("updated_at", { ascending: false }).limit(300);
  if (error) throw new Error(`ccrs_upload_run_files: ${error.message}`);
  const rows = ((data as UploadRunFile[] | null) ?? []).filter((r) => r.run_id !== exceptRunId);
  if (rows.length === 0) return [];
  const { data: led, error: e2 } = await admin.from("ccrs_files").select("id, state").in("id", [...new Set(rows.map((r) => r.file_id))]);
  if (e2) throw new Error(`ccrs_files: ${e2.message}`);
  const emitted = new Set(((led as { id: string; state: string }[] | null) ?? []).filter((r) => r.state === "emitted").map((r) => r.id));
  return rows.filter((r) => emitted.has(r.file_id)).map((r) => (r.step === "posted" ? { ...r, step: "unknown" as StepState, note: r.note ?? "CCRS confirmed it but the hub did not record the upload" } : r));
}

const toMailFact = (m: StoredCcrsMail): MailFact => ({ id: m.id, env: m.env_verified ? m.env : null, kind: m.kind, subject: m.subject, receivedAt: m.received_at });

export type StartResult = { ok: true; runId: string; files: number } | { ok: false; error: string };

/** Start a run of every emitted file of the env (refused with a plain reason when it may not). */
export async function startRun(admin: Admin, env: LedgerEnv, actor: Actor, gapMinutes: number = DEFAULT_GAP_MINUTES): Promise<StartResult> {
  if (!autoUploadEnabled(process.env)) return { ok: false, error: "Automatic upload is switched off (CCRS_AUTO_UPLOAD=off)." };
  if (await getActiveRun(admin)) return { ok: false, error: "A run is already going. Stop it first." };
  const unsure = unsureBlocksStart((await unsureHandOuts(admin)).map((u) => ({ fileName: u.file_name, step: u.step })));
  if (unsure) return { ok: false, error: unsure };
  const mail = mailBlocksStart((await listOpenCcrsMail(admin, 100)).map(toMailFact), env);
  if (mail) return { ok: false, error: mail };
  const ledger = await listCcrsFilesLite(admin, [env], ["emitted", "uploaded"], ALL_TYPES, 400);
  const plan = planRun(ledger.map((f) => ({ id: f.id, fileName: f.fileName, fileType: f.fileType, state: f.state, stampAt: f.stampAt, purpose: f.purpose })));
  if (!plan.ok) return { ok: false, error: plan.error };
  const gap = Math.max(0, Math.min(240, Math.round(Number.isFinite(gapMinutes) ? gapMinutes : DEFAULT_GAP_MINUTES)));
  const { data: run, error: e1 } = await admin
    .from("ccrs_upload_runs")
    .insert({ env, ccrs_username: mailConfigFromEnv(process.env).mailbox, gap_minutes: gap, started_by: actor.id, started_by_email: actor.email, last_decision: "Started. Waiting for the browser to check in.", last_decision_at: new Date().toISOString() })
    .select("id")
    .single();
  if (e1 || !run) {
    if (e1?.code === "23505") return { ok: false, error: "A run is already going. Stop it first." };
    throw new Error(`ccrs_upload_runs: ${e1?.message ?? "no row"}`);
  }
  const runId = (run as { id: string }).id;
  const { error: e2 } = await admin.from("ccrs_upload_run_files").insert(
    plan.files.map((f) => ({ run_id: runId, file_id: f.fileId, seq: f.seq, grp: f.group, file_name: f.fileName, file_type: f.fileType })),
  );
  if (e2) {
    await admin.from("ccrs_upload_runs").update({ state: "failed", ended_at: new Date().toISOString(), ended_reason: clip(`Could not list the files: ${e2.message}`), updated_at: new Date().toISOString() }).eq("id", runId);
    return { ok: false, error: e2.code === "23505" ? "One of these files is already waiting in another run." : `Could not list the files: ${e2.message}` };
  }
  return { ok: true, runId, files: plan.files.length };
}

/**
 * End a run. Files never handed out go back (skipped, so a later run may take
 * them); a file in the browser's hands becomes "unknown" (never re-sent blind).
 */
export async function endRun(admin: Admin, runId: string, state: "stopped" | "done" | "failed", reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("ccrs_upload_runs")
    .update({ state, ended_at: now, ended_reason: clip(reason), last_decision: clip(reason), last_decision_at: now, updated_at: now })
    .eq("id", runId)
    .in("state", ["running", "paused"])
    .select("id");
  if (error) throw new Error(`ccrs_upload_runs: ${error.message}`);
  await admin.from("ccrs_upload_run_files").update({ step: "skipped", note: "run ended before this file was sent", updated_at: now }).eq("run_id", runId).eq("step", "pending");
  await admin.from("ccrs_upload_run_files").update({ step: "unknown", note: "run ended while the browser held this file", updated_at: now }).eq("run_id", runId).eq("step", "claimed");
  return ((data as unknown[] | null) ?? []).length > 0;
}

export async function pauseRun(admin: Admin, runId: string, reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("ccrs_upload_runs").update({ state: "paused", last_decision: clip(reason), last_decision_at: now, updated_at: now }).eq("id", runId).eq("state", "running").select("id");
  if (error) throw new Error(`ccrs_upload_runs: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

export async function resumeRun(admin: Admin, runId: string, acceptFileIds: readonly string[] = []): Promise<boolean> {
  const run = await getActiveRun(admin);
  if (!run || run.id !== runId || run.state !== "paused") return false;
  const now = new Date().toISOString();
  const accepted = [...new Set([...(run.accepted_file_ids ?? []), ...acceptFileIds])];
  const { data, error } = await admin
    .from("ccrs_upload_runs")
    .update({ state: "running", accepted_file_ids: accepted, last_decision: acceptFileIds.length ? "Resumed: refused rows accepted by the owner." : "Resumed.", last_decision_at: now, updated_at: now })
    .eq("id", runId)
    .eq("state", "paused")
    .select("id");
  if (error) throw new Error(`ccrs_upload_runs: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/**
 * The owner checked CCRS: an unsure hand-out of an ended run was NOT received
 * (no confirmation page, no email). Only then may a later run send it.
 */
export async function markNotReceived(admin: Admin, runFileId: string, note: string): Promise<boolean> {
  const { data: rf } = await admin.from("ccrs_upload_run_files").select("id, run_id, step").eq("id", runFileId).maybeSingle();
  const row = rf as { id: string; run_id: string; step: string } | null;
  if (!row || (row.step !== "unknown" && row.step !== "claimed")) return false;
  const active = await getActiveRun(admin);
  if (active && active.id === row.run_id) return false; // end the run first
  const { data, error } = await admin
    .from("ccrs_upload_run_files")
    .update({ step: "skipped", note: clip(`owner: not received by CCRS. ${note}`.trim()), updated_at: new Date().toISOString() })
    .eq("id", runFileId)
    .in("step", ["unknown", "claimed"])
    .select("id");
  if (error) throw new Error(`ccrs_upload_run_files: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/* ------------------------------------------------------------------ *
 * The owner the run acts as
 * ------------------------------------------------------------------ */

async function runActor(admin: Admin, run: UploadRun): Promise<{ profile: { id: string }; email: string } | null> {
  const { data } = await admin.from("staff_profiles").select("id, email, role, active").eq("id", run.started_by).maybeSingle();
  const p = data as { id: string; email: string | null; role: StaffRole | null; active: boolean | null } | null;
  if (!p || p.active === false || !can(p.role, "settings.manage")) return null;
  return { profile: { id: p.id }, email: `${p.email ?? run.started_by_email ?? "owner"} (auto-uploader)` };
}

/* ------------------------------------------------------------------ *
 * Alerts (send once: compliance_reminder_log claim, the S-18b pattern)
 * ------------------------------------------------------------------ */

const staffEmails = () => (process.env.ORDER_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function alertOwnerOnce(admin: Admin, dedupeKey: string, subject: string, body: string, anchorUrl: string): Promise<"sent" | "taken" | "no-channel" | "error"> {
  const emailOn = Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0);
  const pushOn = isPushConfigured();
  if (!emailOn && !pushOn) return "no-channel";
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({ dedupe_key: dedupeKey, stage: AUTO_UPLOAD_ALERT_STAGE, week_key: null, channel: "email", subject: clip(subject, 300), recipients: MAIL_CLAIM_PENDING });
    if (error) return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
  const channels: string[] = [];
  const recipients: string[] = [];
  if (emailOn) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const r = await sendStaffAlertEmail({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.ORDER_EMAIL_FROM ?? "",
      to: staffEmails(),
      subject,
      html: `<p>${esc(body)}</p><p><a href="${esc(anchorUrl)}">Open the CCRS hub</a></p>`,
    }).catch(() => ({ ok: false }));
    if (r.ok) {
      channels.push("email");
      recipients.push(...staffEmails());
    }
  }
  if (pushOn) {
    const n = await sendPushToAll({ title: subject, body: clip(body, 180), url: anchorUrl, tag: dedupeKey }).catch(() => 0);
    if (n > 0) {
      channels.push("push");
      recipients.push(`push:${n}`);
    }
  }
  try {
    await admin
      .from("compliance_reminder_log")
      .update({ channel: channels.length === 2 ? "email+push" : channels[0] ?? "email", recipients: recipients.length ? recipients.join(", ") : "UNDELIVERED" })
      .eq("dedupe_key", dedupeKey);
  } catch {
    /* the claim already prevents a repeat */
  }
  return "sent";
}

const hubUrl = (env: LedgerEnv) => `${publicSiteOrigin(process.env)}/admin/compliance/ccrs${env === "preprod" ? "?env=preprod" : ""}#ccrs-auto-upload`;

/* ------------------------------------------------------------------ *
 * The email step (applied by the run, as the owner)
 * ------------------------------------------------------------------ */

export type AutoApplyNote = { applied: number; notes: string[] };

/** Apply this run's CCRS email (throttled; the run's own slot is claimed first). */
export async function autoApplyForRun(admin: Admin, run: UploadRun, nowMs: number, force = false): Promise<AutoApplyNote> {
  const out: AutoApplyNote = { applied: 0, notes: [] };
  const cutoff = new Date(nowMs - AUTO_APPLY_EVERY_MS).toISOString();
  let q = admin.from("ccrs_upload_runs").update({ last_mail_check_at: new Date(nowMs).toISOString() }).eq("id", run.id).eq("state", "running");
  if (!force) q = q.or(`last_mail_check_at.is.null,last_mail_check_at.lt.${cutoff}`);
  const { data: slot, error } = await q.select("id");
  if (error || ((slot as unknown[] | null) ?? []).length === 0) return out;
  const actor = await runActor(admin, run);
  if (!actor) {
    await endRun(admin, run.id, "stopped", "The person who started this run can no longer manage settings. The run stopped.");
    out.notes.push("starter lost settings.manage");
    return out;
  }
  let open: StoredCcrsMail[];
  try {
    open = await listOpenCcrsMail(admin, 100);
  } catch (e) {
    out.notes.push(`mail read failed: ${msg(e)}`);
    return out;
  }
  const want = new Set(mailToAutoApply(open.map(toMailFact), run.env, run.started_at).map((m) => m.id));
  for (const m of open.filter((x) => want.has(x.id))) {
    const r = await applyOneStoredMail(admin, actor, m);
    if (r.ok) out.applied += 1;
    out.notes.push(`${m.subject}: ${r.text}`.slice(0, 300));
  }
  if (out.applied > 0) {
    await recordAudit({ actorId: actor.profile.id, actorEmail: actor.email, action: "ccrs.auto_upload.mail_applied", entityType: "ccrs_upload_run", entityId: run.id, after: { applied: out.applied, notes: out.notes.slice(0, 10) } });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Check-in: the one decision
 * ------------------------------------------------------------------ */

export type CheckInAnswer =
  | {
      action: "idle" | "wait";
      text: string;
      runId: string | null;
      env: LedgerEnv | null;
      pollSeconds: number;
      /** D254: re-read the CCRS page of `env` every keepAliveSeconds (only while waiting, only when CCRS_KEEPALIVE=on). */
      keepAlive?: boolean;
      keepAliveSeconds?: number;
    }
  | { action: "upload"; text: string; runId: string; env: LedgerEnv; runFileId: string; fileName: string; uploadOrigin: string; pollSeconds: number };

async function ledgerFacts(admin: Admin, run: UploadRun, files: UploadRunFile[]): Promise<{ facts: RunFileFact[]; others: { fileName: string; state: string }[] }> {
  const ids = files.map((f) => f.file_id);
  const { data, error } = await admin.from("ccrs_files").select("id, state, error_messages").in("id", ids);
  if (error) throw new Error(`ccrs_files: ${error.message}`);
  const by = new Map(((data as { id: string; state: string; error_messages: string[] | null }[] | null) ?? []).map((r) => [r.id, r]));
  const facts: RunFileFact[] = files.map((f) => ({
    runFileId: f.id, fileId: f.file_id, fileName: f.file_name, fileType: f.file_type, group: f.grp, seq: f.seq, step: f.step,
    ledgerState: by.get(f.file_id)?.state ?? "missing", errorMessages: by.get(f.file_id)?.error_messages ?? null, claimedAt: f.claimed_at, postedAt: f.posted_at,
  }));
  const inRun = new Set(ids);
  const others = (await listCcrsFilesLite(admin, [run.env], ["uploaded"], ALL_TYPES, 100)).filter((f) => !inRun.has(f.id)).map((f) => ({ fileName: f.fileName, state: f.state }));
  return { facts, others };
}

async function noteDecision(admin: Admin, run: UploadRun, text: string): Promise<void> {
  if (run.last_decision === text) return;
  const now = new Date().toISOString();
  await admin.from("ccrs_upload_runs").update({ last_decision: clip(text), last_decision_at: now, updated_at: now }).eq("id", run.id);
  run.last_decision = text;
}

async function actOn(admin: Admin, run: UploadRun, d: Decision, device: UploaderDevice, nowMs: number): Promise<CheckInAnswer | "again"> {
  const base = { runId: run.id, env: run.env, pollSeconds: 30 };
  switch (d.kind) {
    case "idle":
      return { action: "idle", text: d.text, ...base, pollSeconds: 60 };
    case "wait": {
      // D254: the same wait since when? (noteDecision keeps last_decision_at
      // at the first check-in that gave this text.)
      const since = run.last_decision === d.text && run.last_decision_at ? Date.parse(run.last_decision_at) : null;
      await noteDecision(admin, run, d.text);
      const alert = loginAlertFor(run.id, run.env, d, since, nowMs);
      if (alert) await alertOwnerOnce(admin, alert.dedupeKey, alert.subject, alert.body, hubUrl(run.env));
      const keepAlive = keepAliveFor(d, keepAliveEnabled(process.env));
      return {
        action: "wait",
        text: d.text,
        ...base,
        pollSeconds: d.why === "answer" ? 60 : 30,
        ...(keepAlive ? { keepAlive: true, keepAliveSeconds: KEEPALIVE_EVERY_MS / 1000 } : {}),
      };
    }
    case "skip": {
      await admin.from("ccrs_upload_run_files").update({ step: "skipped", note: clip(d.text), updated_at: new Date(nowMs).toISOString() }).eq("id", d.runFileId).eq("step", "pending");
      return "again";
    }
    case "pause": {
      if (await pauseRun(admin, run.id, d.text)) {
        await alertOwnerOnce(admin, `ccrs_auto_upload:${run.id}:pause:${d.fileIds.join(",")}`, "CCRS upload paused: CCRS refused rows", d.text, hubUrl(run.env));
      }
      return { action: "idle", text: d.text, ...base, pollSeconds: 60 };
    }
    case "stop": {
      if (d.runFileId) {
        await admin.from("ccrs_upload_run_files").update({ step: "unknown", note: clip(d.text), updated_at: new Date(nowMs).toISOString() }).eq("id", d.runFileId).eq("step", "claimed");
      }
      if (await endRun(admin, run.id, "stopped", d.text)) {
        await alertOwnerOnce(admin, `ccrs_auto_upload:${run.id}:stop`, "CCRS upload stopped: please look", d.text, hubUrl(run.env));
      }
      return { action: "idle", text: d.text, ...base, pollSeconds: 60 };
    }
    case "done": {
      if (await endRun(admin, run.id, "done", d.text)) {
        await alertOwnerOnce(admin, `ccrs_auto_upload:${run.id}:done`, "CCRS upload finished", d.text, hubUrl(run.env));
      }
      return { action: "idle", text: d.text, ...base, pollSeconds: 60 };
    }
    case "upload": {
      const now = new Date(nowMs).toISOString();
      const { data, error } = await admin
        .from("ccrs_upload_run_files")
        .update({ step: "claimed", claimed_at: now, claimed_by_device: device.id, updated_at: now })
        .eq("id", d.runFileId)
        .eq("step", "pending")
        .select("id");
      if (error || ((data as unknown[] | null) ?? []).length === 0) {
        return { action: "wait", text: "Another check-in took this step; trying again shortly.", ...base, pollSeconds: 15 };
      }
      await noteDecision(admin, run, d.text);
      return { action: "upload", text: d.text, runId: run.id, env: run.env, runFileId: d.runFileId, fileName: d.fileName, uploadOrigin: CCRS_ORIGINS[run.env], pollSeconds: 30 };
    }
  }
}

/** One check-in from the browser. Never hands out more than one file. */
export async function deviceCheckIn(admin: Admin, device: UploaderDevice, rawTabs: unknown, version: string | null, nowMs: number = Date.now()): Promise<CheckInAnswer> {
  const { facts: tabs, stored } = tabsFromBody(rawTabs);
  await admin
    .from("ccrs_uploader_devices")
    .update({ last_seen_at: new Date(nowMs).toISOString(), last_tabs: stored, last_version: version ? version.slice(0, 40) : null })
    .eq("id", device.id);
  const run = await getActiveRun(admin);
  if (!run) return { action: "idle", text: "No run is going. Press Start in the CCRS hub.", runId: null, env: null, pollSeconds: 60 };
  if (run.state === "running") await autoApplyForRun(admin, run, nowMs);
  for (let guard = 0; guard < 10; guard += 1) {
    const fresh = await getActiveRun(admin);
    if (!fresh || fresh.id !== run.id) return { action: "idle", text: "The run ended.", runId: run.id, env: run.env, pollSeconds: 60 };
    const files = await runFiles(admin, fresh.id);
    const { facts, others } = await ledgerFacts(admin, fresh, files);
    const d = nextStep({
      run: { state: fresh.state, env: fresh.env, ccrsUsername: fresh.ccrs_username, gapMinutes: fresh.gap_minutes, acceptedFileIds: fresh.accepted_file_ids ?? [] },
      files: facts,
      others,
      tabs,
      enabled: autoUploadEnabled(process.env),
      nowMs,
    });
    const a = await actOn(admin, fresh, d, device, nowMs);
    if (a !== "again") return a;
  }
  return { action: "wait", text: "Many files were skipped at once; checking again.", runId: run.id, env: run.env, pollSeconds: 15 };
}

/* ------------------------------------------------------------------ *
 * The file and the report
 * ------------------------------------------------------------------ */

async function claimedBy(admin: Admin, device: UploaderDevice, runFileId: string): Promise<{ run: UploadRun; rf: UploadRunFile } | null> {
  const run = await getActiveRun(admin);
  if (!run || run.state !== "running") return null;
  const { data } = await admin.from("ccrs_upload_run_files").select(RF_COLS).eq("id", runFileId).eq("run_id", run.id).maybeSingle();
  const rf = data as UploadRunFile | null;
  if (!rf || rf.step !== "claimed" || rf.claimed_by_device !== device.id) return null;
  return { run, rf };
}

/** The stored bytes of the ONE file this device holds right now (sha256 re-checked). */
export async function deviceFile(admin: Admin, device: UploaderDevice, runFileId: string): Promise<{ fileName: string; csv: string } | null> {
  const held = await claimedBy(admin, device, runFileId);
  if (!held) return null;
  const f = await readStoredFile(admin, held.rf.file_id);
  if (f.fileName !== held.rf.file_name) throw new Error("stored file name changed since the run started");
  return f;
}

export type ReportAnswer = { ok: boolean; verdict: "received" | "refused" | "unknown" | "not-sent" | "not-held"; text: string };

function reportFromBody(raw: unknown): UploadReport {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    status: typeof o.status === "number" && Number.isFinite(o.status) ? o.status : -1,
    responseType: typeof o.responseType === "string" ? o.responseType.slice(0, 40) : "",
    text: typeof o.text === "string" ? o.text.slice(0, 20_000) : "",
    networkError: typeof o.networkError === "string" ? o.networkError.slice(0, 500) : null,
    notSent: o.notSent === true,
  };
}

/** What CCRS's page said after the browser posted the file. */
export async function deviceReport(admin: Admin, device: UploaderDevice, runFileId: string, rawReport: unknown, nowMs: number = Date.now()): Promise<ReportAnswer> {
  const held = await claimedBy(admin, device, runFileId);
  if (!held) return { ok: false, verdict: "not-held", text: "This browser does not hold that file (the run may have stopped)." };
  const { run, rf } = held;
  const report = reportFromBody(rawReport);
  const v = classifyUpload(report);
  const now = new Date(nowMs).toISOString();
  const stored = { status: report.status, responseType: report.responseType, text: report.text.slice(0, 4000), networkError: report.networkError ?? null, notSent: report.notSent === true, device: device.id };
  const audit = (action: string, after: Record<string, unknown>) =>
    recordAudit({ actorId: run.started_by, actorEmail: `${run.started_by_email ?? "owner"} (auto-uploader)`, action, entityType: "ccrs_file", entityId: rf.file_id, after: { run: run.id, file: rf.file_name, device: device.label, ...after } });

  if (v.kind === "not-sent") {
    // Nothing reached CCRS: the file waits for its turn again (nextStep checks
    // the tab and the login before it is handed out once more).
    const text = `${rf.file_name} was not sent (${v.why}); it waits for its turn again.`;
    await admin.from("ccrs_upload_run_files").update({ step: "pending", claimed_at: null, claimed_by_device: null, report: stored, note: clip(text), updated_at: now }).eq("id", rf.id).eq("step", "claimed");
    await noteDecision(admin, run, text);
    return { ok: false, verdict: "not-sent", text };
  }
  if (v.kind !== "received") {
    const step = v.kind === "refused" ? "refused" : "unknown";
    const text = v.kind === "refused" ? `CCRS did not take ${rf.file_name}: ${v.reason}` : `Not known whether CCRS received ${rf.file_name}: ${v.why}`;
    await admin.from("ccrs_upload_run_files").update({ step, report: stored, note: clip(text), updated_at: now }).eq("id", rf.id).eq("step", "claimed");
    await audit(v.kind === "refused" ? "ccrs.file.auto_upload_refused" : "ccrs.file.auto_upload_unknown", { text });
    if (await endRun(admin, run.id, "stopped", text)) {
      await alertOwnerOnce(admin, `ccrs_auto_upload:${run.id}:stop`, "CCRS upload stopped: please look", text, hubUrl(run.env));
    }
    return { ok: false, verdict: v.kind, text };
  }

  const { data: moved } = await admin
    .from("ccrs_upload_run_files")
    .update({ step: "posted", posted_at: now, ccrs_received_at: v.receivedAtISO, receipt: clip(v.receipt), report: stored, updated_at: now })
    .eq("id", rf.id)
    .eq("step", "claimed")
    .select("id");
  if (((moved as unknown[] | null) ?? []).length === 0) return { ok: false, verdict: "not-held", text: "The file was already reported." };

  const at = uploadTimeISO(v.receivedAtISO, rf.claimed_at ?? now, nowMs);
  let override: string | null = null;
  try {
    await markUploaded(admin, rf.file_id, at, run.started_by, null);
  } catch (e) {
    const err = msg(e);
    const sameGroup = (await runFiles(admin, run.id)).filter((x) => x.grp === rf.grp && x.step === "posted" && x.id !== rf.id).map((x) => x.file_name);
    if (uploadOverride(err, sameGroup)) {
      override = SAME_GROUP_OVERRIDE;
      try {
        await markUploaded(admin, rf.file_id, at, run.started_by, override);
      } catch (e2) {
        return recordFailed(admin, run, rf, msg(e2), audit);
      }
    } else {
      return recordFailed(admin, run, rf, err, audit);
    }
  }
  await audit("ccrs.file.uploaded_by_auto_uploader", { uploadedAt: at, ccrsReceivedAt: v.receivedAtISO, override, receipt: v.receipt.slice(0, 300) });
  return { ok: true, verdict: "received", text: `CCRS received ${rf.file_name}.` };
}

async function recordFailed(admin: Admin, run: UploadRun, rf: UploadRunFile, err: string, audit: (a: string, x: Record<string, unknown>) => Promise<void>): Promise<ReportAnswer> {
  const text = `CCRS received ${rf.file_name}, but the hub could not record the upload (${clip(err, 300)}). The run stopped; the CCRS email will settle it, or record the upload by hand.`;
  await audit("ccrs.file.auto_upload_unrecorded", { error: clip(err, 600) });
  if (await endRun(admin, run.id, "stopped", text)) {
    await alertOwnerOnce(admin, `ccrs_auto_upload:${run.id}:stop`, "CCRS upload stopped: please look", text, hubUrl(run.env));
  }
  return { ok: true, verdict: "received", text };
}

/* ------------------------------------------------------------------ *
 * The cron's part (after the mail tick)
 * ------------------------------------------------------------------ */

/**
 * Called by /api/cron/ccrs-mail after its tick: applies the running run's
 * email even while the browser only waits, and tells the owner once when the
 * browser stopped checking in. Never throws.
 */
export async function autoUploadCronStep(nowMs: number = Date.now()): Promise<{ ran: boolean; notes: string[] }> {
  const notes: string[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const run = await getActiveRun(admin);
    if (!run || run.state !== "running") return { ran: false, notes };
    const r = await autoApplyForRun(admin, run, nowMs);
    notes.push(...r.notes);
    const devices = (await listDevices(admin)).filter((d) => !d.revoked_at);
    const seen = Math.max(0, ...devices.map((d) => (d.last_seen_at ? Date.parse(d.last_seen_at) : 0)));
    const since = Math.max(seen, Date.parse(run.started_at));
    if (nowMs - since > DEVICE_SILENT_MS) {
      await alertOwnerOnce(
        admin,
        `ccrs_auto_upload:${run.id}:silent:${new Date(since).toISOString().slice(0, 16)}`,
        "CCRS upload waiting: Chrome is not checking in",
        "The CCRS run is going, but the Chrome with the Greenway uploader has not checked in for 15 minutes. Open Chrome (and the CCRS page) on that computer, or stop the run in the hub.",
        hubUrl(run.env),
      );
      notes.push("browser silent");
    }
    return { ran: true, notes };
  } catch (e) {
    notes.push(`auto-upload step failed: ${msg(e)}`);
    return { ran: false, notes };
  }
}

/* ------------------------------------------------------------------ *
 * The hub's view
 * ------------------------------------------------------------------ */

export type AutoUploadView = {
  available: boolean;
  error: string | null;
  enabled: boolean;
  /** D254: CCRS_KEEPALIVE=on (the browser re-reads the CCRS page while a run waits) */
  keepAlive: boolean;
  devices: UploaderDevice[];
  active: (UploadRun & { files: UploadRunFile[] }) | null;
  recent: UploadRun[];
  unsure: UploadRunFile[];
  /** files of the active run CCRS refused rows of (the "Continue anyway" choices) */
  refusedFileIds: string[];
  /** when this view was read (the panel's "recently" is measured from it) */
  readAtMs: number;
};

export async function getAutoUploadView(admin: Admin): Promise<AutoUploadView> {
  const out: AutoUploadView = { available: true, error: null, enabled: autoUploadEnabled(process.env), keepAlive: keepAliveEnabled(process.env), devices: [], active: null, recent: [], unsure: [], refusedFileIds: [], readAtMs: Date.now() };
  try {
    out.devices = await listDevices(admin);
    const run = await getActiveRun(admin);
    if (run) {
      const files = await runFiles(admin, run.id);
      out.active = { ...run, files };
      const { facts } = await ledgerFacts(admin, run, files);
      out.refusedFileIds = facts.filter((f) => hasRefusals({ state: f.ledgerState, errorMessages: f.errorMessages })).map((f) => f.fileId);
    }
    const { data, error } = await admin.from("ccrs_upload_runs").select(RUN_COLS).not("state", "in", "(running,paused)").order("started_at", { ascending: false }).limit(5);
    if (error) throw new Error(`ccrs_upload_runs: ${error.message}`);
    out.recent = (data as UploadRun[] | null) ?? [];
    out.unsure = await unsureHandOuts(admin, run?.id ?? null);
  } catch (e) {
    const m = msg(e);
    if (/ccrs_upload|ccrs_uploader/.test(m) && /does not exist|schema cache/.test(m)) {
      out.available = false;
      out.error = "Migration 0369 has not been run yet (docs/MIGRATIONS_TO_RUN.md).";
    } else {
      out.error = m;
    }
  }
  return out;
}
