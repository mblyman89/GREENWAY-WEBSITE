"use server";

/**
 * Server actions for the CCRS Compliance Command Center (Task W).
 *
 * Recording a week as SUBMITTED (or nothing-to-report) is the owner's
 * compliance evidence, so every action is permission-gated (settings.manage)
 * and audited. The ledger store enforces the hard rules (a week can only be
 * resolved after it has completed; on_time computed at write).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveWeek, unresolveWeek, setWeekErrorStatus } from "@/lib/compliance/ccrs-week-store";
import { weekFromKey } from "@/lib/compliance/ccrs-week-core";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  abandonFile,
  assignProductIds,
  ccrsFilesByName,
  fileRowsForEcho,
  getCcrsFile,
  markUploaded,
  recordOutcome,
  startPreprodLedger,
} from "@/lib/compliance/ccrs-ledger-store";
import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
import { PREPROD_RUN_RE, type LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { CcrsEchoError, classifyEcho, noEmailAllowedAt } from "@/lib/compliance/ccrs-outcome-core";
import {
  lifecycleErrorText,
  matchSuccessNames,
  pacificLocalToUtcISO,
  parseSuccessEmails,
} from "@/lib/compliance/ccrs-lifecycle-core";

const BASE = "/admin/compliance/ccrs";

function back(weekKey: string, extra?: string): never {
  redirect(`${BASE}?week=${encodeURIComponent(weekKey)}${extra ? `&${extra}` : ""}`);
}

/** Record a completed week as submitted or nothing-to-report. */
export async function resolveWeekAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const week = weekFromKey(weekKey);
  if (!week || (resolution !== "submitted" && resolution !== "nothing_to_report")) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid week or resolution.")}`);
  }

  // For a SUBMITTED week, snapshot the batch summary as ledger evidence
  // (file names + record counts actually generated for that week's range).
  let files: { type: string; fileName: string; recordCount: number }[] = [];
  let totalRecords = 0;
  if (resolution === "submitted") {
    try {
      const range = resolveRange({ from: week.start, to: week.end });
      const batch = await buildCcrsBatch(range.fromISO, range.toISO);
      files = batch.files.map((f) => ({
        type: String(f.type),
        fileName: f.fileName,
        recordCount: f.recordCount,
      }));
      totalRecords = batch.totalRecords;
    } catch {
      // Evidence snapshot is best-effort — the resolution itself still records.
    }
  }

  const res = await resolveWeek({
    weekKey: week.key,
    resolution,
    byId: session.profile.id,
    byEmail: session.email,
    files,
    totalRecords,
    notes,
  });
  if (!res.ok) back(week.key, `error=${encodeURIComponent(res.error ?? "Could not save.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: resolution === "submitted" ? "ccrs_week.submitted" : "ccrs_week.nothing_to_report",
    entityType: "ccrs_week_submission",
    entityId: week.key,
    after: { weekKey: week.key, resolution, totalRecords, notes },
  });

  revalidatePath(BASE);
  back(week.key, "saved=1");
}

/** Undo a mistaken week sign-off. */
export async function unresolveWeekAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  if (!weekFromKey(weekKey)) redirect(`${BASE}?error=${encodeURIComponent("Invalid week.")}`);

  const res = await unresolveWeek(weekKey);
  if (!res.ok) back(weekKey, `error=${encodeURIComponent(res.error ?? "Could not undo.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs_week.unresolved",
    entityType: "ccrs_week_submission",
    entityId: weekKey,
    after: { weekKey },
  });

  revalidatePath(BASE);
  back(weekKey, "saved=1");
}

