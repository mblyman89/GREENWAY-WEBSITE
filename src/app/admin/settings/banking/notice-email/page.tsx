/**
 * /admin/settings/banking/notice-email   (R41 S17)
 *
 * The notice-email watch: an optional, hourly heads-up when the Federal
 * Reserve's encrypted ACH notice email arrives in the company Google
 * Workspace mailbox (the same sign-in as the CCRS email monitor).
 *
 * Sources (verbatim mirrors, NOTICE_MAIL_QUOTES):
 *   Brenda, Timberland, 2026-10-19 email 3 answer 9: notices come two ways,
 *     the Fed's secure encrypted email and the portal's reporting tab.
 *   The Fed's EDI encrypted-email guide: sender domain, 60-day retention,
 *     do not rely on the email, check the portal daily, check the link.
 *   Gmail Help 7190: the `{ }` OR search and that the search includes Spam.
 *
 * OFF BY DEFAULT. What the real notice looks like is not known yet, so the
 * site never parses it: it records the facts (sender, DMARC, link hosts,
 * spam folder) and the owner reads the notice in the portal.
 *
 * Gate: settings.manage (owner and admin) to see the list and mark an email;
 * the decrypted subject and text are shown only to finances.view (the owner),
 * because it is bank mail. Settings and "Check now" are the owner's (ach.act).
 * Links found in an email are shown as plain text host names, never as links.
 * Nothing on this page ever blocks a payment.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, InfoHint } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { mailConfigFromEnv } from "@/lib/compliance/ccrs-mail-core";
import {
  AUTH_WORD,
  buildNoticeQuery,
  FED_NOTICE_DOMAIN,
  FED_PORTAL_RETENTION_DAYS,
  LINK_TEXT,
  MAX_NOTICE_LOOKBACK_HOURS,
  MAX_SENDERS,
  NOTICE_MAIL_QUOTES,
  NOTICE_QUOTE_FILE,
  STATE_WORD,
  type NoticeQuoteId,
} from "@/lib/payments/ach-notice-mail-core";
import { getNoticeHeartbeat, getNoticeSettings, listNoticeMail, readNoticeMailText, NOTICE_LOG_LINK, type StoredNoticeMail } from "@/lib/payments/ach-notice-mail-store";
import { BankingSubnav } from "../BankingHelpTabs";
import { checkNowAction, markNoticeMailAction, saveNoticeSettingsAction } from "../notice-email-actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 flex items-center text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

/** The daily routine, in order. Each line says why. */
const DAILY_STEPS: { step: string; why: string }[] = [
  { step: "Type achedi.com into the browser yourself and sign in. Do not click the link in an email.", why: "The Fed's guide asks you to make sure the link goes to the real achedi.com site; typing it removes the question." },
  { step: "Open any new report and download it.", why: `Reports are deleted after ${FED_PORTAL_RETENTION_DAYS} calendar days, so a downloaded copy is your record.` },
  { step: "Sign in to the Timberland portal: Reporting \u2192 Electronic Documents.", why: "Brenda says this is the second place notices are delivered." },
  { step: "Log every return or correction (NOC) on ACH operations the same day.", why: "Fixing the account before the next payroll is what stops the same payment bouncing twice." },
  { step: "Here, mark each waiting email Logged or Not a notice.", why: "It records who looked and when, and stops the reminder." },
];

function Quote({ id }: { id: NoticeQuoteId }) {
  return (
    <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
      &ldquo;{NOTICE_MAIL_QUOTES[id]}&rdquo;
      <span className="mt-1 block text-xs not-italic text-white/40">Verbatim, mirrored at docs/authorities/{NOTICE_QUOTE_FILE[id]}</span>
    </blockquote>
  );
}

/** The search as the next tick would send it (the after: time moves each hour). */
function queryAsOfNow(senders: readonly string[], lookbackHours: number): string {
  return buildNoticeQuery(senders, Date.now(), lookbackHours);
}

function when(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "unknown time";
}

