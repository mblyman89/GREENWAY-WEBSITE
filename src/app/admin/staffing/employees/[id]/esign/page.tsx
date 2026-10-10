import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/admin/ux";
import { Button, Field, Input, Select } from "@/components/admin/ui";
import { getEmployeeFile } from "@/lib/staffing/employee-lifecycle-store";
import { ACH_E_TERMS } from "@/lib/payments/ach-esign-terms";
import {
  ESIGN_CONSENT_STATEMENT,
  ESIGN_DISCLOSURE,
  ESIGN_INTENT_STATEMENT,
  ID_TYPES,
  ID_TYPE_LABELS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  esignStep,
} from "@/lib/payments/ach-esign-core";
import { currentDisclosureSha256, getEsignSession, liveEsignSession } from "@/lib/payments/ach-esign-store";
import { cancelEsignAction, sendEsignCodeAction, signEsignAction, startEsignAction, verifyEsignCodeAction } from "./actions";

/**
 * R39 S6 — in-person e-sign of GW-ACH-E on the store device.
 *
 * Owner/admin only (settings.manage). One step at a time:
 *   1. Stephen or Michael checks the photo ID and types the legal name.
 *   2. The employee types their email; a 6-digit code is sent.
 *   3. The employee reads the E-SIGN disclosure, types the code, agrees.
 *   4. The employee reads the terms, types each account twice, types their
 *      name under the intent statement and signs.
 *   5. Done: open / print the signed record.
 * Nothing on this page shows a stored bank number: the numbers are typed
 * fresh by the employee and only ever go to the server in the sign form.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function Notice({ tone, children }: { tone: "ok" | "error" | "info"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : tone === "ok"
        ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
        : "border-white/10 bg-black/20 text-white/70";
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Hidden({ employeeId, sessionId }: { employeeId: string; sessionId?: string }) {
  return (
    <>
      <input type="hidden" name="employee_id" value={employeeId} />
      {sessionId ? <input type="hidden" name="session_id" value={sessionId} /> : null}
    </>
  );
}

function CancelForm({ employeeId, sessionId }: { employeeId: string; sessionId: string }) {
  return (
    <form action={cancelEsignAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
      <Hidden employeeId={employeeId} sessionId={sessionId} />
      <Field label="Cancel this signing (reason)" htmlFor="reason" className="min-w-[16rem] flex-1">
        <Input id="reason" name="reason" minLength={5} maxLength={500} required placeholder="e.g. Employee wants the paper form" />
      </Field>
      <Button type="submit" variant="neutral" size="sm">Cancel signing</Button>
    </form>
  );
}

function AccountRow({ i }: { i: number }) {
  const req = i === 1;
  return (
    <fieldset className="rounded-md border border-white/10 p-3">
      <legend className="px-1 text-xs font-semibold text-white/70">Account {i}{req ? "" : " (optional)"}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Bank or credit union" htmlFor={`a${i}_bank`}><Input id={`a${i}_bank`} name={`a${i}_bank`} autoComplete="off" required={req} /></Field>
        <Field label="Checking or savings" htmlFor={`a${i}_type`}>
          <Select id={`a${i}_type`} name={`a${i}_type`} defaultValue="" required={req}>
            <option value="">Choose</option>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </Select>
        </Field>
        <Field label="Routing number (9 digits)" htmlFor={`a${i}_rtn`}><Input id={`a${i}_rtn`} name={`a${i}_rtn`} inputMode="numeric" autoComplete="off" required={req} /></Field>
        <Field label="Routing number again" htmlFor={`a${i}_rtn2`}><Input id={`a${i}_rtn2`} name={`a${i}_rtn2`} inputMode="numeric" autoComplete="off" required={req} /></Field>
        <Field label="Account number" htmlFor={`a${i}_acct`}><Input id={`a${i}_acct`} name={`a${i}_acct`} inputMode="numeric" autoComplete="off" required={req} /></Field>
        <Field label="Account number again" htmlFor={`a${i}_acct2`}><Input id={`a${i}_acct2`} name={`a${i}_acct2`} inputMode="numeric" autoComplete="off" required={req} /></Field>
        <Field label="How much goes here" htmlFor={`a${i}_how`}>
          <Select id={`a${i}_how`} name={`a${i}_how`} defaultValue={req ? "remainder" : ""}>
            <option value="">Choose</option>
            <option value="remainder">The rest of my net pay</option>
            <option value="fixed">A fixed dollar amount</option>
            <option value="percent">A percentage</option>
          </Select>
        </Field>
        <Field label="Amount ($ or %)" htmlFor={`a${i}_amt`} help="Only for a fixed amount or a percentage.">
          <Input id={`a${i}_amt`} name={`a${i}_amt`} autoComplete="off" placeholder="e.g. 200.00 or 10%" />
        </Field>
      </div>
    </fieldset>
  );
}

export default async function EsignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; done?: string }>;
}) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const employeeId = String(id ?? "").toLowerCase();
  if (!UUID.test(employeeId)) notFound();
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Sign direct deposit form" />
        <div className="px-5 py-6 sm:px-8"><EmptyState title="Supabase not configured" description="Connect the service role key first." /></div>
      </div>
    );
  }
  const file = await getEmployeeFile(employeeId);
  if (!file) notFound();
  const live = await liveEsignSession(employeeId);
  const done = sp.done && UUID.test(sp.done) ? await getEsignSession(sp.done) : null;
  const s = live.session ?? (done && done.employee_id === employeeId ? done : null);
  const step = s ? esignStep(s.state, s.started_at, Date.now()) : null;
  const back = `/admin/staffing/employees/${employeeId}`;

  return (
    <div>
      <AdminPageHeader title="Sign direct deposit form (in person)" subtitle={`${file.employee.full_name} · form ${ACH_E_TERMS.formId} ${ACH_E_TERMS.formRev}`} />
      <div className="mx-auto max-w-3xl space-y-5 px-5 py-6 sm:px-8">
        <Link href={back} className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">← Back to the employee file</Link>
        {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
        {sp.ok ? <Notice tone="ok">{sp.ok}</Notice> : null}
        {!live.ready ? <Notice tone="error">{live.error}</Notice> : null}

        {live.ready && !live.session && !(s && s.state === "signed") ? (
          <Card title="1. Check the photo ID (Stephen or Michael)">
            <p className="mb-3 text-xs text-white/60">
              In person only. Look at the employee&apos;s government photo ID and their face. Record the ID type and only the
              last 4 of the ID number and the expiry date. Never the full number.
            </p>
            <form action={startEsignAction} className="grid gap-3 sm:grid-cols-2">
              <Hidden employeeId={employeeId} />
              <Field label="Employee's full legal name (as on the ID)" htmlFor="legal_name" className="sm:col-span-2">
                <Input id="legal_name" name="legal_name" defaultValue={file.employee.full_name ?? ""} required minLength={3} maxLength={120} autoComplete="off" />
              </Field>
              <Field label="Photo ID type" htmlFor="id_type">
                <Select id="id_type" name="id_type" defaultValue="wa_dl_id" required>
                  {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABELS[t]}</option>)}
                </Select>
              </Field>
              <Field label="ID last 4 and expiry" htmlFor="id_detail" help="For example: 1234 exp 2029-05-01">
                <Input id="id_detail" name="id_detail" required minLength={4} maxLength={40} autoComplete="off" />
              </Field>
              <label className="flex items-start gap-2 text-xs text-white/80 sm:col-span-2">
                <input type="checkbox" name="id_seen" required className="mt-0.5" />
                I checked this photo ID in person, it is not expired, and the photo matches the employee in front of me.
              </label>
              <div className="sm:col-span-2"><Button type="submit" variant="confirm">Start signing</Button></div>
            </form>
          </Card>
        ) : null}

        {s && step === "expired" ? (
          <Card title="This signing has expired">
            <p className="text-xs text-white/60">A signing must be finished within 30 minutes of the ID check. Cancel it, then start again.</p>
            <CancelForm employeeId={employeeId} sessionId={s.id} />
          </Card>
        ) : null}

        {s && (step === "send_code" || step === "enter_code") ? (
          <>
            <Card title="2. Your email (employee)">
              <p className="mb-3 text-xs text-white/60">
                Type an email you can open now on your phone. We send a 6-digit code to it. That shows you can receive and open
                electronic records from Greenway. {s.otp_sends > 0 ? `Sent ${s.otp_sends} of ${OTP_MAX_SENDS} times, last to ${s.email_masked}.` : ""}
              </p>
              <form action={sendEsignCodeAction} className="flex flex-wrap items-end gap-2">
                <Hidden employeeId={employeeId} sessionId={s.id} />
                <Field label="Email" htmlFor="email" className="min-w-[16rem] flex-1">
                  <Input id="email" name="email" type="email" required autoComplete="off" />
                </Field>
                <Button type="submit" variant="primary">{s.otp_sends > 0 ? "Send a new code" : "Send code"}</Button>
              </form>
            </Card>

            {step === "enter_code" ? (
              <Card title="3. Consent to sign electronically (employee)">
                <div className="space-y-2 text-xs leading-relaxed text-white/80">
                  {ESIGN_DISCLOSURE.map((p) => <p key={p.clause}>{p.text}</p>)}
                </div>
                <form action={verifyEsignCodeAction} className="mt-4 space-y-3">
                  <Hidden employeeId={employeeId} sessionId={s.id} />
                  <input type="hidden" name="disclosure_sha256" value={currentDisclosureSha256()} />
                  <Field label="6-digit code from the email" htmlFor="code" help={`${OTP_MAX_ATTEMPTS - s.otp_attempts} tries left.`}>
                    <Input id="code" name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} required autoComplete="one-time-code" />
                  </Field>
                  <label className="flex items-start gap-2 text-xs text-white/80">
                    <input type="checkbox" name="agree" required className="mt-0.5" />
                    {ESIGN_CONSENT_STATEMENT}
                  </label>
                  <Button type="submit" variant="confirm">I agree, continue</Button>
                </form>
              </Card>
            ) : null}
            <CancelForm employeeId={employeeId} sessionId={s.id} />
          </>
        ) : null}

        {s && step === "sign" ? (
          <Card title="4. Read the terms, enter your accounts, sign (employee)">
            <details className="mb-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-white/80" open>
              <summary className="cursor-pointer font-semibold text-white">Terms and conditions (Parts 4 and 5 of the form)</summary>
              <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-2">
                {ACH_E_TERMS.wac.map((w, i) => <p key={`w${i}`} className="text-white/60">{w}</p>)}
                {ACH_E_TERMS.terms.map((t, i) => (t.k === "h" ? <h3 key={i} className="pt-2 font-semibold text-white">{t.t}</h3> : <p key={i}>{t.t}</p>))}
              </div>
            </details>
            <form action={signEsignAction} className="space-y-3">
              <Hidden employeeId={employeeId} sessionId={s.id} />
              <AccountRow i={1} />
              <AccountRow i={2} />
              <AccountRow i={3} />
              <label className="flex items-start gap-2 text-xs text-white/80">
                <input type="checkbox" name="replace_open" className="mt-0.5" />
                Replace the current direct deposit authorization, if there is one (it is archived and kept, never deleted).
              </label>
              <p className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/80">{ACH_E_TERMS.acknowledgment}</p>
              <p className="text-xs text-white/80">{ESIGN_INTENT_STATEMENT}</p>
              <Field label="Type your full legal name to sign" htmlFor="typed_name" help={`Must match: ${s.legal_name}`}>
                <Input id="typed_name" name="typed_name" required autoComplete="off" />
              </Field>
              <label className="flex items-start gap-2 text-xs text-white/80">
                <input type="checkbox" name="intent" required className="mt-0.5" />
                I intend the name I typed to be my signature.
              </label>
              <Button type="submit" variant="confirm">Sign</Button>
            </form>
            <CancelForm employeeId={employeeId} sessionId={s.id} />
          </Card>
        ) : null}

        {s && s.state === "signed" ? (
          <Card title="5. Signed">
            <p className="text-xs text-white/70">
              The signed record and its signing certificate are filed in this employee&apos;s file and the vault. The employee can
              open or print their copy now, or ask for a paper copy at any time, free of charge.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button href={`/admin/staffing/employees/${employeeId}/esign/record?session=${s.id}`} variant="primary" target="_blank" rel="noopener">
                Open / print the signed record
              </Button>
              <Button href={back} variant="neutral">Back to the employee file</Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
