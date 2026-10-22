/**
 * src/lib/payments/ach-notice-mail-core.ts  (R41 S17, PURE)
 *
 * THE NOTICE-EMAIL WATCH: a Gmail watch for the email that tells Greenway a
 * Timberland / Federal Reserve ACH notice (a return or a notification of
 * change) is waiting. It is BUILT BUT OFF: nothing is fetched until the owner
 * turns it on, because we have not yet seen one of these emails.
 *
 * WHAT THE EVIDENCE SAYS (verbatim, re-found in the mirrors by a test):
 *   - Brenda (Timberland Cash Management), Email 3, answer 9: notices come two
 *     ways, "an email directly to you via the federal reserves website and it
 *     a secure encrypted email", and the bank portal's "reporting tab,
 *     electronic documents".
 *   - The Fed's Payments Reporter guide: the notification email comes "from
 *     the domain name encryptedmail.achedi.com", the report itself waits in
 *     the achedi.com portal for 60 calendar days, a missing email has "likely
 *     been trapped by a spam filter", and "it is a best practice not to rely
 *     on these notification emails but rather to access the portal directly".
 *   - Gmail search: `{ }` matches "one or more of your search criteria";
 *     Spam and Trash are searched too (includeSpamTrash, as for CCRS).
 *
 * SO, BY DESIGN:
 *   1. It never READS a notice. The real notice sits behind the Fed's
 *      encrypted portal; the email only says one is there. The message is
 *      stored ENCRYPTED (encv1, at-rest-crypto) and never parsed for codes or
 *      amounts: we do not know what it says, so nothing is guessed from it.
 *   2. It ALERTS the owner and links straight to "log a notice" on ACH
 *      operations (#notices), where the existing hold / apply-by flow runs.
 *   3. It CHECKS LINKS: the Fed says to make sure the Open Message link goes
 *      to the real achedi.com site. Every link host in the email is listed and
 *      any host that is not achedi.com (or a sub-domain) is flagged. Links are
 *      shown as text, never as clickable links.
 *   4. It is a SAFETY NET, not the process: the page and the email both say
 *      to check the portal directly, as the Fed recommends.
 *   5. It never blocks a payment.
 *
 * No account numbers, no addresses in this file: the senders and the mailbox
 * the owner types are stored in the database (site_settings), not here.
 */

export const FED_GUIDE_FILE = "ach/frbservices-edi-encrypted-email-guide.txt";
export const BRENDA_FILE = "ach/timberland-brenda-2026-10-19-email-3.txt";
export const GMAIL_OPS_FILE = "ach/gmail-search-operators.txt";

export const NOTICE_MAIL_QUOTES = {
  fedSender: "When a report is generated, you should receive a notification email from the domain name encryptedmail.achedi.com.",
  fedDontRely: "it is a best practice not to rely on these notification emails but rather to access the portal directly to check for reports.",
  fedLinkCheck: "please ensure that the Open Message link directs you to the valid achedi.com site.",
  fedRetention: "Reports are retained in the portal for 60 calendar days and then automatically deleted.",
  fedSpam: "it has likely been trapped by a spam filter or directed to a junk mail area.",
  fedDaily: "In case any notification emails are blocked, a best practice is to access the encrypted internet portal directly each day to check for reports.",
  brendaTwoWays: "Notices are delivered in 2 manners.",
  brendaEmail: "The first is an email directly to you via the federal reserves website and it a secure encrypted email.",
  brendaPortal: "The 2nd delivery method is under the reporting tab, electronic documents.",
  gmailOr: "Find emails that match one or more of your search criteria.",
  gmailAnywhere: "Find emails across Gmail. This includes emails in Spam and Trash.",
} as const;

export type NoticeQuoteId = keyof typeof NOTICE_MAIL_QUOTES;
export const NOTICE_QUOTE_FILE: Record<NoticeQuoteId, string> = {
  fedSender: FED_GUIDE_FILE,
  fedDontRely: FED_GUIDE_FILE,
  fedLinkCheck: FED_GUIDE_FILE,
  fedRetention: FED_GUIDE_FILE,
  fedSpam: FED_GUIDE_FILE,
  fedDaily: FED_GUIDE_FILE,
  brendaTwoWays: BRENDA_FILE,
  brendaEmail: BRENDA_FILE,
  brendaPortal: BRENDA_FILE,
  gmailOr: GMAIL_OPS_FILE,
  gmailAnywhere: GMAIL_OPS_FILE,
};

