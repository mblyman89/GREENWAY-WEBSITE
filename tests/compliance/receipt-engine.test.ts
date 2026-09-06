/**
 * tests/compliance/receipt-engine.test.ts  (Slice 22b)
 *
 * The enterprise receipt engine.
 *
 * The headline here is not cosmetic. RCW 69.50.535(1)(a) says, verbatim:
 *
 *   "The tax must be separately itemized from the state and local retail
 *    sales tax on the sales receipt provided to the buyer."
 *
 * Before this slice the register printed one combined `Tax` row. These tests
 * pin the fix, and — just as importantly — pin the REFUSALS, because a tax
 * document that confidently prints a wrong split is worse than one that
 * prints a correct combined line.
 */
import { describe, it, expect } from "vitest";
import {
  buildPosReceiptHtml,
  receiptNumber,
  receiptItemDetailParts,
  receiptItemCount,
  receiptTotalGrams,
  receiptUnitPriceNote,
  formatGrams,
  formatThcMg,
  type PosReceiptInput,
  type PosReceiptLine,
} from "@/lib/pos/receipt-core";
import {
  splitReceiptTax,
  exciseTaxLabel,
  salesTaxLabel,
  formatBpsPercent,
} from "@/lib/pos/receipt-tax-core";
import {
  receiptLogoImgTag,
  receiptLogoDataUri,
  clampLogoWidth,
  RECEIPT_LOGO_WIDTH,
  RECEIPT_LOGO_MIN_WIDTH,
  RECEIPT_LOGO_PNG_BASE64,
} from "@/lib/pos/receipt-logo-core";
import {
  normalizePosReceiptConfig,
  DEFAULT_POS_RECEIPT_CONFIG,
} from "@/lib/pos/receipt-config-core";
import { defaultReturnPolicyText, RETURN_WINDOW_DAYS } from "@/lib/pos/returns-core";
import { computeOrderTotals } from "@/lib/orders/order-pricing-core";
import { rebuildReceiptFromPayload } from "@/lib/pos/receipt-reprint-core";

/** Build a receipt whose money is computed by the REAL pricing core. */
function makeReceipt(
  lines: PosReceiptLine[],
  overrides: Partial<PosReceiptInput> = {},
): PosReceiptInput {
  const totals = computeOrderTotals(
    lines.map((l) => ({
      category: l.category ?? null,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
    })),
  );
  return {
    saleClientUuid: "9f2c1a44-5b7e-4c3d-8a19-7e4d2b6c9f30",
    soldAtIso: "2026-09-05T21:14:00.000Z",
    registerLabel: "Register 1",
    lines,
    subtotalMinor: totals.subtotalMinorUnits,
    taxMinor: totals.estimatedTaxMinorUnits,
    totalMinor: totals.totalMinorUnits,
    savingsMinor: totals.savingsMinorUnits,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: totals.totalMinorUnits,
    changeMinor: 0,
    ...overrides,
  };
}

const FLOWER: PosReceiptLine = {
  productName: "Blue Dream (3.5g)",
  quantity: 1,
  unitPriceMinor: 3500,
  regularPriceMinor: 4200,
  category: "flower",
  brand: "Sky High Farms",
  unitGrams: 3.5,
  appliedLabel: "Happy Hour 15%",
};

const GRINDER: PosReceiptLine = {
  productName: "Glass Grinder",
  quantity: 1,
  unitPriceMinor: 1200,
  regularPriceMinor: 1200,
  category: "accessories",
  brand: "Santa Cruz",
};

/** Pull the money out of a printed row, e.g. "Total tax" -> 2159. */
function rowAmount(html: string, label: string): number | null {
  const re = new RegExp(
    `<td class="n">${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</td><td class="a">\\$([0-9,]+\\.[0-9]{2})</td>`,
  );
  const m = html.match(re);
  if (!m) return null;
  return Math.round(Number(m[1].replace(/,/g, "")) * 100);
}

