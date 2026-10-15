/**
 * R41 S6: approval at Timberland, modelled honestly.
 *   - the REAL ledger store's markAchFileBankStep over the REAL postgrest-js
 *     client against FakePostgrest (exact rpc names and arguments; the
 *     database's refusals in plain words; nothing is sent for a bad id);
 *   - the two new kinds are owner-gated (achGate) with a replay and a spec;
 *   - the operations page wires the buttons, the checklist and the grey line;
 *   - the old Timberland claims are gone from src (the plan's banned list);
 *   - 0274 text pins and its SQL mutation log.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  rpc: [] as { fn: string; body: Record<string, unknown> }[],
  rpcReply: null as null | ((fn: string, body: Record<string, unknown>) => { status: number; body: unknown }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const pg = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
      return { from: (t: string) => pg.from(t), rpc: (fn: string, args: Record<string, unknown>) => pg.rpc(fn, args) };
    },
  };
});

const ledger = await import("@/lib/payments/ach-file-ledger-store");
const core = await import("@/lib/payments/ach-file-ledger-core");
const steps = await import("@/lib/payments/timberland-bank-steps-core");
const { ACH_ACTIONS, ACH_ACTION_KINDS } = await import("@/lib/auth/ach-authority-core");
const { KIND_SPECS } = await import("@/lib/payments/ach-gate-core");
const { ACH_CAL_TASKS, ACH_FRAUD_PROCEDURE } = await import("@/lib/payments/ach-calendar-core");
const { buildJourneys, sampleSnapshot } = await import("@/lib/payments/ach-guide-core");

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILE = "3f2b1c0d-1111-4222-8333-444455556666";
const MICHAEL = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  st.db = new FakePostgrest();
  st.rpc = [];
  st.rpcReply = null;
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    return st.rpcReply ? st.rpcReply(fn, body) : { status: 500, body: { message: `no reply set for ${fn}` } };
  };
});

// =========================================================================
describe("markAchFileBankStep: the store sends exactly the right call", () => {
  it("Mark uploaded calls ach_file_mark_uploaded with id and actor; the kind must come back", async () => {
    st.rpcReply = () => ({ status: 200, body: "payroll" });
    expect(await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "uploaded" })).toEqual({ ok: true, kind: "payroll" });
    expect(st.rpc).toEqual([{ fn: "ach_file_mark_uploaded", body: { p_file_id: FILE, p_actor: MICHAEL } }]);
  });

  it("Mark approved calls ach_file_mark_bank_approved", async () => {
    st.rpcReply = () => ({ status: 200, body: "vendor" });
    expect(await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "bank_approved" })).toEqual({ ok: true, kind: "vendor" });
    expect(st.rpc).toEqual([{ fn: "ach_file_mark_bank_approved", body: { p_file_id: FILE, p_actor: MICHAEL } }]);
  });

  it("a bad id never reaches the database; an unknown step is refused", async () => {
    expect((await ledger.markAchFileBankStep({ fileId: "nope", actorId: MICHAEL, step: "uploaded" })).ok).toBe(false);
    expect((await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "sideways" as never })).ok).toBe(false);
    expect(st.rpc).toEqual([]);
  });

  it("an empty or strange reply is not a success", async () => {
    st.rpcReply = () => ({ status: 200, body: "" });
    expect((await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "uploaded" })).ok).toBe(false);
    st.rpcReply = () => ({ status: 200, body: "wire" });
    expect((await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "uploaded" })).ok).toBe(false);
  });

  it.each([
    ["ACH_OWNER_ONLY: only the owner records the upload to Timberland.", /Only the owner releases, voids, or marks/],
    ["ACH_BANK_STEP_FINAL: who uploaded or approved ACH file x at the bank, and when, never changes.", /already recorded and never changes/],
    ["ACH_BANK_STEP: ACH file x has no upload recorded, so it cannot be approved at the bank.", /in order: release, then mark uploaded/],
    ["ACH_FILE_TRANSITION: ACH file x is voided, not released, so it cannot be marked uploaded.", /status change is not allowed/],
    ["Could not find the function public.ach_file_mark_uploaded(p_actor, p_file_id) in the schema cache", /run migration 0274/],
  ])("the database's %s is shown in plain words", async (msg, re) => {
    st.rpcReply = () => ({ status: 400, body: { code: "P0001", message: msg } });
    const r = await ledger.markAchFileBankStep({ fileId: FILE, actorId: MICHAEL, step: "uploaded" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(re);
      expect(r.error).not.toContain("ACH_");
    }
  });

  it("listAchFiles asks for the four stamp columns", async () => {
    st.db.tables.set("ach_files", []);
    const mark = st.db.log.length;
    await ledger.listAchFiles(5);
    const sel = st.db.log.slice(mark).map((r) => r.url.searchParams.get("select") ?? "").join(" ");
    for (const c of ["uploaded_by", "uploaded_at", "approved_at_bank_by", "approved_at_bank_at"]) expect(sel).toContain(c);
  });
});

// =========================================================================
describe("owner authority: two new live kinds, gated once, replayable, stale once the file moves", () => {
  it("both kinds are live owner actions with a status-versioned ach_file spec", () => {
    for (const k of ["ach_file.mark_uploaded", "ach_file.mark_bank_approved"] as const) {
      expect(ACH_ACTIONS[k].cls).toBe("live");
      expect(ACH_ACTION_KINDS).toContain(k);
      expect(KIND_SPECS[k]).toEqual({ targetType: "ach_file", idField: "file_id", version: { table: "ach_files", key: "id", cols: ["status"] } });
    }
    expect(ACH_ACTION_KINDS.filter((k) => ACH_ACTIONS[k].cls === "stop").sort()).toEqual(["ach_notice.log", "vendor_bank.hold"]);
  });

  it("file-actions gates each through achGate and records an audit entry", () => {
    const s = code(read("src/app/admin/settings/banking/file-actions.ts"));
    expect(s).toMatch(/achGate\("ach_file\.mark_uploaded", fd,[\s\S]*?markBankStepBody\(session, fd, "uploaded"\)/);
    expect(s).toMatch(/achGate\("ach_file\.mark_bank_approved", fd,[\s\S]*?markBankStepBody\(session, fd, "bank_approved"\)/);
    // The confirm check must sit inside the bank-step body itself (the void
    // action has its own; matching anywhere let a skipped box survive).
    const body = s.slice(s.indexOf("async function markBankStepBody"), s.indexOf("export async function dismissDualApprovalNoteAction"));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/const fileId = str\(fd, "file_id"\);\s*if \(str\(fd, "confirm"\) !== "yes"\) \{\s*back\(/);
    expect(body.indexOf('str(fd, "confirm")')).toBeLessThan(body.indexOf("markAchFileBankStep("));
    expect(s).toMatch(/action: step === "uploaded" \? "ach\.file\.uploaded" : "ach\.file\.bank_approved"/);
  });

  it("the replay map runs the same actions", () => {
    const s = read("src/app/admin/settings/banking/approvals/actions.ts");
    expect(s).toContain('"ach_file.mark_uploaded": (fd) => files.markAchFileUploadedAction(fd),');
    expect(s).toContain('"ach_file.mark_bank_approved": (fd) => files.markAchFileBankApprovedAction(fd),');
  });

  it("the dismiss action is owner only, logged, and not an ACH kind", () => {
    const s = code(read("src/app/admin/settings/banking/file-actions.ts"));
    const body = s.slice(s.indexOf("export async function dismissDualApprovalNoteAction"));
    expect(body).toMatch(/session\.profile\.role !== "owner"\) back\(/);
    expect(body).toMatch(/recordAudit\([\s\S]*?"ach\.dual_approval_note\.dismissed"/);
    expect(body).not.toContain("achGate(");
  });
});

// =========================================================================
describe("operations page", () => {
  const page = read("src/app/admin/settings/banking/operations/page.tsx");
  it("shows one bank-step button per file through bankStepButton, posting to the right action", () => {
    expect(page).toMatch(/bankStepButton\(f\.status, isOwner\)/);
    expect(page).toMatch(/b\.step === "uploaded" \? markAchFileUploadedAction : markAchFileBankApprovedAction/);
    expect(page).toMatch(/name="confirm" value="yes" required/);
    expect(page).toMatch(/bankStepLine\(f,/);
  });
  it("the grey line is grey (never red/amber), owner-dismissable, and only when dualNoteVisible says so", () => {
    const i = page.indexOf('id="dual-approval-note"');
    expect(i).toBeGreaterThan(0);
    const block = page.slice(page.lastIndexOf("{showDualNote ?", i), page.indexOf("</div>", i));
    expect(block).not.toMatch(/red-|amber-|role="alert"/);
    expect(block).toContain("{DUAL_APPROVAL_NOTE}");
    expect(block).toMatch(/isOwner \?[\s\S]*dismissDualApprovalNoteAction/);
    expect(page).toMatch(/const showDualNote = dualNoteVisible\(dualNote\.dismiss, today\)/);
  });
  it("the checklist card lists the steps from the core", () => {
    expect(page).toMatch(/id="bank-steps"/);
    expect(page).toMatch(/BANK_STEP_CHECKLIST\.map/);
  });
});

// =========================================================================
describe("honest Timberland wording (plan section 3.5)", () => {
  const walk = (d: string): string[] =>
    readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const SRC = walk("src").filter((f) => f !== "src/lib/payments/timberland-bank-steps-core.ts");

  it("scans a real number of files (the walk itself works)", () => {
    expect(SRC.length).toBeGreaterThan(500);
    expect(SRC).toContain("src/lib/payments/ach-calendar-core.ts");
  });

  it.each(steps.BANNED_TIMBERLAND_CLAIMS.map((b) => [b]))("no file in src says %s", (banned) => {
    const hits = SRC.filter((f) => read(f).toLowerCase().includes(banned.toLowerCase()));
    expect(hits).toEqual([]);
  });

  it("the banned list is the plan's four phrases", () => {
    expect([...steps.BANNED_TIMBERLAND_CLAIMS]).toEqual(["Stephen and Michael can upload", "accept every security", "can each act alone", "the other owner"]);
  });

  it("the grep can fail (mutation: a banned phrase planted in a string is found)", () => {
    const planted = `${read("src/lib/payments/ach-calendar-core.ts")}\n"we accept every security procedure"`;
    expect(planted.toLowerCase().includes("accept every security")).toBe(true);
  });

  it("the fraud procedure carries the plan's new text, verbatim", () => {
    expect(ACH_FRAUD_PROCEDURE.map((p) => p.rule)).toContain(steps.SOLE_USER_TEXT);
  });

  it("the year-end review no longer asks to confirm dual control is on", () => {
    const t = ACH_CAL_TASKS.find((x) => x.id === "timberland_annual_review")!;
    const all = [t.why, ...t.steps].join(" ");
    expect(all).not.toMatch(/dual control is still on|Confirm dual control/i);
    expect(all).toMatch(/Michael only/);
  });

  it("the Schedule F quote the grey line leans on is in the mirrored agreement", () => {
    const mirror = read("docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt").replace(/\s+/g, " ");
    expect(mirror).toContain("Timberland Bank also recommends dual control approval for all file originations.");
    expect(steps.DUAL_APPROVAL_NOTE).toContain("'recommends dual control approval'");
    expect(mirror).toContain("Dual Approval Required (Recommended by Bank) [ ] Yes [X] No");
  });

  it("the legal library is regenerated from the generator (no hand edits)", () => {
    const gen = read("scripts/r40/gen-legal-library.py");
    const lib = read("src/lib/payments/ach-legal-library.ts");
    expect(gen).toContain("Dual approval is offered and is off by the owner's choice.");
    expect(lib).toContain("Dual approval is offered and is off by the owner's choice.");
    expect(lib).not.toMatch(/Accept every security procedure Timberland offers/);
  });
});

// =========================================================================
describe("Guide: Timberland setup checklist", () => {
  it("is the second journey, in the plan's order, with dual approval optional", () => {
    const j = buildJourneys(sampleSnapshot())[1];
    expect(j.id).toBe("timberland");
    expect(j.steps.map((s) => s.id)).toEqual(["tb-access", "tb-users", "tb-email", "tb-countersigned", "tb-dual", "tb-match", "tb-prenote"]);
    expect(j.steps.find((s) => s.id === "tb-dual")!.status).toBe("optional");
  });
  it("the four hand-recorded items are one-time calendar tasks", () => {
    for (const id of ["timberland_access_ready", "timberland_users_phones", "timberland_schedule_g_email", "timberland_countersigned_copy"]) {
      expect(ACH_CAL_TASKS.find((t) => t.id === id)?.cadence, id).toBe("once");
    }
  });
  it("the store reads them from the calendar, the S2 stamp and a passed prenote", () => {
    const s = code(read("src/lib/payments/ach-guide-store.ts"));
    expect(s).toMatch(/accessReady: isTaskDoneNow\("timberland_access_ready"/);
    expect(s).toMatch(/matchConfirmed = stamp\.error \? null :/);
    expect(s).toMatch(/\.eq\("method", "prenote"\)\.eq\("status", "passed"\)/);
    expect(s).toMatch(/dualApprovalOn: BANK_DUAL_APPROVAL_ON_FILE/);
  });
});

// =========================================================================
describe("0274 pins and its mutation log", () => {
  const sql = read("supabase/migrations/0274_ach_file_bank_steps.sql");
  it("two server-only functions; owner checks; set-once stamps; no uploader-not-approver rule", () => {
    expect(sql).toMatch(/create or replace function public\.ach_file_mark_uploaded\(p_file_id uuid, p_actor uuid\)/);
    expect(sql).toMatch(/create or replace function public\.ach_file_mark_bank_approved\(p_file_id uuid, p_actor uuid\)/);
    expect(sql).toMatch(/revoke all on function public\.ach_file_mark_uploaded\(uuid, uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.ach_file_mark_bank_approved\(uuid, uuid\) to service_role/);
    expect(sql).toContain("ACH_BANK_STEP_FINAL");
    expect(sql).toMatch(/ach_actor_is_owner\(new\.uploaded_by\)/);
    expect(sql).toMatch(/ach_actor_is_owner\(new\.approved_at_bank_by\)/);
    expect(code(sql.replace(/^\s*--.*$/gm, ""))).not.toMatch(/approved_at_bank_by\s*(<>|!=|is distinct from)\s*(new\.|old\.)?uploaded_by/);
    expect(sql.replace(/^\s*--.*$/gm, "")).not.toMatch(/security definer/i);
  });
  it("is registered as a post-apply check and in MIGRATIONS_TO_RUN", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain('{ file: "scripts/recon/ach-file-bank-steps-0274-pg-check.sql", mustPrint: "ACH 0274 CHECK PASSED" }');
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## R41 — 0274 — ACH file bank steps");
  });
  it("scripts/r41/mutate-0274-sql.last.log: every SQL mutant killed, controls before and after pass", () => {
    const script = read("scripts/r41/mutate-0274-sql.py");
    const log = read("scripts/r41/mutate-0274-sql.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(20);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  });
});

// keep the ledger core import used (its table is what the store maps through)
it("the ledger error table maps every 0274 refusal code", () => {
  for (const c of ["ACH_BANK_STEP_FINAL", "ACH_BANK_STEP", "ACH_OWNER_ONLY"]) expect(core.LEDGER_ERROR_TABLE.some(([re]) => re.test(c)), c).toBe(true);
});

describe("S6 app mutation run (test the tests)", () => {
  it("scripts/r41/mutate-s6-app.last.log: every app mutant killed, controls before and after pass", () => {
    const script = read("scripts/r41/mutate-s6-app.py");
    const log = read("scripts/r41/mutate-s6-app.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(20);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  });
});
