/**
 * tests/compliance/s28-issues-tabs.test.tsx  (S28)
 *
 * The Issues tab on Publish, Inventory and the Manifest page, proven four ways:
 *   1. the pure issues-core self-tests (pinned count) run here AND in
 *      run-pure-selftests;
 *   2. IssuesList / IssuesSummaryLine render what the bible says (Needs action
 *      above Worth a look, no FYI, one fix button per row, nothing at zero);
 *   3. each page resolves the tab it should (explicit ?tab, the one-shot
 *      result params that auto-open Issues, held=0 is NOT a signal);
 *   4. every fix href the builders emit lands on a route / anchor that exists
 *      in the repo — no dead "fix" buttons (Round 11: "I can use all the fix
 *      buttons and they actually allow me to fix everything").
 *
 * Pure render (renderToStaticMarkup): no DOM, no jsdom (see vitest.config.ts).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __runIssuesCoreTests,
  buildIntelIssues,
  buildInventoryIssues,
  buildManifestIssues,
  buildPublishIssuesForVersion,
  manifestHeldAutoOpen,
  REGISTER_BLOCKED_ANCHOR,
  RESTORE_TO_SALE_ANCHOR,
  summarizeIssues,
  type Issue,
} from "@/lib/admin/issues-core";
import { IssuesList } from "@/components/admin/ui/IssuesList";
import { IssuesSummaryLine } from "@/components/admin/ui/IssuesSummaryLine";
import { resolveTab } from "@/lib/admin/page-tabs-core";
import {
  INVENTORY_PAGE_TABS,
  MANIFEST_PAGE_TABS,
  PUBLISH_PAGE_TABS,
  manifestPageBase,
} from "@/lib/admin/page-tab-sets";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PUBLISH = "src/app/admin/publish/page.tsx";
const INVENTORY = "src/app/admin/inventory/page.tsx";
const MANIFEST = "src/app/admin/inventory/intake/[id]/page.tsx";
const LOT = "src/app/admin/inventory/[id]/page.tsx";
const BANNER = "src/components/admin/inventory/RegisterSellabilityBanner.tsx";

const mk = (severity: Issue["severity"], code: string, extra: Partial<Issue> = {}): Issue => ({
  severity,
  code,
  title: `T-${code}`,
  meaning: `M-${code}`,
  fix: null,
  ...extra,
});

describe("S28 issues-core pure self-tests", () => {
  it("passes every embedded assertion (count pinned)", () => {
    const r = __runIssuesCoreTests();
    expect(r.failed).toBe(0);
    // R34: +2 (expiry gap links the expiration rules; only the expiry gap does).
    expect(r.passed).toBe(101);
  });
  it("is registered in run-pure-selftests", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain('import { __runIssuesCoreTests } from "../../src/lib/admin/issues-core";');
    expect(src).toContain("const r = __runIssuesCoreTests();");
  });
});

describe("S28 IssuesList render", () => {
  it("renders Needs action ABOVE Worth a look and never renders FYI", () => {
    const html = renderToStaticMarkup(
      <IssuesList
        issues={[
          mk("warning", "w1", { fix: { href: "/admin/purchasing", label: "Open Purchasing" } }),
          mk("fyi", "f1"),
          mk("blocking", "b1", { fix: { href: "/admin/inventory/x#coa", label: "Open lot" }, fixText: "Attach it." }),
        ]}
      />,
    );
    const na = html.indexOf('data-testid="issues-needs-action"');
    const wl = html.indexOf('data-testid="issues-worth-a-look"');
    expect(na).toBeGreaterThan(-1);
    expect(wl).toBeGreaterThan(na);
    expect(html).toContain("Needs action");
    expect(html).toContain("Worth a look");
    expect(html).not.toContain("T-f1");
    expect((html.match(/data-testid="issue-row"/g) ?? []).length).toBe(2);
    expect((html.match(/data-testid="issue-fix-link"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/admin/inventory/x#coa"');
    expect(html).toContain("How to fix it:");
    expect(html).toContain('data-severity="blocking"');
    expect(html).toContain('data-severity="warning"');
  });
  it("renders no fix button when the row has no fix (never invents one)", () => {
    const html = renderToStaticMarkup(<IssuesList issues={[mk("warning", "w")]} />);
    expect(html).not.toContain("issue-fix-link");
  });
  it("renders extras and the Why details only when present", () => {
    const html = renderToStaticMarkup(
      <IssuesList issues={[mk("warning", "w", { extra: [{ href: "/a", label: "Also" }], why: "Because." })]} />,
    );
    expect(html).toContain('data-testid="issue-fix-extra"');
    expect(html).toContain("Why did this happen?");
    const bare = renderToStaticMarkup(<IssuesList issues={[mk("warning", "w", { extra: [] })]} />);
    expect(bare).not.toContain("issue-fix-extra");
    expect(bare).not.toContain("Why did this happen?");
  });
  it("shows the empty text when only FYI (or nothing) is present", () => {
    for (const issues of [[], [mk("fyi", "f")]]) {
      const html = renderToStaticMarkup(<IssuesList issues={issues} emptyText="All clear." />);
      expect(html).toContain('data-testid="issues-empty"');
      expect(html).toContain("All clear.");
      expect(html).not.toContain("issues-needs-action");
    }
  });
  it("uses the design tokens, not raw red/orange", () => {
    const src = read("src/components/admin/ui/IssuesList.tsx");
    expect(src).toContain("--admin-danger");
    expect(src).not.toMatch(/\b(red|orange)-\d{3}\b/);
  });
});

describe("S28 IssuesSummaryLine", () => {
  it("renders nothing when nothing blocks", () => {
    expect(renderToStaticMarkup(<IssuesSummaryLine summary={summarizeIssues([mk("warning", "w")])} href="/x" />)).toBe("");
    expect(renderToStaticMarkup(<IssuesSummaryLine summary={summarizeIssues([])} href="/x" />)).toBe("");
  });
  it("renders ONE line with ONE Review link when something blocks", () => {
    const html = renderToStaticMarkup(
      <IssuesSummaryLine summary={summarizeIssues([mk("blocking", "b"), mk("blocking", "c")])} href="/admin/publish?tab=issues" />,
    );
    expect(html).toContain('data-testid="issues-summary-line"');
    expect(html).toContain('role="status"');
    expect(html).toContain("2 items need action");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).toContain('href="/admin/publish?tab=issues"');
  });
  it("cannot be dismissed (persists until the cause is fixed)", () => {
    const src = read("src/components/admin/ui/IssuesSummaryLine.tsx");
    expect(src).not.toMatch(/onClose|dismiss|setTimeout|"use client"/);
  });
  it("is exported from the ui barrel", () => {
    const src = read("src/components/admin/ui/index.ts");
    expect(src).toMatch(/IssuesList/);
    expect(src).toMatch(/IssuesSummaryLine/);
  });
});

describe("S28 tab resolution", () => {
  it("Publish: overview by default, explicit tabs honoured, nothing auto-opens", () => {
    expect(resolveTab(PUBLISH_PAGE_TABS, {}, "overview")).toBe("overview");
    expect(resolveTab(PUBLISH_PAGE_TABS, { tab: "issues" }, "overview")).toBe("issues");
    expect(resolveTab(PUBLISH_PAGE_TABS, { tab: "history" }, "overview")).toBe("history");
    expect(resolveTab(PUBLISH_PAGE_TABS, { tab: "bogus", error: "anything" }, "overview")).toBe("overview");
  });
  it("Inventory: a restore result lands back on Issues beside the form", () => {
    expect(resolveTab(INVENTORY_PAGE_TABS, {}, "lots")).toBe("lots");
    expect(resolveTab(INVENTORY_PAGE_TABS, { restoreError: "No stock" }, "lots")).toBe("issues");
    expect(resolveTab(INVENTORY_PAGE_TABS, { restored: "Back on sale" }, "lots")).toBe("issues");
    expect(resolveTab(INVENTORY_PAGE_TABS, { tab: "insights", restored: "x" }, "lots")).toBe("insights");
  });
  it("Manifest: held>0 opens Issues; held=0 (clean finalize) stays on Delivery", () => {
    expect(resolveTab(MANIFEST_PAGE_TABS, { held: manifestHeldAutoOpen("2") }, "delivery")).toBe("issues");
    expect(resolveTab(MANIFEST_PAGE_TABS, { held: manifestHeldAutoOpen("0") }, "delivery")).toBe("delivery");
    expect(resolveTab(MANIFEST_PAGE_TABS, {}, "delivery")).toBe("delivery");
    // S29 appended Accounting after Issues (held lots still land on Issues first).
    expect(MANIFEST_PAGE_TABS.map((t) => t.key)).toEqual(["delivery", "issues", "accounting"]);
    expect(manifestPageBase("abc")).toBe("/admin/inventory/intake/abc");
  });
  it("finalize really does always append held= (why the guard exists)", () => {
    expect(read("src/app/admin/inventory/intake/actions.ts")).toContain("&held=${result.blocked.length}");
    expect(read(MANIFEST)).toContain("held: manifestHeldAutoOpen(held)");
  });
});

describe("S28 page wiring", () => {
  it.each([PUBLISH, INVENTORY, MANIFEST])("%s renders PageTabs + IssuesList + IssuesSummaryLine, no raw red/orange", (p) => {
    const src = read(p);
    expect(src).toContain("<PageTabs");
    expect(src).toContain("<IssuesList");
    expect(src).toContain("<IssuesSummaryLine");
    expect(src).not.toMatch(/\b(red|orange)-\d{3}\b/);
  });
  it("Publish: the per-row chip is a link to the Issues tab", () => {
    const src = read(PUBLISH);
    expect(src).toContain('data-testid="publish-issue-chip"');
    expect(src).toContain('tabHref(PUBLISH_PAGE_BASE, "issues")');
    expect(src).toContain('active === "history"');
  });
  it("Inventory: Pacific day, tax-settings medical rule, pinned read fan-out intact", () => {
    const src = read(INVENTORY);
    expect(src).toContain("const today = pacificToday();");
    expect(src).toContain("medicalEndorsement: taxSettings.medicalEndorsement");
    expect(src).toContain("const [allLots, stats, intel, sellability, leafly] = await Promise.all([");
    expect(src).not.toContain("MissingInsight");
    expect(src).toContain('activeTab === "insights" && <InventoryIntelPanel');
  });
  it("Inventory: the banner sections carry the anchors the Issues rows point at", () => {
    const src = read(BANNER);
    expect(src).toContain("id={REGISTER_BLOCKED_ANCHOR}");
    expect(src).toContain("id={RESTORE_TO_SALE_ANCHOR}");
    // Both sections render on the SAME tab as the rows that link to them.
    const inv = read(INVENTORY);
    const start = inv.indexOf('activeTab === "issues" && (');
    expect(start).toBeGreaterThan(-1);
    // The block ends at the FIRST close of that conditional (8-space indent).
    const issuesBlock = inv.slice(start, inv.indexOf("\n        )}\n", start));
    expect(issuesBlock).toContain("<IssuesList");
    expect(issuesBlock).toContain("<RegisterSellabilityBanner");
    expect(issuesBlock).toContain("<RestoreToSalePanel");
  });
  it("Manifest: held reasons come from the SAME gate finalize runs, on stored ids", () => {
    const src = read(MANIFEST);
    expect(src).toContain("evaluateLotActivation({");
    expect(src).toContain("ccrsExternalId: l.ccrs_inventory_external_id");
    const store = read("src/lib/inventory/intake-store.ts");
    expect(store).toMatch(/otherwise_taken, ccrs_inventory_external_id"/);
  });
});

/** Every href a builder can emit, resolved against the repo. */
function assertResolvable(href: string) {
  if (href.startsWith("#")) {
    const id = href.slice(1);
    const ids = [REGISTER_BLOCKED_ANCHOR, RESTORE_TO_SALE_ANCHOR];
    expect(ids).toContain(id);
    return;
  }
  const [pathAndQuery, anchor] = href.split("#");
  const path = pathAndQuery.split("?")[0];
  const lotMatch = /^\/admin\/inventory\/(?!intake|cycle-counts|drafts)[^/]+$/.test(path);
  const manifestMatch = /^\/admin\/inventory\/intake\/[^/]+$/.test(path);
  const versionMatch = /^\/admin\/menu-imports\/version\/[^/]+$/.test(path);
  const file = lotMatch
    ? LOT
    : manifestMatch
      ? MANIFEST
      : versionMatch
        ? "src/app/admin/menu-imports/version/[versionId]/page.tsx"
        : `src/app${path}/page.tsx`;
  expect(existsSync(join(ROOT, file)), `${href} → ${file}`).toBe(true);
  if (anchor) expect(read(file), `${href} anchor`).toContain(`id="${anchor}"`);
}

