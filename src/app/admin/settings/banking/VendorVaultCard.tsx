/**
 * R39 S3 — one vendor's banking in the vault, with only the buttons the 0259
 * trigger allows for its status (vaultRowActions):
 *   active   → Put on hold · Archive · Mark verified (if not yet)
 *   on_hold  → Release (callback form) · Archive
 *   revoked  → Re-open on hold · Archive
 *   archived → Re-open on hold
 *
 * Server component: forms post straight to the server actions in
 * vault-actions.ts, which re-check everything (planVaultRelease and the
 * database trigger). Nothing here is trusted for safety; it only makes the
 * safe path the obvious one.
 *
 * The callback contacts panel lives here too: a release by phone must use a
 * number picked from THIS vendor's contacts that has been on file at least
 * CONTACT_LOOKBACK_DAYS (90) days — never a number from the email that asked
 * for the change (Nacha 2026 fraud-monitoring rules; WA State Auditor vendor
 * fraud guidance).
 */
import Link from "next/link";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import { vendorBankingBadge, vaultRowActions } from "@/lib/payments/banking-vault-ui-core";
import { releasePhoneChoices } from "@/lib/payments/vault-release-core";
import {
  CONTACT_LOOKBACK_DAYS,
  MIN_CALLBACK_NOTE_CHARS,
  MIN_SOLO_REASON_CHARS,
} from "@/lib/payments/ach-authorization-core";
import type { VendorBankRecord, VendorContact } from "@/lib/payments/payee-banking-store";
import {
  addVendorContactAction,
  archiveVendorBankingAction,
  holdVendorBankAction,
  markVendorBankVerifiedAction,
  releaseVendorBankHoldAction,
  retireVendorContactAction,
} from "./vault-actions";

const smallInput =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const smallLabel = "mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-white/45";
const btnGhost =
  "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";
const btnGo =
  "rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400";
const btnWarn =
  "rounded-[var(--admin-radius)] border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/10";

const TONE_CLS: Record<string, string> = {
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  gold: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
  orange: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  neutral: "border-white/15 bg-white/[0.04] text-white/60",
};

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
}

