/**
 * R39 S6 — wiring invariants for the in-person e-sign UI (actions, page,
 * signer's-copy route) and the employee card link. These read source, so a
 * careless edit that drops a permission, an ownership check, a header or a
 * form field name trips a test. Each block names the owner answer it guards.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const DIR = "src/app/admin/staffing/employees/[id]/esign";
const ACTIONS = read(`${DIR}/actions.ts`);
const PAGE = read(`${DIR}/page.tsx`);
const ROUTE = read(`${DIR}/record/route.ts`);
const CARD = read("src/app/admin/staffing/employees/[id]/EmployeeAchCard.tsx");
const EMP_PAGE = read("src/app/admin/staffing/employees/[id]/page.tsx");
const CORE = read("src/lib/payments/ach-esign-core.ts");
const INTAKE = read("src/lib/payments/ach-document-intake-core.ts");

function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} exists`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}
const ACTION_NAMES = ["startEsignAction", "sendEsignCodeAction", "verifyEsignCodeAction", "signEsignAction", "cancelEsignAction"];

describe("R39 S6 actions: owner Q1 (Stephen and Michael do every step)", () => {
  it("is a server-actions module", () => {
    expect(ACTIONS.trimStart().startsWith('"use server";')).toBe(true);
  });
  it("every action requires settings.manage as its FIRST statement", () => {
    for (const n of ACTION_NAMES) {
      const body = fn(ACTIONS, n);
      const first = body.slice(body.indexOf("{") + 1).trim().split("\n")[0];
      expect(first, n).toBe('const session = await requirePermission("settings.manage");');
    }
    expect([...ACTIONS.matchAll(/export async function /g)].length).toBe(ACTION_NAMES.length);
  });
  it("every action except start loads the session through sessionFor (ownership)", () => {
    expect(ACTIONS).toMatch(/if \(!s \|\| s\.employee_id !== employeeId\) back\(/);
    for (const n of ACTION_NAMES.slice(1)) expect(fn(ACTIONS, n), n).toContain("await sessionFor(fd, employeeId)");
    expect(fn(ACTIONS, "startEsignAction")).not.toContain("sessionFor(");
  });
  it("ids are UUID-checked and redirects are built from validated ids only", () => {
    expect(ACTIONS).toContain("const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;");
    expect(ACTIONS).toMatch(/if \(!UUID\.test\(id\)\) redirect\(/);
    expect(ACTIONS).toMatch(/const s = UUID\.test\(sid\) \? await getEsignSession\(sid\) : null;/);
    for (const m of ACTIONS.matchAll(/redirect\(([^;]*)\);/g)) expect(m[1]).not.toMatch(/str\(fd|fd\.get/);
  });
  it("start requires the in-person photo-ID tick (identity comes from the counter check)", () => {
    const b = fn(ACTIONS, "startEsignAction");
    expect(b).toMatch(/if \(str\(fd, "id_seen"\) !== "on"\) back\(/);
    expect(b.indexOf('"id_seen"')).toBeLessThan(b.indexOf("startEsignSession("));
  });
  it("sign redirects with done=<session> so the signed card (and the copy link) shows", () => {
    expect(fn(ACTIONS, "signEsignAction")).toMatch(/redirect\(`\$\{page\(employeeId\)\}\?done=\$\{encodeURIComponent\(s\.id\)\}&ok=/);
  });
  it("audits every step with number-free payloads", () => {
    for (const a of ["ach_esign.start", "ach_esign.code_sent", "ach_esign.consented", "ach_esign.signed", "ach_esign.cancel"]) expect(ACTIONS).toContain(`action: "${a}"`);
    const audits = [...ACTIONS.matchAll(/recordAudit\(\{([\s\S]*?)\n {2}\}\);/g)].map((m) => m[1]);
    expect(audits.length).toBe(5);
    for (const a of audits) {
      expect(a).not.toMatch(/routing|parsed\.accounts|res\.accounts\b|str\(fd, "email"\)|str\(fd, "code"\)|email_enc|otp_digest|emailTo/);
    }
  });
  it("owner Q9: the signed notice goes to Stephen, Michael and the store, and to the employee", () => {
    const b = fn(ACTIONS, "signEsignAction");
    expect(b).toContain("to: [book.stephen.email, book.michael.email, book.store.email]");
    expect(b).toContain("to: [res.emailTo]");
    expect(b).toContain("signedNotices(");
  });
  it("the code email goes through Resend and reports a missing key instead of pretending", () => {
    expect(ACTIONS).toContain('if (!apiKey || !from) return { ok: false, detail: "RESEND_API_KEY or ORDER_EMAIL_FROM is not set" };');
  });
});

describe("R39 S6 page: what the employee and the checker see", () => {
  it("requires settings.manage and 404s a bad id", () => {
    expect(PAGE).toContain('await requirePermission("settings.manage");');
    expect(PAGE).toMatch(/if \(!UUID\.test\(employeeId\)\) notFound\(\);/);
  });
  it("a done= session is shown only if it belongs to this employee", () => {
    expect(PAGE).toContain("done && done.employee_id === employeeId ? done : null");
  });
  it("posts the disclosure hash the screen was rendered with", () => {
    expect(PAGE).toContain('<input type="hidden" name="disclosure_sha256" value={currentDisclosureSha256()} />');
  });
  it("renders every term and WAC line from ACH_E_TERMS (verified verbatim against the paper form)", () => {
    expect(PAGE).toContain("ACH_E_TERMS.wac.map(");
    expect(PAGE).toContain("ACH_E_TERMS.terms.map(");
    expect(PAGE).toContain("{ACH_E_TERMS.acknowledgment}");
    expect(PAGE).toContain("{ESIGN_INTENT_STATEMENT}");
  });
  it("owner Q11: three account rows; every field name matches what the parser reads", () => {
    expect([...PAGE.matchAll(/<AccountRow i=\{(\d)\} \/>/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    const pageNames = new Set([...PAGE.matchAll(/name=\{`a\$\{i\}_([a-z0-9]+)`\}/g)].map((m) => m[1]));
    const parsed = new Set([
      ...[...CORE.matchAll(/`a\$\{rows\[j\]\}_([a-z0-9]+)`/g)].map((m) => m[1]),
      ...[...INTAKE.matchAll(/`a\$\{i\}_([a-z0-9]+)`/g)].map((m) => m[1]),
    ]);
    expect([...pageNames].sort()).toEqual(["acct", "acct2", "amt", "bank", "how", "rtn", "rtn2", "type"]);
    for (const n of pageNames) expect(parsed.has(n), `parser reads a{i}_${n}`).toBe(true);
    for (const n of parsed) expect(pageNames.has(n), `page renders a{i}_${n}`).toBe(true);
  });
  it("every plain field the actions read is rendered by the page", () => {
    const read = new Set([...ACTIONS.matchAll(/str\(fd, "([a-z_0-9]+)"\)/g)].map((m) => m[1]));
    for (const n of read) expect(PAGE, `field ${n}`).toMatch(new RegExp(`name="${n}"`));
  });
  it("bank-number inputs are not autofilled or remembered", () => {
    for (const f of ["rtn", "rtn2", "acct", "acct2"]) {
      const m = new RegExp("<Input[^>]*name=\\{`a\\$\\{i\\}_" + f + "`\\}[^>]*>").exec(PAGE);
      expect(m, f).not.toBeNull();
      expect(m![0], f).toContain('autoComplete="off"');
    }
  });
  it("the signer's copy link points at the record route with this session", () => {
    expect(PAGE).toContain("href={`/admin/staffing/employees/${employeeId}/esign/record?session=${s.id}`}");
  });
});

describe("R39 S6 record route: the signer's copy", () => {
  it("is GET-only, owner/admin only, node runtime, never cached", () => {
    expect([...ROUTE.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(["GET"]);
    expect(ROUTE).toContain('await requirePermission("settings.manage");');
    expect(ROUTE).toContain('export const runtime = "nodejs";');
    expect(ROUTE).toContain('export const dynamic = "force-dynamic";');
    expect(ROUTE).toContain('"Cache-Control": "no-store, private"');
    expect(ROUTE).toContain('"X-Content-Type-Options": "nosniff"');
    expect(ROUTE).toContain('"Content-Type": "application/pdf"');
  });
  it("checks both ids and that the session belongs to the employee in the URL (404, no hint)", () => {
    expect(ROUTE).toContain('if (!UUID.test(employeeId) || !UUID.test(sid)) return new Response("Not found.", { status: 404 });');
    expect(ROUTE).toContain('if (!s || s.employee_id !== employeeId) return new Response("Not found.", { status: 404 });');
  });
  it("serves only through signedRecordBytes (SHA-256 re-check) and audits the copy", () => {
    expect(ROUTE).toContain("const rec = await signedRecordBytes(s);");
    expect(ROUTE.indexOf("signedRecordBytes(s)")).toBeLessThan(ROUTE.indexOf("recordAudit("));
    expect(ROUTE).toContain('action: "ach_esign.record_copy"');
    expect(ROUTE).not.toMatch(/createSignedUrl|storage\.from/);
  });
});

describe("R39 S6 entry point on the employee file", () => {
  it("the ACH card links to the e-sign page", () => {
    expect(CARD).toContain("href={`/admin/staffing/employees/${employeeId}/esign`}");
    expect(CARD).toContain("Sign electronically (in person)");
  });
  it("the card (and so the link) renders only for settings.manage", () => {
    expect(EMP_PAGE).toContain('const canSeeVault = can(session.profile.role, "settings.manage");');
    expect(EMP_PAGE).toMatch(/const bankBadge = canSeeVault/);
    expect(EMP_PAGE).toMatch(/\{bankBadge && \(\s*<EmployeeAchCard/);
  });
});
