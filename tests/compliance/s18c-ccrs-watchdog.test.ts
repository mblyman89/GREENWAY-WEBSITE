/**
 * tests/compliance/s18c-ccrs-watchdog.test.ts   (CCRS Bible v2 slice S-18c)
 *
 * The CCRS watchdog: the owner is told (once) when an uploaded file has no
 * CCRS answer 60 minutes later, and when the mailbox monitor is failing or
 * has stopped. Pure decisions in ccrs-watchdog-core; the claims and sends run
 * through the REAL postgrest-js client against FakePostgrest (UNIQUE
 * dedupe_key -> 23505), as r50-a4 and s18b do; the tick runs end to end with
 * Gmail mocked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const NOW = Date.parse("2026-11-08T20:00:00Z");
const MAILBOX = "michael@greenwaymarijuana.com";
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const state = {
  db: null as unknown as FakePostgrest,
  svc: true,
  pushOn: false,
  pushCount: 1,
  emailOk: true,
  tokenError: null as string | null,
  emails: [] as { subject: string; html: string; to: string[] }[],
  pushes: [] as { title: string; body: string; url?: string; tag?: string }[],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return state.svc;
    },
  };
});
vi.mock("@/lib/notifications/push", () => ({
  isPushConfigured: () => state.pushOn,
  sendPushToAll: async (p: { title: string; body: string; url?: string; tag?: string }) => {
    state.pushes.push(p);
    return state.pushCount;
  },
}));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string; html: string; to: string[] }) => {
    state.emails.push(p);
    return state.emailOk ? { ok: true, recipients: p.to.length } : { ok: false, detail: "provider returned 500", didTimeout: false };
  },
}));
vi.mock("@/lib/compliance/ccrs-mail-fetch", () => ({
  getGmailAccessToken: async () => {
    if (state.tokenError) throw new Error(state.tokenError);
    return "tok";
  },
  listMessageIds: async () => ({ ids: [], truncated: false }),
  getMessage: async () => {
    throw new Error("not used");
  },
  getAttachmentText: async () => "",
}));

import { CCRS_EMAIL_SLA_MINUTES } from "@/lib/compliance/ccrs-outcome-core";
import { CcrsMailPanel } from "@/components/admin/compliance/CcrsMailPanel";
import { nextFailingSince, heartbeatFromSetting, shouldWriteHeartbeat, type MailHeartbeat } from "@/lib/compliance/ccrs-mail-core";
import {
  MAIL_DOWN_AFTER_MINUTES,
  MAIL_DOWN_STAGE,
  MAIL_STALE_STAGE,
  NO_EMAIL_STAGE,
  WATCHDOG_FILE_LIMIT,
  filesLink,
  mailDownKey,
  mailStaleKey,
  noEmailKey,
  noEmailMessage,
  planMonitorAlert,
  planNoEmail,
  successNamesFromAnalysis,
  __runCcrsWatchdogCoreTests,
  type OpenMail,
  type WaitingFile,
} from "@/lib/compliance/ccrs-watchdog-core";

const file = (over: Partial<WaitingFile> = {}): WaitingFile => ({
  id: "00000000-0000-4000-8000-0000000000f1",
  env: "prod",
  file_name: "Sale_413541_20261108120000.csv",
  file_type: "Sale",
  state: "uploaded",
  uploaded_at: iso(61),
  ...over,
});
const HEALTHY = { configured: true, healthy: true };

/* ------------------------------------------------------------------ */
describe("pure core: self-tests", () => {
  it("all pass", () => {
    const r = __runCcrsWatchdogCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(21);
  });
});

