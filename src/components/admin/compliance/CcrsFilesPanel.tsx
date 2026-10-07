/**
 * CcrsFilesPanel — CCRS Bible v2 slice S-12c.
 *
 * Every file the outbox handed out for one env, newest first, with exactly
 * the buttons its state allows (fileActions, which mirrors 0249):
 *
 *   emitted   -> Download · Mark uploaded (Pacific time, optional logged
 *                override of the one-at-a-time rule) · Abandon (reason)
 *   uploaded  -> Download · Paste error CSV · (60 min later) No email
 *   others    -> Download, plus the refused/uncertain rows and what to do
 *
 * One paste box records success emails for any number of files at once
 * (names matched exactly, token stripped). PREprod adds the two set-up steps:
 * start the empty PREprod ledger, then assign PREprod GWP ids for a run.
 *
 * PURE: no hooks, no I/O. Server actions are passed in as props by the page,
 * so this renders with renderToStaticMarkup in the vitest harness.
 */
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { fileActions, noEmailAllowedAt } from "@/lib/compliance/ccrs-outcome-core";
import { FILE_STATE_TEXT, ccrsPortalUrl, pacificLocalInputValue } from "@/lib/compliance/ccrs-lifecycle-core";

export type PanelFile = {
  id: string;
  fileType: string;
  purpose: string;
  fileName: string;
  numberRecords: number | null;
  state: string;
  stampAt: string | null;
  uploadedAt: string | null;
  errorMessages: string[] | null;
  notes: string | null;
};
export type PanelIssue = { fileId: string; severity: string; code: string; message: string };
type Action = (formData: FormData) => void | Promise<void>;

export type CcrsFilesPanelActions = {
  markUploaded: Action;
  recordSuccess: Action;
  recordError: Action;
  recordNoEmail: Action;
  abandon: Action;
  startPreprod: Action;
  assignPreprodIds: Action;
};

type Props = {
  env: LedgerEnv;
  weekKey: string;
  canEdit: boolean;
  available: boolean;
  loadError: string | null;
  files: PanelFile[];
  issues: PanelIssue[];
  ledgerLoaded: boolean;
  unassignedProductCount: number;
  nowISO: string;
  actions?: CcrsFilesPanelActions;
  /** Suggested PREprod run id (P + Pacific date + letter); the operator may change the letter. */
  suggestedRun?: string;
};

const PILL: Record<string, string> = {
  emitted: "bg-sky-500/20 text-sky-200",
  uploaded: "bg-amber-500/25 text-amber-100",
  succeeded: "bg-emerald-500/20 text-emerald-200",
  errored: "bg-orange-500/25 text-orange-100",
  reconciling: "bg-red-500/25 text-red-100",
  closed: "bg-white/10 text-white/60",
  abandoned: "bg-white/5 text-white/40",
  draft: "bg-white/5 text-white/40",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }) + " PT" : "—";

function Hidden({ env, weekKey, fileId }: { env: LedgerEnv; weekKey: string; fileId?: string }) {
  return (
    <>
      <input type="hidden" name="env" value={env} />
      <input type="hidden" name="week_key" value={weekKey} />
      {fileId ? <input type="hidden" name="file_id" value={fileId} /> : null}
    </>
  );
}

const BTN = "rounded-lg px-3 py-1.5 text-[11px] font-bold transition";
const INPUT = "rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[11px] text-white";

