/**
 * tests/compliance/receiving-pipeline-plumbing.test.ts  (SLICE 18-0)
 *
 * THE PLUMBING TESTS.
 *
 * The gate tests prove the RULE is right. These prove the rule is actually
 * CONNECTED — that a human's answer survives every hop from the receiving dock
 * to the register, and that no stage quietly drops it.
 *
 * This distinction is the whole reason SLICE 18-0 exists. SLICE 16 and 17 both
 * had correct rules and correct unit tests, and both were nevertheless
 * unreachable for every product arriving after the Cultivera cutover, because
 * the rule was wired to a screen received goods can never reach. A rule nobody
 * can invoke is indistinguishable from no rule at all.
 *
 * So these tests read the SOURCE of each stage and assert the wiring exists.
 * That is deliberate: a mock would prove my test double works, not that the
 * pipeline does. Where a stage is pure it is exercised for real instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeIntakeForReview } from "@/lib/inventory/intake-review-core";
import type { ParsedManifest, ParsedLine } from "@/lib/inventory/intake-parser";
import { buildDraftInjectionPlan, type ApprovedDraftForInjection } from "@/lib/pos/draft-injection-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FLAGS = ["low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package"] as const;

// ---------------------------------------------------------------------------
// STAGE 1 — the parser shape
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 1: the parsed line carries the four flags", () => {
  const src = read("src/lib/inventory/intake-parser.ts");

  it("declares all four on ParsedLine", () => {
    for (const f of FLAGS) {
      expect(src).toMatch(new RegExp(`^\\s*${f}:`, "m"));
    }
  });

  it("never derives them from the manifest — a WA manifest has no such field", () => {
    // Every construction site must seed null. If somebody ever writes a name
    // regex that sets otherwise_taken at the door, this fails — and it should,
    // because that is the SLICE 16 servings-vs-units mistake all over again:
    // a guess that silently rescales a statutory limit.
    const assignments = src.match(/otherwise_taken:\s*[^,\n]+/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(a).toMatch(/otherwise_taken:\s*(null|boolean \| null)/);
    }
  });
});

// ---------------------------------------------------------------------------
// STAGE 2 — the receiving review warning (exercised for real; it is pure)
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 2: the dock warns about an unclassified suspect", () => {
  const line = (over: Partial<ParsedLine> = {}): ParsedLine => ({
    product_name: "Blue Dream 3.5g",
    lot_code: "LOT-1",
    pos_product_key: "PK-1",
    brand_name: "Acme",
    category: "Usable Marijuana",
    strain_name: "Blue Dream",
    strain_type: null,
    received_qty: 10,
    unit: "each",
    unit_cost_minor_units: 500,
    unit_weight: 3.5,
    unit_weight_uom: "g",
    is_sample: false,
    is_medical: false,
    inventory_type: "Usable Cannabis",
    expires_on: null,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    lab: {
      labtest_external_identifier: "LAB-1",
      lab_name: "Testing Co",
      tested_on: "2025-06-01",
      thc_pct: 20,
      cbd_pct: 1,
      thca_pct: null,
      cbda_pct: null,
      total_thc_pct: 22,
      total_cbd_pct: 1,
      total_cannabinoids_pct: 24,
      potency_json: { thc: 20 },
      terpenes_json: null,
      analytes_json: null,
      passed: true,
      coa_url: "https://files.example.com/coa.pdf",
      coa_release_date: null,
      coa_expire_date: null,
      raw: null,
    },
    warnings: [],
    raw: {},
    ...over,
  });

  // No `as ParsedManifest` cast here, deliberately. The cast this replaced was
  // hiding a missing required field (transfer_date), and a cast that hides a
  // missing field also hides the NEXT one — meaning the day ParsedManifest
  // grows a compliance-relevant property, this fixture would silently keep
  // compiling while testing a shape that no longer exists. Annotating the
  // return type instead keeps the compiler on our side.
  const manifest = (lines: ParsedLine[]): ParsedManifest => ({
    manifest_number: "M-1",
    vendor_label: "Acme Farms",
    vendor_license: "412345",
    transfer_date: "2026-01-15",
    source_format: "wcia",
    lines,
    warnings: [],
  });

  it("flags an unclassified suppository as a WARNING, never an error", () => {
    const s = summarizeIntakeForReview(manifest([line({ product_name: "Relief Suppositories 6ct" })]));
    expect(s.otherwiseTakenSuspectCount).toBe(1);
    const flag = s.flags.find((f) => /suppositor/i.test(f.message));
    expect(flag?.severity).toBe("warning");
    // A delivery must never be refused on a name regex. Evidence, not fact.
    expect(s.readyForReview).toBe(true);
  });

  it("stops nagging once a human has answered — either way", () => {
    for (const answered of [true, false]) {
      const s = summarizeIntakeForReview(
        manifest([line({ product_name: "Relief Suppositories 6ct", otherwise_taken: answered })]),
      );
      expect(s.otherwiseTakenSuspectCount).toBe(0);
    }
  });

  it("does not flag ordinary products", () => {
    expect(summarizeIntakeForReview(manifest([line()])).otherwiseTakenSuspectCount).toBe(0);
  });

  it("uses the ONE shared detector rather than a second copy of the regex", () => {
    // Two copies of a compliance regex is two things to keep in step, and the
    // one that drifts will be the one nobody is looking at.
    const src = read("src/lib/inventory/intake-review-core.ts");
    expect(src).toMatch(/import\s*\{\s*suspectsOtherwiseTaken\s*\}\s*from\s*"@\/lib\/compliance\/sales-limits-core"/);
    expect(src).not.toMatch(/suppositor\(\?:y\|ies\)/);
  });
});

// ---------------------------------------------------------------------------
// STAGE 3 — the lot insert
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 3: the lot row carries the flags", () => {
  const src = read("src/lib/inventory/intake-store.ts");

  it("writes all four onto inventory_lots", () => {
    // Before this slice, 0216/0217's inventory_lots columns were dead on every
    // received lot: the migration created them and nothing ever wrote them.
    for (const f of FLAGS) {
      expect(src).toMatch(new RegExp(`${f}:\\s*line\\.${f}`));
    }
  });
});

// ---------------------------------------------------------------------------
// STAGE 4 — the READ-BACK
//
// Stage 3 writes the answer down. Stage 4 is the hop that reads it back out
// for the review screen, and it is the easiest one in the whole pipeline to
// forget, because forgetting it breaks nothing loudly. The page still renders,
// the warning still fires — it just fires forever, on lots a human already
// classified. That is worse than a crash: a checklist that nags about settled
// work teaches staff to scroll past it, and the day a genuinely unclassified
// suppository shows up, the warning has already been trained into wallpaper.
//
// So the column has to be SELECTed, TYPED, and PASSED. Three separate places,
// each individually silent when omitted.
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 4: a human's answer survives the read-back", () => {
  const store = read("src/lib/inventory/intake-store.ts");
  const page = read("src/app/admin/inventory/intake/[id]/page.tsx");

  // Narrow to listManifestLots so a match somewhere else in this large file
  // cannot make the test pass by accident.
  const listFn = (() => {
    const start = store.indexOf("export async function listManifestLots");
    expect(start).toBeGreaterThan(-1);
    const end = store.indexOf("\nexport ", start + 1);
    return store.slice(start, end === -1 ? store.length : end);
  })();

  it("selects otherwise_taken from inventory_lots", () => {
    // The select is a hand-written column string, so an omission here is a
    // silent undefined at runtime rather than a compile error.
    //
    // STRENGTHENED after mutation testing: the obvious assertion — searching
    // the whole function for "otherwise_taken" — SURVIVED a mutant that
    // deleted the column from the select list, because the explanatory
    // comment above it and the row-type declaration below it both contain the
    // same word. The test was passing on prose. So we now parse out the
    // column string literal and check the actual column list.
    const columns = (() => {
      const m = listFn.match(/\.select\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/);
      expect(m, "could not find the select() column string").not.toBeNull();
      return (m![1]).split(",").map((c) => c.trim());
    })();

    expect(columns).toContain("otherwise_taken");
    // Sanity-check the parse itself: if the regex ever grabbed the wrong
    // string, these long-standing columns would vanish and we'd know the
    // test — not the source — is what broke.
    expect(columns).toContain("id");
    expect(columns).toContain("product_name");
  });

  it("declares otherwise_taken on the row type as NULLABLE", () => {
    // Nullable is the entire point: null means "nobody has been asked", which
    // is a different fact from false ("a person said no"). Typing it
    // `boolean` would force a collapse and re-create the bug.
    expect(listFn).toMatch(/otherwise_taken:\s*boolean\s*\|\s*null;/);
  });

  // The CALL site, not the import line. Anchoring on the bare identifier would
  // have matched `import { summarizeStagedIntake }` at the top of the file and
  // scanned 1600 characters of unrelated imports, so this pins the open paren.
  const mapBlock = (() => {
    const start = page.search(/summarizeStagedIntake\s*\(/);
    expect(start).toBeGreaterThan(-1);
    const block = page.slice(start, start + 2000);
    // Guard the guard: if this window ever stops containing the lot mapping,
    // the assertions below would pass vacuously on an empty match.
    expect(block).toMatch(/lots\.map\(/);
    expect(block).toMatch(/expires_on:\s*l\.expires_on/);
    return block;
  })();

  it("hands it to the review summary instead of dropping it at the map", () => {
    expect(mapBlock).toMatch(/otherwise_taken:\s*l\.otherwise_taken/);
  });

  it("passes the stored value through rather than defaulting it", () => {
    const assign = mapBlock.match(/otherwise_taken:\s*[^,\n]+/)?.[0] ?? "";
    expect(assign).not.toBe("");
    // `?? false` or `?? null` here would erase the distinction between
    // unanswered and answered-no, which is exactly what the warning keys on.
    expect(assign).not.toMatch(/\?\?/);
    expect(assign).not.toMatch(/Boolean\(/);
  });

  it("the adapter accepts the field, so the value has somewhere to land", () => {
    const adapter = read("src/lib/inventory/intake-review-adapter.ts");
    expect(adapter).toMatch(/otherwise_taken\?:\s*boolean\s*\|\s*null;/);
  });
});

// ---------------------------------------------------------------------------
// STAGE 5 — the approval gate is wired into the real approval path
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 5: the gate is actually invoked at approval", () => {
  const src = read("src/lib/inventory/catalog-drafts.ts");

  it("calls the gate and refuses the approval when it fails", () => {
    expect(src).toMatch(/validateReceivingClassificationChoice\(/);
    expect(src).toMatch(/if\s*\(!compliance\.ok\)/);
  });

  it("re-derives the assessment server-side instead of trusting the form", () => {
    // The form says what it thinks was required. If we believed it, a crafted
    // POST could skip the question entirely — which is the whole attack.
    expect(src).toMatch(/assessReceivingClassification\(/);
  });

  it("assesses against the category the product will ACTUALLY sit in", () => {
    // Using the resolver's value alone would let somebody re-shelve a product
    // onto `topical` in the very submission that skips the question.
    expect(src).toMatch(/choice\.chosenWebsiteCategory\s*\?\?\s*resolution\.websiteCategory/);
  });

  it("always writes otherwise_taken, plus the provenance that explains it", () => {
    expect(src).toMatch(/update\.chosen_otherwise_taken\s*=\s*compliance\.otherwiseTaken/);
    // SLICE 18F widened this. Provenance is no longer assigned straight from
    // `compliance.provenance`; it is seeded from it and may be upgraded to
    // `remembered` when the human's answer matches a prior human answer for
    // the same product identity. The INVARIANT this test defends is unchanged
    // and is now pinned in two halves, which is strictly stronger than the
    // single spelling it replaced:
    //   1. the value written must ORIGINATE from the server-side assessment,
    //      never from the form (the original attack this guarded against);
    //   2. the write must still be UNCONDITIONAL, so no approval can land
    //      with an otherwise_taken that nothing explains.
    // `toMatch` takes no message argument, so the explanation rides on the
    // boolean form -- a bare regex failure here would be genuinely cryptic.
    expect(
      /let\s+classificationProvenance:[^=]*=\s*compliance\.provenance/.test(src),
      "provenance must still be SEEDED from the server-derived assessment; " +
        "sourcing it from the form is the attack 18-0 closed.",
    ).toBe(true);
    expect(
      /update\.chosen_classification_provenance\s*=\s*classificationProvenance/.test(src),
      "provenance must still be written on every approval.",
    ).toBe(true);
    // And the write must not have become conditional. Rather than scan a
    // character window (which would spill into the NEXT statement and produce
    // a false alarm), assert the assignment sits at the function's TOP LEVEL:
    // a statement nested inside an `if` would be indented deeper than 2.
    const assignLine = src
      .split("\n")
      .find((ln) => ln.includes("update.chosen_classification_provenance ="));
    expect(assignLine, "the provenance write must still exist").toBeDefined();
    expect(
      /^ {2}update\.chosen_classification_provenance =/.test(assignLine ?? ""),
      "the provenance write must stay unconditional at the function's top " +
        "level; nesting it inside a branch would let an approval land with an " +
        "otherwise_taken that nothing explains.",
    ).toBe(true);
  });

  it("names migration 0218 when the columns are missing", () => {
    expect(src).toMatch(/0218_receiving_classification\.sql/);
  });

  it("checks 0218 BEFORE 0141/0146, since it is the one written every time", () => {
    const i0218 = src.indexOf("0218_receiving_classification");
    const i0146 = src.indexOf("0146_draft_strain_type_choice");
    const i0141 = src.indexOf("0141_draft_classification_choice");
    expect(i0218).toBeGreaterThan(-1);
    expect(i0218).toBeLessThan(i0146);
    expect(i0218).toBeLessThan(i0141);
  });
});

// ---------------------------------------------------------------------------
// STAGE 6 — injection onto menu_items (exercised for real; the planner is pure)
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — stage 6: the flags reach the menu", () => {
  const draft = (over: Partial<ApprovedDraftForInjection> = {}): ApprovedDraftForInjection => ({
    id: "d1",
    pos_product_key: "PK-SUPP",
    name: "Relief Suppositories 6ct",
    brand_name: "Acme",
    vendor_name: "Acme Farms",
    strain_name: null,
    thc_pct: null,
    cbd_pct: null,
    total_thc_pct: null,
    potency_json: null,
    price_minor_units: 3000,
    updated_at: "2025-06-01T00:00:00Z",
    inventory_type: "Suppository",
    chosen_website_category: "topical",
    ...over,
  });

  const plan = (d: ApprovedDraftForInjection) =>
    buildDraftInjectionPlan({
      drafts: [d],
      existingKeys: new Set<string>(),
      enrichmentByDraftId: new Map([
        ["d1", { websiteCategory: "topical", strainType: null, onHandQty: 5, packageLabel: "6ct" }],
      ]),
      baseSortOrder: 0,
    });

  it("carries a classified suppository's flags onto the planned item", () => {
    const p = plan(draft({ chosen_otherwise_taken: true, chosen_units_per_package: 6 }));
    expect(p.items).toHaveLength(1);
    expect(p.items[0].otherwise_taken).toBe(true);
    expect(p.items[0].units_per_package).toBe(6);
  });

  it("carries a low-THC beverage's flags too", () => {
    const p = plan(
      draft({
        name: "Craft Seltzer 4pk",
        chosen_website_category: "edible-liquid",
        chosen_otherwise_taken: false,
        chosen_low_thc_liquid: true,
        chosen_unit_thc_mg: 4,
      }),
    );
    expect(p.items[0].low_thc_liquid).toBe(true);
    expect(p.items[0].unit_thc_mg).toBe(4);
  });

  it("never invents a value on a pre-0218 database — absent stays null", () => {
    // A silent `false` here would be a claim nobody made, and would make the
    // 18A "has anyone looked at this?" worklist lie.
    const p = plan(draft());
    expect(p.items[0].otherwise_taken).toBeNull();
    expect(p.items[0].units_per_package).toBeNull();
    expect(p.items[0].low_thc_liquid).toBeNull();
    expect(p.items[0].unit_thc_mg).toBeNull();
  });

  it("preserves an explicit false rather than collapsing it to null", () => {
    // false and null mean different things: "a person said no" versus "nobody
    // has looked". Collapsing them would erase the distinction the whole
    // provenance design exists to preserve.
    const p = plan(draft({ chosen_otherwise_taken: false }));
    expect(p.items[0].otherwise_taken).toBe(false);
    expect(p.items[0].otherwise_taken).not.toBeNull();
  });

  it("the persisted row actually includes the four columns", () => {
    // The planner producing them is worthless if the insert drops them.
    const src = read("src/lib/pos/draft-injection.ts");
    for (const f of FLAGS) {
      expect(src).toMatch(new RegExp(`${f}:\\s*it\\.${f}`));
    }
  });

  it("reads the 0218 columns with a graduated fallback, like 0141/0146", () => {
    const src = read("src/lib/pos/draft-injection.ts");
    expect(src).toMatch(/chosen_otherwise_taken/);
    expect(src).toMatch(/missingCol\(withCompliance\.error\)/);
  });

  it("does not turn a null unit count into a zero", () => {
    // Number(null) is 0, and lineUnits() treats a zero multiplier as "fall back
    // to 1" — so a careless Number() would silently under-count a box of six.
    const src = read("src/lib/pos/draft-injection.ts");
    expect(src).toMatch(
      /chosen_units_per_package:\s*\n?\s*r\.chosen_units_per_package != null \? Number\(r\.chosen_units_per_package\) : null/,
    );
  });
});

// ---------------------------------------------------------------------------
// THE FORM — the gate must be reachable by a human, or it does not exist
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — the onboarding form asks the question", () => {
  const src = read("src/app/admin/inventory/drafts/page.tsx");

  it("renders the otherwise-taken picker and the unit count", () => {
    expect(src).toMatch(/name="otherwise_taken"/);
    expect(src).toMatch(/name="units_per_package"/);
  });

  it("renders the low-THC prompt", () => {
    expect(src).toMatch(/name="low_thc_liquid"/);
    expect(src).toMatch(/name="unit_thc_mg"/);
  });

  it("only shows the compliance block where the answer could matter", () => {
    // A gate on every delivery is a gate staff learn to click through blindly.
    expect(src).toMatch(/ca\?\.needsOtherwiseTakenPick/);
    expect(src).toMatch(/ca\?\.promptsLowThcLiquid/);
  });

  it("the action forwards all four fields to the server", () => {
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    for (const f of FLAGS) {
      expect(actions).toMatch(new RegExp(`formData\\.get\\("${f}"\\)`));
    }
    expect(actions).toMatch(/otherwiseTaken,/);
    expect(actions).toMatch(/unitsPerPackage,/);
    expect(actions).toMatch(/lowThcLiquid,/);
    expect(actions).toMatch(/unitThcMg,/);
  });

  it("forwards RAW strings so the validation rules live in exactly one place", () => {
    // Parsing in the action would duplicate the compliance rules, and
    // duplicated compliance rules drift.
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    expect(actions).not.toMatch(/Number\(\s*formData\.get\("units_per_package"\)/);
  });
});

// ---------------------------------------------------------------------------
// THE MIGRATION
// ---------------------------------------------------------------------------
describe("SLICE 18-0 — migration 0218", () => {
  const sql = read("supabase/migrations/0218_receiving_classification.sql");

  it("adds the four choice columns plus provenance to the drafts table", () => {
    for (const c of [
      "chosen_otherwise_taken",
      "chosen_units_per_package",
      "chosen_low_thc_liquid",
      "chosen_unit_thc_mg",
      "chosen_classification_provenance",
    ]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${c}`));
    }
  });

  it("is idempotent", () => {
    const adds = sql.match(/add column/g) ?? [];
    const guarded = sql.match(/add column if not exists/g) ?? [];
    expect(guarded.length).toBe(adds.length);
  });

  it("documents every column it adds", () => {
    const adds = (sql.match(/add column if not exists (\w+)/g) ?? []).map((m) =>
      m.replace("add column if not exists ", ""),
    );
    for (const c of adds) {
      expect(sql).toMatch(new RegExp(`comment on column public\\.catalog_product_drafts\\.${c}`));
    }
  });

  it("records WHY the fail-safe direction differs between the two flags", () => {
    // The next person to touch this must not "tidy up" the asymmetry.
    expect(sql).toMatch(/fail/i);
    expect(sql).toMatch(/2016 g/);
  });
});
