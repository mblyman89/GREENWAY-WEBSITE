"use server";

/**
 * D253: the hub's buttons for the assisted CCRS uploader (owner's option A).
 * Every action: requirePermission("settings.manage"), audited, decisions in
 * the pure ccrs-auto-upload-core via ccrs-auto-upload-store.
 *
 * Owner (D253, verbatim log): "I will log in, and then you can upload the
 * three batches, waiting for each email response before uploading the next
 * set." Starting a run is the owner's explicit, per-run authorization (the
 * AGENTS rule 3 D253 exception); nothing here starts one by itself.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hubEnv, hubHref } from "@/lib/compliance/ccrs-hub-flow-core";
import { weekFromKey } from "@/lib/compliance/ccrs-week-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import { emitOutboxFiles, loadLedgerForBatch } from "@/lib/compliance/ccrs-ledger-store";
import { emitPayload, planOutboxFiles, verifyOutboxAgainstLedger } from "@/lib/compliance/ccrs-outbox-core";
import { verifyCcrsBatch } from "@/lib/compliance/ccrs-batch-core";
import { buildAutobotTestSources } from "@/lib/compliance/ccrs-autobot-test-core";
import { endRun, getActiveRun, markNotReceived, pairDevice, pauseRun, resumeRun, revokeDevice, startRun } from "@/lib/compliance/ccrs-auto-upload-store";

const BASE = "/admin/compliance/ccrs";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const START_CONFIRM = "UPLOAD";

function back(formData: FormData, q: Record<string, string>): never {
  const wk = String(formData.get("week_key") ?? "");
  const env: LedgerEnv = hubEnv(String(formData.get("page_env") ?? ""));
  redirect(hubHref({ week: weekFromKey(wk) ? wk : null, env, params: q, anchor: "ccrs-auto-upload" }));
}
const err = (formData: FormData, m: string): never => back(formData, { error: m });
const ok = (formData: FormData, m: string): never => back(formData, { saved: "1", note: m });
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type PairState = { code: string | null; error: string | null; label: string | null };

/** Pair a browser. The code is returned ONCE to this form (never put in a URL, never stored). */
export async function pairUploaderDeviceAction(_prev: PairState, formData: FormData): Promise<PairState> {
  const session = await requirePermission("settings.manage");
  const label = String(formData.get("label") ?? "").trim().slice(0, 80) || "Owner's Chrome";
  try {
    const admin = createSupabaseAdminClient();
    const { id, code } = await pairDevice(admin, label, { id: session.profile.id, email: session.email });
    await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.device_paired", entityType: "ccrs_uploader_device", entityId: id, after: { label } });
    revalidatePath(BASE);
    return { code, error: null, label };
  } catch (e) {
    return { code: null, error: text(e), label };
  }
}

export async function revokeUploaderDeviceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = String(formData.get("device_id") ?? "");
  if (!ID_RE.test(id)) err(formData, "Invalid browser.");
  try {
    await revokeDevice(createSupabaseAdminClient(), id, { id: session.profile.id, email: session.email });
  } catch (e) {
    err(formData, text(e));
  }
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.device_revoked", entityType: "ccrs_uploader_device", entityId: id });
  revalidatePath(BASE);
  ok(formData, "That browser can no longer upload or read files.");
}

export async function startAutoUploadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const env: LedgerEnv = String(formData.get("run_env") ?? "") === "prod" ? "prod" : "preprod";
  if (env === "prod" && String(formData.get("confirm") ?? "").trim().toUpperCase() !== START_CONFIRM) {
    err(formData, `Type ${START_CONFIRM} to start a production run.`);
  }
  const gap = Number(formData.get("gap_minutes") ?? 10);
  let res: Awaited<ReturnType<typeof startRun>>;
  try {
    res = await startRun(createSupabaseAdminClient(), env, { id: session.profile.id, email: session.email }, gap);
  } catch (e) {
    err(formData, text(e));
  }
  if (!res!.ok) err(formData, res!.error);
  const r = res! as { ok: true; runId: string; files: number };
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.run_started", entityType: "ccrs_upload_run", entityId: r.runId, after: { env, files: r.files, gapMinutes: gap } });
  revalidatePath(BASE);
  ok(formData, `${env === "prod" ? "Production" : "PREprod"} run started: ${r.files} file(s). Keep Chrome open and logged in to CCRS; the uploader goes one group at a time.`);
}

async function activeOr(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "");
  if (!ID_RE.test(runId)) err(formData, "Invalid run.");
  const admin = createSupabaseAdminClient();
  const run = await getActiveRun(admin);
  if (!run || run.id !== runId) err(formData, "That run is no longer going.");
  return { admin, run: run! };
}

export async function pauseAutoUploadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { admin, run } = await activeOr(formData);
  const done = await pauseRun(admin, run.id, `Paused by ${session.email ?? "the owner"}.`);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.run_paused", entityType: "ccrs_upload_run", entityId: run.id });
  revalidatePath(BASE);
  if (done) ok(formData, "Paused. Nothing more is handed out until you resume (a file already in the browser finishes).");
  err(formData, "The run was not running.");
}

