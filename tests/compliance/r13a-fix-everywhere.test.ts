/**
 * Round 13 (R13a) — every button that sends the owner somewhere lands on a
 * control that fixes the thing it named.
 *
 * Owner (Round 13): "when I am sent to the publish page when I click an item
 * to fix, nothing was there for me to do when I got there... any and all
 * buttons or warnings and fixes that don't have buttons yet on the menu import
 * page, needs to have working buttons and buttons added and then the features
 * behind the button that actually allows me to fix the items."
 *
 * Covered here:
 *   - menu-waiting-link-core: a delivery's waiting update links to where it is
 *     decided (flagged facts / cutover / its review page), never bare /admin/publish;
 *     the flagged-facts worklist reaches flags on any page of the Approved list.
 *   - pos-import-fix-core: every Cultivera import diagnostic code has copy and,
 *     unless only Cultivera can fix it, a link; lot links are gated on lots existing.
 *   - page wiring: the import page, Rejected list, product Visibility and
 *     history row actually render those links.
 * Link validity (page exists, keys declared, anchors rendered) is proven for
 * every emitted href by the S31 contract (pipeline-fix-links-connected.test.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runMenuWaitingLinkCoreTests,
  factFlagWorklist,
  factHoldHref,
  pickWaitingVersion,
  publishRowManifestId,
  waitingMenuFix,
} from "@/lib/pos/menu-waiting-link-core";
import {
  __runPosImportFixCoreTests,
  CULTIVERA_ONLY_CODES,
  MISSING_COA_HREF,
  POS_ERROR_CODES,
  POS_REVIEW_CODES,
  UNKNOWN_COST_BULK_HREF,
  hiddenItemFix,
  lotSearchHref,
  posDiagnosticRowLink,
  posImportFixFor,
  productVisibilityHref,
} from "@/lib/pos/pos-import-fix-core";
import { primaryAction } from "@/lib/pos/publish-queue-core";

const read = (f: string) => readFileSync(f, "utf8");
const M = "22222222-2222-4222-8222-222222222222";
const D = "33333333-3333-4333-8333-333333333333";
const IMP = "44444444-4444-4444-8444-444444444444";

describe("R13a pure cores — self-tests and runner registration", () => {
  it("menu-waiting-link-core passes every embedded assertion", () => {
    const r = __runMenuWaitingLinkCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });
  it("pos-import-fix-core passes every embedded assertion", () => {
    const r = __runPosImportFixCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(140);
  });
  it("both are registered in the pure runner before the final banner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    for (const fn of ["__runMenuWaitingLinkCoreTests", "__runPosImportFixCoreTests"]) {
      expect(runner).toContain(fn);
      expect(runner.lastIndexOf(fn)).toBeLessThan(runner.indexOf("ALL PURE SELF-TESTS PASSED"));
    }
  });
});

describe("R13a waiting update — never the bare Publish page", () => {
  it("a fact-held update goes to this delivery's flagged products", () => {
    const f = waitingMenuFix({ manifestId: M, version: { id: "v1", state: "held_for_fact_review" } });
    expect(f.href).toBe(`/admin/inventory/drafts?status=approved&manifest=${M}`);
    expect(f.extra?.href).toBe(`/admin/menu-imports/version/v1?back=${encodeURIComponent(`/admin/inventory/intake/${M}`)}`);
  });
  it("a cutover-held update goes to the cutover page", () => {
    const f = waitingMenuFix({ manifestId: M, version: { id: "v1", state: "held_for_cutover" } });
    expect(f.href).toBe("/admin/menu-imports/cutover");
  });
  it("anything else goes to that update's own review page", () => {
    for (const state of [null, "publish_failed", "unexpected"]) {
      const f = waitingMenuFix({ manifestId: M, version: { id: "v 1", state } });
      expect(f.href.startsWith("/admin/menu-imports/version/v%201")).toBe(true);
      expect(f.href).not.toBe("/admin/publish");
      expect(f.extra).toBeNull();
    }
  });
  it("a bad manifest id is never linked", () => {
    const f = waitingMenuFix({ manifestId: "not-a-uuid", version: { id: "v1", state: "held_for_fact_review" } });
    expect(f.href).toBe("/admin/inventory/drafts?status=approved");
    expect(f.extra?.href).toBe("/admin/menu-imports/version/v1");
  });
  it("pickWaitingVersion takes the newest non-superseded staged row", () => {
    const rows = [
      { id: "a", created_at: "2026-01-01T00:00:00Z", state: "held_for_fact_review" },
      { id: "b", created_at: "2026-01-03T00:00:00Z", state: " held_for_cutover " },
    ];
    expect(pickWaitingVersion(rows, null)).toEqual({ id: "b", state: "held_for_cutover" });
    expect(pickWaitingVersion([], null)).toBeNull();
    expect(pickWaitingVersion(null, null)).toBeNull();
  });
  it("the Publish page's fact-hold row goes to the flagged-facts worklist", () => {
    const factHref = factHoldHref({ manifest: { id: M } });
    expect(factHref).toBe(`/admin/inventory/drafts?status=approved&manifest=${M}#flagged-facts`);
    expect(factHoldHref({})).toBeNull();
    const LETTERS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(publishRowManifestId({ manifest_id: LETTERS.toUpperCase() })).toBe(LETTERS);
    expect(factHoldHref({ manifest_id: ` ${LETTERS.toUpperCase()} ` })).toBe(`/admin/inventory/drafts?status=approved&manifest=${LETTERS}#flagged-facts`);
    const a = primaryAction("fact_review", "/admin/menu-imports/version/v1", factHref);
    expect(a.href).toBe(factHref);
  });
});

describe("R13a flagged-facts worklist — every flag reachable from page 1", () => {
  const flag = (draftId: string, name: string) => ({ manifestId: M, draftId, productName: name, reasons: ["THC looks wrong"] });
  it("a flag whose row is on another page pins that row", () => {
    const rows = factFlagWorklist([flag(D, "Blue Dream")], M, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toBe(`/admin/inventory/drafts?status=approved&manifest=${M}&draft=${D}#draft-${D}`);
    expect(rows[0].onThisPage).toBe(false);
  });
  it("a flag on this page is an anchor jump", () => {
    const rows = factFlagWorklist([flag(D, "Blue Dream")], M, new Set([D]));
    expect(rows[0].href).toBe(`#draft-${D}`);
  });
  it("other deliveries' flags and bad ids are left out", () => {
    expect(factFlagWorklist([{ ...flag(D, "x"), manifestId: IMP }], M, new Set())).toEqual([]);
    expect(factFlagWorklist([flag("nope", "x")], M, new Set())).toEqual([]);
    expect(factFlagWorklist([flag(D, "x")], null, new Set())).toEqual([]);
  });
});

describe("R13a Cultivera import — every diagnostic code has a fix", () => {
  const live = { importId: IMP, versionPublished: true, lotsCreated: true };
  const staged = { importId: IMP, versionPublished: false, lotsCreated: false };
  const liveNoLots = { importId: IMP, versionPublished: true, lotsCreated: false };

  it("fact-review codes open this import's Fact review", () => {
    for (const c of POS_REVIEW_CODES) {
      expect(posImportFixFor(c, staged)?.links).toEqual([{ href: `/admin/menu-imports/${IMP}/facts`, label: "Fix these in Fact review" }]);
    }
  });
  it("blocking export errors send the owner to re-upload", () => {
    for (const c of POS_ERROR_CODES) expect(posImportFixFor(c, staged)?.links[0].href).toBe("/admin/menu-imports");
  });
  it("Cultivera-only rows say so and offer no pretend button", () => {
    for (const c of CULTIVERA_ONLY_CODES) {
      const f = posImportFixFor(c, live);
      expect(f?.links).toEqual([]);
      expect(f?.how).toMatch(/Cultivera/);
    }
  });
  it("lot fixes open real lot lists once lots exist", () => {
    expect(posImportFixFor("import_lot_cost_unparseable", live)?.links[0].href).toBe(UNKNOWN_COST_BULK_HREF);
    expect(posImportFixFor("import_lots_coa_missing_summary", live)?.links[0].href).toBe(MISSING_COA_HREF);
  });
  it("before lots exist: published -> the backfill button; staged -> said plainly, no link", () => {
    const pub = posImportFixFor("import_lot_cost_unparseable", liveNoLots);
    expect(pub?.links[0].href).toBe(`/admin/menu-imports/${IMP}#backfill-lots`);
    const st = posImportFixFor("import_lot_cost_unparseable", staged);
    expect(st?.links).toEqual([]);
    expect(st?.how).toMatch(/created when you publish/);
  });
  it("COA copy is honest that no attach button exists yet", () => {
    expect(posImportFixFor("import_lot_coa_missing", live)?.how).toMatch(/no attach button exists yet/);
  });
  it("unknown codes are information only", () => {
    expect(posImportFixFor("some_info_code", live)).toBeNull();
  });
  it("per-row links target the exact lot by barcode", () => {
    expect(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: "123" }, live)).toEqual({
      href: lotSearchHref("123", "unit_cost_minor_units"),
      label: "Fill this cost",
    });
    expect(lotSearchHref("123", "unit_cost_minor_units")).toBe("/admin/inventory?q=123&bulk=1&bulkField=unit_cost_minor_units");
    expect(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: "123" }, staged)).toBeNull();
    expect(posDiagnosticRowLink("product_without_inventory", { product: "x" }, live)).toBeNull();
  });
});

describe("R13a hidden cards — each has its control", () => {
  it("reviewer rejects on an import are undone in the Rejected list", () => {
    expect(hiddenItemFix({ sourceItemId: "k", hiddenReason: "reviewer_rejected", importId: IMP, versionPublished: true })?.href).toBe(
      `/admin/menu-imports/${IMP}/facts#rejected`,
    );
  });
  it("live overrides and missing-master cards go to the product's Visibility control", () => {
    for (const hiddenReason of ["owner_override_hide:x", "no_product_master"]) {
      expect(hiddenItemFix({ sourceItemId: "a b", hiddenReason, importId: IMP, versionPublished: true })?.href).toBe(
        productVisibilityHref("a b"),
      );
    }
    expect(productVisibilityHref("a b")).toBe("/admin/products/a%20b#visibility");
  });
  it("a staged missing-master card goes to the missing-products worklist", () => {
    expect(hiddenItemFix({ sourceItemId: "k", hiddenReason: "no_product_master", importId: IMP, versionPublished: false })?.href).toBe(
      `/admin/menu-imports/${IMP}/missing-products`,
    );
  });
});

describe("R13a page wiring — the links are rendered where the owner lands", () => {
  const importPage = read("src/app/admin/menu-imports/[id]/page.tsx");
  const factsPage = read("src/app/admin/menu-imports/[id]/facts/page.tsx");
  const historyPage = read("src/app/admin/menu-imports/page.tsx");
  const productPage = read("src/app/admin/products/[key]/page.tsx");
  const drafts = read("src/app/admin/inventory/drafts/page.tsx");
  const publish = read("src/app/admin/publish/page.tsx");
  const intake = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const version = read("src/app/admin/menu-imports/version/[versionId]/page.tsx");

  it("import page: each code row renders its fix buttons and one-at-a-time links", () => {
    for (const t of ["import-diagnostic-fix", "import-diagnostic-row-fix", "hidden-item-fix", "lot-plan-expiry-fix", "lot-plan-coa-list"]) {
      expect(importPage).toContain(`data-testid="${t}"`);
    }
    expect(importPage).toContain("posImportFixFor(");
    expect(importPage).toContain("posDiagnosticRowLink(");
    expect(importPage).toContain("hiddenItemFix(");
  });
  it("facts page: a reject is reversible in place", () => {
    expect(factsPage).toContain('id="rejected"');
    expect(factsPage).toContain('data-testid="rejected-undo"');
    const at = factsPage.indexOf('data-testid="rejected-undo"');
    const form = factsPage.slice(factsPage.lastIndexOf("<form action={resolveFactReview}", at), at);
    expect(form).toContain('<input type="hidden" name="action" value="approve" />');
    expect(form).toContain('name="sourceItemId" value={row.sourceItemId}');
  });
  it("history row: the warning count is a link to the diagnostics", () => {
    expect(historyPage).toContain('data-testid="import-warn-link"');
    expect(historyPage).toContain("#diagnostics`");
  });
  it("product page: the Visibility control carries the anchor", () => {
    expect(productPage).toContain('id="visibility"');
  });
  it("drafts page renders the flagged-facts worklist; publish, intake and version pages use the fact link", () => {
    expect(drafts).toContain('id="flagged-facts"');
    expect(publish).toContain("primaryAction(reason, reviewHref, factHref)");
    // The intake page passes its manifest id into menuStep, which uses waitingMenuFix.
    expect(intake).toContain("menuStep(manifest.status, menuSnapshot ? { ...menuSnapshot, manifestId: id } : null)");
    expect(read("src/lib/inventory/menu-live-step-core.ts")).toContain("waitingMenuFix({ manifestId: input.manifestId ?? null, version: input.waitingVersion })");
    // The loader only reports stagedWaiting when it named the version, so the
    // legacy bare-Publish branch is unreachable from the real page.
    expect(read("src/lib/pos/intake-menu-staging.ts")).toContain("stagedWaiting: waitingVersion !== null,");
    expect(version).toContain('data-testid="version-fact-hold-link"');
  });
});
