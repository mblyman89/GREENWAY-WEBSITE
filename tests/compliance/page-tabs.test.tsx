/**
 * tests/compliance/page-tabs.test.tsx  (S27)
 *
 * One query-param tab primitive (page-tabs-core + PageTabs), proven three ways:
 *   1. the pure core's embedded self-tests run here and in run-pure-selftests;
 *   2. ReceivingTabs — now a wrapper — renders BYTE-IDENTICAL HTML to the
 *      pre-S27 component (golden strings captured from main before the change);
 *   3. every adopting page (receiving, types, masters) resolves exactly the tab
 *      it resolved before, and nobody hand-rolls a `?tab=` strip any more.
 *
 * Pure render (renderToStaticMarkup): no DOM, no jsdom (see vitest.config.ts).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __runPageTabsCoreTests,
  DEFAULT_KEEP_PARAMS,
  resolveTab,
  tabHref,
  tabCountLabel,
  withTabCounts,
  type TabSpec,
} from "@/lib/admin/page-tabs-core";
import { PageTabs } from "@/components/admin/ui/PageTabs";
import { ReceivingTabs, RECEIVING_TABS_BASE } from "@/components/admin/inventory/ReceivingTabs";
import { RECEIVING_TABS, MANUAL_ERROR_CODES, resolveReceivingTab } from "@/lib/inventory/receiving-tabs-core";
import { MASTERS_PAGE_TABS, TYPES_PAGE_TABS, TYPES_PAGE_BASE, MASTERS_PAGE_BASE } from "@/lib/admin/page-tab-sets";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Captured by rendering the H15d ReceivingTabs from main (ae9aa43) BEFORE S27.
const GOLDEN_EMAIL =
  '<nav aria-label="Receiving views" class="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3"><a aria-current="page" title="Manifests pulled in from vendor_intake@ \u2014 one calm row per real manifest." class="rounded-lg px-3.5 py-2 text-xs font-bold transition bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40" href="/admin/inventory/intake?tab=email"><span class="mr-1.5">\u{1F4EC}</span>Incoming (email)</a><a title="Paste a link/JSON/CSV, upload a PDF, or run the KB backfill \u2014 for when email didn&#x27;t cover it." class="rounded-lg px-3.5 py-2 text-xs font-bold transition text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]" href="/admin/inventory/intake?tab=manual"><span class="mr-1.5">\u{1F9F0}</span>Manual tools</a></nav>';
const GOLDEN_MANUAL =
  '<nav aria-label="Receiving views" class="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3"><a title="Manifests pulled in from vendor_intake@ \u2014 one calm row per real manifest." class="rounded-lg px-3.5 py-2 text-xs font-bold transition text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]" href="/admin/inventory/intake?tab=email"><span class="mr-1.5">\u{1F4EC}</span>Incoming (email)</a><a aria-current="page" title="Paste a link/JSON/CSV, upload a PDF, or run the KB backfill \u2014 for when email didn&#x27;t cover it." class="rounded-lg px-3.5 py-2 text-xs font-bold transition bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40" href="/admin/inventory/intake?tab=manual"><span class="mr-1.5">\u{1F9F0}</span>Manual tools</a></nav>';

describe("S27 · page-tabs-core (pure)", () => {
  it("embedded self-tests pass, and the count is pinned (56 — R19 added 10)", () => {
    const r = __runPageTabsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(56);
  });

  it("is registered in the pure self-test runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runPageTabsCoreTests } from "../../src/lib/admin/page-tabs-core";');
    expect(runner).toContain("const r = __runPageTabsCoreTests(); if (r.failed > 0 || r.passed < 1) throw");
  });

  it("is pure: no React, no next/*, no I/O, no env", () => {
    const src = code("src/lib/admin/page-tabs-core.ts");
    expect(src).not.toMatch(/from\s+["'](react|next\/|node:|@\/lib\/supabase)/);
    expect(src).not.toMatch(/process\.env|fetch\(/);
  });

  it("bible S27.5: explicit tab wins over error; error auto-opens; unknown falls back", () => {
    type K = "a" | "b";
    const tabs: TabSpec<K>[] = [{ key: "a", label: "A" }, { key: "b", label: "B", autoOpenOn: new Set(["boom"]) }];
    expect(resolveTab(tabs, { tab: "a", error: "boom" }, "a")).toBe("a");
    expect(resolveTab(tabs, { error: "boom" }, "a")).toBe("b");
    expect(resolveTab(tabs, { tab: "zzz", error: "nope" }, "a")).toBe("a");
  });

  it("bible S27.5: tabHref preserves back/q/status and drops tab", () => {
    expect([...DEFAULT_KEEP_PARAMS]).toEqual(["q", "status", "back"]);
    const h = tabHref("/admin/p", "b", { tab: "a", back: "/admin/x?y=1", q: "og kush", status: "approved", saved: "1" });
    const u = new URL(h, "https://x.test");
    expect(u.pathname).toBe("/admin/p");
    expect(u.searchParams.getAll("tab")).toEqual(["b"]);
    expect(u.searchParams.get("back")).toBe("/admin/x?y=1");
    expect(u.searchParams.get("q")).toBe("og kush");
    expect(u.searchParams.get("status")).toBe("approved");
    expect(u.searchParams.has("saved")).toBe(false);
  });
});

describe("S27 · ReceivingTabs is a wrapper with byte-identical output", () => {
  it("email tab active: identical to the pre-S27 markup", () => {
    expect(renderToStaticMarkup(<ReceivingTabs active="email" />)).toBe(GOLDEN_EMAIL);
  });

  it("manual tab active: identical to the pre-S27 markup", () => {
    expect(renderToStaticMarkup(<ReceivingTabs active="manual" />)).toBe(GOLDEN_MANUAL);
  });

  it("the hrefs PageTabs computes equal RECEIVING_TABS[].href (no second source of truth drift)", () => {
    for (const t of RECEIVING_TABS) expect(tabHref(RECEIVING_TABS_BASE, t.key)).toBe(t.href);
  });

  it("resolveTab over RECEIVING_TABS + MANUAL_ERROR_CODES agrees with resolveReceivingTab", () => {
    const specs = RECEIVING_TABS.map((t) =>
      t.key === "manual" ? { ...t, autoOpenOn: MANUAL_ERROR_CODES, autoOpenParams: ["kbdone", "repdone"] } : t,
    );
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { tab: "email" },
      { tab: "manual" },
      { tab: "email", error: "parse" },
      { tab: "bogus" },
      { error: "nope" },
      { kbdone: "3" },
      { repdone: "1" },
      { tab: "email", kbdone: "1" },
      ...[...MANUAL_ERROR_CODES].map((error) => ({ error })),
    ];
    for (const c of cases) expect(resolveTab(specs, c, "email"), JSON.stringify(c)).toBe(resolveReceivingTab(c));
  });

  it("the wrapper is thin: no markup or classes of its own; the page still passes the server-resolved tab", () => {
    const src = code("src/components/admin/inventory/ReceivingTabs.tsx");
    expect(src).toContain('<PageTabs base={RECEIVING_TABS_BASE} tabs={RECEIVING_TABS} active={active} ariaLabel="Receiving views" />');
    expect(src).not.toMatch(/className=|<nav|<Link/);
    expect(src).not.toContain('"use client"');
    expect(code("src/app/admin/inventory/intake/page.tsx")).toContain("<ReceivingTabs active={activeTab} />");
  });
});

describe("S27 · PageTabs component", () => {
  type K = "one" | "two";
  const tabs: TabSpec<K>[] = [
    { key: "one", label: "One" },
    { key: "two", label: "Two", icon: "!", blurb: "second" },
  ];

  it("is a server component (zero JS) and re-uses the core, not its own URL logic", () => {
    const src = code("src/components/admin/ui/PageTabs.tsx");
    expect(src).not.toContain('"use client"');
    expect(src).not.toMatch(/usePathname|useRouter|useState|useEffect/);
    // R19: a tab may add its own keepParams to the allow-list (tabAllowFor, pure core).
    expect(src).toContain("href={carry !== undefined ? tabHrefCarry(base, tab.key, carry, carryDrop) : tabHref(base, tab.key, keep, tabAllowFor(allow, tab))}");
    expect(read("src/components/admin/ui/index.ts")).toContain('export { PageTabs, type PageTabsProps } from "./PageTabs";');
  });

  it("marks exactly one tab aria-current=page", () => {
    const html = renderToStaticMarkup(<PageTabs base="/admin/z" tabs={tabs} active="two" ariaLabel="Z views" />);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toMatch(/<a aria-current="page" title="second"[^>]*href="\/admin\/z\?tab=two"/);
    expect(html).toContain('<nav aria-label="Z views"');
  });

  it("omits the icon span when a tab has no icon", () => {
    const html = renderToStaticMarkup(<PageTabs base="/admin/z" tabs={tabs} active="one" ariaLabel="Z" />);
    expect(html).toContain('href="/admin/z?tab=one">One</a>');
    expect(html).toContain('<span class="mr-1.5">!</span>Two');
  });

  it("keeps q/status/back across tab switches (the worklist survives) but not result banners", () => {
    const html = renderToStaticMarkup(
      <PageTabs base="/admin/z" tabs={tabs} active="one" ariaLabel="Z" keep={{ back: "/admin/a", q: "x", saved: "1" }} />,
    );
    expect(html).toContain('href="/admin/z?tab=two&amp;q=x&amp;back=%2Fadmin%2Fa"');
    expect(html).not.toContain("saved=");
  });

  it("renders a count pill + accessible name only when a count is positive", () => {
    const withCount = renderToStaticMarkup(
      <PageTabs base="/admin/z" tabs={withTabCounts(tabs, { two: 3, one: 0 })} active="one" ariaLabel="Z" />,
    );
    expect(withCount.match(/data-testid="page-tab-count"/g)?.length).toBe(1);
    expect(withCount).toContain('aria-label="Two, 3 items"');
    expect(withCount).toMatch(/data-testid="page-tab-count"[^>]*>3<\/span><\/a>/);
    expect(withCount).not.toContain('aria-label="One');
    const big = renderToStaticMarkup(<PageTabs base="/admin/z" tabs={withTabCounts(tabs, { one: 1234 })} active="one" ariaLabel="Z" />);
    expect(big).toContain(">99+</span>");
    expect(big).toContain('aria-label="One, 99+ items"');
    expect(tabCountLabel(1)).toBe("1");
  });
});

describe("S27 · adopting pages (bible S27.1 consumers)", () => {
  it("types page: same resolution as before, and a bare ?type= now opens Inventory Types", () => {
    const legacy = (tab?: string) => (tab === "inventory" ? "inventory" : "website");
    for (const tab of [undefined, "", "website", "inventory", "Inventory", "bogus"]) {
      expect(resolveTab(TYPES_PAGE_TABS, { tab }, "website"), String(tab)).toBe(legacy(tab));
    }
    expect(resolveTab(TYPES_PAGE_TABS, { type: "Solid Edible" }, "website")).toBe("inventory");
    expect(resolveTab(TYPES_PAGE_TABS, { tab: "website", type: "Solid Edible" }, "website")).toBe("website");
    expect(TYPES_PAGE_TABS.map((t) => t.label)).toEqual(["Website Categories", "Inventory Types"]);
    expect(TYPES_PAGE_TABS.map((t) => tabHref(TYPES_PAGE_BASE, t.key))).toEqual([
      "/admin/settings/types?tab=website",
      "/admin/settings/types?tab=inventory",
    ]);
    const page = code("src/app/admin/settings/types/page.tsx");
    expect(page).toContain('<PageTabs base={BASE} tabs={TYPES_PAGE_TABS} active={tab} ariaLabel="Types and categories views" />');
    expect(page).toContain('resolveTab(TYPES_PAGE_TABS, { tab: sp.tab, type: sp.type }, "website")');
    expect(page).toContain('const BASE = "/admin/settings/types";');
  });

  it("masters page (S35): Live cards is the default, counts in pills, back= survives the switch", () => {
    // RE-PINNED DELIBERATELY in R22 (bible S35): the default moved from
    // "masters" to the new "live" tab; explicit tabs resolve as before.
    const expected = (tab?: string) => (tab === "suggestions" ? "suggestions" : tab === "masters" ? "masters" : "live");
    for (const tab of [undefined, "", "live", "masters", "suggestions", "Suggestions", "bogus"]) {
      expect(resolveTab(MASTERS_PAGE_TABS, { tab }, "live"), String(tab)).toBe(expected(tab));
    }
    expect(MASTERS_PAGE_TABS.map((t) => tabHref(MASTERS_PAGE_BASE, t.key))).toEqual([
      "/admin/products/masters?tab=live",
      "/admin/products/masters?tab=masters",
      "/admin/products/masters?tab=suggestions",
    ]);
    const page = code("src/app/admin/products/masters/page.tsx");
    expect(page).toContain("tabs={withTabCounts(MASTERS_PAGE_TABS, {");
    expect(page).toContain("live: mastered.ok ? stats.cards : null,");
    // R23: the pill counts what the vendor/manifest filter leaves visible.
    expect(page).toContain("masters: visibleMasters.length,");
    expect(page).not.toContain("masters: masters.length,");
    expect(page).toContain("suggestions: suggestions.length,");
    // R23: the vendor/manifest filter survives a tab switch too.
    expect(page).toContain("keep={{ back: sp.back, vendor: facets.vendor || undefined, manifest: facets.manifest || undefined }}");
    expect(page).toContain('resolveTab(MASTERS_PAGE_TABS, { tab: sp.tab }, "live")');
    expect(page).toContain('const BASE = "/admin/products/masters";');
    // Every suggestion action redirects with tab=suggestions, and every manual
    // master redirect names tab=masters, so nothing lands on the wrong tab now
    // that the default is Live cards.
    const actions = read("src/app/admin/products/masters/actions.ts");
    expect(actions).toContain("redirect(`${BASE}?tab=suggestions&rejected=1`)");
    expect(actions).toContain("redirect(`${BASE}?tab=suggestions&generated=");
    expect(actions).toContain("redirect(`${BASE}?tab=masters&deleted=1`)");
    expect(actions).not.toMatch(/redirect\(`\$\{BASE\}\?(?!tab=)/);
  });

  it("no hand-rolled ?tab= strip survives on the adopting pages", () => {
    for (const f of ["src/app/admin/settings/types/page.tsx", "src/app/admin/products/masters/page.tsx"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/href=\{`\$\{BASE\}\?tab=/);
      expect(src, f).not.toContain("tabCls(");
    }
  });

  it("ReportTabs stays its own route-per-tab primitive (bible S27.8: two primitives, never a third)", () => {
    expect(existsSync(join(ROOT, "src/components/admin/reports/ReportTabs.tsx"))).toBe(true);
    const rt = code("src/components/admin/reports/ReportTabs.tsx");
    expect(rt).not.toContain("PageTabs");
    expect(rt).not.toContain("page-tabs-core");
  });
});