describe("RCW 69.50.535(1)(a) — the excise MUST be itemized separately", () => {
  it("prints the excise and the sales tax as two distinct rows", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).toContain("WA Cannabis Excise (37%)");
    expect(html).toContain("State &amp; Local Sales Tax (9.3%)");
  });

  it("no longer prints a lone combined Tax row on a modern sale", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    // The combined row is exactly `>Tax<`; the itemized rows are longer
    // labels, and the reconciling row is "Total tax".
    expect(html).not.toContain('<td class="n">Tax</td>');
    expect(html).toContain('<td class="n">Total tax</td>');
  });

  it("the two printed parts add up to the tax actually charged", () => {
    const receipt = makeReceipt([FLOWER, GRINDER]);
    const html = buildPosReceiptHtml(receipt);
    const excise = rowAmount(html, "WA Cannabis Excise (37%)");
    const sales = rowAmount(html, "State &amp; Local Sales Tax (9.3%)");
    expect(excise).not.toBeNull();
    expect(sales).not.toBeNull();
    expect(excise! + sales!).toBe(receipt.taxMinor);
  });

  it("subtotal + total tax still equals the total (the drawer is never contradicted)", () => {
    const receipt = makeReceipt([FLOWER, GRINDER]);
    const html = buildPosReceiptHtml(receipt);
    expect(rowAmount(html, "Total tax")).toBe(receipt.taxMinor);
    expect(receipt.subtotalMinor + receipt.taxMinor).toBe(receipt.totalMinor);
  });

  it("explains what the 9.3% is made of", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).toContain("Includes WA state 6.5% + local 2.8%");
  });

  it("charges NO excise on an accessory-only sale", () => {
    const html = buildPosReceiptHtml(makeReceipt([GRINDER]));
    expect(html).not.toContain("WA Cannabis Excise");
    expect(html).toContain("State &amp; Local Sales Tax (9.3%)");
  });

  it("labels are generated from the rate constants, not typed prose", () => {
    expect(exciseTaxLabel()).toBe("WA Cannabis Excise (37%)");
    expect(salesTaxLabel()).toBe("State & Local Sales Tax (9.3%)");
    expect(formatBpsPercent(3700)).toBe("37");
    expect(formatBpsPercent(930)).toBe("9.3");
  });

  it("the owner can switch the itemization off, and then gets the combined row", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER], { showTaxBreakdown: false }));
    expect(html).toContain('<td class="n">Tax</td>');
    expect(html).not.toContain("WA Cannabis Excise");
  });
});

