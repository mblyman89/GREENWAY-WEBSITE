/**
 * tests/compliance/r12-bulk-fill-keeps-filters.test.tsx  (Round 12)
 *
 * The Cultivera gap worklists ("Bulk fill the Cultivera-import lots") open the
 * Inventory list filtered AND in Bulk fill mode. Bulk fill used to redirect to
 * `/admin/inventory?bulk=1&…` after Preview / Save and its Cancel / Exit links
 * were bare, so the worklist filter was dropped after the first pass (the list
 * shows 100 lots a page). Proven here: the panel posts the filters, every exit
 * link keeps them, and the action rebuilds its redirect from them.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/inventory/actions", () => ({ bulkFillLotsAction: async () => undefined }));

const { default: BulkFillPanel } = await import("@/components/admin/inventory/BulkFillPanel");
import { bulkReturnParams } from "@/lib/inventory/inventory-url-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const attr = (html: string, testId: string) => {
  const m = html.match(new RegExp(`data-testid="${testId}"[^>]*href="([^"]*)"|href="([^"]*)"[^>]*data-testid="${testId}"`));
  return (m?.[1] ?? m?.[2] ?? "").replace(/&amp;/g, "&");
};
const hidden = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`name="${name}" value="([^"]*)"`, "g"))].map((m) => m[1].replace(/&amp;/g, "&"));

describe("R12 — Bulk fill keeps the worklist filters", () => {
  const QS = "status=active&missingExpiry=1&page=2&bulk=1&bulkField=expires_on";

  it("step 1: posts the filters and Exit keeps them", () => {
    const html = renderToStaticMarkup(<BulkFillPanel visibleLotIds={["a", "b"]} field="expires_on" returnQs={QS} />);
    expect(hidden(html, "return_qs")).toEqual(["status=active&missingExpiry=1"]);
    expect(attr(html, "bulk-exit")).toBe("/admin/inventory?status=active&missingExpiry=1");
  });

  it("step 2 (preview): Save posts the filters, Cancel keeps them in bulk mode", () => {
    const html = renderToStaticMarkup(
      <BulkFillPanel visibleLotIds={["a"]} field="expires_on" value="2027-01-01" previewCount="1" previewIds="a" returnQs={QS} />,
    );
    expect(hidden(html, "return_qs")).toEqual(["status=active&missingExpiry=1"]);
    expect(attr(html, "bulk-cancel")).toBe("/admin/inventory?status=active&missingExpiry=1&bulk=1");
  });

  it("with no filters the links are the old bare ones", () => {
    const html = renderToStaticMarkup(<BulkFillPanel visibleLotIds={[]} />);
    expect(attr(html, "bulk-exit")).toBe("/admin/inventory");
    const p = renderToStaticMarkup(<BulkFillPanel visibleLotIds={["a"]} field="expires_on" previewCount="1" previewIds="a" />);
    expect(attr(p, "bulk-cancel")).toBe("/admin/inventory?bulk=1");
  });

  it("the sanitiser drops page and bulk state and keeps repeated facets", () => {
    expect(bulkReturnParams("fVendor=A&fVendor=B&bulkIds=x&page=9").toString()).toBe("fVendor=A&fVendor=B");
  });

  it("the action rebuilds its redirect from return_qs, then sets bulk=1 and the result", () => {
    const src = read("src/app/admin/inventory/actions.ts");
    const fn = src.slice(src.indexOf("export async function bulkFillLotsAction"));
    expect(fn).toContain('const returnQs = bulkReturnParams(formData.get("return_qs") as string | null);');
    expect(fn).toContain("const q = new URLSearchParams(returnQs);");
    expect(fn).toContain('q.set("bulk", "1");');
    expect(fn).toContain("redirect(`/admin/inventory?${q.toString()}`);");
  });

  it("the Inventory page passes its current filters to the panel", () => {
    expect(read("src/app/admin/inventory/page.tsx")).toContain("returnQs={filterParams().toString()}");
  });
});