describe("planNoEmail: the 60-minute line is 0249's line", () => {
  it("the SLA is the one constant the hub button and 0249 use", () => {
    expect(CCRS_EMAIL_SLA_MINUTES).toBe(60);
    expect(read("supabase/migrations/0249_ccrs_upload_lifecycle.sql")).toContain("p_at < f.uploaded_at + interval '60 minutes'");
  });
  it("59:59 is not yet; 60:00 and later are due", () => {
    expect(planNoEmail([file({ uploaded_at: new Date(NOW - 60 * 60_000 + 1000).toISOString() })], [], HEALTHY, NOW)).toEqual([]);
    expect(planNoEmail([file({ uploaded_at: iso(60) })], [], HEALTHY, NOW)).toHaveLength(1);
    expect(planNoEmail([file({ uploaded_at: iso(600) })], [], HEALTHY, NOW)).toHaveLength(1);
  });
  it("only state 'uploaded' with a real upload time", () => {
    for (const s of ["draft", "emitted", "succeeded", "errored", "reconciling", "closed", "abandoned"]) {
      expect(planNoEmail([file({ state: s })], [], HEALTHY, NOW), s).toEqual([]);
    }
    expect(planNoEmail([file({ uploaded_at: null })], [], HEALTHY, NOW)).toEqual([]);
    expect(planNoEmail([file({ uploaded_at: "garbage" })], [], HEALTHY, NOW)).toEqual([]);
  });
  it("the item carries env, id, name and a normalized upload time; the key is per env and file", () => {
    const [i] = planNoEmail([file({ env: "preprod" })], [], HEALTHY, NOW);
    expect(i).toEqual({ dedupeKey: `ccrs_no_email:preprod:${file().id}`, fileId: file().id, env: "preprod", fileName: file().file_name, uploadedAt: iso(61), reason: "silence" });
    expect(noEmailKey("prod", "a")).not.toBe(noEmailKey("preprod", "a"));
  });
  it("reason: a stored, unapplied confirmation naming the file wins", () => {
    const mail: OpenMail[] = [
      { kind: "error", received_at: iso(30), fetched_at: iso(30), successNames: [] },
      { kind: "success", received_at: iso(59), fetched_at: iso(59), successNames: [file().file_name] },
    ];
    expect(planNoEmail([file()], mail, { configured: true, healthy: false }, NOW)[0].reason).toBe("unapplied-confirmation");
  });
  it("reason: a confirmation for ANOTHER file does not count", () => {
    const mail: OpenMail[] = [{ kind: "success", received_at: iso(59), fetched_at: iso(59), successNames: ["Strain_413541_20261108120000.csv"] }];
    expect(planNoEmail([file()], mail, HEALTHY, NOW)[0].reason).toBe("silence");
  });
  it("reason: error/unknown mail at or after the upload (1 minute clock slack) may be the answer; older mail is not", () => {
    const at = (kind: string, minAgo: number): OpenMail[] => [{ kind, received_at: iso(minAgo), fetched_at: iso(0), successNames: [] }];
    expect(planNoEmail([file()], at("error", 50), HEALTHY, NOW)[0].reason).toBe("error-mail-waiting");
    expect(planNoEmail([file()], at("unknown", 50), HEALTHY, NOW)[0].reason).toBe("error-mail-waiting");
    expect(planNoEmail([file()], at("error", 62), HEALTHY, NOW)[0].reason).toBe("error-mail-waiting");
    expect(planNoEmail([file()], at("error", 62.5), HEALTHY, NOW)[0].reason).toBe("silence");
    expect(planNoEmail([file()], at("not-ccrs", 10), HEALTHY, NOW)[0].reason).toBe("silence");
  });
  it("reason: no Gmail date -> the fetch time decides", () => {
    expect(planNoEmail([file()], [{ kind: "error", received_at: null, fetched_at: iso(5), successNames: [] }], HEALTHY, NOW)[0].reason).toBe("error-mail-waiting");
  });
  it("reason: monitor off or unhealthy -> check Gmail by hand", () => {
    expect(planNoEmail([file()], [], { configured: false, healthy: false }, NOW)[0].reason).toBe("monitor-off");
    expect(planNoEmail([file()], [], { configured: true, healthy: false }, NOW)[0].reason).toBe("monitor-off");
  });
});

