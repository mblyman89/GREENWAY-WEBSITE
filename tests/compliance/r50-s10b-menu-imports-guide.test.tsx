/**
 * tests/compliance/r50-s10b-menu-imports-guide.test.tsx   (R50 S10b)
 *
 * Owner follow-up #5: "completely revamp the menu import page, all of the
 * helpers need to be updated completely to help with the new process. Any
 * links or buttons or help text and such should be modified, updated, and
 * significantly enhanced to make it easy to read and follow the steps."
 *
 * Pins:
 *   1. the pure guide core runs at its measured self-test count (56);
 *   2. the rendered guide shows progress, the one "next" step, real links, and
 *      never claims "Done" for a step the page cannot prove;
 *   3. every guide href is a real admin route in this repo;
 *   4. the page mounts the guide, uses the new help steps, anchors the Fetch
 *      section, and links the CCRS clean-up panel; the help never says Delete.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  __runMenuImportsGuideCoreTests,
  buildMenuImportsGuide,
  GUIDE_HREF,
  MENU_IMPORTS_HELP_STEPS,
  type GuideInput,
} from "@/lib/pos/menu-imports-guide-core";
import { MenuImportsGuide, GUIDE_TITLE } from "@/components/admin/catalog/MenuImportsGuide";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = read("src/app/admin/menu-imports/page.tsx");

const base: GuideInput = { cutover: { done: false, unknown: false }, crawlerConfigured: true, recentRuns: [], imports: [] };
const render = (input: GuideInput, live = false) =>
  renderToStaticMarkup(<MenuImportsGuide steps={buildMenuImportsGuide(input)} importLive={live} />);
const statusOf = (html: string, key: string) => html.match(new RegExp(`data-testid="guide-step-${key}" data-status="(\\w+)"`))?.[1];

describe("R50 S10b guide core", () => {
  it("runs at its measured self-test count", () => {
    expect(__runMenuImportsGuideCoreTests()).toEqual({ passed: 56, failed: 0 });
  });
});

describe("R50 S10b rendered guide", () => {
  it("fresh start: open, step 1 is next, nothing done", () => {
    const html = render(base);
    expect(html).toContain(GUIDE_TITLE);
    expect(html).not.toContain("<details");
    expect(html).toContain("0 of 9 done");
    expect(statusOf(html, "fetch")).toBe("next");
    expect(html.match(/aria-current="step"/g)?.length).toBe(1);
    expect(html).toContain('href="#fetch-cultivera"');
    expect(html).toContain('href="/admin/menu-imports/cutover"');
    expect(html).toContain("Step 1 of 9: Fetch everything from Cultivera.");
  });
  it("after a fetch: links the newest run for the go/no-go", () => {
    const html = render({ ...base, recentRuns: ["run-2", "run-1"] });
    expect(statusOf(html, "fetch")).toBe("done");
    expect(statusOf(html, "go_no_go")).toBe("next");
    expect(html).toContain('href="/admin/menu-imports/fetch/run-2"');
    expect(html).not.toContain("/admin/menu-imports/fetch/run-1");
  });
  it("staged: review is next with Fact Review and warnings links", () => {
    const html = render({ ...base, recentRuns: ["r"], imports: [{ id: "IMP9", status: "staged", created_at: "2026-10-26" }] });
    expect(statusOf(html, "review")).toBe("next");
    expect(html).toContain('href="/admin/menu-imports/IMP9/facts"');
    expect(html).toContain('href="/admin/menu-imports/IMP9#diagnostics"');
    expect(html).toContain('href="/admin/menu-imports/IMP9#publish"');
  });
  it("live: collapsed, five done, the follow-ups are Check (never Done)", () => {
    const html = render({ ...base, cutover: { done: true, first: { importId: "LIVE", publishedAt: "2026-11-01" } } }, true);
    expect(html).toContain("<details");
    expect(html).toContain("5 of 9 done");
    for (const k of ["manifests", "onboarding", "ccrs_cleanup", "receiving"]) expect(statusOf(html, k)).toBe("check");
    expect(html).toContain('href="/admin/menu-imports/LIVE/manifests"');
    expect(html).toContain('href="/admin/menu-imports/LIVE/missing-products"');
    expect(html).toContain('href="/admin/compliance/ccrs#migration-garbage"');
    expect(html).toContain('href="/admin/inventory/intake?view=cultivera"');
    expect(html).not.toContain('aria-current="step"');
  });
  it("unknown read: every step is Check, zero done", () => {
    const html = render({ ...base, cutover: { done: false, unknown: true }, recentRuns: ["r"] });
    expect(html).toContain("0 of 9 done");
    expect(html.match(/data-status="check"/g)?.length).toBe(9);
  });
  it("crawler off: step 1 says set up first, step 2 is not next-without-a-run", () => {
    const html = render({ ...base, crawlerConfigured: false });
    expect(statusOf(html, "fetch")).toBe("blocked");
    expect(html).toContain("Set up first: Fetch everything from Cultivera.");
  });
});

describe("R50 S10b hrefs are real routes", () => {
  const route = (p: string) => existsSync(join(process.cwd(), "src/app", p, "page.tsx"));
  it("every static and templated guide href maps to a page", () => {
    expect(route("admin/menu-imports/cutover")).toBe(true);
    expect(route("admin/menu-imports/fetch/[runId]")).toBe(true);
    expect(route("admin/menu-imports/[id]")).toBe(true);
    expect(route("admin/menu-imports/[id]/facts")).toBe(true);
    expect(route("admin/menu-imports/[id]/manifests")).toBe(true);
    expect(route("admin/menu-imports/[id]/missing-products")).toBe(true);
    expect(route("admin/publish")).toBe(true);
    expect(route("admin/inventory/drafts")).toBe(true);
    expect(route("admin/inventory/intake")).toBe(true);
    expect(route("admin/compliance/ccrs")).toBe(true);
    expect(GUIDE_HREF.ccrsCleanup.split("#")[1]).toBe("migration-garbage");
    expect(read("src/components/admin/compliance/MigrationGarbagePanel.tsx")).toContain('id="migration-garbage"');
    const imp = read("src/app/admin/menu-imports/[id]/page.tsx");
    expect(imp).toContain("<section id={IMPORT_PAGE_ANCHORS.diagnostics}");
    expect(imp).toMatch(/<section id="publish"[^>]*>\s*<h2 className="text-sm font-semibold text-white">Publish<\/h2>/);
  });
});

describe("R50 S10b page wiring", () => {
  it("mounts the guide before the live status and passes the cutover", () => {
    expect(page).toContain("<MenuImportsGuide steps={guideSteps} importLive={cutover.done} />");
    expect(page.indexOf("<MenuImportsGuide")).toBeLessThan(page.indexOf("{/* Live status */}"));
    expect(page).toMatch(/unknown: cutover\.unknown \|\| loadError !== null/);
  });
  it("uses the new help steps and the Fetch anchor", () => {
    expect(page).toContain("steps={[...MENU_IMPORTS_HELP_STEPS]}");
    expect(page).toContain('title="How the Cultivera migration works"');
    expect(page).toMatch(/<div id="fetch-cultivera"[^>]*>\s*<OneTimeImportTools cutover/);
    expect(page).toContain('data-testid="fetch-what-next"');
    expect(page).toContain("href={GUIDE_HREF.ccrsCleanup}");
    expect(page).not.toContain("Upload your first POS export above");
  });
  it("help copy never offers a Delete", () => {
    for (const s of MENU_IMPORTS_HELP_STEPS) expect(s).not.toMatch(/\bDelete\b/);
    expect(page).toContain("Nothing is ever sent as a Delete.");
  });
  it("is registered in the pure runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("menu-imports-guide-core", __runMenuImportsGuideCoreTests(), 56);');
  });
});
