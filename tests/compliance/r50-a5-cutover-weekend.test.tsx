/**
 * tests/compliance/r50-a5-cutover-weekend.test.tsx  (R50 A5)
 *
 * The one-page cutover weekend plan: the core's self-tests, copy pins on the
 * facts that matter, the printable doc = the core byte for byte, every linked
 * route really exists, and the runbook page actually renders it (real React
 * render, boundaries mocked) with "you are here" from a pinned clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "m@x", profile: { role: "owner" } }),
}));
vi.mock("@/lib/supabase/env", async (importOriginal) => ({ ...((await importOriginal()) as object), isSupabaseServiceConfigured: false }));
vi.mock("@/lib/pos/cutover-guard", () => ({ readCutoverStatus: async () => ({ enabled: false, blocking: null, done: false, pending: [] }) }));
vi.mock("@/lib/pos/cutover-watch", () => ({
  readWatchChannels: async () => ({ email: false, push: false, emailTo: 0, pushDevices: 0 }),
  readRecentWatchAlerts: async () => ({ rows: [], error: null }),
}));
vi.mock("@/lib/pos/cutover-watch-core", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  channelSummary: () => ({ ok: false, lines: ["no channel"] }),
}));
vi.mock("@/app/admin/menu-imports/actions", () => ({ rebuildCutoverDeliveryAction: async () => {}, sendCutoverTestAlertAction: async () => {} }));

const core = await import("@/lib/pos/cutover-weekend-core");

async function renderAt(iso: string): Promise<string> {
  vi.setSystemTime(new Date(iso));
  const { default: Page } = await import("@/app/admin/menu-imports/cutover/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("R50 A5 · the weekend core", () => {
  it("self-tests run (42) and are in the pure runner", () => {
    expect(core.__runCutoverWeekendCoreTests()).toEqual({ passed: 42, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runCutoverWeekendCoreTests } from "../../src/lib/pos/cutover-weekend-core";');
    expect(runner).toMatch(/assertRan\("cutover-weekend-core", __runCutoverWeekendCoreTests\(\), 42\)/);
  });

  it("copy pins: the dates, the times and the rules the day depends on", () => {
    const by = (k: string) => core.WEEKEND_STEPS.find((s) => s.key === k)!;
    expect([core.CUTOVER_COUNT_DATE, core.CUTOVER_LAST_CULTIVERA_DAY, core.CUTOVER_DAY]).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(by("fetch")).toMatchObject({ day: "2026-11-01", at: "06:00", title: "Fetch, with the count date set to 10/30" });
    expect(by("fetch").detail).toBe("Menu Imports: set the count date to 2026-10-30, TICK Start fresh, press Fetch It All. About 8 minutes. If it stops, press Resume on its run page.");
    expect(by("stage").detail).toBe("Within 90 minutes of the harvest finishing, or the app refuses and you fetch again.");
    expect(by("count").detail).toBe("Pick this morning's import, upload every workbook at once, read the preview, apply. Before 08:00: a lot sold first is left alone.");
    expect(by("open").detail).toBe("Your first receiving approval is the point of no return: after it, fixes go forward through receiving only.");
    expect(by("dst")).toMatchObject({ at: "02:00", title: "Clocks fall back (02:00 becomes 01:00)" });
    expect(by("rehearsal4").detail).toContain("Test mode ON");
    expect(by("rehearsal4").detail).toContain("(The units check skips test imports.)");
    expect(by("back_stock").at).toBe("18:00");
    expect(core.WEEKEND_STEPS.map((s) => s.key)).toEqual([
      "rehearsal3", "scanners", "test_sale", "alerts",
      "workbooks", "back_stock", "floor",
      "last_day", "rehearsal4",
      "dst", "fetch", "go", "stage", "publish", "balance", "count", "nothing_waiting", "open", "day_work", "password",
      "drift",
    ]);
  });

  it("the facts are the code's: the 90-minute gate, the units check skipping test imports, resume picks the newest unfinished run", () => {
    expect(read("src/lib/pos/cultivera-fetch-button-core.ts")).toContain("export const MAX_HARVEST_AGE_MINUTES = 90;");
    expect(read("src/lib/pos/cultivera-reconcile.ts")).toContain("Test imports never make lots, so there is nothing to balance.");
    const jobs = read("crawler/app/cultivera_pos_jobs.py");
    expect(jobs).toContain("rid = None if fresh else resumable_run(s)");
    expect(jobs).toContain('if st in ("running", "failed", "cancelled", None):');
    expect(read("src/lib/pos/cultivera-count-core.ts")).toContain('exception = "moved_since_import"');
  });

  it("every linked route exists as an admin page", () => {
    for (const s of core.WEEKEND_STEPS) {
      if (!s.href) continue;
      const path = s.href.split("#")[0].split("?")[0];
      expect(existsSync(join(ROOT, "src/app", path, "page.tsx")), `${s.key}: ${path}`).toBe(true);
    }
  });

  it("the printable doc IS the core, byte for byte (regenerate with renderWeekendMarkdown)", () => {
    expect(read(core.CUTOVER_DOC)).toBe(core.renderWeekendMarkdown());
  });

  it("the long runbook says to tick Start fresh on 11/01", () => {
    const doc = read("docs/CULTIVERA_CUTOVER_RUNBOOK.md");
    expect(doc).toContain("**tick *Start fresh***");
    expect(doc).not.toContain("(leave *Start fresh* off)");
  });
});

describe("R50 A5 · you are here (clock only)", () => {
  it("11/01 06:05 PST → next is the go / no-go", () => {
    const n = core.weekendNow(Date.parse("2026-11-01T14:05:00Z"));
    expect(n).toMatchObject({ day: "2026-11-01", nextTimedKey: "go", pacific: { date: "2026-11-01", time: "06:05" } });
    expect(n.headline).toBe("Now: Sun 11/01: cutover, before the 08:00 open. Next at 06:10: Read the go / no-go.");
  });
  it("a late-night 10/31 instant is still 10/31 in Pacific (UTC is already 11/01)", () => {
    expect(core.weekendNow(Date.parse("2026-11-01T06:30:00Z")).day).toBe("2026-10-31");
  });
});

describe("R50 A5 · the page renders it", () => {
  it("shows every step, the days, the rollback and today's next step", async () => {
    const html = await renderAt("2026-11-01T14:05:00Z");
    expect(html).toContain('data-testid="cutover-weekend"');
    for (const s of core.WEEKEND_STEPS) expect(html).toContain(`data-step="${s.key}"`);
    for (const label of Object.values(core.WEEKEND_DAY_LABEL)) expect(html).toContain(label);
    expect(html).toContain("Sun 11/01: cutover, before the 08:00 open (today)");
    expect(html).toMatch(/data-step="go"[^>]*>.*?<span class="ml-2 text-xs[^"]*">next<\/span>/);
    expect((html.match(/>next<\/span>/g) ?? []).length).toBe(1);
    expect(html).toContain('data-testid="cutover-weekend-rollback"');
    expect(html).toContain("After the first receiving approval:");
    expect(html).toContain("docs/CUTOVER_WEEKEND_ONE_PAGE.md");
    expect(html).toContain('href="/admin/menu-imports/count"');
    // the existing sections are still there, after the plan
    expect(html.indexOf('data-testid="cutover-weekend"')).toBeLessThan(html.indexOf('data-testid="cutover-reconcile"'));
    expect(html).toContain('data-testid="cutover-alerts"');
  });

  it("before the weekend: no step is marked next and the before-section is today", async () => {
    const html = await renderAt("2026-10-27T18:00:00Z");
    expect(html).toContain("Before Fri 10/30 (week of 10/26) (today)");
    expect(html).not.toContain(">next</span>");
    expect(html).toContain("Do the before-the-weekend steps.");
  });
});
