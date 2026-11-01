/**
 * tests/compliance/s18b-ccrs-error-strategy.test.ts   (CCRS Bible v2 slice S-18b)
 *
 * The strategy report for a CCRS error email, and the once-only owner alert.
 *
 * Grounding:
 *   - every real error CSV CCRS ever sent us (14 from 2026-09-17, 1 from
 *     P20261005A) is run through the report;
 *   - every guide / FAQ line the playbook quotes is embedded in
 *     SOURCE_QUOTES and re-checked against lcb/guide.txt and lcb/faq.txt
 *     wherever those files exist (the build sandbox; check_pins.py reads the
 *     same files), and the examiner line against the in-repo thread, always;
 *   - the alert runs through the REAL postgrest-js client against
 *     FakePostgrest (unique dedupe_key -> 23505), as r50-a4 does.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const EV = "docs/ccrs-bible/evidence";
const RUN = `${EV}/2026-09-17-preprod-run`;
const NOW = Date.parse("2026-11-08T20:00:00Z");

const state = {
  db: null as unknown as FakePostgrest,
  pushOn: false,
  pushCount: 1,
  emailOk: true,
  emails: [] as { subject: string; html: string; to: string[] }[],
  pushes: [] as { title: string; body: string; url?: string; tag?: string }[],
};

vi.mock("server-only", () => ({}));
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

import { CCRS_KNOWN_MESSAGES } from "@/lib/compliance/ccrs-outcome-core";
import { readErrorAttachment, type ErrorAttachment } from "@/lib/compliance/ccrs-mail-core";
import {
  buildCcrsStrategy,
  findingsFor,
  mailAlertKey,
  planMailAlert,
  MAIL_ALERT_LINK,
  MAIL_ALERT_LOOKBACK_DAYS,
  MAIL_ALERT_STAGE,
  RESEND_GROUP,
  SOURCE_QUOTES,
  STRATEGY_PLAYBOOK,
  __runCcrsStrategyCoreTests,
} from "@/lib/compliance/ccrs-strategy-core";
import { CcrsStrategyReport } from "@/components/admin/compliance/CcrsStrategyReport";
import { CcrsMailPanel, type CcrsMailPanelRow } from "@/components/admin/compliance/CcrsMailPanel";

const CTX = { licenseNumber: "413541", licenseeName: "Greenway Marijuana", contactEmail: "michael@greenwaymarijuana.com" };

const ERROR_FILES = [
  ...readdirSync(path.join(ROOT, RUN, "errors")).sort().map((f) => `${RUN}/errors/${f}`),
  `${EV}/P20261005A/Product__20261006T113333390.csv`,
  // R74 S46: the first "Duplicate Sale for Licensee" (re-upload of the accepted 2026-10-20 Sale file).
  `${EV}/2026-10-25-reupload/errors/Sale__20261025T123200526.csv`,
  // R74 S47: the first "Invalid InventoryExternalIdentifier" (week 10/25: Product refused whole, cascade).
  `${EV}/2026-10-25-week/errors/Sale__20261025T142209583.csv`,
  // P-F: the first "UpdatedBy/UpdatedDate is required" and "Strain is required" (2026-10-31).
  `${EV}/2026-10-31-preprod/errors/Product__20261031T185120035.csv`,
  `${EV}/2026-10-31-preprod/errors/Inventory__20261031T182905659.csv`,
];
const real = (p: string): ErrorAttachment => readErrorAttachment(path.basename(p), read(p))!;

/* ------------------------------------------------------------------ */
describe("grounding: the quoted sources are verbatim", () => {
  const GUIDE = path.resolve(ROOT, "../lcb/guide.txt");
  const FAQ = path.resolve(ROOT, "../lcb/faq.txt");
  const trim = (s: string) => s.replace(/^[\s\f\uf0a7\u25a0\u2022]+/, "").trimEnd();
  it.runIf(existsSync(GUIDE))("every embedded guide line equals lcb/guide.txt", () => {
    const g = readFileSync(GUIDE, "utf8").split("\n");
    for (const [n, text] of Object.entries(SOURCE_QUOTES.G)) expect(trim(g[Number(n) - 1] ?? ""), `G L${n}`).toBe(text);
  });
  it.runIf(existsSync(FAQ))("every embedded FAQ line equals lcb/faq.txt", () => {
    const f = readFileSync(FAQ, "utf8").split("\n");
    for (const [n, text] of Object.entries(SOURCE_QUOTES.FAQ)) expect(trim(f[Number(n) - 1] ?? ""), `FAQ L${n}`).toBe(text);
  });
  it("the examiner line equals the in-repo thread (always checked)", () => {
    const t = read(`${EV}/2026-10-19-owner-request/owner-request-verbatim.txt`).split("\n");
    for (const [n, text] of Object.entries(SOURCE_QUOTES.EXAM)) expect(t[Number(n) - 1], `EXAM L${n}`).toBe(text);
  });
  it("every pin the playbook, the notes and the core cite has its lines embedded", () => {
    const core = read("src/lib/compliance/ccrs-strategy-core.ts").split("export function __runCcrsStrategyCoreTests")[0];
    const pins = [...core.matchAll(/\[(G|FAQ|EXAM) L(\d{4})(?:-L(\d{4}))?\]/g)];
    expect(pins.length).toBeGreaterThan(15);
    for (const m of pins) {
      const src = m[1] as "G" | "FAQ" | "EXAM";
      const a = Number(m[2]);
      const b = m[3] ? Number(m[3]) : a;
      expect(b, m[0]).toBeGreaterThanOrEqual(a);
      for (let n = a; n <= b; n += 1) expect(SOURCE_QUOTES[src][n], `${m[0]} L${n}`).toBeDefined();
    }
  });
  it("meanings say what the quoted lines say (spot checks that tie text to source)", () => {
    expect(SOURCE_QUOTES.G[434]).toContain("Unit Weight Gram cannot be 0");
    expect(STRATEGY_PLAYBOOK["If Useable Cannabis is selected Unit Weight Gram cannot be Zero"].cite).toEqual(["[G L0434]"]);
    expect(SOURCE_QUOTES.FAQ[35]).toContain("$0.01");
    expect(STRATEGY_PLAYBOOK["Total Cost cannot equal zero"].fix[0]).toContain("$0.01");
    expect(SOURCE_QUOTES.G[530]).toContain("at least 10 minutes");
    expect(STRATEGY_PLAYBOOK["Invalid Product"].fix.join(" ")).toContain("at least 10 minutes");
    expect(SOURCE_QUOTES.G[326]).toBe("action to take for correction.");
    expect(STRATEGY_PLAYBOOK["Duplicate Strain. The Strain must be unique for the LicenseNumber"].action).toBe("none");
    expect(SOURCE_QUOTES.G[203]).toContain("will fail to process");
    expect(STRATEGY_PLAYBOOK["CheckSum and number of records don't match"].action).toBe("whole-file");
    expect(SOURCE_QUOTES.FAQ[53]).toContain("The record doesn't exist");
    expect(STRATEGY_PLAYBOOK["ExternalIdentifier not found"].cite).toContain("[FAQ L0053]");
    expect(SOURCE_QUOTES.G[1378]).toBe("Only Medical Sales can be 0");
    expect(SOURCE_QUOTES.G[1377]).toContain("37%");
    expect(STRATEGY_PLAYBOOK["Only Medical Sales Excise tax can be 0"].fix[0]).toContain("37%");
  });
});

