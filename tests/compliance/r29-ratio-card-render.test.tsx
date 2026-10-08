/**
 * R29 - what the CUSTOMER sees for a ratio product, rendered (not just the
 * pure cores): the strain-type slot carries the cannabinoid ratio, the
 * boxes carry PACKAGE totals (never the stale lab-percent "0.12 mg"), a
 * servings line explains the total, and a flower card is untouched.
 *
 * Fixture: the real Bytes "Sour Mandarin" pack from the R28 COA set
 * (2:2:2:1 CBG:CBC:CBD:THC, 10 pieces, COA-verified 55 mg THC / 100 mg CBD /
 * 100 mg CBG / 95 mg CBC per package).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCardVisual } from "@/components/menu/ProductCardVisual";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const mk = (over: Partial<GreenwayMenuItem>): GreenwayMenuItem =>
  ({
    id: "t",
    name: "Sour Mandarin",
    brand: "Bytes",
    category: "edible-solid",
    strainType: "unknown",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    description: "",
    priceLabel: "$20",
    priceMinorUnits: 2000,
    inventoryStatus: "in-stock",
    variants: [{ id: "v", label: "10pk", priceMinorUnits: 2000, inventoryLevel: 4, medical: false }],
    ...over,
  }) as GreenwayMenuItem;

const sourMandarin = mk({
  ratioLabel: "2:2:2:1 CBG:CBC:CBD:THC",
  servingsPerPack: 10,
  mgPerServing: 5.5,
  packageThcMg: 55,
  packageCbdMg: 100,
  // The stale pre-R29 row: lab PERCENT 0.1206 printed as mg.
  thc: "0.12mg",
  totalThc: { type: "thc", value: "0.12", unit: "mg" },
  compounds: [
    { type: "thc", value: "0.12", unit: "mg" },
    { type: "cbg", value: "100", unit: "mg" },
    { type: "cbc", value: "95", unit: "mg" },
  ],
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("R29 - ratio product card (rendered)", () => {
  const html = renderToStaticMarkup(<ProductCardVisual item={sourMandarin} />);
  const t = text(html);

  it("shows the ratio in the strain-type slot", () => {
    expect(t).toContain("2:2:2:1 CBG:CBC:CBD:THC");
  });

  it("shows package totals, never the lab-percent-as-mg", () => {
    expect(t).toContain("55 mg");
    expect(t).toContain("100 mg");
    expect(t).toContain("95 mg");
    expect(t).not.toMatch(/\b0\.12\s?mg/);
  });

  it("shows a box for every cannabinoid on the label (up to six for ratio products)", () => {
    for (const label of ["THC", "CBD", "CBG", "CBC"]) expect(t).toContain(label);
  });

  it("explains the total with a servings line", () => {
    expect(html).toContain('data-slot="servings"');
    expect(t).toMatch(/10 (servings|pieces)/);
  });

  it("a flower card keeps its strain type and percent (no ratio slot, no servings line)", () => {
    const flower = renderToStaticMarkup(
      <ProductCardVisual
        item={mk({
          name: "Blue Dream",
          category: "flower",
          strainType: "hybrid",
          thc: "24.1%",
          totalThc: { type: "thc", value: "24.1", unit: "%" },
          compounds: [{ type: "thc", value: "24.1", unit: "%" }],
          variants: [{ id: "v", label: "3.5g", priceMinorUnits: 3000, inventoryLevel: 4, medical: false }],
        })}
      />,
    );
    const ft = text(flower);
    expect(ft).toContain("Hybrid");
    expect(ft).toContain("24.1%");
    expect(flower).not.toContain('data-slot="servings"');
  });

  it("a ratio product with NO package facts never invents a total", () => {
    const bare = text(renderToStaticMarkup(<ProductCardVisual item={mk({ ratioLabel: "1:1 THC:CBD" })} />));
    expect(bare).toContain("1:1 THC:CBD");
    expect(bare).not.toMatch(/\d+ mg/);
  });
});

describe("R29 - the PDP uses the same slot helpers as the card (no drift)", () => {
  const pdp = readFileSync(join(process.cwd(), "src/app/menu/products/[id]/page.tsx"), "utf8");
  it("imports the shared ratio slot + servings helpers", () => {
    expect(pdp).toContain("cardRatioSlot");
    expect(pdp).toContain("cardServingLine");
    expect(pdp).toContain("showProfilePillWithSlot");
  });
});
