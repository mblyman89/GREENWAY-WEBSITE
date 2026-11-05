/**
 * D177 S5 — the Label Studio is reachable from everywhere the owner asked:
 * "connected to receiving as it already is, and … available in the product
 * detail pages for both cannabis and non cannabis inventory."
 *
 * Source pins (the pages are server components behind auth), plus the
 * other-inventory batch page's input handling.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  parseLabelIdList,
  copiesFromInvoiceLines,
  suggestedCopiesForNc,
  MAX_BATCH_IDS,
  MAX_COPIES_PER_ITEM,
} from "@/lib/printing/label-studio-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D177 S5 — Label Studio entry points", () => {
  it("cannabis lot detail page has a Print label action to the lot studio", () => {
    const s = read("src/app/admin/inventory/[id]/page.tsx");
    expect(s).toContain("href={`/admin/inventory/lots/${lot.id}/label`}");
    expect(s).toContain("🏷 Print label");
  });

  it("cannabis product page links every lot to its label", () => {
    const s = read("src/app/admin/products/[key]/page.tsx");
    expect(s).toContain("href={`/admin/inventory/lots/${lot.id}/label`}");
  });

  it("receiving manifest keeps the per-line label and adds the whole-manifest batch", () => {
    const s = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(s).toContain("href={`/admin/inventory/intake/${id}/labels`}");
    expect(s).toContain("🏷 Print labels for this manifest");
    expect(s).toContain("🏷 Print label");
    expect(existsSync("src/app/admin/inventory/intake/[id]/labels/page.tsx")).toBe(true);
  });

  it("other inventory: item detail row, list, drafts, invoices and the invoice builder all reach the studio", () => {
    const cat = read("src/app/admin/inventory/noncannabis/MerchCatalog.tsx");
    expect(cat).toContain("🏷 Reprint label");
    expect(cat).toContain("🏷 Open Label Studio");
    const page = read("src/app/admin/inventory/noncannabis/page.tsx");
    expect(page).toContain("/admin/inventory/noncannabis/labels?drafts=1");
    expect(page).toContain("/admin/inventory/noncannabis/labels?invoice=${inv.invoiceId}");
    expect(page).not.toContain("🖨 Print SKU");
    const form = read("src/app/admin/inventory/noncannabis/InvoiceBuilderForm.tsx");
    expect(form).toContain("/admin/inventory/noncannabis/labels?invoice=${state.invoiceId}");
    const act = read("src/app/admin/inventory/noncannabis/actions.ts");
    expect(act).toContain("invoiceId: res.id");
  });

  it("batch page reads are paged + checked and errors are explained, never shown as empty", () => {
    const store = read("src/lib/printing/label-batch-store.ts");
    expect(store).toContain("pagedAllChecked");
    expect(store).not.toMatch(/\.limit\(\s*\d{4,}/);
    const page = read("src/app/admin/inventory/noncannabis/labels/page.tsx");
    expect(page).toContain('requirePermission("inventory.manage")');
    expect(page).toContain("labelLoadErrorText");
    expect(page).toContain('<LabelStudio kind="nc"');
  });

  it("id lists only ever carry UUIDs (no junk reaches a query)", () => {
    const r = parseLabelIdList("x, 11111111-2222-3333-4444-555555555555, ' or 1=1 --");
    expect(r.ids).toEqual(["11111111-2222-3333-4444-555555555555"]);
    expect(r.dropped).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_BATCH_IDS + 3 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect(parseLabelIdList(many.join(" ")).ids).toHaveLength(MAX_BATCH_IDS);
  });

  it("invoice copies = pieces received per product, capped", () => {
    const m = copiesFromInvoiceLines([
      { product_id: "A", qty: 12 },
      { product_id: "a", qty: 3 },
      { product_id: null, qty: 4 },
    ]);
    expect(m.get("a")).toBe(15);
    expect(m.size).toBe(1);
    expect(suggestedCopiesForNc(9999)).toBe(MAX_COPIES_PER_ITEM);
  });
});