export function CcrsFilesPanel(p: Props) {
  const now = new Date(p.nowISO);
  const nowLocal = pacificLocalInputValue(now);
  const a = p.actions;
  const edit = p.canEdit && !!a;
  const waiting = p.files.filter((f) => f.state === "uploaded");
  const toAct = p.files.filter((f) => ["emitted", "uploaded", "errored", "reconciling"].includes(f.state)).length;
  const issuesOf = (id: string) => p.issues.filter((i) => i.fileId === id);

  return (
    <section id="ccrs-files" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5" data-env={p.env}>
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">
          CCRS files — {p.env === "preprod" ? "PREprod (test site)" : "Production"}
        </h2>
        <p className="mt-1 text-xs text-white/40">
          Every file handed out, newest first. After each upload: Mark uploaded, then record the CCRS email. One file at a time; the
          next upload is refused until the previous file is answered. {toAct > 0 ? `${toAct} file(s) need you.` : "Nothing waiting."}
        </p>
      </div>

      {!p.available ? (
        <p className="text-xs text-white/40">The CCRS outbox is not installed yet (migrations 0247–0249).</p>
      ) : (
        <div className="space-y-4">
          {p.loadError ? <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">{p.loadError}</p> : null}

          {/* PREprod set-up */}
          {p.env === "preprod" ? (
            <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/5 px-4 py-3 text-[11px] text-fuchsia-100" data-testid="preprod-setup">
              <p className="font-semibold">PREprod set-up (one time per test cycle)</p>
              <ol className="mt-1 list-decimal space-y-2 pl-5">
                <li>
                  {p.ledgerLoaded ? (
                    <span>✓ PREprod ledger started.</span>
                  ) : edit ? (
                    <form action={a!.startPreprod} className="inline">
                      <Hidden env={p.env} weekKey={p.weekKey} />
                      <span>Start the PREprod ledger (empty: nothing is assumed about what PREprod holds). </span>
                      <button type="submit" className={`${BTN} bg-fuchsia-500/30 text-fuchsia-50 hover:bg-fuchsia-500/40`}>Start PREprod ledger</button>
                    </form>
                  ) : (
                    <span>PREprod ledger not started.</span>
                  )}
                </li>
                <li>
                  {!p.ledgerLoaded ? (
                    <span className="text-white/50">Then give this week&apos;s products PREprod ids.</span>
                  ) : p.unassignedProductCount === 0 ? (
                    <span>✓ Every product of this week has a PREprod id.</span>
                  ) : edit ? (
                    <form action={a!.assignPreprodIds} className="flex flex-wrap items-center gap-2">
                      <Hidden env={p.env} weekKey={p.weekKey} />
                      <span>{p.unassignedProductCount} product(s) need a PREprod id. Run id:</span>
                      <input name="run" defaultValue={p.suggestedRun ?? ""} pattern="P[0-9]{8}[A-Z]" required className={`${INPUT} w-28 uppercase`} aria-label="PREprod run id" />
                      <button type="submit" className={`${BTN} bg-fuchsia-500/30 text-fuchsia-50 hover:bg-fuchsia-500/40`}>Assign PREprod ids</button>
                      <span className="w-full text-white/50">PREprod only. Ids look like P20261008A-GWP-000123 and never touch production.</span>
                    </form>
                  ) : (
                    <span>{p.unassignedProductCount} product(s) need a PREprod id.</span>
                  )}
                </li>
                <li>
                  Download the zip above (it says PREprod), upload at{" "}
                  <a href={ccrsPortalUrl("preprod")} target="_blank" rel="noreferrer" className="underline">precannabisreporting.lcb.wa.gov</a>, one file at a time.
                </li>
              </ol>
            </div>
          ) : null}

          {/* Success paste */}
          {edit && waiting.length > 0 ? (
            <form action={a!.recordSuccess} className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-4 py-3" data-testid="success-paste">
              <Hidden env={p.env} weekKey={p.weekKey} />
              <label className="block text-[11px] font-semibold text-emerald-100">
                Got &quot;CCRS Processing Successful&quot;? Paste the email(s) here (any number at once):
              </label>
              <textarea name="email_text" rows={3} required className={`${INPUT} mt-1 w-full`} placeholder="The file Strain_413541_20261007120000_2026107T1252497.csv you submitted has been processed. Date Submitted: ..." />
              <button type="submit" className={`${BTN} mt-1 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/40`}>Record success</button>
              <span className="ml-2 text-[10px] text-white/45">Waiting: {waiting.map((w) => w.fileName).join(", ")}</span>
            </form>
          ) : null}

          {p.files.length === 0 ? (
            <p className="text-xs text-white/40">No {p.env} files yet. Files appear here when the zip is downloaded with the ledger loaded.</p>
          ) : (
            <ul className="space-y-2">
              {p.files.map((f) => {
                const acts = fileActions(f.state, f.uploadedAt ? new Date(f.uploadedAt) : null, now);
                const iss = issuesOf(f.id);
                const noEmailAt = f.uploadedAt ? noEmailAllowedAt(new Date(f.uploadedAt)) : null;
                return (
                  <li key={f.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs" data-file={f.fileName} data-state={f.state}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-white/85">{f.fileName}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PILL[f.state] ?? PILL.draft}`}>{f.state}</span>
                      <span className="text-white/40">
                        {f.numberRecords ?? "?"} row(s){f.purpose !== "weekly" ? ` · ${f.purpose}` : ""}
                        {f.uploadedAt ? ` · uploaded ${fmt(f.uploadedAt)}` : ""}
                      </span>
                      {acts.includes("download") ? (
                        <a href={`/admin/compliance/ccrs/file/${f.id}`} className="ml-auto text-[11px] font-semibold text-[var(--admin-accent)] underline">
                          Download exact file
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-1 text-white/50">{FILE_STATE_TEXT[f.state] ?? f.state}</p>

                    {edit && acts.includes("mark-uploaded") ? (
                      <form action={a!.markUploaded} className="mt-2 flex flex-wrap items-center gap-2">
                        <Hidden env={p.env} weekKey={p.weekKey} fileId={f.id} />
                        <label className="text-white/60">Uploaded at (Pacific):</label>
                        <input type="datetime-local" name="uploaded_at" defaultValue={nowLocal} max={nowLocal} required className={INPUT} />
                        <button type="submit" className={`${BTN} bg-sky-500/30 text-sky-50 hover:bg-sky-500/40`}>Mark uploaded</button>
                        <details className="w-full text-white/45">
                          <summary className="cursor-pointer">Upload out of order anyway (logged)…</summary>
                          <input name="override" minLength={10} placeholder="Reason, 10+ characters (saved on the file)" className={`${INPUT} mt-1 w-full`} />
                        </details>
                      </form>
                    ) : null}

                    {edit && acts.includes("record-error") ? (
                      <form action={a!.recordError} className="mt-2 space-y-1">
                        <Hidden env={p.env} weekKey={p.weekKey} fileId={f.id} />
                        <label className="block text-white/60">Got an error email for THIS file? Open its attached CSV in a text editor (not Excel), copy everything, paste:</label>
                        <textarea name="error_csv" rows={3} required className={`${INPUT} w-full font-mono`} placeholder="LicenseNumber,...,ErrorMessage" />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-white/60">Email arrived (Pacific):</label>
                          <input type="datetime-local" name="email_at" defaultValue={nowLocal} max={nowLocal} required className={INPUT} />
                          <button type="submit" className={`${BTN} bg-orange-500/30 text-orange-50 hover:bg-orange-500/40`}>Record error file</button>
                        </div>
                      </form>
                    ) : null}

                    {edit && f.state === "uploaded" ? (
                      acts.includes("record-no-email") ? (
                        <form action={a!.recordNoEmail} className="mt-2">
                          <Hidden env={p.env} weekKey={p.weekKey} fileId={f.id} />
                          <button type="submit" className={`${BTN} bg-red-500/25 text-red-100 hover:bg-red-500/35`}>No email after 60 minutes (checked spam)</button>
                        </form>
                      ) : (
                        <p className="mt-2 text-[10px] text-white/40">&quot;No email&quot; unlocks at {fmt(noEmailAt ? noEmailAt.toISOString() : null)}.</p>
                      )
                    ) : null}

                    {edit && acts.includes("abandon") ? (
                      <details className="mt-2 text-white/45">
                        <summary className="cursor-pointer">Never going to upload this file? Abandon it…</summary>
                        <form action={a!.abandon} className="mt-1 flex flex-wrap items-center gap-2">
                          <Hidden env={p.env} weekKey={p.weekKey} fileId={f.id} />
                          <input name="reason" minLength={10} required placeholder="Reason, 10+ characters" className={`${INPUT} flex-1`} />
                          <button type="submit" className={`${BTN} bg-red-500/25 text-red-100 hover:bg-red-500/35`}>Abandon</button>
                        </form>
                      </details>
                    ) : null}

                    {f.errorMessages && f.errorMessages.length > 0 ? (
                      <p className="mt-2 text-orange-200/80">CCRS said: {f.errorMessages.join(" · ")}</p>
                    ) : null}
                    {iss.length > 0 ? (
                      <details className="mt-1 text-white/55">
                        <summary className="cursor-pointer">{iss.length} row note(s)</summary>
                        <ul className="mt-1 space-y-0.5">
                          {iss.slice(0, 200).map((i, k) => (
                            <li key={k}>
                              • [{i.code === "CCRS_ROW_CONTRADICTS_LEDGER" ? "uncertain" : i.code === "CCRS_ROW_REJECTED" ? "refused" : "note"}] {i.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {f.state === "errored" ? (
                      <p className="mt-1 text-[11px] text-white/50">
                        Fix the refused rows in the app (product, lot, cost, ...). The next export re-sends ONLY what is not on file; rows CCRS
                        accepted are never sent as Insert again.
                      </p>
                    ) : null}
                    {f.state === "reconciling" ? (
                      <p className="mt-1 text-[11px] text-white/50">
                        Nobody can prove which rows landed. Request a copy of the {p.env === "preprod" ? "PREprod" : ""} data from the CCRS Service
                        Desk; these ids are held back from exports until the copy settles them.
                      </p>
                    ) : null}
                    {f.notes ? <p className="mt-1 whitespace-pre-wrap text-[10px] text-white/35">{f.notes}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
