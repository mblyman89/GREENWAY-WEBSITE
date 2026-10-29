/**
 * tests/compliance/fix-p3-2a-inbound-reconcile.test.ts  (Fix Phase 3.2a · G-17 · F-04-4)
 *
 * The owner, verbatim (owner message 7):
 *   "In addition to a notice when an email fails, please add a refetch
 *    button, or some intelligent way to manually ask the fetcher to look
 *    again, or something like that. Every manifest comes via email. ...
 *    If an invoice and manifest don't make it to the table and I know it's
 *    in the email account because I have it open and looking at it, I need a
 *    way to ask the system to grab the ones it missed or failed to get. Make
 *    it enterprise grade. ... I want this table to receive every manifest,
 *    no exceptions."
 *
 * Proven through the REAL runReconcile / retryInboundEmail /
 * resolveInboundEmail / findAndIngest, the REAL insert-first delivery claim
 * and the REAL logInboundEmail, against the fake PostgREST. Only the network
 * edges are stubbed (Resend + Gmail lists / fetches, staging, alert sends):
 *   1. pure core at its exact floor
 *   2. the mailbox check pulls in a missed email (Resend and Gmail), the same
 *      email listed twice is pulled once, a second run adds nothing
 *   3. the grace period (cron 15 min, Check now 2 min)
 *   4. a fetch that fails still lands on the table as a temporary failure
 *   5. Try again: compare-and-set reopen, same row completed, racing press refused
 *   6. Resolved: reason required, Other needs a note, compare-and-set
 *   7. automatic retries with backoff; failure alerts claimed once, 7-day window
 *   8. heartbeat + the health alert after an hour of failing
 *   9. before 0320: the check still pulls mail in, Try again says apply 0320
 *  10. Find an email
 *  11. wiring (cron, vercel, page, actions, route) and docs pins
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

type Src = import("@/lib/inbound-email/inbound-reconcile-core").SourceEmail;
type Email = import("@/lib/inbound-email/inbound-normalize-core").NormalizedInboundEmail;

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  resendList: [] as Record<string, unknown>[],
  resendListOk: true,
  gmailList: [] as unknown[],
  gmailListError: null as string | null,
  gmailConfigured: true,
  gmailFetchFail: new Set<string>(),
  /** What staging does with an email, by subject: "staged" | "parse_failed" | "none". */
  stageBy: new Map<string, string>(),
  fetches: [] as string[],
  staged: [] as string[],
  sends: [] as string[],
  pushes: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/regulatory/regulatory-ingest", () => ({ ingestFromText: async () => ({ ok: true, created: false, analyzed: false }) }));
vi.mock("@/lib/purchasing/emailed-menu-store", () => ({ processMenuEmail: async () => ({ outcome: "junk", snapshotId: null, note: "", itemCount: 0 }) }));
vi.mock("@/lib/notifications/push", () => ({
  isPushConfigured: () => true,
  sendPushToAll: async (p: { tag: string }) => {
    st.pushes.push(p.tag);
    return 1;
  },
}));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string }) => {
    st.sends.push(p.subject);
    return { ok: true, detail: "sent", didTimeout: false };
  },
}));
vi.mock("@/lib/inbound-email/inbound-store", async (orig) => ({
  ...((await orig()) as object),
  // Staging is proven elsewhere (R36 / H15b); here it answers by subject.
  stageManifestsFromEmail: async (email: Email) => {
    const how = st.stageBy.get(email.subject) ?? "staged";
    st.staged.push(email.subject);
    return {
      staged: how === "staged" ? 1 : 0,
      manifestIds: [],
      parseFailures: how === "parse_failed" ? 1 : 0,
      duplicates: 0,
      transportBackfills: 0,
      notes: [],
    };
  },
}));
const toEmail = (provider: "resend" | "gmail", ref: string, subject: string): Email => ({
  provider,
  from: "Lilac <orders@lilac.example>",
  to: ["vendor_intake@greenwaymarijuana.com"],
  subject,
  receivedAt: new Date(Date.now() - 3600_000).toISOString(),
  attachments: [],
  messageId: `${ref}@mail.example`,
  sourceRef: ref,
});
vi.mock("@/lib/inbound-email/resend-receiving-fetch", async (orig) => ({
  ...((await orig()) as object),
  listResendReceived: async () => (st.resendListOk ? { ok: true, items: st.resendList, truncated: false } : { ok: false, error: "Resend receiving list: HTTP 503" }),
  fetchResendInboundById: async (id: string) => {
    st.fetches.push(`resend:${id}`);
    const it = st.resendList.find((x) => x.id === id);
    return { email: toEmail("resend", id, String(it?.subject ?? "Resend mail")), fetchNote: "fetched from Resend" };
  },
}));
vi.mock("@/lib/inbound-email/gmail-intake-fetch", () => ({
  gmailIntakeConfig: () =>
    st.gmailConfigured ? { configured: true, cfg: {}, mailbox: "vendor_intake@greenwaymarijuana.com" } : { configured: false, mailbox: "vendor_intake@greenwaymarijuana.com", problem: "Gmail sign-in not set up" },
  listGmailIntake: async () =>
    !st.gmailConfigured
      ? { ok: false, mailbox: null, configured: false, error: "Gmail sign-in not set up" }
      : st.gmailListError
        ? { ok: false, mailbox: "vendor_intake@greenwaymarijuana.com", configured: true, error: st.gmailListError }
        : { ok: true, mailbox: "vendor_intake@greenwaymarijuana.com", items: st.gmailList, truncated: false, token: "tok" },
  fetchGmailInboundById: async (id: string) => {
    st.fetches.push(`gmail:${id}`);
    if (st.gmailFetchFail.has(id)) return { ok: false, error: "could not fetch the Gmail message: HTTP 503" };
    const it = (st.gmailList as Src[]).find((x) => x.ref === id);
    return { ok: true, result: { email: toEmail("gmail", id, it?.subject ?? "Gmail mail"), fetchNote: "read from Gmail" } };
  },
}));