describe("the split degrades instead of lying", () => {
  it("falls back to a combined row when a line has no category", () => {
    // Exactly the shape of a frozen receipt captured before this slice.
    const legacy = makeReceipt([
      { productName: "Legacy item", quantity: 1, unitPriceMinor: 4630, regularPriceMinor: 4630 },
    ]);
    const html = buildPosReceiptHtml(legacy);
    expect(html).toContain('<td class="n">Tax</td>');
    expect(html).not.toContain("WA Cannabis Excise");
  });

  it("a legacy receipt still prints its correct total (it does not crash)", () => {
    const legacy = makeReceipt([
      { productName: "Legacy item", quantity: 1, unitPriceMinor: 4630, regularPriceMinor: 4630 },
    ]);
    const html = buildPosReceiptHtml(legacy);
    expect(rowAmount(html, "Tax")).toBe(legacy.taxMinor);
    expect(html).toContain("TOTAL");
  });

  it("refuses when the tax figure cannot be explained by the lines", () => {
    expect(
      splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630, category: "flower" }], 9999),
    ).toBeNull();
  });

  it("refuses a negative or non-finite tax", () => {
    const l = [{ quantity: 1, unitPriceMinor: 4630, category: "flower" }];
    expect(splitReceiptTax(l, -1)).toBeNull();
    expect(splitReceiptTax(l, Number.NaN)).toBeNull();
    expect(splitReceiptTax(l, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("a fully exempt medical basket reports zero for BOTH parts, inventing nothing", () => {
    const s = splitReceiptTax(
      [
        {
          quantity: 1,
          unitPriceMinor: 3165,
          category: "flower",
          salesExempt: true,
          exciseExempt: true,
        },
      ],
      0,
    );
    expect(s).not.toBeNull();
    expect(s!.exciseMinor).toBe(0);
    expect(s!.salesMinor).toBe(0);
  });

  it("a sales-exempt patient line charges excise ONLY (mutation M02)", () => {
    // medical-pos-core rebuilds the inclusive price as base + still-due taxes,
    // so a sales-exempt cannabis line's divisor is 1.37, not 1.463. Code that
    // ignored the exemption would back out a sales-tax component that the
    // patient never paid AND under-report the excise.
    const s = splitReceiptTax(
      [{ quantity: 1, unitPriceMinor: 1370, category: "flower", salesExempt: true }],
      370,
    );
    expect(s).not.toBeNull();
    expect(s!.salesMinor).toBe(0);
    expect(s!.exciseMinor).toBe(370);
    expect(s!.anySales).toBe(false);
  });

  it("the rounding residual is absorbed by the LARGER component (mutation M06)", () => {
    // $35.00 of flower: excise rounds to 885, sales to 222, and the
    // authoritative tax is 1108 -- a 1c residual. It must land in the excise
    // figure (886/222), not the sales figure (885/223), so a cent of cannabis
    // excise is never misreported as retail sales tax.
    const s = splitReceiptTax([{ quantity: 1, unitPriceMinor: 3500, category: "flower" }], 1108);
    expect(s).not.toBeNull();
    expect(s!.exciseMinor).toBe(886);
    expect(s!.salesMinor).toBe(222);
    expect(s!.exciseMinor + s!.salesMinor).toBe(1108);
  });

  it("an excise-exempt patient line still shows sales tax and no excise", () => {
    const s = splitReceiptTax(
      [{ quantity: 1, unitPriceMinor: 1093, category: "flower", exciseExempt: true }],
      1093 - Math.round(1093 / 1.093),
    );
    expect(s).not.toBeNull();
    expect(s!.exciseMinor).toBe(0);
    expect(s!.salesMinor).toBeGreaterThan(0);
  });

  it("multiplies by quantity rather than taxing one unit (mutation M14)", () => {
    // 3 x $15.00 of edible. Taxing a single unit would understate the base by
    // two thirds, and the reconciliation would then refuse outright -- which
    // silently costs the customer their itemized receipt.
    const gummies: PosReceiptLine = {
      productName: "Sour Watermelon Gummies",
      quantity: 3,
      unitPriceMinor: 1500,
      regularPriceMinor: 1500,
      category: "edible",
      unitThcMg: 10,
    };
    const receipt = makeReceipt([gummies]);
    expect(receipt.totalMinor).toBe(4500);
    const s = splitReceiptTax(
      [{ quantity: 3, unitPriceMinor: 1500, category: "edible" }],
      receipt.taxMinor,
    );
    expect(s).not.toBeNull();
    expect(s!.exciseMinor).toBe(1138);
    expect(s!.salesMinor).toBe(286);
    // And it really does reach the paper.
    const html = buildPosReceiptHtml(receipt);
    expect(html).toContain("WA Cannabis Excise (37%)");
    expect(rowAmount(html, "WA Cannabis Excise (37%)")).toBe(1138);
  });

  it("reconciles exactly across a wide sweep of prices", () => {
    for (let cents = 100; cents <= 30000; cents += 97) {
      const auth = cents - Math.round(cents / 1.463);
      const s = splitReceiptTax([{ quantity: 1, unitPriceMinor: cents, category: "flower" }], auth);
      expect(s, `price ${cents}`).not.toBeNull();
      expect(s!.exciseMinor + s!.salesMinor, `price ${cents}`).toBe(auth);
      expect(s!.exciseMinor).toBeGreaterThanOrEqual(0);
      expect(s!.salesMinor).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the logo prints offline", () => {
  it("is embedded as a data URI, never fetched from the network", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('src="/brand');
  });

  it("carries explicit width AND height so the print snapshot is not clipped", () => {
    // StarPrinterPlugin.swift measures document.body.scrollHeight on didFinish
    // and snapshots to it; an unsized <img> can lay out after that.
    const tag = receiptLogoImgTag();
    expect(tag).toContain('width="576"');
    expect(tag).toContain('height="114"');
    expect(tag).toContain("width:576px");
    expect(tag).toContain("height:114px");
  });

  it("stays small enough for the PassPRNT URL transport", () => {
    // buildPassPrntUrl percent-encodes the WHOLE document into a URL.
    expect(RECEIPT_LOGO_PNG_BASE64.length).toBeLessThan(8000);
  });

  it("is a real PNG", () => {
    expect(RECEIPT_LOGO_PNG_BASE64.startsWith("iVBORw0KGgo")).toBe(true);
    expect(receiptLogoDataUri().startsWith("data:image/png;base64,")).toBe(true);
  });

  it("clamps any width into the printable range and never emits NaN", () => {
    expect(clampLogoWidth(5)).toBe(RECEIPT_LOGO_MIN_WIDTH);
    expect(clampLogoWidth(99999)).toBe(RECEIPT_LOGO_WIDTH);
    expect(clampLogoWidth(Number.NaN)).toBe(RECEIPT_LOGO_WIDTH);
    expect(receiptLogoImgTag(Number.NaN)).not.toContain("NaN");
  });

  it("can be switched off", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER], { showLogo: false }));
    expect(html).not.toContain("data:image/png;base64,");
  });

  it("preserves the aspect ratio at a reduced width", () => {
    const tag = receiptLogoImgTag(288);
    expect(tag).toContain('width="288"');
    expect(tag).toContain('height="57"');
  });
});

