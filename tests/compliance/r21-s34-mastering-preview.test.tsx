/**
 * Round 21 (D) - S34 Mastering preview on Product Onboarding.
 *
 * Bible S34: "Before Approve, the owner sees the auto-mastering for the
 * focused delivery as GROUPS, not per-row chips ... The preview reuses the
 * SAME dry run S19 already executes".
 *
 * Proven here:
 *   1. previewMasteringGroups IS the S19 dry run: the wrapper's verdicts are
 *      identical; every groupable row is in exactly one group; sizes in ladder
 *      order; the group's verdict is the very object each member carries.
 *   2. the panel renders NOTHING without a preview (null / empty groups),
 *      never links a NEW (unpublished) card to /admin/products/, links a
 *      joined card and sends ambiguous groups to the S32 match review.
 *   3. page wiring: the panel sits next to the unavailable line under the
 *      same preview plan; rows keep their chip.
 *   4. the size labels come from the EXISTING single inventory_lots read
 *      (S10 pin: exactly one), through the one lotPackageLabel definition
 *      staging and injection also use.
 *   5. exact self-test counts (a deleted check turns this red).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PREVIEW_SIZE_UNKNOWN,
  __runIntakeMasteringCoreTests,
  lotPackageLabel,
  previewMasteringGroups,
  previewRestockVerdicts,
  type LiveCardCandidate,
  type PreviewGroupView,
  type RestockPreviewDraft,
} from "@/lib/pos/intake-mastering-core";
import {
  MASTERING_PREVIEW_HEADING,
  __runMasteringPreviewCoreTests,
  masteringGroupLine,
} from "@/lib/inventory/mastering-preview-core";
import { MasteringPreviewPanel } from "@/components/admin/catalog/MasteringPreviewPanel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M = "11111111-2222-3333-4444-555555555555";

const row = (over: Partial<RestockPreviewDraft>): RestockPreviewDraft => ({
  id: "d1",
  pos_product_key: "LOT-A",
  name: "Blue Dream 1g",
  brand_name: "Fairwinds",
  vendor_name: "Fairwinds LLC",
  strain_name: "Blue Dream",
  category: "flower",
  ...over,
});
const card = (over: Partial<LiveCardCandidate>): LiveCardCandidate => ({
  source_item_id: "card-1",
  name: "Blue Dream",
  brand_name: "Fairwinds",
  vendor_name: "Fairwinds LLC",
  category: "flower",
  strain_name: "Blue Dream",
  hidden: false,
  variants: [
    { source_variant_id: "LOT-OLD-onboarded", medical: false, label: "3.5g", price_minor_units: 3500, inventory_level: 9 },
    { source_variant_id: "LOT-OLD2-onboarded", medical: false, label: "1g", price_minor_units: 1200, inventory_level: 5 },
  ],
  ...over,
});

describe("S34 core: the groups ARE the S19 dry run", () => {
  const drafts = [
    row({ id: "a", pos_product_key: "LOT-1", name: "Blue Dream 7g", size_label: "7 g" }),
    row({ id: "b", pos_product_key: "LOT-2", name: "Blue Dream 1g", size_label: "1 g" }),
    row({ id: "c", pos_product_key: "LOT-3", name: "Blue Dream 3.5g", size_label: "3.5 g" }),
    row({ id: "n", pos_product_key: "LOT-4", name: "Gelato 1g", strain_name: "Gelato" }),
    row({ id: "live", pos_product_key: "card-1" }),
    row({ id: "nov", vendor_name: null }),
  ];
  const out = previewMasteringGroups({ drafts, liveCards: [card({})] });

  it("the wrapper returns the same verdicts", () => {
    const w = previewRestockVerdicts({ drafts, liveCards: [card({})] });
    expect([...w.entries()].map(([k, v]) => [k, JSON.stringify(v)])).toEqual(
      [...out.verdicts.entries()].map(([k, v]) => [k, JSON.stringify(v)]),
    );
  });

  it("3 sizes of a product with a live card -> ONE group of 3 joining it, with its current sizes/prices/stock", () => {
    const g = out.groups[0];
    expect(g.draftIds).toEqual(["a", "b", "c"]);
    expect(g.sizes).toEqual(["1 g", "3.5 g", "7 g"]);
    expect(g.verdict.kind).toBe("joins");
    expect(g.liveCard).toEqual({ key: "card-1", name: "Blue Dream", variantLabels: ["1g", "3.5g"], priceRangeMinor: [1200, 3500], onHand: 14 });
    for (const id of g.draftIds) expect(out.verdicts.get(id)).toBe(g.verdict);
  });

  it("a row with no size label is named, never guessed; ungroupable rows are in no group", () => {
    expect(out.groups[1].draftIds).toEqual(["n"]);
    expect(out.groups[1].sizes).toEqual([PREVIEW_SIZE_UNKNOWN]);
    const all = out.groups.flatMap((g) => g.draftIds);
    expect(all).not.toContain("live");
    expect(all).not.toContain("nov");
    expect(out.verdicts.get("live")?.kind).toBe("already_live");
    expect(out.verdicts.get("nov")?.kind).toBe("no_vendor");
  });

  it("lotPackageLabel is the staging derivation, and staging/injection/onboarding all call it", () => {
    expect(lotPackageLabel({ unit_weight: 3.5, unit_weight_uom: "g" })).toBe("3.5 g");
    expect(lotPackageLabel({ unit_weight: null, unit_weight_uom: "g" })).toBeNull();
    for (const f of ["src/lib/pos/intake-menu-staging.ts", "src/lib/pos/draft-injection.ts"]) {
      const src = read(f);
      expect(src).toContain("packageLabel: lotPackageLabel(lot),");
      expect(src).not.toContain("lot.unit_weight != null");
    }
    expect(read("src/lib/inventory/catalog-drafts.ts")).toContain("const size = lotPackageLabel(l);");
  });

  it("exact self-test counts", () => {
    expect(__runIntakeMasteringCoreTests().passed).toBe(218); // R29: +6 (lot-bundle minors x4, cannabinoid upper-case x2); R35 #6: +6 (effects/aroma rollup)
    expect(__runMasteringPreviewCoreTests()).toEqual({ passed: 17, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("mastering-preview-core", __runMasteringPreviewCoreTests(), 17);');
  });
});

describe("S34 panel render", () => {
  const joins: PreviewGroupView = {
    identity: "fairwinds-llc|flower|blue-dream",
    category: "flower",
    family: "blue-dream",
    draftIds: ["a", "b"],
    sizes: ["1 g", "3.5 g"],
    verdict: { kind: "joins", cardKey: "card-1", cardName: "Blue Dream", fromCultivera: false, matchedBy: "name", vendorRecordDiffers: false },
    liveCard: { key: "card-1", name: "Blue Dream", variantLabels: ["7g"], priceRangeMinor: [5000, 5000], onHand: 3 },
  };
  const fresh: PreviewGroupView = { identity: "fairwinds-llc|flower|gelato", category: "flower", family: "gelato", draftIds: ["n"], sizes: ["1 g"], verdict: { kind: "new" } };
  const amb: PreviewGroupView = { identity: "fairwinds-llc|flower|zkittlez", category: "flower", family: "zkittlez", draftIds: ["z"], sizes: [PREVIEW_SIZE_UNKNOWN], verdict: { kind: "ambiguous", cardKeys: ["k1", "k2"] } };
  const names = new Map([["a", "Blue Dream 1g"], ["b", "Blue Dream 3.5g"], ["n", "Gelato 1g"], ["z", "Zkittlez"]]);
  const render = (groups: PreviewGroupView[] | null) =>
    renderToStaticMarkup(createElement(MasteringPreviewPanel, { groups, rowNames: names, totalRows: 5, manifestId: M, back: `/admin/inventory/drafts?manifest=${M}` }));

  it("renders nothing when the preview is unavailable (null) or empty", () => {
    expect(render(null)).toBe("");
    expect(render([])).toBe("");
  });

  it("joins: bible copy, the card bold, its current shape, a link to its product page", () => {
    const html = render([joins]);
    expect(html).toContain(MASTERING_PREVIEW_HEADING.replace("\u2014", "\u2014"));
    expect(html).toContain("2 rows \u2192 one card with 1 g \u00b7 3.5 g \u2192 joins <strong>Blue Dream</strong> (now 1 size, $50.00, 3 on hand)");
    expect(html).toContain('href="/admin/products/card-1?back=');
    expect(html).toContain("Blue Dream 1g \u00b7 Blue Dream 3.5g");
  });

  it("a NEW card is plain text - no /admin/products/ link (it has no page yet)", () => {
    const html = render([fresh]);
    expect(html).toContain("1 row \u2192 one NEW card with 1 g");
    expect(html).not.toContain("/admin/products/");
    expect(html).not.toContain('data-testid="mastering-group-link"');
  });

  it("ambiguous: the choice sentence + the S32 review for this delivery and identity", () => {
    const html = render([amb]);
    expect(html).toContain("Matches 2 live cards \u2014 choose which one (or keep separate)");
    expect(html).toContain(`href="/admin/inventory/intake/${M}/match?identity=fairwinds-llc%7Cflower%7Czkittlez&amp;back=`);
    expect(html).not.toContain("/admin/products/");
  });

  it("summary counts groups, rows and the ungrouped rest", () => {
    const html = render([joins, fresh, amb]);
    expect(html).toContain("3 cards from 4 rows: 1 join a live card, 1 new, 1 needs your choice. 1 other row is not grouped");
  });

  it("the line core never links an ambiguous group without a delivery", () => {
    expect(masteringGroupLine(amb, { manifestId: null }).link).toBeNull();
  });
});

describe("S34 wiring", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");

  it("the panel renders beside the unavailable line from the SAME preview result; rows keep their chip", () => {
    expect(page).toContain("const previewGroups = restockPreview && restockPreview.ok ? restockPreview.groups : null;");
    expect(page).toContain("groups={previewGroups}");
    const note = page.indexOf("<RestockPreviewUnavailable text={previewNote} />");
    const panel = page.indexOf("<MasteringPreviewPanel");
    const table = page.indexOf("<RestockPreviewChip verdict={previewVerdicts.get(d.id)!} />");
    expect(note).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(note);
    expect(table).toBeGreaterThan(panel);
    expect(page).toContain("restockPreviewPlan({ view, manifestId: focus.manifestId, rows: drafts.length })");
  });

  it("rows carry the lot size from the strain-signal read, which runs first", () => {
    expect(page).toContain("size_label: strainSizeLabels.get(d.id) ?? null,");
    expect(page.indexOf("sizeLabels: strainSizeLabels")).toBeLessThan(page.indexOf("const restockPreview = previewPlan.load"));
  });

  it("the server reads the widened variant columns and stays read-only", () => {
    const srv = read("src/lib/inventory/restock-preview-server.ts");
    expect(srv).toContain('"menu_item_id, source_variant_id, medical, label, price_minor_units, inventory_level"');
    expect(srv).toContain("previewMasteringGroups({ drafts, liveCards, vendorIds })");
    expect(srv).not.toContain("previewRestockVerdicts(");
  });

  it("the size comes from the ONE existing inventory_lots read (no new query)", () => {
    const drafts = read("src/lib/inventory/catalog-drafts.ts");
    const fn = drafts.slice(drafts.indexOf("export async function loadStrainTypeSignals"), drafts.indexOf("export async function approveDraftWithPrice"));
    expect(fn.match(/from\("inventory_lots"\)/g)?.length).toBe(1);
    expect(fn).toContain('.select("id, strain_type, unit_weight, unit_weight_uom")');
  });
});