describe("S28 every fix button lands somewhere real", () => {
  const M = "22222222-2222-4222-8222-222222222222";
  const all: Issue[] = [
    ...buildInventoryIssues({
      receivedDateFlag: "3 lots have no date.",
      receivedMissingWithStock: 1,
      gaps: [
        { key: "recalled", label: "flagged RECALLED", count: 1, href: "/admin/inventory?status=recalled", weight: 3 },
      ],
      blockedByCause: { no_product_link: 1, no_menu_card: 1, hidden_card: 1, recall_hold: 1 },
      restorableCount: 2,
      intelExpiredRows: 0,
    }),
    ...buildIntelIssues(
      { supply: { months: 6, overCeiling: true }, overdue: { total: 2 }, medicalInStock: 0 },
      {
        today: "2026-07-01",
        lots: [{ id: "lot1", productName: "Old", status: "active", expiresOn: "2026-01-01" }],
        medicalEndorsement: true,
      },
    ),
    ...buildManifestIssues({
      manifestId: M,
      inProgress: false,
      heldLots: [
        { id: "l1", label: "A", reasons: [{ code: "missing_lab_result", message: "x" }] },
        { id: "l2", label: "B", reasons: [{ code: "missing_ccrs_id", message: "x" }] },
        { id: "l3", label: "C", reasons: [] },
      ],
      missingCoaLines: 0,
      unmappedCategoryLines: 2,
      menu: { pendingDrafts: 1, stagedWaiting: true },
    }),
    ...buildManifestIssues({
      manifestId: M,
      inProgress: true,
      heldLots: [],
      missingCoaLines: 2,
      unmappedCategoryLines: 0,
      menu: null,
    }),
    ...buildPublishIssuesForVersion({
      versionId: "v1",
      subject: "Delivery M-1",
      diagnostics: [{ severity: "warning", code: "intake_master_no_vendor", message: "no vendor", context: {} }],
      link: { manifestId: M, vendor: "Acme", manifestNumber: "M-1" },
      warningCount: 3,
      reviewHref: "/admin/menu-imports/version/v1",
      reason: "fact_review",
      action: { href: "/admin/menu-imports/version/v1", label: "Check \u2192" },
    }),
  ];

  it("covers a real spread of rows", () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.filter((i) => i.fix).length).toBe(all.length);
  });
  it.each(all.filter((i) => i.fix).map((i) => [i.code, i.fix!.href] as const))("%s → %s", (_code, href) => {
    assertResolvable(href);
  });
  it("the lot page's Lifecycle form really can set Active (activate / pull rows are honest)", () => {
    const lot = read(LOT);
    expect(lot).toContain('{ value: "active", label: "Active" }');
    expect(lot).toContain("<form action={statusAction}");
    const actions = read("src/app/admin/inventory/actions.ts");
    expect(actions).toMatch(/const VALID_STATUSES = new Set\(\[\s*"active",/);
  });
});