describe("the receipt is data rich", () => {
  it("prints brand, size and the deal that saved them money", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).toContain("Sky High Farms");
    expect(html).toContain("3.5g");
    expect(html).toContain("Happy Hour 15%");
  });

  it("prints THC milligrams for an edible", () => {
    const gummies: PosReceiptLine = {
      productName: "Sour Watermelon Gummies",
      quantity: 2,
      unitPriceMinor: 1500,
      regularPriceMinor: 1500,
      category: "edible",
      brand: "Craft Elixirs",
      unitThcMg: 10,
    };
    const html = buildPosReceiptHtml(makeReceipt([gummies]));
    expect(html).toContain("THC 10mg");
  });

  it("shows the per-unit price when more than one unit was bought", () => {
    const two: PosReceiptLine = { ...FLOWER, quantity: 2 };
    expect(receiptUnitPriceNote(two)).toBe("2 @ $35.00 each");
    expect(receiptUnitPriceNote(FLOWER)).toBe("");
  });

  it("summarises the basket: item count, weight and savings", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER, GRINDER]));
    expect(html).toContain("2 items");
    expect(html).toContain("3.5g total");
    expect(html).toContain("saved $7.00");
  });

  it("says '1 item' rather than '1 items'", () => {
    // A single accessory has no known weight and no savings, so the summary
    // strip is exactly the count with nothing after it.
    const html = buildPosReceiptHtml(makeReceipt([GRINDER]));
    expect(html).toContain('<p class="summary">1 item</p>');
    expect(html).not.toContain("1 items");
  });

  it("counts units, not distinct products", () => {
    expect(receiptItemCount([FLOWER, { ...GRINDER, quantity: 3 }])).toBe(4);
  });

  it("totals only the weights it actually knows", () => {
    expect(receiptTotalGrams([FLOWER, GRINDER])).toBe(3.5);
    expect(receiptTotalGrams([GRINDER])).toBeNull();
    expect(receiptTotalGrams([FLOWER, { ...FLOWER, quantity: 2 }])).toBe(10.5);
  });

  it("never prints a placeholder for a detail it does not have", () => {
    const bare: PosReceiptLine = {
      productName: "Mystery item",
      quantity: 1,
      unitPriceMinor: 1000,
      regularPriceMinor: 1000,
      category: "flower",
    };
    expect(receiptItemDetailParts(bare)).toEqual([]);
    const html = buildPosReceiptHtml(makeReceipt([bare]));
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("does not repeat the variant when it is already in the product name", () => {
    const line: PosReceiptLine = {
      productName: "Blue Dream (3.5g)",
      quantity: 1,
      unitPriceMinor: 3500,
      regularPriceMinor: 3500,
      category: "flower",
      variantLabel: "3.5g",
    };
    // No unitGrams here, so the variant path is exercised.
    expect(receiptItemDetailParts(line)).toEqual([]);
  });

  it("formats weights and potency without float noise", () => {
    expect(formatGrams(3.5)).toBe("3.5g");
    expect(formatGrams(1)).toBe("1g");
    expect(formatGrams(0.1 + 0.2)).toBe("0.3g");
    expect(formatThcMg(10)).toBe("10mg");
    expect(formatThcMg(2.5)).toBe("2.5mg");
  });

  it("rounds a half-cent-of-a-gram UP rather than truncating it", () => {
    // Not a theoretical edge. `normalizeUnitGrams` (variant-grams-core.ts:66)
    // rounds unit weights to THREE decimals, and `gramsFromVariantLabel`
    // (:44) parses a label like "0.075g" straight off the published menu, so
    // a three-decimal unitGrams reaches the receipt builder unchanged.
    //
    // toFixed(2) ALONE rounds 0.075 DOWN to "0.07g" — it rounds the binary
    // double, which sits a hair below the decimal midpoint. Scaling by 100 and
    // rounding first gives the honest "0.08g". A weight printed on a cannabis
    // receipt should never read light: the customer reads it as what they were
    // sold, and it is their own cross-check against the daily purchase limit.
    expect(formatGrams(0.075)).toBe("0.08g");
    expect(formatGrams(1.075)).toBe("1.08g");
    expect(formatGrams(0.175)).toBe("0.18g");

    // The per-line detail passes unitGrams through RAW (receipt-core.ts:214),
    // so this is the path that actually carries it onto the paper. (The
    // summary strip cannot: receiptTotalGrams pre-rounds at :258.)
    const sample: PosReceiptLine = {
      productName: "Live Rosin Sample",
      quantity: 1,
      unitPriceMinor: 500,
      regularPriceMinor: 500,
      category: "concentrate",
      brand: "Cascade Extracts",
      unitGrams: 0.075,
    };
    expect(receiptItemDetailParts(sample)).toEqual(["Cascade Extracts", "0.08g"]);
    const html = buildPosReceiptHtml(makeReceipt([sample]));
    expect(html).toContain("0.08g");
    expect(html).not.toContain("0.07g");
  });

  it("item detail can be switched off", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER], { showItemDetail: false }));
    expect(html).not.toContain("Sky High Farms");
    // The product itself still prints.
    expect(html).toContain("Blue Dream");
  });
});

