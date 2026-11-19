/**
 * src/lib/compliance/ccrs-mail-apply.ts  (moved out of mail-actions.ts in D253)
 *
 * The Apply of one stored CCRS email: confirmation (success), error file, and
 * "has not been processed". Every decision is re-made HERE from the stored
 * email and the stored outbox file; nothing a form says about rows, outcomes
 * or envs is trusted beyond the caller's explicit choice. Writes go through
 * the same 0249 path as the paste boxes (recordOutcome) and are audited.
 *
 * WHY IT MOVED (D253). The code is byte-for-byte what the hub's Apply buttons
 * ran in mail-actions.ts. It now lives in a plain server module so the
 * assisted uploader (ccrs-auto-upload-store) runs the SAME Apply between
 * groups, and so it is not reachable as a server action: a "use server" file
 * makes every exported async function a public POST endpoint, and these take
 * no session of their own. Callers check the permission first:
 *   - mail-actions.ts: requirePermission("settings.manage") on every action;
 *   - ccrs-auto-upload-store.ts: the run's owner, re-read, active, with
 *     settings.manage, and only while his run is running.
 */
import "server-only";

import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ccrsFilesByName, fileRowsForEcho, listCcrsFilesLite, markUploaded, proveAfterOutcome, recordOutcome, type CcrsFileRecord } from "@/lib/compliance/ccrs-ledger-store";
import { lifecycleErrorText, matchSuccessNames, parseSuccessEmails } from "@/lib/compliance/ccrs-lifecycle-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { CcrsEchoError } from "@/lib/compliance/ccrs-outcome-core";
import {
  applyTimeISO,
  errorsFromStored,
  planSuccessEnv,
  resolveEchoPick,
  type EchoCandidate,
  type EchoPick,
  type MailAnalysis,
} from "@/lib/compliance/ccrs-mail-core";
import { markCcrsMailHandled, type StoredCcrsMail } from "@/lib/compliance/ccrs-mail-store";
import { AUTO_UPLOAD_REASON, UNANSWERED_STATES, autoUploadTimeISO, couldAnswer, isUnansweredState } from "@/lib/compliance/ccrs-answer-core";
import { ANSWERED_STATES, isAnsweredState, planReuploadSetAside, type AnsweredFile } from "@/lib/compliance/ccrs-reupload-core";
import { NOT_PROCESSED_MESSAGE, parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";
import { echoEnvScope, mapLimit, scopeEchoPool } from "@/lib/compliance/ccrs-hub-flow-core";

const asText = (e: unknown) => lifecycleErrorText(e instanceof Error ? e.message : String(e));

type Admin = ReturnType<typeof createSupabaseAdminClient>;
/**
 * Who pressed Apply. The hub passes the owner's staff session (requirePermission
 * already ran); the D253 uploader passes the profile of the owner who started
 * the run, re-read and checked active + settings.manage before every apply.
 */
export type ApplyActor = { profile: { id: string }; email: string };
type Session = ApplyActor;
/** What one email's Apply did; the buttons turn it into the page message. */
export type ApplyOutcome = { ok: boolean; text: string };

/**
 * R74 S48 (Round 28): a CCRS email about a file the hub still shows as
 * "emitted" proves the file was uploaded. Mark it uploaded (CCRS's time when
 * it gave one, else the email's), with a logged reason, before the answer is
 * recorded. Returns the upload time the answer is checked against.
 */
async function ensureUploaded(
  admin: Admin,
  session: Session,
  f: { id: string; fileName: string; state: string; emittedAt: string | null; uploadedAt: string | null; env: LedgerEnv },
  evidenceAt: string | null,
  gmailId: string,
): Promise<string> {
  if (f.state === "uploaded" && f.uploadedAt) return f.uploadedAt;
  if (f.state !== "emitted") throw new Error(`${f.fileName} is ${f.state}; it is not waiting for an answer`);
  const at = autoUploadTimeISO(f.emittedAt, evidenceAt, Date.now());
  if (!at) throw new Error(`${f.fileName} has no emission time`);
  const res = await markUploaded(admin, f.id, at, session.profile.id, AUTO_UPLOAD_REASON);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.file.uploaded_from_email",
    entityType: "ccrs_files",
    entityId: f.id,
    after: { env: f.env, fileName: res.fileName, uploadedAt: at, overridden: res.overridden, waitingOn: res.waitingOn, fromEmail: gmailId },
  });
  return at;
}


