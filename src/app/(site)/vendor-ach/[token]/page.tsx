import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ACH_V_TERMS } from "@/lib/payments/vendor-esign-terms";
import {
  ENTITY_LABELS,
  ENTITY_TYPES,
  GREENWAY_CONTACTS,
  PROOF_KINDS,
  PROOF_LABELS,
  VENDOR_CONSENT_STATEMENT,
  VENDOR_ESIGN_DISCLOSURE,
  VENDOR_INTENT_STATEMENT,
  VENDOR_KINDS,
  VENDOR_KIND_LABELS,
  OTP_RESEND_COOLDOWN_MS,
  isTokenShape,
} from "@/lib/payments/vendor-esign-core";
import { isCookieShape } from "@/lib/payments/vendor-esign-app-core";
import { browserMatches, vendorPageView } from "@/lib/payments/vendor-esign-store";
import { sendVendorCodeAction, verifyVendorCodeAction } from "./actions";
import { VENDOR_COOKIE } from "./paths";
import { VendorSignForm } from "./VendorSignForm";

/**
 * R39 S7 — the page a vendor opens from Greenway's email.
 *
 * No login. One thing to do per screen, phone-first, and every screen says
 * how to reach a person and that paper checks stay available (WAC
 * 314-55-115(3)(a): ACH is voluntary). The link token is in the path, so the
 * page sends no referrer, is not indexed, loads no analytics (layout
 * NoTrackGate) and is disallowed in robots.txt.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Greenway Marijuana | Vendor direct deposit",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

const C = GREENWAY_CONTACTS;

function Shell({ children, vendorName }: { children: ReactNode; vendorName?: string }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8 text-white sm:py-12">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#7ed957]">Greenway Marijuana</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Get paid by direct deposit</h1>
        {vendorName ? <p className="mt-1 text-white/70">For {vendorName}</p> : null}
      </header>
      <div className="space-y-6">{children}</div>
      <footer className="mt-10 border-t border-white/10 pt-4 text-sm text-white/60">
        <p>
          Questions, or rather use paper? Call the store at <a className="underline" href={`tel:${C.store}`}>{C.store}</a>, {C.stephen.name} at{" "}
          <a className="underline" href={`tel:${C.stephen.phone}`}>{C.stephen.phone}</a> or {C.michael.name} at{" "}
          <a className="underline" href={`tel:${C.michael.phone}`}>{C.michael.phone}</a>.
        </p>
        <p className="mt-2">Direct deposit is optional. Greenway keeps paying by paper check if you prefer, and no vendor is treated differently for choosing checks.</p>
        <p className="mt-2">Greenway will never ask you to send money, and never changes bank details because of an email alone.</p>
      </footer>
    </main>
  );
}

function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 ${tone === "error" ? "border-red-500/50 bg-red-500/10 text-red-200" : "border-[#7ed957]/50 bg-[#7ed957]/10 text-[#c9f5b5]"}`}>
      {children}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">{children}</section>;
}

const bigButton = "w-full rounded-xl bg-[#7ed957] px-6 py-4 text-lg font-bold text-black";
const plainButton = "w-full rounded-xl border border-white/30 px-6 py-3 text-base font-semibold text-white";

function SendCodeForm({ token, label, masked }: { token: string; label: string; masked: string }) {
  return (
    <form action={sendVendorCodeAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className={bigButton}>{label}</button>
      <p className="text-center text-sm text-white/60">The code goes to {masked}, the address this link was sent to.</p>
    </form>
  );
}

function Terms() {
  return (
    <details className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
      <summary className="cursor-pointer font-semibold text-white">Read the full agreement (GW-ACH-V {ACH_V_TERMS.formRev})</summary>
      <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-2">
        <p>{ACH_V_TERMS.intro}</p>
        <h3 className="pt-2 font-semibold text-white">Authorization (credit-only)</h3>
        {ACH_V_TERMS.part3.map((t, i) => <p key={`p3-${i}`}>{t}</p>)}
        <h3 className="pt-2 font-semibold text-white">Washington law: WAC 314-55-115</h3>
        {ACH_V_TERMS.wac.map((t, i) => <p key={`w-${i}`}>{t}</p>)}
        <p>What this means for you: {ACH_V_TERMS.wacMeans}</p>
        <h3 className="pt-2 font-semibold text-white">Terms and conditions</h3>
        {ACH_V_TERMS.terms.map((t, i) => (t.k === "h" ? <h4 key={`t-${i}`} className="pt-2 font-semibold text-white">{t.t}</h4> : <p key={`t-${i}`}>{t.t}</p>))}
        <p className="pt-2">{ACH_V_TERMS.acceptance}</p>
      </div>
    </details>
  );
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function VendorAchPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const okMsg = typeof sp.ok === "string" ? sp.ok.slice(0, 400) : null;
  const errMsg = typeof sp.error === "string" ? sp.error.slice(0, 400) : null;

  if (!isTokenShape(token)) {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-semibold">This link is not valid</h2>
          <p className="mt-2 text-white/80">Open the link straight from Greenway&apos;s email (copying part of it breaks it), or call Greenway and ask for a new one.</p>
        </Card>
      </Shell>
    );
  }
  const raw = (await cookies()).get(VENDOR_COOKIE)?.value ?? null;
  const cookie = isCookieShape(raw) ? raw : null;
  const view = await vendorPageView(token, cookie);
  if (view.kind === "invalid") {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-semibold">This link is not valid</h2>
          <p className="mt-2 text-white/80">It may have been replaced by a newer link. Use the most recent email from Greenway, or call and ask for a new one.</p>
        </Card>
      </Shell>
    );
  }
  const inv = view.invite;
  const notices = (
    <>
      {okMsg ? <Notice tone="ok">{okMsg}</Notice> : null}
      {errMsg ? <Notice tone="error">{errMsg}</Notice> : null}
    </>
  );

  switch (view.step) {
    case "send_code":
      return (
        <Shell vendorName={view.vendorName}>
          {notices}
          <Card>
            <h2 className="text-xl font-semibold">Hi {inv.recipient_name}. Three short steps:</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-6 text-white/85">
              <li>We email you a 6-digit code (proves the email reached you).</li>
              <li>You type it and agree to sign online.</li>
              <li>You fill in one form, add a photo of a voided check, and sign. About 5 minutes.</li>
            </ol>
            <p className="mt-3 text-sm text-white/60">Have your bank routing and account numbers (or a check) handy. This link works until {view.expiresPacific}.</p>
            <div className="mt-5">
              <SendCodeForm token={token} label="Email me a code" masked={inv.email_masked} />
            </div>
          </Card>
        </Shell>
      );

    case "enter_code": {
      const canResend = view.codeSentAgoMs === null || view.codeSentAgoMs >= OTP_RESEND_COOLDOWN_MS;
      return (
        <Shell vendorName={view.vendorName}>
          {notices}
          <Card>
            <h2 className="text-xl font-semibold">Type the code and agree to sign online</h2>
            <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              {VENDOR_ESIGN_DISCLOSURE.map((d) => <p key={d.clause}>{d.text}</p>)}
            </div>
            <form action={verifyVendorCodeAction} className="mt-4 space-y-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="disclosure_sha256" value={view.disclosureSha256} />
              <label className="block">
                <span className="text-sm font-medium">6-digit code from the email</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required className="mt-1 block w-full rounded-lg border border-white/20 bg-black/40 px-3 py-3 text-center text-2xl tracking-[0.4em] text-white" />
              </label>
              <label className="flex items-start gap-3">
                <input type="checkbox" name="agree" className="mt-1 h-6 w-6 shrink-0" />
                <span className="text-sm">{VENDOR_CONSENT_STATEMENT}</span>
              </label>
              <button type="submit" className={bigButton}>Continue</button>
            </form>
          </Card>
          <Card>
            <p className="text-sm text-white/70">No email? Check spam, wait a minute, then:</p>
            <div className="mt-3">
              {canResend ? <SendCodeForm token={token} label="Send a new code" masked={inv.email_masked} /> : <p className="text-sm text-white/60">You can ask for a new code one minute after the last one. Reload this page then.</p>}
            </div>
          </Card>
        </Shell>
      );
    }

    case "fill":
      return (
        <Shell vendorName={view.vendorName}>
          {notices}
          <Card>
            <VendorSignForm
              token={token}
              prefill={view.prefill as Record<string, string>}
              entityOptions={ENTITY_TYPES.map((v) => ({ value: v, label: ENTITY_LABELS[v] }))}
              kindOptions={VENDOR_KINDS.map((v) => ({ value: v, label: VENDOR_KIND_LABELS[v] }))}
              proofOptions={PROOF_KINDS.map((v) => ({ value: v, label: PROOF_LABELS[v] }))}
              intentStatement={VENDOR_INTENT_STATEMENT}
              certification={ACH_V_TERMS.certification}
              terms={<Terms />}
            />
          </Card>
        </Shell>
      );

    case "other_browser":
    case "stale":
      return (
        <Shell vendorName={view.vendorName}>
          {notices}
          <Card>
            <h2 className="text-xl font-semibold">{view.step === "stale" ? "Please confirm your email again" : "Continue on this device"}</h2>
            <p className="mt-2 text-white/80">
              {view.step === "stale"
                ? "It has been more than a day since you confirmed the code. For your security, get a new code to carry on. Nothing you typed was saved."
                : "The code was confirmed in a different browser or device. For your security, get a new code here to carry on, or go back to that device."}
            </p>
            <div className="mt-5">
              <SendCodeForm token={token} label="Email me a new code" masked={inv.email_masked} />
            </div>
          </Card>
        </Shell>
      );

    case "locked":
      return (
        <Shell vendorName={view.vendorName}>
          <Card>
            <h2 className="text-xl font-semibold">This link is paused</h2>
            <p className="mt-2 text-white/80">Too many codes were asked for or typed wrong, so this link stopped for your protection. Call Greenway at {C.store} and we will send a fresh link.</p>
          </Card>
        </Shell>
      );

    case "signed": {
      const mine = browserMatches(inv, cookie);
      return (
        <Shell vendorName={view.vendorName}>
          {notices}
          <Card>
            <h2 className="text-xl font-semibold text-[#7ed957]">Signed. Thank you!</h2>
            <p className="mt-2 text-white/85">
              We received your direct deposit form{inv.account_last4 ? ` for the account ending ${inv.account_last4}` : ""}. A receipt is on its way by email.
            </p>
            <h3 className="mt-4 font-semibold">What happens next</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-white/80">
              <li>Greenway phones your second contact at a number on file to confirm the details.</li>
              <li>Greenway verifies the account (a pre-notification or a $1 test deposit).</li>
              <li>Greenway countersigns and emails you the accepted agreement. Payments then go by direct deposit.</li>
            </ol>
            <p className="mt-3 text-sm text-white/60">Until then Greenway keeps paying by check, on the same legal schedule, so you are never paid late.</p>
            {mine ? (
              <a href={`/vendor-ach/${token}/copy`} className={`mt-5 block text-center ${plainButton}`}>Download your signed copy (PDF)</a>
            ) : (
              <p className="mt-4 text-sm text-white/60">Need a copy? Greenway emails the accepted agreement, or call and ask for one.</p>
            )}
          </Card>
        </Shell>
      );
    }

    case "countersigned":
      return (
        <Shell vendorName={view.vendorName}>
          <Card>
            <h2 className="text-xl font-semibold text-[#7ed957]">You are set up for direct deposit</h2>
            <p className="mt-2 text-white/80">Greenway accepted your agreement{inv.account_last4 ? ` for the account ending ${inv.account_last4}` : ""} and emailed you the signed copy. To change banks later, call Greenway for a new link: bank changes are never made by email alone.</p>
          </Card>
        </Shell>
      );

    case "rejected":
      return (
        <Shell vendorName={view.vendorName}>
          <Card>
            <h2 className="text-xl font-semibold">Greenway could not accept this form</h2>
            <p className="mt-2 text-white/80">Nothing changes: Greenway keeps paying by check. Call {C.store} and we will explain and, if you like, send a new link.</p>
          </Card>
        </Shell>
      );

    case "cancelled":
      return (
        <Shell vendorName={view.vendorName}>
          <Card>
            <h2 className="text-xl font-semibold">This link was replaced or withdrawn</h2>
            <p className="mt-2 text-white/80">Use the newest email from Greenway, or call {C.store} for a new link.</p>
          </Card>
        </Shell>
      );

    case "expired":
    default:
      return (
        <Shell vendorName={view.vendorName}>
          <Card>
            <h2 className="text-xl font-semibold">This link has expired</h2>
            <p className="mt-2 text-white/80">Links work for 14 days. Call {C.store} or reply to Greenway&apos;s email and we will send a new one right away.</p>
          </Card>
        </Shell>
      );
  }
}