describe("the return policy on the paper matches the policy we enforce", () => {
  it("is generated from the SAME window constant the returns desk uses", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).toContain("Return Policy");
    expect(html).toContain(`within ${RETURN_WINDOW_DAYS} days`);
    expect(defaultReturnPolicyText()).toContain(String(RETURN_WINDOW_DAYS));
  });

  it("states the loyalty and original-receipt conditions the code enforces", () => {
    const policy = defaultReturnPolicyText();
    expect(policy.toLowerCase()).toContain("receipt");
    expect(policy.toLowerCase()).toContain("loyalty");
    expect(policy.toLowerCase()).toContain("original packaging");
  });

  it("honours custom owner wording", () => {
    const html = buildPosReceiptHtml(
      makeReceipt([FLOWER], { returnPolicyText: "All sales final on clearance." }),
    );
    expect(html).toContain("All sales final on clearance.");
    expect(html).not.toContain(`within ${RETURN_WINDOW_DAYS} days`);
  });

  it("can be switched off entirely", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER], { showReturnPolicy: false }));
    expect(html).not.toContain("Return Policy");
  });
});

describe("the receipt number is scannable", () => {
  it("prints a barcode and the human-readable number", () => {
    const receipt = makeReceipt([FLOWER]);
    const html = buildPosReceiptHtml(receipt);
    const no = receiptNumber(receipt.saleClientUuid);
    expect(html).toContain("<svg");
    expect(html).toContain(no);
  });

  it("encodes the SAME number the returns desk looks a sale up by", () => {
    const receipt = makeReceipt([FLOWER]);
    expect(receiptNumber(receipt.saleClientUuid)).toBe("2B6C9F30");
    expect(buildPosReceiptHtml(receipt)).toContain("2B6C9F30");
  });

  it("can be switched off", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER], { showBarcode: false }));
    expect(html).not.toContain("<svg");
  });
});

