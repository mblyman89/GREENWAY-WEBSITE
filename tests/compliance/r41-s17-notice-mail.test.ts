/**
 * R41 S17: the notice-email watch for the Fed's encrypted ACH notices.
 *
 *   1. every quote is verbatim in its mirror (whitespace flattened);
 *   2. the pure core: off by default, the typed confirmation, the Gmail
 *      query, sender match, link hosts (look-alikes), DMARC, the stored row
 *      is encrypted, the tick plan, the owner alert, the mark form;
 *   3. wiring: OFF returns before any Google call, the cron (hourly :50,
 *      fail-closed, never echoes ids), gates (settings owner-only, mark
 *      finances.view or settings.manage, email text finances.view only),
 *      links shown as text, the tab, help + concierge, ops hint;
 *   4. 0290 content pins, rollback, CI post-apply check, factory reset KEEP;
 *   5. docs, mutation logs (test the tests), public-repo rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as n from "@/lib/payments/ach-notice-mail-core";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import { TABLE_RULES } from "@/lib/accounting/factory-reset-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CORE = "src/lib/payments/ach-notice-mail-core.ts";
const STORE = "src/lib/payments/ach-notice-mail-store.ts";
const ACTION = "src/app/admin/settings/banking/notice-email-actions.ts";
const PAGE = "src/app/admin/settings/banking/notice-email/page.tsx";
const CRON = "src/app/api/cron/ach-notice-mail/route.ts";
const OPS = "src/app/admin/settings/banking/operations/page.tsx";
const MIG = "supabase/migrations/0290_ach_notice_mail.sql";
const NOW = Date.UTC(2026, 9, 21, 18, 0, 0);

const on = (over: Partial<n.NoticeMailSettings> = {}): n.NoticeMailSettings => ({ ...n.DEFAULT_NOTICE_SETTINGS, enabled: true, ...over });
const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;
const enc = (s: string) => `encv1:${Buffer.from(s).toString("base64")}`;

function input(over: Partial<n.NoticeMailInput> = {}): n.NoticeMailInput {
  return {
    gmailId: "18abcdef01",
    receivedAt: "2026-10-21T17:00:00.000Z",
    fromAddress: "noreply@encryptedmail.achedi.com",
    subject: "You have a secure message",
    text: "Open Message https://encryptedmail.achedi.com/x",
    labelIds: ["INBOX"],
    authResults: ["mx.google.com; dmarc=pass"],
    attachmentNames: [],
    ...over,
  };
}

describe("S17 quotes", () => {
  it("every quote is verbatim in its mirror, and every quote names a mirror", () => {
    expect(Object.keys(n.NOTICE_MAIL_QUOTES).sort()).toEqual(Object.keys(n.NOTICE_QUOTE_FILE).sort());
    for (const [k, q] of Object.entries(n.NOTICE_MAIL_QUOTES)) {
      const mirror = flat(read(`docs/authorities/${n.NOTICE_QUOTE_FILE[k as n.NoticeQuoteId]}`));
      expect(mirror.includes(flat(q)), k).toBe(true);
    }
  });
  it("the facts on screen come from those quotes", () => {
    expect(n.NOTICE_MAIL_QUOTES.fedSender).toContain(n.FED_NOTICE_DOMAIN);
    expect(n.NOTICE_MAIL_QUOTES.fedRetention).toContain(`${n.FED_PORTAL_RETENTION_DAYS} calendar days`);
    expect(n.NOTICE_MAIL_QUOTES.fedLinkCheck).toContain(n.FED_PORTAL_DOMAIN);
    expect(n.NOTICE_MAIL_QUOTES.gmailAnywhere).toContain("Spam and Trash");
  });
  it("the Gmail mirror is listed in the authorities README", () => {
    expect(read("docs/authorities/ach/README.md")).toContain("gmail-search-operators.txt");
  });
});

describe("S17 core: settings", () => {
  it("OFF by default, and anything malformed reads as OFF", () => {
    expect(n.DEFAULT_NOTICE_SETTINGS.enabled).toBe(false);
    expect(n.DEFAULT_NOTICE_SETTINGS.senders).toEqual([n.FED_NOTICE_DOMAIN]);
    expect(n.settingsFromJson(null).enabled).toBe(false);
    expect(n.settingsFromJson({ enabled: "true" }).enabled).toBe(false);
    expect(n.settingsFromJson({ enabled: true, senders: ["not a domain"] }).enabled).toBe(false);
    expect(n.settingsFromJson({ enabled: true, senders: [n.FED_NOTICE_DOMAIN] }).enabled).toBe(true);
  });
  it("turning it ON needs the typed confirmation; turning it OFF does not", () => {
    const base = { senders: n.FED_NOTICE_DOMAIN };
    const noConfirm = n.checkSettingsForm(form({ ...base, enabled: "on" }));
    expect(noConfirm.ok).toBe(false);
    if (!noConfirm.ok) expect(noConfirm.error).toContain("I STILL CHECK THE PORTAL");
    expect(n.checkSettingsForm(form({ ...base, enabled: "on", confirm: "i still check the portal" })).ok).toBe(true);
    expect(n.checkSettingsForm(form(base)).ok).toBe(true);
  });
  it("senders: domains or addresses, at most MAX_SENDERS, at least one", () => {
    expect(n.checkSettingsForm(form({ senders: "" })).ok).toBe(false);
    expect(n.checkSettingsForm(form({ senders: "a.test\nb.test\nc.test\nd.test\ne.test\nf.test" })).ok).toBe(false);
    expect(n.checkSettingsForm(form({ senders: "javascript:alert(1)" })).ok).toBe(false);
    expect(n.normalizeSender("@EncryptedMail.AchEDI.com")).toBe(n.FED_NOTICE_DOMAIN);
  });
  it("look-back is a whole number 1..MAX", () => {
    expect(n.checkSettingsForm(form({ senders: "a.test", lookback_hours: "0" })).ok).toBe(false);
    expect(n.checkSettingsForm(form({ senders: "a.test", lookback_hours: String(n.MAX_NOTICE_LOOKBACK_HOURS + 1) })).ok).toBe(false);
    expect(n.checkSettingsForm(form({ senders: "a.test", lookback_hours: "1.5" })).ok).toBe(false);
  });
});

describe("S17 core: query, sender, links, DMARC", () => {
  it("the Gmail query: one sender plain, several in { }, after = now - lookback", () => {
    expect(n.buildNoticeQuery([n.FED_NOTICE_DOMAIN], NOW, 72)).toBe(`from:${n.FED_NOTICE_DOMAIN} after:${NOW / 1000 - 72 * 3600}`);
    expect(n.buildNoticeQuery(["a.test", "b.test"], NOW, 1)).toBe(`{from:a.test from:b.test} after:${NOW / 1000 - 3600}`);
  });
  it("sender match: exact domain or sub-domain; a look-alike suffix does not match", () => {
    expect(n.senderMatches("x@encryptedmail.achedi.com", [n.FED_NOTICE_DOMAIN])).toBe(true);
    expect(n.senderMatches("x@mail.encryptedmail.achedi.com", [n.FED_NOTICE_DOMAIN])).toBe(true);
    expect(n.senderMatches("x@encryptedmail.achedi.com.evil.test", [n.FED_NOTICE_DOMAIN])).toBe(false);
    expect(n.senderMatches("x@evilencryptedmail.achedi.com", [n.FED_NOTICE_DOMAIN])).toBe(false);
    expect(n.senderMatches(null, [n.FED_NOTICE_DOMAIN])).toBe(false);
  });
  it("link hosts: achedi.com only is portal_only; a look-alike or user@host trick is other_hosts", () => {
    expect(n.linkVerdict(n.linkHosts("no links"))).toBe("none");
    expect(n.linkVerdict(n.linkHosts("https://encryptedmail.achedi.com/a https://achedi.com/b"))).toBe("portal_only");
    expect(n.linkVerdict(n.linkHosts("https://achedi.com.evil.test/a"))).toBe("other_hosts");
    expect(n.linkVerdict(n.linkHosts("https://achedi.com@evil.test/a"))).toBe("other_hosts");
    expect(n.linkVerdict(n.linkHosts("https://notachedi.com/a"))).toBe("other_hosts");
  });
  it("link hosts: the user@ part is dropped so the real host is judged; one bad link among good ones flags the email", () => {
    expect(n.linkHosts("https://someone@achedi.com/a")).toEqual(["achedi.com"]);
    expect(n.linkHosts("https://achedi.com@evil.test/a")).toEqual(["evil.test"]);
    expect(n.linkVerdict(n.linkHosts("https://someone@achedi.com/a"))).toBe("portal_only");
    expect(n.linkVerdict(n.linkHosts("https://achedi.com/a https://evil.test/b"))).toBe("other_hosts");
    expect(n.linkVerdict(["achedi.com", "evil.test"])).toBe("other_hosts");
  });
  it("DMARC: fail wins, pass, else unknown", () => {
    expect(n.noticeAuth(["dmarc=pass", "dmarc=fail"])).toBe("fail");
    expect(n.noticeAuth(["spf=pass dmarc=pass"])).toBe("pass");
    expect(n.noticeAuth([])).toBe("unknown");
  });
});

describe("S17 core: row, plan, alert, mark", () => {
  it("the stored row carries facts in clear and text only through enc()", () => {
    const r = n.toNoticeRow("box@x.test", input(), [n.FED_NOTICE_DOMAIN], enc);
    expect(r.sender_ok).toBe(true);
    expect(r.auth).toBe("pass");
    expect(r.link_verdict).toBe("portal_only");
    expect(n.isEncrypted(r.subject_enc) && n.isEncrypted(r.body_enc)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("secure message");
    const spam = n.toNoticeRow("box@x.test", input({ labelIds: ["SPAM"] }), [n.FED_NOTICE_DOMAIN], enc);
    expect(spam.in_spam).toBe(true);
    const plain = n.toNoticeRow("box@x.test", input(), [n.FED_NOTICE_DOMAIN], (s) => s);
    expect(n.isEncrypted(plain.subject_enc)).toBe(false);
  });
  it("the plan: off, not configured, no key, then run", () => {
    const mail = { configured: true, mailbox: "box@x.test", why: null };
    expect(n.planTick(n.DEFAULT_NOTICE_SETTINGS, mail, true, NOW)).toMatchObject({ run: false, reason: "off" });
    expect(n.planTick(on(), { ...mail, configured: false }, true, NOW)).toMatchObject({ run: false, reason: "not_configured" });
    expect(n.planTick(on(), mail, false, NOW)).toMatchObject({ run: false, reason: "no_key" });
    expect(n.planTick(on({ mailbox: "ops@x.test" }), mail, true, NOW)).toMatchObject({ run: true, mailbox: "ops@x.test" });
    expect(n.planTick(on(), mail, true, NOW)).toMatchObject({ run: true, mailbox: "box@x.test" });
  });
  it("the alert never claims to read the notice, names the bank line, never blocks", () => {
    const links = { page: "https://site.test/p", log: "https://site.test/l" };
    const good = n.noticeAlert({ id: "1", received_at: null, sender_ok: true, auth: "pass", link_verdict: "portal_only", in_spam: false }, links);
    expect(good.subject).toContain("check the Fed portal today");
    expect(good.text).toContain("does NOT read the notice");
    expect(good.text).toContain("1-800-562-8761");
    expect(good.text).toContain("never blocks a payment");
    const bad = n.noticeAlert({ id: "1", received_at: null, sender_ok: false, auth: "fail", link_verdict: "other_hosts", in_spam: true }, links);
    expect(bad.subject).toContain("something looks off");
    expect(bad.text).toContain(n.LINK_TEXT.other_hosts);
    expect(bad.text).toContain("Spam");
  });
  it("the mark form: uuid, a state, 10-500 characters, no 7+ digit runs (the bank's line is allowed)", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(n.checkHandleForm(form({ mail_id: id, state: "logged", note: "Logged R03 on operations." })).ok).toBe(true);
    expect(n.checkHandleForm(form({ mail_id: id, state: "new", note: "Logged R03 on operations." })).ok).toBe(false);
    expect(n.checkHandleForm(form({ mail_id: id, state: "logged", note: "short" })).ok).toBe(false);
    expect(n.checkHandleForm(form({ mail_id: id, state: "logged", note: "Account 1234567 returned" })).ok).toBe(false);
    expect(n.checkHandleForm(form({ mail_id: id, state: "not_a_notice", note: "Called 1-800-562-8761, not ours." })).ok).toBe(true);
    expect(n.checkHandleForm(form({ mail_id: "x", state: "logged", note: "Logged R03 on operations." })).ok).toBe(false);
  });
  it("database errors become plain words", () => {
    expect(n.noticeMailDbError('relation "ach_notice_mail" does not exist')).toContain("Apply migration 0290");
    expect(n.noticeMailDbError("NOTICE_MAIL_ONCE")).toContain("already marked");
    expect(n.noticeMailDbError("NOTICE_MAIL_ENCRYPTED")).toContain("DATA_ENCRYPTION_KEY");
  });
  it("the pure self-test is registered with its floor", () => {
    expect(n.__runAchNoticeMailCoreTests().failed).toBe(0);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ach-notice-mail-core", __runAchNoticeMailCoreTests(), 57)');
  });
});

describe("S17 wiring", () => {
  const store = read(STORE);
  it("OFF returns before the mail configuration or any Google call", () => {
    const tick = store.slice(store.indexOf("export async function runNoticeMailTick"));
    const off = tick.indexOf('if (!settings.enabled) return { ...base, reason: "off" };');
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(tick.indexOf("mailConfigFromEnv("));
    expect(off).toBeLessThan(tick.indexOf("getGmailAccessToken("));
  });
  it("reuses the CCRS Workspace sign-in (no new Google code)", () => {
    expect(store).toContain('from "@/lib/compliance/ccrs-mail-fetch"');
    expect(store).toContain("getGmailAccessToken({ ...cfg, mailbox: plan.mailbox }, nowMs)");
    expect(store).not.toMatch(/googleapis\.com/);
  });
  it("never stores in clear; the insert is the claim; the alert is claimed per row and released on failure", () => {
    expect(store).toContain("if (!isEncrypted(row.subject_enc) || !isEncrypted(row.body_enc)) throw");
    expect(store).toContain('upsert(row, { onConflict: "mailbox,gmail_id", ignoreDuplicates: true })');
    expect(store).toContain("dedupe_key: dedupeKey, stage: \"ach-notice-mail\"");
    expect(store).toContain('else await admin.from("compliance_reminder_log").delete().eq("dedupe_key", dedupeKey);');
    expect(store).toContain('.order("fetched_at", { ascending: false })');
  });
  it("the list read is paged (no silent 1,000-row cap) and the mark is once", () => {
    expect(store).toContain("pagedAllChecked<StoredNoticeMail>");
    expect(store).toMatch(/\.order\("id", \{ ascending: true \}\)\.range\(from, to\)/);
    expect(store.replace(/\/\/.*$/gm, "")).not.toMatch(/\.limit\(/);
    expect(store).toMatch(/\.eq\("id", i\.id\)\s*\.eq\("state", "new"\)/);
  });
  it("the cron: fail-closed preamble, OFF is a 200, never echoes ids or failures text", () => {
    const c = read(CRON);
    expect(c).toContain("shouldRefuseWhenSecretMissing(secret)");
    expect(c).toContain("header === `Bearer ${secret}`");
    expect(c).toContain('if (r.reason === "off") return NextResponse.json({ ok: true, ran: false, reason: "off" });');
    expect(c).toContain("failures: r.failures.length");
    expect(c).not.toMatch(/failures: r\.failures[,\s}]/);
  });
  it("vercel.json: hourly at :50, a minute no other cron uses", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const mine = v.crons.filter((c) => c.path === "/api/cron/ach-notice-mail");
    expect(mine).toEqual([{ path: "/api/cron/ach-notice-mail", schedule: "50 * * * *" }]);
    expect(new Set(v.crons.map((c) => c.schedule)).size).toBe(v.crons.length);
  });
  it("gates: settings and Check now are owner-only; marking is finances.view or settings.manage; the page is settings.manage", () => {
    const a = read(ACTION);
    const fn = (name: string) => a.slice(a.indexOf(`export async function ${name}`), a.indexOf("\n}\n", a.indexOf(`export async function ${name}`)));
    expect(fn("saveNoticeSettingsAction")).toContain('requirePermission("ach.act")');
    expect(fn("checkNowAction")).toContain('requirePermission("ach.act")');
    expect(fn("markNoticeMailAction")).toMatch(/can\(session\.profile\.role, "finances\.view"\) \|\| can\(session\.profile\.role, "settings\.manage"\)/);
    for (const act of ["ach.notice_mail.settings_saved", "ach.notice_mail.checked_now", "ach.notice_mail.marked"]) expect(a).toContain(`action: "${act}"`);
    const p = read(PAGE);
    expect(p).toContain('requirePermission("settings.manage")');
    expect(p).toContain('const canRead = can(session.profile.role, "finances.view");');
    expect(p).toContain("if (canRead) {");
    expect(p).toContain("{isOwner ? (\n            <form action={saveNoticeSettingsAction}");
  });
  it("the page never makes a link out of a link found in an email", () => {
    const p = read(PAGE);
    expect(p).toContain("never clickable");
    expect(p).not.toMatch(/href=\{[^}]*link_hosts/);
    expect(p).not.toMatch(/href=\{`https?:\/\/\$\{/);
    expect(p).not.toContain("dangerouslySetInnerHTML");
  });
  it("tab, help, concierge, ops hint", () => {
    expect(BANKING_HELP_TABS).toContainEqual({ key: "noticemail", href: "/admin/settings/banking/notice-email", label: "Notice email" });
    expect(read(PAGE)).toContain('active="noticemail"');
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/settings/banking/notice-email"');
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Notice email is /admin/settings/banking/notice-email, "); // R41 S18 appended "Policies is ..." after it
    expect(kb).toContain("Notice email (R41 S17");
    expect(read(OPS)).toContain('href="/admin/settings/banking/notice-email"');
  });
});

describe("0290 content pins", () => {
  const m = read(MIG);
  it("CI runs the 0290 check after every migration", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ach-notice-mail-0290-pg-check.sql", mustPrint: "ACH 0290 CHECK PASSED" });
    expect(read("scripts/recon/ach-notice-mail-0290-pg-check.sql")).toContain("ACH 0290 CHECK PASSED");
  });
  it("one row per (mailbox, gmail_id); encrypted; append-only; marked once by staff", () => {
    expect(m).toContain("constraint anm_unique_message unique (mailbox, gmail_id)");
    for (const code of ["NOTICE_MAIL_APPEND_ONLY", "NOTICE_MAIL_ENCRYPTED", "NOTICE_MAIL_ONCE", "NOTICE_MAIL_STAFF_ONLY"]) expect(m).toContain(code);
    expect(m).toContain("public.ach_write_by_owner(new.handled_by)");
    expect(m).toContain("enable row level security");
    expect(m).toContain("revoke delete, truncate on table public.ach_notice_mail from service_role;");
    expect(m).toContain("revoke all on table public.ach_notice_mail from anon;");
    expect(m.replace(/--.*$/gm, "")).not.toMatch(/security definer/i);
  });
  it("the rollback refuses while a row exists", () => {
    expect(read("supabase/rollbacks/0290_ach_notice_mail.rollback.sql")).toContain("ROLLBACK REFUSED");
  });
  it("factory reset keeps it", () => {
    expect(TABLE_RULES).toContainEqual(expect.objectContaining({ table: "ach_notice_mail", disposition: "KEEP" }));
  });
});

describe("S17 docs", () => {
  it("MIGRATIONS_TO_RUN, TEST-PLAN T-376, the manual, the roadmap", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("## R41 \u2014 0290 \u2014 Notice email");
    expect(d).toContain("Apply it **after 0289**.");
    expect(d).toContain("ACH 0290 CHECK PASSED");
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-376 (");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-376"');
    expect(man).toContain('"T-376": "part-b--the-results-log"');
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S17 | Notice email");
    expect(r).toContain("## S17 in detail");
  });
});

describe("S17 mutation runs (test the tests)", () => {
  const pin = (scriptPath: string, logPath: string, floor: number) => {
    const script = read(scriptPath);
    const log = read(logPath);
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const mm = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(mm, "clean summary line").not.toBeNull();
    expect(Number(mm![1])).toBe(listed);
    expect(Number(mm![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(floor);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  };
  it("scripts/r41/mutate-0290-sql.last.log: 29 SQL mutants killed, plus the rolled-back and rollback-refuses probes", () => {
    pin("scripts/r41/mutate-0290-sql.py", "scripts/r41/mutate-0290-sql.last.log", 29);
    const log = read("scripts/r41/mutate-0290-sql.last.log");
    expect(log).toMatch(/killed {3}rolled-back/);
    expect(log).toMatch(/killed {3}rollback-refuses/);
  });
  it("scripts/r41/mutate-s17-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s17-app.py", "scripts/r41/mutate-s17-app.last.log", 20);
  });
});

describe("S17 public-repo rules", () => {
  const files = [CORE, STORE, ACTION, PAGE, CRON, MIG, "supabase/rollbacks/0290_ach_notice_mail.rollback.sql", "scripts/recon/ach-notice-mail-0290-pg-check.sql"];
  it("one phone only, no real emails, no long digit runs", () => {
    for (const f of files) {
      const s = read(f);
      const phones = s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? [];
      expect(phones.filter((p) => !p.endsWith("562-8761")), f).toEqual([]);
      const emails = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? [];
      // Only test addresses (.test) and the Fed's own published sender domain.
      expect(emails.filter((e) => !/\.test$/.test(e) && !/achedi\.com$/.test(e)), f).toEqual([]);
      expect(s.replace(/[0-9a-f]{64}/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "").replace(/https:\/\/\S+/g, ""), f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
  it("the Gmail mirror only holds Google's example.com addresses", () => {
    const s = read("docs/authorities/ach/gmail-search-operators.txt");
    const emails = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    expect(emails.filter((e) => !e.endsWith("@example.com"))).toEqual([]);
  });
});