/** Flag or clear the error-email status on a submitted week. */
export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const errorStatus = String(formData.get("error_status") ?? "");
  const errorNotes = String(formData.get("error_notes") ?? "").trim() || null;

  if (
    !weekFromKey(weekKey) ||
    (errorStatus !== "clean" && errorStatus !== "errors_reported" && errorStatus !== "resolved")
  ) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid week or error status.")}`);
  }

  const res = await setWeekErrorStatus({
    weekKey,
    errorStatus: errorStatus as "clean" | "errors_reported" | "resolved",
    errorNotes,
  });
  if (!res.ok) back(weekKey, `error=${encodeURIComponent(res.error ?? "Could not save.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs_week.error_status",
    entityType: "ccrs_week_submission",
    entityId: weekKey,
    after: { weekKey, errorStatus, errorNotes },
  });

  revalidatePath(BASE);
  back(weekKey, "saved=1");
}

/**
 * S-12b: assign GWP- CCRS Product ids (D-01a) to every product of the selected
 * week that is withheld ONLY because it has no id yet. Production only.
 *
 * The keys are recomputed HERE from the server-built batch, never taken from
 * the form, so a crafted request cannot mint ids for arbitrary keys. The SQL
 * function is idempotent and an assigned id is permanent (0248 trigger).
 */
export async function assignProductIdsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const week = weekFromKey(weekKey);
  if (!week) redirect(`${BASE}?error=${encodeURIComponent("Invalid week.")}`);

  const range = resolveRange({ from: week.start, to: week.end });
  const batch = await buildCcrsBatch(range.fromISO, range.toISO, { env: "prod" });
  if (!batch.ledger.view) {
    back(week.key, `error=${encodeURIComponent(`No CCRS ledger yet (${batch.ledger.absentReason ?? "unknown"}): apply migration 0248 and finalize the seed first.`)}`);
  }
  const keys = batch.ledger.unassignedProductKeys;
  if (keys.length === 0) back(week.key, "saved=1");

  let assigned: Awaited<ReturnType<typeof assignProductIds>>;
  try {
    assigned = await assignProductIds(createSupabaseAdminClient(), "prod", keys, session.email ?? session.profile.id);
  } catch (e) {
    back(week.key, `error=${encodeURIComponent(e instanceof Error ? e.message : "Could not assign CCRS Product ids.")}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.product_ids.assigned",
    entityType: "ccrs_product_ids",
    entityId: week.key,
    after: {
      env: "prod",
      requested: keys.length,
      newlyAssigned: assigned.filter((a) => a.newlyAssigned).length,
      ids: assigned.map((a) => ({ key: a.productKey, id: a.externalId, new: a.newlyAssigned })),
    },
  });

  revalidatePath(BASE);
  back(week.key, "saved=1");
}

/* ================================================================== *
 * S-12c: the upload lifecycle (0249). Every decision is re-made HERE on
 * the server from the stored file and the pasted CCRS text; nothing the
 * form says about rows, outcomes or ids is trusted.
 * ================================================================== */

const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A pasted CCRS error CSV for one 10,000-row chunk stays far below this. */
const MAX_PASTE_CHARS = 2_000_000;

function backTo(weekKey: string, env: LedgerEnv, extra: string): never {
  const w = weekFromKey(weekKey) ? `week=${encodeURIComponent(weekKey)}&` : "";
  redirect(`${BASE}?${w}env=${env}&${extra}#ccrs-files`);
}
const errQ = (msg: string) => `error=${encodeURIComponent(msg)}`;
const okQ = (msg: string) => `saved=1&note=${encodeURIComponent(msg)}`;
const asText = (e: unknown) => lifecycleErrorText(e instanceof Error ? e.message : String(e));

function readCommon(formData: FormData) {
  return {
    weekKey: String(formData.get("week_key") ?? ""),
    env: parseLedgerEnv(String(formData.get("env") ?? "")),
    fileId: String(formData.get("file_id") ?? ""),
  };
}

/** Load the file and prove it belongs to the env the page showed. */
async function loadFileFor(env: LedgerEnv, fileId: string, weekKey: string) {
  if (!FILE_ID_RE.test(fileId)) backTo(weekKey, env, errQ("Invalid file."));
  const admin = createSupabaseAdminClient();
  let file: Awaited<ReturnType<typeof getCcrsFile>>;
  try {
    file = await getCcrsFile(admin, fileId);
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
  }
  if (file.env !== env) backTo(weekKey, env, errQ(`That file belongs to ${file.env}, not ${env}.`));
  return { admin, file };
}

/** "I uploaded this file at <Pacific time>." Optional logged override of the pacing rule. */
export async function markUploadedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env, fileId } = readCommon(formData);
  const at = pacificLocalToUtcISO(String(formData.get("uploaded_at") ?? ""));
  const override = String(formData.get("override") ?? "").trim() || null;
  if (!at) backTo(weekKey, env, errQ("Enter the upload date and time (Pacific)."));
  const { admin, file } = await loadFileFor(env, fileId, weekKey);
  let res: Awaited<ReturnType<typeof markUploaded>>;
  try {
    res = await markUploaded(admin, file.id, at, session.profile.id, override);
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: res.overridden ? "ccrs.file.uploaded_override" : "ccrs.file.uploaded",
    entityType: "ccrs_files",
    entityId: file.id,
    after: { env, fileName: res.fileName, uploadedAt: at, overridden: res.overridden, override: res.overridden ? override : null, waitingOn: res.waitingOn },
  });
  revalidatePath(BASE);
  backTo(weekKey, env, okQ(`${res.fileName} marked uploaded. Wait for the CCRS email (usually 1-2 minutes).`));
}