export async function applySuccessMail(admin: Admin, session: Session, mail: StoredCcrsMail, chosenEnv: string | null, confirmed: boolean): Promise<ApplyOutcome> {
  const analysis = mail.analysis as unknown as MailAnalysis;
  const plan = planSuccessEnv({ kind: mail.kind, env: mail.env, envVerified: mail.env_verified }, chosenEnv, confirmed);
  if (!plan.ok) return { ok: false, text: plan.error };
  const env: LedgerEnv = plan.env;
  // Re-read the names from the stored body, never from the form or the stored analysis.
  const notices = parseSuccessEmails(mail.body_text);
  if (notices.length === 0) return { ok: false, text: "No CCRS file name in this email. Open it in Gmail and record it with the paste box." };
  let named: Awaited<ReturnType<typeof ccrsFilesByName>>;
  try {
    named = await ccrsFilesByName(admin, env, notices.map((n) => n.fileName));
    // R74 S48: a named file still "emitted" was uploaded (CCRS processed it): mark it first.
    for (const f of named) {
      if (f.state !== "emitted" || !couldAnswer(f.emittedAt, mail.received_at)) continue;
      const n = notices.find((x) => x.fileName === f.fileName);
      f.uploadedAt = await ensureUploaded(admin, session, f, n?.submittedAt ?? mail.received_at, mail.gmail_id);
      f.state = "uploaded";
    }
  } catch (e) {
    return { ok: false, text: asText(e) };
  }
  const match = matchSuccessNames(
    notices,
    named.map((f) => ({ id: f.id, fileName: f.fileName, state: f.state, uploadedAt: f.uploadedAt, stampAt: f.stampAt })),
  );
  if (match.record.length === 0) {
    const why = [
      match.unknown.length ? `not a ${env} outbox file: ${match.unknown.join(", ")}` : "",
      match.notWaiting.length ? `already answered: ${match.notWaiting.map((n) => `${n.fileName} (${n.state})`).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    return { ok: false, text: `Nothing recorded: ${why}. Set this email aside if it is about a file this system did not make or one already recorded.` };
  }
  const now = Date.now();
  const done: string[] = [];
  const failed: string[] = [];
  for (const r of match.record) {
    const at = applyTimeISO(r.uploadedAt, r.submittedAt, now) ?? new Date(now).toISOString();
    try {
      const out = await recordOutcome(admin, r.id, "success", at, [], null);
      done.push(`${out.fileName} \u2192 ${out.state}`);
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "ccrs.file.success",
        entityType: "ccrs_files",
        entityId: r.id,
        after: { env, fileName: out.fileName, state: out.state, rows: out.rows, earlierFilesClosed: out.earlierFilesClosed, ccrsDateSubmitted: r.submittedAt, fromEmail: mail.gmail_id, auth: analysis.auth },
      });
    } catch (e) {
      failed.push(`${r.fileName}: ${asText(e)}`);
    }
  }
  if (done.length > 0) await markCcrsMailHandled(admin, mail.id, "applied", session.profile.id, `success ${env}: ${done.join("; ")}`);
  // R6-1 (0284): an accepted Sale/Adjustment may prove an uncertain lot.
  const proof = done.length > 0 ? await proveAfterOutcome(admin, env) : null;
  if (proof && proof.proved.length > 0) await auditMailProof(session, env, proof.proved, proof.filesClosed);
  if (failed.length) return { ok: false, text: `Recorded ${done.length}; FAILED ${failed.length}: ${failed.join(" | ")} ${proof?.text ?? ""}`.trim() };
  return { ok: true, text: `From the CCRS email: ${done.join("; ")}. ${proof?.text ?? ""}`.trim() };
}


/**
 * Every file of these types still waiting for an answer (uploaded, or emitted
 * and never marked), with its rows. W-1: scoped to the email's own env when
 * its subject names one and that env has a waiting file of the type (a PRE
 * email is no longer "ambiguous" because a production file looks alike); one
 * query for both envs instead of two full listings with their issues; rows
 * read four files at a time instead of one after another.
 */
async function candidatesFor(
  admin: Admin,
  types: readonly string[],
  emailAt: string | null,
  scope: LedgerEnv | null,
): Promise<{ candidates: EchoCandidate[]; byId: Map<string, CcrsFileRecord> }> {
  const waiting = (await listCcrsFilesLite(admin, ["prod", "preprod"], UNANSWERED_STATES, types))
    .filter((f) => isUnansweredState(f.state) && couldAnswer(f.emittedAt, emailAt)); // R74 S48: a file made after the email arrived cannot be what it answers.
  const pool = [...new Set(types)].flatMap((t) => scopeEchoPool(waiting, t, scope));
  const byId = new Map<string, CcrsFileRecord>(pool.map((f) => [f.id, f]));
  const candidates = await mapLimit(pool, 4, async (f): Promise<EchoCandidate> => ({
    fileId: f.id, fileName: f.fileName, env: f.env, fileType: f.fileType, state: f.state, rows: await fileRowsForEcho(admin, f.id, f.numberRecords),
  }));
  return { candidates, byId };
}

/** R74 S46: files CCRS already answered (newest first, at most 25 per type and env), with their rows, for the re-upload check. */
async function answeredFor(admin: Admin, types: readonly string[]): Promise<AnsweredFile[]> {
  const answered = await listCcrsFilesLite(admin, ["prod", "preprod"], ANSWERED_STATES, types, 1000);
  const perKey = new Map<string, number>();
  const keep = answered.filter((f) => {
    if (!isAnsweredState(f.state)) return false;
    const k = `${f.env}\u0000${f.fileType}`;
    const n = perKey.get(k) ?? 0;
    if (n >= 25) return false;
    perKey.set(k, n + 1);
    return true;
  });
  return mapLimit(keep, 4, async (f): Promise<AnsweredFile> => ({
    fileId: f.id, fileName: f.fileName, env: f.env, fileType: f.fileType, state: f.state, answeredAt: f.successEmailAt ?? f.errorEmailAt, rows: await fileRowsForEcho(admin, f.id, f.numberRecords),
  }));
}


export async function applyErrorMail(admin: Admin, session: Session, mail: StoredCcrsMail, chosen: (i: number) => string | null): Promise<ApplyOutcome> {
  if (mail.kind !== "error") return { ok: false, text: "This email is not a CCRS error email." };
  const errors = errorsFromStored(mail.csvs ?? []);
  if (errors.length === 0) return { ok: false, text: "No CCRS error file in this email." };
  let picks: { filename: string; pick: EchoPick }[];
  let byId: Map<string, CcrsFileRecord>;
  try {
    // W-1: the email's own env (subject) narrows the pool; the page the owner is on never does.
    const found = await candidatesFor(admin, errors.map((e) => e.fileType).filter((t): t is NonNullable<typeof t> => !!t), mail.received_at, echoEnvScope(mail.env));
    byId = found.byId;
    picks = errors.map((e, i) => ({ filename: e.filename, pick: resolveEchoPick(e, found.candidates, chosen(i)) }));
  } catch (e) {
    return { ok: false, text: e instanceof CcrsEchoError ? e.message : asText(e) };
  }
  const bad = picks.filter((p) => p.pick.kind !== "unique");
  if (bad.length) {
    // R74 S46 (Round 26): an email answering a RE-UPLOAD of files CCRS already
    // answered (every row "already held") has no waiting file to tie to. Set it
    // aside with the exact reason; nothing is written to the ledger.
    let reupload: ReturnType<typeof planReuploadSetAside> = null;
    try {
      reupload = planReuploadSetAside(errors, await answeredFor(admin, errors.map((e) => e.fileType).filter((t): t is NonNullable<typeof t> => !!t)));
    } catch {
      reupload = null;
    }
    if (reupload) {
      const changed = await markCcrsMailHandled(admin, mail.id, "dismissed", session.profile.id, reupload.note);
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "ccrs.mail.reupload_set_aside",
        entityType: "ccrs_mail_messages",
        entityId: mail.id,
        after: { gmailId: mail.gmail_id, subject: mail.subject, files: reupload.matches.map((m) => ({ id: m.fileId, name: m.fileName, env: m.env, state: m.state })) },
      });
      return changed ? { ok: true, text: `Set aside, nothing to fix. ${reupload.note}` } : { ok: false, text: "This email was already handled." };
    }
    const why = bad
      .map((b) =>
        b.pick.kind === "ambiguous"
          ? `${b.filename} fits more than one waiting file (${b.pick.files.map((f) => f.fileName).join(", ")}); choose one`
          : `${b.filename}: ${b.pick.kind === "none" ? b.pick.reasons.join("; ") : ""}`,
      )
      .join(" | ");
    return { ok: false, text: `Nothing recorded. ${why}` };
  }
  const now = Date.now();
  const done: string[] = [];
  const failed: string[] = [];
  for (const { pick } of picks) {
    if (pick.kind !== "unique") continue;
    const f = byId.get(pick.fileId);
    let up: string | null = f?.uploadedAt ?? null;
    try {
      if (f) up = await ensureUploaded(admin, session, f, mail.received_at, mail.gmail_id);
    } catch (e) {
      failed.push(`${pick.fileName}: ${asText(e)}`);
      continue;
    }
    const at = applyTimeISO(up, mail.received_at, now);
    if (!at) {
      failed.push(`${pick.fileName}: no upload time recorded`);
      continue;
    }
    try {
      const out = await recordOutcome(admin, pick.fileId, pick.verdict.outcome, at, pick.verdict.rejected, pick.verdict.messages);
      done.push(`${out.fileName}: ${pick.verdict.why} Now ${out.state}`);
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: `ccrs.file.${pick.verdict.outcome}`,
        entityType: "ccrs_files",
        entityId: pick.fileId,
        after: { env: pick.env, fileName: out.fileName, state: out.state, rows: out.rows, messages: pick.verdict.messages, rejectedRows: pick.verdict.rejected.map((r) => r.row_no), why: pick.verdict.why, fromEmail: mail.gmail_id, auth: mail.auth },
      });
    } catch (e) {
      failed.push(`${pick.fileName}: ${asText(e)}`);
    }
  }
  if (done.length > 0) await markCcrsMailHandled(admin, mail.id, "applied", session.profile.id, done.join(" | "));
  // R6-1 (0284): run the proof for every env an answer was recorded in.
  const proofTexts: string[] = [];
  for (const env of [...new Set(picks.flatMap((x) => (x.pick.kind === "unique" ? [x.pick.env] : [])))]) {
    if (done.length === 0) break;
    const proof = await proveAfterOutcome(admin, env);
    if (proof.proved.length > 0) await auditMailProof(session, env, proof.proved, proof.filesClosed);
    if (proof.text) proofTexts.push(proof.text);
  }
  if (failed.length) return { ok: false, text: `Recorded ${done.length}; FAILED ${failed.length}: ${failed.join(" | ")} ${proofTexts.join(" ")}`.trim() };
  return { ok: true, text: `${done.join(" | ")} ${proofTexts.join(" ")}`.trim() };
}


export async function applyNotProcessedMail(admin: Admin, session: Session, mail: StoredCcrsMail): Promise<ApplyOutcome> {
  const names = parseNotProcessed(mail.body_text ?? "");
  if (names.length === 0) return { ok: false, text: "This email does not say a file was not processed." };
  const now = Date.now();
  const done: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    let hits: Awaited<ReturnType<typeof ccrsFilesByName>> = [];
    try {
      for (const env of ["preprod", "prod"] as const) hits.push(...(await ccrsFilesByName(admin, env, [name])));
    } catch (e) {
      failed.push(`${name}: ${asText(e)}`);
      continue;
    }
    hits = hits.filter((f) => isUnansweredState(f.state));
    if (hits.length !== 1) {
      failed.push(`${name}: ${hits.length === 0 ? "no file waiting for an answer has this name (already answered or abandoned)" : "the name is waiting in both PREprod and production; record it by hand"}`);
      continue;
    }
    const f = hits[0];
    let up: string;
    try {
      up = await ensureUploaded(admin, session, f, mail.received_at, mail.gmail_id);
    } catch (e) {
      failed.push(`${name}: ${asText(e)}`);
      continue;
    }
    const at = applyTimeISO(up, mail.received_at, now);
    if (!at) {
      failed.push(`${name}: no upload time recorded`);
      continue;
    }
    try {
      const out = await recordOutcome(admin, f.id, "error-fatal", at, [], [NOT_PROCESSED_MESSAGE]);
      done.push(`${out.fileName}: refused whole by CCRS. Now ${out.state}; its rows go again in the next export`);
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "ccrs.file.error-fatal",
        entityType: "ccrs_files",
        entityId: f.id,
        after: { env: f.env, fileName: out.fileName, state: out.state, rows: out.rows, messages: [NOT_PROCESSED_MESSAGE], fromEmail: mail.gmail_id, auth: mail.auth },
      });
    } catch (e) {
      failed.push(`${name}: ${asText(e)}`);
    }
  }
  if (done.length > 0) await markCcrsMailHandled(admin, mail.id, "applied", session.profile.id, done.join(" | "));
  if (failed.length) return { ok: false, text: `Recorded ${done.length}; NOT recorded ${failed.length}: ${failed.join(" | ")}` };
  return { ok: true, text: done.join(" | ") };
}


/** Audit row for an automatic proof-by-reference after an email answer (R6-1, 0284). */
async function auditMailProof(
  session: Session,
  env: LedgerEnv,
  proved: string[],
  filesClosed: number,
): Promise<void> {
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.ledger.proved_by_reference",
    entityType: "ccrs_filed_entities",
    entityId: null,
    after: { env, proved, filesClosed, rule: "[G L1302-L1304] an accepted Sale/Adjustment row proves its lot is held" },
  });
}

/**
 * The Apply the "Answer every waiting CCRS email" button runs for ONE email
 * (R74 S48): success, error file or "not processed"; anything else waits for
 * the owner. Never throws.
 */
export async function applyOneStoredMail(admin: Admin, session: Session, mail: StoredCcrsMail): Promise<ApplyOutcome> {
  try {
    if (mail.kind === "success") return await applySuccessMail(admin, session, mail, null, false);
    if (mail.kind === "error") return await applyErrorMail(admin, session, mail, () => null);
    if (parseNotProcessed(mail.body_text ?? "").length > 0) return await applyNotProcessedMail(admin, session, mail);
    return { ok: false, text: "needs reading (not a confirmation, error file or \"not processed\" notice)" };
  } catch (e) {
    return { ok: false, text: asText(e) };
  }
}
