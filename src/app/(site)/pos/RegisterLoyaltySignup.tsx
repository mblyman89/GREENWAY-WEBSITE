"use client";

/**
 * REGISTER LOYALTY SIGNUP: sign a new loyalty customer up from the sale.
 *
 * The owner, verbatim: "I need a way to sign up new loyalty customers from the
 * iPad register. ... Make sure to include anything and everything to make the
 * process simple and powerful."
 *
 * One sheet, opened from the customer band ("Sign up for loyalty"), shared by
 * the web register and the iPad app (both mount RegisterShell -> SaleFlow):
 *
 *   - Names come from the scanned ID (title-cased), or from what was typed in
 *     the customer search. The birthday comes from THIS sale's ID check and is
 *     locked: no typing, no typos, and next visit the scan auto-attaches the
 *     member by name + birthday (AO-3).
 *   - Phone (formatted as you type) and/or email.
 *   - The live program terms (earn rate, signup bonus) so the budtender can
 *     pitch it in one breath.
 *   - Text/email messages are OPTIONAL and start unchecked. Saying yes shows
 *     the exact published consent wording and the customer types their name
 *     (47 CFR 64.1200(f)(9) prior express written consent). The server checks
 *     the wording shown is the wording published.
 *   - Before anything is saved the server looks for an existing account
 *     (phone, email, name + birthday). The budtender taps "Use this account"
 *     or "Create new anyway".
 *   - Success attaches the member to the sale, so this purchase earns points.
 *
 * Everything is decided on the server (/api/pos/loyalty-signup); this screen
 * only collects and shows. A retry re-sends the same request id, so a dropped
 * reply never creates a second account.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatPhoneInput,
  initialSignupNames,
  signupBlocker,
  type FieldErrors,
  type RegisterSignupApi,
  type RegisterSignupDuplicate,
  type RegisterSignupFormContent,
  type RegisterSignupMember,
} from "@/lib/pos/register-loyalty-signup-core";

export type RegisterLoyaltySignupProps = {
  api: RegisterSignupApi;
  /** This sale's passing ID verdict (the birthday source). */
  verdict: { method: "scan" | "manual"; dateOfBirth: string; age: number };
  /** Names parsed from the scanned ID (null for a hand-checked ID). */
  scannedName: { firstName: string | null; lastName: string | null } | null;
  /** What the customer search had (phone / email / name). */
  searchPrefill: { phone?: string; email?: string; firstName?: string; lastName?: string };
  employeeName: string;
  /** Attach the member to the sale. */
  onSignedUp: (member: RegisterSignupMember) => void;
  onClose: () => void;
};

function dobLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  // Noon UTC so the calendar day never shifts with the device time zone.
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const input =
  "w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-base text-[var(--pos-text)]";
const label = "mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--pos-text-faint)]";
const btn =
  "pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold text-[var(--pos-text)] disabled:opacity-40";
const primary =
  "pos-tile min-h-12 rounded-lg bg-[var(--pos-accent)] px-5 py-2.5 text-base font-bold text-[var(--pos-accent-ink)] disabled:opacity-40";

