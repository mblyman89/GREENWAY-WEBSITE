/**
 * R39 S7 part 2 — wiring invariants for ACH operations (server actions, the
 * check-file route, the Operations page, the Banking link). These read source,
 * so a careless edit that drops the permission, the audit, the confirm box,
 * the fingerprint, or leaks a test-credit amount trips a test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const ACTIONS = read("src/app/admin/settings/banking/ops-actions.ts");
const ROUTE = read("src/app/admin/settings/banking/operations/check-file/route.ts");
const PAGE = read("src/app/admin/settings/banking/operations/page.tsx");
const BANK = read("src/app/admin/settings/banking/page.tsx");
const STORE = read("src/lib/payments/ach-ops-store.ts");
/** Source with block and line comments removed (so prose can name things code must not). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROUTE_CODE = code(ROUTE);

function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} exists`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}
const firstLine = (body: string) => body.slice(body.indexOf("{") + 1).trim().split("\n")[0];
/** R41 S0: the private body an exported action hands to achGate (never exported). */
function bodyOf(src: string, name: string): string {
  const b = name.replace(/Action$/, "Body");
  const i = src.indexOf(`async function ${b}(`);
  expect(i, `${b} exists`).toBeGreaterThan(-1);
  expect(src.slice(Math.max(0, i - 7), i), `${b} is not exported`).not.toBe("export ");
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}

const KIND: Record<string, string> = {
  logNoticeAction: "ach_notice.log",
  resolveNoticeAction: "ach_notice.resolve",
  releaseEmployeeHoldAction: "employee_hold.release",
  startCheckAction: "ach_check.start",
  markCheckFileSentAction: "ach_check.mark_sent",
  releaseCheckFileAction: "ach_check.release_file",
  finishCheckAction: "ach_check.finish",
  setLegalHoldAction: "legal_hold.set",
  reviewDoneAction: "annual_review.done",
};
const NAMES = [
  "logNoticeAction",
  "resolveNoticeAction",
  "releaseEmployeeHoldAction",
  "startCheckAction",
  "markCheckFileSentAction",
  "releaseCheckFileAction",
  "finishCheckAction",
  "setLegalHoldAction",
  "reviewDoneAction",
];

