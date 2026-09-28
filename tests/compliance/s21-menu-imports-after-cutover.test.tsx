/**
 * tests/compliance/s21-menu-imports-after-cutover.test.tsx
 *
 * S21 (bible F-075 / F-088): once the one-time Cultivera import is published,
 * Menu Imports stops advertising uploads and states the date it happened.
 *
 *   1. Pure core: exact self-test count (a deleted check turns this red).
 *   2. Server reads against a fake PostgREST: named columns, the S18 filters,
 *      bounded, and every failure -> "unknown" (never "done" on a guess).
 *   3. Render test of BOTH states (bible S21.5) on the real component, and
 *      the acceptance criterion (S21.6): post-cutover the upload is hidden
 *      by default = inside a <details> with no `open` attribute.
 *   4. Page wiring + docs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COMPLETED_IMPORT_SELECT,
  ONE_TIME_TOOLS_SUMMARY,
  __runMenuImportsCutoverTests,
  completedHeadline,
  completedSubtitle,
  laterUploadNote,
  menuImportsCutover,
  oneTimeToolsNote,
  storeDate,
  type CutoverVersionRow,
  type MenuImportsCutover,
} from "../../src/lib/inventory/menu-imports-cutover-core";
import { OneTimeImportTools } from "../../src/components/admin/catalog/OneTimeImportTools";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// --- Fake PostgREST -----------------------------------------------------------
type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls: Call[] = [];
let rows: { earliest: unknown; latest: unknown; count: number | null } = { earliest: null, latest: null, count: 0 };
let failOn: "earliest" | "latest" | "count" | "throw" | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (failOn === "throw") throw new Error("no client");
    return {
      from(table: string) {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const b: Record<string, unknown> = {};
        for (const m of ["select", "not", "eq", "is", "gt", "order", "limit"]) {
          b[m] = (...args: unknown[]) => {
            call.ops.push([m, args]);
            return b;
          };
        }
        const asc = () => {
          const o = call.ops.find(([m]) => m === "order");
          return (o?.[1][1] as { ascending?: boolean } | undefined)?.ascending;
        };
        b.maybeSingle = () => {
          call.ops.push(["maybeSingle", []]);
          const which = asc() === true ? "earliest" : "latest";
          if (failOn === which) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: rows[which], error: null });
        };
        // The HEAD count query is awaited directly.
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(
            failOn === "count" ? { data: null, count: null, error: { message: "boom" } } : { data: null, count: rows.count, error: null },
          ).then(res, rej);
        return b;
      },
    };
  },
}));

const row = (o: Partial<CutoverVersionRow> & { id: string }): CutoverVersionRow => ({
  import_id: "imp-1",
  is_test: false,
  published_at: "2026-08-01T17:00:00Z",
  item_count: 4512,
  lot_plan: { lotsPlanned: 5120 },
  ...o,
});

// === 1. Core ===================================================================
describe("S21 core", () => {
  it("self-tests pass with an exact count", () => {
    expect(__runMenuImportsCutoverTests()).toEqual({ passed: 45 });
  });
  it("named columns; the lot plan is read by JSON path, never the whole summary", () => {
    expect(COMPLETED_IMPORT_SELECT).toBe("id, import_id, is_test, published_at, item_count, lot_plan:summary_json->lotPlan");
    expect(COMPLETED_IMPORT_SELECT).not.toMatch(/\*|summary_json,|summary_json$/);
  });
  it("copy is the bible's S21.4 subtitle and S21.2 toggle, verbatim", () => {
    expect(completedSubtitle("Aug 1, 2026")).toBe(
      "Menu updates from receiving publish automatically. Your one-time Cultivera import was completed on Aug 1, 2026.",
    );
    expect(ONE_TIME_TOOLS_SUMMARY).toBe("Show one-time import tools");
    expect(completedHeadline("Aug 1, 2026", { products: 4512, lots: 5120 })).toBe(
      "Initial Cultivera import completed Aug 1, 2026 (4,512 products, 5,120 lots planned)",
    );
  });
  it("an archived import (receiving published on top) is still completed: published_at, not status", () => {
    // 0236 archives the old live version by changing only its status.
    const sql = read("supabase/migrations/0236_publish_archive_rule.sql");
    expect(sql).toContain("set status = 'archived', updated_at = now()\n   where status = 'published' and id <> p_version_id;");
    const r = menuImportsCutover({ earliest: row({ id: "a" }), latest: row({ id: "a" }), count: 1, failed: false });
    expect(r.done).toBe(true);
    expect(COMPLETED_IMPORT_SELECT).not.toContain("status");
  });
  it("the store date is Pacific (an evening upload is not tomorrow)", () => {
    expect(storeDate("2026-08-02T03:30:00Z")).toBe("Aug 1, 2026");
  });
  it("the tools note says 'refused' only when S18 refuses, and matches the guard's own copy", () => {
    expect(oneTimeToolsNote(true)).toMatch(/refused/);
    expect(oneTimeToolsNote(false)).not.toMatch(/refused/);
    // The refusal really exists and keeps Test mode (S18 core).
    const core = read("src/lib/inventory/cutover-guard-core.ts");
    expect(core).toContain("return !isTest && done;");
    expect(core).toContain("(A Test-mode upload is still allowed for rehearsals.)");
  });
});

// === 2. Server reads ===========================================================
describe("S21 server reads (fake PostgREST)", () => {
  beforeEach(() => {
    calls.length = 0;
    failOn = null;
    rows = { earliest: null, latest: null, count: 0 };
  });
  const load = async () => (await import("../../src/lib/pos/menu-imports-cutover")).readMenuImportsCutover();

  it("three bounded reads on menu_versions with the S18 filters and named columns", async () => {
    rows = { earliest: row({ id: "e" }), latest: row({ id: "e" }), count: 1 };
    await load();
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.table).toBe("menu_versions");
      const ops = c.ops.map(([m, a]) => `${m}(${JSON.stringify(a)})`);
      expect(ops).toContain('not(["import_id","is",null])');
      expect(ops).toContain('eq(["is_test",false])');
      expect(ops).toContain('not(["published_at","is",null])');
    }
    const [e, l, n] = calls.map((c) => c.ops.map(([m, a]) => `${m}(${JSON.stringify(a)})`));
    expect(e).toEqual([
      `select(${JSON.stringify([COMPLETED_IMPORT_SELECT])})`,
      'not(["import_id","is",null])',
      'eq(["is_test",false])',
      'not(["published_at","is",null])',
      'order(["published_at",{"ascending":true}])',
      "limit([1])",
      "maybeSingle([])",
    ]);
    expect(l).toContain('order(["published_at",{"ascending":false}])');
    expect(l).toContain("limit([1])");
    expect(n[0]).toBe('select(["id",{"count":"exact","head":true}])');
    expect(n.some((o) => o.startsWith("order") || o.startsWith("limit"))).toBe(false);
  });
  it("happy path: earliest is the import; a later real upload is reported, not hidden", async () => {
    rows = {
      earliest: row({ id: "e" }),
      latest: row({ id: "l", import_id: "imp-2", published_at: "2026-08-05T18:00:00Z" }),
      count: 2,
    };
    const r = await load();
    expect(r.done).toBe(true);
    if (r.done) {
      expect(r.first.versionId).toBe("e");
      expect(r.latest?.versionId).toBe("l");
      expect(r.realPublishedCount).toBe(2);
    }
  });
  it("no import yet -> not done, known", async () => {
    expect(await load()).toEqual({ done: false, unknown: false });
  });
  for (const f of ["earliest", "latest", "count", "throw"] as const) {
    it(`a failed ${f} read -> unknown, never done`, async () => {
      rows = { earliest: row({ id: "e" }), latest: row({ id: "e" }), count: 1 };
      failOn = f;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await load()).toEqual({ done: false, unknown: true });
      spy.mockRestore();
    });
  }
  it("server-only, reads only, no environment", () => {
    const s = read("src/lib/pos/menu-imports-cutover.ts");
    expect(s).toContain('import "server-only";');
    expect(s).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(s).not.toMatch(/process\.env|fetch\(|setInterval|setTimeout/);
    expect(s).not.toContain('select("*")');
  });
});

// === 3. Render: both states ====================================================
describe("S21 render (both states)", () => {
  const upload = <form data-testid="upload-form">Upload &amp; stage for review</form>;
  const render = (cutover: MenuImportsCutover, refused = false) =>
    renderToStaticMarkup(
      <OneTimeImportTools cutover={cutover} refused={refused}>
        {upload}
      </OneTimeImportTools>,
    );
  const done = (o: Partial<Extract<MenuImportsCutover, { done: true }>> = {}): MenuImportsCutover => ({
    done: true,
    first: { versionId: "e", importId: "imp-1", publishedAt: "2026-08-01T17:00:00Z", products: 4512, lots: 5120 },
    latest: null,
    realPublishedCount: 1,
    ...o,
  });

  it("before cutover: the upload renders open, exactly as before (no banner, no details)", () => {
    const html = render({ done: false, unknown: false });
    expect(html).toBe(renderToStaticMarkup(upload));
    expect(html).not.toContain("<details");
  });
  it("read failed (unknown): same as before cutover, never collapses on a guess", () => {
    expect(render({ done: false, unknown: true })).toBe(renderToStaticMarkup(upload));
  });
  it("after cutover: headline with date + counts, upload inside a CLOSED <details> (S21.6)", () => {
    const html = render(done());
    expect(html).toContain("Initial Cultivera import completed Aug 1, 2026 (4,512 products, 5,120 lots planned)");
    const d = html.match(/<details[^>]*>/);
    expect(d).not.toBeNull();
    expect(d![0]).not.toMatch(/\sopen(=|\s|>)/);
    const summary = html.match(/<summary[^>]*>([^<]*)<\/summary>/);
    expect(summary?.[1]).toBe("Show one-time import tools");
    // The form is INSIDE the details, after the summary.
    const iDetails = html.indexOf("<details");
    const iSummaryEnd = html.indexOf("</summary>");
    const iForm = html.indexOf('data-testid="upload-form"');
    const iDetailsEnd = html.indexOf("</details>");
    expect(iDetails).toBeLessThan(iSummaryEnd);
    expect(iSummaryEnd).toBeLessThan(iForm);
    expect(iForm).toBeLessThan(iDetailsEnd);
    expect(html.split('data-testid="upload-form"')).toHaveLength(2);
  });
  it("the note under the toggle follows the S18 verdict", () => {
    expect(render(done(), true)).toContain(oneTimeToolsNote(true).replace(/'/g, "&#x27;"));
    expect(render(done(), false)).toContain(oneTimeToolsNote(false).replace(/'/g, "&#x27;"));
    expect(render(done(), false)).not.toContain("refused");
  });
  it("counts the upload never recorded say so (never 0)", () => {
    const html = render(done({ first: { versionId: "e", importId: "i", publishedAt: "2026-08-01T17:00:00Z", products: null, lots: null } }));
    expect(html).toContain("(product count not recorded, lot count not recorded)");
    expect(html).not.toContain("(0 products");
  });
  it("a later real upload is stated only when there really was more than one", () => {
    const later = { versionId: "l", importId: "i2", publishedAt: "2026-08-05T18:00:00Z", products: 9, lots: 9 };
    expect(render(done({ latest: later, realPublishedCount: 2 }))).toContain(laterUploadNote("Aug 5, 2026", 2));
    expect(render(done({ latest: later, realPublishedCount: null }))).not.toContain("cultivera-later-upload");
    expect(render(done({ latest: later, realPublishedCount: 1 }))).not.toContain("cultivera-later-upload");
    expect(render(done({ latest: null, realPublishedCount: 2 }))).not.toContain("cultivera-later-upload");
  });
  it("the component is a pure server component (no hooks, no client directive)", () => {
    const c = read("src/components/admin/catalog/OneTimeImportTools.tsx");
    expect(c).not.toMatch(/^\s*["']use client["'];?\s*$/m);
    expect(c).not.toMatch(/useState|useEffect/);
  });
});

// === 4. Page wiring + docs ======================================================
describe("S21 page wiring", () => {
  const page = read("src/app/admin/menu-imports/page.tsx");
  it("subtitle: the S21.4 line after cutover, the S00 purpose copy otherwise", () => {
    expect(page).toContain(
      "subtitle={cutover.done ? completedSubtitle(storeDate(cutover.first.publishedAt)) : MENU_IMPORTS_PURPOSE_COPY}",
    );
  });
  it("its own bounded reads run beside the existing loaders (not listVersions(30))", () => {
    expect(page).toMatch(
      /const \[cutover, uploadRefused\]: \[MenuImportsCutover, boolean\] = await Promise\.all\(\[\s*readMenuImportsCutover\(\),\s*readCutoverDone\(\),\s*\]\);/,
    );
  });
  it("the upload section (and its form) sits inside OneTimeImportTools", () => {
    const open = page.indexOf("<OneTimeImportTools cutover={cutover} refused={uploadRefused}>");
    const close = page.indexOf("</OneTimeImportTools>");
    expect(open).toBeGreaterThan(-1);
    // The WHOLE section (heading, copy, runbook link, form) is the child - not just part of it.
    expect(page).toMatch(
      /<OneTimeImportTools cutover=\{cutover\} refused=\{uploadRefused\}>\s*<section className="rounded-xl border border-white\/10 bg-\[#0a0a0a\] p-5">\s*<h2 className="text-sm font-semibold text-white">Upload a new POS export<\/h2>/,
    );
    expect(page).toMatch(/<\/form>\s*<\/section>\s*<\/OneTimeImportTools>/);
    expect(page.indexOf("Read the Cultivera cutover runbook")).toBeGreaterThan(open);
    expect(page.indexOf("Read the Cultivera cutover runbook")).toBeLessThan(close);
    expect(page.indexOf(">Upload a new POS export</h2>")).toBeGreaterThan(open);
    expect(page.indexOf("<form action={uploadAndStageImport}")).toBeGreaterThan(open);
    expect(page.indexOf("<form action={uploadAndStageImport}")).toBeLessThan(close);
    // Clean Slate and history stay outside, always visible.
    expect(page.indexOf("Clean Slate \u2014 reset test data")).toBeGreaterThan(close);
    expect(page.indexOf("Import history")).toBeGreaterThan(close);
  });
  it("the self-tests are registered in the pure runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runMenuImportsCutoverTests } from "../../src/lib/inventory/menu-imports-cutover-core";');
    expect(runner).toMatch(/\n\s+__runMenuImportsCutoverTests\(\);/);
  });
  it("the runbook tells the owner what the page shows after step 4", () => {
    const rb = read("docs/CULTIVERA_CUTOVER_RUNBOOK.md");
    expect(rb).toContain("**Show one-time import tools**");
    expect(rb).toContain("never as 0");
  });
});