function Flags({ m }: { m: StoredNoticeMail }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {m.sender_ok ? <Badge tone="green">sender matches</Badge> : <Badge tone="danger">sender NOT on your list</Badge>}
      <span className="inline-flex items-center">
        {m.auth === "pass" ? <Badge tone="green">DMARC pass</Badge> : m.auth === "fail" ? <Badge tone="danger">DMARC FAIL</Badge> : <Badge tone="neutral">no DMARC result</Badge>}
        <InfoHint text={`${AUTH_WORD[m.auth]} DMARC is Google's check that the sender's domain really sent it. It is shown, never used to hide an email, because what a real notice shows is not known yet.`} />
      </span>
      <span className="inline-flex items-center">
        {m.link_verdict === "other_hosts" ? <Badge tone="danger">link goes elsewhere</Badge> : m.link_verdict === "portal_only" ? <Badge tone="green">links: achedi.com only</Badge> : <Badge tone="neutral">no links</Badge>}
        <InfoHint text={LINK_TEXT[m.link_verdict]} />
      </span>
      {m.in_spam ? (
        <span className="inline-flex items-center">
          <Badge tone="orange">was in Spam/Trash</Badge>
          <InfoHint text="Gmail filed it as Spam or Trash. Open Gmail and mark it Not spam, and add the sender to your contacts, so the next one lands in the inbox." />
        </span>
      ) : null}
      {m.attachment_count ? <Badge tone="neutral">{m.attachment_count} attachment(s)</Badge> : null}
    </div>
  );
}

