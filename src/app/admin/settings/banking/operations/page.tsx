/**
 * R39 S7 part 2 — Banking → Operations (/admin/settings/banking/operations).
 *
 * The day-to-day ACH work that migration 0263 records, on one page, in order
 * of urgency:
 *   1. Returns and bank corrections (R / C codes) from Timberland: log them
 *      (the money stops at once), then resolve with a note.
 *   2. Employee holds: release after a callback (two-person rule).
 *   3. Account checks: prenote or test credit (owner Q3), or a callback.
 *   4. Annual reviews (Nacha Phase 2: at least once a year).
 *   5. Test-credit monitoring (Nacha Micro-Entries Phase 2).
 *   6. Records: retention and legal hold (owner Q7/Q8: archive, never delete).
 *   7. R41 S3: released ACH files (ach_files, 0273): download the stored
 *      bytes, void with a reason (owner). Kept forever.
 *      R41 S6 (0274): Mark uploaded / Mark approved record the two steps at
 *      Timberland (owner; an admin's press is a request), the checklist card,
 *      and the grey dual-approval line (never red; logged yearly dismiss).
 *
 * Owner/admin only (settings.manage). The page shows last-4 only; test-credit
 * amounts are never shown (the person must read them back).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { BankingHelpTabs } from "../BankingHelpTabs";
import { pacificToday } from "@/lib/reports/timezone";
import { listEmployees } from "@/lib/staffing/store";
import { listVendors } from "@/lib/vendors/store";
import { resolveStaffNames } from "@/lib/promotions/promotions-store";
import { ACH_CODES } from "@/lib/payments/ach-authorization-core";
import { checkEffectiveDate, checkEffectiveDateForRelease, defaultCheckEffectiveDate } from "@/lib/payments/ach-ops-core";
import { checkFileSourceId, checkListFingerprint, opsPageView } from "@/lib/payments/ach-ops-store";
import { listAchFiles } from "@/lib/payments/ach-file-ledger-store";
import { dismissDualApprovalNoteAction, markAchFileBankApprovedAction, markAchFileUploadedAction, voidAchFileAction } from "../file-actions";
import { getDualNoteDismiss } from "@/lib/payments/ach-guide-store";
import { BANK_STEP_CHECKLIST, DUAL_APPROVAL_NOTE, bankStepButton, bankStepLine, dualNoteVisible } from "@/lib/payments/timberland-bank-steps-core";
import { monitorSummary, noticeUrgencyLabel, releaseHint } from "@/lib/payments/ach-ops-ui-core";
import {
  finishCheckAction,
  logNoticeAction,
  markCheckFileSentAction,
  releaseCheckFileAction,
  releaseEmployeeHoldAction,
  resolveNoticeAction,
  reviewDoneAction,
  setLegalHoldAction,
  startCheckAction,
} from "../ops-actions";

export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";
const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";

const METHOD_WORDS = { prenote: "Prenote ($0)", micro_entry: "Test credit (under $1)", voided_check_callback: "Callback (voided check)" } as const;

export default async function AchOperationsPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; eff?: string }> }) {
  const session = await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const [view, employees, vendors, files, dualNote] = await Promise.all([opsPageView(today), listEmployees({ includeInactive: true }), listVendors(), listAchFiles(50), getDualNoteDismiss()]);
  const isOwner = session.profile.role === "owner";
  const showDualNote = dualNoteVisible(dualNote.dismiss, today);
  const liveBySource = new Map(files.rows.filter((f) => f.status !== "voided").map((f) => [`${f.kind}|${f.source_id}`, f]));
  // R41 S5: Timberland's deadline (2 usable banking days, 4:00 pm Pacific) decides the default and what is allowed.
  //    The date in the address only has to be a real future banking day, so a
  //    file released in time can still be downloaded and confirmed after the
  //    cutoff; the timed check decides whether "Release the file" is offered.
  const now = new Date();
  const effChecked = checkEffectiveDate(sp.eff ?? "", today);
  const effective = effChecked.ok ? effChecked.date : defaultCheckEffectiveDate(now);
  const effTimely = checkEffectiveDateForRelease(effective, now);
  const effError = sp.eff && !effChecked.ok ? effChecked.error : null;
  const staff = await resolveStaffNames(
    [...view.holds.map((h) => h.hold_entered_by), ...files.rows.flatMap((f) => [f.uploaded_by, f.approved_at_bank_by])].filter((x): x is string => Boolean(x)),
  );
  const sentChecks = view.checks.filter((c) => c.open?.status === "sent");
  const mon = monitorSummary(view.monitor);
  const codes = Object.entries(ACH_CODES);

  return (
    <div>
      <AdminPageHeader
        title="ACH operations"
        subtitle="Returns and bank corrections, employee holds, account checks, annual reviews and record keeping. Owner/admin only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Operations" }]} />}
        help={
          <HelpPanel
            id="ach-operations"
            title="What this page is for"
            steps={[
              "When Timberland reports a returned payment (R code) or a bank correction (C code), log it here the same day. The payee's banking goes on hold at once, and Stephen, Michael and the store are emailed.",
              "Call the payee only at a number already on file, never one from an email or the notice. Fix the details, then resolve the notice with a note.",
              "A new employee account is checked before real pay goes to it: a prenote ($0) or a test credit (a few cents they read back to you).",
              "Release the check file (once; it gets the day's next File ID Modifier), download it, upload it to Timberland, then tick the box to say it was uploaded. Every download is the same bytes.",
              "Every active authorization is reviewed at least once a year. Records are archived, never deleted; a legal hold keeps one past its normal keep period.",
            ]}
          >
            <p>Nacha rules require prompt action on returns and corrections (a correction within 6 banking days), a yearly review of these controls, and monitoring of test-credit volumes. The database refuses any step out of order, even if this page had a bug.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}
        {!view.ready || view.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">{view.error}</p> : null}
        <p className="text-xs text-white/40">
          <Link href="/admin/settings/banking" className="hover:underline">← Back to Banking</Link> · Today (Pacific): {today}
        </p>
        <div className="flex flex-wrap gap-2">
          <BankingHelpTabs />
        </div>

        {/* 1. Notices */}
        <section id="notices" className={card}>
          <h2 className={h2}>Returns and bank corrections ({view.notices.length} open)</h2>
          {view.notices.length ? (
            <ul className="mb-4 space-y-3">
              {view.notices.map((n) => {
                const u = noticeUrgencyLabel(n, today);
                return (
                  <li key={n.id} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm text-white/80">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone={u.tone}>{u.text}</Badge>
                      <span className="font-semibold">{n.code}</span>
                      <span>{ACH_CODES[n.code]?.label ?? "Unknown code"}</span>
                      <span className="text-white/50">· {n.payee} ({n.payee_type}) · received {n.received_on}</span>
                      {n.corrected_last4 ? <span className="text-white/50">· corrected value ends {n.corrected_last4}</span> : null}
                      <span className="text-white/50">· hold: {n.hold_applied ?? "-"}</span>
                    </div>
                    <form action={resolveNoticeAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="notice_id" value={n.id} />
                      <input name="note" required minLength={10} maxLength={500} placeholder="What was done (10+ characters, no account numbers)" className={`${inputCls} max-w-xl`} />
                      <button className={btnGhost}>Resolve</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-white/50">No open notices.</p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-emerald-300">Log a notice from Timberland</summary>
            <form action={logNoticeAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelCls}>Who was it for</span>
                <select name="payee" required className={inputCls} defaultValue="">
                  <option value="" disabled>Pick a payee</option>
                  <optgroup label="Employees">
                    {employees.map((e) => <option key={e.id} value={`employee:${e.id}`}>{e.full_name}</option>)}
                  </optgroup>
                  <optgroup label="Vendors">
                    {vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.display_name}</option>)}
                  </optgroup>
                </select>
              </label>
              <label>
                <span className={labelCls}>Code (R or C and two digits)</span>
                <input name="code" required list="ach-codes" pattern="[RCrc][0-9]{2}" placeholder="R03 or C01" className={inputCls} />
                <datalist id="ach-codes">{codes.map(([c, v]) => <option key={c} value={c}>{v.label}</option>)}</datalist>
              </label>
              <label>
                <span className={labelCls}>Date on the notice</span>
                <input type="date" name="received_on" required max={today} defaultValue={today} className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>Payment settlement date (optional)</span>
                <input type="date" name="settlement_date" max={today} className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>Amount (optional)</span>
                <input name="amount" inputMode="decimal" placeholder="1234.56" className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>Trace number (optional, 15 digits)</span>
                <input name="trace" inputMode="numeric" pattern="[0-9 ]{15,19}" className={inputCls} />
              </label>
              <label className="sm:col-span-2">
                <span className={labelCls}>Corrected information (C codes only; it is encrypted)</span>
                <input name="corrected" autoComplete="off" placeholder="For C01: the corrected account number. Leave blank for an R code." className={inputCls} />
              </label>
              {sentChecks.length ? (
                <label className="sm:col-span-2">
                  <span className={labelCls}>Is this the answer to an account check? (optional)</span>
                  <select name="verification" className={inputCls} defaultValue="">
                    <option value="">No</option>
                    {sentChecks.map((c) => <option key={c.open!.id} value={c.open!.id}>{c.payee} · account ending {c.accountLast4} · {METHOD_WORDS[c.open!.method]}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="sm:col-span-2">
                <button className={btnPrimary}>Log it and put the banking on hold</button>
              </div>
            </form>
          </details>
        </section>

        {/* 2. Employee holds */}
        <section id="holds" className={card}>
          <h2 className={h2}>Employee holds ({view.holds.length})</h2>
          <p className="mb-3 text-xs text-white/50">Vendor holds are released on the Vendors tab of Banking, with the callback.</p>
          {view.holds.length ? (
            <ul className="space-y-3">
              {view.holds.map((h) => (
                <li key={h.id} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm text-white/80">
                  <p className="font-semibold">{h.payee_name}</p>
                  <p className="text-xs text-white/50">
                    {h.hold_reason ?? "No reason recorded"} · put on hold by {h.hold_entered_by ? staff.get(h.hold_entered_by) ?? "a staff member" : "unknown"}
                    {h.hold_entered_at ? ` on ${h.hold_entered_at.slice(0, 10)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-amber-200">{releaseHint(session.profile.role === "owner")}</p>
                  <form action={releaseEmployeeHoldAction} className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
                    <input type="hidden" name="auth_id" value={h.id} />
                    <select name="method" required className={inputCls} defaultValue="">
                      <option value="" disabled>How confirmed</option>
                      <option value="phone">By phone (number on file)</option>
                      <option value="in_person">In person</option>
                    </select>
                    <input name="note" required minLength={10} maxLength={500} placeholder="Who confirmed what (10+ characters)" className={inputCls} />
                    <input name="reason" maxLength={500} placeholder="Reason (optional)" className={inputCls} />
                    <button className={btnGhost}>{session.profile.role === "owner" ? "Release" : "Send release to Michael"}</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">No employee is on hold.</p>
          )}
        </section>

        {/* 3. Account checks */}
        <section id="checks" className={card}>
          <h2 className={h2}>Account checks ({view.checks.length})</h2>
          {view.checks.length ? (
            <table className="mb-4 w-full text-left text-sm">
              <thead className="text-xs text-white/40">
                <tr>
                  <th className="py-2 pr-3 font-medium">Payee / account</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {view.checks.map((c) => (
                  <tr key={c.accountId} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-3">
                      {c.payee}
                      <span className="block text-xs text-white/40">{c.accountType} ending {c.accountLast4}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {c.open ? `${METHOD_WORDS[c.open.method]}: ${c.open.status}` : c.verificationStatus}
                      {c.authState === "on_hold" ? <span className="block text-amber-300">on hold</span> : null}
                    </td>
                    <td className="py-2 text-xs">
                      {!c.open ? (
                        c.authState === "on_hold" ? (
                          <span className="text-white/50">Release the hold first.</span>
                        ) : (
                          <form action={startCheckAction} className="flex flex-wrap gap-2">
                            <input type="hidden" name="account_id" value={c.accountId} />
                            <select name="method" className={`${inputCls} max-w-[14rem]`} defaultValue="prenote">
                              <option value="prenote">{METHOD_WORDS.prenote}</option>
                              <option value="micro_entry">{METHOD_WORDS.micro_entry}</option>
                              <option value="voided_check_callback">{METHOD_WORDS.voided_check_callback}</option>
                            </select>
                            <button className={btnGhost}>Start check</button>
                          </form>
                        )
                      ) : (
                        <div className="space-y-2">
                          <p>{c.open.step.text}</p>
                          {c.open.step.kind === "pass_prenote" || c.open.step.kind === "ask_amount" || c.open.step.kind === "call" ? (
                            <form action={finishCheckAction} className="flex flex-wrap gap-2">
                              <input type="hidden" name="verification_id" value={c.open.id} />
                              <input type="hidden" name="outcome" value="passed" />
                              {c.open.step.kind === "ask_amount" ? <input name="confirmed" required inputMode="decimal" placeholder="Amount they read, e.g. 0.37" className={`${inputCls} max-w-[12rem]`} /> : null}
                              <input name="note" minLength={c.open.step.kind === "call" ? 10 : 0} maxLength={500} placeholder={c.open.step.kind === "call" ? "Who confirmed and how (10+)" : "Note (optional)"} className={`${inputCls} max-w-xs`} />
                              <button className={btnGhost}>Mark passed</button>
                            </form>
                          ) : null}
                          <details>
                            <summary className="cursor-pointer text-white/50">Fail or cancel</summary>
                            <form action={finishCheckAction} className="mt-2 flex flex-wrap gap-2">
                              <input type="hidden" name="verification_id" value={c.open.id} />
                              <select name="outcome" className={`${inputCls} max-w-[10rem]`} defaultValue="failed">
                                <option value="failed">Failed</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                              <input name="note" required minLength={5} maxLength={500} placeholder="Why (5+ characters)" className={`${inputCls} max-w-xs`} />
                              <button className={btnGhost}>Record</button>
                            </form>
                          </details>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mb-4 text-sm text-white/50">Every live account is verified.</p>
          )}

          <div className="rounded-[var(--admin-radius)] border border-white/10 p-3">
            <p className="mb-2 text-sm font-semibold text-white">Check files for Timberland</p>
            <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
              <label>
                <span className={labelCls}>Effective date (a banking day)</span>
                <input type="date" name="eff" defaultValue={effective} min={today} className={inputCls} />
              </label>
              <button className={btnGhost}>Use this date</button>
            </form>
            {effError ? <p role="alert" className="mb-2 text-xs text-red-300">{effError} Using {effective}.</p> : null}
            {effTimely.ok ? (
              <p className={`mb-2 text-xs ${effTimely.warning ? "text-amber-300" : "text-white/60"}`}>
                {effTimely.warning ?? `Upload and approve at Timberland by ${effTimely.uploadBy}.`}
              </p>
            ) : (
              <p role="alert" className="mb-2 text-xs text-red-300">
                New files cannot use {effective}: {effTimely.error}
              </p>
            )}
            {(["prenote", "micro_entry"] as const).map((m) => {
              const ids = view.planned[m];
              if (!ids.length) return <p key={m} className="text-xs text-white/50">{m === "prenote" ? "No prenotes" : "No test credits"} waiting.</p>;
              const fp = checkListFingerprint(ids);
              const href = `/admin/settings/banking/operations/check-file?method=${m}&effective=${effective}&fp=${fp}`;
              const live = liveBySource.get(`${m}|${checkFileSourceId(m, effective, fp)}`);
              return (
                <div key={m} className="mb-3 space-y-2 text-sm">
                  <p>
                    {ids.length} {m === "prenote" ? "prenote" : "test credit"}
                    {ids.length === 1 ? "" : "s"} waiting, effective {effective}.{" "}
                    {live ? (
                      <a href={href} className="font-semibold text-emerald-300 hover:underline">Download {live.filename} (File ID {live.file_id_modifier})</a>
                    ) : (
                      <span className="text-white/50">Not released yet.</span>
                    )}
                  </p>
                  {!live && effTimely.ok ? (
                    <form action={releaseCheckFileAction} className="flex flex-wrap items-center gap-2 text-xs">
                      <input type="hidden" name="method" value={m} />
                      <input type="hidden" name="effective" value={effective} />
                      <input type="hidden" name="fp" value={fp} />
                      <button className={btnGhost}>Release the file</button>
                    </form>
                  ) : null}
                  <form action={markCheckFileSentAction} className="flex flex-wrap items-center gap-2 text-xs">
                    <input type="hidden" name="method" value={m} />
                    <input type="hidden" name="effective" value={effective} />
                    <input type="hidden" name="fp" value={fp} />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="confirm" value="yes" required /> I uploaded this file to Timberland
                    </label>
                    <button className={btnGhost}>Confirm sent</button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>

        {/* 4. Annual reviews */}
        <section id="reviews" className={card}>
          <h2 className={h2}>Annual reviews ({view.reviews.length} due)</h2>
          {view.reviews.length ? (
            <ul className="space-y-3">
              {view.reviews.map((r) => (
                <li key={r.id} className="text-sm text-white/80">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === "due_soon" ? "orange" : "danger"}>
                      {r.status === "missing_date" ? "No date set" : r.status === "overdue" ? `Overdue ${-(r.days ?? 0)} days` : `Due in ${r.days} days`}
                    </Badge>
                    <span className="font-semibold">{r.payee}</span>
                    {r.annual_review_due_on ? <span className="text-xs text-white/50">due {r.annual_review_due_on}</span> : null}
                  </div>
                  <form action={reviewDoneAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="auth_id" value={r.id} />
                    <input name="note" required minLength={10} maxLength={500} placeholder="What was checked (10+ characters)" className={`${inputCls} max-w-xl`} />
                    <button className={btnGhost}>Review done</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">Nothing due in the next 30 days.</p>
          )}
        </section>

        {/* 5. Monitoring */}
        <section id="monitor" className={card}>
          <h2 className={h2}>Test-credit monitoring</h2>
          <p className="text-sm text-white/80">{mon.headline}</p>
          {view.monitor.flags.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-200">
              {view.monitor.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-white/50">Nothing unusual.</p>
          )}
        </section>

        {/* 7. Released ACH files (R41 S3) */}
        <section id="files" className={card}>
          <h2 className={h2}>Released ACH files ({files.rows.length})</h2>
          <p className="mb-3 text-xs text-white/50">
            Every file the site released, kept forever. A download is always the same bytes, checked against their fingerprint first. A voided file is never served again and its File ID Modifier is never reused that day.
          </p>
          {showDualNote ? (
            <div id="dual-approval-note" className="mb-3 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
              <p>{DUAL_APPROVAL_NOTE}</p>
              {isOwner ? (
                <form action={dismissDualApprovalNoteAction} className="mt-1">
                  <button className="text-xs font-semibold text-white/60 underline hover:text-white/80">Don&apos;t show again this year</button>
                </form>
              ) : null}
            </div>
          ) : null}
          <details id="bank-steps" className="mb-3 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-white/70">
            <summary className="cursor-pointer font-semibold text-white">Sending a file to Timberland: the checklist</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
              {BANK_STEP_CHECKLIST.map((c) => <li key={c.id}>{c.text}</li>)}
            </ol>
            <p className="mt-2 text-xs text-white/50">All of it before the upload deadline shown when the file was released (2 banking days before the effective date, 4:00 pm Pacific; we aim for 3:30 pm).</p>
          </details>
          {!files.tableReady ? <p className="text-sm text-amber-200">The ACH file ledger is not set up yet: run migration 0273 (docs/MIGRATIONS_TO_RUN.md).</p> : null}
          {files.error ? <p role="alert" className="text-sm text-red-300">{files.error}</p> : null}
          {files.rows.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-white/40">
                <tr><th className="py-1">File</th><th>Day / ID</th><th>Effective</th><th>Entries</th><th>Total</th><th>Status</th><th></th></tr>
              </thead>
              <tbody className="text-white/80">
                {files.rows.map((f) => (
                  <tr key={f.id} className="border-t border-white/5 align-top">
                    <td className="py-2">{f.filename}<div className="text-xs text-white/40">{f.kind.replace("_", " ")} · sha256 {f.sha256.slice(0, 12)}…</div></td>
                    <td>{f.file_date} {f.file_id_modifier}</td>
                    <td>{f.effective_date}</td>
                    <td>{f.entry_count}</td>
                    <td>${(Number(f.total_cents) / 100).toFixed(2)}</td>
                    <td>{f.status === "voided" ? <Badge tone="danger">voided</Badge> : <Badge tone="green">{f.status.replace("_", " ")}</Badge>}{f.voided_reason ? <div className="text-xs text-white/40">{f.voided_reason}</div> : null}{(() => { const line = bankStepLine(f, (id) => staff.get(id) ?? "a staff member"); return line ? <div className="text-xs text-white/40">{line}</div> : null; })()}</td>
                    <td className="space-y-2">
                      {f.status !== "voided" ? (
                        <>
                          <a href={`/admin/settings/banking/files/${f.id}/download`} className="block text-xs font-semibold text-emerald-300 hover:underline">Download</a>
                          {(() => {
                            const b = bankStepButton(f.status, isOwner);
                            if (!b) return null;
                            return (
                              <form action={b.step === "uploaded" ? markAchFileUploadedAction : markAchFileBankApprovedAction} className="flex flex-col gap-1 text-xs">
                                <input type="hidden" name="file_id" value={f.id} />
                                <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" required /> {b.confirm}</label>
                                <button className={btnPrimary}>{b.label}</button>
                              </form>
                            );
                          })()}
                          <form action={voidAchFileAction} className="flex flex-col gap-1 text-xs">
                            <input type="hidden" name="file_id" value={f.id} />
                            <input name="reason" required minLength={10} maxLength={500} placeholder="Why void it (10+ characters)" className={inputCls} />
                            <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" required /> This file must never be uploaded</label>
                            <button className={btnGhost}>Void</button>
                          </form>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : files.tableReady ? <p className="text-sm text-white/50">No files released yet.</p> : null}
        </section>

        {/* 6. Records */}
        <section id="records" className={card}>
          <h2 className={h2}>Records and legal hold ({view.records.length})</h2>
          <p className="mb-3 text-xs text-white/50">Authorizations are archived, never deleted. A legal hold keeps a record until it is taken off.</p>
          <table className="w-full text-left text-sm">
            <tbody className="text-white/80">
              {view.records.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="py-2 pr-3">
                    {r.payee_name}
                    <span className="block text-xs text-white/40">{r.payee_type} · {r.state.replace("_", " ")}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {r.legal_hold ? <Badge tone="gold">Legal hold</Badge> : null} {r.retention}
                    {r.legal_hold && r.legal_hold_reason ? <span className="block text-white/40">{r.legal_hold_reason}</span> : null}
                  </td>
                  <td className="py-2 text-xs">
                    <form action={setLegalHoldAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="auth_id" value={r.id} />
                      <input type="hidden" name="on" value={r.legal_hold ? "false" : "true"} />
                      <input name="reason" required minLength={10} maxLength={500} placeholder={r.legal_hold ? "Why it is lifted (10+)" : "Matter or who asked (10+)"} className={`${inputCls} max-w-[16rem]`} />
                      <button className={btnGhost}>{r.legal_hold ? "Lift legal hold" : "Put on legal hold"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