export async function resumeAutoUploadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { admin, run } = await activeOr(formData);
  const accept = formData.getAll("accept_file_id").map(String).filter((x) => ID_RE.test(x));
  if (accept.length > 0 && String(formData.get("accept_confirm") ?? "") !== "yes") err(formData, "Tick the box to accept the refused rows.");
  const done = await resumeRun(admin, run.id, accept);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: accept.length ? "ccrs.auto_upload.run_continued_anyway" : "ccrs.auto_upload.run_resumed", entityType: "ccrs_upload_run", entityId: run.id, after: { accepted: accept } });
  revalidatePath(BASE);
  if (done) ok(formData, accept.length ? "Continuing: the next group goes despite the refused rows you accepted." : "Resumed.");
  err(formData, "The run was not paused.");
}

export async function stopAutoUploadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const { admin, run } = await activeOr(formData);
  await endRun(admin, run.id, "stopped", `Stopped by ${session.email ?? "the owner"}.`);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.run_stopped", entityType: "ccrs_upload_run", entityId: run.id });
  revalidatePath(BASE);
  ok(formData, "Stopped. Files not yet sent stay ready for the next run or a hand upload.");
}

export async function markNotReceivedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = String(formData.get("run_file_id") ?? "");
  if (!ID_RE.test(id)) err(formData, "Invalid file.");
  if (String(formData.get("checked") ?? "") !== "yes") err(formData, "Tick the box: you checked CCRS and its email, and CCRS did not receive this file.");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  let done = false;
  try {
    done = await markNotReceived(createSupabaseAdminClient(), id, note);
  } catch (e) {
    err(formData, text(e));
  }
  if (!done) err(formData, "That file is not waiting for a decision (or its run is still going: stop it first).");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ccrs.auto_upload.marked_not_received", entityType: "ccrs_upload_run_file", entityId: id, after: { note } });
  revalidatePath(BASE);
  ok(formData, "Recorded as not received. A new run may send it.");
}

/**
 * D254: make the seven-file PREprod practice set for the uploader. Owner
 * (verbatim): "please provide for me 7 test files to upload to the preprod
 * env to test the autobot. one for each batch." PREprod ONLY: there is no
 * production path here. The files go through the same last checks as a
 * weekly emission (batch verifier + ledger self-check) and land in the
 * PREprod outbox as "emitted", so a PREprod run picks them up.
 */
export async function makePreprodAutobotTestSetAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const env: LedgerEnv = "preprod";
  const admin = createSupabaseAdminClient();
  const lic = await getCcrsLicenseSettings();
  const now = new Date();
  let built: ReturnType<typeof buildAutobotTestSources>;
  try {
    built = buildAutobotTestSources({ licenseNumber: lic.licenseNumber, submittedBy: lic.submittedBy, now });
  } catch (e) {
    err(formData, text(e));
  }
  const { ids, files } = built!;
  let slice: Awaited<ReturnType<typeof loadLedgerForBatch>>;
  try {
    slice = await loadLedgerForBatch(admin, env, [ids.lotId], [ids.productName]);
  } catch (e) {
    err(formData, text(e));
  }
  if (slice!.kind !== "loaded") err(formData, "The PREprod ledger is not started, so nothing can be put in the PREprod outbox. Start it on this page first.");
  const ledger = (slice! as Extract<typeof slice, { kind: "loaded" }>).ledger;
  const planned = planOutboxFiles(files, { licenseNumber: lic.licenseNumber, now, lastStamp: ledger.lastStamp });
  const offline = verifyCcrsBatch(planned.map((f) => ({ type: f.type, csv: f.csv }))).problems.filter((pr) => pr.severity === "error");
  const ledgerProblems = verifyOutboxAgainstLedger(ledger.view, planned);
  if (offline.length > 0 || ledgerProblems.length > 0) {
    const first = [...offline.map((pr) => pr.message), ...ledgerProblems.map((pr) => `[${pr.code}] ${pr.message}`)].slice(0, 3).join(" | ");
    err(formData, `The practice set failed the last check, so it was not made: ${first}`);
  }
  const note = `D254 PREprod uploader practice set ${ids.tag}`;
  let result: Awaited<ReturnType<typeof emitOutboxFiles>>;
  try {
    result = await emitOutboxFiles(admin, env, emitPayload(planned, () => [{ severity: "info", code: "I_AUTOBOT_TEST", message: note }]), []);
  } catch (e) {
    err(formData, text(e));
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.auto_upload.preprod_test_set_made",
    entityType: "ccrs_files",
    entityId: ids.tag,
    after: { env, tag: ids.tag, files: result!.map((r) => ({ id: r.id, name: r.file_name, status: r.status })) },
  });
  revalidatePath(BASE);
  ok(formData, `PREprod practice set ${ids.tag} made: ${result!.map((r) => r.file_name).join(", ")}. Now start a PREprod run. The transfer file will probably get an error email (made-up vendor lot); that is expected.`);
}