export default async function NoticeEmailPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const session = await requirePermission("settings.manage");
  const sp = await searchParams;
  const isOwner = can(session.profile.role, "ach.act");
  const canRead = can(session.profile.role, "finances.view");
  const [settings, heartbeat, list] = await Promise.all([getNoticeSettings(), getNoticeHeartbeat().catch(() => null), listNoticeMail()]);
  const mail = mailConfigFromEnv(process.env);
  const keySet = isAtRestEncryptionConfigured();
  const waiting = list.rows.filter((r) => r.state === "new");
  const done = list.rows.filter((r) => r.state !== "new");
  const texts = new Map<string, { subject: string; body: string } | null>();
  if (canRead) {
    for (const r of waiting.slice(0, 20)) texts.set(r.id, await readNoticeMailText(r.id).catch(() => null));
  }
  const mailbox = settings.mailbox ?? mail.mailbox;
  const query = queryAsOfNow(settings.senders, settings.lookbackHours);
  const ready = [
    { ok: mail.configured, label: "Google Workspace sign-in (shared with the CCRS email monitor)", fix: mail.configured ? null : `Not set up: ${mail.problem ?? (mail.missing.length ? `${mail.missing.join(", ")} missing` : "see Compliance \u2192 CCRS email")}.` },
    { ok: keySet, label: "Encryption key (DATA_ENCRYPTION_KEY) so bank email is never stored in clear", fix: keySet ? null : "Set DATA_ENCRYPTION_KEY in Vercel. Until then nothing is fetched." },
    { ok: list.available, label: "Database table (migration 0290)", fix: list.available ? null : "Apply migration 0290 (docs/MIGRATIONS_TO_RUN.md)." },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Notice email (Fed ACH notices)"
        subtitle="An optional hourly heads-up when the Federal Reserve's encrypted ACH notice email arrives. It never reads the notice and never blocks a payment."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Notice email" }]} />}
        help={
          <HelpPanel
            id="ach-notice-email"
            title="What this page is for"
            steps={[
              "Returns and NOCs (bank corrections) reach you two ways: an encrypted email from the Federal Reserve, and the Timberland portal. The portal is the one to rely on.",
              "When the watch is on, once an hour it looks in the company mailbox (including Spam) for mail from the Fed's sender, saves each one encrypted, and emails Michael.",
              "It never clicks a link and never reads the notice. You sign in to achedi.com yourself, read it, log it on ACH operations, then mark the email here.",
              "If a payroll ACH cannot go out, use the existing skip-and-pay-by-written-check step on the payroll run.",
            ]}
          >
            <p>It is off until Michael turns it on, because we do not yet know exactly what the notice email looks like. It is built so it can be switched on the day the first one arrives.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="noticemail" badge={waiting.length ? { noticemail: String(waiting.length) } : undefined} />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}
        {list.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">The list could not be read: {list.error}. This is not an all clear.</p> : null}

        <section id="status" className={`${card} ${settings.enabled ? "border-emerald-500/30" : "border-amber-400/30"}`}>
          <h2 className={h2}>
            {settings.enabled ? "The watch is ON" : "The watch is OFF"}
            <InfoHint text="OFF means the hourly job reads one setting and stops: no Google call of any kind. ON means it searches the mailbox once an hour at :50." />
          </h2>
          {!settings.enabled ? (
            <p className="text-sm text-amber-200">
              Nothing is being watched. That is the safe default until we know what the Fed&apos;s notice email looks like. The daily portal check below is what matters either way.
            </p>
          ) : (
            <p className="text-sm text-white/80">
              Looking in <span className="font-mono">{mailbox || "(the CCRS mailbox)"}</span> for mail from <span className="font-mono">{settings.senders.join(", ")}</span>, the last {settings.lookbackHours} hours each time.
            </p>
          )}
          <p className="mt-2 text-xs text-white/55">
            Last run: {heartbeat ? `${when(heartbeat.lastRunAt)} \u2014 ${heartbeat.ok ? "ok" : `problem: ${heartbeat.note}`}` : "never"}
            <InfoHint text="Written when the result changes, when something new is stored, or every 6 hours, so a quiet hour writes nothing." />
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {ready.map((r) => (
              <li key={r.label} className={r.ok ? "text-emerald-300" : "text-amber-200"}>
                <span aria-hidden className="mr-1 font-bold">{r.ok ? "\u2713" : "!"}</span>
                {r.label}
                {r.fix ? <span className="block pl-4 text-xs text-white/60">{r.fix}</span> : null}
              </li>
            ))}
          </ul>
          {isOwner ? (
            <form action={checkNowAction} className="mt-3">
              <button className={btnGhost}>Check now</button>
              <span className="ml-2 text-xs text-white/50">Runs the same check as the hourly job. When the watch is off it does nothing.</span>
            </form>
          ) : null}
        </section>

        <section id="daily" className={card}>
          <h2 className={h2}>
            Every banking day, with or without this watch
            <InfoHint text="This is the Fed's own advice. The email can be blocked or filtered; the portal always has the report." />
          </h2>
          <Quote id="fedDaily" />
          <ol className="ml-5 list-decimal space-y-2 text-sm text-white/85">
            {DAILY_STEPS.map((d) => (
              <li key={d.step}>
                {d.step}
                <InfoHint text={d.why} position="right" />
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm">
            <Link href={NOTICE_LOG_LINK} className="text-emerald-300 hover:underline">Log a notice on ACH operations</Link>
            <span className="ml-2 text-xs text-white/50">Questions about a notice: Timberland Cash Management, 1-800-562-8761.</span>
          </p>
        </section>

        <section id="emails" className={card}>
          <h2 className={h2}>
            Waiting ({waiting.length})
            <InfoHint text="Emails the watch saved that nobody has marked yet. Michael gets one email per saved message. Marking is once per email and cannot be changed." />
          </h2>
          {waiting.length === 0 ? (
            <p className="text-sm text-white/70">{list.available ? "No notice email is waiting." : "Apply migration 0290 to start the list."}</p>
          ) : (
            <ul className="space-y-3">
              {waiting.map((m) => {
                const t = texts.get(m.id);
                return (
                  <li key={m.id} className={`rounded-[var(--admin-radius)] border p-3 text-sm ${!m.sender_ok || m.auth === "fail" || m.link_verdict === "other_hosts" ? "border-red-500/40" : "border-amber-400/30"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-3 text-white/80">
                      <span className="font-mono text-white/60">{when(m.received_at)}</span>
                      <span>from <span className="font-mono">{m.from_domain ?? "unknown"}</span></span>
                    </div>
                    <Flags m={m} />
                    {m.link_hosts.length ? (
                      <p className="mt-1 text-xs text-white/60">
                        Link sites (shown as text on purpose, never clickable): <span className="font-mono">{m.link_hosts.join(", ")}</span>
                      </p>
                    ) : null}
                    {canRead ? (
                      t ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Show the email text</summary>
                          <p className="mt-1 font-semibold text-white">{t.subject}</p>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-xs text-white/75">{t.body}</pre>
                          <p className="mt-1 text-xs text-white/45">Plain text only. The encrypted notice itself is in the portal, not in this email.</p>
                        </details>
                      ) : (
                        <p className="mt-2 text-xs text-white/50">The text could not be decrypted here (check DATA_ENCRYPTION_KEY).</p>
                      )
                    ) : (
                      <p className="mt-2 text-xs text-white/50">Only Michael sees the email text.</p>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Mark this email</summary>
                      <form action={markNoticeMailAction} className="mt-2 space-y-2">
                        <input type="hidden" name="mail_id" value={m.id} />
                        <fieldset className="flex flex-wrap gap-4">
                          <legend className="sr-only">What was it?</legend>
                          <label className="flex items-center gap-1">
                            <input type="radio" name="state" value="logged" required /> {STATE_WORD.logged}
                            <InfoHint text="You read the notice in the portal and logged it on ACH operations (or it needed nothing)." />
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="radio" name="state" value="not_a_notice" required /> {STATE_WORD.not_a_notice}
                            <InfoHint text="It was not an ACH notice (a password reset, a newsletter, or a look-alike). If it looked like phishing, tell Timberland." />
                          </label>
                        </fieldset>
                        <textarea name="note" required minLength={10} maxLength={500} rows={2} className={inputCls} placeholder="What the portal showed (code, payee, what you did). No account or trace numbers." />
                        <button className={btnPrimary}>Mark</button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
          {done.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-white/70">Marked ({done.length})</summary>
              <ul className="mt-1 space-y-1 text-xs text-white/65">
                {done.map((m) => (
                  <li key={m.id}>
                    <span className="font-mono">{when(m.received_at)}</span> {m.from_domain ?? ""} &mdash; {STATE_WORD[m.state]} {m.handled_at ? `on ${m.handled_at.slice(0, 10)}` : ""}: {m.handled_note}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section id="settings" className={card}>
          <h2 className={h2}>
            Settings
            <InfoHint text="Only Michael changes these. Every save is in the Security Log." />
          </h2>
          {isOwner ? (
            <form action={saveNoticeSettingsAction} className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Watch is on
                <InfoHint text="Turning it on needs the typed confirmation below. Turning it off needs nothing." />
              </label>
              <label className="block">
                <span className="flex items-center text-white/70">
                  Senders (one per line, up to {MAX_SENDERS})
                  <InfoHint text={`A domain (like ${FED_NOTICE_DOMAIN}) matches that domain and its sub-domains; a full address matches only that address. When the first real notice arrives, check its sender and add it here if it differs.`} />
                </span>
                <textarea name="senders" rows={3} defaultValue={settings.senders.join("\n")} className={`${inputCls} font-mono`} />
              </label>
              <label className="block">
                <span className="flex items-center text-white/70">
                  Mailbox (blank = the CCRS mailbox)
                  <InfoHint text="The Google Workspace address the Fed's emails go to: the address Timberland set up for ACH notices. The same Workspace sign-in reads it, so it must be on your Workspace domain." />
                </span>
                <input name="mailbox" defaultValue={settings.mailbox ?? ""} placeholder={mail.mailbox || "the CCRS mailbox"} className={inputCls} />
              </label>
              <label className="block max-w-xs">
                <span className="flex items-center text-white/70">
                  Look back (hours)
                  <InfoHint text={`How far back each hourly search looks (1 to ${MAX_NOTICE_LOOKBACK_HOURS}). 72 covers a long weekend if the job was down. An email already saved is never saved twice.`} />
                </span>
                <input name="lookback_hours" inputMode="numeric" defaultValue={String(settings.lookbackHours)} className={inputCls} />
              </label>
              <label className="block">
                <span className="flex items-center text-white/70">
                  To turn it on, type: I STILL CHECK THE PORTAL
                  <InfoHint text="A reminder that this is a safety net. The Fed says not to rely on these emails." />
                </span>
                <input name="confirm" autoComplete="off" className={inputCls} />
              </label>
              <button className={btnPrimary}>Save</button>
            </form>
          ) : (
            <p className="text-sm text-white/70">Only Michael changes the settings. Currently {settings.enabled ? "on" : "off"}, senders: {settings.senders.join(", ")}.</p>
          )}
          <details className="mt-3 text-xs text-white/60">
            <summary className="cursor-pointer">The exact Gmail search used</summary>
            <p className="mt-1 font-mono">{query}</p>
            <p className="mt-1">Gmail&apos;s braces mean &ldquo;any of these&rdquo;, and the search covers Spam and Trash:</p>
            <Quote id="gmailOr" />
            <Quote id="gmailAnywhere" />
          </details>
        </section>

        <section id="sources" className={card}>
          <h2 className={h2}>Where this comes from</h2>
          <p className="text-sm text-white/80">Brenda at Timberland (email 3, answer 9):</p>
          <Quote id="brendaTwoWays" />
          <Quote id="brendaEmail" />
          <Quote id="brendaPortal" />
          <p className="mt-3 text-sm text-white/80">The Federal Reserve&apos;s guide to its encrypted email:</p>
          <Quote id="fedSender" />
          <Quote id="fedDontRely" />
          <Quote id="fedLinkCheck" />
          <Quote id="fedRetention" />
          <Quote id="fedSpam" />
        </section>
      </div>
    </div>
  );
}