/** The sender domain the Fed's guide names (quote fedSender). The only built-in sender. */
export const FED_NOTICE_DOMAIN = "encryptedmail.achedi.com";
/** The portal domain the Open Message link must go to (quote fedLinkCheck). */
export const FED_PORTAL_DOMAIN = "achedi.com";
/** Days a report stays in the Fed portal (quote fedRetention). */
export const FED_PORTAL_RETENTION_DAYS = 60;
export const MAX_SENDERS = 5;
export const DEFAULT_NOTICE_LOOKBACK_HOURS = 72;
export const MAX_NOTICE_LOOKBACK_HOURS = 24 * 14;
/** Body text kept (encrypted) per message. */
export const MAX_NOTICE_BODY_CHARS = 20_000;
export const MAX_LINK_HOSTS = 20;

// ------------------------------------------------------------------ settings

export type NoticeMailSettings = {
  enabled: boolean;
  /** Domains ("encryptedmail.achedi.com") or full addresses, lower case. */
  senders: string[];
  /** The Google Workspace mailbox to read; null = the CCRS mailbox. */
  mailbox: string | null;
  lookbackHours: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const DEFAULT_NOTICE_SETTINGS: NoticeMailSettings = {
  enabled: false,
  senders: [FED_NOTICE_DOMAIN],
  mailbox: null,
  lookbackHours: DEFAULT_NOTICE_LOOKBACK_HOURS,
  updatedAt: null,
  updatedBy: null,
};

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const ADDRESS_RE = /^[a-z0-9._%+-]{1,64}@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})$/;

/** A sender entry: a bare domain or a full address, lower-cased; null when neither. */
export function normalizeSender(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (ADDRESS_RE.test(s)) return s;
  if (DOMAIN_RE.test(s)) return s;
  return null;
}

/** Settings read back from site_settings.value_json. Anything malformed falls back to OFF. */
export function settingsFromJson(v: unknown): NoticeMailSettings {
  if (!v || typeof v !== "object") return { ...DEFAULT_NOTICE_SETTINGS };
  const o = v as Record<string, unknown>;
  const senders = Array.isArray(o.senders) ? (o.senders as unknown[]).map((x) => (typeof x === "string" ? normalizeSender(x) : null)).filter((x): x is string => !!x) : [];
  const lb = typeof o.lookbackHours === "number" && Number.isInteger(o.lookbackHours) && o.lookbackHours >= 1 && o.lookbackHours <= MAX_NOTICE_LOOKBACK_HOURS ? o.lookbackHours : DEFAULT_NOTICE_LOOKBACK_HOURS;
  const mb = typeof o.mailbox === "string" && ADDRESS_RE.test(o.mailbox.trim().toLowerCase()) ? o.mailbox.trim().toLowerCase() : null;
  const uniq = [...new Set(senders)].slice(0, MAX_SENDERS);
  return {
    // Turned on only when explicitly true AND there is at least one sender.
    enabled: o.enabled === true && uniq.length > 0,
    senders: uniq.length ? uniq : [FED_NOTICE_DOMAIN],
    mailbox: mb,
    lookbackHours: lb,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : null,
  };
}