describe("the playbook covers exactly what CCRS has sent us", () => {
  it("one entry per CCRS_KNOWN_MESSAGES text, same class, same PREprod source", () => {
    expect(Object.keys(STRATEGY_PLAYBOOK).sort()).toEqual(CCRS_KNOWN_MESSAGES.map((m) => m.text).sort());
    for (const m of CCRS_KNOWN_MESSAGES) {
      const e = STRATEGY_PLAYBOOK[m.text];
      expect(e.cls, m.text).toBe(m.cls);
      // the PREprod run named by the playbook is the one in the known-message list
      expect(m.source, m.text).toContain(e.seen.split(" ")[0]);
    }
  });
  it("action follows class: benign -> none, file-fatal -> whole-file, contradicts-ledger -> confirm, row -> fix-resend", () => {
    const want = { benign: "none", "file-fatal": "whole-file", "row-contradicts-ledger": "confirm", row: "fix-resend" } as const;
    for (const e of Object.values(STRATEGY_PLAYBOOK)) expect(e.action).toBe(want[e.cls]);
  });
  it("each known message appears in at least one real error CSV (no entry rests on nothing)", () => {
    const all = ERROR_FILES.map(read).join("\n");
    for (const t of Object.keys(STRATEGY_PLAYBOOK)) expect(all, t).toContain(t);
  });
  it("a confirm entry never tells the owner to re-send as Insert", () => {
    for (const e of Object.values(STRATEGY_PLAYBOOK).filter((x) => x.action === "confirm")) {
      expect(e.fix.join(" ")).toMatch(/Never re-send it as Insert|has to be sent as Insert/);
      expect(e.fix.join(" ")).toContain("servicedesk@lcb.wa.gov");
    }
  });
});

