/**
 * S31 — Connected-everything contract (bible S31; F-103, F-114, F-115, F-118).
 *
 * Owner (Round 12): "make sure that the products from the Cultivera upload
 * specifically can reach the fix pages. These are the products that will need
 * the fix pages and logic."
 *
 * A fix link is only real when (1) its path is a page that exists, (2) every
 * query key it sends is declared in that page's `searchParams` type (an
 * undeclared key is silently ignored: the owner sees an unfiltered list while
 * the link claimed a filter), and (3) an item-level link's anchor is rendered.
 *
 * This file checks four things:
 *   A. every fix-link GENERATOR, called with representative inputs covering
 *      every cause/code/context, emits only hrefs that pass (1)-(3);
 *   B. the two Cultivera-product paths land on the control that fixes them;
 *   C. no standing coloured banner on the four pipeline pages: every tinted
 *      danger/gold block is a GATED result/hint listed below by (file, gate);
 *   D. a repo-wide census of literal "/admin..." strings: no dead path and no
 *      dropped query key, apart from the exact allowlist at the bottom.
 * Each check has a negative test proving it detects breakage.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  __runFixLinkContractCoreTests,
  buildRouteTable,
  checkHref,
  colouredBlocks,
  literalAnchorIds,
  parseHref,
  resolveRoute,
  type RouteEntry,
} from "@/lib/admin/fix-link-contract-core";
import { fixLinkForLot, bulkFixLinkForCause, FIX_ROUTE_FILES, type BlockedCause } from "@/lib/inventory/blocked-stock-fix-core";
import {
  fixLinkForDiagnostic,
  ISSUE_LINKED_CODES,
  ISSUE_FIX_ROUTE_FILES,
  lotEnrichmentHref,
  kbProductsHref,
  typesHref,
  lotPageHref,
  type IssueContext,
} from "@/lib/pos/issue-fix-link-core";
import { buildWorkQueue } from "@/lib/catalog/work-queue-core";
import { buildAttentionFlags, type DrawerRollup } from "@/lib/admin/cockpit-core";
import {
  buildInventoryIssues,
  buildIntelIssues,
  buildManifestIssues,
  buildPublishIssuesForVersion,
  gapBulkFillHref,
  type Issue,
} from "@/lib/admin/issues-core";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import { lotGapHref, LOT_GAP_DEFINITIONS } from "@/lib/inventory/lot-gap-core";
import { explainDiagnostic } from "@/lib/pos/publish-guard-core";
import { CUTOVER_ACTION_HREF, primaryAction } from "@/lib/pos/publish-queue-core";
import { draftsForManifestHref } from "@/lib/catalog/draft-deep-link-core";
import { factFlagWorklist, factHoldHref, waitingMenuFix } from "@/lib/pos/menu-waiting-link-core";
import {
  CULTIVERA_ONLY_CODES,
  IMPORT_PAGE_ANCHORS,
  POS_ERROR_CODES,
  POS_REVIEW_CODES,
  hiddenItemFix,
  posDiagnosticRowLink,
  posImportFixFor,
} from "@/lib/pos/pos-import-fix-core";
import type { InventoryStats } from "@/lib/inventory/store";

// ---------------------------------------------------------------------------
// Filesystem fixtures
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f.replace(/\\/g, "/"));
  }
  return out;
}

const SRC_FILES = walk("src");
const ROUTE_FILES = SRC_FILES.filter((f) => /\/(page|route)\.tsx?$/.test(f));
const TABLE: RouteEntry[] = buildRouteTable(ROUTE_FILES);
const cache = new Map<string, string>();
const read = (f: string): string => {
  let s = cache.get(f);
  if (s === undefined) {
    s = readFileSync(f, "utf8");
    cache.set(f, s);
  }
  return s;
};

const LOT = "11111111-1111-4111-8111-111111111111";
const MANIFEST = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// A. Every generator's output
// ---------------------------------------------------------------------------

const CAUSES: readonly BlockedCause[] = [
  "no_product_link",
  "no_menu_card",
  "hidden_card",
  "recall_hold",
  "lot_not_active",
  "lot_empty",
];

const CONTEXTS: readonly IssueContext[] = [
  {},
  { draftId: DRAFT },
  { manifestId: MANIFEST },
  { draftId: DRAFT, manifestId: MANIFEST },
  {
    lotId: LOT,
    posProductKey: "K",
    typeName: "Usable Marijuana",
    isOnLiveMenu: true,
    liveCardKeys: ["A", "B"],
    identity: "v|c|fam-x",
    productName: "Blue Dream",
  },
  { lotId: LOT, posProductKey: "K", typeName: "Marijuana Mix", isOnLiveMenu: false },
  { typeName: "Solid Edible" },
  { liveCardKeys: ["A"], identity: "v|c|fam-x" },
];

function statsAll(): InventoryStats {
  return {
    total: 100,
    active: 90,
    quarantine: 2,
    recalled: 1,
    destroyed: 1,
    soldOut: 1,
    emptyActive: 3,
    missingCoa: 4,
    missingProductLink: 5,
    expiringSoon: 6,
    expired: 7,
    missingExpiry: 8,
    unknownCost: 9,
    onHandCostMinor: 1000,
    costSkippedUnknown: 1,
    missingReceivedDate: 2,
    missingReceivedDateWithStock: 2,
  };
}

const DRAWERS: DrawerRollup = {
  openCount: 1,
  closedUnverifiedCount: 1,
  verifiedCount: 0,
  totalVarianceMinor: 5,
  needsAttention: 1,
};

function issueHrefs(issues: readonly Issue[]): string[] {
  const out: string[] = [];
  for (const i of issues) {
    if (i.fix) out.push(i.fix.href);
    for (const e of i.extra ?? []) out.push(e.href);
  }
  return out;
}

/** Generators that produced at least one href (an href two generators share credits both). */
const GENERATORS_SEEN = new Set<string>();