/** The owner's settings form. Turning it ON needs a typed confirmation that the portal is still checked. */
export function checkSettingsForm(get: (k: string) => string | null | undefined): { ok: true; settings: Omit<NoticeMailSettings, "updatedAt" | "updatedBy"> } | { ok: false; error: string } {
  const enabled = (get("enabled") ?? "") === "on";
  const lines = (get("senders") ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: `Give at least one sender (the Fed's guide names ${FED_NOTICE_DOMAIN}).` };
  if (lines.length > MAX_SENDERS) return { ok: false, error: `At most ${MAX_SENDERS} senders.` };
  const senders: string[] = [];
  for (const l of lines) {
    const n = normalizeSender(l);
    if (!n) return { ok: false, error: `"${l.slice(0, 60)}" is not a domain (like ${FED_NOTICE_DOMAIN}) or an email address.` };
    if (!senders.includes(n)) senders.push(n);
  }
  const mbRaw = (get("mailbox") ?? "").trim().toLowerCase();
  if (mbRaw && !ADDRESS_RE.test(mbRaw)) return { ok: false, error: "The mailbox must be a full email address on your Google Workspace domain, or blank for the CCRS mailbox." };
  const lbRaw = (get("lookback_hours") ?? "").trim();
  let lookbackHours = DEFAULT_NOTICE_LOOKBACK_HOURS;
  if (lbRaw) {
    const n = Number(lbRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_NOTICE_LOOKBACK_HOURS) return { ok: false, error: `Look back must be a whole number of hours from 1 to ${MAX_NOTICE_LOOKBACK_HOURS}.` };
    lookbackHours = n;
  }
  if (enabled && (get("confirm") ?? "").trim().toUpperCase() !== "I STILL CHECK THE PORTAL") {
    return { ok: false, error: 'To turn it on, type I STILL CHECK THE PORTAL. The Fed says not to rely on these emails; this watch is a safety net.' };
  }
  return { ok: true, settings: { enabled, senders, mailbox: mbRaw || null, lookbackHours } };
}

// ------------------------------------------------------------------ query

/** Gmail q: `{from:a from:b} after:<epoch seconds>` (the `{ }` OR form, quote gmailOr). */
export function buildNoticeQuery(senders: readonly string[], nowMs: number, lookbackHours: number): string {
  const after = Math.floor((nowMs - lookbackHours * 3_600_000) / 1000);
  const froms = senders.map((s) => `from:${s}`);
  const who = froms.length === 1 ? froms[0] : `{${froms.join(" ")}}`;
  return `${who} after:${after}`;
}

/** Does the From address belong to one of the configured senders? (domain = exact or sub-domain). */
export function senderMatches(fromAddress: string | null, senders: readonly string[]): boolean {
  if (!fromAddress) return false;
  const a = fromAddress.toLowerCase();
  const domain = a.split("@")[1] ?? "";
  return senders.some((s) => (s.includes("@") ? a === s : domain === s || domain.endsWith(`.${s}`)));
}

/** The domain part only (what is stored in clear), or null. */
export function senderDomain(fromAddress: string | null): string | null {
  const d = (fromAddress ?? "").toLowerCase().split("@")[1] ?? "";
  return DOMAIN_RE.test(d) ? d : null;
}

// ------------------------------------------------------------------ link check

export type LinkVerdict = "none" | "portal_only" | "other_hosts";

