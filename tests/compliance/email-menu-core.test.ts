/**
 * Vitest mirror of the email-menu-core pure self-tests (SLICE 83).
 * Locks the vendor_menu@ emailed-menu pipeline's pure brain: junk/menu
 * classification, deterministic body/HTML/table parsing (money in integer
 * cents), image-to-item matching, AI TSV re-validation, and the menus-page
 * display rows + PO builder banner.
 */
import { describe, expect, it } from "vitest";

import {
  __runEmailMenuCoreTests,
  classifyMenuEmail,
  emailHtmlToLines,
  emailMenuPrefillBanner,
  emailedMenuRow,
  emailedSourceLabel,
  findPriceToken,
  matchImagesToItems,
  mergeParsedItems,
  parseAiTsv,
  parseMenuLines,
  parseMenuTable,
  parseMenuText,
  sortEmailedRows,
  splitFromHeader,
} from "@/lib/purchasing/email-menu-core";

describe("email-menu-core (SLICE 83)", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runEmailMenuCoreTests()).not.toThrow();
  });

  it("classifies real menus as menu and spam as junk", () => {
    const menu = classifyMenuEmail({
      subject: "March wholesale menu",
      bodyText: "Blue Dream 3.5g $12.50\nGG4 1g $8.00",
      attachmentNames: [],
    });
    expect(menu.verdict).toBe("menu");
    const junk = classifyMenuEmail({
      subject: "You have won!!!",
      bodyText: "Claim your free money — wire transfer today",
      attachmentNames: [],
    });
    expect(junk.verdict).toBe("junk");
    expect(junk.reasons.length).toBeGreaterThan(0);
  });

  it("turns HTML tables into tab-delimited lines the parser reads", () => {
    const lines = emailHtmlToLines(
      "<table><tr><td>Blue Dream 3.5g</td><td>$12.50</td></tr></table>",
    );
    expect(lines[0]).toContain("\t");
    const items = parseMenuLines(lines);
    expect(items).toHaveLength(1);
    expect(items[0].wholesalePriceMinor).toBe(1250);
  });

  it("parses free-text lines with section context, money in integer cents", () => {
    const items = parseMenuLines([
      "FLOWER:",
      "Blue Dream 3.5g — $12.50 (40 avail) 24.5% THC sativa",
      "GG4 1g $8.00",
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Blue Dream");
    expect(items[0].wholesalePriceMinor).toBe(1250);
    expect(items[0].category).toBe("flower");
    expect(items[0].availableQty).toBe(40);
    expect(items[0].thcPct).toBe(24.5);
    expect(items[1].wholesalePriceMinor).toBe(800);
  });

  it("never invents a price — unpriced lines and rows are skipped", () => {
    expect(findPriceToken("call for pricing")).toBeNull();
    expect(parseMenuLines(["Blue Dream 3.5g — great strain"])).toHaveLength(0);
    const csv = parseMenuTable("Product,Price\nNo Price Row,\n");
    expect(csv).toHaveLength(0);
  });

  it("parses CSV price sheets through the header-mapped table path", () => {
    const items = parseMenuText(
      "Product,Brand,Category,Size,Price,Qty,THC\nBlue Dream,Acme,Flower,3.5g,$12.50,40,24.5\n",
    );
    expect(items).toHaveLength(1);
    expect(items[0].brand).toBe("Acme");
    expect(items[0].wholesalePriceMinor).toBe(1250);
    expect(items[0].thcPct).toBe(24.5);
  });

  it("matches emailed images to items by filename tokens", () => {
    const m = matchImagesToItems(
      ["blue_dream_jar.jpg", "unrelated.png"],
      ["Blue Dream", "GG4"],
    );
    expect(m.get(0)).toBe(0);
    expect(m.has(1)).toBe(false);
  });

  it("re-validates AI TSV output deterministically (prices to cents)", () => {
    const items = parseAiTsv("Blue Dream\tAcme\tflower\t3.5g\t$12.50\t40\t24.5\tNice");
    expect(items).toHaveLength(1);
    expect(items[0].wholesalePriceMinor).toBe(1250);
    expect(parseAiTsv("Bad\t\t\t\tnot-a-price\t\t\t")).toHaveLength(0);
  });

  it("merges deterministic + AI items with deterministic winning collisions", () => {
    const det = parseMenuText("Blue Dream 3.5g $12.50");
    const ai = parseAiTsv("blue dream\t\t\t\t$9.99\t\t\t\nGG4\t\t\t\t$8.00\t\t\t");
    const merged = mergeParsedItems(det, ai);
    expect(merged).toHaveLength(2);
    expect(merged[0].wholesalePriceMinor).toBe(1250);
    expect(merged[1].name).toBe("GG4");
  });

  it("splits From headers and builds professional table rows", () => {
    expect(splitFromHeader('"Acme Farms" <sales@acme.com>')).toEqual({
      name: "Acme Farms",
      address: "sales@acme.com",
    });
    const row = emailedMenuRow({
      id: "e1",
      from_address: "sales@acme.com",
      from_name: "Acme Farms",
      subject: "Menu",
      received_at: "2026-03-01T10:00:00Z",
      status: "parsed",
      item_count: 5,
      source: "body+pdf",
      parse_method: "deterministic+ai",
    });
    expect(row.href).toBe("/admin/purchasing/menus/email/e1");
    expect(row.sourceLabel).toBe("Body + PDF · AI-assisted");
    expect(emailedSourceLabel("pdf", "deterministic")).toBe("PDF");
  });

  it("sorts emailed rows newest first with bad dates sinking", () => {
    const rows = sortEmailedRows([
      { id: "bad", from_address: null, from_name: null, subject: null, received_at: "nope", status: "parsed", item_count: 0, source: null, parse_method: null },
      { id: "new", from_address: null, from_name: null, subject: null, received_at: "2026-03-01T00:00:00Z", status: "parsed", item_count: 0, source: null, parse_method: null },
    ]);
    expect(rows[0].id).toBe("new");
    expect(rows[1].id).toBe("bad");
  });

  it("writes the PO builder banner in the house style", () => {
    expect(emailMenuPrefillBanner(2, "Acme")).toContain("Started from an emailed menu: 2 items from Acme");
    expect(emailMenuPrefillBanner(1, null)).toContain("1 item pre-added");
  });
});
