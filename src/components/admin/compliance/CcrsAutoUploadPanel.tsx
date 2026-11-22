/**
 * D253: the assisted CCRS uploader on the hub. Server component.
 *
 * Owner (D253, verbatim log): "I will log in, and then you can upload the
 * three batches, waiting for each email response before uploading the next
 * set." The owner logs into CCRS in his own Chrome; the Greenway extension
 * there uploads one file at a time through the CCRS web form; this panel
 * starts, pauses and stops a run and shows every step.
 */
import type { AutoUploadView, UploadRunFile } from "@/lib/compliance/ccrs-auto-upload-store";
import { CCRS_ORIGINS, DEFAULT_GAP_MINUTES, DEVICE_SILENT_MS } from "@/lib/compliance/ccrs-auto-upload-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { PendingSubmit } from "./PendingSubmit";
import { CcrsUploaderPairForm } from "./CcrsUploaderPairForm";
import {
  makePreprodAutobotTestSetAction,
  markNotReceivedAction,
  pairUploaderDeviceAction,
  pauseAutoUploadAction,
  resumeAutoUploadAction,
  revokeUploaderDeviceAction,
  startAutoUploadAction,
  stopAutoUploadAction,
} from "@/app/admin/compliance/ccrs/auto-upload-actions";

const STEP_TEXT: Record<UploadRunFile["step"], string> = {
  pending: "waiting its turn",
  claimed: "in the browser now",
  posted: "CCRS received it",
  refused: "CCRS did not take it",
  unknown: "not known: check CCRS email",
  skipped: "not sent by this run",
};
const STEP_TONE: Record<UploadRunFile["step"], string> = {
  pending: "text-white/60",
  claimed: "text-sky-200",
  posted: "text-emerald-200",
  refused: "text-red-200",
  unknown: "text-amber-200",
  skipped: "text-white/40",
};

const pt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

function Hidden({ weekKey, env }: { weekKey: string; env: LedgerEnv }) {
  return (
    <>
      <input type="hidden" name="week_key" value={weekKey} />
      <input type="hidden" name="page_env" value={env} />
    </>
  );
}

