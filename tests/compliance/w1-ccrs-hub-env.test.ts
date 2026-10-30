/**
 * W-1 (2026-10-30): the CCRS hub keeps the env the owner is testing in, and
 * the email buttons answer where he is looking.
 *
 * Owner, verbatim: "it keeps jumping back to production mode when I am trying
 * to test. The resolve email buttons do not work."
 *
 * Grounding (not a CCRS format rule, so no [G L####] pin applies): the page
 * reads a missing `env` as production (parseLedgerEnv), so any redirect or
 * link that omits env lands on production. These tests make every exit of the
 * hub's server actions go through hubHref (ccrs-hub-flow-core), every form on
 * the page post the env back, and the email Apply prefer the email's own env.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CcrsMailPanel, type CcrsMailPanelRow } from "@/components/admin/compliance/CcrsMailPanel";
import { __runCcrsHubFlowTests, hubHref, mapLimit, scopeEchoPool } from "@/lib/compliance/ccrs-hub-flow-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ACTIONS = read("src/app/admin/compliance/ccrs/actions.ts");
const MAIL = read("src/app/admin/compliance/ccrs/mail-actions.ts");
const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");

describe("W-1 pure core", () => {
  it("self-tests pass", () => {
    const r = __runCcrsHubFlowTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(17);
  });
  it("PREprod survives a redirect with a message and an anchor", () => {
    const u = new URL(hubHref({ week: "W-2026-10-25", env: "preprod", params: { error: "Nothing recorded: x & y" }, anchor: "ccrs-mail" }), "https://x");
    expect(u.searchParams.get("env")).toBe("preprod");
    expect(u.searchParams.get("week")).toBe("W-2026-10-25");
    expect(u.searchParams.get("error")).toBe("Nothing recorded: x & y");
    expect(u.hash).toBe("#ccrs-mail");
  });
  it("a PRE error email is matched only against PREprod files when PREprod has one of that type", () => {
    const files = [
      { env: "prod" as const, fileType: "Sale", id: "a" },
      { env: "preprod" as const, fileType: "Sale", id: "b" },
    ];
    expect(scopeEchoPool(files, "Sale", "preprod").map((f) => f.id)).toEqual(["b"]);
    expect(scopeEchoPool(files, "Sale", null).map((f) => f.id)).toEqual(["a", "b"]);
  });
  it("mapLimit keeps order and never runs more than the limit at once", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, n));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("W-1 no exit of the hub drops the env", () => {
  it("actions.ts: no hand-built hub URL is left; every exit goes through hubHref", () => {
    expect(ACTIONS).not.toMatch(/redirect\(`\$\{BASE\}/);
    expect(ACTIONS).toMatch(/function back\(weekKey: string, extra: string \| undefined, env: LedgerEnv\): never \{\n\s+const params[^\n]*\n\s+redirect\(hubHref\(/);
    expect(ACTIONS).toMatch(/function backTo\([^)]*\): never \{\n\s+redirect\(hubHref\(/);
    expect(ACTIONS).toMatch(/function backToWeek\([\s\S]{0,200}redirect\(hubHref\(\{ week: weekKey, env: formEnv\(formData\)/);
    // every back(...) call passes an env
    const calls = ACTIONS.match(/\bback\((?:week\.key|weekKey),[^;]*;/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const c of calls) expect(c, c).toMatch(/, env\);$/);
  });
  it("resolveWeekAction snapshots the batch of the env it was pressed in", () => {
    const body = ACTIONS.split("export async function resolveWeekAction")[1].split("export async function")[0];
    expect(body).toContain("const env = formEnv(formData);");
    expect(body).toContain("buildCcrsBatch(range.fromISO, range.toISO, { env })");
  });
  it("mail-actions.ts: backMail keeps the env and every call passes it", () => {
    expect(MAIL).not.toMatch(/redirect\(`\$\{BASE\}/);
    expect(MAIL).toMatch(/function backMail\(weekKey: string, extra: string, env: LedgerEnv\): never \{[\s\S]{0,200}redirect\(hubHref\(/);
    const calls = (MAIL.match(/\bbackMail\([^;]*;/g) ?? []).filter((c) => !c.startsWith("backMail(weekKey: string"));
    expect(calls.length).toBeGreaterThanOrEqual(12);
    for (const c of calls) expect(c, c).toMatch(/, (?:env|page)\);$/);
  });
  it("the error Apply is scoped by the EMAIL's env (never by the page), rows read in parallel", () => {
    expect(MAIL).toContain("mail.received_at, echoEnvScope(mail.env));");
    expect(MAIL).toMatch(/const candidates = await mapLimit\(pool, 4,/);
    expect(MAIL).not.toMatch(/for \(const env of \["prod", "preprod"\] as const\) \{\n\s+const list = await listCcrsFiles/);
  });
  it("the page: every hub link uses hubWeekLink and every week form posts env", () => {
    expect(PAGE).not.toMatch(/href=\{`\/admin\/compliance\/ccrs\?/);
    for (const act of ["resolveWeekAction", "unresolveWeekAction", "setWeekErrorStatusAction", "assignProductIdsAction"]) {
      const forms = PAGE.split(`<form action={${act}}`).slice(1);
      expect(forms.length, act).toBeGreaterThan(0);
      for (const f of forms) expect(f.split("</form>")[0], act).toContain('<input type="hidden" name="env" value={env} />');
    }
    expect(PAGE).toMatch(/<CcrsMailPanel[\s\S]{0,600}env=\{env\}[\s\S]{0,40}flash=\{flash\}/);
    expect(PAGE).toContain("export const maxDuration = 300;");
    expect(PAGE).toContain('id="ccrs-week"');
  });
});

describe("W-1 email panel", () => {
  const base = {
    available: true,
    loadError: null,
    setup: { configured: true as const, mode: "service-account", mailbox: "m@x" },
    heartbeat: { lastRunAt: "2026-11-08T19:59:00.000Z", lastOkAt: "2026-11-08T19:59:00.000Z", ok: true, error: null, mode: "service-account" as const, newMessages: 0 },
    uploadedFiles: [],
    canEdit: true,
    weekKey: "W-2026-11-01",
    nowISO: "2026-11-08T20:00:00.000Z",
    actions: { poll: async () => {}, applySuccess: async () => {}, applyError: async () => {}, dismiss: async () => {}, applyAll: async () => {} },
  };
  const row = (over: Partial<CcrsMailPanelRow>): CcrsMailPanelRow => ({
    id: "11111111-1111-1111-1111-111111111111",
    gmail_id: "g1",
    received_at: "2026-11-08T19:00:00.000Z",
    subject: "PRE: CCRS Processing Successful",
    kind: "success",
    env: "preprod",
    env_verified: true,
    auth: "aligned-pass",
    in_spam: false,
    analysis: { successes: [{ fileName: "Strain_413541_20261107230000.csv", submittedAt: null }], needsHuman: [] },
    state: "new",
    handled_note: null,
    ...over,
  });
  const html = (p: Partial<Parameters<typeof CcrsMailPanel>[0]>) => renderToStaticMarkup(createElement(CcrsMailPanel, { ...base, rows: [], ...p }));

  it("every form posts the page env back (page_env), so the redirect stays in PREprod", () => {
    const h = html({ env: "preprod", rows: [row({})] });
    const forms = h.split("<form").length - 1;
    const envs = h.split('name="page_env" value="preprod"').length - 1;
    expect(forms).toBeGreaterThanOrEqual(4);
    expect(envs).toBe(forms);
  });
  it("the result of the last press is shown in the panel the redirect scrolls to", () => {
    expect(html({ flash: { tone: "error", text: "Nothing recorded. x" } })).toContain('data-testid="ccrs-mail-flash"');
    expect(html({ flash: { tone: "error", text: "Nothing recorded. x" } })).toContain("Not done: Nothing recorded. x");
    expect(html({ flash: null })).not.toContain("ccrs-mail-flash");
  });
  it("an email about the other env says so and links there", () => {
    const h = html({ env: "prod", rows: [row({})] });
    expect(h).toContain('data-testid="ccrs-mail-other-env"');
    expect(h).toContain("/admin/compliance/ccrs?week=W-2026-11-01&amp;env=preprod#ccrs-mail");
    expect(html({ env: "preprod", rows: [row({})] })).not.toContain("ccrs-mail-other-env");
  });
  it("the error-file picker offers only files of the email's env", () => {
    const err = row({ kind: "error", subject: "PRE: x", analysis: { errors: [{ filename: "Product__1.csv", fileType: "Product", typeProblem: null, dataLines: 3, messages: ["m"] }], needsHuman: [] } });
    const files = [
      { id: "a", fileName: "Product_413541_1.csv", fileType: "Product" as const, env: "preprod" as const },
      { id: "b", fileName: "Product_413541_2.csv", fileType: "Product" as const, env: "prod" as const },
    ];
    expect(html({ rows: [err], uploadedFiles: files })).not.toContain('name="file_0"');
  });
  it("the tick box and the env choice are required in the browser (no silent refusal)", () => {
    const h = html({ rows: [row({ env: null, env_verified: false })] });
    expect(h).toMatch(/<input type="checkbox"[^>]*\brequired=""[^>]*name="confirm_checked"|name="confirm_checked"[^>]*\brequired=""/);
    expect(h).toMatch(/<select name="env" required=""/);
  });
});
