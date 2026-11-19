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
 *
 * D253: the Apply bodies (success / error / not processed, ensureUploaded,
 * the proof audit) moved unchanged to src/lib/compliance/ccrs-mail-apply.ts,
 * a plain server module, so the assisted uploader runs the same Apply. They
 * are not server actions there (they take no session of their own); every
 * action below still checks settings.manage before calling them.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { weekFromKey } from "@/lib/compliance/ccrs-week-core";
import { adoptHandmadeFile, ccrsFilesByName } from "@/lib/compliance/ccrs-ledger-store";
import { lifecycleErrorText, parseSuccessEmails } from "@/lib/compliance/ccrs-lifecycle-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { planSuccessEnv } from "@/lib/compliance/ccrs-mail-core";
import { getCcrsMail, listOpenCcrsMail, markCcrsMailHandled, reopenCcrsMail, runCcrsMailTick, type StoredCcrsMail } from "@/lib/compliance/ccrs-mail-store";
import { applyErrorMail, applyNotProcessedMail, applySuccessMail, type ApplyOutcome } from "@/lib/compliance/ccrs-mail-apply";
import { ADOPT_REASON_MIN, adoptUploadTime, planAdoptFile } from "@/lib/compliance/ccrs-adopt-core";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import { parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";
import { hubEnv, hubHref } from "@/lib/compliance/ccrs-hub-flow-core";

const BASE = "/admin/compliance/ccrs";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W-1 (2026-10-30): back to the SAME env the button was pressed in (hidden
 * `env` input, read by every action through pageEnv), scrolled to the email
 * panel, where the result is now shown (CcrsMailPanel flash). Before W-1 the
 * env was dropped here and the page fell back to production after every press.
 */
function backMail(weekKey: string, extra: string, env: LedgerEnv): never {
  const w = weekFromKey(weekKey) ? weekKey : null;
  redirect(hubHref({ week: w, env, params: Object.fromEntries(new URLSearchParams(extra)), anchor: "ccrs-mail" }));
}
const pageEnv = (formData: FormData): LedgerEnv => hubEnv(String(formData.get("page_env") ?? formData.get("env") ?? ""));
const errQ = (msg: string) => `error=${encodeURIComponent(msg)}`;
const okQ = (msg: string) => `saved=1&note=${encodeURIComponent(msg)}`;
const asText = (e: unknown) => lifecycleErrorText(e instanceof Error ? e.message : String(e));

async function loadMail(formData: FormData) {
  const weekKey = String(formData.get("week_key") ?? "");
  const env = pageEnv(formData);
  const mailId = String(formData.get("mail_id") ?? "");
  if (!ID_RE.test(mailId)) backMail(weekKey, errQ("Invalid email."), env);
  const admin = createSupabaseAdminClient();
  let mail: StoredCcrsMail;
  try {
    mail = await getCcrsMail(admin, mailId);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), env);
  }
  if (mail.state !== "new") backMail(weekKey, errQ(`This email was already ${mail.state}.`), env);
  return { weekKey, env, admin, mail };
}

/** "Check the mailbox now" (the same tick the cron runs). */
export async function pollCcrsMailNowAction(formData: FormData): Promise<void> {
  await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const env = pageEnv(formData);
  const r = await runCcrsMailTick();
  revalidatePath(BASE);
  if (!r.ok) backMail(weekKey, errQ(`Mailbox check: ${r.error ?? "failed"}`), env);
  backMail(weekKey, okQ(`Mailbox checked: ${r.listed} CCRS email(s) in the window, ${r.stored} new.${r.deferred ? ` ${r.deferred} more next check.` : ""}`), env);
}


/** Apply a stored CCRS confirmation: same matching and time rule as the success paste box. */
export async function applyCcrsSuccessMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env: page, admin, mail } = await loadMail(formData);
  const r = await applySuccessMail(admin, session, mail, String(formData.get("env") ?? "") || null, formData.get("confirm_checked") === "on");
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text), page);
}

/**
 * Apply a stored CCRS error email. Every error CSV in it must be tied, row by
 * row, to exactly one waiting file (classifyEcho) or the owner's choice
 * among the files that fit; otherwise NOTHING is recorded.
 */
export async function applyCcrsErrorMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env: page, admin, mail } = await loadMail(formData);
  const r = await applyErrorMail(admin, session, mail, (i) => String(formData.get(`file_${i}`) ?? "") || null);
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text), page);
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
  const { weekKey, env: page, admin, mail } = await loadMail(formData);
  const r = await applyNotProcessedMail(admin, session, mail);
  revalidatePath(BASE);
  backMail(weekKey, r.ok ? okQ(r.text) : errQ(r.text), page);
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
  const page = pageEnv(formData);
  const admin = createSupabaseAdminClient();
  let open: StoredCcrsMail[];
  try {
    open = await listOpenCcrsMail(admin);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
  }
  if (open.length === 0) backMail(weekKey, okQ("No CCRS email is waiting to be applied."), page);
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
  backMail(weekKey, left.length && !done.length ? errQ(text) : okQ(text), page);
}

/** Not about a file this system made (or already recorded by paste): set aside with a reason. */
export async function dismissCcrsMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env: page, admin, mail } = await loadMail(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) backMail(weekKey, errQ("Say in a few words why this email is set aside."), page);
  let changed = false;
  try {
    changed = await markCcrsMailHandled(admin, mail.id, "dismissed", session.profile.id, reason);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
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
  backMail(weekKey, changed ? okQ("Email set aside.") : errQ("This email was already handled."), page);
}

