/**
 * tests/compliance/classification-worklist-plumbing.test.ts   (SLICE 18A)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PLUMBING TESTS.
 *
 * classification-worklist-core's own self-tests prove the RULES are right.
 * These prove the rules are actually CONNECTED — that the worklist reads the
 * surface that enforces, that the editor writes it, and that nothing in
 * between quietly reintroduces the defect the slice exists to remove.
 *
 * This is the same distinction SLICE 18-0 was built on, and it is not
 * academic. SLICE 16 and 17 both had correct rules and green unit tests, and
 * both were unreachable in production because the rule was wired to a screen
 * the goods never passed through. A rule nobody can invoke is indistinguishable
 * from no rule at all.
 *
 * So these read the SOURCE of each hop and assert the wiring exists. A mock
 * would prove my test double works, not that the system does.
 *
 * THE SPECIFIC DEFECT BEING GUARDED AGAINST
 *
 * Every one of the four flags exists in TWO places:
 *   - menu_items      — what the register enforces from (live-menu.ts:94-100)
 *   - inventory_lots  — provenance written by the 18-0 receiving door
 *
 * The Cultivera importer writes NEITHER onto the lot (import-service.ts) and
 * fact review writes ONLY the menu row. So:
 *   - a worklist reading the LOT columns lists settled products forever
 *   - an editor writing ONLY the lot row is a silent no-op at the till
 *
 * Both mistakes are invisible from the screen. Only a test can hold them shut.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildClassificationWorklist,
  filterWorklist,
  parseWorklistFilter,
  classificationWorklistHref,
  summarizeWorklist,
  type WorklistLotInput,
} from "@/lib/inventory/classification-worklist-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FLAGS = ["low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package"] as const;

const WORKLIST_STORE = "src/lib/inventory/classification-worklist-store.ts";
const STATUS_STORE = "src/lib/inventory/classification-status-store.ts";
const ACTIONS = "src/app/admin/inventory/actions.ts";
const DETAIL_PAGE = "src/app/admin/inventory/[id]/page.tsx";
const WORKLIST_PAGE = "src/app/admin/compliance/classification/page.tsx";

/**
 * Pull the column list out of a `.select("...")` call so assertions can test
 * the ACTUAL columns rather than "does this string appear somewhere in the
 * file". Mutation testing on SLICE 18-0 proved the difference matters: an
 * assertion that searched the whole function passed even with the column
 * deleted, because it was matching the explanatory comment instead.
 */