describe("noEmailMessage", () => {
  const items = (n: number, env: "prod" | "preprod" = "prod") => planNoEmail(Array.from({ length: n }, (_, k) => file({ id: `id${k}`, env, file_name: `Sale_413541_2026110812000${k}.csv` })), [], HEALTHY, NOW);
  it("one file: names it in the subject; link to the right env's files", () => {
    const m = noEmailMessage(items(1), "https://www.greenwaymarijuana.com")!;
    expect(m.subject).toBe("CCRS: no answer for Sale_413541_20261108120000.csv after 60 minutes");
    expect(m.linkPath).toBe("/admin/compliance/ccrs#ccrs-files");
    expect(m.html).toContain('href="https://www.greenwaymarijuana.com/admin/compliance/ccrs#ccrs-files"');
    expect(m.text.length).toBeLessThanOrEqual(300);
    expect(noEmailMessage(items(1, "preprod"), "")!.linkPath).toBe("/admin/compliance/ccrs?env=preprod#ccrs-files");
    expect(filesLink("preprod")).toContain("env=preprod");
  });
  it("several files: one message, every file listed with its reason", () => {
    const m = noEmailMessage(items(3, "preprod"), "")!;
    expect(m.subject).toBe("CCRS: no answer for 3 PREprod files after 60 minutes");
    expect((m.html.match(/<li /g) ?? []).length).toBe(3);
    expect(m.html).toContain("No email after 60 minutes");
  });
  it("mixed envs: no env word, prod link", () => {
    const mixed = [...items(1, "prod"), ...items(1, "preprod")];
    const m = noEmailMessage(mixed, "")!;
    expect(m.subject).toBe("CCRS: no answer for 2 files after 60 minutes");
    expect(m.linkPath).toBe("/admin/compliance/ccrs#ccrs-files");
  });
  it("every reason has its own owner instruction; nothing claims an outcome was recorded", () => {
    const mk = (reason: string) => noEmailMessage([{ ...items(1)[0], reason: reason as never }], "")!.html;
    expect(mk("unapplied-confirmation")).toContain("Press Apply");
    expect(mk("error-mail-waiting")).toContain("never matches an error file to an upload by guess");
    expect(mk("monitor-off")).toContain("Inbox AND Spam");
    expect(mk("silence")).toContain("CCRS portal");
    for (const r of ["unapplied-confirmation", "error-mail-waiting", "monitor-off", "silence"]) expect(mk(r)).toContain("Nothing was recorded for you");
  });
  it("escapes file names", () => {
    expect(noEmailMessage([{ ...items(1)[0], fileName: "<img src=x>" }], "")!.html).not.toContain("<img");
  });
});

describe("planMonitorAlert", () => {
  const hb = (o: Partial<MailHeartbeat> = {}): MailHeartbeat => ({ lastRunAt: iso(1), lastOkAt: iso(120), ok: false, error: "invalid_grant", mode: "oauth-refresh", newMessages: 0, failingSince: iso(20), ...o });
  it("down: configured + failing for 15+ minutes, keyed on the outage start", () => {
    const a = planMonitorAlert(hb(), true, "Michael@GreenwayMarijuana.com", NOW, false, "https://s")!;
    expect(a.stage).toBe(MAIL_DOWN_STAGE);
    expect(a.dedupeKey).toBe(`ccrs_mail_down:michael@greenwaymarijuana.com:${iso(20)}`);
    expect(a.html).toContain("invalid_grant");
    expect(a.html).toContain("Inbox and Spam");
    expect(a.linkPath).toBe("/admin/compliance/ccrs#ccrs-mail");
    expect(MAIL_DOWN_AFTER_MINUTES).toBe(15);
    expect(planMonitorAlert(hb({ failingSince: iso(15) }), true, "m", NOW, false, "")).not.toBeNull();
    expect(planMonitorAlert(hb({ failingSince: new Date(NOW - 15 * 60_000 + 1000).toISOString() }), true, "m", NOW, false, "")).toBeNull();
  });
  it("never for 'not set up', a healthy monitor, or a heartbeat without an outage start", () => {
    expect(planMonitorAlert(hb(), false, "m", NOW, true, "")).toBeNull();
    expect(planMonitorAlert(hb({ ok: true, failingSince: null }), true, "m", NOW, false, "")).toBeNull();
    expect(planMonitorAlert(hb({ failingSince: null }), true, "m", NOW, false, "")).toBeNull();
    expect(planMonitorAlert(null, true, "m", NOW, false, "")).toBeNull();
  });
  it("stale: only when the daily check asks; key on the last run so one outage alerts once", () => {
    const old = hb({ ok: true, failingSince: null, lastRunAt: iso(46) });
    expect(planMonitorAlert(old, true, "m", NOW, false, "")).toBeNull();
    const a = planMonitorAlert(old, true, "m", NOW, true, "")!;
    expect(a.stage).toBe(MAIL_STALE_STAGE);
    expect(a.dedupeKey).toBe(mailStaleKey("m", iso(46)));
    expect(a.html).toContain("/api/cron/ccrs-mail");
    expect(planMonitorAlert(null, true, "m", NOW, true, "")!.dedupeKey).toBe("ccrs_mail_stale:m:never");
    expect(planMonitorAlert(hb({ ok: true, failingSince: null, lastRunAt: iso(44) }), true, "m", NOW, true, "")).toBeNull();
  });
  it("stale outranks down on the daily check (the cron is not running at all)", () => {
    expect(planMonitorAlert(hb({ lastRunAt: iso(90), failingSince: iso(200) }), true, "m", NOW, true, "")!.stage).toBe(MAIL_STALE_STAGE);
  });
  it("mailDownKey folds case", () => {
    expect(mailDownKey("A@B.com", "t")).toBe("ccrs_mail_down:a@b.com:t");
  });
});