/** Every href every generator can emit, with the first generator that emitted it. */
function emittedHrefs(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (href: string | null | undefined, from: string) => {
    if (!href) return;
    GENERATORS_SEEN.add(from.replace(/\(.*$/, ""));
    out.set(href, out.get(href) ?? from);
  };
  for (const c of CAUSES) {
    add(fixLinkForLot(c, LOT, "SKU-9").href, `fixLinkForLot(${c}, key)`);
    add(fixLinkForLot(c, LOT, null).href, `fixLinkForLot(${c}, null)`);
    add(bulkFixLinkForCause(c, 3)?.href, `bulkFixLinkForCause(${c})`);
  }
  for (const code of ISSUE_LINKED_CODES) {
    for (const ctx of CONTEXTS) {
      const l = fixLinkForDiagnostic(code, { ...ctx, back: "/admin/publish" });
      if (!l) continue;
      add(l.href, `fixLinkForDiagnostic(${code})`);
      for (const e of l.extra) add(e.href, `fixLinkForDiagnostic(${code}).extra`);
    }
    add(explainDiagnostic(code, "m").fixHref, `explainDiagnostic(${code}) static`);
  }
  add(lotEnrichmentHref("K", true, "Name", LOT), "lotEnrichmentHref(live)");
  add(lotEnrichmentHref("K", false, "Name", LOT), "lotEnrichmentHref(not live)");
  add(kbProductsHref("x"), "kbProductsHref");
  add(typesHref("Usable Marijuana"), "typesHref");
  add(lotPageHref(LOT, "coa"), "lotPageHref");
  for (const r of buildWorkQueue({
    overdueInTransit: 1,
    awaitingIntake: 1,
    heldLots: 1,
    onboardingDrafts: 1,
    posToSend: 1,
    masteringSuggestions: 1,
  })) {
    add(r.actionHref, `buildWorkQueue(${r.key})`);
  }
  for (const f of buildAttentionFlags({
    activeOrders: 6,
    lowStockCount: 11,
    drawers: DRAWERS,
    publishedItems: 0,
    refunds: { severity: "high", refundMinor: 5, ratePct: "9%" },
  })) {
    add(f.href, "buildAttentionFlags");
  }
  const gaps = inventoryGapInsights(statsAll());
  for (const g of gaps) {
    add(g.href, `inventoryGapInsights(${g.key})`);
    add(gapBulkFillHref(g.key, g.href), `gapBulkFillHref(${g.key})`);
  }
  for (const d of LOT_GAP_DEFINITIONS) add(lotGapHref(d.key), `lotGapHref(${d.key})`);
  for (const h of issueHrefs(
    buildInventoryIssues({
      receivedDateFlag: "2 lots have no received date",
      receivedMissingWithStock: 2,
      gaps: gaps.map((g) => ({ key: g.key, label: g.label, count: g.count, href: g.href, weight: g.weight })),
      blockedByCause: { no_product_link: 1, no_menu_card: 1, hidden_card: 1, recall_hold: 1 },
      restorableCount: 2,
      intelExpiredRows: 0,
    }),
  )) {
    add(h.startsWith("#") ? `/admin/inventory${h}` : h, "buildInventoryIssues");
  }
  for (const h of issueHrefs(
    buildIntelIssues(
      { supply: { months: 5, overCeiling: true }, overdue: { total: 2 }, medicalInStock: 0 },
      {
        today: "2026-01-10",
        lots: [{ id: LOT, productName: "X", status: "active", expiresOn: "2026-01-01" }],
        medicalEndorsement: true,
      },
    ),
  )) {
    add(h, "buildIntelIssues");
  }
  for (const h of issueHrefs(
    buildManifestIssues({
      manifestId: MANIFEST,
      inProgress: true,
      heldLots: [
        { id: LOT, label: "L", reasons: [{ code: "missing_lab_result", message: "m" }] },
        { id: LOT, label: "L", reasons: [] },
        { id: LOT, label: "L", reasons: [{ code: "missing_ccrs_id", message: "m" }] },
      ],
      missingCoaLines: 1,
      unmappedCategoryLines: 1,
      menu: { pendingDrafts: 2, stagedWaiting: true },
    }),
  )) {
    add(h.startsWith("#") ? `/admin/inventory/intake/${MANIFEST}${h}` : h, "buildManifestIssues");
  }
  for (const reason of ["fact_review", "publish_failed", "needs_publish", "pos_upload", "cutover"] as const) {
    const review = `/admin/menu-imports/version/v1`;
    for (const h of issueHrefs(
      buildPublishIssuesForVersion({
        versionId: "v1",
        subject: "Delivery M-1",
        diagnostics: ISSUE_LINKED_CODES.map((code) => ({ severity: "warning", code, message: "m", context: {} })),
        link: { manifestId: MANIFEST, vendor: "Acme", manifestNumber: "M-1" },
        warningCount: ISSUE_LINKED_CODES.length + 3,
        reviewHref: review,
        reason,
        action: primaryAction(reason, review, factHoldHref({ manifest: { id: MANIFEST } })),
      }),
    )) {
      add(h, `buildPublishIssuesForVersion(${reason})`);
    }
  }
  // Round 13: the waiting-menu / fact-hold links (intake page, Publish page, version page).
  for (const state of ["held_for_fact_review", "held_for_cutover", "publish_failed", null] as const) {
    for (const m of [MANIFEST, null]) {
      const f = waitingMenuFix({ manifestId: m, version: { id: "v1", state } });
      add(f.href, `waitingMenuFix(${state})`);
      add(f.extra?.href, `waitingMenuFix(${state}).extra`);
    }
  }
  add(factHoldHref({ manifest: { id: MANIFEST } }), "factHoldHref");
  for (const r of factFlagWorklist(
    [{ manifestId: MANIFEST, draftId: DRAFT, productName: "X", reasons: ["r"] }],
    MANIFEST,
    new Set<string>(),
  )) {
    add(r.href, "factFlagWorklist(off page)");
  }
  for (const r of factFlagWorklist(
    [{ manifestId: MANIFEST, draftId: DRAFT, productName: "X", reasons: ["r"] }],
    MANIFEST,
    new Set([DRAFT]),
  )) {
    add(`/admin/inventory/drafts${r.href}`, "factFlagWorklist(on page)");
  }
  // Round 13: every Cultivera import diagnostic code, in every lot state.
  const POS_CODES = [
    ...POS_REVIEW_CODES,
    ...POS_ERROR_CODES,
    ...CULTIVERA_ONLY_CODES,
    "inventory_without_product_master",
    "product_without_inventory",
    "flower_same_size_different_price",
    "unknown_strain_type",
    "new_unmapped_category",
    "unmapped_category_fallback",
    "import_lot_cost_unparseable",
    "import_lots_expiration_missing_summary",
    "import_lot_coa_missing",
    "import_lots_coa_missing_summary",
    "import_lot_received_date_missing",
    "import_lot_barcode_conflict",
    "import_lot_barcode_merged",
    "import_lot_missing_barcode",
    "import_lots_mixed_size_cards",
  ];
  const IMPORT = "44444444-4444-4444-8444-444444444444";
  const ROW_CTX = { barcode: "1234567890", product: "Blue Dream 3.5g", displayName: "Blue Dream" };
  for (const code of POS_CODES) {
    for (const [versionPublished, lotsCreated] of [
      [true, true],
      [true, false],
      [false, false],
    ] as const) {
      const ctx = { importId: IMPORT, versionPublished, lotsCreated };
      for (const l of posImportFixFor(code, ctx)?.links ?? []) add(l.href, `posImportFixFor(${code})`);
      add(posDiagnosticRowLink(code, ROW_CTX, ctx)?.href, `posDiagnosticRowLink(${code})`);
    }
  }
  for (const hiddenReason of [
    "owner_override_hide:x",
    "owner_override_show:x",
    "reviewer_rejected",
    "no_product_master",
    "no_inventory",
    null,
  ]) {
    for (const importId of [IMPORT, null]) {
      for (const versionPublished of [true, false]) {
        const l = hiddenItemFix({
          sourceItemId: "sku 9/a",
          hiddenReason,
          importId,
          versionPublished,
          factHref: factHoldHref({ manifest: { id: MANIFEST } }),
        });
        add(l?.href, `hiddenItemFix(${hiddenReason})`);
      }
    }
  }
  add(CUTOVER_ACTION_HREF, "CUTOVER_ACTION_HREF");
  add(draftsForManifestHref(MANIFEST), "draftsForManifestHref");
  return out;
}

/**
 * Anchors that a literal `id="..."` scan cannot see because a helper computes
 * them. Each entry: the anchor pattern, the page, and the exact source text
 * that renders it (so a rename on either side fails here).
 */
const COMPUTED_ANCHORS: readonly { anchor: RegExp; file: string; renders: string }[] = [
  { anchor: /^draft-/, file: "src/app/admin/inventory/drafts/page.tsx", renders: "id={draftRowAnchorId(d.id)}" },
  {
    anchor: /^type-/,
    file: "src/app/admin/settings/types/page.tsx",
    renders: "id={isFocus(t) && focusType ? typeRowAnchorId(focusType) : undefined}",
  },
  {
    anchor: /^register-blocked$/,
    file: "src/components/admin/inventory/RegisterSellabilityBanner.tsx",
    renders: "id={REGISTER_BLOCKED_ANCHOR}",
  },
  {
    anchor: /^restore-to-sale$/,
    file: "src/components/admin/inventory/RegisterSellabilityBanner.tsx",
    renders: "id={RESTORE_TO_SALE_ANCHOR}",
  },
  // Round 13: the Cultivera import page's sections (pos-import-fix-core IMPORT_PAGE_ANCHORS).
  { anchor: /^diagnostics$/, file: "src/app/admin/menu-imports/[id]/page.tsx", renders: "id={IMPORT_PAGE_ANCHORS.diagnostics}" },
  { anchor: /^hidden-items$/, file: "src/app/admin/menu-imports/[id]/page.tsx", renders: "id={IMPORT_PAGE_ANCHORS.hidden}" },
  { anchor: /^backfill-lots$/, file: "src/app/admin/menu-imports/[id]/page.tsx", renders: "id={IMPORT_PAGE_ANCHORS.backfill}" },
  { anchor: /^lot-plan$/, file: "src/app/admin/menu-imports/[id]/page.tsx", renders: "id={IMPORT_PAGE_ANCHORS.lotPlan}" },
];

function anchorRendered(anchor: string, pageFile: string): boolean {
  if (literalAnchorIds(read(pageFile)).has(anchor)) return true;
  for (const c of COMPUTED_ANCHORS) {
    if (!c.anchor.test(anchor)) continue;
    const onThisPage =
      c.file === pageFile ||
      // The sellability panels render on the inventory page.
      (c.file.endsWith("RegisterSellabilityBanner.tsx") && pageFile === "src/app/admin/inventory/page.tsx");
    if (onThisPage && read(c.file).includes(c.renders)) return true;
  }
  return false;
}

function problemsFor(href: string): string[] {
  const r = checkHref(href, TABLE, read);
  const out = r.problems.map((p) => (p.kind === "no_page" ? "no page" : `${p.kind} "${p.key}" on ${p.file}`));
  if (r.route && r.parsed.anchor && r.route.kind === "page" && !anchorRendered(r.parsed.anchor, r.route.file)) {
    out.push(`anchor #${r.parsed.anchor} is not rendered by ${r.route.file}`);
  }
  return out;
}

describe("S31 fix-link contract — pure core", () => {
  it("passes the embedded self-tests", () => {
    const r = __runFixLinkContractCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(59);
  });

  it("is registered in the pure runner with a floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("fix-link-contract-core", __runFixLinkContractCoreTests(), 59)');
    expect(runner.indexOf("fix-link-contract-core")).toBeLessThan(runner.indexOf("ALL PURE SELF-TESTS PASSED"));
  });
});