/**
 * Strip comments so an assertion can be made about CODE rather than prose.
 *
 * Needed because the most natural way to document "this page deliberately does
 * NOT re-derive status" is to write the forbidden expression in a comment
 * explaining its absence — which then trips a naive source grep. Handles
 * block comments, JSX `{/* ... *\/}` blocks and line comments.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function selectColumns(src: string, afterMarker: string): string[] {
  const idx = src.indexOf(afterMarker);
  expect(idx, `marker not found: ${afterMarker}`).toBeGreaterThan(-1);
  const m = src.slice(idx).match(/\.select\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/);
  expect(m, `no .select("...") found after ${afterMarker}`).not.toBeNull();
  return m![1].split(",").map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// HOP 1 — the worklist reads the ENFORCING surface, not the lot row
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 1: status comes from menu truth", () => {
  const store = read(WORKLIST_STORE);
  const statusStore = read(STATUS_STORE);

  it("the worklist assembler asks the menu store for the flags", () => {
    expect(store).toContain("getMenuClassificationFlags");
    // ...and feeds them into the pure builder, rather than reading them and
    // then quietly deriving status from something else.
    expect(store).toMatch(/buildClassificationWorklist\(\s*inputs\s*,\s*flags\s*\)/);
  });

  it("the menu store reads all four flags off menu_items", () => {
    const cols = selectColumns(statusStore, "from(\"menu_items\")");
    for (const f of FLAGS) expect(cols).toContain(f);
    // The join key must come back too, or the rows cannot be attributed.
    expect(cols).toContain("source_item_id");
  });

  it("the worklist's own lot read does NOT select the four flag columns", () => {
    // This is the load-bearing one. If a future edit adds these columns to the
    // lot query, the very next step is to start using them — and that silently
    // recreates the "nag about settled work" defect, because the Cultivera
    // importer never writes them.
    const cols = selectColumns(store, "from(\"inventory_lots\")");
    for (const f of FLAGS) expect(cols).not.toContain(f);
  });

  it("the menu store reads the PUBLISHED version, not a staged one", () => {
    // A staged answer is not yet in force at the register. Reporting it as the
    // truth would tell the owner a product is classified while the till still
    // isn't enforcing it.
    expect(statusStore).toContain("getPublishedVersion");
  });
});

// ---------------------------------------------------------------------------
// HOP 2 — the read is COMPLETE, or it says so
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 2: the scan cannot silently under-report", () => {
  const store = read(WORKLIST_STORE);
  const page = read(WORKLIST_PAGE);

  it("pages the lot read with a completeness verdict", () => {
    // PostgREST truncates at 1,000 rows silently and listLots() caps at 500.
    // On a ~3,800-lot catalog an unpaged read prints a confident, wrong zero.
    expect(store).toContain("pagedAllChecked");
    expect(store).toMatch(/\.range\(from,\s*to\)/);
  });

  it("orders the paged read by a UNIQUE column so pages partition", () => {
    // An unstable order can repeat or skip rows between pages. A skipped
    // product simply never appears, and nothing looks wrong.
    expect(store).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it("propagates the verdict instead of assuming success", () => {
    expect(store).toContain("lotPage.verdict.complete");
    // And an unconfigured environment is reported as "we could not look",
    // never as an all-clear.
    expect(store).toMatch(/configured:\s*false/);
  });

  it("the page DISCLOSES an incomplete scan above the numbers", () => {
    expect(page).toContain("!data.complete");
    expect(page).toMatch(/do not read it as an all-clear/i);
  });
});

// ---------------------------------------------------------------------------
// HOP 3 — the editor writes the surface that ENFORCES
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 3: an edit reaches the register", () => {
  const actions = read(ACTIONS);

  it("the edit action writes through to the menu", () => {
    expect(actions).toContain("updateLotComplianceClassificationAction");
    expect(actions).toContain("applyClassificationToMenu");
  });

  it("the menu write happens BEFORE the lot write, and failure aborts", () => {
    const menuAt = actions.indexOf("applyClassificationToMenu");
    const lotAt = actions.indexOf("lotWriteError");
    expect(menuAt).toBeGreaterThan(-1);
    expect(lotAt).toBeGreaterThan(-1);
    // Order matters: the enforcement write is the one that must succeed. If
    // the provenance write went first and the menu write then failed, the lot
    // row would claim an answer the register has never seen.
    expect(menuAt).toBeLessThan(lotAt);
  });

  it("re-derives the category server-side rather than trusting the form", () => {
    // The form is client-controlled. Scope must be decided from stored facts,
    // or a hand-crafted POST could answer a question for a product that was
    // never in scope.
    expect(actions).toContain("resolveWebsiteCategoryForLot");
    expect(actions).toContain("assessReceivingClassification");
    expect(actions).toContain("validateReceivingClassificationChoice");
  });

  it("records an audit entry for the edit", () => {
    expect(actions).toContain("inventory_lot.compliance_classification_edited");
  });

  it("writes all four columns every time, so no stale value survives", () => {
    const store = read(STATUS_STORE);
    for (const f of FLAGS) expect(store).toContain(f);
    // Documented intent: a partial update would leave an orphaned unit_thc_mg
    // behind after somebody answers "no, not low-THC".
    expect(store).toMatch(/all four|every time|including null/i);
  });
});

// ---------------------------------------------------------------------------
// HOP 4 — the deep link actually lands on the editor
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 4: the worklist hands off to a real editor", () => {
  const page = read(WORKLIST_PAGE);
  const detail = read(DETAIL_PAGE);

  it("links to the lot detail page at the classification anchor", () => {
    expect(page).toContain("/admin/inventory/${row.representativeLotId}#classification");
  });

  it("the detail page actually HAS that anchor", () => {
    // A "Fix →" button that lands nowhere useful is how a worklist stops being
    // used (the SLICE 6A lesson, restated).
    expect(detail).toContain('id="classification"');
  });

  it("the detail page renders the editor form and its action", () => {
    expect(detail).toContain("updateLotComplianceClassificationAction");
    expect(detail).toContain("Sales-limit classification");
  });

  it("the editor is only rendered when the product is in scope", () => {
    expect(detail).toContain("complianceStatus.inScope");
  });
});

// ---------------------------------------------------------------------------
// HOP 5 — the list is SOURCE-AGNOSTIC (the brief's one factual correction)
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 5: no door is invisible to the list", () => {
  const store = read(WORKLIST_STORE);

  it("the lot query is not filtered to imported manifests", () => {
    // The whole worklist would be Cultivera-only if this filter leaked into
    // the lot read. It belongs on the manifest lookup that powers the optional
    // source TAB, and nowhere else.
    const idx = store.indexOf('from("inventory_lots")');
    const lotQuery = store.slice(idx, idx + 600);
    expect(lotQuery).not.toContain("POS-IMPORT");
    expect(lotQuery).not.toContain("manifest_number");
  });

  it("scopes the lot read to ACTIVE lots only", () => {
    // Identical to every SLICE 7 gap: a destroyed lot cannot break a limit,
    // and listing it buries the rows that still matter.
    const idx = store.indexOf('from("inventory_lots")');
    expect(store.slice(idx, idx + 600)).toMatch(/\.eq\("status",\s*"active"\)/);
  });

  it("the import prefix is used only to classify the SOURCE, not the scope", () => {
    // Verified against import-service.ts, which stamps the migration manifest
    // `POS-IMPORT-${importId.slice(0, 8)}`.
    expect(store).toContain("POS-IMPORT-");
    expect(store).toContain("IMPORT_MANIFEST_PREFIX");
    const importSvc = read("src/lib/pos/import-service.ts");
    expect(importSvc).toContain("POS-IMPORT-");
  });

  it("a manifest read failure degrades the tab, never the list", () => {
    expect(store).toMatch(/manifest read failed/);
  });

  // Behavioural counterpart to the source-reading assertions above: prove a
  // received-door product is actually visible in the default view.
  it("a received product appears under the default filter", () => {
    const lots: WorklistLotInput[] = [
      {
        lotId: "recv-1",
        posProductKey: "pos-recv",
        productName: "Rectal Suppository 6ct",
        inventoryType: "Marijuana Mix Infused",
        resolvedWebsiteCategory: "topical",
        vendorName: null,
        onHandQty: 4,
        fromImport: false,
      },
    ];
    const entries = buildClassificationWorklist(lots, new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0].status.inScope).toBe(true);
    const shown = filterWorklist(entries, parseWorklistFilter({}));
    expect(shown).toHaveLength(1);
    expect(shown[0].posProductKey).toBe("pos-recv");
  });
});

// ---------------------------------------------------------------------------
// HOP 6 — the page and the core cannot drift apart
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 6: counts, filters and links share one definition", () => {
  const page = read(WORKLIST_PAGE);

  it("the page derives rows, counts and hrefs from the pure core", () => {
    // The SLICE 6A defect was a count computed one way and a filter computed
    // another. Every one of these must come from the same module.
    for (const fn of [
      "filterWorklist",
      "summarizeWorklist",
      "classificationWorklistHref",
      "parseWorklistFilter",
    ]) {
      expect(page).toContain(fn);
    }
  });

  it("never hand-rolls its own status predicate", () => {
    // A local `reasons.length === 0` on the page would be a second definition
    // of "settled", free to drift from the core's.
    //
    // STRENGTHENED: this must assert on CODE, not on prose. The first version
    // searched the raw file and matched the very comment explaining why the
    // predicate isn't there — a test that fails on a correct file and would
    // equally pass on a wrong one whose comment happened to be worded
    // differently. That is exactly the false-positive class mutation testing
    // caught in SLICE 18-0 (mutant #15), so comments are stripped first and
    // the assertion is made against executable source only.
    const code = stripComments(page);
    expect(code).not.toMatch(/reasons\.length\s*===\s*0/);
    expect(code).not.toMatch(/otherwiseTaken\s*==\s*null/);
    // Guard the guard: stripping must not have eaten the file. If a future
    // regex change silently returned "", every assertion above would pass
    // vacuously.
    expect(code).toContain("filterWorklist");
    expect(code.length).toBeGreaterThan(page.length / 3);
  });

  it("the summary follows the source filter it is given", () => {
    expect(page).toContain("summarizeWorklist(data.entries, filter.source)");
  });

  it("every filter href carries BOTH knobs", () => {
    // Bookmarked and pasted links must state their whole intent.
    for (const scope of ["needs_attention", "urgent", "settled", "all"] as const) {
      for (const source of ["all", "import", "received"] as const) {
        const href = classificationWorklistHref({ scope, source });
        expect(href).toContain(`scope=${scope}`);
        expect(href).toContain(`source=${source}`);
      }
    }
  });

  it("the counts on screen sum to the in-scope total", () => {
    // A panel whose parts don't sum to its whole is a panel people stop
    // believing. Exercised for real rather than read from source.
    const lots: WorklistLotInput[] = [
      {
        lotId: "a", posProductKey: "k-urgent", productName: "Supp A",
        inventoryType: "Marijuana Mix Infused", resolvedWebsiteCategory: "topical",
        vendorName: null, onHandQty: 1, fromImport: true,
      },
      {
        lotId: "b", posProductKey: "k-liquid", productName: "Seltzer B",
        inventoryType: "Liquid Marijuana Infused Edible", resolvedWebsiteCategory: "edible-liquid",
        vendorName: null, onHandQty: 2, fromImport: true,
      },
      {
        lotId: "c", posProductKey: "k-flower", productName: "Blue Dream",
        inventoryType: "Usable Marijuana", resolvedWebsiteCategory: "flower",
        vendorName: null, onHandQty: 3, fromImport: true,
      },
    ];
    const entries = buildClassificationWorklist(
      lots,
      new Map([["k-liquid", { otherwiseTaken: false, unitsPerPackage: null, lowThcLiquid: false, unitThcMg: null }]]),
    );
    const sum = summarizeWorklist(entries);
    expect(sum.urgent + sum.unconfirmed + sum.settled).toBe(sum.inScope);
    // The flower lot is real inventory but carries no classification question,
    // so it must not pad the compliance tallies.
    expect(sum.inScope).toBe(2);
    expect(sum.settled).toBe(1);
    expect(sum.urgent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HOP 7 — the page is reachable and correctly gated
// ---------------------------------------------------------------------------
describe("SLICE 18A — hop 7: reachable, and gated to people who can act", () => {
  it("is registered in the admin navigation", () => {
    const nav = read("src/components/admin/admin-nav-data.ts");
    expect(nav).toContain("/admin/compliance/classification");
  });

  it("the nav gate and the page require the SAME permission", () => {
    // Listing work the reader cannot action is a dead end; conversely a page
    // gated looser than its nav entry is an accidental hole.
    const nav = read("src/components/admin/admin-nav-data.ts");
    const navLine = nav
      .split("\n")
      .find((l) => l.includes("/admin/compliance/classification"));
    expect(navLine).toBeDefined();
    expect(navLine!).toContain('permission: "inventory.manage"');
    expect(read(WORKLIST_PAGE)).toContain('requirePermission("inventory.manage")');
  });

  it("both 18A cores are registered in the pure self-test sweep", () => {
    // A self-test nobody runs is a comment.
    const sweep = read("scripts/compliance/run-pure-selftests.ts");
    expect(sweep).toContain("__runClassificationStatusTests");
    expect(sweep).toContain("__runClassificationWorklistTests");
    // ...and the sweep must reject a core that silently ran zero assertions.
    expect(sweep).toMatch(/classification-worklist-core: no assertions ran/);
  });
});