const core = await import("@/lib/inbound-email/inbound-reconcile-core");
const store = await import("@/lib/inbound-email/inbound-reconcile-store");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const log = () => st.db.rows("inbound_email_log");
const byKey = (k: string) => log().find((r) => r.delivery_key === k);

function resendItem(id: string, subject: string, ageMin = 60, messageId: string | null = null): Record<string, unknown> {
  return { id, to: ["vendor_intake@greenwaymarijuana.com"], from: "orders@lilac.example", subject, created_at: minsAgo(ageMin), message_id: messageId };
}
function gmailItem(ref: string, subject: string, ageMin = 60, messageId: string | null = null): Src {
  return { source: "gmail", ref, messageId, from: "Lilac <orders@lilac.example>", subject, receivedAt: minsAgo(ageMin), to: ["vendor_intake@greenwaymarijuana.com"] };
}
function failedRow(over: Row = {}): Row {
  const row: Row = {
    id: st.db.nextId(),
    provider: "resend",
    delivery_key: "resend:email:old1",
    source_ref: "old1",
    message_id: null,
    from_address: "orders@lilac.example",
    to_addresses: ["vendor_intake@greenwaymarijuana.com"],
    subject: "Manifest 0425",
    received_at: minsAgo(60),
    created_at: minsAgo(60),
    claimed_at: minsAgo(60),
    to_intake: true,
    disposition: "parse_failed",
    manifest_id: null,
    note: "1 attachment(s) failed to parse",
    attachment_count: 1,
    retry_count: 0,
    last_retry_at: null,
    resolved_at: null,
    ...over,
  };
  log().push(row);
  return row;
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.uniques.push(
    { table: "inbound_email_log", columns: ["delivery_key"], where: (r) => r.delivery_key != null, name: "inbound_email_log_delivery_key_uidx" },
    { table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" },
  );
  st.db.defaults.set("inbound_email_log", () => ({
    received_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    to_intake: false,
    attachment_count: 0,
    retry_count: 0,
    resolved_at: null,
    disposition: "received",
  }));
  st.resendList = [];
  st.resendListOk = true;
  st.gmailList = [];
  st.gmailListError = null;
  st.gmailConfigured = true;
  st.gmailFetchFail = new Set();
  st.stageBy = new Map();
  st.fetches = [];
  st.staged = [];
  st.sends = [];
  st.pushes = [];
  process.env.RESEND_API_KEY = "re_test";
  process.env.ORDER_EMAIL_FROM = "alerts@greenwaymarijuana.com";
  process.env.ORDER_STAFF_EMAILS = "owner@greenwaymarijuana.com";
});

