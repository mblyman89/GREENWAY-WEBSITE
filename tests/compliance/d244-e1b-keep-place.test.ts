/**
 * D244 E-1b — keep my place (F-40) and Prev / Next / Save & next (F-41).
 *
 * Every product-detail action posts the list's `back`, and every redirect
 * back to the detail page goes through ONE helper, `detailUrl(key, back,
 * flash, hash)`, so "← All products" returns to the same filtered list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runDetailNavCoreTests,
  cleanBack,
  detailUrl,
  neighbours,
  parseStatusIntent,
  parseStoredOrder,
  serializeOrder,
} from "@/lib/enrichment/detail-nav-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D244 E-1b — detail-nav core", () => {
  it("self-tests pass", () => {
    const r = __runDetailNavCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(32);
  });
  it("detailUrl keeps back and stays byte-identical without it", () => {
    expect(detailUrl("K", "", "?saved=1")).toBe("/admin/products/K?saved=1");
    expect(detailUrl("K", "", "?ai=1", "#ai")).toBe("/admin/products/K?ai=1#ai");
    expect(detailUrl("K", "vv=none&page=2", "?saved=1")).toBe("/admin/products/K?saved=1&back=vv%3Dnone%26page%3D2");
    expect(detailUrl("K", "https://evil.example", "?saved=1")).toBe("/admin/products/K?saved=1");
  });
  it("only a query string survives as back", () => {
    expect(cleanBack("/admin/products?q=gas")).toBe("q=gas");
    expect(cleanBack("//evil.example")).toBe("");
  });
  it("Prev/Next only use the order saved for the same list", () => {
    const raw = serializeOrder("q=gas", ["A", "B", "C"]);
    expect(neighbours(parseStoredOrder(raw, "q=gas"), "B")).toEqual({ prev: "A", next: "C", index: 1, total: 3 });
    expect(neighbours(parseStoredOrder(raw, "q=kush"), "B").index).toBe(-1);
    expect(parseStatusIntent("published:next")).toEqual({ status: "published", andNext: true });
  });
});

describe("D244 E-1b — scanner: no bare detail redirect", () => {
  const actions = read("src/app/admin/products/actions.ts");
  it("no redirect builds /admin/products/${key}? by hand", () => {
    const redirects = actions.match(/redirect\([\s\S]*?\);/g) ?? [];
    const bare = redirects.filter((r) => /`\/admin\/products\/\$\{encodeURIComponent\(key\)\}\?/.test(r) || /\$\{back\}\?/.test(r));
    expect(bare).toEqual([]);
    expect(actions).not.toMatch(/\/admin\/products\/\$\{encodeURIComponent\(key\)\}\?saved/);
  });
  it("every per-product action reads back right after the key", () => {
    const keyReads = actions.match(/const key = String\(formData\.get\("key"\) \?\? ""\)(\.trim\(\))?;\n/g) ?? [];
    const withBack = actions.match(/const key = String\(formData\.get\("key"\) \?\? ""\)(\.trim\(\))?;\n  const listBack = cleanBack\(formData\.get\("back"\)\);/g) ?? [];
    expect(keyReads.length).toBeGreaterThanOrEqual(14);
    expect(withBack.length).toBe(keyReads.length);
    expect((actions.match(/detailUrl\(key, listBack/g) ?? []).length).toBeGreaterThanOrEqual(40);
  });
  it("Save & next and Publish & next go to the next card in the same list", () => {
    expect(actions).toContain('const nextKey = formData.get("then") === "next" ? cleanKey(formData.get("nextKey")) : "";');
    expect(actions).toContain('const { status, andNext } = parseStatusIntent(formData.get("status") ?? "draft");');
    expect(actions).toContain('if (nextKey && nextKey !== key) redirect(detailUrl(nextKey, listBack, "?saved=1"));');
  });
});

describe("D244 E-1b — pages", () => {
  const detail = read("src/app/admin/products/[key]/page.tsx");
  it("every detail form that posts the key also posts back", () => {
    const keyInputs = (detail.match(/<input type="hidden" name="key" value=\{key\} \/>/g) ?? []).length;
    const backInputs = (detail.match(/<input type="hidden" name="key" value=\{key\} \/>\n\s*\{listBack \? <input type="hidden" name="back" value=\{listBack\} \/> : null\}/g) ?? []).length;
    expect(keyInputs).toBeGreaterThanOrEqual(20);
    expect(backInputs).toBe(keyInputs);
  });
  it("Prev / Next on top, Save & next / Publish & next at the bottom", () => {
    expect(detail).toContain('<DetailNav posKey={key} back={listBack} position="top" />');
    expect(detail).toContain('<DetailNav posKey={key} back={listBack} position="bottom" />');
    expect(detail).toContain("<form action={updateProductEnrichment} id={DETAIL_EDITOR_FORM_ID}");
    expect(detail).toContain("<form action={setEnrichmentStatus} id={DETAIL_PUBLISH_FORM_ID}");
  });
  it("the list records its order for its own query string", () => {
    const list = read("src/app/admin/products/page.tsx");
    expect(list).toContain("<WorklistOrderRecorder back={listQs} keys={filtered.slice(0, 2000).map((g) => g.posKey)} />");
    const nav = read("src/components/admin/products/WorklistNav.tsx");
    expect(nav.startsWith('"use client";')).toBe(true);
    expect(nav).toContain("Save &amp; next →");
    expect(nav).toContain("Publish &amp; next →");
  });
  it("the pure runner calls the core", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runDetailNavCoreTests } from "../../src/lib/enrichment/detail-nav-core";');
    expect(runner).toContain('assertRan("detail-nav-core", __runDetailNavCoreTests(), 32);');
  });
});