export function VendorVaultCard({
  record,
  contacts,
  contactsReady,
  controlsReady,
  staffNames,
  actorUserId,
  today,
}: {
  record: VendorBankRecord;
  contacts: VendorContact[];
  contactsReady: boolean;
  controlsReady: boolean;
  staffNames: Map<string, string>;
  actorUserId: string;
  today: string;
}) {
  const badge = vendorBankingBadge({
    hasRecord: true,
    status: record.status,
    verifiedAt: record.verified_at,
    accountNumber: record.account_number,
    bankName: record.bank_name,
  });
  const actions = vaultRowActions(record.status, Boolean(record.verified_at));
  const phones = releasePhoneChoices(contacts, today);
  const qualifying = phones.filter((p) => p.qualifies);
  const name = (id: string | null) => (id ? staffNames.get(id) ?? "a staff member" : "unknown");
  // Solo = the person who entered the change (or an unknown author) releases
  // it. Same rule as releaseVerdict() and the 0259 trigger; the server decides.
  const willBeSolo = record.change_entered_by === null || record.change_entered_by === actorUserId;

  return (
    <article className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
      {/* Header: who, where, status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/admin/vendors/${record.vendor_id}`} className="text-sm font-semibold text-white hover:underline">
            {record.vendor_name}
          </Link>
          <p className="mt-0.5 font-mono text-xs text-white/60">
            {record.bank_name ? `${record.bank_name} · ` : ""}routing {maskAccountTail(record.routing)} · account{" "}
            {maskAccountTail(record.account_number)} · {record.account_type}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLS[badge.tone] ?? TONE_CLS.neutral}`} title={badge.detail}>
            {badge.label}
          </span>
          {record.status !== "archived" ? (
            <Link href={`/admin/settings/banking?tab=vendors&edit=${record.vendor_id}`} className={btnGhost}>
              Edit
            </Link>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-xs text-white/50">{badge.detail}</p>

      {/* History — who entered, why held, who released, why archived */}
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-white/55 sm:grid-cols-2">
        {record.hold_reason && record.status === "on_hold" ? (
          <div>
            <dt className="inline font-semibold text-amber-200/80">On hold because: </dt>
            <dd className="inline">{record.hold_reason}</dd>
          </div>
        ) : null}
        {record.change_entered_at ? (
          <div>
            <dt className="inline font-semibold text-white/60">Numbers entered by: </dt>
            <dd className="inline">
              {name(record.change_entered_by)} · {when(record.change_entered_at)}
            </dd>
          </div>
        ) : null}
        {record.released_at ? (
          <div>
            <dt className="inline font-semibold text-white/60">Released: </dt>
            <dd className="inline">
              {name(record.released_by)} · {when(record.released_at)} · {record.release_mode === "solo" ? "SOLO" : "dual"} ·{" "}
              {record.release_callback_method === "in_person" ? "in person" : "phone callback"}
            </dd>
          </div>
        ) : null}
        {record.release_callback_note ? (
          <div className="sm:col-span-2">
            <dt className="inline font-semibold text-white/60">Callback note: </dt>
            <dd className="inline">{record.release_callback_note}</dd>
          </div>
        ) : null}
        {record.release_reason ? (
          <div className="sm:col-span-2">
            <dt className="inline font-semibold text-white/60">Solo reason: </dt>
            <dd className="inline">{record.release_reason}</dd>
          </div>
        ) : null}
        {record.archived_at ? (
          <div className="sm:col-span-2">
            <dt className="inline font-semibold text-white/60">Archived: </dt>
            <dd className="inline">
              {name(record.archived_by)} · {when(record.archived_at)} · {record.archive_reason}
            </dd>
          </div>
        ) : null}
        {record.verified_at ? (
          <div>
            <dt className="inline font-semibold text-white/60">Verified: </dt>
            <dd className="inline">
              {when(record.verified_at)}
              {record.verified_note ? ` · ${record.verified_note}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      {actions.length === 0 ? (
        <p className="mt-3 rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
          This record&apos;s status (&quot;{record.status}&quot;) isn&apos;t one the vault knows, so it can&apos;t be paid and no buttons
          are offered. Check the database row.
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {/* RELEASE — the callback form */}
        {actions.includes("release") ? (
          <details className="rounded-[var(--admin-radius)] border border-emerald-500/25 bg-emerald-500/[0.03] p-3" open>
            <summary className="cursor-pointer text-xs font-semibold text-emerald-300">
              Release the hold after a callback
            </summary>
            <form action={releaseVendorBankHoldAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="vendor_id" value={record.vendor_id} />
              <div>
                <label className={smallLabel} htmlFor={`m-${record.id}`}>How did you confirm the numbers?</label>
                <select id={`m-${record.id}`} name="callback_method" className={smallInput} defaultValue={qualifying.length ? "phone" : "in_person"} required>
                  <option value="phone">I called them at a number on file</option>
                  <option value="in_person">In person, face to face</option>
                </select>
              </div>
              <div>
                <label className={smallLabel} htmlFor={`c-${record.id}`}>Number I called (phone only)</label>
                <select id={`c-${record.id}`} name="contact_id" className={smallInput} defaultValue="">
                  <option value="">— pick for a phone callback —</option>
                  {phones.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.qualifies}>
                      {p.value} · on file {p.ageDays} days{p.qualifies ? "" : ` (needs ${CONTACT_LOOKBACK_DAYS})`}
                    </option>
                  ))}
                </select>
                {qualifying.length === 0 ? (
                  <p className="mt-1 text-[0.7rem] text-amber-200/80">
                    No number has been on file {CONTACT_LOOKBACK_DAYS}+ days yet — confirm in person, or add a number you
                    already had (backdated) below.
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <label className={smallLabel} htmlFor={`n-${record.id}`}>Callback note ({MIN_CALLBACK_NOTE_CHARS}+ characters)</label>
                <input
                  id={`n-${record.id}`}
                  name="callback_note"
                  className={smallInput}
                  minLength={MIN_CALLBACK_NOTE_CHARS}
                  required
                  placeholder="Who you spoke with and what they confirmed, e.g. Maria in AR read back the account ending 4821"
                />
              </div>
              {willBeSolo ? (
                <div className="sm:col-span-2">
                  <label className={smallLabel} htmlFor={`r-${record.id}`}>
                    Solo release reason ({MIN_SOLO_REASON_CHARS}+ characters)
                  </label>
                  <input
                    id={`r-${record.id}`}
                    name="release_reason"
                    className={smallInput}
                    minLength={MIN_SOLO_REASON_CHARS}
                    required
                    placeholder="Why the other owner isn't releasing this, e.g. Stephen is away and the invoice is due Friday"
                  />
                  <p className="mt-1 text-[0.7rem] text-amber-200/80">
                    {record.change_entered_by === null
                      ? "Nobody is recorded as entering these numbers, so any release counts as SOLO."
                      : "You entered these numbers, so releasing them yourself is a SOLO release."}{" "}
                    The other owner and the store are emailed and listed to call.
                  </p>
                </div>
              ) : (
                <p className="text-[0.7rem] text-emerald-300/80 sm:col-span-2">
                  {name(record.change_entered_by)} entered these numbers, so your release is the second person — a DUAL release.
                </p>
              )}
              <label className="flex items-start gap-2 text-xs text-white/70 sm:col-span-2">
                <input type="checkbox" name="confirmed" value="yes" required className="mt-0.5" />
                <span>
                  I confirmed the routing and account numbers with the vendor myself, using the number or meeting above — not a
                  number or link from the message that asked for the change.
                </span>
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={btnGo}>Release hold</button>
              </div>
            </form>
          </details>
        ) : null}

        <div className="flex flex-wrap items-start gap-2">
          {/* HOLD / RE-OPEN */}
          {actions.includes("hold") || actions.includes("reopen") ? (
            <form action={holdVendorBankAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="vendor_id" value={record.vendor_id} />
              <input name="hold_reason" required className={`${smallInput} w-64`} placeholder="Why? e.g. vendor emailed new bank details" />
              <button type="submit" className={btnWarn}>
                {actions.includes("reopen") ? "Re-open on hold" : "Put on hold"}
              </button>
            </form>
          ) : null}

          {/* VERIFY */}
          {actions.includes("verify") ? (
            <form action={markVendorBankVerifiedAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="vendor_id" value={record.vendor_id} />
              <input name="note" className={`${smallInput} w-56`} placeholder="Verified with… (name + phone)" />
              <button type="submit" className={btnGhost}>Mark verified</button>
            </form>
          ) : null}
        </div>

        {/* ARCHIVE — replaces delete (owner answer Q7) */}
        {actions.includes("archive") ? (
          <details className="rounded-[var(--admin-radius)] border border-white/10 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-white/55">Archive (stop paying, keep the record)</summary>
            {controlsReady ? (
              <form action={archiveVendorBankingAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="vendor_id" value={record.vendor_id} />
                <input name="archive_reason" required className={`${smallInput} w-72`} placeholder="Why? e.g. vendor closed / switched to check" />
                <button type="submit" className="rounded-[var(--admin-radius)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-danger)] hover:underline">
                  Archive banking
                </button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-amber-200">Archiving needs migration 0259 applied first (see the banner above).</p>
            )}
            <p className="mt-2 text-[0.7rem] text-white/40">
              Banking is never deleted — the record and its history stay for the retention period. Archived banking can be
              re-opened on hold later.
            </p>
          </details>
        ) : null}

        {/* CALLBACK CONTACTS */}
        <details className="rounded-[var(--admin-radius)] border border-white/10 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-white/55">
            Callback numbers on file ({phones.length} phone{phones.length === 1 ? "" : "s"}, {qualifying.length} usable)
          </summary>
          {!contactsReady ? (
            <p className="mt-2 text-xs text-amber-200">Callback contacts need migration 0258 applied first.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {contacts.length === 0 ? (
                <p className="text-xs text-white/50">No contacts yet. Add the numbers you already had for this vendor.</p>
              ) : (
                <ul className="space-y-1">
                  {contacts.map((c) => {
                    const p = phones.find((x) => x.id === c.id);
                    return (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                        <span className="font-mono">{c.value}</span>
                        <span className="text-white/40">
                          {c.kind} · on file since {c.onFileSince} · {c.source.replace("_", " ")}
                        </span>
                        {c.kind === "phone" && p ? (
                          <span className={p.qualifies ? "text-emerald-300/80" : "text-amber-200/80"}>
                            {p.qualifies ? "usable for callbacks" : `usable in ${CONTACT_LOOKBACK_DAYS - p.ageDays} days`}
                          </span>
                        ) : c.kind === "email" ? (
                          <span className="text-white/35">email — never enough on its own</span>
                        ) : null}
                        <form action={retireVendorContactAction}>
                          <input type="hidden" name="vendor_id" value={record.vendor_id} />
                          <input type="hidden" name="contact_id" value={c.id} />
                          <button type="submit" className="text-[0.7rem] text-white/40 hover:text-[var(--admin-danger)] hover:underline">
                            retire
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
              <form action={addVendorContactAction} className="grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="vendor_id" value={record.vendor_id} />
                <select name="contact_kind" className={smallInput} defaultValue="phone" aria-label="Kind">
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
                <input name="contact_value" required className={`${smallInput} sm:col-span-2`} placeholder="360-555-0100" aria-label="Number or email" />
                <input name="on_file_since" type="date" max={today} defaultValue={today} className={smallInput} aria-label="On file since" />
                <select name="source" className={smallInput} defaultValue="existing_record" aria-label="Where it came from">
                  <option value="existing_record">Existing records</option>
                  <option value="signed_form">Signed form</option>
                  <option value="in_person">In person</option>
                  <option value="onboarding">Onboarding</option>
                </select>
                <div className="sm:col-span-5 flex flex-wrap items-center gap-3">
                  <button type="submit" className={btnGhost}>Add contact</button>
                  <span className="text-[0.7rem] text-white/40">
                    Backdate &quot;on file since&quot; to when you first had the number (an old invoice, the license list). Never
                    add a number from the message asking to change banking. Numbers can&apos;t be edited — retire and re-add.
                  </span>
                </div>
              </form>
            </div>
          )}
        </details>
      </div>
    </article>
  );
}