describe("1. pure core", () => {
  it("self-tests pass at the exact floor", () => {
    expect(core.__runInboundReconcileCoreTests()).toEqual({ passed: 111, failed: 0 });
  });
});

describe("2. the mailbox check pulls in what the webhook missed", () => {
  it("a Resend email the webhook never delivered is claimed, fetched, staged and logged once", async () => {
    log().push({ id: st.db.nextId(), provider: "resend", delivery_key: "resend:email:e1", from_address: "orders@lilac.example", subject: "Manifest 1", received_at: minsAgo(90), disposition: "staged", to_intake: true, retry_count: 0, resolved_at: null });
    st.resendList = [resendItem("e1", "Manifest 1", 90), resendItem("e2", "Manifest 2", 60)];
    st.gmailConfigured = false;
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.onTable).toBe(1);
    expect(r.recovered).toBe(1);
    expect(r.recoveredStaged).toBe(1);
    expect(st.fetches).toEqual(["resend:e2"]);
    const row = byKey("resend:email:e2")!;
    expect(row.disposition).toBe("staged");
    expect(row.ingest_source).toBe("reconcile");
    expect(row.source_ref).toBe("e2");
    expect(row.to_intake).toBe(true);
    expect(String(row.note)).toMatch(/pulled in by the mailbox check \(reconcile\)/);
    expect(log()).toHaveLength(2);
  });
  it("a Gmail-only email is pulled in under gmail:msg:<id>; the same email in both lists is pulled ONCE", async () => {
    st.resendList = [resendItem("e9", "Manifest 9", 60, "<SAME@mail.example>")];
    st.gmailList = [gmailItem("g9", "Fwd: Manifest 9", 60, "same@mail.example"), gmailItem("g10", "Manifest 10", 45)];
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.recovered).toBe(2);
    expect(st.fetches.sort()).toEqual(["gmail:g10", "gmail:g9"]);
    expect(byKey("gmail:msg:g9")?.provider).toBe("gmail");
    expect(byKey("resend:email:e9")).toBeUndefined();
  });
  it("running the check twice (or twice at once) stages nothing twice", async () => {
    st.resendList = [resendItem("e2", "Manifest 2", 60)];
    st.gmailConfigured = false;
    await store.runReconcile({ trigger: "cron" });
    const again = await store.runReconcile({ trigger: "cron" });
    expect(again.recovered).toBe(0);
    expect(again.onTable).toBe(1);
    expect(st.staged).toEqual(["Manifest 2"]);
    // Two at once: the second claim on the same key is refused (0255 unique).
    st.resendList = [resendItem("e3", "Manifest 3", 60)];
    st.staged = [];
    await Promise.all([store.runReconcile({ trigger: "cron" }), store.runReconcile({ trigger: "cron" })]);
    expect(st.staged).toEqual(["Manifest 3"]);
    expect(log().filter((r) => r.delivery_key === "resend:email:e3")).toHaveLength(1);
  });
  it("only intake mail counts: an email to another address on the domain is not pulled in", async () => {
    st.resendList = [{ ...resendItem("m1", "Menu", 60), to: ["vendor_menu@greenwaymarijuana.com"] }];
    st.gmailConfigured = false;
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.recovered).toBe(0);
    expect(st.fetches).toEqual([]);
  });
});

describe("3. the grace period", () => {
  it("the cron leaves an email under 15 minutes old to the webhook; Check the mailbox now waits only 2", async () => {
    st.resendList = [resendItem("e5", "Manifest 5", 5)];
    st.gmailConfigured = false;
    const cron = await store.runReconcile({ trigger: "cron" });
    expect(cron.recovered).toBe(0);
    expect(cron.tooNew).toBe(1);
    const manual = await store.runReconcile({ trigger: "manual" });
    expect(manual.recovered).toBe(1);
  });
});

describe("4. a fetch that fails is never lost", () => {
  it("a Gmail read that fails lands on the table as Fetch failed (temporary, intake), and is listed", async () => {
    st.gmailList = [gmailItem("g7", "Manifest 7", 60)];
    st.gmailFetchFail.add("g7");
    st.resendListOk = true;
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.errors.join(" ")).toMatch(/HTTP 503/);
    const row = byKey("gmail:msg:g7")!;
    expect(row.disposition).toBe("no_manifest");
    expect(row.to_intake).toBe(true);
    expect(row.subject).toBe("Manifest 7");
    expect(row.source_ref).toBe("g7");
    const att = core.classifyAttention(row as never, Date.now());
    expect(att?.kind).toBe("fetch_failed");
    expect(att?.category).toBe("temporary");
    const view = await store.loadAttention();
    expect(view.items.map((i) => i.row.id)).toContain(row.id);
  });
});