/** Every distinct http(s) link host in the text, lower case, at most MAX_LINK_HOSTS. */
export function linkHosts(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/([^\s/?#"'<>()]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const host = m[1].toLowerCase().replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/\.$/, "");
    if (host && !out.includes(host)) out.push(host);
    if (out.length >= MAX_LINK_HOSTS) break;
  }
  return out;
}

export function isPortalHost(host: string): boolean {
  return host === FED_PORTAL_DOMAIN || host.endsWith(`.${FED_PORTAL_DOMAIN}`);
}

/** Quote fedLinkCheck: every link must go to achedi.com. Anything else is flagged. */
export function linkVerdict(hosts: readonly string[]): LinkVerdict {
  if (hosts.length === 0) return "none";
  return hosts.every(isPortalHost) ? "portal_only" : "other_hosts";
}

export const LINK_TEXT: Record<LinkVerdict, string> = {
  none: "No links in the email.",
  portal_only: "Every link goes to achedi.com (the Fed's portal). Still, type achedi.com yourself rather than clicking.",
  other_hosts: "A link goes somewhere that is NOT achedi.com. The Fed warns about look-alike sites. Do not click it; type achedi.com yourself, and tell Timberland at 1-800-562-8761 if it looks like phishing.",
};

// ------------------------------------------------------------------ sender check

export type NoticeAuth = "pass" | "fail" | "unknown";

/** Google's DMARC result only (shown, never blocking: what a real notice shows is not yet known). */
export function noticeAuth(authResults: readonly string[]): NoticeAuth {
  const all = authResults.join(" ; ").toLowerCase();
  if (/\bdmarc=fail\b/.test(all)) return "fail";
  if (/\bdmarc=pass\b/.test(all)) return "pass";
  return "unknown";
}

export const AUTH_WORD: Record<NoticeAuth, string> = {
  pass: "Google checked the sender (DMARC pass).",
  fail: "Google reports DMARC FAIL: treat this email as suspect.",
  unknown: "Google gave no DMARC result for this email.",
};

// ------------------------------------------------------------------ the stored row

export type NoticeMailInput = {
  gmailId: string;
  receivedAt: string | null;
  fromAddress: string | null;
  subject: string;
  text: string;
  labelIds: readonly string[];
  authResults: readonly string[];
  attachmentNames: readonly string[];
};

export type NoticeMailRow = {
  mailbox: string;
  gmail_id: string;
  received_at: string | null;
  from_domain: string | null;
  sender_ok: boolean;
  auth: NoticeAuth;
  in_spam: boolean;
  link_verdict: LinkVerdict;
  link_hosts: string[];
  attachment_count: number;
  subject_enc: string;
  body_enc: string;
};

/** Build the row. `enc` is encryptSecret; the store refuses to save when it did not encrypt. */
export function toNoticeRow(mailbox: string, m: NoticeMailInput, senders: readonly string[], enc: (s: string) => string): NoticeMailRow {
  const hosts = linkHosts(m.text);
  return {
    mailbox,
    gmail_id: m.gmailId,
    received_at: m.receivedAt,
    from_domain: senderDomain(m.fromAddress),
    sender_ok: senderMatches(m.fromAddress, senders),
    auth: noticeAuth(m.authResults),
    in_spam: m.labelIds.includes("SPAM") || m.labelIds.includes("TRASH"),
    link_verdict: linkVerdict(hosts),
    link_hosts: hosts,
    attachment_count: m.attachmentNames.length,
    subject_enc: enc(m.subject.slice(0, 500) || "(no subject)"),
    body_enc: enc(m.text.slice(0, MAX_NOTICE_BODY_CHARS) || "(no text)"),
  };
}

export function isEncrypted(v: string): boolean {
  return v.startsWith("encv1:");
}

// ------------------------------------------------------------------ the tick plan

export type TickPlan =
  | { run: false; reason: "off" | "not_configured" | "no_key"; text: string }
  | { run: true; mailbox: string; query: string };

/** Decide whether a tick touches Gmail at all. OFF means no Google call of any kind. */
export function planTick(s: NoticeMailSettings, mail: { configured: boolean; mailbox: string; why: string | null }, encryptionKeySet: boolean, nowMs: number): TickPlan {
  if (!s.enabled) return { run: false, reason: "off", text: "The notice-email watch is off (the owner turns it on in Banking > Notice email)." };
  if (!mail.configured) return { run: false, reason: "not_configured", text: `Google Workspace sign-in is not set up: ${mail.why ?? "see the CCRS email monitor set-up"}.` };
  if (!encryptionKeySet) return { run: false, reason: "no_key", text: "DATA_ENCRYPTION_KEY is not set, so bank email would be stored in clear. Nothing is fetched until the key is set." };
  return { run: true, mailbox: s.mailbox ?? mail.mailbox, query: buildNoticeQuery(s.senders, nowMs, s.lookbackHours) };
}

// ------------------------------------------------------------------ alert

export type AlertRow = { id: string; received_at: string | null; sender_ok: boolean; auth: NoticeAuth; link_verdict: LinkVerdict; in_spam: boolean };

/** One email per new message (claimed per Gmail id). Never claims what the notice says. */
export function noticeAlert(r: AlertRow, links: { page: string; log: string }): { subject: string; text: string } {
  const warn: string[] = [];
  if (!r.sender_ok) warn.push("The sender is not one of the senders you set: it may not be a real notice.");
  if (r.auth === "fail") warn.push(AUTH_WORD.fail);
  if (r.link_verdict === "other_hosts") warn.push(LINK_TEXT.other_hosts);
  if (r.in_spam) warn.push("Gmail put it in Spam or Trash. Mark it Not spam so the next one lands in the inbox.");
  return {
    subject: warn.length ? "Possible ACH notice email (check it: something looks off)" : "Possible ACH notice email: check the Fed portal today",
    text: [
      `An email that may announce a Timberland / Federal Reserve ACH notice arrived${r.received_at ? ` (${r.received_at.slice(0, 16).replace("T", " ")} UTC)` : ""}.`,
      "The site does NOT read the notice. Sign in to achedi.com yourself (type it; do not click a link) and to the Timberland portal's Reporting > Electronic Documents, read the notice, then log it on ACH operations:",
      links.log,
      ...warn,
      `The Fed keeps the report for ${FED_PORTAL_RETENTION_DAYS} calendar days. Download it to keep it longer.`,
      `Questions: Timberland Cash Management, 1-800-562-8761. This email never blocks a payment. Watch page: ${links.page}`,
    ].join("\n\n"),
  };
}

// ------------------------------------------------------------------ handling

export type NoticeMailState = "new" | "logged" | "not_a_notice";
export const STATE_WORD: Record<NoticeMailState, string> = { new: "Waiting", logged: "Logged on ACH operations", not_a_notice: "Not a notice" };

export function checkHandleForm(get: (k: string) => string | null | undefined): { ok: true; id: string; state: Exclude<NoticeMailState, "new">; note: string } | { ok: false; error: string } {
  const id = (get("mail_id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That email could not be identified. Reload the page." };
  const st = (get("state") ?? "").trim();
  if (st !== "logged" && st !== "not_a_notice") return { ok: false, error: "Choose Logged or Not a notice." };
  const note = (get("note") ?? "").trim();
  if (note.length < 10 || note.length > 500) return { ok: false, error: "Write 10 to 500 characters: what the portal showed, or why it is not a notice." };
  if (/[0-9]{7,}/.test(note.replace(/1-800-562-8761/g, ""))) return { ok: false, error: "No account or trace numbers in the note (7 or more digits in a row)." };
  return { ok: true, id, state: st, note };
}

export function noticeMailDbError(raw: string): string {
  if (/ach_notice_mail/.test(raw) && /does not exist|schema cache/.test(raw)) return "Apply migration 0290 (ach_notice_mail) first.";
  if (/NOTICE_MAIL_STAFF_ONLY/.test(raw)) return "Only the owner or an active admin can mark a notice email.";
  if (/NOTICE_MAIL_ONCE/.test(raw)) return "This email was already marked. It stays on record.";
  if (/NOTICE_MAIL_APPEND_ONLY/.test(raw)) return "Notice emails are never deleted or edited.";
  if (/NOTICE_MAIL_ENCRYPTED|body_enc|subject_enc/.test(raw)) return "The email was not encrypted, so it was not stored. Set DATA_ENCRYPTION_KEY.";
  return raw.slice(0, 300);
}

// ------------------------------------------------------------------ self-tests

export function __runAchNoticeMailCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ach-notice-mail-core FAIL: ${name}`);
    }
  };
  // settings
  ok(settingsFromJson(null).enabled === false, "missing settings = off");
  ok(settingsFromJson({ enabled: "yes", senders: ["a.com"] }).enabled === false, "enabled must be true, not truthy");
  ok(settingsFromJson({ enabled: true, senders: [] }).enabled === false, "no sender = off");
  ok(settingsFromJson({ enabled: true, senders: ["bad host"] }).senders[0] === FED_NOTICE_DOMAIN, "bad sender falls back to the Fed domain");
  ok(settingsFromJson({ enabled: true, senders: ["A.COM", "a.com"] }).senders.length === 1, "senders de-duplicated, lower-cased");
  ok(settingsFromJson({ lookbackHours: 9999 }).lookbackHours === DEFAULT_NOTICE_LOOKBACK_HOURS, "lookback out of range falls back");
  ok(settingsFromJson({ mailbox: "not an address" }).mailbox === null, "bad mailbox ignored");
  ok(normalizeSender("@Encryptedmail.Achedi.com") === FED_NOTICE_DOMAIN, "leading @ and case");
  ok(normalizeSender("ops@x.test") === "ops@x.test", "full address kept");
  ok(normalizeSender("x") === null && normalizeSender("a b.com") === null, "junk refused");
  // form
  const f = (o: Record<string, string>) => (k: string) => o[k];
  ok(checkSettingsForm(f({ senders: FED_NOTICE_DOMAIN })).ok, "off with one sender is fine");
  ok(!checkSettingsForm(f({ enabled: "on", senders: FED_NOTICE_DOMAIN })).ok, "turning on needs the typed confirmation");
  ok(checkSettingsForm(f({ enabled: "on", senders: FED_NOTICE_DOMAIN, confirm: "i still check the portal" })).ok, "confirmation is case-insensitive");
  ok(!checkSettingsForm(f({ senders: "" })).ok, "no sender refused");
  ok(!checkSettingsForm(f({ senders: "a.com,b.com,c.com,d.com,e.com,f.com" })).ok, "six senders refused");
  ok(!checkSettingsForm(f({ senders: "a.com", lookback_hours: "0" })).ok, "zero lookback refused");
  ok(!checkSettingsForm(f({ senders: "a.com", mailbox: "nope" })).ok, "bad mailbox refused");
  // query
  const now = Date.UTC(2026, 9, 21, 12);
  ok(buildNoticeQuery([FED_NOTICE_DOMAIN], now, 72) === `from:${FED_NOTICE_DOMAIN} after:${Date.UTC(2026, 9, 18, 12) / 1000}`, "one sender, epoch seconds");
  ok(buildNoticeQuery(["a.test", "b@c.test"], now, 1) === `{from:a.test from:b@c.test} after:${now / 1000 - 3600}`, "two senders use the { } OR form");
  // sender
  ok(senderMatches("noreply@encryptedmail.achedi.com", [FED_NOTICE_DOMAIN]), "exact domain");
  ok(senderMatches("x@mail.encryptedmail.achedi.com", [FED_NOTICE_DOMAIN]), "sub-domain");
  ok(!senderMatches("x@encryptedmail.achedi.com.evil.test", [FED_NOTICE_DOMAIN]), "look-alike suffix refused");
  ok(!senderMatches("x@xencryptedmail.achedi.com", [FED_NOTICE_DOMAIN]), "glued prefix refused");
  ok(senderMatches("ops@x.test", ["ops@x.test"]) && !senderMatches("other@x.test", ["ops@x.test"]), "full address is exact");
  ok(!senderMatches(null, [FED_NOTICE_DOMAIN]), "no sender, no match");
  ok(senderDomain("a@B.Test") === "b.test" && senderDomain("junk") === null, "domain only");
  // links
  ok(JSON.stringify(linkHosts("Open https://www.achedi.com/x?y and HTTP://ACHEDI.COM:443/z and https://www.achedi.com/q")) === '["www.achedi.com","achedi.com"]', "hosts distinct, lower-cased, port dropped");
  ok(linkVerdict(linkHosts("https://user@evil.test/achedi.com")) === "other_hosts", "userinfo trick caught");
  ok(linkVerdict(linkHosts("https://achedi.com.evil.test/")) === "other_hosts", "look-alike host flagged");
  ok(linkVerdict(linkHosts("https://secure.achedi.com/open")) === "portal_only", "portal sub-domain fine");
  ok(linkVerdict([]) === "none", "no links");
  ok(!isPortalHost("xachedi.com"), "glued prefix is not the portal");
  // auth
  ok(noticeAuth(["mx.google.com; dmarc=pass (p=REJECT)"]) === "pass", "dmarc pass");
  ok(noticeAuth(["dmarc=fail"]) === "fail", "dmarc fail");
  ok(noticeAuth([]) === "unknown", "no header");
  // row
  const enc = (s: string) => `encv1:${Buffer.from(s).toString("base64url")}`;
  const row = toNoticeRow("box@x.test", { gmailId: "abc123", receivedAt: "2026-10-21T10:00:00.000Z", fromAddress: "n@encryptedmail.achedi.com", subject: "Secure message", text: "Open https://www.achedi.com/m", labelIds: ["SPAM"], authResults: ["dmarc=pass"], attachmentNames: ["a.html"] }, [FED_NOTICE_DOMAIN], enc);
  ok(row.sender_ok && row.auth === "pass" && row.in_spam && row.link_verdict === "portal_only" && row.attachment_count === 1, "row facts");
  ok(isEncrypted(row.subject_enc) && isEncrypted(row.body_enc), "subject and body encrypted");
  ok(row.from_domain === FED_NOTICE_DOMAIN && !JSON.stringify(row).includes("n@encryptedmail"), "only the domain stored in clear");
  ok(!isEncrypted(toNoticeRow("b@x.test", { gmailId: "abc123", receivedAt: null, fromAddress: null, subject: "", text: "", labelIds: [], authResults: [], attachmentNames: [] }, [], (s) => s).body_enc), "no key -> not encrypted (the store refuses)");
  // tick plan
  const on: NoticeMailSettings = { ...DEFAULT_NOTICE_SETTINGS, enabled: true };
  const mail = { configured: true, mailbox: "box@x.test", why: null };
  ok(planTick(DEFAULT_NOTICE_SETTINGS, mail, true, now).run === false, "off by default: no Gmail call");
  const nc = planTick(on, { configured: false, mailbox: "box@x.test", why: "GMAIL_WIF_POOL_ID missing" }, true, now);
  ok(!nc.run && nc.reason === "not_configured" && /GMAIL_WIF_POOL_ID/.test(nc.text), "not configured, says why");
  const nk = planTick(on, mail, false, now);
  ok(!nk.run && nk.reason === "no_key", "no encryption key: nothing fetched");
  const go = planTick({ ...on, mailbox: "other@x.test" }, mail, true, now);
  ok(go.run && go.mailbox === "other@x.test" && go.query.startsWith(`from:${FED_NOTICE_DOMAIN} after:`), "runs on the owner's mailbox");
  const go2 = planTick(on, mail, true, now);
  ok(go2.run && go2.mailbox === "box@x.test", "blank mailbox = the CCRS mailbox");
  // alert
  const links = { page: "https://x.test/p", log: "https://x.test/l#notices" };
  const clean = noticeAlert({ id: "1", received_at: "2026-10-21T10:00:00Z", sender_ok: true, auth: "pass", link_verdict: "portal_only", in_spam: false }, links);
  ok(clean.subject === "Possible ACH notice email: check the Fed portal today", "clean subject");
  ok(clean.text.includes("does NOT read the notice") && clean.text.includes("1-800-562-8761") && clean.text.includes(links.log), "alert says it does not read, names the number, links the log");
  ok(clean.text.includes("never blocks a payment"), "never blocks");
  const odd = noticeAlert({ id: "1", received_at: null, sender_ok: false, auth: "fail", link_verdict: "other_hosts", in_spam: true }, links);
  ok(/something looks off/.test(odd.subject) && /not one of the senders/.test(odd.text) && /DMARC FAIL/.test(odd.text) && /NOT achedi\.com/.test(odd.text) && /Not spam/.test(odd.text), "every warning named");
  // handle form
  const id = "00000000-0000-4000-8000-000000000001";
  ok(checkHandleForm(f({ mail_id: id, state: "logged", note: "Portal showed an R03, logged it." })).ok, "logged ok");
  ok(!checkHandleForm(f({ mail_id: id, state: "new", note: "Portal showed an R03, logged it." })).ok, "cannot set back to new");
  ok(!checkHandleForm(f({ mail_id: "x", state: "logged", note: "Portal showed an R03, logged it." })).ok, "bad id");
  ok(!checkHandleForm(f({ mail_id: id, state: "logged", note: "short" })).ok, "short note");
  ok(!checkHandleForm(f({ mail_id: id, state: "logged", note: "trace 1234567 seen" })).ok, "digit run refused");
  ok(checkHandleForm(f({ mail_id: id, state: "not_a_notice", note: "Called 1-800-562-8761, it was a newsletter." })).ok, "the 1-800 number is fine");
  // db errors
  ok(/0290/.test(noticeMailDbError('relation "ach_notice_mail" does not exist')), "missing table named");
  ok(/already marked/.test(noticeMailDbError("NOTICE_MAIL_ONCE: x")), "once");
  ok(/DATA_ENCRYPTION_KEY/.test(noticeMailDbError("NOTICE_MAIL_ENCRYPTED")), "encryption");
  return { passed, failed };
}