/**
 * Paste one or more "CCRS Processing Successful" emails. Every named file of
 * this env that is waiting is recorded succeeded, earliest stamp first; the
 * email time is CCRS's own "Date Submitted" when present, else now.
 */
export async function recordSuccessAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env } = readCommon(formData);
  const pasted = String(formData.get("email_text") ?? "").slice(0, MAX_PASTE_CHARS);
  const notices = parseSuccessEmails(pasted);
  if (notices.length === 0) {
    backTo(weekKey, env, errQ("No CCRS file name found. Paste the whole success email (it names the file, e.g. Strain_413541_20261007120000_2026107T1252497.csv)."));
  }
  const admin = createSupabaseAdminClient();
  let named: Awaited<ReturnType<typeof ccrsFilesByName>>;
  try {
    named = await ccrsFilesByName(admin, env, notices.map((n) => n.fileName));
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
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
    backTo(weekKey, env, errQ(`Nothing recorded: ${why}. Mark the file uploaded first, and check the PREprod/production switch.`));
  }
  const now = Date.now();
  const done: string[] = [];
  const failed: string[] = [];
  for (const r of match.record) {
    // CCRS's "Date Submitted" is the upload time; the email came after it. Use
    // the later of that and our recorded upload, never a time in the future.
    const at = new Date(Math.min(now, Math.max(Date.parse(r.uploadedAt), r.submittedAt ? Date.parse(r.submittedAt) : now))).toISOString();
    try {
      const out = await recordOutcome(admin, r.id, "success", at, [], null);
      done.push(`${out.fileName} → ${out.state}`);
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "ccrs.file.success",
        entityType: "ccrs_files",
        entityId: r.id,
        after: { env, fileName: out.fileName, state: out.state, rows: out.rows, earlierFilesClosed: out.earlierFilesClosed, ccrsDateSubmitted: r.submittedAt },
      });
    } catch (e) {
      failed.push(`${r.fileName}: ${asText(e)}`);
    }
  }
  revalidatePath(BASE);
  const warn = [
    match.unknown.length ? `Ignored (not ${env} outbox files): ${match.unknown.join(", ")}.` : "",
    match.notWaiting.length ? `Already answered or not uploaded: ${match.notWaiting.map((n) => n.fileName).join(", ")}.` : "",
    match.timeMismatch.length ? `Check the upload time of ${match.timeMismatch.map((t) => t.fileName).join(", ")}: CCRS's "Date Submitted" is over 15 minutes from what was recorded.` : "",
  ].filter(Boolean).join(" ");
  if (failed.length) backTo(weekKey, env, errQ(`Recorded ${done.length}; FAILED ${failed.length}: ${failed.join(" | ")} ${warn}`));
  backTo(weekKey, env, okQ(`Success recorded: ${done.join("; ")}. ${warn}`.trim()));
}

/**
 * Paste the CCRS error CSV for ONE uploaded file. The rows of that file are
 * read back from the outbox and classifyEcho ties every echo line to exactly
 * one row; the verdict (benign / rows / fatal / unmatched) is the server's.
 */
export async function recordErrorAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env, fileId } = readCommon(formData);
  const pasted = String(formData.get("error_csv") ?? "");
  if (pasted.length > MAX_PASTE_CHARS) backTo(weekKey, env, errQ("The pasted text is too large to be one CCRS error file."));
  const at = pacificLocalToUtcISO(String(formData.get("email_at") ?? ""));
  if (!at) backTo(weekKey, env, errQ("Enter when the error email arrived (Pacific)."));
  const { admin, file } = await loadFileFor(env, fileId, weekKey);
  if (file.state !== "uploaded") backTo(weekKey, env, errQ(`${file.fileName} is ${file.state}; only an uploaded file takes an answer.`));
  let verdict: ReturnType<typeof classifyEcho>;
  try {
    const rows = await fileRowsForEcho(admin, file.id, file.numberRecords);
    verdict = classifyEcho(file.fileType, rows, pasted);
  } catch (e) {
    const msg = e instanceof CcrsEchoError ? e.message : asText(e);
    backTo(weekKey, env, errQ(`Not recorded: ${msg}`));
  }
  let out: Awaited<ReturnType<typeof recordOutcome>>;
  try {
    out = await recordOutcome(admin, file.id, verdict.outcome, at, verdict.rejected, verdict.messages);
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: `ccrs.file.${verdict.outcome}`,
    entityType: "ccrs_files",
    entityId: file.id,
    after: { env, fileName: out.fileName, state: out.state, rows: out.rows, messages: verdict.messages, rejectedRows: verdict.rejected.map((r) => r.row_no), why: verdict.why },
  });
  revalidatePath(BASE);
  backTo(weekKey, env, okQ(`${out.fileName}: ${verdict.why} Now ${out.state}; ${out.rows.landed} filed, ${out.rows.rejected} refused, ${out.rows.uncertain} uncertain.`));
}