/**
 * D228 (0357): put a SET-ASIDE email back in the waiting list, with a reason.
 * The earlier set-aside note is kept (reopen_note, append only). An applied
 * email can never be reopened: its answer is already in the ledger.
 */
export async function reopenCcrsMailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const page = pageEnv(formData);
  const mailId = String(formData.get("mail_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ID_RE.test(mailId)) backMail(weekKey, errQ("Invalid email."), page);
  if (reason.length < ADOPT_REASON_MIN) backMail(weekKey, errQ(`Say why this email is reopened (${ADOPT_REASON_MIN} or more characters).`), page);
  const admin = createSupabaseAdminClient();
  let mail: StoredCcrsMail;
  try {
    mail = await getCcrsMail(admin, mailId);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
  }
  if (mail.state !== "dismissed") backMail(weekKey, errQ(mail.state === "applied" ? "This email was applied. Its answer is in the ledger and it stays final." : "This email is already waiting."), page);
  try {
    await reopenCcrsMail(admin, mail.id, session.profile.id, reason);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.mail.reopened",
    entityType: "ccrs_mail_messages",
    entityId: mail.id,
    before: { state: mail.state, handledAt: mail.handled_at, handledNote: mail.handled_note },
    after: { state: "new", gmailId: mail.gmail_id, subject: mail.subject, kind: mail.kind, reason },
  });
  revalidatePath(BASE);
  backMail(weekKey, okQ(`Email reopened: "${mail.subject}". It is back in the waiting list. Press Apply on it.`), page);
}

/**
 * D228 (0357): CCRS ACCEPTED a file this system did not make (a hand fix).
 * The owner gives the exact file that was uploaded; the hub stores those
 * bytes under the name the CCRS email gives, marked uploaded at CCRS's own
 * "Date Submitted", and then applies THIS confirmation through the normal
 * path (same matching, same time rule). Nothing is adopted that the email
 * does not name, and nothing already in the outbox is adopted again.
 */
export async function adoptHandmadeFileAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env: page, admin, mail } = await loadMail(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < ADOPT_REASON_MIN) backMail(weekKey, errQ(`Say why this hand-made file is adopted (${ADOPT_REASON_MIN} or more characters).`), page);
  const plan = planSuccessEnv({ kind: mail.kind, env: mail.env, envVerified: mail.env_verified }, String(formData.get("env") ?? "") || null, formData.get("confirm_checked") === "on");
  if (!plan.ok) backMail(weekKey, errQ(plan.error), page);
  const env: LedgerEnv = plan.env;
  // The name comes from the stored email body, never from the form.
  const notices = parseSuccessEmails(mail.body_text);
  const wanted = String(formData.get("file_name") ?? "").trim();
  const notice = notices.length === 1 && !wanted ? notices[0] : notices.find((n) => n.fileName === wanted);
  if (!notice) backMail(weekKey, errQ(notices.length === 0 ? "This email names no CCRS file." : `Choose which file to adopt: ${notices.map((n) => n.fileName).join(", ")}.`), page);
  // The exact bytes: an uploaded file (preferred, byte for byte) or a paste.
  const upload = formData.get("csv_file");
  let csv = String(formData.get("csv_text") ?? "");
  if (upload && typeof upload === "object" && "text" in upload && (upload as File).size > 0) {
    if ((upload as File).size > 5_000_000) backMail(weekKey, errQ("That file is larger than 5 MB. It is not a hand-made fix."), page);
    csv = await (upload as File).text();
  }
  if (!csv.trim()) backMail(weekKey, errQ("Attach the exact file you uploaded to CCRS (or paste its text)."), page);
  let known: Awaited<ReturnType<typeof ccrsFilesByName>>;
  try {
    known = await ccrsFilesByName(admin, env, [notice.fileName]);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
  }
  if (known.length > 0) backMail(weekKey, errQ(`${notice.fileName} is already in the ${env} outbox (${known[0].state}). Press Apply confirmation instead.`), page);
  const license = await getCcrsLicenseSettings();
  const adopt = planAdoptFile({ fileName: notice.fileName, csv, licenseNumber: license.licenseNumber });
  if (!adopt.ok) backMail(weekKey, errQ(`Not adopted: ${adopt.errors.join(" | ")}`), page);
  const at = adoptUploadTime(notice.submittedAt, String(formData.get("uploaded_at") ?? ""));
  if (!at) backMail(weekKey, errQ("This email has no CCRS Date Submitted. Enter the time you uploaded the file (Pacific)."), page);
  let res: Awaited<ReturnType<typeof adoptHandmadeFile>>;
  try {
    res = await adoptHandmadeFile(admin, env, adopt.payload, at, session.profile.id, reason);
  } catch (e) {
    backMail(weekKey, errQ(asText(e)), page);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.file.adopted_handmade",
    entityType: "ccrs_files",
    entityId: res.id,
    after: {
      env, fileName: res.fileName, sha256: adopt.payload.sha256, rows: adopt.payload.number_records, uploadedAt: res.uploadedAt,
      ccrsDateSubmitted: notice.submittedAt, overridden: res.overridden, waitingOn: res.waitingOn, reason, fromEmail: mail.gmail_id,
    },
  });
  // Now the confirmation names a file of the outbox: apply it the normal way.
  const applied = await applySuccessMail(admin, session, mail, env, true);
  revalidatePath(BASE);
  const head = `${res.fileName} adopted (${adopt.payload.number_records} row(s), uploaded ${res.uploadedAt}).`;
  backMail(weekKey, applied.ok ? okQ(`${head} ${applied.text}`) : errQ(`${head} The confirmation was NOT applied: ${applied.text}`), page);
}