describe("ops actions: owner/admin only, audited, words back", () => {
  it("R41 S0: is a server-actions module; every export goes through achGate FIRST with its own kind; no extra exports", () => {
    expect(ACTIONS.trimStart().startsWith('"use server";')).toBe(true);
    for (const n of NAMES) {
      expect(firstLine(fn(ACTIONS, n)), n).toMatch(new RegExp(`^return achGate\\("${KIND[n].replace(".", "\\.")}", fd, \\{`));
      // The body runs only through the gate, with the gate's session.
      expect(firstLine(fn(ACTIONS, n)), n).toContain(`(session) => ${n.replace(/Action$/, "Body")}(session, fd)`);
    }
    expect([...ACTIONS.matchAll(/export async function /g)].length).toBe(NAMES.length);
    expect(ACTIONS).not.toMatch(/^export (const|function|let|default)/m);
    // The old bypass is gone: no export starts with settings.manage any more.
    expect(code(ACTIONS)).not.toContain('requirePermission("settings.manage")');
  });
  it("every action writes an audit row with the signed-in profile AFTER the store succeeded", () => {
    for (const n of NAMES) {
      const b = bodyOf(ACTIONS, n);
      expect(b, n).toMatch(/recordAudit\(\{\s*actorId: session\.profile\.id,\s*actorEmail: session\.email/);
      const ok = b.indexOf("if (!r.ok) back(");
      expect(ok, n).toBeGreaterThan(-1);
      expect(ok, n).toBeLessThan(b.indexOf("recordAudit("));
      expect(b, n).toContain(".catch(() => {})");
    }
  });
  it("each action calls exactly its own store function", () => {
    const map: Record<string, string> = {
      logNoticeAction: "logNotice(",
      resolveNoticeAction: "resolveNotice(",
      releaseEmployeeHoldAction: "releaseEmployeeHold(",
      startCheckAction: "startCheck(",
      markCheckFileSentAction: "markCheckFileSent(",
      releaseCheckFileAction: "releaseCheckFile(",
      finishCheckAction: "finishCheck(",
      setLegalHoldAction: "setLegalHold(",
      reviewDoneAction: "markReviewDone(",
    };
    for (const [n, call] of Object.entries(map)) expect(bodyOf(ACTIONS, n), n).toContain(`await ${call}`);
  });
  it("the actor is always the session, never a form field", () => {
    expect(ACTIONS).not.toMatch(/actorId:\s*str\(fd/);
    expect(ACTIONS).not.toMatch(/str\(fd, "actor/);
  });
  it("confirm-sent needs the checkbox and the fingerprint BEFORE the store is called", () => {
    const b = bodyOf(ACTIONS, "markCheckFileSentAction");
    const box = b.indexOf('str(fd, "confirm") !== "yes"');
    expect(box).toBeGreaterThan(-1);
    expect(box).toBeLessThan(b.indexOf("markCheckFileSent("));
    expect(b).toContain('fingerprint: str(fd, "fp")');
  });
  it("the test-credit amount is never audited or shown", () => {
    const b = bodyOf(ACTIONS, "startCheckAction");
    expect(b).not.toMatch(/micro|cents/i);
    expect(PAGE).not.toMatch(/micro_amount_cents|microCents/);
  });
  it("redirects never echo raw form values", () => {
    for (const m of ACTIONS.matchAll(/back\((\{[^;]*)\);/g)) expect(m[1]).not.toMatch(/fd\.get|str\(fd/);
  });
  it("owner emails go through the Resend mailer and the link uses the vetted site URL", () => {
    expect(bodyOf(ACTIONS, "logNoticeAction")).toContain("mail: resendOpsMailer()");
    expect(bodyOf(ACTIONS, "logNoticeAction")).toContain("opsSiteUrl(process.env)");
  });
  it("R41 S0 (D-6): a hold release says whether the actor is the owner from the session role, never the form; the store sends no one-person email any more (achGate sends the receipt)", () => {
    const b = bodyOf(ACTIONS, "releaseEmployeeHoldAction");
    expect(b).toContain('actorIsOwner: achAuthority(session.profile.role) === "act"');
    expect(b).not.toMatch(/\bmail:/);
    expect(b).not.toContain("resendOpsMailer");
    expect(b).not.toMatch(/str\(fd, "(owner|role|is_owner)/);
  });
});

describe("check-file route: GET records nothing, owner/admin only, never cached", () => {
  it("requires settings.manage before anything else", () => {
    const body = ROUTE.slice(ROUTE.indexOf("export async function GET("));
    expect(firstLine(body)).toBe('const session = await requirePermission("settings.manage");');
  });
  it("R41 S3: serves the RELEASED stored bytes only: never builds, never marks sent, keyed by the page's fingerprint", () => {
    expect(ROUTE_CODE).toContain('readLiveFileForSource(method, checkFileSourceId(method, q.get("effective") ?? "", fp));');
    expect(ROUTE_CODE).not.toMatch(/buildCheckFile|planCheckFile|releaseCheckFile|releaseAchFile/);
    expect(ROUTE_CODE).not.toMatch(/markCheckFileSent|mark_sent|\.rpc\(|\.insert\(|\.update\(/);
    expect(ROUTE).toContain("/^[0-9a-f]{16}$/.test(fp)");
    expect(ROUTE_CODE).toContain("return new Response(res.body, {");
  });
  it("attachment with the ledger filename, no-store, nosniff; refusals are no-store too (CRLF is fixed at release, R41 S3)", () => {
    expect(ROUTE).toContain('attachment; filename="${res.row.filename}"');
    expect([...ROUTE.matchAll(/"Cache-Control": "no-store"/g)].length).toBe(4);
    expect(ROUTE).toContain('"X-Content-Type-Options": "nosniff"');
  });
  it("the download is audited without bank numbers", () => {
    expect(ROUTE).toContain('action: "ach.verification.file_downloaded"');
    const audit = ROUTE.slice(ROUTE.indexOf("recordAudit("), ROUTE.indexOf("}).catch"));
    expect(audit).not.toMatch(/routing|account|\.file\b/i);
  });
});

describe("Operations page", () => {
  it("is owner/admin only and dynamic", () => {
    expect(PAGE).toContain('await requirePermission("settings.manage")');
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
  });
  it("wires every action and every section anchor the actions return to", () => {
    for (const n of NAMES) expect(PAGE, n).toContain(`action={${n}}`);
    for (const a of ["notices", "holds", "checks", "reviews", "records"]) {
      expect(PAGE, a).toContain(`id="${a}"`);
      expect(ACTIONS, a).toContain(`"#${a}"`);
    }
  });
  it("the download link carries the same fingerprint the confirm form posts", () => {
    expect(PAGE).toContain("const fp = checkListFingerprint(ids);");
    expect(PAGE).toContain("&fp=${fp}");
    expect(PAGE).toContain('<input type="hidden" name="fp" value={fp} />');
    expect(PAGE).toContain('name="confirm" value="yes" required');
  });
  it("the field names match what the store reads", () => {
    for (const f of ["payee", "code", "received_on", "settlement_date", "amount", "trace", "corrected", "verification"]) expect(PAGE, f).toContain(`name="${f}"`);
    for (const f of ['"payee"', '"code"', '"received_on"', '"settlement_date"', '"amount"', '"trace"', '"corrected"']) expect(read("src/lib/payments/ach-return-log-core.ts")).toContain(`g(${f})`);
    expect(STORE).toContain('input.get("verification")');
  });
  it("is linked from the Banking page", () => {
    expect(BANK).toContain('href="/admin/settings/banking/operations"');
  });
});

describe("R39 S7 part 2 mutation evidence is current", () => {
  for (const [script, log, floor] of [
    ["scripts/r39/mutate-ach-ops-core.py", "scripts/r39/mutate-ach-ops-core.last.log", 58],
    ["scripts/r39/mutate-ach-ops-store.py", "scripts/r39/mutate-ach-ops-store.last.log", 64],
    ["scripts/r39/mutate-ach-ops-wiring.py", "scripts/r39/mutate-ach-ops-wiring.last.log", 26],
  ] as const) {
    it(`${log}: every mutant killed, and the log covers the script's full list`, () => {
      const s = read(script);
      const l = read(log);
      const listed = s.slice(s.indexOf("M = ["), s.indexOf("\n]\n")).split("\n").filter((x) => /^\s{4}\(/.test(x)).length;
      const m = /total (\d+) killed (\d+) survivors \[\]/.exec(l);
      expect(m, "clean summary line").not.toBeNull();
      expect(Number(m![1])).toBe(listed);
      expect(Number(m![2])).toBe(listed);
      expect(listed).toBeGreaterThanOrEqual(floor);
      expect(l).not.toMatch(/SURVIVED|ANCHOR MISSING/);
    });
  }
});