describe("every real error CSV gets a report with no examiner escalation", () => {
  it.each(ERROR_FILES)("%s", (p) => {
    const e = real(p);
    const s = buildCcrsStrategy([e], CTX);
    expect(s.files).toHaveLength(1);
    const f = s.files[0];
    expect(f.fileType).not.toBeNull();
    expect(f.scope).not.toBe("unknown");
    expect(s.examinerDraft).toBeNull();
    expect(f.findings.reduce((n, x) => n + x.rows, 0)).toBe(e.dataLines);
    for (const x of f.findings) expect(x.entry).not.toBeNull();
  });
  it("the scope of each real file is what was observed", () => {
    const scope = (n: string) => buildCcrsStrategy([real(ERROR_FILES.find((p) => p.endsWith(n))!)], CTX).files[0].scope;
    expect(scope("Inventory__20260917T134023354.csv")).toBe("whole-file"); // T-54 checksum
    expect(scope("Strain_20260917T125413969.csv")).toBe("none"); // duplicate strain
    expect(scope("Product__20260917T130607115.csv")).toBe("listed-rows"); // unit weight
    expect(scope("Product__20261006T113333390.csv")).toBe("listed-rows"); // comma rows
    expect(scope("Area__20260917T130607480.csv")).toBe("listed-rows"); // duplicate external id (confirm)
  });
  it("ids are read only from rows that split cleanly; the 3 shifted P20261005A rows are counted, not guessed", () => {
    const f = findingsFor(real(`${EV}/P20261005A/Product__20261006T113333390.csv`));
    expect(f).toHaveLength(1);
    expect(f[0].message).toBe("Operation is invalid must be Insert, Update or Delete");
    expect(f[0].rows).toBe(3);
    expect(f[0].ids).toEqual([]);
    expect(f[0].unreadableIds).toBe(3);
  });
  it("a cleanly split file names its ids (Area, two rows)", () => {
    const f = findingsFor(real(`${RUN}/errors/Area__20260917T130607480.csv`));
    expect(f[0].rows).toBe(2);
    expect(f[0].ids.length).toBe(2);
    expect(f[0].unreadableIds).toBe(0);
    const csv = read(`${RUN}/errors/Area__20260917T130607480.csv`);
    for (const id of f[0].ids) expect(csv).toContain(`,${id},`);
  });
  it("the Inventory ErrorMessage column sits third; the id is still read from ExternalIdentifier", () => {
    const e = real(`${RUN}/errors/Inventory__20260917T131424499.csv`);
    expect(e.header.indexOf("ErrorMessage")).toBe(2);
    const f = findingsFor(e);
    expect(f[0].ids).toHaveLength(1);
    expect(f[0].ids[0]).toBe(read(`${RUN}/errors/Inventory__20260917T131424499.csv`).split(/\r?\n/)[1].split(",")[4]);
  });
  it("all 19 files at once: one report, dependency order, no draft", () => {
    const s = buildCcrsStrategy(ERROR_FILES.map(real), CTX);
    expect(s.files).toHaveLength(19);
    expect(s.examinerDraft).toBeNull();
    // Strain only ever had duplicate (none) and invalid-name (fix) -> it is re-sent; Area only 'confirm' -> not.
    expect(s.resendOrder).toEqual(["Strain", "Product", "Inventory", "InventoryAdjustment", "Sale"]);
    for (let i = 1; i < s.resendOrder.length; i += 1) expect(RESEND_GROUP[s.resendOrder[i]]).toBeGreaterThanOrEqual(RESEND_GROUP[s.resendOrder[i - 1]]);
    expect(s.notes.join(" ")).toContain("[G L0529-L0530]");
    expect(s.notes.join(" ")).toContain("[FAQ L0041]");
  });
});