describe("S31 A — every generator's fix link lands on a real, filtered, anchored page", () => {
  const hrefs = emittedHrefs();

  it("covers the generators it claims (a shrinking set would hide a gap)", () => {
    expect(hrefs.size).toBeGreaterThanOrEqual(40);
    const sources = GENERATORS_SEEN;
    for (const g of [
      "fixLinkForLot",
      "bulkFixLinkForCause",
      "fixLinkForDiagnostic",
      "explainDiagnostic",
      "buildWorkQueue",
      "buildAttentionFlags",
      "inventoryGapInsights",
      "gapBulkFillHref",
      "lotGapHref",
      "buildInventoryIssues",
      "buildIntelIssues",
      "buildManifestIssues",
      "buildPublishIssuesForVersion",
      "CUTOVER_ACTION_HREF",
      "waitingMenuFix",
      "factHoldHref",
      "factFlagWorklist",
      "posImportFixFor",
      "posDiagnosticRowLink",
      "hiddenItemFix",
    ]) {
      expect(sources.has(g), `no href collected from ${g}`).toBe(true);
    }
  });

  it("every emitted href passes: page exists, keys declared, anchor rendered", () => {
    const failures: string[] = [];
    for (const [href, from] of hrefs) {
      for (const p of problemsFor(href)) failures.push(`${from}: ${href} -> ${p}`);
    }
    expect(failures).toEqual([]);
  });

  it("the import page's computed anchors resolve to the ids the links use", () => {
    expect(IMPORT_PAGE_ANCHORS).toEqual({
      diagnostics: "diagnostics",
      hidden: "hidden-items",
      backfill: "backfill-lots",
      lotPlan: "lot-plan",
    });
  });

  it("every item-level href with an anchor was actually checked (anchors present in the set)", () => {
    const anchors = new Set([...hrefs.keys()].map((h) => parseHref(h).anchor).filter(Boolean));
    for (const a of ["coa", "product-link", "lifecycle", "manifest-vendor", "manifest-lines", "register-blocked", "restore-to-sale", "flagged-facts", "rejected", "visibility", "hidden-items", "backfill-lots", "website-category"]) {
      expect(anchors.has(a), `no generator emitted #${a}`).toBe(true);
    }
    expect([...anchors].some((a) => a!.startsWith("draft-"))).toBe(true);
    expect([...anchors].some((a) => a!.startsWith("type-"))).toBe(true);
  });

  it("the generators' own route-file registries agree with the filesystem", () => {
    for (const [route, file] of [...Object.entries(FIX_ROUTE_FILES), ...Object.entries(ISSUE_FIX_ROUTE_FILES)]) {
      expect(existsSync(file), `${route} -> ${file} missing`).toBe(true);
      const hit = resolveRoute(route.replace(/\[[^\]]+\]/g, "x-1"), TABLE);
      expect(hit?.file, `${route} resolves elsewhere`).toBe(file);
    }
  });

  it("computed-anchor renderers still exist verbatim", () => {
    for (const c of COMPUTED_ANCHORS) expect(read(c.file), `${c.file} lost ${c.renders}`).toContain(c.renders);
  });

  // Negative tests: the checks above really detect breakage.
  it("detects a dead path, an ignored key, and a missing anchor", () => {
    expect(problemsFor("/admin/inventory/nope-page/deeper/x")).not.toEqual([]);
    expect(problemsFor("/admin/purchasing?status=draft&notARealKey=1").join()).toContain('undeclared_key "notARealKey"');
    expect(problemsFor(`/admin/inventory/${LOT}#no-such-anchor`).join()).toContain("anchor #no-such-anchor");
    expect(problemsFor(`/admin/inventory/drafts#type-x`).join()).toContain("anchor #type-x");
    expect(problemsFor(`/admin/inventory/${LOT}#coa`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. The Cultivera-upload products reach the control that fixes them
// ---------------------------------------------------------------------------

describe("S31 B — Cultivera-imported products reach a working fix", () => {
  it("hidden card -> the product page, where the Visibility control un-hides it", () => {
    const l = fixLinkForLot("hidden_card", LOT, "CULT-123");
    expect(l.href).toBe("/admin/products/CULT-123");
    const route = resolveRoute(parseHref(l.href).path, TABLE)!;
    expect(route.file).toBe("src/app/admin/products/[key]/page.tsx");
    const page = read(route.file);
    expect(page).toContain('<select name="visibility"');
    expect(page).toContain('<option value="show">Always show</option>');
  });

  it("no product link (bulk) -> the filtered Inventory list opened in Bulk fill on pos_product_key", () => {
    const b = bulkFixLinkForCause("no_product_link", 12)!;
    const p = parseHref(b.href);
    expect(p.path).toBe("/admin/inventory");
    expect(Object.fromEntries(p.query)).toMatchObject({ missingProductLink: "1", bulk: "1", bulkField: "pos_product_key" });
    expect(problemsFor(b.href)).toEqual([]);
    const inv = read("src/app/admin/inventory/page.tsx");
    expect(inv).toContain('const bulkMode = sp.bulk === "1";');
    expect(inv).toContain("<BulkFillPanel");
    expect(read("src/lib/inventory/bulk-fill-core.ts")).toMatch(/BULK_FILLABLE_FIELDS = \[[\s\S]*?"pos_product_key"/);
  });

  it("a product action's refusal is shown on the list it redirects to (not silently dropped)", () => {
    // products/actions.ts and vendors/actions.ts redirect with ?error=; both lists now read it.
    expect(read("src/app/admin/products/actions.ts")).toContain('redirect("/admin/products?error="');
    expect(read("src/app/admin/products/page.tsx")).toContain("{sp.error && (");
    expect(read("src/app/admin/vendors/actions.ts")).toContain('redirect("/admin/vendors?error="');
    expect(read("src/app/admin/vendors/page.tsx")).toContain("{sp.error && (");
  });
});

// ---------------------------------------------------------------------------
// C. No standing coloured banner without an issue row
// ---------------------------------------------------------------------------

/**
 * Every tinted danger/gold block (tinted border + tinted fill, one className)
 * on the four pipeline pages, keyed by the condition that renders it. Each is
 * a RESULT of the action just taken (URL flag), a not-configured screen, or a
 * hint — never a standing "you have problems" banner; standing problems are
 * Issues rows (S28). A new block, or one that loses its gate, fails here until
 * it is either justified in this list or moved into the Issues tab.
 */
const COLOUR_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "src/app/admin/publish/page.tsx": [
    "gold\u2192map:caution", // tone-table entry for callouts; the table is only indexed by a row's tone
    "danger\u2192map:danger",
    "danger\u2192sp.error", // result of a publish action
    "gold\u2192sp.notice", // result of a publish action
  ],
  "src/app/admin/inventory/page.tsx": [
    "gold\u2192if !isSupabaseServiceConfigured", // setup screen
    "gold\u2192view.didYouMean", // search hint
    "gold\u2192!onboardingIndex.complete", // R32: onboarding read failed/truncated (result of the read, not a standing banner)
  ],
  "src/app/admin/inventory/intake/[id]/page.tsx": [
    "gold\u2192staged",
    // R23 fix 1: the three raw-string finalize banners (one of them a red
    // "Whole manifest rejected" lit by `rejected=0`) became ONE banner from
    // finalize-banner-core; it is gold only when lots were refused at the dock.
    'gold\u2192: finalBanner.tone === "gold"',
    'danger\u2192ai === "nodocs"',
    'danger\u2192error === "aiextract"',
    'danger\u2192error === "sample_cap"',
    'danger\u2192notified === "failed"',
    'danger\u2192error && error !== "sample_cap" && error !== "polink" && error !== "partial_note" && !error.startsWith("notify_")',
    'danger\u2192error === "polink"',
    "gold\u2192transportSuggestion.usedUsual", // hint on the transport form
    "danger\u2192dismisserr", // R36: result of the Dismiss duplicate action
    "gold\u2192twinKeepId", // R36: lit only while a live twin of this row exists
  ],
  "src/app/admin/inventory/drafts/page.tsx": [
    "gold\u2192if !isSupabaseServiceConfigured",
    'danger\u2192bannerTone === "danger"', // result of an onboarding action
    "gold\u2192pinned", // the deep-linked draft's own highlight
    "gold\u2192factWorklist.length > 0", // Round 13: open fact flags for the pinned delivery
    'danger\u2192lookupResult.tone === "error"', // R19 S13: result of pressing Look up all / Stop (closed set, lookupBanner)
    'danger\u2192coaAllBanner.tone === "bad"', // R37 S4: result of pressing Re-read lab certificates (closed set, deliveryCoaBanner)
    'gold\u2192: coaAllBanner.tone === "warn"', // R37 S4: same result, partly read
    'danger\u2192brandBanner.tone === "bad"', // R37 S5: result of Set brand / Save brand (closed set, deliveryBrandBanner)
    'gold\u2192: brandBanner.tone === "warn"', // R37 S5: brand set but memory/cards partly saved
  ],
};

function colourKeys(file: string): string[] {
  return colouredBlocks(read(file)).map((b) => `${b.tone}\u2192${b.gate ?? "UNGATED"}`);
}

describe("S31 C — no standing coloured banner on the pipeline pages", () => {
  for (const [file, allowed] of Object.entries(COLOUR_ALLOWLIST)) {
    it(`${file}: every tinted block is gated and listed`, () => {
      const keys = colourKeys(file);
      expect(keys.filter((k) => k.endsWith("UNGATED"))).toEqual([]);
      expect([...keys].sort()).toEqual([...allowed].sort());
    });
  }

  it("the four pages carry no raw Tailwind red/orange/amber (tokens only)", () => {
    for (const file of Object.keys(COLOUR_ALLOWLIST)) {
      expect(read(file), file).not.toMatch(/\b(?:bg|border|text)-(?:red|orange|amber)-\d{3}/);
    }
  });

  it("detects a new ungated banner (negative)", () => {
    const src = [
      "export default function P() {",
      "  return (",
      "    <div>",
      '      <div className="rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10">',
      "        You have problems",
      "      </div>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    expect(colouredBlocks(src).map((b) => b.gate)).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// F-115: the manifest page's drafts links are always this delivery's drafts
// ---------------------------------------------------------------------------

describe("S31 docs — the contract is written down", () => {
  it("BACKBONE_CONNECTIVITY_AUDIT.md carries the Fix-link contract section", () => {
    const doc = read("docs/BACKBONE_CONNECTIVITY_AUDIT.md");
    expect(doc).toContain("## 7. Fix-link contract (S31");
    for (const rule of [
      "Count-level row \u2192 the filtered list",
      "Item-level row \u2192 the row or the control",
      "Never a bare list from a scoped page",
      "Never `/admin/products/<key>` unless the key is on the live menu",
    ]) {
      expect(doc).toContain(rule);
    }
  });
});

describe("S31 F-115 — no bare drafts list from a delivery", () => {
  it("the manifest page links drafts only through draftsForManifestHref(id)", () => {
    const page = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(page).toContain("href={draftsForManifestHref(id)}");
    expect(page).not.toMatch(/href=["']\/admin\/inventory\/drafts["']/);
    expect(draftsForManifestHref(MANIFEST)).toContain(`manifest=${MANIFEST}`);
  });
});

// ---------------------------------------------------------------------------
// D. Repo-wide census of literal admin hrefs
// ---------------------------------------------------------------------------

const DYN = "__dyn__";

/**
 * Every literal "/admin..." string in src (outside embedded self-test blocks,
 * whose fixtures are deliberately fake routes). Template holes become a
 * placeholder; a query key that is itself dynamic is skipped (it cannot be
 * checked statically).
 */
function census(files: readonly string[], src: (f: string) => string): string[] {
  const bad: string[] = [];
  for (const f of files) {
    let s = src(f);
    const cut = s.search(/export function __run[A-Za-z0-9]*Tests\b/);
    if (cut >= 0) s = s.slice(0, cut);
    for (const m of s.matchAll(/(["'`])(\/admin(?:[/?#][^"'`\s]*)?)\1/g)) {
      let h = m[2];
      if (m[1] === "`") h = h.replace(/\$\{[^}]*\}/g, DYN);
      if (/[{}*\u2026]|:\w/.test(h)) continue;
      for (const p of checkHref(h, TABLE, read).problems) {
        if (p.kind !== "no_page" && p.key.includes(DYN)) continue;
        bad.push(`${f} | ${h} | ${p.kind}${p.kind !== "no_page" ? `:${p.key}` : ""}`);
      }
    }
  }
  return bad;
}

/**
 * The exact known exceptions. None is a clickable link:
 *   - content/actions.ts: the words `/admin/content` inside a JSDoc comment;
 *   - settings/actions.ts: `/admin/books` in the reset action's revalidatePath
 *     list (revalidating a layout segment; there is no books index page);
 *   - PreviewEditOverlay.tsx: the edit-hotspot base, behind HOTSPOTS_ENABLED = false.
 * S31 fixed the rest (chart-of-accounts 404, compliance/excise 404, and the
 * dropped error/csv/pdf/lifecycle/back/denied/lot keys).
 */
const CENSUS_ALLOWLIST: readonly string[] = [
  "src/app/admin/content/actions.ts | /admin/content | no_page",
  "src/app/admin/settings/actions.ts | /admin/books | no_page",
  "src/components/site/PreviewEditOverlay.tsx | /admin/content | no_page",
];

describe("S31 D — repo-wide census: no dead admin link, no dropped query key", () => {
  const files = SRC_FILES.filter((f) => /\.(ts|tsx)$/.test(f));

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(TABLE.length).toBeGreaterThan(150);
  });

  it("finds nothing outside the exact allowlist (and every allowlist entry is still real)", () => {
    expect(census(files, read).sort()).toEqual([...CENSUS_ALLOWLIST].sort());
  });

  it("the allowlisted ones are really not links", () => {
    expect(read("src/components/site/PreviewEditOverlay.tsx")).toContain("const HOTSPOTS_ENABLED = false;");
    expect(read("src/app/admin/settings/actions.ts")).toMatch(/"\/admin\/books",\s*\]\) \{\s*revalidatePath\(p\);/);
  });

  it("S31 link fixes stay fixed", () => {
    expect(read("src/app/admin/books/financial-statements/page.tsx")).toContain("/admin/books/accounts?entity=${entity}");
    expect(read("src/lib/accounting/books-guidance-core.ts")).toContain('href: "/admin/reports/excise"');
    expect(read("src/components/admin/inventory/LabelPrintControls.tsx")).not.toContain("/admin/inventory?lot=");
    const lot = read("src/app/admin/inventory/[id]/page.tsx");
    expect(lot).toContain('safeAdminPath(back, "")');
  });

  it("detects a new dead link and a new dropped key (negative)", () => {
    const fake = new Map<string, string>([
      ["src/x/a.tsx", 'const a = "/admin/does-not-exist"; const b = `/admin/purchasing?bogus=${1}`;'],
      ["src/x/b.tsx", "const c = `/admin/purchasing?${k}=1`; // dynamic key: skipped\nexport function __runFooTests() { '/admin/nope'; }"],
    ]);
    const got = census([...fake.keys()], (f) => fake.get(f)!);
    expect(got).toEqual([
      "src/x/a.tsx | /admin/does-not-exist | no_page",
      "src/x/a.tsx | /admin/purchasing?bogus=__dyn__ | undeclared_key:bogus",
    ]);
  });
});