describe("heartbeat carries the outage start (ccrs-mail-core)", () => {
  const base: MailHeartbeat = { lastRunAt: iso(5), lastOkAt: iso(5), ok: true, error: null, mode: "service-account", newMessages: 0, failingSince: null };
  it("nextFailingSince", () => {
    expect(nextFailingSince(base, false, "service-account", "T1")).toBe("T1");
    expect(nextFailingSince({ ...base, ok: false, failingSince: "T0" }, false, "service-account", "T1")).toBe("T0");
    expect(nextFailingSince({ ...base, ok: false, failingSince: "T0" }, false, "oauth-refresh", "T1")).toBe("T1");
    expect(nextFailingSince({ ...base, ok: false, failingSince: null }, false, "service-account", "T1")).toBe("T1");
    expect(nextFailingSince({ ...base, ok: false, failingSince: "T0" }, true, "service-account", "T1")).toBeNull();
    expect(nextFailingSince(null, false, null, "T1")).toBeNull();
    expect(nextFailingSince(null, false, "oauth-refresh", "T1")).toBe("T1");
  });
  it("read back from site_settings; an old-shape heartbeat reads as null", () => {
    expect(heartbeatFromSetting({ ...base, failingSince: "T0" })!.failingSince).toBe("T0");
    const { failingSince: _drop, ...old } = base;
    void _drop;
    expect(heartbeatFromSetting(old)!.failingSince).toBeNull();
  });
  it("a new outage start is written at once", () => {
    const failing = { ...base, ok: false, error: "x" };
    expect(shouldWriteHeartbeat(failing, { ...failing, failingSince: "T0" }, Date.parse(iso(4)))).toBe(true);
    expect(shouldWriteHeartbeat({ ...failing, failingSince: "T0" }, { ...failing, failingSince: "T0" }, Date.parse(iso(4)))).toBe(false);
  });
});