export function RegisterLoyaltySignup({ api, verdict, scannedName, searchPrefill, employeeName, onSignedUp, onClose }: RegisterLoyaltySignupProps) {
  // One id per opened form: every retry re-sends it (server idempotency).
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const start = useMemo(() => initialSignupNames(scannedName, searchPrefill), [scannedName, searchPrefill]);
  const [firstName, setFirstName] = useState(start.firstName);
  const [lastName, setLastName] = useState(start.lastName);
  const [phone, setPhone] = useState(searchPrefill.phone ?? "");
  const [email, setEmail] = useState(searchPrefill.email ?? "");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [signature, setSignature] = useState("");

  const [form, setForm] = useState<RegisterSignupFormContent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [duplicates, setDuplicates] = useState<RegisterSignupDuplicate[] | null>(null);
  const [dupMessage, setDupMessage] = useState<string>("");
  const [done, setDone] = useState<{ member: RegisterSignupMember; message: string } | null>(null);
  const [loadTick, setLoadTick] = useState(0);

  // The shell rebuilds `api` on each render; load only on open and on retry.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });
  useEffect(() => {
    let live = true;
    void apiRef.current.load().then((res) => {
      if (!live) return;
      if (res.ok) {
        setForm(res.form);
        setFormError(null);
      } else {
        setFormError(res.error);
      }
    });
    return () => {
      live = false;
    };
  }, [loadTick]);

  // Any edit after the duplicate list makes the list stale.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDuplicates(null);
    setError(null);
  };

  const blocker = signupBlocker({ firstName, lastName, phone, email, marketingConsent, signature, consentLoaded: !!form });

  const send = async (choice: { useExistingCustomerId?: string; createAnyway?: boolean } = {}) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    const res = await api.submit({
      clientRequestId,
      firstName,
      lastName,
      dateOfBirth: verdict.dateOfBirth,
      dobSource: verdict.method,
      phone,
      email,
      marketingConsent,
      consentTextSha256: marketingConsent ? (form?.consentTextSha256 ?? "") : "",
      signature: marketingConsent ? signature : "",
      employeeName,
      ...choice,
    });
    setBusy(false);
    if (res.kind === "ok") {
      onSignedUp(res.member);
      setDone({ member: res.member, message: res.message });
      return;
    }
    if (res.kind === "duplicates") {
      setDuplicates(res.matches);
      setDupMessage(res.message);
      return;
    }
    if (res.kind === "consent_changed") {
      // Show the new wording; the customer must read it and sign again.
      setForm((f) => (f ? { ...f, consentText: res.consentText, consentTextSha256: res.consentTextSha256 } : f));
      setSignature("");
      setError(res.error);
      return;
    }
    setError(res.error);
    setFields(res.fields);
  };

  const fieldError = (k: keyof FieldErrors) =>
    fields[k] ? <p className="mt-1 text-xs font-semibold text-[var(--pos-danger,#dc2626)]">{fields[k]}</p> : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] *:my-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Sign up for loyalty"
    >
      <div className="pos-shell w-full max-w-2xl rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-[var(--pos-text)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">⭐ Sign up for loyalty</h2>
          <button type="button" onClick={onClose} className={btn}>
            {done ? "Done" : "✕ Close"}
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] p-4">
              <p className="text-lg font-bold text-[var(--pos-accent)]">★ {done.member.label}</p>
              <p className="mt-1 text-sm">{done.message}</p>
              <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
                Next visit: scan their ID and the account attaches by itself, or search by phone or email.
              </p>
            </div>
            <button type="button" onClick={onClose} className={`${primary} w-full`}>
              Back to the sale
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Program pitch: live terms from the loyalty config. */}
            {form ? (
              <div className="rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-4 py-3 text-sm">
                {form.terms.signupBonusLine ? <p className="font-bold text-[var(--pos-warn)]">{form.terms.signupBonusLine}</p> : null}
                <p className="text-[var(--pos-text-muted)]">
                  {[form.terms.earnLine, form.terms.valueLine].filter(Boolean).join(" ")}
                </p>
              </div>
            ) : formError ? (
              <div className="rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-4 py-3 text-sm">
                <p className="text-[var(--pos-warn)]">{formError}</p>
                <button type="button" className={`${btn} mt-2`} onClick={() => setLoadTick((n) => n + 1)}>
                  Try again
                </button>
              </div>
            ) : (
              <p className="text-sm text-[var(--pos-text-muted)]">Loading the program terms…</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="ls-first">First name</label>
                <input id="ls-first" className={input} value={firstName} autoComplete="off" autoCapitalize="words" onChange={(e) => edit(setFirstName)(e.target.value)} />
                {fieldError("firstName")}
              </div>
              <div>
                <label className={label} htmlFor="ls-last">Last name</label>
                <input id="ls-last" className={input} value={lastName} autoComplete="off" autoCapitalize="words" onChange={(e) => edit(setLastName)(e.target.value)} />
                {fieldError("lastName")}
              </div>
            </div>

            <div>
              <span className={label}>Birthday</span>
              <p className="rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-3 text-base">
                🔒 {dobLabel(verdict.dateOfBirth)} · age {verdict.age}
                <span className="ml-2 text-xs text-[var(--pos-text-faint)]">
                  from the {verdict.method === "scan" ? "scanned" : "hand-checked"} ID
                </span>
              </p>
              {fieldError("dateOfBirth")}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="ls-phone">Mobile phone</label>
                <input
                  id="ls-phone"
                  className={input}
                  value={phone}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(360) 555-0101"
                  onChange={(e) => edit(setPhone)(formatPhoneInput(e.target.value))}
                />
                {fieldError("phone")}
              </div>
              <div>
                <label className={label} htmlFor="ls-email">Email</label>
                <input
                  id="ls-email"
                  className={input}
                  value={email}
                  inputMode="email"
                  type="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="name@example.com"
                  onChange={(e) => edit(setEmail)(e.target.value.trim())}
                />
                {fieldError("email")}
              </div>
            </div>
            <p className="-mt-2 text-xs text-[var(--pos-text-faint)]">Phone or email (either one) finds the account next time.</p>
            {fieldError("contact")}

            {/* Optional message consent (TCPA prior express written consent). */}
            <div className="rounded-xl border border-[var(--pos-border)] p-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-6 w-6 shrink-0"
                  checked={marketingConsent}
                  onChange={(e) => {
                    setMarketingConsent(e.target.checked);
                    if (!e.target.checked) setSignature("");
                  }}
                />
                <span className="text-sm">
                  <span className="font-semibold">Customer wants deals by text and email</span>
                  <span className="block text-xs text-[var(--pos-text-muted)]">
                    Optional. Not needed to join or to buy. Let the customer read the wording and sign themselves.
                  </span>
                </span>
              </label>
              {marketingConsent ? (
                <div className="mt-2 space-y-2">
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--pos-surface-2)] p-3 text-xs leading-relaxed">
                    {form ? form.consentText : "Loading the consent wording…"}
                  </p>
                  <label className={label} htmlFor="ls-sig">Customer signature: type full name</label>
                  <input
                    id="ls-sig"
                    className={`${input} italic`}
                    value={signature}
                    autoComplete="off"
                    autoCapitalize="words"
                    placeholder={`${firstName} ${lastName}`.trim() || "Full name"}
                    onChange={(e) => setSignature(e.target.value)}
                  />
                  {fieldError("signature")}
                  {fieldError("consent")}
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] p-3 text-sm font-semibold text-[var(--pos-warn)]">
                {error}
              </p>
            ) : null}

            {duplicates ? (
              <div className="rounded-xl border-2 border-[var(--pos-warn-border)] p-3">
                <p className="text-sm font-bold text-[var(--pos-warn)]">{dupMessage}</p>
                <ul className="mt-2 space-y-2">
                  {duplicates.map((d) => (
                    <li key={d.customerId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--pos-surface-2)] p-3">
                      <span className="text-sm">
                        <span className="font-semibold">{d.fullName}</span>
                        <span className="block text-xs text-[var(--pos-text-muted)]">Same {d.reasons.join(" · ")}</span>
                      </span>
                      <button type="button" disabled={busy} className={primary} onClick={() => void send({ useExistingCustomerId: d.customerId })}>
                        Use this account
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" disabled={busy} className={`${btn} mt-3 w-full`} onClick={() => void send({ createAnyway: true })}>
                  Not them: create a new account anyway
                </button>
              </div>
            ) : (
              <div>
                <button type="button" disabled={busy || !!blocker} className={`${primary} w-full`} onClick={() => void send()}>
                  {busy ? "Signing up…" : "Sign up and attach to this sale"}
                </button>
                {blocker ? <p className="mt-1 text-center text-xs text-[var(--pos-text-faint)]">{blocker}</p> : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