describe("what is not known goes to the examiner, as a draft", () => {
  const mk = (filename: string, csv: string) => readErrorAttachment(filename, csv)!;
  it("a new message: scope unknown, never on the resend list, draft to examiner@lcb.wa.gov with the message", () => {
    const e = mk("Sale__20261108T1.csv", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S-1,Sale date is in the future\r\n");
    const s = buildCcrsStrategy([e], CTX);
    expect(s.files[0].scope).toBe("unknown");
    expect(s.resendOrder).toEqual([]);
    expect(s.examinerReasons).toEqual(['Sale__20261108T1.csv: "Sale date is in the future" has never been received before']);
    expect(s.examinerDraft!.to).toBe("examiner@lcb.wa.gov");
    expect(s.examinerDraft!.body).toContain("Sale date is in the future (1 row(s))");
    expect(s.examinerDraft!.body).toContain("413541");
    expect(s.examinerDraft!.body).toContain("michael@greenwaymarijuana.com");
    expect(s.examinerDraft!.subject).toContain("[week start] to [week end]");
  });
  it("a known week is used when given", () => {
    const e = mk("Sale__1.csv", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S-1,brand new\r\n");
    expect(buildCcrsStrategy([e], { ...CTX, weekStart: "2026-11-01", weekEnd: "2026-11-07" }).examinerDraft!.subject).toContain("2026-11-01 to 2026-11-07");
  });
  it("an unreadable message (shifted row, no known text) asks the examiner too", () => {
    const e = mk("Area__1.csv", "LicenseNumber,Area,ExternalIdentifier,ErrorMessage\r\n413541,a,b,c,d,e\r\n");
    const s = buildCcrsStrategy([e], CTX);
    expect(s.files[0].scope).toBe("unknown");
    expect(s.examinerReasons[0]).toBe("Area__1.csv: 1 line(s) whose message cannot be read");
  });
  it("a file whose name and header disagree asks the examiner, and it is never re-sent", () => {
    const e = mk("Inventory__1.csv", "LicenseNumber,Strain,ErrorMessage\r\n413541,Kush,Total Cost cannot equal zero\r\n");
    expect(e.fileType).toBeNull();
    const s = buildCcrsStrategy([e], CTX);
    expect(s.examinerReasons.join()).toContain("the name says Inventory");
    expect(s.resendOrder).toEqual([]);
    expect(s.examinerDraft).not.toBeNull();
  });
  it("known messages beside an unknown one keep their fix steps", () => {
    const a = mk("Product__1.csv", "LicenseNumber,ExternalIdentifier,ErrorMessage\r\n413541,P1,Operation is invalid must be Insert, Update or Delete\r\n413541,P2,Wholly new\r\n");
    const s = buildCcrsStrategy([a], CTX);
    expect(s.files[0].scope).toBe("unknown");
    expect(s.files[0].findings.map((x) => !!x.entry)).toEqual([true, false]);
    expect(s.examinerDraft!.body).toContain("Wholly new");
    expect(s.examinerDraft!.body).not.toContain("Operation is invalid");
  });
  it("headline names every bucket; empty input says so", () => {
    expect(buildCcrsStrategy([], CTX).headline).toBe("No error file in this email.");
    const s = buildCcrsStrategy([real(`${RUN}/errors/Inventory__20260917T134023354.csv`), real(`${RUN}/errors/Product__20260917T130607115.csv`)], CTX);
    expect(s.headline).toBe("1 file(s) refused whole: re-send them; 1 file(s) with refused rows: fix them, then re-send only those rows.");
    expect(buildCcrsStrategy([real(`${RUN}/errors/Strain_20260917T125746848.csv`)], CTX).headline).toContain("Nothing to fix");
  });
  it("one file: the 10-minute note is not added (nothing depends on it in this email)", () => {
    const s = buildCcrsStrategy([real(`${RUN}/errors/Product__20260917T130607115.csv`)], CTX);
    expect(s.notes.join(" ")).not.toContain("10 minutes");
  });
});

describe("the owner alert (pure plan)", () => {
  const s = buildCcrsStrategy([real(`${RUN}/errors/Inventory__20260917T134023354.csv`)], CTX);
  const base = { mailbox: "Michael@GreenwayMarijuana.com", gmail_id: "18f2a", kind: "error" as const, subject: "CCRS file error", auth: "aligned-pass" as const, in_spam: false };
  it("key is per mailbox (case-folded) and Gmail id; stage and link are fixed", () => {
    const a = planMailAlert(base, s, "https://greenwaymarijuana.com")!;
    expect(a.dedupeKey).toBe("ccrs_mail:michael@greenwaymarijuana.com:18f2a");
    expect(a.dedupeKey).toBe(mailAlertKey(base.mailbox, base.gmail_id));
    expect(a.stage).toBe(MAIL_ALERT_STAGE);
    expect(a.linkPath).toBe(MAIL_ALERT_LINK);
    expect(a.html).toContain("https://greenwaymarijuana.com/admin/compliance/ccrs#ccrs-mail");
    expect(a.html).toContain(s.headline);
    expect(a.subject).toBe("CCRS error file: 1 file(s) need attention");
  });
  it("the hub anchor the link points at exists on the panel", () => {
    expect(read("src/components/admin/compliance/CcrsMailPanel.tsx")).toContain('id="ccrs-mail"');
    expect(MAIL_ALERT_LINK.endsWith("#ccrs-mail")).toBe(true);
  });
  it("only error and unreadable mail alert", () => {
    expect(planMailAlert({ ...base, kind: "success" }, null, "")).toBeNull();
    expect(planMailAlert({ ...base, kind: "not-ccrs" }, null, "")).toBeNull();
    const u = planMailAlert({ ...base, kind: "unknown" }, null, "")!;
    expect(u.subject).toBe("CCRS sent an email that needs reading");
    expect(u.html).toContain("Read it in Gmail");
  });
  it("DMARC failure and Spam are said first; every CCRS-supplied string is escaped", () => {
    const a = planMailAlert({ ...base, auth: "dmarc-fail", in_spam: true, subject: "<img src=x onerror=1>" }, s, "")!;
    expect(a.html.indexOf("DMARC")).toBeLessThan(a.html.indexOf(s.headline));
    expect(a.html).toContain("Not spam");
    expect(a.html).not.toContain("<img");
    expect(a.html).toContain("&lt;img src=x onerror=1&gt;");
    const evil = buildCcrsStrategy([readErrorAttachment("Sale__1.csv", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S,<script>x</script>\r\n")!], CTX);
    const b = planMailAlert(base, evil, "")!;
    expect(b.html).not.toContain("<script>");
    expect(b.html).toContain("examiner email draft is ready");
  });
  it("push body is short", () => {
    expect(planMailAlert(base, buildCcrsStrategy(ERROR_FILES.map(real), CTX), "")!.text.length).toBeLessThanOrEqual(300);
  });
});

/* ------------------------------------------------------------------ */
describe("the owner alert is sent once (real postgrest-js against FakePostgrest)", () => {
  const MAILBOX = "michael@greenwaymarijuana.com";
  const env0 = { ...process.env };
  const fakeAdmin = async () => {
    const { PostgrestClient } = await import("@supabase/postgrest-js");
    return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never;
  };
  const putMail = (over: Record<string, unknown> = {}) =>
    state.db.rows("ccrs_mail_messages").push({
      id: state.db.nextId(),
      mailbox: MAILBOX,
      gmail_id: `g${state.db.rows("ccrs_mail_messages").length + 1}`,
      kind: "error",
      subject: "CCRS error",
      auth: "aligned-pass",
      in_spam: false,
      state: "new",
      fetched_at: new Date(NOW - 60_000).toISOString(),
      csvs: [{ filename: "Inventory__20260917T134023354.csv", text: read(`${RUN}/errors/Inventory__20260917T134023354.csv`) }],
      ...over,
    });
  beforeEach(() => {
    state.db = new FakePostgrest();
    state.db.uniques.push({ table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" });
    state.db.defaults.set("compliance_reminder_log", () => ({ sent_at: new Date(NOW).toISOString() }));
    state.emails = [];
    state.pushes = [];
    state.pushOn = false;
    state.pushCount = 1;
    state.emailOk = true;
    process.env = { ...env0, RESEND_API_KEY: "re_x", ORDER_EMAIL_FROM: "alerts@greenwaymarijuana.com", ORDER_STAFF_EMAILS: "michael@greenwaymarijuana.com" };
  });

  it("claims, sends one email, records the channel; the second tick sends nothing and writes nothing", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail();
    const r1 = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r1).toMatchObject({ planned: 1, sent: 1, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0 });
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toEqual(["michael@greenwaymarijuana.com"]);
    expect(state.emails[0].subject).toBe("CCRS error file: 1 file(s) need attention");
    expect(state.emails[0].html).toContain("refused whole");
    const log = state.db.rows("compliance_reminder_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ dedupe_key: `ccrs_mail:${MAILBOX}:g1`, stage: "ccrs_mail_error", channel: "email", recipients: "michael@greenwaymarijuana.com" });
    const writesBefore = state.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD").length;
    const r2 = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW + 300_000);
    expect(r2).toMatchObject({ planned: 0, sent: 0, alreadyClaimed: 1 });
    expect(state.emails).toHaveLength(1);
    expect(state.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD").length).toBe(writesBefore);
  });
  it("two ticks racing on the same email: exactly one send (the insert is the claim)", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail();
    // another tick claims between this tick's read of the log and its insert
    let raced = false;
    state.db.before = (q) => {
      if (!raced && q.method === "POST" && q.table === "compliance_reminder_log") {
        raced = true;
        state.db.rows("compliance_reminder_log").push({ id: "x", dedupe_key: `ccrs_mail:${MAILBOX}:g1`, stage: "ccrs_mail_error", channel: "email", recipients: "claimed - sending" });
      }
    };
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r).toMatchObject({ planned: 1, sent: 0, alreadyClaimed: 1 });
    expect(state.emails).toHaveLength(0);
  });
  it("no channel configured: nothing claimed, so it goes out once one exists", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail();
    process.env.RESEND_API_KEY = "";
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r).toMatchObject({ planned: 1, sent: 0, unsentNoChannel: 1 });
    expect(state.db.rows("compliance_reminder_log")).toHaveLength(0);
    process.env.RESEND_API_KEY = "re_x";
    expect((await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW)).sent).toBe(1);
  });
  it("every channel fails: the claim stays (no 5-minute repeats) and is marked undelivered", async () => {
    const { notifyOpenCcrsMail, MAIL_UNDELIVERED } = await import("@/lib/compliance/ccrs-mail-notify");
    const { WATCH_UNDELIVERED } = await import("@/lib/pos/cutover-watch-core");
    expect(MAIL_UNDELIVERED).toBe(WATCH_UNDELIVERED);
    putMail();
    state.emailOk = false;
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r).toMatchObject({ sent: 0, undelivered: 1 });
    expect(r.notes.join()).toContain("provider returned 500");
    expect(state.db.rows("compliance_reminder_log")[0].recipients).toBe(WATCH_UNDELIVERED);
    expect((await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW)).alreadyClaimed).toBe(1);
  });
  it("email + push both deliver: channel email+push", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail();
    state.pushOn = true;
    state.pushCount = 2;
    await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(state.db.rows("compliance_reminder_log")[0]).toMatchObject({ channel: "email+push", recipients: "michael@greenwaymarijuana.com, 2 push device(s)" });
    expect(state.pushes[0]).toMatchObject({ url: MAIL_ALERT_LINK, tag: `ccrs_mail:${MAILBOX}:g1` });
  });
  it("only open error/unknown mail of this mailbox, fetched in the last 7 days", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail({ kind: "success" });
    putMail({ state: "applied" });
    putMail({ mailbox: "other@x.com" });
    putMail({ fetched_at: new Date(NOW - (MAIL_ALERT_LOOKBACK_DAYS * 86_400_000 + 1)).toISOString() });
    putMail({ kind: "not-ccrs" });
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r.planned).toBe(0);
    expect(state.emails).toHaveLength(0);
    putMail({ kind: "unknown", csvs: [] });
    expect((await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW)).sent).toBe(1);
    expect(state.emails[0].subject).toBe("CCRS sent an email that needs reading");
  });
  it("a quiet tick (no open mail) reads once and writes nothing", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r).toMatchObject({ planned: 0, sent: 0 });
    expect(state.db.log.map((q) => `${q.method} ${q.table}`)).toEqual(["GET ccrs_mail_messages"]);
  });
  it("a database fault is a note, never a throw, and nothing is sent", async () => {
    const { notifyOpenCcrsMail } = await import("@/lib/compliance/ccrs-mail-notify");
    putMail();
    state.db.missing.add("compliance_reminder_log");
    const r = await notifyOpenCcrsMail(await fakeAdmin(), MAILBOX, NOW);
    expect(r.sent).toBe(0);
    expect(r.notes.join()).toMatch(/alert log read failed/);
    expect(state.emails).toHaveLength(0);
  });
});