describe("5. Try again", () => {
  it("re-opens the row by compare-and-set, fetches from the recorded source, completes the SAME row", async () => {
    const row = failedRow();
    st.resendList = [resendItem("old1", "Manifest 0425")];
    const r = await store.retryInboundEmail(String(row.id), ACTOR);
    expect(r.ok).toBe(true);
    expect(st.fetches).toEqual(["resend:old1"]);
    expect(log()).toHaveLength(1);
    expect(row.disposition).toBe("staged");
    expect(row.retry_count).toBe(1);
    expect(row.last_retry_by).toBe(ACTOR);
    expect(row.ingest_source).toBe("retry");
    const patch = st.db.log.find((q) => q.method === "PATCH" && q.table === "inbound_email_log")!;
    expect(patch.url.searchParams.get("retry_count")).toBe("eq.0");
    expect(patch.url.searchParams.get("disposition")).toBe("eq.parse_failed");
    expect(patch.url.searchParams.get("resolved_at")).toBe("is.null");
  });
  it("a racing press loses: nothing fetched, nothing changed", async () => {
    const row = failedRow();
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.table === "inbound_email_log") {
        row.retry_count = 1; // the other press got there first
        st.db.before = null;
      }
    };
    const r = await store.retryInboundEmail(String(row.id), ACTOR);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/Someone else is fetching/);
    expect(st.fetches).toEqual([]);
  });
  it("refuses a staged row, a resolved row, a row being fetched, and a row with no recorded source", async () => {
    const staged = failedRow({ disposition: "staged" });
    const resolved = failedRow({ delivery_key: "resend:email:r2", resolved_at: minsAgo(1), resolved_reason: "other" });
    const busy = failedRow({ delivery_key: "resend:email:r3", disposition: "received", claimed_at: minsAgo(1) });
    const legacy = failedRow({ delivery_key: null, source_ref: null, provider: "resend" });
    for (const [row, re] of [
      [staged, /already made its manifest/],
      [resolved, /marked Resolved/],
      [busy, /being fetched right now/],
      [legacy, /Find an email/],
    ] as const) {
      const r = await store.retryInboundEmail(String(row.id), ACTOR);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(re);
    }
    expect(st.fetches).toEqual([]);
  });
  it("a Gmail row that still cannot be read stays an intake failure (never 'not addressed to intake')", async () => {
    const row = failedRow({ provider: "gmail", delivery_key: "gmail:msg:g8", source_ref: "g8", disposition: "no_manifest", note: "could not fetch the Gmail message" });
    st.gmailFetchFail.add("g8");
    const r = await store.retryInboundEmail(String(row.id), ACTOR);
    expect(r.ok).toBe(false);
    expect(row.disposition).toBe("no_manifest");
    expect(row.to_intake).toBe(true);
    expect(row.retry_count).toBe(1);
  });
});

describe("6. Resolved", () => {
  it("needs a reason; Other needs a note; closes once (compare-and-set)", async () => {
    const row = failedRow({ disposition: "no_manifest", note: "no manifest attachment found" });
    expect((await store.resolveInboundEmail(String(row.id), "", "", ACTOR)).ok).toBe(false);
    const other = await store.resolveInboundEmail(String(row.id), "other", "", ACTOR);
    expect(other.ok ? "" : other.error).toMatch(/Say why/);
    const ok = await store.resolveInboundEmail(String(row.id), "not_a_manifest", "a reply from the vendor", ACTOR);
    expect(ok.ok).toBe(true);
    expect(row.resolved_reason).toBe("not_a_manifest");
    expect(row.resolved_by).toBe(ACTOR);
    expect(row.resolved_note).toBe("a reply from the vendor");
    const twice = await store.resolveInboundEmail(String(row.id), "other", "again", ACTOR);
    expect(twice.ok ? "" : twice.error).toMatch(/already marked Resolved/);
    expect((await store.loadAttention()).items).toHaveLength(0);
  });
});

