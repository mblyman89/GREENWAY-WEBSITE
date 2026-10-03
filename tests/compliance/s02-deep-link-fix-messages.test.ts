/**
 * tests/compliance/s02-deep-link-fix-messages.test.ts
 *
 * S02 — "Deep-link every 'go fix it' message to the exact product"
 * (bible/build/slices.py S02; findings F-060, F-080, F-008).
 *
 * Three layers, each testing the REAL code:
 *   1. the pure core (draft-deep-link-core) and publish-guard-core's
 *      context-aware explainDiagnostic;
 *   2. the REAL listCatalogDrafts against a recording database fake — the
 *      exact filters sent, ONE round trip, bad ids never reach a query;
 *   3. structural pins on the pages that must USE the above (the drafts page
 *      highlights + anchors the pinned row, the version page passes context,
 *      the intake banners carry ?manifest=, the actions keep the filter).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  __runDraftDeepLinkCoreTests,
  draftsHref,
  draftsForManifestHref,
  effectiveDraftView,
  enrichHrefForDraft,
  parseDraftFocus,
} from "@/lib/catalog/draft-deep-link-core";
import { explainDiagnostic, DRAFT_LINKED_CODES } from "@/lib/pos/publish-guard-core";

// ── Database fake: records every catalog_product_drafts query ─────────────
type Call = { table: string; ops: [string, unknown[]][] };
const calls: Call[] = [];
let rows: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "or", "order", "limit", "in", "neq"]) {
        q[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return q;
        };
      }
      (q as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null }));

const A = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("S02 pure core", () => {
  it("embedded self-tests pass with no failures", () => {
    const r = __runDraftDeepLinkCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(34);
  });

  it("F-060: a link to an APPROVED product never lands on the review queue", () => {
    const focus = parseDraftFocus({ draft: A }); // URL says nothing about the tab
    expect(focus.view).toBe("draft");
    expect(effectiveDraftView(focus, { status: "approved" })).toBe("approved");
  });

  it("deep link carries the row anchor the page renders", () => {
    expect(draftsHref({ status: "approved", draftId: A })).toMatch(new RegExp(`#draft-${A}$`));
  });

  it("F-080: the manifest banner link filters to that delivery", () => {
    expect(draftsForManifestHref(M)).toBe(`/admin/inventory/drafts?manifest=${M}`);
  });

  it("F-008: Enrich now opens the product only when it is a live card", () => {
    expect(enrichHrefForDraft({ posProductKey: "K1", isOnLiveMenu: true, name: "n" })).toBe("/admin/products/K1");
    expect(enrichHrefForDraft({ posProductKey: "K1", isOnLiveMenu: false, name: "n" })).toBe("/admin/products?q=n");
  });
});

describe("S02 explainDiagnostic deep links", () => {
  const ctx = { draft_id: A, productName: "Kiva Gummies 100mg" };

  it("fixHref contains the draft id when the diagnostic names its draft (slice spec test)", () => {
    for (const code of DRAFT_LINKED_CODES) {
      const x = explainDiagnostic(code, "m", { context: ctx });
      expect(x.fixHref).toBe(`/admin/inventory/drafts?status=approved&draft=${A}#draft-${A}`);
    }
  });

  it("falls back to the list URL when the context is absent (slice spec test)", () => {
    expect(explainDiagnostic("draft_inject_no_price", "m").fixHref).toBe("/admin/inventory/drafts");
    expect(explainDiagnostic("draft_inject_no_price", "m", {}).fixHref).toBe("/admin/inventory/drafts");
    expect(explainDiagnostic("fact_extraction_review", "m", { context: {} }).fixHref).toBe(
      "/admin/inventory/drafts?status=approved",
    );
  });

  it("the fact-review fix names product + delivery and states the REAL next step", () => {
    const x = explainDiagnostic("fact_extraction_review", "m", {
      context: ctx,
      vendor: "Acme Farms",
      manifestNumber: "0042",
    });
    expect(x.fix).toContain("Open Kiva Gummies 100mg (approved from Acme Farms manifest 0042)");
    // Until S30 builds the in-row resolution control, confirming the fact does
    // not by itself republish anything — the copy must not promise it does.
    expect(x.fix).not.toMatch(/publishes itself/i);
    expect(x.fix).toContain("press Publish");
  });

  it("uses the delivery when only the manifest is known (mastering diagnostics carry no draft id)", () => {
    const x = explainDiagnostic("intake_master_ambiguous_name", "m", { context: { pos_product_key: "K" }, manifestId: M });
    expect(x.fixHref).toBe(`/admin/inventory/drafts?status=approved&manifest=${M}`);
  });

  it("never sends a code whose fix is not on a draft to the onboarding LIST (S26 routes them to their own control)", () => {
    // S02 kept these on their static list links; S26 (issue-fix-link-core)
    // gives each its own destination. None of them lands on the drafts list.
    for (const code of ["draft_inject_unmapped_category", "intake_master_no_vendor", "intake_master_merge_ambiguous"]) {
      const href = explainDiagnostic(code, "m", { context: ctx, manifestId: M }).fixHref ?? "";
      expect(href.startsWith("/admin/inventory/drafts"), code).toBe(false);
    }
    expect(explainDiagnostic("intake_master_no_vendor", "m", { context: ctx, manifestId: M }).fixHref).toBe(
      `/admin/inventory/intake/${M}#manifest-vendor`,
    );
    expect(explainDiagnostic("draft_inject_unmapped_category", "m", { context: ctx, manifestId: M }).fixHref).toBe(
      "/admin/settings/types?tab=inventory",
    );
  });

  it("every draft-linked code is emitted by the receiving planners WITH the draft id where the draft is known", () => {
    const inj = read("src/lib/pos/draft-injection-core.ts");
    for (const code of ["draft_inject_no_pos_key", "draft_inject_no_price", "fact_extraction_review"]) {
      const at = inj.indexOf(`code: "${code}"`);
      expect(at, code).toBeGreaterThan(-1);
      expect(inj.slice(at, at + 400), code).toContain("draft_id: d.id");
    }
  });
});

describe("S02 listCatalogDrafts — the REAL query", () => {
  beforeEach(() => {
    calls.length = 0;
    rows = [];
  });

  it("no filters: exactly today's query (status eq, newest first, capped)", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    await listCatalogDrafts("approved");
    expect(calls).toHaveLength(1);
    const ops = calls[0].ops.map(([o, a]) => `${o}:${JSON.stringify(a)}`);
    expect(ops).toEqual([
      'select:["*"]',
      'eq:["status","approved"]',
      'order:["created_at",{"ascending":false}]',
      "limit:[500]",
    ]);
  });

  it("manifest filter adds exactly one manifest_id eq", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    await listCatalogDrafts("draft", { manifestId: M });
    expect(calls).toHaveLength(1);
    expect(calls[0].ops).toContainEqual(["eq", ["manifest_id", M]]);
    expect(calls[0].ops.some(([o]) => o === "or")).toBe(false);
  });

  it("pinned draft is fetched in the SAME round trip whatever its status", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    await listCatalogDrafts("draft", { draftId: A });
    expect(calls).toHaveLength(1);
    expect(calls[0].ops).toContainEqual(["or", [`status.eq.draft,id.eq.${A}`]]);
    expect(calls[0].ops.some(([o, a]) => o === "eq" && a[0] === "status")).toBe(false);
  });

  it("pinned draft + manifest: the tab is scoped, the pin is not", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    await listCatalogDrafts("approved", { draftId: A, manifestId: M });
    expect(calls[0].ops).toContainEqual(["or", [`and(status.eq.approved,manifest_id.eq.${M}),id.eq.${A}`]]);
  });

  it("malformed ids and unknown statuses never reach the query", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    await listCatalogDrafts("approved),id.neq.x", { draftId: "x,id.neq.0", manifestId: "'; drop" });
    const ops = calls[0].ops.map(([o, a]) => `${o}:${JSON.stringify(a)}`);
    expect(ops).toEqual([
      'select:["*"]',
      'eq:["status","draft"]',
      'order:["created_at",{"ascending":false}]',
      "limit:[500]",
    ]);
  });
});

describe("S02 structural pins — the pages use the core", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const actions = read("src/app/admin/inventory/drafts/actions.ts");
  const intake = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const version = read("src/app/admin/menu-imports/version/[versionId]/page.tsx");
  const resolver = read("src/lib/inventory/website-category-resolver-server.ts");

  it("drafts page: validated focus, one read, pinned row decides the tab", () => {
    expect(page).toContain("parseDraftFocus(sp)");
    // S14 moved the ONE read to listCatalogDraftsPage (same S02 query when a
    // draft is pinned); the validated focus must still drive it.
    const read1 = page.slice(page.indexOf("listCatalogDraftsPage({"), page.indexOf("}),", page.indexOf("listCatalogDraftsPage({")));
    for (const k of ["status: focus.view,", "manifestId: focus.manifestId,", "draftId: focus.draftId,"]) expect(read1, k).toContain(k);
    expect(page.match(/listCatalogDraftsPage\(\{/g) ?? []).toHaveLength(1);
    expect(page).toContain("effectiveDraftView(focus, pinned)");
    expect(page).toContain("listed.filter((d) => d.status === view)");
    expect(page).not.toMatch(/listCatalogDrafts\(view\)/);
  });

  it("drafts page: every row has the anchor id and the pinned row is highlighted", () => {
    expect(page).toContain("id={draftRowAnchorId(d.id)}");
    expect(page).toMatch(/aria-current=\{pinned\?\.id === d\.id \? "true" : undefined\}/);
    expect(page).toContain("scroll-mt-24");
  });

  it("drafts page: tabs keep the delivery filter and there is a way out of it", () => {
    expect(page).toContain("href={draftsHref({ status: s, manifestId: focus.manifestId })}");
    expect(page).toContain("Show every delivery");
    expect(page).toContain("no longer exists");
  });

  it("drafts page: every row form returns to the same delivery", () => {
    const forms = page.match(/<form action=\{(approve|dismiss|restore)\}[^>]*>\s*\{focus\.manifestId && <input type="hidden" name="return_manifest"/g) ?? [];
    expect(forms).toHaveLength(3);
  });

  it("drafts page: Enrich now links by key, gated on the live-menu set", () => {
    expect(page).toContain("enrichHrefForDraft({");
    expect(page).toContain("liveKeys.has(d.pos_product_key)");
    expect(page).not.toContain("/admin/products?q=${encodeURIComponent(d.name");
  });

  it("live keys come from the resolver's existing published-menu read (no new query)", () => {
    expect(page).toContain("resolveWebsiteCategoriesWithLiveKeys(");
    expect(resolver).toContain("liveKeys: new Set(menuCategories.keys())");
    // still exactly one menu_items read in the resolver module
    expect(resolver.match(/\.from\("menu_items"\)/g)).toHaveLength(1);
  });

  it("actions: every redirect goes through the filter-preserving helper", () => {
    expect(actions).not.toMatch(/redirect\(\s*["`]\/admin\/inventory\/drafts/);
    expect(actions.match(/redirect\(backTo\(formData, /g)?.length).toBeGreaterThanOrEqual(11);
    expect(actions).toContain("draftsHref({ manifestId:");
  });

  it("intake banners open THIS delivery's drafts (F-080)", () => {
    // R23: the accepted + finalized banners merged into ONE (finalize-banner-core).
    expect(intake.match(/href=\{draftsForManifestHref\(id\)\}/g)).toHaveLength(1);
    expect(intake).not.toContain('href="/admin/inventory/drafts"');
  });

  it("version page passes the diagnostic context + delivery to explainDiagnostic", () => {
    // S26 spreads linkBase into issueLinks (adds lookups + back).
    expect(version).toContain("const issueLinks = {\n    ...linkBase,");
    expect(version).toContain("explainDiagnostic(d.code, d.message, { ...issueLinks, context: d.context })");
    expect(version).toContain("str(summary.manifest?.id) ?? str(summary.manifest_id)");
  });
});
