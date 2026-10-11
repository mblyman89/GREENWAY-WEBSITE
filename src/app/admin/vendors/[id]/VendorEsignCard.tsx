import { Badge } from "@/components/admin/ui";
import { VENDOR_ESIGN_LABELS, inviteExpired, pacificDate } from "@/lib/payments/vendor-esign-core";
import type { VendorEsignCardData } from "@/lib/payments/vendor-esign-store";
import { cancelVendorEsignAction, countersignVendorEsignAction, rejectVendorEsignAction, sendVendorEsignLinkAction } from "../vendor-esign-actions";

/**
 * R39 S7 — "Sign up for direct deposit online" card on the vendor page.
 * Owner/admin only (settings.manage), like the ACH card above it.
 *
 * The one button that matters: email the vendor a link. Everything after
 * that is the vendor's (code, consent, form, photo, signature) until the
 * signed form comes back; then the card walks Greenway through the callback,
 * the vault release and the countersignature. No bank number is shown here:
 * last 4 only.
 */
const box = "mt-1 block w-full rounded-md border border-white/15 bg-black/30 px-2.5 py-1.5 text-sm text-white";
const btn = "rounded-md border px-3 py-1.5 text-xs font-semibold";

export function VendorEsignCard({ vendorId, vendorEmail, vendorName, optedOut, data }: { vendorId: string; vendorEmail: string | null; vendorName: string; optedOut: boolean; data: VendorEsignCardData }) {
  const hidden = <input type="hidden" name="vendor_id" value={vendorId} />;
  if (!data.ready) {
    return (
      <section id="vendor-esign" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold text-white">Direct deposit sign-up (online)</h2>
        <p className="mt-2 text-xs text-white/60">Not available yet: apply migration 0262 (vendor e-sign) in Supabase.</p>
      </section>
    );
  }
  const open = data.invites.find((i) => ["sent", "code_sent", "consented"].includes(i.state)) ?? null;
  const openLive = open && !inviteExpired(open.expires_at, data.nowMs);
  const waiting = data.invites.find((i) => i.state === "signed") ?? null;
  const done = data.invites.find((i) => i.state === "countersigned") ?? null;
  const tone = (s: string) => (s === "countersigned" ? "green" : s === "signed" ? "gold" : s === "rejected" || s === "cancelled" ? "neutral" : "outline") as "green" | "gold" | "neutral" | "outline";
  const who = (id: string | null) => (id ? data.names[id] ?? "staff" : "");

  return (
    <section id="vendor-esign" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" aria-labelledby={`vesign-${vendorId}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={`vesign-${vendorId}`} className="text-sm font-semibold text-white">Direct deposit sign-up (online)</h2>
        {done ? <Badge tone="green">Signed up</Badge> : waiting ? <Badge tone="gold">Waiting on Greenway</Badge> : openLive ? <Badge tone="outline">Link out</Badge> : null}
      </div>
      {data.error ? <p className="text-xs text-red-300">{data.error}</p> : null}

      {waiting ? (
        <div className="space-y-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-xs text-white/85">
            <strong>{waiting.signer_name}</strong>{waiting.signer_title ? `, ${waiting.signer_title}` : ""} signed on {pacificDate(waiting.signed_at ?? "")}
            {waiting.account_last4 ? ` (account ending ${waiting.account_last4})` : ""}. The details are in the vault ON HOLD.
          </p>
          {waiting.form?.review_flags?.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-200">
              {waiting.form.review_flags.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : null}
          <ol className="list-decimal space-y-1 pl-4 text-xs text-white/75">
            <li>Phone the vendor&apos;s second contact at a number ALREADY on file (never one from this form or an email). Confirm the last 4 and the tax ID last 4.</li>
            <li>Release the hold in Admin &gt; Banking (dual control), then verify the account (prenote or $1 test credit).</li>
            <li>Countersign below. The vendor is emailed the accepted agreement.</li>
          </ol>
          {data.countersign && !data.countersign.ready ? <p className="text-xs font-semibold text-amber-200">{data.countersign.message}</p> : null}
          <form action={countersignVendorEsignAction} className="space-y-2">
            {hidden}
            <input type="hidden" name="invite_id" value={waiting.id} />
            <label className="block text-xs text-white/80">Your title<input name="title" defaultValue="Owner" className={box} required /></label>
            <label className="block text-xs text-white/80">Callback note (who you spoke to, when)<input name="note" className={box} maxLength={500} /></label>
            <label className="flex items-start gap-2 text-xs text-white/80"><input type="checkbox" name="callback_done" className="mt-0.5" /> I phoned the second contact at a number already on file and they confirmed.</label>
            <button type="submit" disabled={!data.countersign?.ready} className={`${btn} border-[var(--admin-accent)]/50 text-[var(--admin-accent)] disabled:opacity-40`}>Countersign</button>
          </form>
          <details className="text-xs text-white/70">
            <summary className="cursor-pointer">Reject this form</summary>
            <form action={rejectVendorEsignAction} className="mt-2 space-y-2">
              {hidden}
              <input type="hidden" name="invite_id" value={waiting.id} />
              <label className="block">Reason (internal)<input name="reason" className={box} minLength={5} maxLength={500} required /></label>
              <button type="submit" className={`${btn} border-red-400/50 text-red-300`}>Reject</button>
            </form>
          </details>
        </div>
      ) : null}

      {!waiting ? (
        <form action={sendVendorEsignLinkAction} className="mt-2 space-y-2">
          {hidden}
          <p className="text-xs text-white/65">
            {done ? "Bank change? Send a new link; the vendor signs again and the old agreement is archived." : `Email ${vendorName} a secure link. They confirm a code, fill one form on their phone, add a photo of a voided check and sign. About 5 minutes.`}
          </p>
          {optedOut ? <p className="text-xs text-amber-200">This vendor is marked as opted out (checks). Sending a link is fine; signing clears that flag.</p> : null}
          <label className="block text-xs text-white/80">Send to (name)<input name="recipient_name" className={box} placeholder="Accounts receivable" defaultValue={openLive ? open.recipient_name : ""} required /></label>
          <label className="block text-xs text-white/80">Email<input name="email" type="email" className={box} defaultValue={vendorEmail ?? ""} required /></label>
          <button type="submit" disabled={Boolean(openLive)} className={`${btn} border-[var(--admin-accent)]/50 text-[var(--admin-accent)] disabled:opacity-40`}>
            {openLive ? "A link is already out" : "Email the sign-up link"}
          </button>
        </form>
      ) : null}

      {openLive && open ? (
        <div className="mt-3 rounded-lg border border-white/10 p-3 text-xs text-white/75">
          <p>
            Link to {open.email_masked} ({VENDOR_ESIGN_LABELS[open.state]}), sent {pacificDate(open.invited_at)} by {who(open.invited_by)}, works until {pacificDate(open.expires_at)}.
            {open.first_opened_at ? ` Opened ${pacificDate(open.first_opened_at)}.` : " Not opened yet."}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer">Cancel this link</summary>
            <form action={cancelVendorEsignAction} className="mt-2 space-y-2">
              {hidden}
              <input type="hidden" name="invite_id" value={open.id} />
              <label className="block">Reason<input name="reason" className={box} minLength={5} maxLength={500} placeholder="Wrong email address" required /></label>
              <button type="submit" className={`${btn} border-red-400/50 text-red-300`}>Cancel link</button>
            </form>
          </details>
        </div>
      ) : null}

      {data.invites.length ? (
        <details className="mt-3 text-xs text-white/60">
          <summary className="cursor-pointer">History ({data.invites.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(i.state)}>{VENDOR_ESIGN_LABELS[i.state]}</Badge>
                <span>
                  {pacificDate(i.invited_at)} to {i.email_masked}
                  {i.account_last4 ? `, acct ...${i.account_last4}` : ""}
                  {i.countersigned_at ? `, accepted ${pacificDate(i.countersigned_at)} by ${who(i.countersigned_by)}` : ""}
                  {i.rejected_at ? `, rejected by ${who(i.rejected_by)}` : ""}
                  {i.cancelled_at ? `, cancelled by ${who(i.cancelled_by)}` : ""}
                  {["sent", "code_sent", "consented"].includes(i.state) && inviteExpired(i.expires_at, data.nowMs) ? " (expired)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
