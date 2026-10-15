/**
 * R41 S10: the STOP card, on every banking page (banking/layout.tsx).
 *
 * When something is wrong, the first move is a phone call to Timberland,
 * not a screen in this app: the app cannot cancel a file at the bank, and a
 * file cannot be called back after upload (section 18). The card says who to
 * call, when, and what has to follow in writing (Schedule F: within 1
 * calendar day of the call), with the letter pre-filled.
 *
 * Shows only the public bank phone and the account's last 4 digits.
 */
import { TIMBERLAND_PHONE } from "@/lib/payments/timberland-profile-core";
import {
  compromiseLetter,
  COMMS_TYPE_SPECS,
  FEE_ROWS,
  LOST_TOKEN_QUOTE,
  NO_CANCEL_QUOTE,
  PAYEE_NOTICE_QUOTE,
  REVERSAL_NO_REFUND_QUOTE,
  STOP_WHEN,
  usdCents,
  type Quote,
} from "@/lib/payments/timberland-obligations-core";

function Q({ q }: { q: Quote }) {
  return (
    <blockquote className="mt-1 border-l-2 border-white/20 pl-3 text-xs italic text-white/55">
      &ldquo;{q.text}&rdquo; <span className="not-italic text-white/35">({q.section})</span>
    </blockquote>
  );
}

export function StopCard({ todayIso, calledAtUtc }: { todayIso: string; calledAtUtc: string | null }) {
  const tel = TIMBERLAND_PHONE.replace(/[^0-9]/g, "");
  const lostToken = FEE_ROWS.find((r) => r.label === "Lost token replacement");
  return (
    <details id="stop-card" className="rounded-[var(--admin-radius)] border border-red-500/40 bg-red-500/[0.06] px-4 py-2 text-sm text-red-100">
      <summary className="cursor-pointer font-semibold text-red-200">
        STOP: something wrong with an ACH payment or your Timberland login? Phone Timberland first:{" "}
        <a href={`tel:${tel}`} className="underline">{TIMBERLAND_PHONE}</a>
      </summary>
      <div className="mt-3 space-y-4 pb-2">
        <div>
          <p className="font-semibold">Phone at once when:</p>
          <ul className="ml-5 list-disc text-red-100/90">
            {STOP_WHEN.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <p className="mt-2 text-xs text-red-100/70">Use the number on this card (it is the one in the signed agreement), never a number from an email or a text.</p>
        </div>

        <div>
          <p className="font-semibold">Be honest with yourself about what the bank can do</p>
          <p className="text-xs text-red-100/80">A file cannot be called back once it is uploaded. The bank may try, but:</p>
          <Q q={NO_CANCEL_QUOTE} />
          <p className="mt-2 text-xs text-red-100/80">Greenway sends credits only (no debit files), so a wrong payment is fixed by asking Timberland to reverse it. Timberland&apos;s answer:</p>
          <Q q={REVERSAL_NO_REFUND_QUOTE} />
          <p className="mt-2 text-xs text-red-100/80">If a reversal goes ahead, the person paid must be told first:</p>
          <Q q={PAYEE_NOTICE_QUOTE} />
          <p className="mt-1 text-xs text-red-100/70">Log it on ACH operations as &ldquo;{COMMS_TYPE_SPECS.reversal_needed.label}&rdquo; to get the deadline.</p>
        </div>

        <div>
          <p className="font-semibold">After the call about a stolen or lost password, code, phone or token: confirm in writing within 1 calendar day</p>
          {COMMS_TYPE_SPECS.compromise_reported.quote ? <Q q={COMMS_TYPE_SPECS.compromise_reported.quote} /> : null}
          <p className="mt-2 text-xs text-red-100/70">
            Log the call on ACH operations as &ldquo;{COMMS_TYPE_SPECS.compromise_reported.label}&rdquo; (with the time) and the 24-hour clock starts. A letter to copy, sign and send
            {calledAtUtc ? " (filled in with the call you logged)" : ""}:
          </p>
          <textarea
            readOnly
            aria-label="Written confirmation letter"
            rows={14}
            className="mt-2 w-full rounded-[var(--admin-radius)] border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/80"
            defaultValue={compromiseLetter({ todayIso, calledAtUtc, whatHappened: null })}
          />
          {lostToken ? (
            <div className="mt-1 text-xs text-red-100/70">
              A lost token costs {usdCents(lostToken.cents)} to replace.
              <Q q={LOST_TOKEN_QUOTE} />
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