describe("7. automatic retries + alerts", () => {
  it("a temporary failure past its backoff is retried by the check; one not yet due is left", async () => {
    st.gmailConfigured = false;
    const due = failedRow({ created_at: minsAgo(10), received_at: minsAgo(10) });
    const notDue = failedRow({ delivery_key: "resend:email:old2", source_ref: "old2", created_at: minsAgo(1), received_at: minsAgo(1) });
    st.resendList = [resendItem("old1", "Manifest 0425", 10), resendItem("old2", "Manifest 0426", 1)];
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.autoRetried).toBe(1);
    expect(due.retry_count).toBe(1);
    expect(notDue.retry_count).toBe(0);
  });
  it("an email that needs a person alerts ONCE (email + push), claimed in compliance_reminder_log; old rows never alert", async () => {
    st.gmailConfigured = false;
    const fresh = failedRow({ disposition: "no_manifest", note: "no manifest attachment found" });
    failedRow({ delivery_key: "resend:email:old9", disposition: "no_manifest", note: "no manifest attachment found", received_at: minsAgo(8 * 24 * 60) });
    await store.runReconcile({ trigger: "cron" });
    await store.runReconcile({ trigger: "cron" });
    expect(st.sends).toHaveLength(1);
    expect(st.sends[0]).toMatch(/did not make a manifest/);
    expect(st.pushes).toEqual([core.failAlertKey(String(fresh.id))]);
    const claims = st.db.rows("compliance_reminder_log");
    expect(claims.map((c) => c.dedupe_key)).toEqual([core.failAlertKey(String(fresh.id))]);
    expect(claims[0].channel).toBe("email+push");
    expect(claims[0].stage).toBe(core.FAIL_ALERT_STAGE);
  });
});

describe("8. heartbeat + health", () => {
  it("writes the heartbeat; a check failing for an hour sends one health alert", async () => {
    st.gmailConfigured = false;
    await store.runReconcile({ trigger: "cron" });
    const hb = () => core.heartbeatFromSetting(st.db.rows("site_settings").find((r) => r.key === core.RECONCILE_HEARTBEAT_KEY)?.value_json);
    expect(hb()?.ok).toBe(true);
    st.resendListOk = false;
    const t0 = Date.now();
    await store.runReconcile({ trigger: "cron", nowMs: t0 });
    expect(hb()?.ok).toBe(false);
    expect(hb()?.failingSince).toBe(new Date(t0).toISOString());
    expect(st.sends).toHaveLength(0);
    await store.runReconcile({ trigger: "cron", nowMs: t0 + 61 * 60_000 });
    await store.runReconcile({ trigger: "cron", nowMs: t0 + 76 * 60_000 });
    expect(st.sends.filter((s) => /mailbox check is failing/.test(s))).toHaveLength(1);
    expect(hb()?.failingSince).toBe(new Date(t0).toISOString());
  });
});

describe("9. before migration 0320", () => {
  it("the check still pulls missed mail in (written without the new columns); Try again says apply 0320", async () => {
    const NEW = ["retry_count", "resolved_at", "message_id", "source_ref", "ingest_source"];
    st.db.before = (req) => {
      const sel = req.url.searchParams.get("select") ?? "";
      const body = JSON.stringify(req.body ?? {});
      if (NEW.some((c) => sel.includes(c) || body.includes(`"${c}"`))) {
        return { status: 400, body: { code: "42703", message: 'column "retry_count" does not exist', details: null, hint: null } };
      }
    };
    st.resendList = [resendItem("e2", "Manifest 2", 60)];
    st.gmailConfigured = false;
    const r = await store.runReconcile({ trigger: "cron" });
    expect(r.migrationApplied).toBe(false);
    expect(r.recovered).toBe(1);
    expect(byKey("resend:email:e2")?.disposition).toBe("staged");
    expect(byKey("resend:email:e2")?.source_ref).toBeUndefined();
    const row = failedRow();
    const t = await store.retryInboundEmail(String(row.id), ACTOR);
    expect(t.ok ? "" : t.error).toMatch(/Apply database update 0320/);
    expect(core.healthLine(null, Date.now(), false).text).toMatch(/0320/);
  });
});