describe("the four advertising warnings are deliberately absent", () => {
  // WAC 314-55-155(6) governs ADVERTISING. A receipt is not advertising, and
  // the owner asked for them to stay off: "it's too wordy".
  it("does not print the advertising warning statements", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html).not.toContain("This product has intoxicating effects and may be habit forming. Cannabis can impair");
    expect(html).not.toContain("There may be health risks associated with consumption");
    expect(html).not.toContain("should not be used by women that are pregnant");
    expect(html).not.toContain("It is illegal to operate a motor vehicle");
  });
});

describe("nothing that was working is broken", () => {
  it("still prints the medical banner and never prints card details", () => {
    const html = buildPosReceiptHtml(
      makeReceipt([FLOWER], { medicalSale: true, medicalSavingsMinor: 500 }),
    );
    expect(html).toContain("MEDICAL");
    expect(html).not.toContain("UPID");
  });

  it("still prints cash rounding as its own line", () => {
    const html = buildPosReceiptHtml(
      makeReceipt([FLOWER], { roundingAdjustmentMinor: 2, roundedDueMinor: 5145 }),
    );
    expect(html).toContain("Cash rounding");
    expect(html).toContain("Cash due");
  });

  it("still prints the loyalty block", () => {
    const html = buildPosReceiptHtml(
      makeReceipt([FLOWER], { loyalty: { memberLabel: "M. Lyman", pointsEarned: 54 } }),
    );
    expect(html).toContain("M. Lyman");
    expect(html).toContain("54");
  });

  it("still escapes hostile product names", () => {
    const nasty: PosReceiptLine = {
      productName: '<script>alert("x")</script>',
      quantity: 1,
      unitPriceMinor: 1000,
      regularPriceMinor: 1000,
      category: "flower",
      brand: "<img onerror=1>",
    };
    const html = buildPosReceiptHtml(makeReceipt([nasty]));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is still a complete, self-contained 576px document", () => {
    const html = buildPosReceiptHtml(makeReceipt([FLOWER]));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</body></html>")).toBe(true);
    expect(html).toContain("width:576px");
    expect(html).toContain('name="format-detection"');
  });
});

describe("the owner's settings survive normalization", () => {
  it("defaults the statutory itemization ON", () => {
    expect(DEFAULT_POS_RECEIPT_CONFIG.showTaxBreakdown).toBe(true);
    // A cached pre-22b bundle carries no value for it and must still get it.
    expect(normalizePosReceiptConfig({}).showTaxBreakdown).toBe(true);
    expect(normalizePosReceiptConfig(null).showTaxBreakdown).toBe(true);
    expect(normalizePosReceiptConfig("garbage").showTaxBreakdown).toBe(true);
  });

  it("defaults every new display switch ON", () => {
    const c = normalizePosReceiptConfig({});
    expect(c.showLogo).toBe(true);
    expect(c.showReturnPolicy).toBe(true);
    expect(c.showItemDetail).toBe(true);
    expect(c.showBarcode).toBe(true);
    expect(c.showSaleSummary).toBe(true);
  });

  it("round-trips the switches when they are turned off", () => {
    const c = normalizePosReceiptConfig({
      showTaxBreakdown: false,
      showLogo: false,
      showReturnPolicy: false,
      showItemDetail: false,
      showBarcode: false,
      showSaleSummary: false,
    });
    expect(c.showTaxBreakdown).toBe(false);
    expect(c.showLogo).toBe(false);
    expect(c.showBarcode).toBe(false);
  });

  it("accepts the string booleans a form posts", () => {
    const c = normalizePosReceiptConfig({ showLogo: "false", showBarcode: "true" });
    expect(c.showLogo).toBe(false);
    expect(c.showBarcode).toBe(true);
  });

  it("clamps a runaway logo width and accepts a numeric string", () => {
    expect(normalizePosReceiptConfig({ logoWidth: 99999 }).logoWidth).toBe(RECEIPT_LOGO_WIDTH);
    expect(normalizePosReceiptConfig({ logoWidth: 1 }).logoWidth).toBe(RECEIPT_LOGO_MIN_WIDTH);
    expect(normalizePosReceiptConfig({ logoWidth: "288" }).logoWidth).toBe(288);
    expect(normalizePosReceiptConfig({ logoWidth: "abc" }).logoWidth).toBe(RECEIPT_LOGO_WIDTH);
  });

  it("treats empty return-policy text as 'use the generated wording'", () => {
    expect(normalizePosReceiptConfig({ returnPolicyText: "   " }).returnPolicyText).toBe("");
    expect(normalizePosReceiptConfig({ returnPolicyText: "Mine." }).returnPolicyText).toBe("Mine.");
  });

  it("clamps a runaway policy paste", () => {
    const c = normalizePosReceiptConfig({ returnPolicyText: "x".repeat(5000) });
    expect(c.returnPolicyText.length).toBe(400);
  });

  it("never throws on hostile input", () => {
    expect(() => normalizePosReceiptConfig([1, 2, 3])).not.toThrow();
    expect(() => normalizePosReceiptConfig({ logoWidth: {} })).not.toThrow();
    expect(() => normalizePosReceiptConfig({ showLogo: [] })).not.toThrow();
  });
});

