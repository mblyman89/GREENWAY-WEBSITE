"use server";

/**
 * Server actions for the hub's "CCRS email" panel (CCRS Bible v2 S-18a).
 *
 * The cron only STORES what CCRS sent. These actions are the owner pressing
 * a button, and every decision is re-made HERE from the stored email and the
 * stored outbox file; nothing the form says about rows, outcomes or envs is
 * trusted beyond the owner's explicit choice. They write the ledger through
 * the same 0249 path as the paste boxes (recordOutcome), are permission-gated
 * (settings.manage) and audited. Kept apart from actions.ts so the S-12c
 * paste actions (pinned by tests/compliance/s12c-*) stay byte-identical.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { weekFromKey } from "@/lib/compliance/ccrs-week-core";
import { ccrsFilesByName, fileRowsForEcho, listCcrsFiles, markUploaded, proveAfterOutcome, recordOutcome, type CcrsFileRecord } from "@/lib/compliance/ccrs-ledger-store";
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
import { getCcrsMail, listOpenCcrsMail, markCcrsMailHandled, runCcrsMailTick, type StoredCcrsMail } from "@/lib/compliance/ccrs-mail-store";
import { AUTO_UPLOAD_REASON, autoUploadTimeISO, couldAnswer, isUnansweredState } from "@/lib/compliance/ccrs-answer-core";
import { isAnsweredState, planReuploadSetAside, type AnsweredFile } from "@/lib/compliance/ccrs-reupload-core";
import { NOT_PROCESSED_MESSAGE, parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";

const BASE = "/admin/compliance/ccrs";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backMail(weekKey: string, extra: string): never {
  const w = weekFromKey(weekKey) ? `week=${encodeURIComponent(weekKey)}&` : "";
  redirect(`${BASE}?${w}${extra}#ccrs-mail`);
}
const errQ = (msg: string) => `error=${encodeURIComponent(msg)}`;
const okQ = (msg: string) => `saved=1&note=${encodeURIComponent(msg)}`;
const asText = (e: unknown) => lifecycleErrorText(e instanceof Error ? e.message : String(e));

async function loadMail(formData: FormData) {
  const weekKey = String(formData.get("week_key") ?? "");
  const mailId = String(formData.get("mail_id") ?? "");
  if (!ID_RE.test(mailId)) backMail(weekKey, errQ("Invalid email."));
  const admin = createSupabaseAdminClient();
  let mail: StoredCcrsMail;
  try {
    mail = await getCcrsMail(admin, mailId);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)));
  }
  if (mail.state !== "new") backMail(weekKey, errQ(`This email was already ${mail.state}.`));
  return { weekKey, admin, mail };
}

/** "Check the mailbox now" (the same tick the cron runs). */
export async function pollCcrsMailNowAction(formData: FormData): Promise<void> {
  await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const r = await runCcrsMailTick();
  revalidatePath(BASE);
  if (!r.ok) backMail(weekKey, errQ(`Mailbox check: ${r.error ?? "failed"}`));
  backMail(weekKey, okQ(`Mailbox checked: ${r.listed} CCRS email(s) in the window, ${r.stored} new.${r.deferred ? ` ${r.deferred} more next check.` : ""}`));
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Session = Awaited<ReturnType<typeof requirePermission>>;
/** What one email's Apply did; the buttons turn it into the page message. */
type ApplyOutcome = { ok: boolean; text: string };

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

/** Apply a stored CCRS confirmation: same matching and time rule as the success paste box. */
export async function applyCcrsSuccessMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  const r = await applySuccessMail(admin, session, mail, String(formData.get("env") ?? "") || null, formData.get("confirm_checked") === "on");
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text));
}

async function applySuccessMail(admin: Admin, session: Session, mail: StoredCcrsMail, chosenEnv: string | null, confirmed: boolean): Promise<ApplyOutcome> {
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

/** Every file of these types still waiting for an answer (uploaded, or emitted and never marked), both envs, with its rows. */
async function candidatesFor(
  admin: Admin,
  types: readonly string[],
  emailAt: string | null,
): Promise<{ candidates: EchoCandidate[]; byId: Map<string, CcrsFileRecord> }> {
  const candidates: EchoCandidate[] = [];
  const byId = new Map<string, CcrsFileRecord>();
  for (const env of ["prod", "preprod"] as const) {
    const list = await listCcrsFiles(admin, env, 200);
    if (list.error) throw new Error(list.error);
    for (const f of list.files) {
      if (!isUnansweredState(f.state) || !types.includes(f.fileType)) continue;
      // R74 S48: a file made after the email arrived cannot be what it answers.
      if (!couldAnswer(f.emittedAt, emailAt)) continue;
      byId.set(f.id, f);
      candidates.push({ fileId: f.id, fileName: f.fileName, env: f.env, fileType: f.fileType, state: f.state, rows: await fileRowsForEcho(admin, f.id, f.numberRecords) });
    }
  }
  return { candidates, byId };
}

/** R74 S46: files CCRS already answered (newest first, at most 25 per type), with their rows, for the re-upload check. */
async function answeredFor(admin: Admin, types: readonly string[]): Promise<AnsweredFile[]> {
  const out: AnsweredFile[] = [];
  for (const env of ["prod", "preprod"] as const) {
    const list = await listCcrsFiles(admin, env, 200);
    if (list.error) throw new Error(list.error);
    const perType = new Map<string, number>();
    for (const f of list.files) {
      if (!isAnsweredState(f.state) || !types.includes(f.fileType)) continue;
      const n = perType.get(f.fileType) ?? 0;
      if (n >= 25) continue;
      perType.set(f.fileType, n + 1);
      out.push({ fileId: f.id, fileName: f.fileName, env: f.env, fileType: f.fileType, state: f.state, answeredAt: f.successEmailAt ?? f.errorEmailAt, rows: await fileRowsForEcho(admin, f.id, f.numberRecords) });
    }
  }
  return out;
}

/**
 * Apply a stored CCRS error email. Every error CSV in it must be tied, row by
 * row, to exactly one waiting file (classifyEcho) or the owner's choice
 * among the files that fit; otherwise NOTHING is recorded.
 */
export async function applyCcrsErrorMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  const r = await applyErrorMail(admin, session, mail, (i) => String(formData.get(`file_${i}`) ?? "") || null);
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text));
}

