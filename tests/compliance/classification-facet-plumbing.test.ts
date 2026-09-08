/**
 * SLICE 18B — PLUMBING.
 *
 * The core tests prove the facet's LOGIC. These prove it is actually WIRED —
 * that it follows every hop the existing DOH facet follows, so it behaves like
 * a native filter rather than something bolted on.
 *
 * Michael: "I want this to be additive and not something new... Make sure the
 * back office is also properly connected so it behaves dynamically like all
 * the other filters do."
 *
 * A logic-only test suite would happily stay green while the checkbox was
 * missing from the sidebar, the selection vanished on the back button, or the
 * shop page dropped the URL param. Each hop below is a place a real shopper
 * would notice a break.
 *
 * TECHNIQUE NOTE — comments are stripped before asserting. A source-reading
 * test that matches its own explanatory prose is a false positive (this bit us
 * in SLICE 18-0 mutant #15 and again in 18A). Every assertion below runs
 * against CODE ONLY, and each block carries an anti-vacuity guard so the
 * stripper failing open cannot silently pass the suite.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Remove block comments, line comments and JSX comments so assertions can only
 * match real code. Deliberately conservative: it does not try to respect string
 * literals containing "//" because none of the asserted tokens live in one.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // {/* jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/^\s*\/\/.*$/gm, " "); // // line
}

const BROWSER = "src/components/menu/InteractiveMenuBrowser.tsx";
const SIDEBAR = "src/components/menu/FilterMobile.tsx";
const CORE = "src/lib/menu/menu-classification-filter-core.ts";
const SEARCH_CORE = "src/lib/pos/classification-search-core.ts";
const SALE_FLOW = "src/lib/pos/sale-flow-core.ts";
const ADMIN_WORKLIST = "src/app/admin/compliance/classification/page.tsx";
const WORKLIST_CORE = "src/lib/inventory/classification-worklist-core.ts";
const SELFTESTS = "scripts/compliance/run-pure-selftests.ts";

/** Assert the stripper actually produced usable code, not an empty string. */
function guardStripped(code: string, original: string, mustContain: string) {
  expect(code).toContain(mustContain);
  expect(code.length).toBeGreaterThan(original.length / 3);
}

