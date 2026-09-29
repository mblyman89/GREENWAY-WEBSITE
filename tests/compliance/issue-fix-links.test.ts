/**
 * S26 — issue-fix-link-core: every receiving "How to fix it" button lands on
 * the control that fixes it (bible S26; F-093, F-094, F-096, F-097, F-098,
 * F-100, F-101, F-102, F-114, F-118).
 *
 * Like blocked-stock-fix-links.test.ts this leans on the FILESYSTEM: every
 * href the registry can emit is resolved to a real page.tsx, that page is
 * grepped for the param it receives, and the anchor / control it lands on is
 * grepped too. A link that "looks right" in a unit test but opens a page with
 * nothing to do is exactly the bug S26 fixes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_ISSUE_LOOKUPS,
  ISSUE_COPY,
  ISSUE_FIX_ROUTE_FILES,
  ISSUE_LINKED_CODES,
  __runIssueFixLinkCoreTests,
  fixLinkForDiagnostic,
  indexIssueDrafts,
  issueContextFor,
  issueLookupPlan,
  issueRouteFor,
  kbProductsHref,
  lotEnrichmentHref,
  typeMatchesFocus,
  typeRowAnchorId,
  typesHref,
  type IssueContext,
  type IssueLookups,
} from "@/lib/pos/issue-fix-link-core";
import { explainDiagnostic } from "@/lib/pos/publish-guard-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Source with comment lines removed (so a comment can't satisfy a grep). */
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(l))
    .join("\n");

const D = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
const L = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const BACK = "/admin/menu-imports/version/v1";

/** Every context shape the page can produce, from empty to fully resolved. */
const SHAPES: IssueContext[] = [
  {},
  { manifestId: M },
  { draftId: D },
  { draftId: D, productName: "Gummies" },
  { draftId: D, lotId: L, posProductKey: "K1", typeName: "Solid Edible", manifestId: M, back: BACK },
  { draftId: D, lotId: L, posProductKey: "K1", typeName: "Usable Marijuana", manifestId: M },
  { lotId: L, posProductKey: "K1" },
  { posProductKey: "K1", isOnLiveMenu: true, back: BACK },
  { draftId: D, lotId: L, posProductKey: "K1", isOnLiveMenu: true, back: BACK },
  { liveCardKeys: ["C1", "C 2"], identity: "house llc|flower|blue-dream", back: BACK },
];

describe("S26 core self-tests", () => {
  it("embedded self-tests all pass (pinned count)", () => {
    const r = __runIssueFixLinkCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(157);
  });

  it("is registered in the pure self-test runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runIssueFixLinkCoreTests } from "../../src/lib/pos/issue-fix-link-core";');
    expect(runner).toContain("const r = __runIssueFixLinkCoreTests(); if (r.failed > 0 || r.passed < 1)");
  });

  it("the core is pure (no fs, network, supabase, server-only, clock)", () => {
    const src = code("src/lib/pos/issue-fix-link-core.ts");
    for (const bad of ["server-only", "supabase", "node:fs", "fetch(", "Date.now", "new Date(", "async "]) {
      expect(src, bad).not.toContain(bad);
    }
  });
});