/** 60+ minutes after the upload, no email of either kind: every row uncertain (Part 05 E). */
export async function recordNoEmailAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env, fileId } = readCommon(formData);
  const { admin, file } = await loadFileFor(env, fileId, weekKey);
  if (!file.uploadedAt || Date.now() < noEmailAllowedAt(new Date(file.uploadedAt)).getTime()) {
    backTo(weekKey, env, errQ("\"No email\" can be declared only 60 minutes after the upload. Check spam and wait."));
  }
  let out: Awaited<ReturnType<typeof recordOutcome>>;
  try {
    out = await recordOutcome(admin, file.id, "no-email", new Date().toISOString(), [], null);
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.file.no_email",
    entityType: "ccrs_files",
    entityId: file.id,
    after: { env, fileName: out.fileName, state: out.state, rows: out.rows },
  });
  revalidatePath(BASE);
  backTo(weekKey, env, okQ(`${out.fileName} is now reconciling: every row is uncertain until a Service Desk copy settles it.`));
}

/** An emitted file that will never be uploaded (bytes kept, name never reused). */
export async function abandonFileAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { weekKey, env, fileId } = readCommon(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 10) backTo(weekKey, env, errQ("Give a reason of 10 or more characters."));
  const { admin, file } = await loadFileFor(env, fileId, weekKey);
  let out: Awaited<ReturnType<typeof abandonFile>>;
  try {
    out = await abandonFile(admin, file.id, reason);
  } catch (e) {
    backTo(weekKey, env, errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.file.abandoned",
    entityType: "ccrs_files",
    entityId: file.id,
    after: { env, fileName: out.fileName, reason },
  });
  revalidatePath(BASE);
  backTo(weekKey, env, okQ(`${out.fileName} abandoned. Do not upload it.`));
}

/** Create the empty PREprod ledger so PREprod exports are recorded and routed. Idempotent. */
export async function startPreprodLedgerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  let out: Awaited<ReturnType<typeof startPreprodLedger>>;
  try {
    out = await startPreprodLedger(createSupabaseAdminClient(), session.email ?? session.profile.id);
  } catch (e) {
    backTo(weekKey, "preprod", errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.preprod_ledger.start",
    entityType: "ccrs_files",
    entityId: out.id,
    after: { status: out.status },
  });
  revalidatePath(BASE);
  backTo(weekKey, "preprod", okQ(out.status === "started" ? "PREprod ledger started (empty)." : "PREprod ledger was already started."));
}

/**
 * Assign PREprod GWP ids (run prefix P<yyyymmdd><letter>) to the products of
 * the selected week that PREprod withholds only for lack of an id. Keys come
 * from the server-built PREprod batch, never from the form.
 */
export async function assignPreprodProductIdsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const run = String(formData.get("run") ?? "").trim().toUpperCase();
  const week = weekFromKey(weekKey);
  if (!week) backTo(weekKey, "preprod", errQ("Invalid week."));
  if (!PREPROD_RUN_RE.test(run)) backTo(week.key, "preprod", errQ("Run id must look like P20261008A (P + date + letter)."));
  const range = resolveRange({ from: week.start, to: week.end });
  const batch = await buildCcrsBatch(range.fromISO, range.toISO, { env: "preprod" });
  if (!batch.ledger.view) backTo(week.key, "preprod", errQ("Start the PREprod ledger first."));
  const keys = batch.ledger.unassignedProductKeys;
  if (keys.length === 0) backTo(week.key, "preprod", okQ("Every PREprod product already has an id."));
  let assigned: Awaited<ReturnType<typeof assignProductIds>>;
  try {
    assigned = await assignProductIds(createSupabaseAdminClient(), "preprod", keys, session.email ?? session.profile.id, run);
  } catch (e) {
    backTo(week.key, "preprod", errQ(asText(e)));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.product_ids.assigned",
    entityType: "ccrs_product_ids",
    entityId: week.key,
    after: { env: "preprod", run, requested: keys.length, newlyAssigned: assigned.filter((a) => a.newlyAssigned).length, ids: assigned.map((a) => ({ key: a.productKey, id: a.externalId, new: a.newlyAssigned })) },
  });
  revalidatePath(BASE);
  backTo(week.key, "preprod", okQ(`${assigned.length} PREprod product id(s) ready (run ${run}).`));
}