describe("wiring", () => {
  const STORE = read("src/lib/compliance/ccrs-mail-store.ts");
  it("the tick alerts after reading, and the result carries the alert counts (not overwritten by base)", () => {
    expect(STORE).toMatch(/const alerts = await notifyOpenCcrsMail\(admin, cfg\.mailbox, nowMs\);\s*return finish\(\{\s*\.\.\.base,\s*alerts,/);
    expect(STORE.indexOf("notifyOpenCcrsMail(admin")).toBeGreaterThan(STORE.indexOf("for (const id of fetch)"));
  });
  it("the notifier claims before it sends, and records after", () => {
    const N = read("src/lib/compliance/ccrs-mail-notify.ts");
    const loop = N.split("for (const a of alerts) {")[1];
    expect(loop.indexOf("await claim(admin, a)")).toBeLessThan(loop.indexOf("sendStaffAlertEmail("));
    expect(loop.indexOf("sendStaffAlertEmail(")).toBeLessThan(loop.indexOf("await record(admin, a, channels.join"));
    expect(N).toMatch(/if \(!emailOn && !pushOn\) \{[\s\S]*?return out;/);
  });
  it("the page builds a report only for open error mail and passes it to the panel", () => {
    const P = read("src/app/admin/compliance/ccrs/page.tsx");
    expect(P).toMatch(/r\.kind === "error" && r\.state === "new"\s*\? buildCcrsStrategy\(errorsFromStored\(r\.csvs \?\? \[\]\)/);
    expect(P).toContain("rows={ccrsMailRows as unknown as CcrsMailPanelRow[]}");
    expect(P.indexOf("const mailCfg = mailConfigFromEnv")).toBeLessThan(P.indexOf("const ccrsMailRows"));
  });
  it("nothing in S-18b sends to the LCB or writes the ledger", () => {
    for (const f of ["src/lib/compliance/ccrs-strategy-core.ts", "src/lib/compliance/ccrs-mail-notify.ts", "src/components/admin/compliance/CcrsStrategyReport.tsx"]) {
      const t = read(f);
      expect(t, f).not.toMatch(/recordOutcome|ccrs_record_outcome|ccrs_files|ccrs_ledger/);
    }
    // the only email the notifier sends goes to staff (ORDER_STAFF_EMAILS), never an lcb.wa.gov address
    expect(read("src/lib/compliance/ccrs-mail-notify.ts")).not.toMatch(/lcb\.wa\.gov/);
  });
});

describe("the report on the hub", () => {
  const s = buildCcrsStrategy(
    [real(`${EV}/P20261005A/Product__20261006T113333390.csv`), readErrorAttachment("Sale__1.csv", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S1,Brand new & odd\r\n")!],
    CTX,
  );
  const h = renderToStaticMarkup(createElement(CcrsStrategyReport, { strategy: s }));
  it("shows each file's scope, message, cited rule, steps and the shifted-row note", () => {
    expect(h).toContain('data-testid="ccrs-strategy"');
    expect(h).toContain('data-scope="listed-rows"');
    expect(h).toContain('data-scope="unknown"');
    expect(h).toContain("Operation is invalid must be Insert, Update or Delete");
    expect(h).toContain("[G L0243-L0248]");
    expect(h).toContain("3 id(s) unreadable, the row is shifted");
    expect(h).toContain("Find the comma in the listed row");
    expect(h).toContain("There is no verified fix");
  });
  it("the examiner draft is a mailto the owner opens (drafts-only), with the body shown", () => {
    expect(h).toContain('data-testid="ccrs-strategy-examiner"');
    expect(h).toContain('href="mailto:examiner@lcb.wa.gov?subject=');
    expect(h).toContain("Brand new &amp; odd");
    expect(h).not.toMatch(/<form/);
  });
  it("the panel shows the report on open error mail only", () => {
    const row: CcrsMailPanelRow = {
      id: "1",
      gmail_id: "g1",
      received_at: null,
      subject: "x",
      kind: "error",
      env: null,
      env_verified: false,
      auth: "aligned-pass",
      in_spam: false,
      analysis: { errors: [], needsHuman: [] },
      state: "new",
      handled_note: null,
      strategy: s,
    };
    const props = {
      available: true,
      loadError: null,
      setup: { configured: true as const, mode: "service-account", mailbox: "m" },
      heartbeat: null,
      uploadedFiles: [],
      canEdit: true,
      weekKey: "2026-11-01",
      nowISO: "2026-11-08T20:00:00.000Z",
      actions: { poll: async () => {}, applySuccess: async () => {}, applyError: async () => {}, dismiss: async () => {} },
    };
    expect(renderToStaticMarkup(createElement(CcrsMailPanel, { ...props, rows: [row] }))).toContain('data-testid="ccrs-strategy"');
    expect(renderToStaticMarkup(createElement(CcrsMailPanel, { ...props, rows: [{ ...row, kind: "success" }] }))).not.toContain('data-testid="ccrs-strategy"');
    expect(renderToStaticMarkup(createElement(CcrsMailPanel, { ...props, rows: [{ ...row, strategy: null }] }))).not.toContain('data-testid="ccrs-strategy"');
  });
});

describe("self-tests", () => {
  it("ccrs-strategy-core self-tests pass", () => {
    const r = __runCcrsStrategyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(18);
  });
});