describe("10. Find an email", () => {
  it("pulls in a match the table does not have; a match already on the table that failed is fetched again", async () => {
    st.gmailList = [gmailItem("g20", "Manifest 20 from Lilac", 3 * 24 * 60)];
    st.resendList = [];
    const r = await store.findAndIngest("lilac", 30, ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pulledIn).toBe(1);
    expect(byKey("gmail:msg:g20")?.ingest_source).toBe("find");
    // Now it is on the table but failed: Find fetches it again instead.
    const row = byKey("gmail:msg:g20")!;
    Object.assign(row, { disposition: "parse_failed", retry_count: 0, claimed_at: minsAgo(30) });
    st.fetches = [];
    const again = await store.findAndIngest("lilac", 30, ACTOR);
    expect(again.ok && again.retried).toBe(1);
    expect(st.fetches).toEqual(["gmail:g20"]);
    expect(log().filter((x) => x.delivery_key === "gmail:msg:g20")).toHaveLength(1);
  });
  it("refuses an empty search", async () => {
    const r = await store.findAndIngest(" ", 30, ACTOR);
    expect(r.ok).toBe(false);
  });
});

describe("11. wiring", () => {
  it("the cron route: fail-closed preamble, runReconcile, 300 s, GET + POST", () => {
    const c = read("src/app/api/cron/inbound-reconcile/route.ts");
    expect(c).toMatch(/export const maxDuration = 300;/);
    expect(c).toMatch(/shouldRefuseWhenSecretMissing\(secret\)/);
    expect(c).toMatch(/runReconcile\(\{ trigger: "cron" \}\)/);
    expect(c).toMatch(/export async function POST/);
  });
  it("vercel.json runs it every 15 minutes at :07", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.filter((x) => x.path === "/api/cron/inbound-reconcile")).toEqual([{ path: "/api/cron/inbound-reconcile", schedule: "7-59/15 * * * *" }]);
    expect(read("AGENTS.md")).toMatch(/`inbound-reconcile` every 15 min at `7-59\/15 \* \* \* \*`/);
  });
  it("every mailbox action needs inventory.manage and writes an audit row", () => {
    const a = read("src/app/admin/inventory/intake/actions.ts");
    for (const name of ["checkMailboxNowAction", "retryInboundEmailAction", "resolveInboundEmailAction", "findInboundEmailAction"]) {
      const start = a.indexOf(`export async function ${name}`);
      expect(start).toBeGreaterThan(0);
      const body = a.slice(start, a.indexOf("\n}\n", start));
      expect(body).toMatch(/requirePermission\("inventory\.manage"\)/);
      expect(body).toMatch(/recordAudit\(/);
    }
  });
  it("the page shows the panel on the email tab, the count banner on every tab, and has the 300 s ceiling", () => {
    const p = read("src/app/admin/inventory/intake/page.tsx");
    expect(p).toMatch(/<InboundAttentionPanel/);
    expect(p).toMatch(/loadAttention\(nowMs\)/);
    expect(p).toMatch(/data-testid="attention-banner"/);
    expect(p).toMatch(/export const maxDuration = 300;/);
    const panel = read("src/components/admin/inventory/InboundAttentionPanel.tsx");
    expect(panel).toMatch(/id="needs-attention"/);
    expect(panel).toMatch(/label="Check the mailbox now"/);
    expect(panel).toMatch(/label="Try again"/);
    expect(panel).toMatch(/label="Resolved"/);
    expect(panel).toMatch(/label="Find and pull in"/);
  });
  it("the webhook, the check, Try again and Find all go through the ONE routeAndStage", () => {
    expect(read("src/app/api/webhooks/inbound-email/route.ts")).toMatch(/routeAndStage\(email, signatureOk, fetchNote, logId, "webhook"\)/);
    const s = read("src/lib/inbound-email/inbound-reconcile-store.ts");
    expect((s.match(/await routeAndStage\(/g) ?? []).length).toBe(3);
    expect(s).toMatch(/claimInboundDelivery\(\{ provider: s\.source, key: sourceDeliveryKey\(s\) \}\)/);
  });
  it("migration 0320 + its rollback", () => {
    const m = read("supabase/migrations/0320_inbound_email_reconcile.sql");
    expect(m).toMatch(/provider in \('resend', 'sendgrid', 'gmail'\)/);
    expect(m).toMatch(/add column if not exists retry_count\s+integer not null default 0/);
    expect(m).toMatch(/inbound_email_log_resolved_reason_chk/);
    expect(read("supabase/rollbacks/0320_inbound_email_reconcile.rollback.sql")).toMatch(/drop column if exists retry_count/);
  });
});