async function applyErrorMail(admin: Admin, session: Session, mail: StoredCcrsMail, chosen: (i: number) => string | null): Promise<ApplyOutcome> {
  if (mail.kind !== "error") return { ok: false, text: "This email is not a CCRS error email." };
  const errors = errorsFromStored(mail.csvs ?? []);
  if (errors.length === 0) return { ok: false, text: "No CCRS error file in this email." };
  let picks: { filename: string; pick: EchoPick }[];
  let byId: Map<string, CcrsFileRecord>;
  try {
    const found = await candidatesFor(admin, errors.map((e) => e.fileType).filter((t): t is NonNullable<typeof t> => !!t), mail.received_at);
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

/**
 * R74 S47 (Round 27): a body-only "has not been processed" email. CCRS refused
 * the whole file and sent no error CSV. Each named file that is waiting is
 * recorded error-fatal: every row refused, nothing marked on file, so the
 * next export sends those rows again. Names are re-read from the stored body,
 * never from the form. R74 S48: a named file still "emitted" is marked
 * uploaded first (the email proves it was).
 */
export async function applyCcrsNotProcessedMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  const r = await applyNotProcessedMail(admin, session, mail);
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text));
}

async function applyNotProcessedMail(admin: Admin, session: Session, mail: StoredCcrsMail): Promise<ApplyOutcome> {
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

/**
 * R74 S48 (Round 28, item 5): "Answer every waiting CCRS email". Oldest email
 * first, each through the SAME Apply as its own button (same proofs, same
 * all-or-nothing rule per email). An email that needs the owner's choice
 * (env not known, an error file that fits two files, an unreadable email) is
 * left waiting with the reason; nothing is guessed.
 */
export async function applyAllCcrsMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const admin = createSupabaseAdminClient();
  let open: StoredCcrsMail[];
  try {
    open = await listOpenCcrsMail(admin);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)));
  }
  if (open.length === 0) backMail(weekKey, okQ("No CCRS email is waiting to be applied."));
  const done: string[] = [];
  const left: string[] = [];
  for (const mail of open) {
    const label = mail.subject || mail.gmail_id;
    let r: ApplyOutcome;
    try {
      if (mail.kind === "success") r = await applySuccessMail(admin, session, mail, null, false);
      else if (mail.kind === "error") r = await applyErrorMail(admin, session, mail, () => null);
      else if (parseNotProcessed(mail.body_text ?? "").length > 0) r = await applyNotProcessedMail(admin, session, mail);
      else r = { ok: false, text: "needs reading (not a confirmation, error file or \"not processed\" notice)" };
    } catch (e) {
      r = { ok: false, text: asText(e) };
    }
    (r.ok ? done : left).push(`${label}: ${r.text}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.mail.answer_all",
    entityType: "ccrs_mail_messages",
    entityId: null,
    after: { applied: done.length, leftWaiting: left.length, left },
  });
  revalidatePath(BASE);
  const text = `Answered ${done.length} of ${open.length} CCRS email(s).${left.length ? ` Still waiting (${left.length}), each needs your choice: ${left.join(" | ")}` : ""}${done.length ? ` Done: ${done.join(" | ")}` : ""}`;
  backMail(weekKey, left.length && !done.length ? errQ(text) : okQ(text));
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

/** Not about a file this system made (or already recorded by paste): set aside with a reason. */
export async function dismissCcrsMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) backMail(weekKey, errQ("Say in a few words why this email is set aside."));
  let changed = false;
  try {
    changed = await markCcrsMailHandled(admin, mail.id, "dismissed", session.profile.id, reason);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.mail.dismissed",
    entityType: "ccrs_mail_messages",
    entityId: mail.id,
    after: { gmailId: mail.gmail_id, subject: mail.subject, kind: mail.kind, reason },
  });
  revalidatePath(BASE);
  backMail(weekKey, changed ? okQ("Email set aside.") : errQ("This email was already handled."));
}