describe("successNamesFromAnalysis (0282 analysis.successes)", () => {
  it("reads the stored notices; anything else is []", () => {
    expect(successNamesFromAnalysis({ successes: [{ fileName: "A.csv", submittedAt: null }, { fileName: "" }, null, { fileName: 3 }] })).toEqual(["A.csv"]);
    expect(successNamesFromAnalysis({ successes: "x" })).toEqual([]);
    expect(successNamesFromAnalysis({})).toEqual([]);
    expect(successNamesFromAnalysis("x")).toEqual([]);
  });
  it("matches the stored shape toMailRow writes (successes: SuccessNotice[])", () => {
    const core = read("src/lib/compliance/ccrs-mail-core.ts");
    expect(core).toMatch(/successes: SuccessNotice\[\];/);
    expect(read("src/lib/compliance/ccrs-lifecycle-core.ts")).toMatch(/export type SuccessNotice = \{\s*\/\*\*[^*]*\*\/\s*fileName: string;/);
  });
});

/* ------------------------------------------------------------------ */
const env0 = { ...process.env };
function freshDb(): FakePostgrest {
  const db = new FakePostgrest();
  db.uniques.push({ table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" });
  db.uniques.push({ table: "site_settings", columns: ["key"], name: "site_settings_pkey" });
  db.uniques.push({ table: "ccrs_mail_messages", columns: ["mailbox", "gmail_id"], name: "ccrs_mail_messages_gmail_once" });
  db.defaults.set("compliance_reminder_log", () => ({ sent_at: new Date(NOW).toISOString() }));
  return db;
}
const fakeAdmin = async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never;
};
const putFile = (over: Record<string, unknown> = {}) => {
  const id = state.db.nextId();
  state.db.rows("ccrs_files").push({ id, env: "prod", file_name: `Sale_413541_${20261108120000 + state.db.rows("ccrs_files").length}.csv`, file_type: "Sale", state: "uploaded", uploaded_at: iso(61), purpose: "upload", ...over });
  return id;
};
const healthyHb = (): MailHeartbeat => ({ lastRunAt: iso(1), lastOkAt: iso(1), ok: true, error: null, mode: "oauth-refresh", newMessages: 0, failingSince: null });
const OAUTH = { GMAIL_OAUTH_CLIENT_ID: "cid", GMAIL_OAUTH_CLIENT_SECRET: "sec", GMAIL_OAUTH_REFRESH_TOKEN: "1//r" };

function reset() {
  state.db = freshDb();
  state.svc = true;
  state.emails = [];
  state.pushes = [];
  state.pushOn = false;
  state.pushCount = 1;
  state.emailOk = true;
  state.tokenError = null;
  process.env = { ...env0, RESEND_API_KEY: "re_x", ORDER_EMAIL_FROM: "alerts@greenwaymarijuana.com", ORDER_STAFF_EMAILS: MAILBOX, NEXT_PUBLIC_SITE_URL: "https://www.greenwaymarijuana.com" };
  for (const k of ["GMAIL_SA_CLIENT_EMAIL", "GMAIL_SA_PRIVATE_KEY", "GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "CCRS_MAILBOX_ADDRESS"]) delete process.env[k];
}

describe("runCcrsWatchdog: once per file (real postgrest-js against FakePostgrest)", () => {
  beforeEach(reset);
  const run = async (o: Partial<{ configured: boolean; heartbeat: MailHeartbeat | null; nowMs: number; checkStale: boolean }> = {}) => {
    const { runCcrsWatchdog } = await import("@/lib/compliance/ccrs-watchdog");
    return runCcrsWatchdog(await fakeAdmin(), { configured: true, mailbox: MAILBOX, heartbeat: healthyHb(), nowMs: NOW, checkStale: false, ...o });
  };

  it("claims, sends one email, records the channel; the next tick sends nothing and writes nothing", async () => {
    const id = putFile();
    const r1 = await run();
    expect(r1).toMatchObject({ planned: 1, sent: 1, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0 });
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toEqual([MAILBOX]);
    expect(state.emails[0].subject).toContain("no answer for Sale_413541_");
    const log = state.db.rows("compliance_reminder_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ dedupe_key: `ccrs_no_email:prod:${id}`, stage: NO_EMAIL_STAGE, channel: "email", recipients: MAILBOX });
    const writes = () => state.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD").length;
    const before = writes();
    const r2 = await run({ nowMs: NOW + 300_000 });
    expect(r2).toMatchObject({ planned: 0, sent: 0, alreadyClaimed: 1 });
    expect(state.emails).toHaveLength(1);
    expect(writes()).toBe(before);
  });

  it("a quiet tick (nothing waiting, monitor healthy) only reads", async () => {
    putFile({ uploaded_at: iso(30) });
    putFile({ state: "succeeded" });
    const r = await run();
    expect(r).toMatchObject({ planned: 0, sent: 0 });
    expect(state.db.log.every((q) => q.method === "GET" || q.method === "HEAD")).toBe(true);
  });

  it("several files crossing together: ONE message, one claim row per file", async () => {
    putFile();
    putFile();
    putFile({ env: "preprod" });
    state.pushOn = true;
    const r = await run();
    expect(r).toMatchObject({ planned: 3, sent: 3 });
    expect(state.emails).toHaveLength(1);
    expect(state.pushes).toHaveLength(1);
    expect(state.emails[0].subject).toBe("CCRS: no answer for 3 files after 60 minutes");
    expect(state.db.rows("compliance_reminder_log").map((l) => l.channel)).toEqual(["email+push", "email+push", "email+push"]);
  });

  it("a file another tick already claimed is left out of this message (23505 race)", async () => {
    const a = putFile();
    putFile();
    state.db.before = (req) => {
      if (req.method === "POST" && req.table === "compliance_reminder_log" && (req.body as { dedupe_key: string }).dedupe_key === `ccrs_no_email:prod:${a}`) {
        state.db.before = null;
        state.db.rows("compliance_reminder_log").push({ id: "x", dedupe_key: `ccrs_no_email:prod:${a}`, stage: NO_EMAIL_STAGE, channel: "email", recipients: "other tick" });
      }
    };
    const r = await run();
    expect(r).toMatchObject({ sent: 1, alreadyClaimed: 1 });
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].subject).not.toContain("2 files");
  });

  it("no channel configured: nothing claimed; it goes out once a channel exists", async () => {
    putFile();
    delete process.env.RESEND_API_KEY;
    const r = await run();
    expect(r).toMatchObject({ planned: 1, sent: 0, unsentNoChannel: 1 });
    expect(state.db.rows("compliance_reminder_log")).toHaveLength(0);
    process.env.RESEND_API_KEY = "re_x";
    expect((await run()).sent).toBe(1);
  });

  it("every channel failed after the claim: recorded undelivered, not retried", async () => {
    putFile();
    state.emailOk = false;
    const r = await run();
    expect(r).toMatchObject({ sent: 0, undelivered: 1 });
    expect(state.db.rows("compliance_reminder_log")[0].recipients).toBe("NOT DELIVERED - every channel failed");
    state.emailOk = true;
    expect((await run()).sent).toBe(0);
  });

  it("push only: sends push, records push", async () => {
    putFile();
    delete process.env.RESEND_API_KEY;
    state.pushOn = true;
    const r = await run();
    expect(r.sent).toBe(1);
    expect(state.pushes[0].url).toBe("/admin/compliance/ccrs#ccrs-files");
    expect(state.db.rows("compliance_reminder_log")[0]).toMatchObject({ channel: "push", recipients: "1 push device(s)" });
  });

  it("the reason comes from the stored mail: an unapplied confirmation naming the file", async () => {
    putFile({ file_name: "Sale_413541_20261108120000.csv" });
    state.db.rows("ccrs_mail_messages").push({ id: "m1", mailbox: MAILBOX, gmail_id: "g1", kind: "success", state: "new", received_at: iso(59), fetched_at: iso(58), analysis: { successes: [{ fileName: "Sale_413541_20261108120000.csv", submittedAt: null }] } });
    await run();
    expect(state.emails[0].html).toContain("Press Apply");
  });

  it("handled (applied/dismissed) or other-mailbox mail is ignored", async () => {
    putFile({ file_name: "Sale_413541_20261108120000.csv" });
    state.db.rows("ccrs_mail_messages").push({ id: "m1", mailbox: MAILBOX, gmail_id: "g1", kind: "success", state: "dismissed", received_at: iso(59), fetched_at: iso(58), analysis: { successes: [{ fileName: "Sale_413541_20261108120000.csv" }] } });
    state.db.rows("ccrs_mail_messages").push({ id: "m2", mailbox: "other@x.com", gmail_id: "g2", kind: "error", state: "new", received_at: iso(10), fetched_at: iso(10), analysis: {} });
    await run();
    expect(state.emails[0].html).toContain("found nothing from CCRS for this file");
  });

  it("monitor not set up: still alerts the file, says check Gmail by hand, never reads the mail table", async () => {
    putFile();
    await run({ configured: false, heartbeat: null });
    expect(state.emails[0].html).toContain("Inbox AND Spam");
    expect(state.db.log.some((q) => q.table === "ccrs_mail_messages")).toBe(false);
  });

  it("monitor stale (configured, last run 50 minutes ago) -> the file's reason is monitor-off", async () => {
    putFile();
    await run({ heartbeat: { ...healthyHb(), lastRunAt: iso(50) } });
    expect(state.emails[0].html).toContain("not watching right now");
  });

  it("reads at most WATCHDOG_FILE_LIMIT files, oldest first, only 'uploaded' and past the line", async () => {
    const q = () => state.db.log.find((r) => r.table === "ccrs_files")!.url.searchParams;
    await run();
    expect(q().get("state")).toBe("eq.uploaded");
    expect(q().get("uploaded_at")).toBe(`lte.${iso(60)}`);
    expect(q().get("order")).toBe("uploaded_at.asc");
    expect(q().get("limit")).toBe(String(WATCHDOG_FILE_LIMIT));
  });

  it("a file read error is a note, never a throw; the monitor check still runs", async () => {
    state.db.missing.add("ccrs_files");
    const hb = { ...healthyHb(), ok: false, error: "invalid_grant", failingSince: iso(20) };
    const r = await run({ heartbeat: hb });
    expect(r.notes.join()).toMatch(/file read failed/);
    expect(r.sent).toBe(1);
    expect(state.emails[0].subject).toBe("CCRS email monitor is failing");
  });

  it("monitor down alert: once per outage; a new outage alerts again", async () => {
    const hb = { ...healthyHb(), ok: false, error: "invalid_grant", failingSince: iso(20) };
    expect((await run({ heartbeat: hb })).sent).toBe(1);
    const writes = () => state.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD").length;
    const before = writes();
    const again = await run({ heartbeat: hb, nowMs: NOW + 300_000 });
    expect(again).toMatchObject({ planned: 0, sent: 0, alreadyClaimed: 1 });
    expect(writes()).toBe(before); // rule 12: the outage was alerted; later ticks only read
    expect(state.emails).toHaveLength(1);
    const next = { ...hb, failingSince: iso(-1) };
    expect((await run({ heartbeat: next, nowMs: NOW + 20 * 60_000 })).sent).toBe(1);
    expect(state.db.rows("compliance_reminder_log").map((l) => l.stage)).toEqual([MAIL_DOWN_STAGE, MAIL_DOWN_STAGE]);
  });

  it("a database that answers 500 everywhere: notes, no sends, never throws", async () => {
    putFile();
    state.db.before = () => ({ status: 500, body: { code: "XX000", message: "db down", details: null, hint: null } });
    const r = await run({ heartbeat: { ...healthyHb(), ok: false, failingSince: iso(20) } });
    expect(r.sent).toBe(0);
    expect(state.emails).toHaveLength(0);
    expect(r.notes.join()).toMatch(/file read failed[\s\S]*alert log read failed/);
  });
  it("an exception inside the pass is caught", async () => {
    const { runCcrsWatchdog } = await import("@/lib/compliance/ccrs-watchdog");
    const broken = { from: () => { throw new Error("boom"); } } as never;
    const r = await runCcrsWatchdog(broken, { configured: true, mailbox: MAILBOX, heartbeat: null, nowMs: NOW, checkStale: false });
    expect(r.notes).toEqual(["watchdog failed: boom"]);
  });
});

/* ------------------------------------------------------------------ */
describe("the 5-minute tick runs the watchdog on every path", () => {
  beforeEach(reset);

  it("not set up: the tick answers ok=false (routine), the watchdog alerts the waiting file", async () => {
    putFile();
    const { runCcrsMailTick } = await import("@/lib/compliance/ccrs-mail-store");
    const r = await runCcrsMailTick(NOW);
    expect(r.configured).toBe(false);
    expect(r.watchdog).toMatchObject({ sent: 1 });
    expect(state.emails[0].html).toContain("Inbox AND Spam");
    // "not set up" is not an outage
    const hb = state.db.rows("site_settings")[0].value_json as MailHeartbeat;
    expect(hb.failingSince).toBeNull();
  });

  it("configured and failing: the outage start is kept across ticks; the alert goes out at 15 minutes, once", async () => {
    Object.assign(process.env, OAUTH);
    state.tokenError = "Google token: invalid_grant (the refresh token was revoked or expired)";
    const { runCcrsMailTick } = await import("@/lib/compliance/ccrs-mail-store");
    const t0 = NOW;
    const r0 = await runCcrsMailTick(t0);
    expect(r0).toMatchObject({ ok: false, configured: true });
    expect(r0.watchdog).toMatchObject({ planned: 0, sent: 0 });
    const hb0 = state.db.rows("site_settings")[0].value_json as MailHeartbeat;
    expect(hb0.failingSince).toBe(new Date(t0).toISOString());
    for (const m of [5, 10]) expect((await runCcrsMailTick(t0 + m * 60_000)).watchdog!.sent).toBe(0);
    const r15 = await runCcrsMailTick(t0 + 15 * 60_000);
    expect(r15.watchdog!.sent).toBe(1);
    expect(state.emails[0].subject).toBe("CCRS email monitor is failing");
    expect(state.emails[0].html).toContain("invalid_grant");
    expect((await runCcrsMailTick(t0 + 20 * 60_000)).watchdog!.sent).toBe(0);
    expect((state.db.rows("site_settings")[0].value_json as MailHeartbeat).failingSince).toBe(new Date(t0).toISOString());
  });

  it("recovery clears the outage start", async () => {
    Object.assign(process.env, OAUTH);
    state.tokenError = "boom";
    const { runCcrsMailTick } = await import("@/lib/compliance/ccrs-mail-store");
    await runCcrsMailTick(NOW);
    state.tokenError = null;
    const r = await runCcrsMailTick(NOW + 5 * 60_000);
    expect(r.ok).toBe(true);
    expect((state.db.rows("site_settings")[0].value_json as MailHeartbeat).failingSince).toBeNull();
  });

  it("database not configured: no watchdog (nothing to read)", async () => {
    state.svc = false;
    const { runCcrsMailTick } = await import("@/lib/compliance/ccrs-mail-store");
    const r = await runCcrsMailTick(NOW);
    expect(r.watchdog).toBeNull();
  });
});

describe("the daily cron asks whether the 5-minute cron stopped", () => {
  beforeEach(reset);

  it("stale heartbeat -> one 'stopped checking' alert per last-run value", async () => {
    Object.assign(process.env, OAUTH);
    state.db.rows("site_settings").push({ key: "ccrs_mail_heartbeat", value_json: { ...healthyHb(), lastRunAt: iso(300) } });
    const { runCcrsWatchdogDaily } = await import("@/lib/compliance/ccrs-mail-store");
    const r = await runCcrsWatchdogDaily(NOW);
    expect(r).toMatchObject({ sent: 1 });
    expect(state.emails[0].subject).toBe("CCRS email monitor has stopped checking");
    expect(state.db.rows("compliance_reminder_log")[0].dedupe_key).toBe(`ccrs_mail_stale:${MAILBOX}:${iso(300)}`);
    expect((await runCcrsWatchdogDaily(NOW + 86_400_000))!.sent).toBe(0);
  });

  it("not set up -> silent", async () => {
    const { runCcrsWatchdogDaily } = await import("@/lib/compliance/ccrs-mail-store");
    const r = await runCcrsWatchdogDaily(NOW);
    expect(r).toMatchObject({ planned: 0, sent: 0 });
  });

  it("the route calls it after the reminders and returns its result", () => {
    const R = read("src/app/api/cron/compliance-reminders/route.ts");
    expect(R).toContain('import { runCcrsWatchdogDaily } from "@/lib/compliance/ccrs-mail-store";');
    expect(R.indexOf("await runCcrsWatchdogDaily()")).toBeGreaterThan(R.indexOf("await runComplianceReminders()"));
    expect(R).toMatch(/\{ \.\.\.result, posSweep, reservationSweep, ccrsWatchdog \}/);
  });
});

/* ------------------------------------------------------------------ */
describe("guards", () => {
  const W = read("src/lib/compliance/ccrs-watchdog.ts");
  const C = read("src/lib/compliance/ccrs-watchdog-core.ts");
  it("drafts-only: nothing records an outcome, writes the ledger, or emails anyone but staff", () => {
    for (const t of [W, C]) {
      expect(t).not.toMatch(/recordOutcome|ccrs_record_outcome|\.from\("ccrs_files"\)\s*\.(update|insert|upsert|delete)/);
      expect(t).not.toMatch(/lcb\.wa\.gov"/);
    }
    expect(W).toContain('process.env.ORDER_STAFF_EMAILS');
  });
  it("the claim precedes the send, the send precedes the record", () => {
    const fn = W.split("async function claimAndSend(")[1];
    expect(fn.indexOf("await claim(admin")).toBeLessThan(fn.indexOf("await deliver("));
    expect(fn.indexOf("await deliver(")).toBeLessThan(fn.indexOf("await record(admin, won, d.channels"));
  });
  it("the core is pure (no server-only, no I/O)", () => {
    expect(C).not.toMatch(/server-only|createSupabaseAdminClient|fetch\(/);
  });
  it("the tick wires the watchdog inside finish (every path) and the result keeps it", () => {
    const S = read("src/lib/compliance/ccrs-mail-store.ts");
    const fin = S.split("const finish = async")[1].split("if (!cfg.configured)")[0];
    expect(fin).toContain("const watchdog = await runCcrsWatchdog(admin, { configured: cfg.configured, mailbox: cfg.mailbox, heartbeat: next, nowMs, checkStale: false });");
    expect(fin).toContain("return { ...r, watchdog };");
    expect(fin).toContain("failingSince: nextFailingSince(prev, r.ok, cfg.configured ? cfg.mode : null, nowIso),");
  });
  it("registered in the pure self-test runner with a floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("ccrs-watchdog-core", __runCcrsWatchdogCoreTests\(\), 21\)/);
  });
});

describe("the hub panel says the outage is being alerted", () => {
  const props = (hb: MailHeartbeat) => ({
    available: true,
    loadError: null,
    heartbeat: hb,
    uploadedFiles: [],
    canEdit: true,
    weekKey: "2026-11-01",
    nowISO: new Date(NOW).toISOString(),
    actions: { poll: async () => {}, applySuccess: async () => {}, applyError: async () => {}, dismiss: async () => {} },
    setup: { configured: true as const, mode: "oauth-refresh", mailbox: MAILBOX },
    rows: [],
  });
  const failing: MailHeartbeat = { lastRunAt: iso(1), lastOkAt: iso(120), ok: false, error: "invalid_grant", mode: "oauth-refresh", newMessages: 0, failingSince: iso(20) };
  it("failing with an outage start: says since when and that the owner is alerted", () => {
    const h = renderToStaticMarkup(createElement(CcrsMailPanel, props(failing) as never));
    expect(h).toContain('data-testid="ccrs-mail-unhealthy"');
    expect(h).toContain("Failing since");
    expect(h).toContain("alerted once after 15 minutes");
  });
  it("no outage start (old heartbeat): no such line", () => {
    const h = renderToStaticMarkup(createElement(CcrsMailPanel, props({ ...failing, failingSince: null }) as never));
    expect(h).not.toContain("Failing since");
  });
});