describe("S26 — every emitted href lands on a real page", () => {
  it("each route file in the registry exists on disk", () => {
    for (const [route, file] of Object.entries(ISSUE_FIX_ROUTE_FILES)) {
      expect(existsSync(join(ROOT, file)), `${route} -> ${file}`).toBe(true);
    }
  });

  it("every code × every context shape resolves (main + extra links)", () => {
    let n = 0;
    for (const c of ISSUE_LINKED_CODES) {
      for (const s of SHAPES) {
        const f = fixLinkForDiagnostic(c, s);
        expect(f, `${c} ${JSON.stringify(s)}`).not.toBeNull();
        for (const l of [f!, ...f!.extra]) {
          const route = issueRouteFor(l.href);
          expect(route, `${c}: ${l.href}`).not.toBeNull();
          expect(l.routeFile).toBe(ISSUE_FIX_ROUTE_FILES[route!]);
          expect(existsSync(join(ROOT, l.routeFile)), l.routeFile).toBe(true);
          expect(l.href.startsWith("/admin/")).toBe(true);
          expect(l.label).not.toMatch(/→|&rarr;/); // the page adds the arrow
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(ISSUE_LINKED_CODES.length * SHAPES.length);
  });

  it("FYI and unknown codes invent no link", () => {
    for (const c of ["intake_master_grouped", "draft_injected", "books_lot_cost_unknown", "brand_new", ""]) {
      expect(fixLinkForDiagnostic(c, SHAPES[4])).toBeNull();
    }
  });

  it("no emitted href is Product Mastering (never read by the merge, F-096) or an invalid stock filter", () => {
    for (const c of ISSUE_LINKED_CODES) {
      for (const s of SHAPES) {
        const f = fixLinkForDiagnostic(c, s)!;
        for (const l of [f, ...f.extra]) {
          expect(l.href).not.toContain("/admin/products/masters");
          expect(l.href).not.toContain("stock=all");
        }
      }
    }
    expect(code("src/lib/pos/publish-guard-core.ts")).not.toContain('"/admin/products/masters"');
  });
});

describe("S26 — each destination receives its param and has the control", () => {
  it("drafts page: ?status=approved&draft=<id>#draft-<id> is parsed and anchored (S02)", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("draft?: string;");
    expect(page).toContain("manifest?: string;");
    const f = fixLinkForDiagnostic("draft_inject_no_price", { draftId: D })!;
    expect(f.href).toBe(`/admin/inventory/drafts?status=approved&draft=${D}#draft-${D}`);
  });

  it("types page: ?tab=inventory&type=<name> opens the row whose id is the link's anchor, next to the mapping Select", () => {
    const page = code("src/app/admin/settings/types/page.tsx");
    // S27: the tab is resolved by the shared primitive; a bare ?type= opens Inventory Types.
    expect(page).toContain('resolveTab(TYPES_PAGE_TABS, { tab: sp.tab, type: sp.type }, "website")');
    expect(page).toContain("type?: string");
    expect(page).toContain("focusType={focusType}");
    expect(page).toContain("id={isFocus(t) && focusType ? typeRowAnchorId(focusType) : undefined}");
    expect(page).toContain("open={isFocus(t) || undefined}");
    expect(page).toContain("typeMatchesFocus(t.key, focusType) || typeMatchesFocus(t.label, focusType)");
    expect(page).toContain('data-testid="type-focus-notice"');
    // The control that fixes it: the row's update form + website_category Select.
    expect(page).toContain("action={updateInventoryType}");
    expect(page).toContain('name="website_category"');
    // The anchor the link carries is exactly the id the page will render.
    const href = typesHref("Solid Edible");
    expect(href.split("#")[1]).toBe(typeRowAnchorId("Solid Edible"));
    expect(typeMatchesFocus("solid  edible", "Solid Edible")).toBe(true);
    // The save redirect keeps the owner on the Inventory tab.
    expect(read("src/app/admin/settings/types/actions.ts")).toContain("redirect(`${BASE}?saved=inventory&tab=inventory`)");
  });

  it("lot page: #coa and #website-category exist; the category form is the per-product override", () => {
    const page = code("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain('<div id="coa" className="scroll-mt-24');
    expect(page).toContain('<div id="website-category" className="scroll-mt-24');
    expect(page).toContain("action={classificationAction}");
    expect(page).toContain('name="website_category"');
    // #website-category sits BEFORE the override form (the link lands above it).
    expect(page.indexOf('id="website-category"')).toBeLessThan(page.indexOf("action={classificationAction}"));
    // The override outranks the type map (resolver precedence (0)).
    expect(read("src/lib/inventory/website-category-resolver-server.ts")).toContain("HIGHEST precedence");
  });

  it("lot page: KB buttons pre-search (F-100) and the enrichment button is live-guarded (F-101)", () => {
    const page = code("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain("const kbHref = kbProductsHref(kbProduct?.display_name || lot.product_name);");
    expect(page.match(/href=\{kbHref\}/g)?.length).toBe(2);
    expect(page).not.toContain("href={`/admin/knowledge-base/products`}");
    expect(page).toContain("(await loadMenuCategoriesForKeys([lot.pos_product_key])).has(lot.pos_product_key)");
    expect(page).toContain("const enrichHref = lotEnrichmentHref(lot.pos_product_key, isLive,");
    expect(page.match(/href=\{enrichHref\}/g)?.length).toBe(2);
    expect(page).not.toContain("href={`/admin/products/${encodeURIComponent(lot.pos_product_key)}");
    expect(lotEnrichmentHref("K1", false, "Gummies", L)).toBe("/admin/products?q=Gummies");
    // The product page really 404s for an unpublished key (why the guard exists).
    const product = read("src/app/admin/products/[key]/page.tsx");
    expect(product).toContain("notFound()");
  });

  it("KB products page: ?q= pre-fills the viewer's search box", () => {
    const page = code("src/app/admin/knowledge-base/products/page.tsx");
    expect(page).toContain("searchParams?: Promise<{ q?: string }>;");
    expect(page).toContain("initialQuery={initialQuery}");
    const viewer = code("src/app/admin/knowledge-base/products/KbProductsViewer.tsx");
    expect(viewer).toContain("useState(initialQuery)");
    expect(viewer).toContain('initialQuery = "",');
    expect(kbProductsHref("Blue Dream")).toBe("/admin/knowledge-base/products?q=Blue%20Dream");
  });

  it("manifest page: #manifest-vendor shows the named + linked vendor with real next steps", () => {
    const page = code("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(page).toMatch(/\sid="manifest-vendor"/);
    expect(page).toContain("scroll-mt-24");
    expect(page).toContain("href={`/admin/vendors/${linkedVendor.id}`}");
    expect(page).toContain("href={`/admin/vendors?q=${encodeURIComponent(manifest.vendor_label)}`}");
    expect(page).toContain('href="/admin/vendors/merge"');
    // Those destinations exist and act: vendors list takes q, merge posts the merge.
    expect(read("src/app/admin/vendors/page.tsx")).toContain("q?: string;");
    expect(read("src/app/admin/vendors/merge/page.tsx")).toContain("mergeVendorsAction");
    // "Accepting links the named vendor automatically" is true (H17 repair).
    expect(read("src/lib/inventory/intake-store.ts")).toContain("H17 — accept-time vendor repair.");
    expect(fixLinkForDiagnostic("intake_master_no_vendor", { manifestId: M })!.href).toBe(
      `/admin/inventory/intake/${M}#manifest-vendor`,
    );
  });

  it("product page: ?back= is accepted (merge / potency card links carry it)", () => {
    const product = read("src/app/admin/products/[key]/page.tsx");
    expect(product).toContain("back?: string;");
    expect(product).toContain("back={back}");
    const f = fixLinkForDiagnostic("intake_master_merge_ambiguous", SHAPES[9])!;
    expect(f.extra.map((e) => e.href)).toEqual([
      `/admin/products/C1?back=${encodeURIComponent(BACK)}`,
      `/admin/products/C%202?back=${encodeURIComponent(BACK)}`,
    ]);
    expect(f.href).toBe("/admin/products?q=blue%20dream");
    expect(read("src/app/admin/products/page.tsx")).toContain("q?: string;");
  });
});

describe("S26 — the version page wires lookups + renders extras and why", () => {
  const page = code("src/app/admin/menu-imports/version/[versionId]/page.tsx");
  it("reads lookups once for the warnings and passes them with a back link", () => {
    expect(page).toContain("lookups: await loadIssueLookups(warnings, linkBase.manifestId),");
    expect(page).toContain("back: `/admin/menu-imports/version/${version.id}`,");
    expect(page).toContain("explainDiagnostic(d.code, d.message, { ...issueLinks, context: d.context })");
  });
  it("renders extra links and a Why disclosure", () => {
    expect(page).toContain('data-testid="issue-fix-extra"');
    expect(page).toContain("x.extra.map((e) =>");
    expect(page).toContain("<summary className=\"cursor-pointer\">Why did this happen?</summary>");
    expect(page).toContain('data-testid="issue-fix-link"');
  });
  it("the server loader reads named columns, scoped to this delivery's approved drafts, and never throws", () => {
    const srv = code("src/lib/pos/issue-fix-link-server.ts");
    expect(srv).toContain('import "server-only";');
    expect(srv).toContain('export const ISSUE_DRAFT_COLUMNS = "id, lot_id, inventory_type, pos_product_key, name";');
    expect(srv).not.toContain('select("*")');
    expect(srv).toContain('.eq("manifest_id", manifestId)');
    expect(srv).toContain('.eq("status", "approved")');
    expect(srv).toContain('.in("pos_product_key", plan.draftKeys)');
    expect(srv).toContain('.in("id", plan.draftIds)');
    expect(srv).toContain('console.error("[issue-fix-link] lookups failed:", err);\n    return EMPTY_ISSUE_LOOKUPS;');
    expect(srv).toContain("loadMenuCategoriesForKeys([...keys])");
    // Columns exist on the table (migration 0026).
    const mig = read("supabase/migrations/0026_pos_catalog_drafts.sql");
    for (const col of ["lot_id", "inventory_type", "pos_product_key", "name", "manifest_id"]) expect(mig).toContain(col);
  });
});

describe("S26 — emitters really carry the context the registry reads", () => {
  it("draft-injection persists draft_id + pos_product_key on every linked code", () => {
    const inj = read("src/lib/pos/draft-injection-core.ts");
    for (const c of ["draft_inject_unmapped_category", "draft_inject_no_price"]) {
      const at = inj.indexOf(`code: "${c}"`);
      expect(at, c).toBeGreaterThan(-1);
      expect(inj.slice(at, at + 600)).toContain("context: { draft_id: d.id, pos_product_key: key }");
    }
  });
  it("mastering persists pos_product_key (no_vendor, ambiguous_name) and identity + live_card_keys (merge)", () => {
    const m = read("src/lib/pos/intake-mastering-core.ts");
    for (const c of ["intake_master_no_vendor", "intake_master_ambiguous_name"]) {
      const at = m.indexOf(`code: "${c}"`);
      expect(m.slice(at, at + 500)).toContain("context: { pos_product_key: it.source_item_id }");
    }
    const at = m.indexOf('code: "intake_master_merge_ambiguous"');
    const block = m.slice(at, at + 600);
    expect(block).toContain("identity: group.identity");
    expect(block).toContain("live_card_keys: liveMatches.map((c) => c.source_item_id)");
  });
});

describe("S26 — end to end through explainDiagnostic (what the owner sees)", () => {
  const byId = [{ id: D, lot_id: L, inventory_type: "Solid Edible", pos_product_key: "K1", name: "Gummies" }];
  const byKey = [{ id: D, lot_id: L, inventory_type: "Solid Edible", pos_product_key: "K1", name: "Gummies" }];
  const lookups: IssueLookups = { ...indexIssueDrafts(byId, byKey), liveKeys: new Set(["K1", "C1"]) };
  const link = { manifestId: M, lookups, back: BACK };

  it("unmapped category → that type's row, plus re-file just this product", () => {
    const x = explainDiagnostic("draft_inject_unmapped_category", "m", { ...link, context: { draft_id: D, pos_product_key: "K1" } });
    expect(x.fixHref).toBe("/admin/settings/types?tab=inventory&type=Solid%20Edible#type-solid-edible");
    expect(x.fixLabel).toBe("Map \u201cSolid Edible\u201d");
    expect(x.extra?.map((e) => e.href)).toEqual([`/admin/inventory/${L}#website-category`]);
    expect(x.fix).toBe(ISSUE_COPY.unmappedTypedFix("Solid Edible"));
  });

  it("potency capped → the lot's COA, plus the live card", () => {
    const x = explainDiagnostic("draft_inject_potency_capped", "m", { ...link, context: { draft_id: D, pos_product_key: "K1" } });
    expect(x.fixHref).toBe(`/admin/inventory/${L}#coa`);
    expect(x.extra?.[0].href).toBe(`/admin/products/K1?back=${encodeURIComponent(BACK)}`);
    expect(x.fix).toBe(ISSUE_COPY.potencyFix);
  });

  it("ambiguous name → its own draft (mapped by key server-side); no rename promise", () => {
    const x = explainDiagnostic("intake_master_ambiguous_name", "m", { ...link, context: { pos_product_key: "K1" } });
    expect(x.fixHref).toBe(`/admin/inventory/drafts?status=approved&draft=${D}#draft-${D}`);
    expect(x.fixLabel).toBe("Open Gummies");
    expect(x.fix).not.toMatch(/rename it/i);
  });

  it("no vendor → the manifest's vendor block, plus the lot", () => {
    const x = explainDiagnostic("intake_master_no_vendor", "m", { ...link, context: { pos_product_key: "K1" } });
    expect(x.fixHref).toBe(`/admin/inventory/intake/${M}#manifest-vendor`);
    expect(x.extra?.[0].href).toBe(`/admin/inventory/${L}`);
  });

  it("merge ambiguous → only still-live cards + family search + why", () => {
    const x = explainDiagnostic("intake_master_merge_ambiguous", "m", {
      ...link,
      context: { identity: "house llc|flower|blue-dream", live_card_keys: ["C1", "GONE"] },
    });
    expect(x.fixHref).toBe("/admin/products?q=blue%20dream");
    expect(x.extra?.map((e) => e.label)).toEqual(["Live card 1"]);
    expect(x.why).toBe(ISSUE_COPY.mergeWhy);
    expect(x.fixLabel).toBe("Compare the cards");
  });

  it("with NO lookups (a failed read) every code still gets a working list link", () => {
    for (const c of ISSUE_LINKED_CODES) {
      const x = explainDiagnostic(c, "m", { manifestId: M, lookups: EMPTY_ISSUE_LOOKUPS, context: { pos_product_key: "K1" } });
      expect(x.fixHref, c).not.toBeNull();
      expect(issueRouteFor(x.fixHref!), c).not.toBeNull();
    }
  });

  it("lookup plan reads only what warnings need", () => {
    const plan = issueLookupPlan([
      { severity: "warning", code: "draft_inject_potency_capped", context: { draft_id: D, pos_product_key: "K1" } },
      { severity: "info", code: "draft_injected", context: { draft_id: M } },
      { severity: "warning", code: "intake_master_no_vendor", context: { pos_product_key: "K2" } },
    ]);
    expect(plan).toEqual({ draftIds: [D], draftKeys: ["K2"], liveKeys: ["K1"] });
    const ctx = issueContextFor({ code: "intake_master_no_vendor", context: { pos_product_key: "K1" } }, { manifestId: M }, lookups);
    expect(ctx.draftId).toBe(D);
  });
});

describe("S26 — honest copy (no promise the code does not keep)", () => {
  const guard = read("src/lib/pos/publish-guard-core.ts");
  it("old dead-end copy is gone", () => {
    for (const old of [
      "Consolidate the duplicate live cards under Product Mastering.",
      "correct it on the product's enrichment page",
      "Rename it under Product Onboarding",
      'fixLabel: "Open mastering"',
      'fixLabel: "Open enrichment"',
    ]) {
      expect(guard, old).not.toContain(old);
    }
  });
  it("merge copy does not claim the choice is remembered before S32", () => {
    expect(ISSUE_COPY.mergeFix).not.toMatch(/we'll remember/i);
    expect(ISSUE_COPY.mergeFix).toContain("arrives with the match screen");
  });
  it("ambiguous-name copy says names can't be edited here (there is no rename control)", () => {
    expect(ISSUE_COPY.ambiguousNameFix).toContain("can't be edited here yet");
  });
});

describe("S26 — env ledger", () => {
  it("S26 adds no environment variable", () => {
    const ledger = read("docs/INTAKE_PIPELINE_ENV_LEDGER.md");
    expect(ledger).toContain("S26");
    expect(code("src/lib/pos/issue-fix-link-core.ts")).not.toContain("process.env");
    expect(code("src/lib/pos/issue-fix-link-server.ts")).not.toContain("process.env");
  });
});