export function CcrsAutoUploadPanel({ view, weekKey, env, canEdit }: { view: AutoUploadView; weekKey: string; env: LedgerEnv; canEdit: boolean }) {
  const nowMs = view.readAtMs;
  if (!view.available) {
    return <p className="text-xs text-amber-200" data-testid="ccrs-auto-upload-missing">{view.error}</p>;
  }
  const live = view.devices.filter((d) => !d.revoked_at);
  const seen = live.find((d) => d.last_seen_at && nowMs - Date.parse(d.last_seen_at) < DEVICE_SILENT_MS);
  const run = view.active;
  const btn = "rounded-lg px-3 py-1.5 text-xs font-bold";
  return (
    <div className="space-y-4 text-sm" data-testid="ccrs-auto-upload">
      {view.error ? <p role="alert" className="text-xs text-red-300">{view.error}</p> : null}
      {!view.enabled ? <p className="text-xs text-amber-200">Switched off on the server (CCRS_AUTO_UPLOAD=off). Nothing is handed out.</p> : null}
      <p className="text-xs text-white/60" data-testid="ccrs-auto-upload-keepalive">
        {view.keepAlive
          ? "Keep-alive is on (CCRS_KEEPALIVE=on): while a run waits for CCRS's email, Chrome re-reads the CCRS page every 10 minutes so the login does not time out."
          : "Keep-alive is off (set CCRS_KEEPALIVE=on to switch it on). If CCRS logs you out while the next group is ready, you get an email or push to log in again."}
      </p>

      {/* D261: what YOU do, and what the run does by itself. */}
      <div className="grid gap-3 text-xs md:grid-cols-2" data-testid="ccrs-auto-upload-howto">
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3">
          <p className="mb-1 font-bold text-emerald-100">What you do</p>
          <ol className="list-decimal space-y-1 pl-5 text-white/75">
            <li>Build the week above and press Download. That stores every file here as &ldquo;emitted&rdquo;. The zip on your computer is only your copy; the run never reads it.</li>
            <li>Apply (or set aside) any CCRS email still waiting in &ldquo;CCRS email&rdquo; below. A run will not start while one waits.</li>
            <li>Log in to CCRS {env === "preprod" ? "PREprod" : "production"} ({env === "preprod" ? CCRS_ORIGINS.preprod : CCRS_ORIGINS.prod}) in the paired Chrome. Leave that tab open and keep the computer awake.</li>
            <li>Choose the CCRS site, type UPLOAD for production, and press Start. That is all.</li>
          </ol>
        </div>
        <div className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-3">
          <p className="mb-1 font-bold text-sky-100">What the run does by itself</p>
          <ul className="list-disc space-y-1 pl-5 text-white/75">
            <li>Takes every emitted file from the database (any week), in order: Group 1 Strain, Area, Product; Group 2 Inventory; Group 3 Adjustment, Transfer, Sale.</li>
            <li>Uploads one file at a time through your logged-in CCRS tab.</li>
            <li>Reads CCRS&apos;s emails every 5 minutes and applies them for you. No need to press Fetch or Apply while it runs.</li>
            <li>Sends the next group only after every file of the earlier group has its CCRS email. <strong>Minutes between groups</strong> is an extra pause on top of that wait, never instead of it; 0 to 10 is fine.</li>
            <li>Pauses and tells you if CCRS refused rows, or if CCRS logged you out.</li>
          </ul>
        </div>
      </div>

      {/* the run */}
      {run ? (
        <div className={`rounded-xl border p-3 ${run.state === "paused" ? "border-amber-400/40 bg-amber-500/5" : "border-sky-400/30 bg-sky-500/5"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{run.env === "prod" ? "Production" : "PREprod"} run {run.state === "paused" ? "(paused)" : "(going)"}</span>
            <span className="text-xs text-white/50">started {pt(run.started_at)} by {run.started_by_email ?? "owner"}; {run.gap_minutes}-minute gap between groups; emails go to {run.ccrs_username}</span>
          </div>
          <p className="mt-1 text-xs text-white/80" data-testid="ccrs-auto-upload-now">Now: {run.last_decision ?? "starting"} <span className="text-white/40">({pt(run.last_decision_at)})</span></p>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-white/40">
              <tr><th className="py-1">#</th><th>Group</th><th>File</th><th>Step</th><th>When</th></tr>
            </thead>
            <tbody>
              {run.files.map((f) => (
                <tr key={f.id} className="border-t border-white/5">
                  <td className="py-1">{f.seq}</td>
                  <td>{f.grp}</td>
                  <td className="font-mono">{f.file_name}</td>
                  <td className={STEP_TONE[f.step]} title={f.note ?? undefined}>{STEP_TEXT[f.step]}</td>
                  <td>{pt(f.ccrs_received_at ?? f.posted_at ?? f.claimed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {run.state === "running" ? (
                <form action={pauseAutoUploadAction}>
                  <Hidden weekKey={weekKey} env={env} />
                  <input type="hidden" name="run_id" value={run.id} />
                  <PendingSubmit busy={"Pausing\u2026"} className={`${btn} border border-white/20`}>Pause</PendingSubmit>
                </form>
              ) : (
                <form action={resumeAutoUploadAction}>
                  <Hidden weekKey={weekKey} env={env} />
                  <input type="hidden" name="run_id" value={run.id} />
                  <PendingSubmit busy={"Resuming\u2026"} className={`${btn} bg-sky-400/80 text-black`}>Resume</PendingSubmit>
                </form>
              )}
              <form action={stopAutoUploadAction}>
                <Hidden weekKey={weekKey} env={env} />
                <input type="hidden" name="run_id" value={run.id} />
                <PendingSubmit busy={"Stopping\u2026"} className={`${btn} bg-red-500/80 text-black`} testId="ccrs-auto-upload-stop">Stop</PendingSubmit>
              </form>
            </div>
          ) : null}
          {canEdit && run.state === "paused" && run.files.some((f) => view.refusedFileIds.includes(f.file_id) && !run.accepted_file_ids.includes(f.file_id)) ? (
            <form action={resumeAutoUploadAction} className="mt-3 space-y-1 rounded-lg border border-amber-300/30 p-2 text-xs">
              <Hidden weekKey={weekKey} env={env} />
              <input type="hidden" name="run_id" value={run.id} />
              {run.files.filter((f) => view.refusedFileIds.includes(f.file_id)).map((f) => (
                <label key={f.id} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" name="accept_file_id" value={f.file_id} /> {f.file_name}
                </label>
              ))}
              <label className="block"><input type="checkbox" name="accept_confirm" value="yes" /> I read CCRS&apos;s error file; the next group may go without those rows.</label>
              <PendingSubmit busy={"Continuing\u2026"} className={`${btn} bg-amber-300 text-black`}>Continue anyway</PendingSubmit>
            </form>
          ) : null}
        </div>
      ) : canEdit ? (
        <form action={startAutoUploadAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 p-3 text-xs" data-testid="ccrs-auto-upload-start">
          <Hidden weekKey={weekKey} env={env} />
          <label className="flex flex-col gap-1">
            <span className="text-white/60">CCRS</span>
            <select name="run_env" defaultValue={env} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1">
              <option value="preprod">PREprod (practice)</option>
              <option value="prod">Production</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-white/60">Extra minutes between groups (after the emails)</span>
            <input name="gap_minutes" type="number" min={0} max={240} defaultValue={DEFAULT_GAP_MINUTES} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-white/60">Production only: type UPLOAD</span>
            <input name="confirm" autoComplete="off" className="w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1" />
          </label>
          <PendingSubmit busy={"Starting\u2026"} className={`${btn} bg-emerald-400 text-black`} disabled={!view.enabled || live.length === 0}>
            Start uploading every built file
          </PendingSubmit>
          {live.length === 0 ? <span className="text-amber-200">Pair a browser first.</span> : !seen ? <span className="text-amber-200">No paired browser checked in recently: open Chrome.</span> : null}
        </form>
      ) : null}

      {canEdit && !run ? (
        <form action={makePreprodAutobotTestSetAction} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 p-3 text-xs" data-testid="ccrs-auto-upload-preprod-test">
          <Hidden weekKey={weekKey} env={env} />
          <span className="text-white/70">PREprod practice: make 7 one-row test files (one of each type, new names every time) for a PREprod run. The transfer file is expected to get an error email.</span>
          <PendingSubmit busy={"Making\u2026"} className={`${btn} bg-white/10`}>
            Make PREprod test files
          </PendingSubmit>
        </form>
      ) : null}

      {/* hand-outs waiting for the owner's decision */}
      {view.unsure.length > 0 ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-bold text-amber-100">Not known whether CCRS received these. No new run starts until each is settled.</p>
          <p className="text-white/60">When CCRS&apos;s email for it arrives and is applied, it settles by itself. If you checked CCRS and it truly did not arrive, record that here.</p>
          {view.unsure.map((u) => (
            <form key={u.id} action={markNotReceivedAction} className="mt-2 flex flex-wrap items-center gap-2">
              <Hidden weekKey={weekKey} env={env} />
              <input type="hidden" name="run_file_id" value={u.id} />
              <span className="font-mono">{u.file_name}</span>
              <span className="text-white/50">{u.note}</span>
              {canEdit ? (
                <>
                  <label><input type="checkbox" name="checked" value="yes" /> CCRS did not receive it</label>
                  <input name="note" placeholder="what you checked" maxLength={500} className="rounded border border-white/15 bg-black/30 px-2 py-0.5" />
                  <PendingSubmit busy={"Saving\u2026"} className={`${btn} border border-white/20`}>Record not received</PendingSubmit>
                </>
              ) : null}
            </form>
          ))}
        </div>
      ) : null}

      {/* browsers */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-white/70">Paired browsers</p>
        {view.devices.length === 0 ? <p className="text-xs text-white/50">None yet.</p> : null}
        <ul className="space-y-1 text-xs">
          {view.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span className={d.revoked_at ? "text-white/30 line-through" : "font-semibold"}>{d.label}</span>
              <span className="text-white/50">
                last check-in {pt(d.last_seen_at)}
                {d.last_tabs && d.last_tabs.length > 0
                  ? `; CCRS tab: ${d.last_tabs.map((t) => `${t.origin.includes("precannabis") ? "PREprod" : "production"} ${t.loggedIn ? `logged in as ${t.username ?? "?"}` : "not logged in"}`).join(", ")}`
                  : "; no CCRS tab open"}
                {d.last_version ? `; v${d.last_version}` : ""}
              </span>
              {canEdit && !d.revoked_at ? (
                <form action={revokeUploaderDeviceAction}>
                  <Hidden weekKey={weekKey} env={env} />
                  <input type="hidden" name="device_id" value={d.id} />
                  <PendingSubmit busy={"Revoking\u2026"} className="rounded border border-red-400/40 px-2 py-0.5 text-red-200">Revoke</PendingSubmit>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? <CcrsUploaderPairForm pairAction={pairUploaderDeviceAction} /> : null}
      </div>

      {view.recent.length > 0 ? (
        <details className="text-xs text-white/60">
          <summary className="cursor-pointer">Earlier runs</summary>
          <ul className="mt-1 space-y-1">
            {view.recent.map((r) => (
              <li key={r.id}>{pt(r.started_at)} {r.env === "prod" ? "production" : "PREprod"}: {r.state}. {r.ended_reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