describe("18B plumbing — hop 1: the shop page resolves the URL param", () => {
  /**
   * SLICE H CHANGED THE MECHANISM, NOT THE PROMISE.
   *
   * `/menu` used to read `searchParams` on the server and forward all sixteen
   * facets to the browser. `searchParams` is a request-time API, so that single
   * read made the busiest page on the site permanently uncacheable
   * (`x-vercel-cache: MISS` on every hit, ~1.3s of server time per visitor).
   * Slice H removed it, which is what finally lets `/menu` be prerendered.
   *
   * The promise 18B made still stands: land on a shared `?classification=` or
   * `?doh=` link and the correct lane must already be selected. It is now kept
   * by `resolveInitialParams`, which reads `window.location.search` in a
   * `useState` LAZY INITIALIZER -- so the lane is applied during the very first
   * client render, before paint, not in a post-mount effect that would flash
   * the unfiltered grid.
   *
   * Deleting these tests because the code moved would have thrown away the
   * guard on a real, previously-shipped bug. So they follow the mechanism.
   */
  const original = read(BROWSER);
  const code = stripComments(original);

  it("/menu resolves ?classification= from the live URL before first paint", () => {
    guardStripped(code, original, "resolveInitialParams");

    // The resolver must read the address bar...
    const resolver = code.slice(
      code.indexOf("function resolveInitialParams"),
      code.indexOf("type InteractiveMenuBrowserProps"),
    );
    expect(resolver).toContain("window.location.search");
    // ...include the classification facet...
    expect(resolver).toMatch(/classification:\s*pick\("classification"\)/);
    // ...and the live URL must WIN over whatever the server rendered, or a
    // cached page would pin every visitor to the first shopper's filters.
    expect(resolver).toMatch(/if \(liveValue !== null && liveValue !== ""\) return liveValue;/);

    // It must run in a LAZY INITIALIZER (first render), not an effect. An
    // effect would paint the unfiltered grid first -- the exact 18B bug.
    expect(code).toMatch(/useState\(\(\)\s*=>\s*resolveInitialParams\(/);
    // And the resolved value must actually drive the lane's initial state.
    expect(code).toMatch(
      /const persistedClassification = \(initialParams\.classification \?\? ""\)/,
    );
    expect(code).toMatch(
      /useState<string \| null>\(\s*persistedClassification,?\s*\)/,
    );
  });

  it("/menu also resolves ?doh= (the pre-existing facet it mirrors)", () => {
    // 18B fixed a real gap here: `doh` was read on the client from
    // window.location but never forwarded from the server, so a shared DOH link
    // flashed the unfiltered grid on first paint. Pinning it stops a future
    // edit from silently reintroducing that asymmetry.
    const resolver = code.slice(
      code.indexOf("function resolveInitialParams"),
      code.indexOf("type InteractiveMenuBrowserProps"),
    );
    expect(resolver).toMatch(/doh:\s*pick\("doh"\)/);
    expect(code).toMatch(/const persistedDoh = \(initialParams\.doh \?\? ""\)/);
    expect(code).toMatch(/useState<string \| null>\(persistedDoh\)/);
  });

  it("SLICE H: the resolver covers every facet the URL-writer can write", () => {
    // The strongest form of this guard. Rather than pinning two facets by name,
    // derive the full set the component writes into the URL and require the
    // resolver to read back every one of them. Add a new filter that writes to
    // the URL but forget to resolve it, and a shared link silently drops it --
    // this fails. Now that the server forwards nothing, the resolver IS the
    // only mechanism, so it must be complete rather than merely present.
    const between = (start: string, end: string) => {
      const i = code.indexOf(start);
      expect(i, `missing anchor: ${start}`).toBeGreaterThan(-1);
      const j = code.indexOf(end, i);
      expect(j, `missing anchor: ${end}`).toBeGreaterThan(-1);
      return code.slice(i, j);
    };

    const writer = between("const params = new URLSearchParams();", "const queryString");
    const written = [...writer.matchAll(/params\.set\("([a-zA-Z]+)"/g)].map((m) => m[1]!);
    expect(written.length).toBeGreaterThanOrEqual(13); // anti-vacuity

    const resolver = between("function resolveInitialParams", "type InteractiveMenuBrowserProps");
    const resolved = new Set(
      [...resolver.matchAll(/([a-zA-Z]+):\s*pick\("([a-zA-Z]+)"\)/g)].map((m) => m[2]!),
    );

    for (const key of written) {
      expect(resolved.has(key), `resolveInitialParams never reads ?${key}=`).toBe(true);
    }

    // popstate (browser back/forward) must restore the same complete set.
    const sync = between("const syncFromUrl = () =>", 'window.addEventListener("popstate"');
    for (const key of written) {
      expect(sync.includes(`"${key}"`), `syncFromUrl never restores ?${key}=`).toBe(true);
    }
  });
});

describe("18B plumbing — hops 2-5: the browser derives, hydrates and applies", () => {
  const original = read(BROWSER);
  const code = stripComments(original);

  it("imports the shared pure core (never re-implements matching)", () => {
    guardStripped(code, original, "InteractiveMenuBrowser");
    expect(code).toContain("resolveClassificationFilterOptions");
    expect(code).toContain("itemMatchesClassificationFilter");
    expect(code).toContain("findClassificationFilterOption");
    expect(code).toContain("@/lib/menu/menu-classification-filter-core");
  });

  it("derives the lanes from the LIVE items (so the facet is dynamic)", () => {
    expect(code).toMatch(
      /classificationOptions\s*=\s*useMemo\(\s*\(\)\s*=>\s*resolveClassificationFilterOptions\(items\)/,
    );
  });

  it("hydrates the active lane from the persisted param", () => {
    expect(code).toMatch(/persistedClassification\s*=\s*\(initialParams\.classification\s*\?\?\s*""\)/);
    expect(code).toMatch(/useState<string \| null>\(\s*persistedClassification,?\s*\)/);
  });

  it("applies the filter to the product pool via the shared matcher", () => {
    expect(code).toMatch(
      /pool\s*=\s*pool\.filter\(\(item\)\s*=>\s*itemMatchesClassificationFilter\(item,\s*activeClassificationId\)\)/,
    );
  });

  it("the filter memo depends on the active lane (or the grid would go stale)", () => {
    // Find the dependency array of the filteredItems memo and assert the new
    // state is listed. Without this, selecting a lane would not re-render.
    const memo = code.slice(code.indexOf("const filteredItems"));
    const depsStart = memo.indexOf("}, [");
    expect(depsStart).toBeGreaterThan(-1);
    const deps = memo.slice(depsStart, memo.indexOf("]", depsStart));
    expect(deps).toContain("activeClassificationId");
  });
});

describe("18B plumbing — hops 6-8: URL persistence, back button, reset", () => {
  const original = read(BROWSER);
  const code = stripComments(original);

  it("writes the lane back to the URL so it is shareable", () => {
    guardStripped(code, original, "replaceState");
    expect(code).toMatch(
      /if\s*\(activeClassificationId\)\s*params\.set\("classification",\s*activeClassificationId\)/,
    );
  });

  it("the URL-writing effect depends on the lane", () => {
    const effect = code.slice(code.indexOf('params.set("classification"'));
    const deps = effect.slice(effect.indexOf("}, ["), effect.indexOf("]", effect.indexOf("}, [")));
    expect(deps).toContain("activeClassificationId");
  });

  it("restores the lane on browser back/forward (popstate)", () => {
    const sync = code.slice(code.indexOf("const syncFromUrl"));
    expect(sync).toMatch(
      /setActiveClassificationId\(\(params\.get\("classification"\)\s*\?\?\s*""\)\.trim\(\)\s*\|\|\s*null\)/,
    );
  });

  it("Reset clears the lane along with every other filter", () => {
    const reset = code.slice(code.indexOf("const resetFilters"));
    const body = reset.slice(0, reset.indexOf("};"));
    expect(body).toContain("setActiveClassificationId(null)");
  });

  it("selecting a lane counts as an active filter", () => {
    // hasOtherFiltersActive drives whether the accessory/merch collections are
    // surfaced. Omitting the new facet would show unrelated merch below a
    // filtered grid.
    const block = code.slice(code.indexOf("const hasOtherFiltersActive"));
    const body = block.slice(0, block.indexOf(";"));
    expect(body).toContain("activeClassificationId !== null");
  });
});

describe("18B plumbing — hops 9-10: removable pill + one-at-a-time toggle", () => {
  const original = read(BROWSER);
  const code = stripComments(original);

  it("the active lane renders as a removable filter pill", () => {
    guardStripped(code, original, "activeFilterTags");
    expect(code).toContain("activeClassificationOption");
    expect(code).toMatch(/key:\s*`classification-\$\{activeClassificationOption\.id\}`/);
    expect(code).toMatch(/onRemove:\s*\(\)\s*=>\s*setActiveClassificationId\(null\)/);
  });

  it("the toggle is mutually exclusive (clicking the active lane clears it)", () => {
    const toggle = code.slice(code.indexOf("const toggleClassification"));
    const body = toggle.slice(0, toggle.indexOf("};"));
    expect(body).toMatch(/current === id \? null : id/);
  });

  it("passes the facet down to the sidebar", () => {
    expect(code).toContain("classificationOptions={classificationOptions}");
    expect(code).toContain("activeClassificationId={activeClassificationId}");
    expect(code).toContain("onClassificationToggle={toggleClassification}");
  });
});

describe("18B plumbing — hops 11-13: the sidebar renders, and only when it should", () => {
  const original = read(SIDEBAR);
  const code = stripComments(original);

  it("the section is gated on BOTH a handler and a non-empty option list", () => {
    guardStripped(code, original, "FilterSection");
    // This is the dynamic contract: no products with the trait ⇒ no section.
    expect(code).toMatch(
      /classificationEnabled\s*=\s*Boolean\(onClassificationToggle\)\s*&&\s*classificationOptions\.length\s*>\s*0/,
    );
    expect(code).toMatch(/\{classificationEnabled \? \(/);
    // ...and the section is conditionally closed, never rendered unconditionally.
    expect(code).toMatch(/\) : null\}/);
  });

  it("renders one checkbox per lane, with its label and count", () => {
    const section = code.slice(code.indexOf("classificationEnabled ? ("));
    expect(section).toContain("classificationOptions.map");
    expect(section).toContain("{option.label}");
    expect(section).toContain("{option.count}");
    expect(section).toMatch(/onChange=\{\(\)\s*=>\s*onClassificationToggle\?\.\(option\.id\)\}/);
    expect(section).toMatch(/checked=\{active\}/);
  });

  it("the checkbox group is named so it is a real form control", () => {
    const section = code.slice(code.indexOf("classificationEnabled ? ("));
    expect(section).toMatch(/name="classification"/);
  });

  it("accepts the facet as optional props defaulting to empty (back-compatible)", () => {
    expect(code).toMatch(/classificationOptions\?:\s*ClassificationFilterOption\[\]/);
    expect(code).toMatch(/classificationOptions\s*=\s*\[\]/);
    expect(code).toMatch(/activeClassificationId\s*=\s*null/);
  });
});

describe("18B plumbing — the budtender path at the register", () => {
  it("searchProducts folds in the classification keywords", () => {
    const original = read(SALE_FLOW);
    const code = stripComments(original);
    guardStripped(code, original, "export function searchProducts");
    expect(code).toContain("classificationSearchText");
    // The keywords must be part of the haystack the tokens are tested against.
    const fn = code.slice(code.indexOf("export function searchProducts"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("classificationSearchText(p)");
    expect(body).toMatch(/const hay = /);
    expect(body).toContain("tokens.every");
  });

  it("an ordinary product's keywords are empty, so existing search is unchanged", async () => {
    const { classificationSearchText, classificationSearchKeywords } = await import(
      "@/lib/pos/classification-search-core"
    );
    expect(classificationSearchText({ category: "flower" })).toBe("");
    expect(classificationSearchKeywords({ category: "flower" })).toHaveLength(0);
    // Not classified, merely a liquid: still nothing.
    expect(classificationSearchText({ category: "edible-liquid" })).toBe("");
  });

  it("a budtender can find a suppository whose NAME never says so", async () => {
    const { searchProducts } = await import("@/lib/pos/sale-flow-core");
    const base = {
      productId: "p",
      name: "Midnight Relief",
      brand: "Acme",
      categories: ["topical"],
      variantLabel: "6ct",
      regularPriceMinor: 4000,
      costMinorUnits: null,
      inventoryStatus: "in-stock" as const,
    };
    const suppository = {
      ...base,
      variantId: "s",
      category: "topical",
      otherwiseTaken: true,
      unitsPerPackage: 6,
    };
    const lotion = { ...base, variantId: "l", name: "Midnight Lotion", category: "topical" };

    expect(searchProducts([suppository, lotion], "suppository").map((p) => p.variantId)).toEqual(["s"]);
    // The pre-existing name search still works and is NOT widened.
    expect(searchProducts([suppository, lotion], "lotion").map((p) => p.variantId)).toEqual(["l"]);
    // "midnight" still matches both — no regression in ordinary behavior.
    expect(searchProducts([suppository, lotion], "midnight")).toHaveLength(2);
  });

  it("a budtender can find low-THC drinks by typing 'low thc' (multi-token)", async () => {
    const { searchProducts } = await import("@/lib/pos/sale-flow-core");
    const base = {
      productId: "p",
      brand: "Acme",
      categories: ["edible-liquid"],
      variantLabel: "12oz",
      regularPriceMinor: 800,
      costMinorUnits: null,
      inventoryStatus: "in-stock" as const,
    };
    const drink = {
      ...base,
      variantId: "d",
      name: "Sparkling Citrus",
      category: "edible-liquid",
      lowThcLiquid: true,
      unitThcMg: 4,
    };
    // Flagged but 9 mg: the register would NOT route it to the low-THC bucket,
    // so it must not answer to the low-THC search either.
    const strong = {
      ...base,
      variantId: "x",
      name: "Sparkling Punch",
      category: "edible-liquid",
      lowThcLiquid: true,
      unitThcMg: 9,
    };

    expect(searchProducts([drink, strong], "low thc").map((p) => p.variantId)).toEqual(["d"]);
    expect(searchProducts([drink, strong], "beverage").map((p) => p.variantId)).toEqual(["d"]);
    // Both are still findable by their real names.
    expect(searchProducts([drink, strong], "sparkling")).toHaveLength(2);
  });
});

describe("18B plumbing — the back office is connected to the shop", () => {
  it("the worklist entry carries the customer-facing lane", () => {
    const original = read(WORKLIST_CORE);
    const code = stripComments(original);
    guardStripped(code, original, "buildClassificationWorklist");
    expect(code).toContain("shopLane");
    // Computed with the SHARED resolver, not a local re-implementation.
    expect(code).toContain("classificationKindForItem");
    expect(code).toContain("@/lib/menu/menu-classification-filter-core");
  });

  /**
   * The text assertions above are necessary but NOT sufficient, and mutation
   * run #1 proved it: a mutant that hard-coded `shopLane: null` while leaving
   * the identifiers in place SURVIVED both this file and the fast self-test
   * runner. Reading the source can only prove a name is present; it cannot
   * prove the value is right.
   *
   * So the real guard is behavioural — build a worklist and assert the lane
   * that comes out is the lane a CUSTOMER would actually see. This is the
   * back-office/shop feedback loop Michael asked for, tested end to end.
   */
  it("the worklist reports the SAME lane the shop would show (behavioural)", async () => {
    const { buildClassificationWorklist } = await import(
      "@/lib/inventory/classification-worklist-core"
    );
    const { itemHasClassification, classificationShopHref } = await import(
      "@/lib/menu/menu-classification-filter-core"
    );

    // Typed against the real WorklistLotInput contract (lotId, vendorName,
    // onHandQty and fromImport are required) so `tsc --noEmit` guards this
    // fixture the same way it guards production code.
    type LotInput = Parameters<typeof buildClassificationWorklist>[0][number];
    const lot = (posProductKey: string, resolvedWebsiteCategory: string): LotInput => ({
      lotId: `lot-${posProductKey}`,
      posProductKey,
      productName: `test ${posProductKey}`,
      inventoryType: "Marijuana Mix Package",
      resolvedWebsiteCategory,
      vendorName: "Test Vendor",
      onHandQty: 5,
      fromImport: false,
    });

    // A qualifying drink, an over-dosed drink, a suppository, and an
    // unreviewed product: the four states staff actually encounter.
    const cases = [
      {
        key: "k-drink",
        category: "edible-liquid",
        facts: { otherwiseTaken: false, unitsPerPackage: null, lowThcLiquid: true, unitThcMg: 4 },
        expected: "low_thc_liquid" as const,
      },
      {
        key: "k-over",
        category: "edible-liquid",
        facts: { otherwiseTaken: false, unitsPerPackage: null, lowThcLiquid: true, unitThcMg: 9 },
        expected: null,
      },
      {
        key: "k-supp",
        category: "topical",
        facts: { otherwiseTaken: true, unitsPerPackage: 10, lowThcLiquid: false, unitThcMg: null },
        expected: "otherwise_taken" as const,
      },
      {
        key: "k-unknown",
        category: "edible-liquid",
        facts: { otherwiseTaken: null, unitsPerPackage: null, lowThcLiquid: null, unitThcMg: null },
        expected: null,
      },
    ];

    // Anti-vacuity: at least one case must produce a real lane, or an
    // always-null implementation would pass by matching the null expectations.
    expect(cases.some((c) => c.expected !== null)).toBe(true);

    for (const c of cases) {
      const rows = buildClassificationWorklist(
        [lot(c.key, c.category)],
        new Map([[c.key, c.facts]]),
      );
      expect(rows).toHaveLength(1);
      expect(
        rows[0].shopLane,
        `${c.key} (${c.category}) should report shopLane ${String(c.expected)}`,
      ).toBe(c.expected);

      // AND it must agree with the shop's own matcher for the same facts —
      // one definition of truth across the till, the shop and the back office.
      const asMenuItem = { category: c.category, ...c.facts };
      for (const kind of ["low_thc_liquid", "otherwise_taken"] as const) {
        if (c.expected === kind) {
          expect(
            itemHasClassification(
              asMenuItem as Parameters<typeof itemHasClassification>[0],
              kind,
            ),
            `${c.key}: back office says ${kind} but the shop matcher disagrees`,
          ).toBe(true);
        }
      }

      // The admin link must resolve to a real, filterable shop URL.
      if (rows[0].shopLane) {
        expect(classificationShopHref(rows[0].shopLane)).toContain("classification=");
      }
    }
  });

  it("the worklist page links to the live shop lane using the shared href builder", () => {
    const original = read(ADMIN_WORKLIST);
    const code = stripComments(original);
    guardStripped(code, original, "ClassificationWorklist");
    expect(code).toContain("classificationShopHref");
    expect(code).toContain("CLASSIFICATION_FILTER_LABELS");
    expect(code).toContain("row.shopLane");
    // The admin must not hand-roll the customer URL.
    expect(code).not.toMatch(/href=\{?"\/menu\?classification=/);
  });

  it("the admin renders the honest empty state when a product is in no lane", () => {
    const code = stripComments(read(ADMIN_WORKLIST));
    const cell = code.slice(code.indexOf("row.shopLane"));
    expect(cell).toContain("not in a filter lane");
  });
});

describe("18B plumbing — the cores are guarded by CI", () => {
  it("both 18B cores are registered in the pure self-test sweep", () => {
    const original = read(SELFTESTS);
    const code = stripComments(original);
    guardStripped(code, original, "ALL PURE SELF-TESTS PASSED");
    expect(code).toContain("__runMenuClassificationFilterTests");
    expect(code).toContain("__runPosClassificationSearchTests");
    // Each must have the zero-assertion guard, or an emptied core would "pass".
    expect(code).toMatch(/__runMenuClassificationFilterTests\(\);\s*if \(r\.passed < 1\)/);
    expect(code).toMatch(/__runPosClassificationSearchTests\(\);\s*if \(r\.passed < 1\)/);
  });

  /**
   * Both cores must stay importable from a "use client" component, a server
   * component, AND plain vitest/tsx. That is what lets the shop, the register
   * and CI share ONE matcher instead of three drifting copies.
   *
   * An earlier draft of this test asserted `expect(read(CORE)).not.toContain(
   * "server-only")` against the RAW file. That was a false-positive generator
   * in the exact way SLICE 18-0 mutant #15 warned about: the module's own
   * header comment explains *why* it avoids server-only, so the literal string
   * is present in the prose and the test failed on a correct file. Loosening it
   * to a comment-stripped `not.toContain` would have been weaker still, since a
   * real `import { createClient } from "@supabase/..."` could sneak in under
   * any spelling the blocklist did not anticipate.
   *
   * So this asserts the strictly stronger property: enumerate EVERY module the
   * core actually imports and require each one to be on a known-pure
   * allowlist. A blocklist can only catch impurity it was told about; an
   * allowlist fails closed on impurity nobody predicted.
   */
  const PURE_IMPORT_ALLOWLIST = new Set([
    "@/lib/leafly/types",
    "@/lib/compliance/sales-limits-core",
  ]);

  /** Every module specifier in `import ... from "x"` / bare / dynamic form. */
  function importSpecifiers(code: string): string[] {
    const found: string[] = [];
    const patterns = [
      /\bimport\s[\s\S]*?\bfrom\s*["']([^"']+)["']/g, // import x from "y"
      /\bimport\s*["']([^"']+)["']/g, // bare: import "y"
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic: import("y")
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("y")
    ];
    for (const re of patterns) {
      for (const m of code.matchAll(re)) found.push(m[1]);
    }
    return found;
  }

  for (const [label, path, anchor] of [
    ["the facet core", CORE, "resolveClassificationFilterOptions"],
    ["the search core", SEARCH_CORE, "classificationSearchKeywords"],
  ] as const) {
    it(`${label} imports ONLY known-pure modules (allowlist, fails closed)`, () => {
      const original = read(path);
      const code = stripComments(original);
      guardStripped(code, original, anchor);

      const specifiers = importSpecifiers(code);
      // Anti-vacuity: a core that imports nothing would trivially "pass" the
      // allowlist. Both cores are built ON the register's predicates, so if
      // this ever hits zero the module stopped sharing the source of truth.
      expect(specifiers.length).toBeGreaterThan(0);
      expect(specifiers).toContain("@/lib/compliance/sales-limits-core");

      for (const spec of specifiers) {
        expect(
          PURE_IMPORT_ALLOWLIST.has(spec),
          `${path} imports "${spec}", which is not on the pure allowlist. ` +
            `These cores must stay importable from client components, server ` +
            `components and vitest alike \u2014 add a genuinely pure module to ` +
            `PURE_IMPORT_ALLOWLIST only after confirming it pulls in no DB, ` +
            `no React and no server-only runtime.`,
        ).toBe(true);
      }
    });

    it(`${label} carries no server-only or client-only runtime directive`, () => {
      const code = stripComments(read(path));
      // Directives are string-expression statements on their own line. Match
      // that shape rather than the bare word, so explanatory identifiers and
      // (stripped) prose can never trip it.
      expect(code).not.toMatch(/^\s*["']server-only["']\s*;?\s*$/m);
      expect(code).not.toMatch(/^\s*["']use server["']\s*;?\s*$/m);
      expect(code).not.toMatch(/^\s*["']use client["']\s*;?\s*$/m);
      // No React: a pure core the server can call must not depend on the
      // renderer.
      expect(code).not.toMatch(/\bfrom\s*["']react["']/);
    });
  }

  it("18B introduced NO migration (the flags already ride on the menu item)", () => {
    // The whole claim that this slice is "additive, not a rebuild" rests on the
    // four columns already being selected onto the public item by SLICE 16/17.
    const liveMenu = stripComments(read("src/lib/pos/live-menu.ts"));
    expect(liveMenu).toMatch(/lowThcLiquid:\s*row\.low_thc_liquid/);
    expect(liveMenu).toMatch(/unitThcMg:\s*row\.unit_thc_mg/);
    expect(liveMenu).toMatch(/otherwiseTaken:\s*row\.otherwise_taken/);
    expect(liveMenu).toMatch(/unitsPerPackage:\s*row\.units_per_package/);
  });
});
