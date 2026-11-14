/**
 * D244 E-2 — bulk publish from the enrichment worklist.
 *
 * Owner: "there are several products that have an image, but are drafts".
 * Only PUBLISHED enrichment reaches the menu, so the worklist now lets the
 * owner tick cards (or every card matching a filter) and publish at once,
 * with a "Ready to publish" (draft + photo) filter and a pre-flight.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __runBulkPublishCoreTests,
  BULK_STATUS_MAX,
  planBulkStatus,
  resolveBulkKeys,
} from "@/lib/enrichment/bulk-publish-core";
import { ProductGrid, type ProductGridCard } from "@/components/admin/products/ProductGrid";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const card: ProductGridCard = {
  posKey: "K1",
  name: "Blue Dream 3.5g",
  brand: "Phat Panda",
  category: "Flower",
  hasDescription: true,
  hasImage: true,
  hasBrandLink: false,
  enrichmentStatus: "draft",
  thumbnailUrl: null,
  hasOwnRecord: true,
};

describe("D244 E-2 — bulk-publish core", () => {
  it("self-tests pass", () => {
    const r = __runBulkPublishCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(34);
  });
  it("publish never touches a card without its own record, and defaults to drafts with a photo", () => {
    const plan = planBulkStatus(
      [
        { posKey: "A", hasImage: true, hasDescription: false, enrichmentStatus: "draft", hasOwnRecord: true },
        { posKey: "B", hasImage: false, hasDescription: true, enrichmentStatus: "draft", hasOwnRecord: true },
        { posKey: "C", hasImage: true, hasDescription: true, enrichmentStatus: null, hasOwnRecord: false },
      ],
      "published",
    );
    expect(plan.apply).toEqual(["A"]);
    expect(plan.skipped).toEqual({ "no-photo": 1, "no-record": 1 });
  });
  it("select-all-matching is capped", () => {
    const many = Array.from({ length: BULK_STATUS_MAX + 5 }, (_, i) => `k${i}`).join("\n");
    const r = resolveBulkKeys([], many, "matching");
    expect(r.keys).toHaveLength(BULK_STATUS_MAX);
    expect(r.capped).toBe(true);
  });
});

describe("D244 E-2 — grid checkboxes", () => {
  it("no checkbox unless the page asks for selection (other callers unchanged)", () => {
    expect(renderToStaticMarkup(<ProductGrid cards={[card]} />)).not.toContain('type="checkbox"');
  });
  it("each card's checkbox joins the bulk form and carries the pre-flight facts", () => {
    const html = renderToStaticMarkup(<ProductGrid cards={[card]} selectFormId="bulk-status-form" />);
    expect(html).toContain('form="bulk-status-form"');
    expect(html).toContain('name="keys"');
    expect(html).toContain('value="K1"');
    expect(html).toContain('data-ready="1"');
    expect(html).toContain('data-own="1"');
  });
});

describe("D244 E-2 — wiring", () => {
  const page = read("src/app/admin/products/page.tsx");
  const actions = read("src/app/admin/products/actions.ts");
  const bar = read("src/components/admin/products/BulkStatusBar.tsx");
  it("page: maxDuration, ready filter + call-out, bar, table checkboxes, ok flash", () => {
    expect(page).toContain("export const maxDuration = 300;");
    expect(page).toContain('else if (gap === "ready") filtered = filtered.filter((g) => isReadyToPublish(g));');
    expect(page).toContain('<option value="ready">Ready to publish (draft + photo)</option>');
    expect(page).toContain('data-testid="ready-to-publish-callout"');
    expect(page).toContain("action={bulkSetEnrichmentStatusAction}");
    expect(page).toContain("selectFormId={BULK_FORM_ID}");
    expect(page).toContain("hasOwnRecord={ownEnrichments.has(g.posKey)}");
    expect(page).toContain('data-testid="bulk-status-ok"');
  });
  it("action: permission, one chunked update, one audit, one revalidation, returns to the list", () => {
    const a = actions.slice(actions.indexOf("export async function bulkSetEnrichmentStatusAction"));
    const body = a.slice(0, a.indexOf("\n}\n"));
    expect(body).toContain('await requirePermission("products.enrich")');
    expect(body).toContain("setEnrichmentStatusForKeys(plan.apply, status!, session.userId)");
    expect(body).toContain("action: `product.bulk_${status}`");
    expect((body.match(/revalidatePublicMenuSurfaces\(\)/g) ?? []).length).toBe(1);
    expect(body).toContain('backHref("/admin/products", String(formData.get("back") ?? ""))');
    expect(body).toContain("const BUDGET_MS = 200_000;");
  });
  it("bar: select all on page, select every matching, confirm on click (not onSubmit)", () => {
    expect(bar.startsWith('"use client";')).toBe(true);
    expect(bar).toContain("Select all on this page");
    expect(bar).toContain("Select every card matching this filter");
    expect(bar).toContain('name="matchingKeys"');
    expect(bar).not.toMatch(/onSubmit=/);
  });
  it("store: chunked status update", () => {
    const store = read("src/lib/enrichment/store.ts");
    expect(store).toContain("export async function setEnrichmentStatusForKeys(");
    expect(store).toContain('.in("pos_product_key", slice)');
  });
});