describe("a reprinted receipt reproduces the original", () => {
  const payload = {
    lines: [
      {
        productName: "Blue Dream (3.5g)",
        quantity: 1,
        unitPriceMinor: 3500,
        regularPriceMinor: 4200,
        category: "flower",
        brand: "Sky High Farms",
        unitGrams: 3.5,
        appliedLabel: "Happy Hour 15%",
      },
    ],
    subtotalMinor: 2392,
    taxMinor: 1108,
    totalMinor: 3500,
    tenderedMinor: 4000,
    changeMinor: 500,
  };
  const ctx = {
    saleClientUuid: "9f2c1a44-5b7e-4c3d-8a19-7e4d2b6c9f30",
    soldAtIso: "2026-09-05T21:14:00.000Z",
    registerLabel: "Register 1",
  };

  it("carries the category through, so the reprint is ALSO itemized", () => {
    const res = rebuildReceiptFromPayload(payload, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.lines[0].category).toBe("flower");
    const html = buildPosReceiptHtml(res.receipt as PosReceiptInput);
    expect(html).toContain("WA Cannabis Excise (37%)");
  });

  it("carries the rich detail through", () => {
    const res = rebuildReceiptFromPayload(payload, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.lines[0].brand).toBe("Sky High Farms");
    expect(res.receipt.lines[0].unitGrams).toBe(3.5);
    expect(res.receipt.lines[0].appliedLabel).toBe("Happy Hour 15%");
  });

  it("a genuinely old payload with no rich fields still rebuilds", () => {
    const old = {
      ...payload,
      lines: [
        { productName: "Legacy", quantity: 1, unitPriceMinor: 3500, regularPriceMinor: 3500 },
      ],
    };
    const res = rebuildReceiptFromPayload(old, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.lines[0].category).toBeUndefined();
    expect(res.receipt.lines[0].brand).toBeUndefined();
    // And it prints, with the honest combined tax row.
    const html = buildPosReceiptHtml(res.receipt as PosReceiptInput);
    expect(html).toContain('<td class="n">Tax</td>');
  });

  it("ignores nonsense weights instead of printing them", () => {
    const junk = {
      ...payload,
      lines: [{ ...payload.lines[0], unitGrams: -5, unitThcMg: 0 }],
    };
    const res = rebuildReceiptFromPayload(junk, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.lines[0].unitGrams).toBeUndefined();
    expect(res.receipt.lines[0].unitThcMg).toBeUndefined();
  });

  it("applies the owner's switches when a config is supplied", () => {
    const res = rebuildReceiptFromPayload(payload, {
      ...ctx,
      config: {
        showTaxBreakdown: true,
        showLogo: false,
        logoWidth: 576,
        showReturnPolicy: false,
        returnPolicyText: "",
        showItemDetail: true,
        showBarcode: false,
        showSaleSummary: true,
        showSavings: true,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const html = buildPosReceiptHtml(res.receipt as PosReceiptInput);
    expect(html).not.toContain("data:image/png;base64,");
    expect(html).not.toContain("Return Policy");
    expect(html).not.toContain("<svg");
  });

  it("with NO config supplied it keeps the pre-22b default-on behaviour", () => {
    const res = rebuildReceiptFromPayload(payload, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.showLogo).toBeUndefined();
    const html = buildPosReceiptHtml(res.receipt as PosReceiptInput);
    expect(html).toContain("data:image/png;base64,");
  });
});
