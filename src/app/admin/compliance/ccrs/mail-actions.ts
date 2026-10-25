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
import { ccrsFilesByName, fileRowsForEcho, listCcrsFiles, proveAfterOutcome, recordOutcome } from "@/lib/compliance/ccrs-ledger-store";
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
import { getCcrsMail, markCcrsMailHandled, runCcrsMailTick, type StoredCcrsMail } from "@/lib/compliance/ccrs-mail-store";
import { isAnsweredState, planReuploadSetAside, type AnsweredFile } from "@/lib/compliance/ccrs-reupload-core";

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

/** Apply a stored CCRS confirmation: same matching and time rule as the success paste box. */
export async function applyCcrsSuccessMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  const analysis = mail.analysis as unknown as MailAnalysis;
  const plan = planSuccessEnv(
    { kind: mail.kind, env: mail.env, envVerified: mail.env_verified },
    String(formData.get("env") ?? "") || null,
    formData.get("confirm_checked") === "on",
  );
  if (!plan.ok) backMail(weekKey, errQ(plan.error));
  const env: LedgerEnv = plan.env;
  // Re-read the names from the stored body, never from the form or the stored analysis.
  const notices = parseSuccessEmails(mail.body_text);
  if (notices.length === 0) backMail(weekKey, errQ("No CCRS file name in this email. Open it in Gmail and record it with the paste box."));
  let named: Awaited<ReturnType<typeof ccrsFilesByName>>;
  try {
    named = await ccrsFilesByName(admin, env, notices.map((n) => n.fileName));
  } catch (e) {
    backMail(weekKey, errQ(asText(e)));
  }
  const match = matchSuccessNames(
    notices,
    named.map((f) => ({ id: f.id, fileName: f.fileName, state: f.state, uploadedAt: f.uploadedAt, stampAt: f.stampAt })),
  );
  if (match.record.length === 0) {
    const why = [
      match.unknown.length ? `not a ${env} outbox file: ${match.unknown.join(", ")}` : "",
      match.notWaiting.length ? `not waiting for an answer: ${match.notWaiting.map((n) => `${n.fileName} (${n.state})`).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    backMail(weekKey, errQ(`Nothing recorded: ${why}. Mark the file uploaded first, or Dismiss this email if it is about a file this system did not make.`));
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
  revalidatePath(BASE);
  if (failed.length) backMail(weekKey, errQ(`Recorded ${done.length}; FAILED ${failed.length}: ${failed.join(" | ")} ${proof?.text ?? ""}`.trim()));
  backMail(weekKey, okQ(`From the CCRS email: ${done.join("; ")}. ${proof?.text ?? ""}`.trim()));
}

/** Every uploaded (waiting) file of these types in both envs, with its rows; plus each file's upload time. */
async function candidatesFor(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  types: readonly string[],
): Promise<{ candidates: EchoCandidate[]; uploadedAt: Map<string, string | null> }> {
  const candidates: EchoCandidate[] = [];
  const uploadedAt = new Map<string, string | null>();
  for (const env of ["prod", "preprod"] as const) {
    const list = await listCcrsFiles(admin, env, 200);
    if (list.error) throw new Error(list.error);
    for (const f of list.files) {
      if (f.state !== "uploaded" || !types.includes(f.fileType)) continue;
      uploadedAt.set(f.id, f.uploadedAt);
      candidates.push({ fileId: f.id, fileName: f.fileName, env: f.env, fileType: f.fileType, state: f.state, rows: await fileRowsForEcho(admin, f.id, f.numberRecords) });
    }
  }
  return { candidates, uploadedAt };
}

/** R74 S46: files CCRS already answered (newest first, at most 25 per type), with their rows, for the re-upload check. */
async function answeredFor(admin: ReturnType<typeof createSupabaseAdminClient>, types: readonly string[]): Promise<AnsweredFile[]> {
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
 * row, to exactly one uploaded file (classifyEcho) or the owner's choice
 * among the files that fit; otherwise NOTHING is recorded.
 */
export async function applyCcrsErrorMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, admin, mail } = await loadMail(formData);
  if (mail.kind !== "error") backMail(weekKey, errQ("This email is not a CCRS error email."));
  const errors = errorsFromStored(mail.csvs ?? []);
  if (errors.length === 0) backMail(weekKey, errQ("No CCRS error file in this email."));
  let picks: { filename: string; pick: EchoPick }[];
  let uploadedAt: Map<string, string | null>;
  try {
    const found = await candidatesFor(admin, errors.map((e) => e.fileType).filter((t): t is NonNullable<typeof t> => !!t));
    uploadedAt = found.uploadedAt;
    picks = errors.map((e, i) => ({ filename: e.filename, pick: resolveEchoPick(e, found.candidates, String(formData.get(`file_${i}`) ?? "") || null) }));
  } catch (e) {
    backMail(weekKey, errQ(e instanceof CcrsEchoError ? e.message : asText(e)));
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
      revalidatePath(BASE);
      backMail(weekKey, changed ? okQ(`Set aside, nothing to fix. ${reupload.note}`) : errQ("This email was already handled."));
    }
    const why = bad
      .map((b) =>
        b.pick.kind === "ambiguous"
          ? `${b.filename} fits more than one uploaded file (${b.pick.files.map((f) => f.fileName).join(", ")}); choose one`
          : `${b.filename}: ${b.pick.kind === "none" ? b.pick.reasons.join("; ") : ""}`,
      )
      .join(" | ");
    backMail(weekKey, errQ(`Nothing recorded. ${why}`));
  }
  const now = Date.now();
  const done: string[] = [];
  const failed: string[] = [];
  for (const { pick } of picks) {
    if (pick.kind !== "unique") continue;
    const at = applyTimeISO(uploadedAt.get(pick.fileId) ?? null, mail.received_at, now);
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
  revalidatePath(BASE);
  if (failed.length) backMail(weekKey, errQ(`Recorded ${done.length}; FAILED ${failed.length}: ${failed.join(" | ")} ${proofTexts.join(" ")}`.trim()));
  backMail(weekKey, okQ(`${done.join(" | ")} ${proofTexts.join(" ")}`.trim()));
}

/** Audit row for an automatic proof-by-reference after an email answer (R6-1, 0284). */
async function auditMailProof(
  session: Awaited<ReturnType<typeof requirePermission>>,
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
